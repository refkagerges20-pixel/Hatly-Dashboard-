import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Ban,
  Check,
  CheckCircle2,
  Eye,
  Loader2,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  Send,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type {
  Courier,
  CourierDeposit,
  Merchant,
  Order,
  OrderCourier,
  OrderStatus,
} from '../types/database';
import { triggerAutoDispatch } from '../utils/autoDispatch';
import {
  DAILY_LIMIT_BLOCKED_MSG,
  syncSingleCourierCashLimit,
} from '../utils/cashLimits';
import {
  calculateCommissionSplit,
  fetchCourierCommissionPct,
} from '../utils/commissions';
import {
  buildCourierCustodySummaries,
  getOrderDeliveryFeeNet,
  groupOrderCouriersByOrder,
} from '../utils/custody';
import { invalidateSummaryCache } from '../utils/summaryCache';
import { useOrdersRealtime } from '../utils/useOrdersRealtime';
import { LargeOrderCouriersModal } from './LargeOrderCouriersModal';
import { OrderDetailsModal } from './OrderDetailsModal';
import { PaginationBar } from './PaginationBar';
import { RecordDepositModal } from './RecordDepositModal';

const PAGE_SIZE = 20;

function sanitizePostgrestSearch(raw: string): string {
  return raw.replace(/[,()*%]/g, ' ').replace(/\s+/g, ' ').trim();
}

interface OrdersViewProps {
  onNavigateNewOrder: () => void;
}

const STATUS_LABELS: Record<string, { label: string; colorClass: string }> = {
  new: { label: 'جديد', colorClass: 'text-sky-700' },
  assigned: { label: 'تم التعيين', colorClass: 'text-amber-700' },
  picked_up: { label: 'تم الاستلام', colorClass: 'text-indigo-700' },
  in_transit: { label: 'قيد التوصيل', colorClass: 'text-orange-700' },
  delivered: { label: 'تم التسليم', colorClass: 'text-emerald-700' },
  cancelled: { label: 'ملغي', colorClass: 'text-red-700' },
};

const ORDER_SOURCE_LABELS: Record<
  string,
  { label: string; colorClass: string }
> = {
  customer_app: { label: 'تطبيق العميل', colorClass: 'text-sky-700' },
  admin: { label: 'لوحة التحكم', colorClass: 'text-[#0B1A33]' },
  merchant_portal: { label: 'بوابة التاجر', colorClass: 'text-[#FF7B00]' },
  call_center: { label: 'مركز الاتصال', colorClass: 'text-indigo-700' },
};

function getOrderSourceMeta(source?: string | null): {
  label: string;
  colorClass: string;
} {
  const normalized = String(source ?? '').trim();
  if (!normalized) {
    return { label: 'غير محدد', colorClass: 'text-slate-400' };
  }
  return (
    ORDER_SOURCE_LABELS[normalized] || {
      label: normalized,
      colorClass: 'text-slate-700',
    }
  );
}

