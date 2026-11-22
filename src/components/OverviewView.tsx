import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Award,
  Banknote,
  Bike,
  ClipboardList,
  ExternalLink,
  Loader2,
  Plus,
  Receipt,
  RefreshCw,
  Store,
  Wallet,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type {
  Courier,
  CourierDeposit,
  DashboardSection,
  Merchant,
  MerchantSettlement,
  Order,
  OrderCourier,
} from '../types/database';
import { fetchCourierCommissionPct } from '../utils/commissions';
import {
  groupOrderCouriersByOrder,
  isOrderDelivered,
  matchesCourier,
  resolveOrderFinancials,
} from '../utils/custody';
import {
  SUMMARY_CACHE_TTL_MS,
  getCachedSummary,
  invalidateSummaryCache,
  setCachedSummary,
} from '../utils/summaryCache';
import { useOrdersRealtime } from '../utils/useOrdersRealtime';
import type { DayChartPoint, HourChartPoint } from './OverviewCharts';

const LazyOverviewCharts = lazy(() => import('./OverviewCharts'));

interface OverviewViewProps {
  onNavigate: (section: DashboardSection) => void;
}

const ARABIC_DAYS = [
  'الأحد',
  'الإثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
] as const;

const OVERVIEW_CACHE_KEY = 'overview_dashboard_summary_v2';

interface TopCourierEntry {
  courierId: string;
  name: string;
  phone: string;
  deliveredCount: number;
}

interface RecentDepositEntry {
  id: string;
  courierId: string;
  courierName: string;
  amount: number;
  notes: string | null;
  receiptUrl: string | null;
  createdAt: string;
}

interface OverviewSummaryPayload {
  totalOrdersCount: number;
  unassignedOrdersCount: number;
  totalDeliveredOrders: number;
  totalRevenue: number;
  totalCourierDeposits: number;
  totalDepositsCount: number;
  totalMerchantSettlementsPaid: number;
  availableMerchantCashBalance: number;
  onlineCouriersCount: number;
  totalCouriersCount: number;
  activeMerchantsCount: number;
  pendingApprovalMerchantsCount: number;
  weeklyOrdersData: DayChartPoint[];
  hourlyOrdersData: HourChartPoint[];
  peakWindowText: string;
  peakHourCount: number;
  totalOrdersAnalyzed: number;
  topCouriersThisMonth: TopCourierEntry[];
  currentMonthLabel: string;
  recentOrders: Pick<
    Order,
    'id' | 'order_number' | 'customer_name' | 'service_type' | 'total' | 'status'
  >[];
  recentDeposits: RecentDepositEntry[];
  depositsWarning: string | null;
}

function padHour(h: number): string {
  return `${String(((h % 24) + 24) % 24).padStart(2, '0')}:00`;
}

function getCourierInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'م';
  if (parts.length === 1) return parts[0].slice(0, 2);
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`;
}

function ChartsLoadingSkeleton() {
  return (
    <>
      <section className="lg:col-span-6 xl:col-span-4 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
        <div className="space-y-2 mb-4">
          <div className="h-4 w-44 bg-slate-200 rounded animate-pulse" />
          <div className="h-3 w-32 bg-slate-100 rounded animate-pulse" />
        </div>
        <div className="h-[230px] w-full rounded-lg bg-slate-100 animate-pulse" />
      </section>
      <section className="lg:col-span-6 xl:col-span-5 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
        <div className="space-y-2 mb-4">
          <div className="h-4 w-48 bg-slate-200 rounded animate-pulse" />
          <div className="h-3 w-36 bg-slate-100 rounded animate-pulse" />
        </div>
        <div className="h-[230px] w-full rounded-lg bg-slate-100 animate-pulse" />
      </section>
    </>
  );
}

export function OverviewView({ onNavigate }: OverviewViewProps) {
  const [summary, setSummary] = useState<OverviewSummaryPayload | null>(null);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lazy load Recharts only when the charts area is actually visible in the viewport & tab
  const chartsContainerRef = useRef<HTMLDivElement | null>(null);
  const [chartsVisible, setChartsVisible] = useState<boolean>(() => {
    if (typeof document === 'undefined') return false;
    return document.visibilityState === 'visible';
  });

  useEffect(() => {
    if (chartsVisible) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setChartsVisible(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    const el = chartsContainerRef.current;
    let observer: IntersectionObserver | null = null;
    if (el && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => {
          if (
            entries.some((entry) => entry.isIntersecting) &&
            document.visibilityState === 'visible'
          ) {
            setChartsVisible(true);
            observer?.disconnect();
          }
        },
        { threshold: 0.05 }
      );
      observer.observe(el);
    } else if (document.visibilityState === 'visible') {
      setChartsVisible(true);
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      observer?.disconnect();
    };
  }, [chartsVisible, summary]);

  const loadDashboard = useCallback(async (forceRefresh = false) => {
    setError(null);

    if (!forceRefresh) {
      const cached = getCachedSummary<OverviewSummaryPayload>(
        OVERVIEW_CACHE_KEY,
        SUMMARY_CACHE_TTL_MS
      );
      if (cached) {
        setSummary(cached.data);
        setCachedAt(cached.cachedAt);
        setLoading(false);
        setRefreshing(false);
        return;
      }
    }

    if (forceRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    // Fetch minimal columns needed for summary cards, charts, & courier deposits
    const [oRes, cRes, ocRes, mRes, depositsRes, settlementsRes, pct] =
      await Promise.all([
        supabase
          .from('orders')
          .select(
            'id, order_number, customer_name, service_type, total, delivery_fee_net, custom_fee, courier_commission, hatly_net_revenue, status, courier_id, created_at'
          )
          .order('created_at', { ascending: false }),
        supabase
          .from('couriers')
          .select('id, profile_id, status, profiles(full_name, phone)')
          .order('created_at', { ascending: false }),
        supabase
          .from('order_couriers')
          .select('order_id, courier_id, commission_amount, cash_collected, status'),
        supabase.from('merchants').select('id, account_status'),
        supabase
          .from('courier_deposits')
          .select('id, courier_id, amount, notes, receipt_url, created_at')
          .order('created_at', { ascending: false }),
        supabase.from('merchant_settlements').select('id, amount'),
        fetchCourierCommissionPct(),
      ]);

    if (oRes.error) {
      setError(`تعذر تحميل بيانات الطلبات: ${oRes.error.message}`);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const orders = (oRes.data as Order[]) || [];
    let couriers: Courier[] = [];
    if (!cRes.error && cRes.data) {
      couriers = cRes.data as unknown as Courier[];
    } else {
      const fb = await supabase.from('couriers').select('id, profile_id, status');
      couriers = (fb.data as unknown as Courier[]) || [];
    }
    const orderCouriers = (ocRes.data as OrderCourier[]) || [];
    const merchants = (mRes.data as Merchant[]) || [];

    let depositsWarning: string | null = null;
    let deposits: CourierDeposit[] = [];
    if (depositsRes.error) {
      console.log('[Overview] courier_deposits fetch error:', depositsRes.error);
      depositsWarning = `تعذر قراءة توريدات المناديب (courier_deposits): ${depositsRes.error.message}`;
    } else {
      deposits = (depositsRes.data as CourierDeposit[]) || [];
    }

    const settlements =
      !settlementsRes.error && settlementsRes.data
        ? (settlementsRes.data as Pick<MerchantSettlement, 'id' | 'amount'>[])
        : [];

    const courierNameMap = new Map<string, string>();
    for (const courier of couriers) {
      const name = courier.profiles?.full_name || 'مندوب هاتلي';
      courierNameMap.set(courier.id, name);
      if (courier.profile_id) {
        courierNameMap.set(courier.profile_id, name);
      }
    }

    const totalCourierDeposits = Number(
      deposits.reduce((sum, d) => sum + Number(d.amount || 0), 0).toFixed(2)
    );
    const totalMerchantSettlementsPaid = Number(
      settlements.reduce((sum, s) => sum + Number(s.amount || 0), 0).toFixed(2)
    );
    const availableMerchantCashBalance = Number(
      (totalCourierDeposits - totalMerchantSettlementsPaid).toFixed(2)
    );

    const byOrder = groupOrderCouriersByOrder(orderCouriers);

    // 1. Weekly Delivered Orders & Revenue
    const dayCounts = new Array<number>(7).fill(0);
    const hourCounts = new Array<number>(24).fill(0);
    let totalAnalyzed = 0;
    let totalDeliveredOrders = 0;
    let totalRevenue = 0;
    let unassignedOrdersCount = 0;

    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth();
    const currentMonthLabel = now.toLocaleDateString('ar-EG', {
      month: 'long',
      year: 'numeric',
    });
    const countsByCourierId = new Map<string, number>();

    for (const order of orders) {
      const statusNorm = String(order.status || '').trim().toLowerCase();
      if (statusNorm === 'new') {
        unassignedOrdersCount += 1;
      }

      const d = new Date(order.created_at);
      const validDate = !Number.isNaN(d.getTime());

      if (statusNorm !== 'cancelled' && validDate) {
        hourCounts[d.getHours()] += 1;
        totalAnalyzed += 1;
      }

      if (isOrderDelivered(order.status)) {
        totalDeliveredOrders += 1;
        const { hatlyNetRevenue } = resolveOrderFinancials(
          order,
          pct,
          byOrder.get(order.id) || []
        );
        totalRevenue += hatlyNetRevenue;

        if (validDate) {
          dayCounts[d.getDay()] += 1;

          if (d.getFullYear() === curYear && d.getMonth() === curMonth) {
            const assignedRows = byOrder.get(order.id) || [];
            if (assignedRows.length > 0) {
              for (const courier of couriers) {
                if (assignedRows.some((r) => matchesCourier(r.courier_id, courier))) {
                  countsByCourierId.set(
                    courier.id,
                    (countsByCourierId.get(courier.id) || 0) + 1
                  );
                }
              }
            } else if (order.courier_id) {
              for (const courier of couriers) {
                if (matchesCourier(order.courier_id, courier)) {
                  countsByCourierId.set(
                    courier.id,
                    (countsByCourierId.get(courier.id) || 0) + 1
                  );
                }
              }
            }
          }
        }
      }
    }

    const weeklyOrdersData: DayChartPoint[] = ARABIC_DAYS.map((dayName, dayIndex) => ({
      dayIndex,
      dayName,
      ordersCount: dayCounts[dayIndex],
    }));

    const hourlyOrdersData: HourChartPoint[] = hourCounts.map((count, hour) => ({
      hour,
      hourLabel: padHour(hour),
      ordersCount: count,
    }));

    let maxHour = 0;
    let peakHourCount = 0;
    for (let h = 0; h < 24; h += 1) {
      if (hourCounts[h] > peakHourCount) {
        peakHourCount = hourCounts[h];
        maxHour = h;
      }
    }

    let peakWindowText = 'لا توجد طلبات كافية بعد';
    if (peakHourCount > 0) {
      const prevCount = hourCounts[(maxHour + 23) % 24];
      const nextCount = hourCounts[(maxHour + 1) % 24];
      const startHour = prevCount > nextCount ? (maxHour + 23) % 24 : maxHour;
      const endHour = (startHour + 2) % 24;
      peakWindowText = `وقت الذروة: من ${padHour(startHour)} إلى ${padHour(endHour)}`;
    }

    const topCouriersThisMonth: TopCourierEntry[] = couriers
      .map((courier) => ({
        courierId: courier.id,
        name: courier.profiles?.full_name || 'مندوب هاتلي',
        phone: courier.profiles?.phone || '—',
        deliveredCount: countsByCourierId.get(courier.id) || 0,
      }))
      .filter((entry) => entry.deliveredCount > 0)
      .sort((a, b) => b.deliveredCount - a.deliveredCount);

    const payload: OverviewSummaryPayload = {
      totalOrdersCount: orders.length,
      unassignedOrdersCount,
      totalDeliveredOrders,
      totalRevenue: Number(totalRevenue.toFixed(2)),
      totalCourierDeposits,
      totalDepositsCount: deposits.length,
      totalMerchantSettlementsPaid,
      availableMerchantCashBalance,
      onlineCouriersCount: couriers.filter((c) => c.status === 'online').length,
      totalCouriersCount: couriers.length,
      activeMerchantsCount: merchants.filter((m) => m.account_status === 'active')
        .length,
      pendingApprovalMerchantsCount: merchants.filter(
        (m) => m.account_status === 'pending_approval'
      ).length,
      weeklyOrdersData,
      hourlyOrdersData,
      peakWindowText,
      peakHourCount,
      totalOrdersAnalyzed: totalAnalyzed,
      topCouriersThisMonth,
      currentMonthLabel,
      recentOrders: orders.slice(0, 6).map((o) => ({
        id: o.id,
        order_number: o.order_number,
        customer_name: o.customer_name,
        service_type: o.service_type,
        total: o.total,
        status: o.status,
      })),
      recentDeposits: deposits.slice(0, 8).map((d) => ({
        id: d.id,
        courierId: d.courier_id,
        courierName: courierNameMap.get(d.courier_id) || d.courier_id,
        amount: Number(d.amount || 0),
        notes: d.notes ?? null,
        receiptUrl: d.receipt_url ?? null,
        createdAt: d.created_at,
      })),
      depositsWarning,
    };

    const ts = setCachedSummary(OVERVIEW_CACHE_KEY, payload);
    setSummary(payload);
    setCachedAt(ts);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    loadDashboard(false);
  }, [loadDashboard]);

  const realtimeDebounceRef = useRef<number | undefined>(undefined);

  useOrdersRealtime('overview-orders', (payload) => {
    invalidateSummaryCache();

    // Instant optimistic update for recentOrders & order counts before background reload finishes
    setSummary((prev) => {
      if (!prev) return prev;
      if (payload.eventType === 'INSERT' && payload.new) {
        const created = payload.new;
        const alreadyExists = prev.recentOrders.some((o) => o.id === created.id);
        const nextRecent = alreadyExists
          ? prev.recentOrders
          : [
              {
                id: created.id,
                order_number: created.order_number,
                customer_name: created.customer_name,
                service_type: created.service_type,
                total: created.total,
                status: created.status,
              },
              ...prev.recentOrders,
            ].slice(0, 6);
        const isNew =
          String(created.status || '').trim().toLowerCase() === 'new';
        return {
          ...prev,
          totalOrdersCount: alreadyExists
            ? prev.totalOrdersCount
            : prev.totalOrdersCount + 1,
          unassignedOrdersCount:
            !alreadyExists && isNew
              ? prev.unassignedOrdersCount + 1
              : prev.unassignedOrdersCount,
          recentOrders: nextRecent,
        };
      }

      if (payload.eventType === 'UPDATE' && payload.new) {
        const updated = payload.new;
        return {
          ...prev,
          recentOrders: prev.recentOrders.map((o) =>
            o.id === updated.id
              ? {
                  ...o,
                  order_number: updated.order_number ?? o.order_number,
                  customer_name: updated.customer_name ?? o.customer_name,
                  service_type: updated.service_type ?? o.service_type,
                  total: updated.total ?? o.total,
                  status: updated.status ?? o.status,
                }
              : o
          ),
        };
      }

      if (payload.eventType === 'DELETE' && payload.old?.id) {
        const removedId = payload.old.id;
        return {
          ...prev,
          totalOrdersCount: Math.max(0, prev.totalOrdersCount - 1),
          recentOrders: prev.recentOrders.filter((o) => o.id !== removedId),
        };
      }

      return prev;
    });

    if (realtimeDebounceRef.current) {
      window.clearTimeout(realtimeDebounceRef.current);
    }
    realtimeDebounceRef.current = window.setTimeout(() => {
      loadDashboard(true);
    }, 250);
  });

  useEffect(() => {
    const scheduleFinancialReload = () => {
      invalidateSummaryCache();
      if (realtimeDebounceRef.current) {
        window.clearTimeout(realtimeDebounceRef.current);
      }
      realtimeDebounceRef.current = window.setTimeout(() => {
        loadDashboard(true);
      }, 250);
    };

    const channel = supabase
      .channel('overview-deposits-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'courier_deposits' },
        scheduleFinancialReload
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'merchant_settlements' },
        scheduleFinancialReload
      )
      .subscribe();

    return () => {
      if (realtimeDebounceRef.current) {
        window.clearTimeout(realtimeDebounceRef.current);
      }
      supabase.removeChannel(channel);
    };
  }, [loadDashboard]);

  if (loading && !summary) {
    return (
      <div className="p-12 flex flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="w-6 h-6 text-[#FF7F00] animate-spin" />
        <span className="text-sm">جاري تحميل تحليلات لوحة التحكم...</span>
      </div>
    );
  }

  const data = summary || {
    totalOrdersCount: 0,
    unassignedOrdersCount: 0,
    totalDeliveredOrders: 0,
    totalRevenue: 0,
    totalCourierDeposits: 0,
    totalDepositsCount: 0,
    totalMerchantSettlementsPaid: 0,
    availableMerchantCashBalance: 0,
    onlineCouriersCount: 0,
    totalCouriersCount: 0,
    activeMerchantsCount: 0,
    pendingApprovalMerchantsCount: 0,
    weeklyOrdersData: [],
    hourlyOrdersData: [],
    peakWindowText: 'لا توجد طلبات كافية بعد',
    peakHourCount: 0,
    totalOrdersAnalyzed: 0,
    topCouriersThisMonth: [],
    currentMonthLabel: '',
    recentOrders: [],
    recentDeposits: [],
    depositsWarning: null,
  };

  const topCourier = data.topCouriersThisMonth[0] || null;

  return (
    <div dir="rtl" className="space-y-6">
      {error && (
        <div className="flex items-center justify-between gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-semibold">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => loadDashboard(true)}
            className="underline font-bold cursor-pointer"
          >
            إعادة المحاولة
          </button>
        </div>
      )}

      {/* Top Action & Cache Status Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-slate-500">
          {cachedAt ? (
            <span>
              آخر تحديث:{' '}
              <span className="font-mono tabular-nums text-[#0B1A33] font-semibold">
                {new Date(cachedAt).toLocaleTimeString('ar-EG')}
              </span>
              <span className="mx-1.5" aria-hidden="true">
                ·
              </span>
              <span>تحديث فوري مباشر (Realtime)</span>
            </span>
          ) : (
            <span>ملخص العمليات المباشر</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={refreshing}
            onClick={() => loadDashboard(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>تحديث الآن</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('new-order')}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#FF7B00] hover:bg-[#E57000] text-white text-xs font-bold cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>إضافة طلب جديد</span>
          </button>
        </div>
      </div>

      {/* KPI Summary Cards (Cached for 5 minutes) */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>إجمالي الطلبات</span>
            <ClipboardList className="w-4 h-4 text-[#FF7F00]" />
          </div>
          <div className="text-2xl font-extrabold text-[#0B1A33] font-mono tabular-nums mt-2">
            {data.totalOrdersCount}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {data.unassignedOrdersCount > 0
              ? `${data.unassignedOrdersCount} طلب بانتظار التعيين`
              : 'كل الطلبات موزعة'}
          </div>
        </div>

        <div className="bg-[#0B1A33] text-white rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
            <span>إيرادات هاتلي (صافي التوصيل)</span>
            <Wallet className="w-4 h-4 text-[#FF7F00]" />
          </div>
          <div className="text-2xl font-extrabold text-[#FF7F00] font-mono tabular-nums mt-2">
            {data.totalRevenue.toFixed(2)} ج.م
          </div>
          <div className="text-xs text-slate-300 mt-1 font-mono tabular-nums">
            من {data.totalDeliveredOrders} طلب مُسلّم
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>المناديب المتصلون</span>
            <Bike className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-extrabold text-[#0B1A33] font-mono tabular-nums mt-2">
            {data.onlineCouriersCount} / {data.totalCouriersCount}
          </div>
          <div className="text-xs text-slate-500 mt-1">متاحون للتوزيع التلقائي</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>المتاجر النشطة</span>
            <Store className="w-4 h-4 text-[#0B1A33]" />
          </div>
          <div className="text-2xl font-extrabold text-[#0B1A33] font-mono tabular-nums mt-2">
            {data.activeMerchantsCount}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {data.pendingApprovalMerchantsCount > 0
              ? `${data.pendingApprovalMerchantsCount} متجر بانتظار الاعتماد`
              : 'لا توجد طلبات اعتماد معلقة'}
          </div>
        </div>
      </div>

      {/* Treasury & Courier Cash Deposits Cards */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-900">
              <Banknote className="w-4 h-4 text-emerald-700" />
              <span>إجمالي الكاش المحصل من المندوبين</span>
            </div>
            <div className="text-2xl font-extrabold text-emerald-700 font-mono tabular-nums mt-2">
              {data.totalCourierDeposits.toFixed(2)} ج.م
            </div>
            <div className="text-xs text-emerald-800/80 mt-1 font-mono tabular-nums">
              من {data.totalDepositsCount} عملية توريد مسجلة (courier_deposits)
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('financials')}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer whitespace-nowrap shrink-0"
          >
            <Receipt className="w-3.5 h-3.5" />
            <span>سجل التوريدات</span>
          </button>
        </div>

        <div className="bg-[#0B1A33] text-white rounded-xl p-5 flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
              <Wallet className="w-4 h-4 text-[#FF7F00]" />
              <span>الرصيد المتاح لسداد مستحقات التجار</span>
            </div>
            <div
              className={`text-2xl font-extrabold font-mono tabular-nums mt-2 ${
                data.availableMerchantCashBalance >= 0
                  ? 'text-[#FF7F00]'
                  : 'text-red-400'
              }`}
            >
              {data.availableMerchantCashBalance.toFixed(2)} ج.م
            </div>
            <div className="text-xs text-slate-300 mt-1 font-mono tabular-nums">
              {data.totalCourierDeposits.toFixed(2)} (توريدات) −{' '}
              {data.totalMerchantSettlementsPaid.toFixed(2)} (مسدد للتجار)
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('financials')}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-bold cursor-pointer whitespace-nowrap shrink-0"
          >
            <span>تفاصيل المالية</span>
            <ArrowLeft className="w-3.5 h-3.5 text-[#FF7F00]" />
          </button>
        </div>
      </div>

      {/* ================================================================= */}
      {/* TOP ANALYTICAL WIDGETS (Lazy-loaded Recharts + Top Courier)       */}
      {/* ================================================================= */}
      <div
        ref={chartsContainerRef}
        className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch"
      >
        {chartsVisible ? (
          <Suspense fallback={<ChartsLoadingSkeleton />}>
            <LazyOverviewCharts
              weeklyOrdersData={data.weeklyOrdersData}
              totalDeliveredOrders={data.totalDeliveredOrders}
              hourlyOrdersData={data.hourlyOrdersData}
              peakWindowText={data.peakWindowText}
              peakHourCount={data.peakHourCount}
              totalOrdersAnalyzed={data.totalOrdersAnalyzed}
              onRefresh={() => loadDashboard(true)}
            />
          </Suspense>
        ) : (
          <ChartsLoadingSkeleton />
        )}

        {/* Widget 3: Top Courier Performance (Card & Monthly Leaderboard) */}
        <section className="lg:col-span-12 xl:col-span-3 bg-[#0B1A33] text-white rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Award className="w-4 h-4 text-[#FF7F00]" />
                <h2 className="text-sm font-bold text-white">أداء المناديب</h2>
              </div>
              <span className="text-[11px] text-slate-300">
                {data.currentMonthLabel}
              </span>
            </div>

            {topCourier ? (
              <div className="mt-4 pb-4 border-b border-white/10">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-[#FF7F00] text-white font-extrabold text-sm flex items-center justify-center shrink-0">
                    {getCourierInitials(topCourier.name)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-[#FF7F00]">
                      المتصدر هذا الشهر
                    </div>
                    <div className="text-sm font-extrabold text-white truncate mt-0.5">
                      أعلى مندوب: {topCourier.name} - عدد الطلبات:{' '}
                      <span className="font-mono tabular-nums text-[#FF7F00]">
                        {topCourier.deliveredCount}
                      </span>
                    </div>
                    <div
                      className="text-[11px] text-slate-300 font-mono tabular-nums mt-0.5 text-right"
                      dir="ltr"
                    >
                      {topCourier.phone}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 py-6 text-center border-b border-white/10">
                <Bike className="w-7 h-7 text-[#FF7F00]/70 mx-auto mb-2" />
                <div className="text-xs font-bold text-slate-200">
                  لا توجد طلبات مُسلّمة هذا الشهر
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  سيظهر أفضل مندوب تلقائياً عند إتمام التسليم
                </p>
              </div>
            )}

            {data.topCouriersThisMonth.length > 1 && (
              <div className="mt-3 divide-y divide-white/10">
                {data.topCouriersThisMonth.slice(1, 4).map((entry, idx) => (
                  <div
                    key={entry.courierId}
                    className="py-2 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-5 h-5 rounded-full bg-white/10 text-slate-200 font-mono tabular-nums text-[11px] font-bold flex items-center justify-center shrink-0">
                        {idx + 2}
                      </span>
                      <span className="text-slate-200 font-semibold truncate">
                        {entry.name}
                      </span>
                    </div>
                    <span className="font-mono tabular-nums font-bold text-[#FF7F00] whitespace-nowrap">
                      {entry.deliveredCount} طلب
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => onNavigate('couriers')}
            className="mt-4 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-bold transition-colors cursor-pointer"
          >
            <span>تفاصيل المناديب وكشوف الحساب</span>
            <ArrowLeft className="w-3.5 h-3.5 text-[#FF7F00]" />
          </button>
        </section>
      </div>

      {/* Recent Orders & Recent Courier Deposits */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#0B1A33]">أحدث الطلبات</h2>
            <button
              type="button"
              onClick={() => onNavigate('orders')}
              className="inline-flex items-center gap-1 text-xs font-bold text-[#FF7F00] hover:underline cursor-pointer"
            >
              <span>عرض الكل</span>
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                  <th className="py-2.5 px-4">رقم الطلب</th>
                  <th className="py-2.5 px-4">العميل</th>
                  <th className="py-2.5 px-4">النوع</th>
                  <th className="py-2.5 px-4">الإجمالي</th>
                  <th className="py-2.5 px-4">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.recentOrders.map((o) => (
                  <tr key={o.id}>
                    <td className="py-2.5 px-4 font-mono tabular-nums font-bold text-[#0B1A33]">
                      {o.order_number}
                    </td>
                    <td className="py-2.5 px-4">{o.customer_name}</td>
                    <td className="py-2.5 px-4 text-xs text-slate-600">
                      {o.service_type === 'brand' ? 'براند' : 'مخصوص'}
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums font-bold">
                      {Number(o.total || 0).toFixed(2)} ج.م
                    </td>
                    <td className="py-2.5 px-4 text-xs font-semibold text-slate-700">
                      {o.status}
                    </td>
                  </tr>
                ))}
                {data.recentOrders.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-xs text-slate-400">
                      لا توجد طلبات مسجلة بعد
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Courier Deposits */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-[#0B1A33]">
                أحدث توريدات المندوبين
              </h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                إجمالي الكاش المحصل:{' '}
                <strong className="font-mono tabular-nums text-emerald-700">
                  {data.totalCourierDeposits.toFixed(2)} ج.م
                </strong>
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('financials')}
              className="inline-flex items-center gap-1 text-xs font-bold text-[#FF7F00] hover:underline cursor-pointer whitespace-nowrap"
            >
              <span>عرض الكل في المالية</span>
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
          </div>
          {data.depositsWarning && (
            <div className="m-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{data.depositsWarning}</span>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                  <th className="py-2.5 px-4">المندوب</th>
                  <th className="py-2.5 px-4">المبلغ المورد</th>
                  <th className="py-2.5 px-4">ملاحظات</th>
                  <th className="py-2.5 px-4">الإيصال</th>
                  <th className="py-2.5 px-4">التاريخ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.recentDeposits.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-4 font-bold text-[#0B1A33] whitespace-nowrap">
                      {d.courierName}
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums font-bold text-emerald-700 whitespace-nowrap">
                      {d.amount.toFixed(2)} ج.م
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-600 max-w-[180px] truncate">
                      {d.notes || '—'}
                    </td>
                    <td className="py-2.5 px-4 text-xs whitespace-nowrap">
                      {d.receiptUrl ? (
                        <a
                          href={d.receiptUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-bold text-[#0B1A33] hover:text-[#FF7F00]"
                        >
                          <span>عرض</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-[11px] text-slate-500 whitespace-nowrap">
                      {new Date(d.createdAt).toLocaleString('ar-EG')}
                    </td>
                  </tr>
                ))}
                {data.recentDeposits.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-xs text-slate-400">
                      لا توجد توريدات مناديب مسجلة بعد
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
