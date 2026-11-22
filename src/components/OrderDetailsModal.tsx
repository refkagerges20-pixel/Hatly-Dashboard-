import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CreditCard,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Package,
  Phone,
  RefreshCw,
  Send,
  Store,
  Truck,
  User,
  UserCheck,
  X,
  XCircle,
  ZoomIn,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type {
  Courier,
  Customer,
  Merchant,
  Order,
  OrderCourier,
  OrderStatus,
  Zone,
} from '../types/database';
import { triggerAutoDispatch } from '../utils/autoDispatch';
import { syncSingleCourierCashLimit } from '../utils/cashLimits';
import {
  calculateCommissionSplit,
  fetchCourierCommissionPct,
} from '../utils/commissions';
import {
  getOrderDeliveryFeeNet,
  resolveOrderFinancials,
} from '../utils/custody';

interface OrderDetailsModalProps {
  open: boolean;
  order: Order | null;
  commissionPct: number;
  canManageActions: boolean;
  onClose: () => void;
  onOrderUpdated: (message: string) => void;
}

interface JoinedOrderDetails extends Order {
  customers?: Customer | Customer[] | null;
  merchants?: Merchant | Merchant[] | null;
  couriers?: Courier | Courier[] | null;
}

const ORDER_STATUS_META: Record<
  string,
  { label: string; textClass: string }
> = {
  new: { label: 'جديد', textClass: 'text-sky-700' },
  assigned: { label: 'تم التعيين', textClass: 'text-amber-700' },
  picked_up: { label: 'تم الاستلام', textClass: 'text-indigo-700' },
  in_transit: { label: 'قيد التوصيل', textClass: 'text-orange-700' },
  delivered: { label: 'تم التسليم', textClass: 'text-emerald-700' },
  cancelled: { label: 'ملغي', textClass: 'text-[#EF2323]' },
};

const COURIER_STATUS_META: Record<string, { label: string; textClass: string }> = {
  online: { label: 'متصل (Online)', textClass: 'text-emerald-700' },
  offline: { label: 'غير متصل (Offline)', textClass: 'text-slate-500' },
};

const ORDER_SOURCE_LABELS: Record<string, string> = {
  customer_app: 'تطبيق العميل',
  admin: 'لوحة التحكم',
  merchant_portal: 'بوابة التاجر',
  call_center: 'مركز الاتصال',
};

function getOrderSourceLabel(source?: string | null): string {
  if (!source) return 'غير محدد';
  const normalized = String(source).trim();
  if (!normalized) return 'غير محدد';
  return ORDER_SOURCE_LABELS[normalized] || normalized;
}

function unwrapSingle<T>(val: T | T[] | null | undefined): T | null {
  if (!val) return null;
  return Array.isArray(val) ? val[0] ?? null : val;
}

function getZoneName(zone?: Zone | null): string {
  if (!zone) return '';
  return zone.name_ar || zone.name || zone.zone_name || zone.title || '';
}