export function OrdersView({ onNavigateNewOrder }: OrdersViewProps) {
  const {
    role,
    canAccess,
    merchantRecord,
    courierRecord,
    courierCashStatus,
    refreshProfile,
  } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [orderCouriers, setOrderCouriers] = useState<OrderCourier[]>([]);
  const [deposits, setDeposits] = useState<CourierDeposit[]>([]);
  const [commissionPct, setCommissionPct] = useState<number>(70);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalOrdersCount, setTotalOrdersCount] = useState(0);
  const [pendingCancellationsCount, setPendingCancellationsCount] = useState(0);
  const [courierOwnOrders, setCourierOwnOrders] = useState<Order[]>([]);
  const [courierOwnOrderCouriers, setCourierOwnOrderCouriers] = useState<
    OrderCourier[]
  >([]);
  const [dispatchNotice, setDispatchNotice] = useState<{
    type: 'success' | 'warning';
    text: string;
  } | null>(null);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [togglingShift, setTogglingShift] = useState(false);
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [largeOrderModalOrder, setLargeOrderModalOrder] = useState<Order | null>(
    null
  );
  const [proofPreviewOrder, setProofPreviewOrder] = useState<Order | null>(null);
  const [detailsModalOrder, setDetailsModalOrder] = useState<Order | null>(
    null
  );

  // Debounce search input & reset to page 1 on search change
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setCurrentPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const loadData = useCallback(async (silent = false) => {
    if (silent !== true) {
      setLoading(true);
    }
    const from = (currentPage - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const safeQ = sanitizePostgrestSearch(debouncedSearch);

    // Resolve courier-assigned order IDs when role === 'courier' so server filter is exact
    let courierOcOrderIds: string[] = [];
    if (role === 'courier' && courierRecord) {
      const courierIds = Array.from(
        new Set(
          [courierRecord.id, courierRecord.profile_id].filter(Boolean) as string[]
        )
      );
      if (courierIds.length > 0) {
        const ocForCourierRes = await supabase
          .from('order_couriers')
          .select('*')
          .in('courier_id', courierIds);
        const rows = (ocForCourierRes.data as OrderCourier[]) || [];
        setCourierOwnOrderCouriers(rows);
        courierOcOrderIds = Array.from(new Set(rows.map((r) => r.order_id)));
      }
    }

    const buildOrdersQuery = (includeCancelReasonSearch: boolean) => {
      let q = supabase
        .from('orders')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

      if (role === 'merchant' && merchantRecord?.id) {
        q = q.eq('merchant_id', merchantRecord.id);
      } else if (role === 'courier' && courierRecord) {
        const parts = [`courier_id.eq.${courierRecord.id}`];
        if (courierRecord.profile_id) {
          parts.push(`courier_id.eq.${courierRecord.profile_id}`);
        }
        if (courierOcOrderIds.length > 0) {
          parts.push(`id.in.(${courierOcOrderIds.join(',')})`);
        }
        q = q.or(parts.join(','));
      }

      if (statusFilter === 'cancellations') {
        q = q.eq('cancel_status', 'pending');
      } else if (statusFilter !== 'all') {
        q = q.eq('status', statusFilter);
      }

      if (safeQ) {
        const searchFields = [
          `order_number.ilike.%${safeQ}%`,
          `customer_name.ilike.%${safeQ}%`,
          `customer_phone.ilike.%${safeQ}%`,
          `delivery_address.ilike.%${safeQ}%`,
        ];
        if (includeCancelReasonSearch) {
          searchFields.push(`cancel_reason.ilike.%${safeQ}%`);
        }
        q = q.or(searchFields.join(','));
      }

      return q.range(from, to);
    };

    let cancelCountQuery = supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('cancel_status', 'pending');
    if (role === 'merchant' && merchantRecord?.id) {
      cancelCountQuery = cancelCountQuery.eq('merchant_id', merchantRecord.id);
    }

    const [ordersResInitial, cancelCountRes, pct] = await Promise.all([
      buildOrdersQuery(true),
      cancelCountQuery,
      fetchCourierCommissionPct(),
    ]);

    let ordersRes = ordersResInitial;
    if (
      ordersRes.error &&
      safeQ &&
      (ordersRes.error.code === '42703' ||
        ordersRes.error.code === 'PGRST204' ||
        ordersRes.error.message.includes('cancel_reason'))
    ) {
      ordersRes = await buildOrdersQuery(false);
    }

    const pageOrders = (ordersRes.data as Order[]) || [];
    setOrders(pageOrders);
    setTotalOrdersCount(ordersRes.count ?? pageOrders.length);
    setPendingCancellationsCount(cancelCountRes.count ?? 0);
    setCommissionPct(pct);

    // Fetch supporting lookups strictly for the current page of 20 orders
    const pageOrderIds = pageOrders.map((o) => o.id);
    const pageMerchantIds = Array.from(
      new Set(
        pageOrders.map((o) => o.merchant_id).filter(Boolean) as string[]
      )
    );
    const pageOrderCourierIds = Array.from(
      new Set(
        pageOrders.map((o) => o.courier_id).filter(Boolean) as string[]
      )
    );

    const [ocRes, merchRes, depositsRes] = await Promise.all([
      pageOrderIds.length > 0
        ? supabase
            .from('order_couriers')
            .select('*')
            .in('order_id', pageOrderIds)
        : Promise.resolve({ data: [], error: null }),
      pageMerchantIds.length > 0
        ? supabase
            .from('merchants')
            .select('id, store_name, name')
            .in('id', pageMerchantIds)
        : Promise.resolve({ data: [], error: null }),
      role === 'courier' && courierRecord
        ? supabase
            .from('courier_deposits')
            .select('*')
            .eq('courier_id', courierRecord.id)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const loadedOc = (ocRes.data as OrderCourier[]) || [];
    const allCourierIds = Array.from(
      new Set([
        ...pageOrderCourierIds,
        ...loadedOc.map((r) => r.courier_id).filter(Boolean),
      ])
    );

    let loadedCouriers: Courier[] = [];
    if (allCourierIds.length > 0) {
      const cRes = await supabase
        .from('couriers')
        .select('id, profile_id, active_orders_count, status, account_status, profiles(full_name, phone)')
        .in('id', allCourierIds);
      if (!cRes.error && cRes.data) {
        loadedCouriers = cRes.data as unknown as Courier[];
      } else {
        const fbRes = await supabase
          .from('couriers')
          .select('id, profile_id, active_orders_count, status, account_status')
          .in('id', allCourierIds);
        loadedCouriers = (fbRes.data as unknown as Courier[]) || [];
      }
    }

    if (role === 'courier' && courierRecord) {
      const ownParts = [`courier_id.eq.${courierRecord.id}`];
      if (courierRecord.profile_id) {
        ownParts.push(`courier_id.eq.${courierRecord.profile_id}`);
      }
      if (courierOcOrderIds.length > 0) {
        ownParts.push(`id.in.(${courierOcOrderIds.join(',')})`);
      }
      const ownOrdersRes = await supabase
        .from('orders')
        .select('*')
        .eq('status', 'delivered')
        .or(ownParts.join(','));
      setCourierOwnOrders((ownOrdersRes.data as Order[]) || []);
    }

    setOrderCouriers(loadedOc);
    setMerchants((merchRes.data as Merchant[]) || []);
    setCouriers(loadedCouriers);
    setDeposits((depositsRes.data as CourierDeposit[]) || []);
    setLoading(false);
  }, [currentPage, debouncedSearch, statusFilter, role, merchantRecord, courierRecord]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const realtimeTimerRef = useRef<number | undefined>(undefined);

  useOrdersRealtime('orders-view', (payload) => {
    invalidateSummaryCache();

    if (payload.eventType === 'UPDATE' && payload.new) {
      const updated = payload.new;
      setOrders((prev) =>
        prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o))
      );
      setDetailsModalOrder((prev) =>
        prev && prev.id === updated.id ? { ...prev, ...updated } : prev
      );
    } else if (payload.eventType === 'DELETE' && payload.old?.id) {
      const removedId = payload.old.id;
      setOrders((prev) => prev.filter((o) => o.id !== removedId));
    } else if (payload.eventType === 'INSERT' && payload.new) {
      const created = payload.new;
      const matchesRole =
        role !== 'merchant' ||
        !merchantRecord?.id ||
        created.merchant_id === merchantRecord.id;
      if (matchesRole && role !== 'courier') {
        const needsCourier =
          String(created.status || '').trim().toLowerCase() === 'new' &&
          !created.courier_id;
        setDispatchNotice({
          type: needsCourier ? 'warning' : 'success',
          text: needsCourier
            ? `تنبيه: وصل طلب جديد #${created.order_number || created.id.slice(0, 6)} — ${
                created.customer_name || 'عميل'
              } بحالة "جديد" (لا يوجد مندوب معيّن للمنطقة حتى الآن)`
            : `وصل طلب جديد #${created.order_number || created.id.slice(0, 6)} — ${
                created.customer_name || 'عميل'
              }`,
        });
      }
    }

    if (realtimeTimerRef.current) {
      window.clearTimeout(realtimeTimerRef.current);
    }
    realtimeTimerRef.current = window.setTimeout(() => {
      loadData(true);
    }, 250);
  });

  useEffect(() => {
    return () => {
      if (realtimeTimerRef.current) {
        window.clearTimeout(realtimeTimerRef.current);
      }
    };
  }, []);

  const orderCouriersMap = useMemo(
    () => groupOrderCouriersByOrder(orderCouriers),
    [orderCouriers]
  );

  const courierNameMap = useMemo(() => {
    const map = new Map<string, string>();
    couriers.forEach((c) => {
      const label = c.profiles?.full_name || c.profiles?.phone || c.id.slice(0, 6);
      map.set(c.id, label);
      if (c.profile_id) {
        map.set(c.profile_id, label);
      }
    });
    return map;
  }, [couriers]);

  const merchantNameMap = useMemo(() => {
    const map = new Map<string, string>();
    merchants.forEach((m) => {
      map.set(m.id, m.store_name || m.name || 'متجر');
    });
    return map;
  }, [merchants]);

  const courierCustodySummaries = useMemo(() => {
    if (role !== 'courier' || !courierRecord) return [];
    return buildCourierCustodySummaries(
      [courierRecord],
      courierOwnOrders,
      deposits,
      commissionPct,
      courierOwnOrderCouriers
    );
  }, [
    role,
    courierRecord,
    courierOwnOrders,
    deposits,
    commissionPct,
    courierOwnOrderCouriers,
  ]);

  const handleRetryDispatch = async (order: Order) => {
    setBusyOrderId(order.id);
    setDispatchNotice(null);
    const result = await triggerAutoDispatch(order.id, {
      requiredCouriers: order.is_large_order
        ? Math.max(2, Number(order.required_couriers || 2))
        : 1,
      deliveryFeeNet: getOrderDeliveryFeeNet(order),
      paymentMethod: order.payment_method,
      orderTotal: Number(order.total || 0),
      rejectedByCouriers: order.rejected_by_couriers,
      merchantId: order.merchant_id,
      toZoneId: order.to_zone_id,
    });
    setBusyOrderId(null);

    setDispatchNotice({
      type: result.assigned ? 'success' : 'warning',
      text: result.message,
    });
    invalidateSummaryCache();
    await loadData();
  };

  const handleStatusChange = async (order: Order, nextStatus: OrderStatus) => {
    setBusyOrderId(order.id);

    const assignedRows = orderCouriersMap.get(order.id) || [];
    const updatePayload: Record<string, unknown> = { status: nextStatus };
    const deliveryFeeNet = getOrderDeliveryFeeNet(order);

    if (nextStatus === 'delivered') {
      const pct = await fetchCourierCommissionPct();
      const { courierCommission: perCourierCommission } = calculateCommissionSplit(
        deliveryFeeNet,
        pct
      );

      if (assignedRows.length > 0) {
        // Update each order_couriers row with full commission & delivered status
        for (const row of assignedRows) {
          await supabase
            .from('order_couriers')
            .update({
              commission_amount: perCourierCommission,
              status: 'delivered',
            })
            .eq('id', row.id);
        }
        const totalCommissions = Number(
          (perCourierCommission * assignedRows.length).toFixed(2)
        );
        updatePayload.courier_commission = totalCommissions;
        updatePayload.hatly_net_revenue = Number(
          (deliveryFeeNet - totalCommissions).toFixed(2)
        );
      } else {
        const count = order.is_large_order
          ? Math.max(2, Number(order.required_couriers || 2))
          : 1;
        const totalCommissions = Number((perCourierCommission * count).toFixed(2));
        updatePayload.courier_commission = totalCommissions;
        updatePayload.hatly_net_revenue = Number(
          (deliveryFeeNet - totalCommissions).toFixed(2)
        );
      }
    } else if (assignedRows.length > 0) {
      await supabase
        .from('order_couriers')
        .update({ status: nextStatus })
        .eq('order_id', order.id);
    }

    const { error: updateErr } = await supabase
      .from('orders')
      .update(updatePayload)
      .eq('id', order.id);

    if (
      updateErr &&
      (updateErr.code === '42703' ||
        updateErr.code === 'PGRST204' ||
        updateErr.message.includes('courier_commission') ||
        updateErr.message.includes('hatly_net_revenue'))
    ) {
      await supabase
        .from('orders')
        .update({ status: nextStatus })
        .eq('id', order.id);
    }

    // If order transitions to delivered or cancelled, decrement active_orders_count for all assigned couriers
    const affectedCourierIds =
      assignedRows.length > 0
        ? Array.from(new Set(assignedRows.map((r) => r.courier_id)))
        : order.courier_id
        ? [order.courier_id]
        : [];

    if (
      (nextStatus === 'delivered' || nextStatus === 'cancelled') &&
      order.status !== 'delivered' &&
      order.status !== 'cancelled'
    ) {
      for (const cid of affectedCourierIds) {
        const assignedCourier = couriers.find((c) => c.id === cid);
        if (assignedCourier) {
          const decremented = Math.max(
            0,
            (assignedCourier.active_orders_count || 0) - 1
          );
          await supabase
            .from('couriers')
            .update({ active_orders_count: decremented })
            .eq('id', assignedCourier.id);
        }
      }
    }

    if (nextStatus === 'delivered' && affectedCourierIds.length > 0) {
      for (const cid of affectedCourierIds) {
        await syncSingleCourierCashLimit(cid);
      }
      if (role === 'courier') {
        await refreshProfile();
      }
    }

    setBusyOrderId(null);
    invalidateSummaryCache();
    await loadData();
  };

  const handleCancellationDecision = async (
    order: Order,
    decision: 'approved' | 'rejected'
  ) => {
    setBusyOrderId(order.id);
    setDispatchNotice(null);

    const assignedRows = orderCouriersMap.get(order.id) || [];
    const affectedCourierIds =
      assignedRows.length > 0
        ? Array.from(new Set(assignedRows.map((r) => r.courier_id)))
        : order.courier_id
        ? [order.courier_id]
        : [];

    if (decision === 'approved') {
      const { error: approveErr } = await supabase
        .from('orders')
        .update({
          status: 'cancelled',
          cancel_status: 'approved',
          courier_commission: 0,
          hatly_net_revenue: 0,
        })
        .eq('id', order.id);

      if (approveErr) {
        setBusyOrderId(null);
        setDispatchNotice({
          type: 'warning',
          text: `تعذر الموافقة على الإلغاء: ${approveErr.message}`,
        });
        return;
      }

      if (assignedRows.length > 0) {
        await supabase
          .from('order_couriers')
          .update({ status: 'cancelled', commission_amount: 0 })
          .eq('order_id', order.id);
      }

      if (order.status !== 'delivered' && order.status !== 'cancelled') {
        for (const cid of affectedCourierIds) {
          const assignedCourier = couriers.find((c) => c.id === cid);
          if (assignedCourier) {
            const decremented = Math.max(
              0,
              (assignedCourier.active_orders_count || 0) - 1
            );
            await supabase
              .from('couriers')
              .update({ active_orders_count: decremented })
              .eq('id', assignedCourier.id);
          }
        }
      }

      setDispatchNotice({
        type: 'success',
        text: `تمت الموافقة على إلغاء الطلب ${order.order_number} دون احتساب أي عمولات أو رسوم مالية`,
      });
    } else {
      const { error: rejectErr } = await supabase
        .from('orders')
        .update({ cancel_status: 'rejected' })
        .eq('id', order.id);

      if (rejectErr) {
        setBusyOrderId(null);
        setDispatchNotice({
          type: 'warning',
          text: `تعذر رفض طلب الإلغاء: ${rejectErr.message}`,
        });
        return;
      }

      setDispatchNotice({
        type: 'success',
        text: `تم رفض طلب إلغاء الطلب ${order.order_number} وإعادته إلى قائمة المندوب النشطة`,
      });
    }

    setBusyOrderId(null);
    invalidateSummaryCache();
    await loadData();
  };

  const handleCourierShiftToggle = async () => {
    if (!courierRecord) return;
    const nextStatus = courierRecord.status === 'online' ? 'offline' : 'online';

    if (nextStatus === 'online' && courierCashStatus && !courierCashStatus.canGoOnline) {
      setDispatchNotice({
        type: 'warning',
        text: courierCashStatus.message || DAILY_LIMIT_BLOCKED_MSG,
      });
      return;
    }

    setTogglingShift(true);
    const { error } = await supabase
      .from('couriers')
      .update({ status: nextStatus })
      .eq('id', courierRecord.id);
    setTogglingShift(false);

    if (error) {
      setDispatchNotice({ type: 'warning', text: error.message });
      return;
    }

    await refreshProfile();
  };

  return (
    <div className="space-y-5">
      {role === 'courier' && courierRecord && courierCashStatus && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#0A192F] text-[#FF7B00] flex items-center justify-center shrink-0">
                <Wallet className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-bold text-[#0A192F]">
                  حالة الوردية ورصيد الكاش
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  رصيد الكاش الحالي:{' '}
                  <strong
                    className={`font-mono tabular-nums ${
                      courierCashStatus.dailyLimitBlocked
                        ? 'text-red-600'
                        : courierCashStatus.dailyLimitGraceToday
                        ? 'text-[#FF7B00]'
                        : 'text-[#0A192F]'
                    }`}
                  >
                    {courierCashStatus.cashBalance.toFixed(2)} ج.م
                  </strong>{' '}
                  (الحد اليومي:{' '}
                  <span className="font-mono tabular-nums">
                    {courierCashStatus.dailyLimit.toFixed(0)}
                  </span>{' '}
                  · الأقصى:{' '}
                  <span className="font-mono tabular-nums">
                    {courierCashStatus.maxLimit.toFixed(0)}
                  </span>{' '}
                  ج.م)
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={handleCourierShiftToggle}
                disabled={togglingShift}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold cursor-pointer ${
                  courierRecord.status === 'online'
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    : 'bg-slate-200 hover:bg-slate-300 text-[#0A192F]'
                }`}
              >
                {togglingShift && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>
                  {courierRecord.status === 'online'
                    ? 'متصل (Online) — اضغط للخروج'
                    : 'غير متصل (Offline) — اضغط لفتح الشغل'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setDepositModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#FF7B00] hover:bg-[#E56E00] text-white text-xs font-bold cursor-pointer"
              >
                <Receipt className="w-3.5 h-3.5" />
                <span>تسجيل توريد</span>
              </button>
            </div>
          </div>

          {courierCashStatus.dailyLimitBlocked && (
            <div className="flex flex-wrap items-center justify-between gap-2 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-bold">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                <span>{DAILY_LIMIT_BLOCKED_MSG}</span>
              </div>
              <button
                type="button"
                onClick={() => setDepositModalOpen(true)}
                className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold cursor-pointer"
              >
                توريد المبلغ الآن
              </button>
            </div>
          )}

          {courierCashStatus.dailyLimitGraceToday && (
            <div className="flex items-center gap-2 p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
              <span>{courierCashStatus.message}</span>
            </div>
          )}
        </div>
      )}
      {dispatchNotice && (
        <div
          role={dispatchNotice.type === 'warning' ? 'alert' : 'status'}
          className={`flex items-center justify-between gap-3 p-4 rounded-xl border text-sm font-semibold ${
            dispatchNotice.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-amber-50 border-amber-300 text-amber-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {dispatchNotice.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            )}
            <span>{dispatchNotice.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setDispatchNotice(null)}
            className="text-xs underline cursor-pointer"
          >
            إغلاق
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[260px]">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث برقم الطلب، اسم العميل أو الهاتف..."
              className="w-full pr-9 pl-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
            {[
              { id: 'all', label: 'الكل' },
              { id: 'new', label: 'جديد' },
              { id: 'assigned', label: 'معيّن' },
              { id: 'in_transit', label: 'بالطريق' },
              { id: 'delivered', label: 'تم التسليم' },
              ...(role === 'admin' || role === 'operations'
                ? [{ id: 'cancellations', label: 'طلبات الإلغاء' }]
                : []),
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setStatusFilter(tab.id);
                  setCurrentPage(1);
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  statusFilter === tab.id
                    ? tab.id === 'cancellations'
                      ? 'bg-[#EF2323] text-white shadow-xs'
                      : 'bg-white text-[#0B1A33] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.id === 'cancellations' && <Ban className="w-3.5 h-3.5" />}
                <span>{tab.label}</span>
                {tab.id === 'cancellations' && pendingCancellationsCount > 0 && (
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono tabular-nums font-bold ${
                      statusFilter === 'cancellations'
                        ? 'bg-white text-[#EF2323]'
                        : 'bg-[#EF2323] text-white'
                    }`}
                  >
                    {pendingCancellationsCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => loadData()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>تحديث</span>
          </button>
          {canAccess('new-order') && (
            <button
              type="button"
              onClick={onNavigateNewOrder}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#FF7B00] hover:bg-[#E56E00] text-white text-xs font-bold cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>إضافة طلب</span>
            </button>
          )}
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-10 flex flex-col items-center justify-center gap-3 text-slate-500">
            <Loader2 className="w-6 h-6 text-[#FF7B00] animate-spin" />
            <span className="text-sm">جاري تحميل الطلبات...</span>
          </div>
        ) : orders.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="text-sm font-bold text-[#0A192F]">
              لا توجد طلبات مطابقة للبحث
            </div>
            <p className="text-xs text-slate-500">
              {role === 'courier'
                ? 'لا توجد طلبات مسندة إليك حالياً في هذا التصنيف'
                : 'ابدأ بإضافة طلب جديد ليظهر في جدول المتابعة والتوزيع التلقائي'}
            </p>
            {canAccess('new-order') && (
              <button
                type="button"
                onClick={onNavigateNewOrder}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#FF7B00] text-white text-xs font-bold cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>إنشاء أول طلب</span>
              </button>
            )}
          </div>
        ) : statusFilter === 'cancellations' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-red-50/70 border-b border-red-100 text-xs font-bold text-[#0B1A33]">
                  <th className="py-3 px-4 whitespace-nowrap">رقم الطلب</th>
                  <th className="py-3 px-4 whitespace-nowrap">المندوب</th>
                  <th className="py-3 px-4 whitespace-nowrap">العميل</th>
                  <th className="py-3 px-4">سبب الإلغاء</th>
                  <th className="py-3 px-4 whitespace-nowrap">صورة الإثبات</th>
                  <th className="py-3 px-4 whitespace-nowrap">القرار</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {orders.map((order) => {
                  const assignedRows = orderCouriersMap.get(order.id) || [];
                  const courierDisplay =
                    assignedRows.length > 0
                      ? assignedRows
                          .map((r) => courierNameMap.get(r.courier_id) || 'مندوب')
                          .join('، ')
                      : order.courier_id
                      ? courierNameMap.get(order.courier_id) || 'مندوب'
                      : 'غير معيّن';
                  return (
                    <tr key={order.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-mono tabular-nums font-bold text-[#0B1A33] whitespace-nowrap">
                        <div>{order.order_number}</div>
                        <div className="text-[11px] font-sans text-slate-500">
                          {new Date(order.created_at).toLocaleString('ar-EG')}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-bold text-[#0B1A33] whitespace-nowrap">
                        {courierDisplay}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-semibold text-slate-800">
                          {order.customer_name}
                        </div>
                        <div className="text-xs text-slate-500 font-mono tabular-nums" dir="ltr">
                          {order.customer_phone}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs sm:text-sm text-slate-700 max-w-sm whitespace-normal">
                        {order.cancel_reason || 'لم يذكر سبب'}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {order.cancel_proof_url ? (
                          <button
                            type="button"
                            onClick={() => setProofPreviewOrder(order)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-[#0B1A33] cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5 text-[#FF7F00]" />
                            <span>عرض صورة الإثبات</span>
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">لا توجد صورة</span>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={busyOrderId === order.id}
                            onClick={() =>
                              handleCancellationDecision(order, 'approved')
                            }
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
                          >
                            {busyOrderId === order.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Check className="w-3.5 h-3.5" />
                            )}
                            <span>موافقة</span>
                          </button>
                          <button
                            type="button"
                            disabled={busyOrderId === order.id}
                            onClick={() =>
                              handleCancellationDecision(order, 'rejected')
                            }
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#EF2323] hover:bg-red-700 disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                            <span>رفض</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                  <th className="py-3 px-4 whitespace-nowrap">رقم الطلب</th>
                  <th className="py-3 px-4 whitespace-nowrap">نوع الطلب</th>
                  <th className="py-3 px-4 whitespace-nowrap">المصدر</th>
                  <th className="py-3 px-4 whitespace-nowrap">العميل</th>
                  <th className="py-3 px-4 whitespace-nowrap">المندوب</th>
                  <th className="py-3 px-4 whitespace-nowrap">الدفع</th>
                  <th className="py-3 px-4 whitespace-nowrap">الإجمالي</th>
                  <th className="py-3 px-4 whitespace-nowrap">الحالة</th>
                  <th className="py-3 px-4 whitespace-nowrap">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {orders.map((order) => {
                  const statusMeta = STATUS_LABELS[order.status] || {
                    label: order.status,
                    colorClass: 'text-slate-700',
                  };
                  const merchantTitle =
                    order.service_type === 'brand'
                      ? merchantNameMap.get(order.merchant_id || '') || 'متجر شريك'
                      : 'طلب مخصوص';
                  const orderSourceMeta = getOrderSourceMeta(order.order_source);

                  const assignedRows = orderCouriersMap.get(order.id) || [];
                  const requiredCouriers = Math.max(
                    1,
                    Number(order.required_couriers || 1)
                  );
                  const needsMoreCouriers =
                    order.is_large_order && assignedRows.length < requiredCouriers;

                  return (
                    <tr
                      key={order.id}
                      onClick={() => setDetailsModalOrder(order)}
                      className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                    >
                      <td className="py-3 px-4 font-mono tabular-nums font-bold text-[#0A192F] whitespace-nowrap">
                        <div>{order.order_number}</div>
                        {order.is_large_order && (
                          <div className="text-[11px] font-sans font-bold text-[#FF7B00]">
                            أوردر كبير ({requiredCouriers} مناديب)
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-semibold text-slate-800">
                          {order.service_type === 'brand' ? 'طلب من براند' : 'أوردر مخصوص'}
                        </div>
                        <div className="text-xs text-slate-500">
                          {merchantTitle}
                        </div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className={`text-xs font-bold ${orderSourceMeta.colorClass}`}>
                          {orderSourceMeta.label}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-800 whitespace-nowrap">
                          {order.customer_name}
                        </div>
                        <div className="text-xs text-slate-500 font-mono tabular-nums" dir="ltr">
                          {order.customer_phone}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-700">
                        {assignedRows.length > 0 ? (
                          <div className="space-y-0.5 text-xs">
                            {assignedRows.map((r) => (
                              <div key={r.id} className="font-semibold text-[#0A192F] whitespace-nowrap">
                                {courierNameMap.get(r.courier_id) || 'مندوب'}
                                {order.payment_method === 'cash' &&
                                  Number(r.cash_collected || 0) > 0 && (
                                    <span className="text-slate-500 font-mono tabular-nums">
                                      {' '}
                                      ({Number(r.cash_collected).toFixed(0)} ج.م)
                                    </span>
                                  )}
                              </div>
                            ))}
                          </div>
                        ) : order.courier_id ? (
                          courierNameMap.get(order.courier_id) || 'مندوب معيّن'
                        ) : (
                          <div>
                            <span>غير معيّن</span>
                            {Array.isArray(order.rejected_by_couriers) &&
                              order.rejected_by_couriers.length > 0 && (
                                <div className="text-[11px] font-semibold text-amber-700 mt-0.5">
                                  رفضه {order.rejected_by_couriers.length} مندوب
                                </div>
                              )}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-xs">
                        <div className="font-semibold text-slate-800">
                          {order.payment_method === 'card' ? 'بطاقة بنكية' : 'كاش'}
                        </div>
                        <div
                          className={
                            order.payment_status === 'paid'
                              ? 'text-emerald-600'
                              : 'text-slate-500'
                          }
                        >
                          {order.payment_status === 'paid' ? 'مدفوع' : 'غير مدفوع'}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums font-bold text-[#0A192F] whitespace-nowrap">
                        {Number(order.total || 0).toFixed(2)} ج.م
                      </td>
                      <td
                        className="py-3 px-4 whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <select
                          value={order.status}
                          disabled={busyOrderId === order.id}
                          onChange={(e) =>
                            handleStatusChange(order, e.target.value as OrderStatus)
                          }
                          className={`px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs font-bold ${statusMeta.colorClass}`}
                        >
                          <option value="new">جديد</option>
                          <option value="assigned">تم التعيين</option>
                          <option value="picked_up">تم الاستلام</option>
                          <option value="in_transit">قيد التوصيل</option>
                          <option value="delivered">تم التسليم</option>
                          <option value="cancelled">ملغي</option>
                        </select>
                        {order.status === 'cancelled' && order.cancel_reason && (
                          <div className="text-[11px] font-semibold text-red-600 mt-1">
                            السبب: {order.cancel_reason}
                          </div>
                        )}
                      </td>
                      <td
                        className="py-3 px-4 whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setDetailsModalOrder(order)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:border-[#FF7B00] hover:text-[#FF7B00] text-[#0B1A33] text-xs font-bold cursor-pointer transition-colors whitespace-nowrap"
                          >
                            <Eye className="w-3.5 h-3.5 text-[#FF7B00]" />
                            <span>عرض التفاصيل</span>
                          </button>

                          {((!order.courier_id && order.status === 'new') || needsMoreCouriers) && (
                            <button
                              type="button"
                              disabled={busyOrderId === order.id}
                              onClick={() => handleRetryDispatch(order)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0A192F] hover:bg-[#112240] text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
                            >
                              {busyOrderId === order.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Send className="w-3.5 h-3.5 text-[#FF7B00]" />
                              )}
                              <span>توزيع تلقائي</span>
                            </button>
                          )}

                          {(order.is_large_order || assignedRows.length > 1) && (
                            <button
                              type="button"
                              onClick={() => setLargeOrderModalOrder(order)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-[#0A192F] text-xs font-bold cursor-pointer whitespace-nowrap"
                            >
                              <Users className="w-3.5 h-3.5 text-[#FF7B00]" />
                              <span>توزيع التحصيل</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && totalOrdersCount > 0 && (
          <PaginationBar
            currentPage={currentPage}
            pageSize={PAGE_SIZE}
            totalCount={totalOrdersCount}
            loading={loading}
            onPageChange={setCurrentPage}
          />
        )}
      </div>

      <LargeOrderCouriersModal
        open={Boolean(largeOrderModalOrder)}
        order={largeOrderModalOrder}
        couriers={couriers}
        assignedRows={
          largeOrderModalOrder
            ? orderCouriersMap.get(largeOrderModalOrder.id) || []
            : []
        }
        commissionPct={commissionPct}
        onClose={() => setLargeOrderModalOrder(null)}
        onSaved={(msg) => {
          setDispatchNotice({ type: 'success', text: msg });
          loadData();
        }}
      />

      {role === 'courier' && courierRecord && (
        <RecordDepositModal
          open={depositModalOpen}
          onClose={() => setDepositModalOpen(false)}
          couriers={courierCustodySummaries}
          commissionPct={commissionPct}
          initialCourierId={courierRecord.id}
          onSaved={async (msg) => {
            setDispatchNotice({ type: 'success', text: msg });
            await refreshProfile();
            await loadData();
          }}
        />
      )}

      {proofPreviewOrder?.cancel_proof_url && (
        <div
          className="fixed inset-0 z-50 bg-[#0B1A33]/80 flex items-center justify-center p-4"
          onClick={() => setProofPreviewOrder(null)}
        >
          <div
            dir="rtl"
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl border border-slate-200 w-full max-w-xl overflow-hidden"
          >
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-[#0B1A33]">
                  صورة إثبات طلب الإلغاء — {proofPreviewOrder.order_number}
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  السبب: {proofPreviewOrder.cancel_reason || '—'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setProofPreviewOrder(null)}
                aria-label="إغلاق"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="bg-black max-h-[70vh] flex items-center justify-center">
              <img
                src={proofPreviewOrder.cancel_proof_url}
                alt={`إثبات إلغاء ${proofPreviewOrder.order_number}`}
                referrerPolicy="no-referrer"
                className="max-h-[70vh] w-full object-contain"
              />
            </div>
          </div>
        </div>
      )}
      <OrderDetailsModal
        open={Boolean(detailsModalOrder)}
        order={detailsModalOrder}
        commissionPct={commissionPct}
        canManageActions={
          role === 'admin' || role === 'operations' || role === 'support'
        }
        onClose={() => setDetailsModalOrder(null)}
        onOrderUpdated={(msg) => {
          setDispatchNotice({ type: 'success', text: msg });
          invalidateSummaryCache();
          loadData();
        }}
      />
    </div>
  );
}