export function OrderDetailsModal({
  open,
  order,
  commissionPct,
  canManageActions,
  onClose,
  onOrderUpdated,
}: OrderDetailsModalProps) {
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<JoinedOrderDetails | null>(order);
  const [customerData, setCustomerData] = useState<Customer | null>(null);
  const [merchantData, setMerchantData] = useState<Merchant | null>(null);
  const [courierData, setCourierData] = useState<Courier | null>(null);
  const [assignedOrderCouriers, setAssignedOrderCouriers] = useState<
    OrderCourier[]
  >([]);
  const [availableCouriers, setAvailableCouriers] = useState<Courier[]>([]);
  const [zonesMap, setZonesMap] = useState<Map<string, string>>(new Map());
  const [liveCommissionPct, setLiveCommissionPct] =
    useState<number>(commissionPct);

  // Action states
  const [selectedStatus, setSelectedStatus] = useState<OrderStatus>('new');
  const [selectedCourierId, setSelectedCourierId] = useState<string>('');
  const [actionBusy, setActionBusy] = useState<boolean>(false);
  const [actionFeedback, setActionFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Photo lightbox state
  const [lightboxPhoto, setLightboxPhoto] = useState<{
    url: string;
    label: string;
  } | null>(null);
  const [failedPhotoUrls, setFailedPhotoUrls] = useState<Set<string>>(
    () => new Set()
  );

  const loadFullOrderDetails = useCallback(async () => {
    if (!order?.id) return;

    setLoading(true);
    setActionFeedback(null);

    try {
      // Try full joined query first
      const [joinedRes, ocRes, couriersListRes, zonesRes, pct] =
        await Promise.all([
          supabase
            .from('orders')
            .select(
              `
              *,
              customers(*, profiles(full_name, phone, email)),
              merchants(*, profiles(full_name, phone), zones(id, name)),
              couriers(*, profiles(full_name, phone))
            `
            )
            .eq('id', order.id)
            .maybeSingle(),
          supabase
            .from('order_couriers')
            .select('*, couriers(*, profiles(full_name, phone))')
            .eq('order_id', order.id),
          supabase
            .from('couriers')
            .select('*, profiles(full_name, phone)')
            .eq('account_status', 'active')
            .order('active_orders_count', { ascending: true }),
          supabase.from('zones').select('*'),
          fetchCourierCommissionPct(),
        ]);

      setLiveCommissionPct(pct);

      const zMap = new Map<string, string>();
      ((zonesRes.data as Zone[] | null) || []).forEach((z) => {
        const label = getZoneName(z);
        if (label) zMap.set(z.id, label);
      });
      setZonesMap(zMap);

      let loadedCouriers = (couriersListRes.data as Courier[] | null) || [];
      if (couriersListRes.error) {
        const fbCouriers = await supabase
          .from('couriers')
          .select('*')
          .eq('account_status', 'active');
        loadedCouriers = (fbCouriers.data as Courier[] | null) || [];
      }
      setAvailableCouriers(loadedCouriers);

      let loadedOc = (ocRes.data as OrderCourier[] | null) || [];
      if (ocRes.error) {
        const fbOc = await supabase
          .from('order_couriers')
          .select('*')
          .eq('order_id', order.id);
        loadedOc = (fbOc.data as OrderCourier[] | null) || [];
      }
      setAssignedOrderCouriers(loadedOc);

      let fullOrder: JoinedOrderDetails | null =
        (joinedRes.data as JoinedOrderDetails | null) || null;
      let resolvedCustomer = unwrapSingle(fullOrder?.customers);
      let resolvedMerchant = unwrapSingle(fullOrder?.merchants);
      let resolvedCourier = unwrapSingle(fullOrder?.couriers);

      // Fallback to separate queries if joined foreign-key syntax failed
      if (joinedRes.error || !fullOrder) {
        const { data: plainOrder } = await supabase
          .from('orders')
          .select('*')
          .eq('id', order.id)
          .maybeSingle();

        fullOrder = (plainOrder as JoinedOrderDetails | null) || order;

        const [custRes, merchRes, courRes] = await Promise.all([
          fullOrder.customer_id
            ? supabase
                .from('customers')
                .select('*, profiles(full_name, phone, email)')
                .eq('id', fullOrder.customer_id)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          fullOrder.merchant_id
            ? supabase
                .from('merchants')
                .select('*, profiles(full_name, phone)')
                .eq('id', fullOrder.merchant_id)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          fullOrder.courier_id
            ? supabase
                .from('couriers')
                .select('*, profiles(full_name, phone)')
                .eq('id', fullOrder.courier_id)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        ]);

        resolvedCustomer = (custRes.data as Customer | null) || null;
        resolvedMerchant = (merchRes.data as Merchant | null) || null;
        resolvedCourier = (courRes.data as Courier | null) || null;
      }

      setDetails(fullOrder);
      setCustomerData(resolvedCustomer);
      setMerchantData(resolvedMerchant);
      setCourierData(resolvedCourier);
      setSelectedStatus((fullOrder.status as OrderStatus) || 'new');
      setSelectedCourierId(
        fullOrder.courier_id || loadedCouriers[0]?.id || ''
      );
    } catch {
      setDetails(order);
    } finally {
      setLoading(false);
    }
  }, [order]);

  useEffect(() => {
    if (open && order) {
      setDetails(order);
      setSelectedStatus((order.status as OrderStatus) || 'new');
      setSelectedCourierId(order.courier_id || '');
      setLightboxPhoto(null);
      setFailedPhotoUrls(new Set());
      loadFullOrderDetails();
    }
  }, [open, order, loadFullOrderDetails]);

  const activeOrder = details || order;

  const financials = useMemo(() => {
    if (!activeOrder) {
      return {
        productsTotal: 0,
        deliveryFee: 0,
        courierCommission: 0,
        hatlyNetRevenue: 0,
        total: 0,
      };
    }
    const resolved = resolveOrderFinancials(
      activeOrder,
      liveCommissionPct,
      assignedOrderCouriers
    );
    const productsVal =
      Number(activeOrder.products_total || 0) > 0
        ? Number(activeOrder.products_total || 0)
        : Number(activeOrder.amount_to_collect || 0);
    const deliveryTotalVal =
      resolved.deliveryFeeNet + Number(activeOrder.custom_fee || 0);

    return {
      productsTotal: Number(productsVal.toFixed(2)),
      deliveryFee: Number(deliveryTotalVal.toFixed(2)),
      courierCommission: resolved.courierCommission,
      hatlyNetRevenue: resolved.hatlyNetRevenue,
      total: Number(activeOrder.total || 0),
    };
  }, [activeOrder, liveCommissionPct, assignedOrderCouriers]);

  const deliveryPhotos = useMemo(() => {
    if (!activeOrder) return [];
    const candidates = [
      { url: activeOrder.delivery_photo_1, label: 'صورة إثبات التسليم 1' },
      { url: activeOrder.delivery_photo_2, label: 'صورة إثبات التسليم 2' },
      { url: activeOrder.delivery_photo_3, label: 'صورة إثبات التسليم 3' },
    ];
    return candidates.filter(
      (item): item is { url: string; label: string } =>
        Boolean(item.url && String(item.url).trim())
    );
  }, [activeOrder]);

  if (!open || !activeOrder) return null;

  const statusMeta = ORDER_STATUS_META[activeOrder.status] || {
    label: activeOrder.status,
    textClass: 'text-slate-700',
  };
  const orderSourceLabel = getOrderSourceLabel(activeOrder.order_source);

  const customerName =
    activeOrder.customer_name ||
    customerData?.profiles?.full_name ||
    'غير محدد';
  const customerPhone =
    activeOrder.customer_phone || customerData?.profiles?.phone || '—';

  const merchantName =
    activeOrder.service_type === 'brand'
      ? merchantData?.store_name ||
        merchantData?.name ||
        merchantData?.profiles?.full_name ||
        'متجر شريك'
      : 'أوردر مخصوص';

  const merchantZoneName =
    getZoneName(merchantData?.zones) ||
    (merchantData?.zone_id ? zonesMap.get(merchantData.zone_id) : '') ||
    (activeOrder.from_zone_id ? zonesMap.get(activeOrder.from_zone_id) : '') ||
    '';

  const merchantPickupAddress =
    activeOrder.service_type === 'brand'
      ? merchantData?.pickup_address ||
        merchantData?.address ||
        (merchantZoneName ? `منطقة: ${merchantZoneName}` : 'حسب موقع المتجر')
      : merchantZoneName
      ? `استلام من منطقة: ${merchantZoneName}`
      : 'طلب مخصوص';

  const dropoffZoneName = activeOrder.to_zone_id
    ? zonesMap.get(activeOrder.to_zone_id) || ''
    : '';

  const primaryCourier =
    courierData ||
    availableCouriers.find((c) => c.id === activeOrder.courier_id) ||
    assignedOrderCouriers[0]?.couriers ||
    null;

  const primaryCourierName =
    primaryCourier?.profiles?.full_name ||
    (activeOrder.courier_id ? 'مندوب معيّن' : 'غير معيّن');
  const primaryCourierPhone = primaryCourier?.profiles?.phone || '—';
  const courierStatusMeta = primaryCourier
    ? COURIER_STATUS_META[primaryCourier.status] || {
        label: primaryCourier.status,
        textClass: 'text-slate-600',
      }
    : null;

  const updateOrderStatusAction = async (
    nextStatus: OrderStatus,
    extraReason?: string
  ) => {
    setActionBusy(true);
    setActionFeedback(null);

    try {
      const deliveryFeeNet = getOrderDeliveryFeeNet(activeOrder);
      const updatePayload: Record<string, unknown> = { status: nextStatus };

      if (nextStatus === 'delivered') {
        const pct = await fetchCourierCommissionPct();
        const { courierCommission: perCourierCommission } =
          calculateCommissionSplit(deliveryFeeNet, pct);

        if (assignedOrderCouriers.length > 0) {
          for (const row of assignedOrderCouriers) {
            await supabase
              .from('order_couriers')
              .update({
                commission_amount: perCourierCommission,
                status: 'delivered',
              })
              .eq('id', row.id);
          }
          const totalCommissions = Number(
            (perCourierCommission * assignedOrderCouriers.length).toFixed(2)
          );
          updatePayload.courier_commission = totalCommissions;
          updatePayload.hatly_net_revenue = Number(
            (deliveryFeeNet - totalCommissions).toFixed(2)
          );
        } else {
          const count = activeOrder.is_large_order
            ? Math.max(2, Number(activeOrder.required_couriers || 2))
            : 1;
          const totalCommissions = Number(
            (perCourierCommission * count).toFixed(2)
          );
          updatePayload.courier_commission = totalCommissions;
          updatePayload.hatly_net_revenue = Number(
            (deliveryFeeNet - totalCommissions).toFixed(2)
          );
        }
      } else if (nextStatus === 'cancelled') {
        updatePayload.courier_commission = 0;
        updatePayload.hatly_net_revenue = 0;
        if (extraReason) {
          updatePayload.cancel_reason = extraReason;
          updatePayload.cancel_status = 'approved';
        }
        if (assignedOrderCouriers.length > 0) {
          await supabase
            .from('order_couriers')
            .update({ status: 'cancelled', commission_amount: 0 })
            .eq('order_id', activeOrder.id);
        }
      } else if (assignedOrderCouriers.length > 0) {
        await supabase
          .from('order_couriers')
          .update({ status: nextStatus })
          .eq('order_id', activeOrder.id);
      }

      let { error: updateErr } = await supabase
        .from('orders')
        .update(updatePayload)
        .eq('id', activeOrder.id);

      if (
        updateErr &&
        (updateErr.code === '42703' || updateErr.code === 'PGRST204')
      ) {
        const retryRes = await supabase
          .from('orders')
          .update({ status: nextStatus })
          .eq('id', activeOrder.id);
        updateErr = retryRes.error;
      }

      if (updateErr) {
        throw new Error(updateErr.message);
      }

      // Update active_orders_count for assigned couriers when completing/cancelling
      const affectedIds =
        assignedOrderCouriers.length > 0
          ? Array.from(new Set(assignedOrderCouriers.map((r) => r.courier_id)))
          : activeOrder.courier_id
          ? [activeOrder.courier_id]
          : [];

      if (
        (nextStatus === 'delivered' || nextStatus === 'cancelled') &&
        activeOrder.status !== 'delivered' &&
        activeOrder.status !== 'cancelled'
      ) {
        for (const cid of affectedIds) {
          const target = availableCouriers.find((c) => c.id === cid);
          if (target) {
            await supabase
              .from('couriers')
              .update({
                active_orders_count: Math.max(
                  0,
                  (target.active_orders_count || 0) - 1
                ),
              })
              .eq('id', cid);
          }
        }
      }

      if (nextStatus === 'delivered' && affectedIds.length > 0) {
        for (const cid of affectedIds) {
          await syncSingleCourierCashLimit(cid);
        }
      }

      const statusLabel = ORDER_STATUS_META[nextStatus]?.label || nextStatus;
      const msg = `تم تحديث حالة الطلب ${activeOrder.order_number} إلى "${statusLabel}"`;
      setActionFeedback({ type: 'success', text: msg });
      await loadFullOrderDetails();
      onOrderUpdated(msg);
    } catch (err) {
      setActionFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تحديث حالة الطلب',
      });
    } finally {
      setActionBusy(false);
    }
  };

  const handleAutoReassign = async () => {
    setActionBusy(true);
    setActionFeedback(null);
    const result = await triggerAutoDispatch(activeOrder.id, {
      requiredCouriers: activeOrder.is_large_order
        ? Math.max(2, Number(activeOrder.required_couriers || 2))
        : 1,
      deliveryFeeNet: getOrderDeliveryFeeNet(activeOrder),
      paymentMethod: activeOrder.payment_method,
      orderTotal: Number(activeOrder.total || 0),
      rejectedByCouriers: activeOrder.rejected_by_couriers,
      merchantId: activeOrder.merchant_id,
      toZoneId: activeOrder.to_zone_id,
    });
    setActionBusy(false);

    setActionFeedback({
      type: result.assigned ? 'success' : 'error',
      text: result.message,
    });
    await loadFullOrderDetails();
    if (result.assigned || result.merchantInactive) {
      onOrderUpdated(result.message);
    }
  };

  const handleManualReassign = async () => {
    if (!selectedCourierId) {
      setActionFeedback({
        type: 'error',
        text: 'يرجى اختيار مندوب لإعادة تعيين الطلب',
      });
      return;
    }

    setActionBusy(true);
    setActionFeedback(null);

    try {
      const nextStatus: OrderStatus =
        activeOrder.status === 'new' || activeOrder.status === 'cancelled'
          ? 'assigned'
          : (activeOrder.status as OrderStatus);

      const previousCourierId = activeOrder.courier_id;
      const pct = await fetchCourierCommissionPct();
      const { courierCommission } = calculateCommissionSplit(
        getOrderDeliveryFeeNet(activeOrder),
        pct
      );

      const { error: updErr } = await supabase
        .from('orders')
        .update({
          courier_id: selectedCourierId,
          status: nextStatus,
        })
        .eq('id', activeOrder.id);

      if (updErr) throw new Error(updErr.message);

      // Sync order_couriers for single-courier replacement
      if (!activeOrder.is_large_order) {
        if (assignedOrderCouriers.length > 0) {
          await supabase
            .from('order_couriers')
            .update({
              courier_id: selectedCourierId,
              commission_amount: courierCommission,
              status: nextStatus,
            })
            .eq('id', assignedOrderCouriers[0].id);
        } else {
          await supabase.from('order_couriers').insert({
            order_id: activeOrder.id,
            courier_id: selectedCourierId,
            commission_amount: courierCommission,
            cash_collected:
              activeOrder.payment_method === 'cash'
                ? Number(activeOrder.total || 0)
                : 0,
            status: nextStatus,
          });
        }
      }

      if (previousCourierId && previousCourierId !== selectedCourierId) {
        const prevC = availableCouriers.find((c) => c.id === previousCourierId);
        if (prevC) {
          await supabase
            .from('couriers')
            .update({
              active_orders_count: Math.max(
                0,
                (prevC.active_orders_count || 0) - 1
              ),
            })
            .eq('id', prevC.id);
        }
      }

      if (previousCourierId !== selectedCourierId) {
        const newC = availableCouriers.find((c) => c.id === selectedCourierId);
        if (newC) {
          await supabase
            .from('couriers')
            .update({
              active_orders_count: (newC.active_orders_count || 0) + 1,
            })
            .eq('id', newC.id);
        }
      }

      const chosenName =
        availableCouriers.find((c) => c.id === selectedCourierId)?.profiles
          ?.full_name || 'المندوب المختار';
      const msg = `تم تعيين الطلب ${activeOrder.order_number} للمندوب "${chosenName}" بنجاح`;
      setActionFeedback({ type: 'success', text: msg });
      await loadFullOrderDetails();
      onOrderUpdated(msg);
    } catch (err) {
      setActionFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تعيين المندوب',
      });
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#0B1A33]/70 flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl border border-slate-200 w-full max-w-4xl overflow-hidden my-6 flex flex-col max-h-[92vh]"
      >
        {/* Header */}
        <div className="bg-[#0B1A33] text-white px-6 py-4 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-white/10 text-[#FF7B00] flex items-center justify-center shrink-0">
              <Package className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-extrabold truncate">
                  تفاصيل الطلب{' '}
                  <span className="font-mono tabular-nums text-[#FF7B00]">
                    {activeOrder.order_number}
                  </span>
                </h3>
              </div>
              <div className="text-xs text-slate-300 mt-0.5 flex flex-wrap items-center gap-2">
                <span>
                  {new Date(activeOrder.created_at).toLocaleString('ar-EG')}
                </span>
                <span aria-hidden="true">·</span>
                <span>{merchantName}</span>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-white">
                  {statusMeta.label}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={loadFullOrderDetails}
              disabled={loading}
              title="تحديث البيانات"
              className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <RefreshCw
                className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
              />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="إغلاق"
              className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {actionFeedback && (
            <div
              role={actionFeedback.type === 'error' ? 'alert' : 'status'}
              className={`flex items-center gap-2.5 p-3.5 rounded-xl border text-xs font-bold ${
                actionFeedback.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-[#EF2323]'
              }`}
            >
              {actionFeedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0" />
              )}
              <span>{actionFeedback.text}</span>
            </div>
          )}

          {loading && !details ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-500">
              <Loader2 className="w-6 h-6 text-[#FF7B00] animate-spin" />
              <span className="text-sm">جاري تحميل تفاصيل الطلب...</span>
            </div>
          ) : (
            <>
              {/* 1. Order Info & 2. Customer Info */}
              <div className="grid md:grid-cols-2 gap-6">
                {/* Order Info */}
                <section className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/40">
                  <div className="flex items-center gap-2 border-b border-slate-200 pb-2.5">
                    <Package className="w-4 h-4 text-[#FF7B00]" />
                    <h4 className="text-sm font-bold text-[#0B1A33]">
                      معلومات الطلب
                    </h4>
                  </div>

                  <dl className="space-y-2.5 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">رقم الطلب</dt>
                      <dd className="font-mono tabular-nums font-bold text-[#0B1A33]">
                        {activeOrder.order_number}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">التاريخ والوقت</dt>
                      <dd className="font-mono tabular-nums text-slate-700">
                        {new Date(activeOrder.created_at).toLocaleString(
                          'ar-EG'
                        )}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">الحالة</dt>
                      <dd className={`font-bold ${statusMeta.textClass}`}>
                        {statusMeta.label}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">طريقة الدفع</dt>
                      <dd className="font-semibold text-slate-800 inline-flex items-center gap-1">
                        <CreditCard className="w-3.5 h-3.5 text-slate-400" />
                        <span>
                          {activeOrder.payment_method === 'card'
                            ? 'بطاقة بنكية'
                            : 'كاش عند الاستلام'}
                        </span>
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">حالة الدفع</dt>
                      <dd
                        className={`font-bold ${
                          activeOrder.payment_status === 'paid'
                            ? 'text-emerald-700'
                            : 'text-amber-700'
                        }`}
                      >
                        {activeOrder.payment_status === 'paid'
                          ? 'مدفوع'
                          : 'غير مدفوع'}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">مصدر الطلب</dt>
                      <dd className="font-bold text-[#0B1A33]">
                        {orderSourceLabel}
                      </dd>
                    </div>
                    {activeOrder.cancel_reason && (
                      <div className="pt-2 border-t border-slate-200 flex items-start justify-between gap-3">
                        <dt className="text-slate-500 shrink-0">سبب الإلغاء</dt>
                        <dd className="font-semibold text-[#EF2323] text-left">
                          {activeOrder.cancel_reason}
                        </dd>
                      </div>
                    )}
                  </dl>
                </section>

                {/* Customer Info */}
                <section className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/40">
                  <div className="flex items-center gap-2 border-b border-slate-200 pb-2.5">
                    <User className="w-4 h-4 text-[#FF7B00]" />
                    <h4 className="text-sm font-bold text-[#0B1A33]">
                      بيانات العميل
                    </h4>
                  </div>

                  <dl className="space-y-2.5 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">الاسم</dt>
                      <dd className="font-bold text-[#0B1A33]">{customerName}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">رقم الهاتف</dt>
                      <dd
                        className="font-mono tabular-nums font-semibold text-slate-800 inline-flex items-center gap-1"
                        dir="ltr"
                      >
                        <Phone className="w-3.5 h-3.5 text-slate-400" />
                        <span>{customerPhone}</span>
                      </dd>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <dt className="text-slate-500 shrink-0">عنوان التوصيل</dt>
                      <dd className="font-medium text-slate-800 text-left">
                        {activeOrder.delivery_address || '—'}
                        {dropoffZoneName && (
                          <span className="block text-[11px] text-slate-500 mt-0.5">
                            المنطقة: {dropoffZoneName}
                          </span>
                        )}
                      </dd>
                    </div>
                    {activeOrder.customer_notes && (
                      <div className="pt-2 border-t border-slate-200 flex items-start justify-between gap-3">
                        <dt className="text-slate-500 shrink-0">ملاحظات</dt>
                        <dd className="text-slate-700 text-left">
                          {activeOrder.customer_notes}
                        </dd>
                      </div>
                    )}
                  </dl>
                </section>

                {/* 3. Merchant Info */}
                <section className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/40">
                  <div className="flex items-center gap-2 border-b border-slate-200 pb-2.5">
                    <Store className="w-4 h-4 text-[#FF7B00]" />
                    <h4 className="text-sm font-bold text-[#0B1A33]">
                      بيانات التاجر
                    </h4>
                  </div>

                  <dl className="space-y-2.5 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">اسم المتجر</dt>
                      <dd className="font-bold text-[#0B1A33]">{merchantName}</dd>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <dt className="text-slate-500 shrink-0">عنوان الاستلام</dt>
                      <dd className="font-medium text-slate-800 text-left inline-flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>{merchantPickupAddress}</span>
                      </dd>
                    </div>
                    {(merchantData?.phone ||
                      merchantData?.profiles?.phone ||
                      activeOrder.pickup_phone) && (
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-slate-500">هاتف الاستلام</dt>
                        <dd
                          className="font-mono tabular-nums text-slate-700"
                          dir="ltr"
                        >
                          {activeOrder.pickup_phone ||
                            merchantData?.profiles?.phone ||
                            merchantData?.phone}
                        </dd>
                      </div>
                    )}
                  </dl>
                </section>

                {/* 4. Courier Info */}
                <section className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/40">
                  <div className="flex items-center gap-2 border-b border-slate-200 pb-2.5">
                    <Truck className="w-4 h-4 text-[#FF7B00]" />
                    <h4 className="text-sm font-bold text-[#0B1A33]">
                      بيانات المندوب
                    </h4>
                  </div>

                  {assignedOrderCouriers.length > 1 ? (
                    <div className="space-y-2 text-xs">
                      {assignedOrderCouriers.map((oc) => {
                        const c =
                          oc.couriers ||
                          availableCouriers.find((x) => x.id === oc.courier_id);
                        const cStatus = c
                          ? COURIER_STATUS_META[c.status] || {
                              label: c.status,
                              textClass: 'text-slate-600',
                            }
                          : null;
                        return (
                          <div
                            key={oc.id}
                            className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200 last:border-b-0 last:pb-0"
                          >
                            <div>
                              <div className="font-bold text-[#0B1A33]">
                                {c?.profiles?.full_name || 'مندوب'}
                              </div>
                              <div
                                className="font-mono tabular-nums text-slate-500"
                                dir="ltr"
                              >
                                {c?.profiles?.phone || '—'}
                              </div>
                            </div>
                            <div className="text-left">
                              {cStatus && (
                                <div className={`font-semibold ${cStatus.textClass}`}>
                                  {cStatus.label}
                                </div>
                              )}
                              <div className="font-mono tabular-nums text-emerald-700 font-bold">
                                عمولة: {Number(oc.commission_amount || 0).toFixed(2)} ج.م
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <dl className="space-y-2.5 text-xs">
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-slate-500">اسم المندوب</dt>
                        <dd className="font-bold text-[#0B1A33]">
                          {primaryCourierName}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-slate-500">رقم الهاتف</dt>
                        <dd
                          className="font-mono tabular-nums font-semibold text-slate-800"
                          dir="ltr"
                        >
                          {primaryCourierPhone}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-slate-500">الحالة الحالية</dt>
                        <dd
                          className={`font-bold ${
                            courierStatusMeta?.textClass || 'text-slate-500'
                          }`}
                        >
                          {courierStatusMeta?.label || 'غير معيّن بعد'}
                        </dd>
                      </div>
                    </dl>
                  )}
                </section>
              </div>

              {/* 5. Financial Details */}
              <section className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                  <h4 className="text-sm font-bold text-[#0B1A33]">
                    التفاصيل المالية
                  </h4>
                  {Number(activeOrder.partner_discount || 0) > 0 && (
                    <span className="text-xs text-emerald-700 font-semibold font-mono tabular-nums">
                      خصم شريك مطبّق: {Number(activeOrder.partner_discount).toFixed(2)} ج.م
                    </span>
                  )}
                </div>

                <div className="divide-y divide-slate-100 text-sm">
                  <div className="px-4 py-2.5 flex items-center justify-between">
                    <span className="text-slate-600">قيمة المنتجات</span>
                    <span className="font-mono tabular-nums font-bold text-[#0B1A33]">
                      {financials.productsTotal.toFixed(2)} ج.م
                    </span>
                  </div>
                  <div className="px-4 py-2.5 flex items-center justify-between">
                    <span className="text-slate-600">رسوم التوصيل</span>
                    <span className="font-mono tabular-nums font-bold text-[#0B1A33]">
                      {financials.deliveryFee.toFixed(2)} ج.م
                    </span>
                  </div>
                  <div className="px-4 py-2.5 flex items-center justify-between">
                    <span className="text-slate-600">عمولة المندوب</span>
                    <span className="font-mono tabular-nums font-bold text-emerald-700">
                      {financials.courierCommission.toFixed(2)} ج.م
                    </span>
                  </div>
                  <div className="px-4 py-2.5 flex items-center justify-between">
                    <span className="text-slate-600">إيراد الشركة (هاتلي)</span>
                    <span
                      className={`font-mono tabular-nums font-bold ${
                        financials.hatlyNetRevenue >= 0
                          ? 'text-[#0B1A33]'
                          : 'text-[#EF2323]'
                      }`}
                    >
                      {financials.hatlyNetRevenue.toFixed(2)} ج.م
                    </span>
                  </div>
                  <div className="px-4 py-3 bg-[#0B1A33] text-white flex items-center justify-between font-extrabold">
                    <span>الإجمالي</span>
                    <span className="font-mono tabular-nums text-base text-[#FF7B00]">
                      {financials.total.toFixed(2)} ج.م
                    </span>
                  </div>
                </div>
              </section>

              {/* 6. Delivery Proof Photos */}
              <section className="border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                  <div className="flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 text-[#FF7B00]" />
                    <h4 className="text-sm font-bold text-[#0B1A33]">
                      صور إثبات التسليم
                    </h4>
                  </div>
                  <span className="text-xs text-slate-500 font-mono tabular-nums">
                    {deliveryPhotos.length} / 3
                  </span>
                </div>

                {deliveryPhotos.length === 0 ? (
                  <p className="text-xs text-slate-400 py-2">
                    لا توجد صور إثبات تسليم مرفقة لهذا الطلب حتى الآن.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {deliveryPhotos.map((photo) => {
                      const hasFailed = failedPhotoUrls.has(photo.url);
                      return (
                        <button
                          key={photo.label}
                          type="button"
                          onClick={() => !hasFailed && setLightboxPhoto(photo)}
                          disabled={hasFailed}
                          className="group relative rounded-xl overflow-hidden border border-slate-200 bg-slate-100 aspect-[4/3] cursor-pointer text-right disabled:cursor-default"
                        >
                          {hasFailed ? (
                            <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-slate-400 p-3">
                              <ImageIcon className="w-6 h-6" />
                              <span className="text-xs font-semibold text-slate-500">
                                تعذر تحميل {photo.label}
                              </span>
                            </div>
                          ) : (
                            <>
                              <img
                                src={photo.url}
                                alt={photo.label}
                                referrerPolicy="no-referrer"
                                onError={() =>
                                  setFailedPhotoUrls((prev) => {
                                    const next = new Set(prev);
                                    next.add(photo.url);
                                    return next;
                                  })
                                }
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                              />
                              <div className="absolute inset-0 bg-gradient-to-t from-[#0B1A33]/75 via-transparent to-transparent flex items-end justify-between p-2.5">
                                <span className="text-xs font-bold text-white">
                                  {photo.label}
                                </span>
                                <ZoomIn className="w-4 h-4 text-white shrink-0" />
                              </div>
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* 7. Admin Action Controls */}
              {canManageActions && (
                <section className="border border-slate-200 rounded-xl p-4 space-y-4 bg-slate-50/60">
                  <h4 className="text-sm font-bold text-[#0B1A33] border-b border-slate-200 pb-2.5">
                    إجراءات الإدارة السريعة
                  </h4>

                  <div className="grid lg:grid-cols-2 gap-4">
                    {/* Status Change Controls */}
                    <div className="space-y-2.5">
                      <label
                        htmlFor="modal-order-status-select"
                        className="block text-xs font-semibold text-slate-700"
                      >
                        تغيير حالة الطلب
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          id="modal-order-status-select"
                          value={selectedStatus}
                          disabled={actionBusy}
                          onChange={(e) =>
                            setSelectedStatus(e.target.value as OrderStatus)
                          }
                          className="flex-1 min-w-[140px] px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-bold text-[#0B1A33]"
                        >
                          <option value="new">جديد</option>
                          <option value="assigned">تم التعيين</option>
                          <option value="picked_up">تم الاستلام</option>
                          <option value="in_transit">قيد التوصيل</option>
                          <option value="delivered">تم التسليم</option>
                          <option value="cancelled">ملغي</option>
                        </select>
                        <button
                          type="button"
                          disabled={
                            actionBusy || selectedStatus === activeOrder.status
                          }
                          onClick={() => updateOrderStatusAction(selectedStatus)}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0B1A33] hover:bg-[#14284B] disabled:opacity-50 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
                        >
                          {actionBusy ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5 text-[#FF7B00]" />
                          )}
                          <span>حفظ الحالة</span>
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {activeOrder.status !== 'delivered' &&
                          activeOrder.status !== 'cancelled' && (
                            <button
                              type="button"
                              disabled={actionBusy}
                              onClick={() =>
                                updateOrderStatusAction(
                                  activeOrder.status === 'new'
                                    ? 'assigned'
                                    : 'delivered'
                                )
                              }
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#FF7B00] hover:bg-[#E56E00] disabled:opacity-50 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>
                                {activeOrder.status === 'new'
                                  ? 'تأكيد الطلب'
                                  : 'تأكيد التسليم'}
                              </span>
                            </button>
                          )}

                        {activeOrder.status !== 'cancelled' &&
                          activeOrder.status !== 'delivered' && (
                            <button
                              type="button"
                              disabled={actionBusy}
                              onClick={() =>
                                updateOrderStatusAction(
                                  'cancelled',
                                  'تم الإلغاء من الإدارة'
                                )
                              }
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#EF2323] hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              <span>إلغاء الطلب</span>
                            </button>
                          )}
                      </div>
                    </div>

                    {/* Re-assign Courier Controls */}
                    <div className="space-y-2.5">
                      <label
                        htmlFor="modal-reassign-courier-select"
                        className="block text-xs font-semibold text-slate-700"
                      >
                        إعادة تعيين المندوب
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          id="modal-reassign-courier-select"
                          value={selectedCourierId}
                          disabled={actionBusy || availableCouriers.length === 0}
                          onChange={(e) => setSelectedCourierId(e.target.value)}
                          className="flex-1 min-w-[160px] px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-[#0B1A33]"
                        >
                          {availableCouriers.length === 0 ? (
                            <option value="">لا يوجد مناديب نشطون</option>
                          ) : (
                            availableCouriers.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.profiles?.full_name || 'مندوب'} (
                                {c.status === 'online' ? 'متصل' : 'غير متصل'})
                              </option>
                            ))
                          )}
                        </select>
                        <button
                          type="button"
                          disabled={actionBusy || !selectedCourierId}
                          onClick={handleManualReassign}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[#0B1A33] bg-white hover:bg-slate-50 disabled:opacity-50 text-[#0B1A33] text-xs font-bold cursor-pointer whitespace-nowrap"
                        >
                          <UserCheck className="w-3.5 h-3.5 text-[#FF7B00]" />
                          <span>تعيين المندوب</span>
                        </button>
                      </div>

                      <div className="pt-1">
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={handleAutoReassign}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0B1A33] hover:bg-[#14284B] disabled:opacity-50 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
                        >
                          <Send className="w-3.5 h-3.5 text-[#FF7B00]" />
                          <span>توزيع تلقائي للمندوب المتاح</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-xs font-bold text-[#0B1A33] cursor-pointer"
          >
            إغلاق
          </button>
        </div>
      </div>

      {/* Full-size Photo Lightbox */}
      {lightboxPhoto && (
        <div
          className="fixed inset-0 z-[60] bg-[#0B1A33]/90 flex items-center justify-center p-4"
          onClick={(e) => {
            e.stopPropagation();
            setLightboxPhoto(null);
          }}
        >
          <div
            dir="rtl"
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl border border-slate-200 w-full max-w-3xl overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <h5 className="text-sm font-bold text-[#0B1A33]">
                {lightboxPhoto.label} — {activeOrder.order_number}
              </h5>
              <button
                type="button"
                onClick={() => setLightboxPhoto(null)}
                aria-label="إغلاق الصورة"
                className="p-1.5 rounded-lg text-slate-400 hover:text-[#0B1A33] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="bg-black max-h-[80vh] flex items-center justify-center">
              <img
                src={lightboxPhoto.url}
                alt={lightboxPhoto.label}
                referrerPolicy="no-referrer"
                className="max-h-[80vh] w-full object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
