import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Ban,
  Calendar,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Percent,
  Plus,
  Receipt,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  UserPlus,
  Wallet,
  X,
} from 'lucide-react';
import { supabase, supabaseSignUpClient } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type {
  Advertisement,
  Courier,
  CourierDeposit,
  CourierPenalty,
  DashboardSection,
  Expense,
  Merchant,
  MerchantSettlement,
  Order,
  OrderCourier,
  Profile,
  SubscriptionRevenue,
  UserRole,
} from '../types/database';
import {
  DASHBOARD_MODULES,
  getDefaultPermissionsForRole,
  hasCustomPermissionsOverride,
  normalizePermissionsObject,
  resolveEffectivePermissions,
} from '../utils/permissions';
import {
  fetchCourierCommissionPct,
  saveCourierCommissionPct,
} from '../utils/commissions';
import {
  DEFAULT_DAILY_CASH_LIMIT,
  DEFAULT_MAX_CASH_LIMIT,
  fetchCashLimits,
  saveCashLimits,
  syncSingleCourierCashLimit,
} from '../utils/cashLimits';
import {
  buildCourierCustodySummaries,
  buildMerchantPayableSummaries,
  getOrderDeliveryFeeNet,
  groupOrderCouriersByOrder,
  isCashOnDelivery,
  isOrderDelivered,
  resolveOrderFinancials,
} from '../utils/custody';
import { formatSubscriptionDate, getPlanLabel } from '../utils/subscriptions';
import {
  SUMMARY_CACHE_TTL_MS,
  getCachedSummary,
  invalidateSummaryCache,
  setCachedSummary,
} from '../utils/summaryCache';
import { AddExpenseModal } from './AddExpenseModal';
import { RecordDepositModal } from './RecordDepositModal';
import { RecordMerchantPaymentModal } from './RecordMerchantPaymentModal';

const FINANCIALS_CACHE_KEY = 'financials_dashboard_data_v2';

interface FinancialsCachePayload {
  orders: Order[];
  couriers: Courier[];
  merchants: Merchant[];
  orderCouriers: OrderCourier[];
  deposits: CourierDeposit[];
  penalties: CourierPenalty[];
  merchantSettlements: MerchantSettlement[];
  expenses: Expense[];
  subscriptionRevenues: SubscriptionRevenue[];
  advertisements: Advertisement[];
  commissionPct: number;
  warningNotice: string | null;
}

function getCurrentMonthValue(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function getMonthDateBounds(monthValue: string): { from: string; to: string } {
  const [yStr, mStr] = monthValue.split('-');
  const year = Number(yStr) || new Date().getFullYear();
  const month = Number(mStr) || new Date().getMonth() + 1;
  const lastDay = new Date(year, month, 0).getDate();
  const mm = String(month).padStart(2, '0');
  const dd = String(lastDay).padStart(2, '0');
  return {
    from: `${year}-${mm}-01`,
    to: `${year}-${mm}-${dd}`,
  };
}

function toLocalDateKey(value?: string | null): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return trimmed.slice(0, 10);
  }
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isWithinDateRange(
  value: string | null | undefined,
  from: string,
  to: string
): boolean {
  const key = toLocalDateKey(value);
  if (!key) return false;
  if (from && key < from) return false;
  if (to && key > to) return false;
  return true;
}

function formatExpenseDate(value: string): string {
  if (!value) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    const [y, m, d] = value.trim().split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function FinancialsView() {
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonthValue);
  const [dateFrom, setDateFrom] = useState<string>(
    () => getMonthDateBounds(getCurrentMonthValue()).from
  );
  const [dateTo, setDateTo] = useState<string>(
    () => getMonthDateBounds(getCurrentMonthValue()).to
  );

  const [orders, setOrders] = useState<Order[]>([]);
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [orderCouriers, setOrderCouriers] = useState<OrderCourier[]>([]);
  const [deposits, setDeposits] = useState<CourierDeposit[]>([]);
  const [penalties, setPenalties] = useState<CourierPenalty[]>([]);
  const [merchantSettlements, setMerchantSettlements] = useState<
    MerchantSettlement[]
  >([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [subscriptionRevenues, setSubscriptionRevenues] = useState<
    SubscriptionRevenue[]
  >([]);
  const [advertisements, setAdvertisements] = useState<Advertisement[]>([]);
  const [commissionPct, setCommissionPct] = useState<number>(70);
  const [loading, setLoading] = useState(true);
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [selectedCourierId, setSelectedCourierId] = useState<string | undefined>(
    undefined
  );
  const [merchantPaymentModalOpen, setMerchantPaymentModalOpen] = useState(false);
  const [selectedMerchantId, setSelectedMerchantId] = useState<
    string | undefined
  >(undefined);
  const [merchantModalShowUnsettled, setMerchantModalShowUnsettled] =
    useState(false);
  const { role } = useAuth();
  const isAdmin = role === 'admin';

  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [showAllDepositsHistory, setShowAllDepositsHistory] = useState(false);
  const [depositToDelete, setDepositToDelete] = useState<CourierDeposit | null>(
    null
  );
  const [deletingDepositId, setDeletingDepositId] = useState<string | null>(
    null
  );
  const [deleteDepositError, setDeleteDepositError] = useState<string | null>(
    null
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const [warningNotice, setWarningNotice] = useState<string | null>(null);

  const handleMonthChange = (monthVal: string) => {
    setSelectedMonth(monthVal);
    if (monthVal) {
      const bounds = getMonthDateBounds(monthVal);
      setDateFrom(bounds.from);
      setDateTo(bounds.to);
    }
  };

  const handleResetToCurrentMonth = () => {
    const cur = getCurrentMonthValue();
    setSelectedMonth(cur);
    const bounds = getMonthDateBounds(cur);
    setDateFrom(bounds.from);
    setDateTo(bounds.to);
  };

  const loadFinancials = useCallback(async (forceRefresh = false) => {
    setWarningNotice(null);

    if (!forceRefresh) {
      const cached = getCachedSummary<FinancialsCachePayload>(
        FINANCIALS_CACHE_KEY,
        SUMMARY_CACHE_TTL_MS
      );
      if (cached) {
        const c = cached.data;
        setOrders(c.orders);
        setCouriers(c.couriers);
        setMerchants(c.merchants);
        setOrderCouriers(c.orderCouriers);
        setDeposits(c.deposits);
        setPenalties(c.penalties);
        setMerchantSettlements(c.merchantSettlements);
        setExpenses(c.expenses);
        setSubscriptionRevenues(c.subscriptionRevenues);
        setAdvertisements(c.advertisements);
        setCommissionPct(c.commissionPct);
        setWarningNotice(c.warningNotice);
        setLoading(false);
        return;
      }
    }

    setLoading(true);

    const [
      ordersRes,
      couriersRes,
      merchantsRes,
      orderCouriersRes,
      depositsRes,
      penaltiesRes,
      settlementsRes,
      expensesRes,
      subRevenuesRes,
      adsRes,
      pct,
    ] = await Promise.all([
      supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false }),
      supabase.from('couriers').select('*, profiles(full_name, phone)'),
      supabase.from('merchants').select('*').order('created_at', { ascending: false }),
      supabase.from('order_couriers').select('*'),
      supabase
        .from('courier_deposits')
        .select('*')
        .order('created_at', { ascending: false }),
      supabase
        .from('courier_penalties')
        .select('*')
        .order('created_at', { ascending: false }),
      supabase
        .from('merchant_settlements')
        .select('*')
        .order('payment_date', { ascending: false }),
      supabase
        .from('expenses')
        .select('*')
        .order('expense_date', { ascending: false }),
      supabase
        .from('subscription_revenues')
        .select('*')
        .order('created_at', { ascending: false }),
      supabase
        .from('advertisements')
        .select('*')
        .order('created_at', { ascending: false }),
      fetchCourierCommissionPct(),
    ]);

    const loadedOrders = (ordersRes.data as Order[]) || [];
    let loadedCouriers: Courier[] = [];
    if (!couriersRes.error && couriersRes.data) {
      loadedCouriers = (couriersRes.data as Courier[]) || [];
    } else if (couriersRes.error) {
      const fallbackCouriers = await supabase.from('couriers').select('*');
      loadedCouriers = (fallbackCouriers.data as Courier[]) || [];
    }
    const loadedMerchants = (merchantsRes.data as Merchant[]) || [];
    const loadedOrderCouriers = (orderCouriersRes.data as OrderCourier[]) || [];

    let nextWarning: string | null = null;
    let loadedDeposits: CourierDeposit[] = [];
    if (depositsRes.error) {
      console.log('[Financials] courier_deposits fetch error:', depositsRes.error);
      if (depositsRes.error.code === 'PGRST205') {
        nextWarning =
          'جدول courier_deposits غير منشأ بعد في Supabase — يرجى التأكد من وجوده لتخزين إيصالات توريد المناديب.';
      } else {
        nextWarning = `تعذر قراءة جدول التوريدات (courier_deposits): ${depositsRes.error.message}`;
      }
    } else {
      loadedDeposits = (depositsRes.data as CourierDeposit[]) || [];
    }

    const loadedPenalties =
      !penaltiesRes.error && penaltiesRes.data
        ? (penaltiesRes.data as CourierPenalty[])
        : [];

    let loadedSettlements: MerchantSettlement[] = [];
    if (settlementsRes.error) {
      console.log(
        '[Financials] merchant_settlements fetch error:',
        settlementsRes.error
      );
      nextWarning = nextWarning
        ? `${nextWarning} · تعذر قراءة جدول merchant_settlements: ${settlementsRes.error.message}`
        : `تعذر قراءة جدول مدفوعات التجار (merchant_settlements): ${settlementsRes.error.message}`;
    } else {
      loadedSettlements = (settlementsRes.data as MerchantSettlement[]) || [];
    }

    let loadedExpenses: Expense[] = [];
    if (expensesRes.error) {
      nextWarning = nextWarning
        ? `${nextWarning} · تعذر قراءة جدول expenses: ${expensesRes.error.message}`
        : `تعذر قراءة جدول expenses: ${expensesRes.error.message}`;
    } else {
      loadedExpenses = (expensesRes.data as Expense[]) || [];
    }

    const loadedSubRevs = subRevenuesRes.error
      ? []
      : (subRevenuesRes.data as SubscriptionRevenue[]) || [];
    const loadedAds = adsRes.error
      ? []
      : (adsRes.data as Advertisement[]) || [];

    setOrders(loadedOrders);
    setCouriers(loadedCouriers);
    setMerchants(loadedMerchants);
    setOrderCouriers(loadedOrderCouriers);
    setDeposits(loadedDeposits);
    setPenalties(loadedPenalties);
    setMerchantSettlements(loadedSettlements);
    setExpenses(loadedExpenses);
    setSubscriptionRevenues(loadedSubRevs);
    setAdvertisements(loadedAds);
    setCommissionPct(pct);
    setWarningNotice(nextWarning);

    setCachedSummary<FinancialsCachePayload>(FINANCIALS_CACHE_KEY, {
      orders: loadedOrders,
      couriers: loadedCouriers,
      merchants: loadedMerchants,
      orderCouriers: loadedOrderCouriers,
      deposits: loadedDeposits,
      penalties: loadedPenalties,
      merchantSettlements: loadedSettlements,
      expenses: loadedExpenses,
      subscriptionRevenues: loadedSubRevs,
      advertisements: loadedAds,
      commissionPct: pct,
      warningNotice: nextWarning,
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    loadFinancials(false);
  }, [loadFinancials]);

  const realtimeDebounceRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const scheduleReload = () => {
      invalidateSummaryCache();
      if (realtimeDebounceRef.current) {
        window.clearTimeout(realtimeDebounceRef.current);
      }
      realtimeDebounceRef.current = window.setTimeout(() => {
        loadFinancials(true);
      }, 250);
    };

    const channel = supabase
      .channel('financials-realtime-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'courier_deposits' },
        scheduleReload
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'merchant_settlements' },
        scheduleReload
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        scheduleReload
      )
      .subscribe();

    return () => {
      if (realtimeDebounceRef.current) {
        window.clearTimeout(realtimeDebounceRef.current);
      }
      supabase.removeChannel(channel);
    };
  }, [loadFinancials]);

  const filteredOrders = useMemo(
    () => orders.filter((o) => isWithinDateRange(o.created_at, dateFrom, dateTo)),
    [orders, dateFrom, dateTo]
  );

  const filteredDeposits = useMemo(
    () => deposits.filter((d) => isWithinDateRange(d.created_at, dateFrom, dateTo)),
    [deposits, dateFrom, dateTo]
  );

  const filteredPenalties = useMemo(
    () =>
      penalties.filter((p) =>
        isWithinDateRange(p.created_at || '', dateFrom, dateTo)
      ),
    [penalties, dateFrom, dateTo]
  );

  const filteredSettlements = useMemo(
    () =>
      merchantSettlements.filter((s) =>
        isWithinDateRange(s.payment_date || s.created_at, dateFrom, dateTo)
      ),
    [merchantSettlements, dateFrom, dateTo]
  );

  const filteredExpenses = useMemo(
    () =>
      expenses.filter((ex) =>
        isWithinDateRange(ex.expense_date, dateFrom, dateTo)
      ),
    [expenses, dateFrom, dateTo]
  );

  const filteredSubscriptionRevenues = useMemo(
    () =>
      subscriptionRevenues.filter((sr) =>
        isWithinDateRange(sr.created_at || sr.start_date, dateFrom, dateTo)
      ),
    [subscriptionRevenues, dateFrom, dateTo]
  );

  const filteredPaidAds = useMemo(
    () =>
      advertisements.filter(
        (ad) =>
          Boolean(ad.is_paid) &&
          isWithinDateRange(ad.created_at || ad.start_date, dateFrom, dateTo)
      ),
    [advertisements, dateFrom, dateTo]
  );

  const deliveredOrders = useMemo(
    () => filteredOrders.filter((o) => isOrderDelivered(o.status)),
    [filteredOrders]
  );

  const nonCancelledOrders = useMemo(
    () =>
      filteredOrders.filter(
        (o) => String(o.status || '').trim().toLowerCase() !== 'cancelled'
      ),
    [filteredOrders]
  );

  const orderCouriersMap = useMemo(
    () => groupOrderCouriersByOrder(orderCouriers),
    [orderCouriers]
  );

  const courierSummaries = useMemo(
    () =>
      buildCourierCustodySummaries(
        couriers,
        filteredOrders,
        filteredDeposits,
        commissionPct,
        orderCouriers,
        filteredPenalties
      ),
    [
      couriers,
      filteredOrders,
      filteredDeposits,
      commissionPct,
      orderCouriers,
      filteredPenalties,
    ]
  );

  const merchantSummaries = useMemo(
    () =>
      buildMerchantPayableSummaries(
        merchants,
        orders,
        merchantSettlements
      ),
    [merchants, orders, merchantSettlements]
  );

  const courierNameMap = useMemo(() => {
    const m = new Map<string, string>();
    couriers.forEach((c) => {
      const displayName = c.profiles?.full_name || 'مندوب';
      m.set(c.id, displayName);
      if (c.profile_id) {
        m.set(c.profile_id, displayName);
      }
    });
    return m;
  }, [couriers]);

  const handleConfirmDeleteDeposit = async () => {
    if (!isAdmin || !depositToDelete) return;

    const target = depositToDelete;
    const deletedAmount = Number(target.amount || 0);
    setDeletingDepositId(target.id);
    setDeleteDepositError(null);

    try {
      const { data: deletedRows, error: deleteErr } = await supabase
        .from('courier_deposits')
        .delete()
        .eq('id', target.id)
        .select('id');

      if (deleteErr) {
        console.log('[Financials] Delete deposit Supabase error:', deleteErr);
        setDeleteDepositError(`تعذر مسح عملية التوريد: ${deleteErr.message}`);
        return;
      }

      if (!deletedRows || deletedRows.length === 0) {
        setDeleteDepositError(
          'تعذر مسح عملية التوريد (قد تمنع سياسات RLS الحذف أو تم حذف السجل مسبقاً).'
        );
        return;
      }

      // Immediately update local deposits so courier remaining custody & total sums recalculate at once
      setDeposits((prev) => prev.filter((item) => item.id !== target.id));

      // Recalculate courier cash limit & account status in couriers table
      const matchedCourier = couriers.find(
        (c) => c.id === target.courier_id || c.profile_id === target.courier_id
      );
      if (matchedCourier) {
        await syncSingleCourierCashLimit(matchedCourier.id);
      }

      const courierDisplayName =
        courierNameMap.get(target.courier_id) || 'المندوب';
      setDepositToDelete(null);
      setFeedback(
        `تم مسح عملية التوريد بمبلغ ${deletedAmount.toFixed(2)} ج.م وإرجاع المبلغ لعهدة المندوب "${courierDisplayName}".`
      );
      invalidateSummaryCache();
      await loadFinancials(true);
    } catch (err) {
      console.log('[Financials] Delete deposit unexpected error:', err);
      setDeleteDepositError(
        err instanceof Error
          ? err.message
          : 'حدث خطأ غير متوقع أثناء مسح عملية التوريد.'
      );
    } finally {
      setDeletingDepositId(null);
    }
  };

  const merchantNameMap = useMemo(() => {
    const m = new Map<string, string>();
    merchants.forEach((merch) =>
      m.set(merch.id, merch.store_name || merch.name || 'متجر')
    );
    return m;
  }, [merchants]);

  const totalHatlyRevenue = useMemo(
    () =>
      deliveredOrders.reduce((sum, o) => {
        const { hatlyNetRevenue } = resolveOrderFinancials(
          o,
          commissionPct,
          orderCouriersMap.get(o.id) || []
        );
        return sum + hatlyNetRevenue;
      }, 0),
    [deliveredOrders, commissionPct, orderCouriersMap]
  );

  const totalSubscriptionRevenues = useMemo(
    () =>
      filteredSubscriptionRevenues.reduce(
        (sum, sr) => sum + Number(sr.amount || 0),
        0
      ),
    [filteredSubscriptionRevenues]
  );

  const totalAdRevenues = useMemo(
    () =>
      filteredPaidAds.reduce(
        (sum, ad) => sum + Number(ad.amount_paid || 0),
        0
      ),
    [filteredPaidAds]
  );

  const totalHatlyAllRevenue = useMemo(
    () => totalHatlyRevenue + totalSubscriptionRevenues + totalAdRevenues,
    [totalHatlyRevenue, totalSubscriptionRevenues, totalAdRevenues]
  );

  const totalExpenses = useMemo(
    () =>
      filteredExpenses.reduce((sum, ex) => sum + Number(ex.amount || 0), 0),
    [filteredExpenses]
  );

  const netProfit = useMemo(
    () => totalHatlyAllRevenue - totalExpenses,
    [totalHatlyAllRevenue, totalExpenses]
  );

  const totalCourierCommissions = useMemo(
    () =>
      deliveredOrders.reduce((sum, o) => {
        const { courierCommission } = resolveOrderFinancials(
          o,
          commissionPct,
          orderCouriersMap.get(o.id) || []
        );
        return sum + courierCommission;
      }, 0),
    [deliveredOrders, commissionPct, orderCouriersMap]
  );

  const totalDeliveryFees = useMemo(
    () =>
      deliveredOrders.reduce((sum, o) => sum + getOrderDeliveryFeeNet(o), 0),
    [deliveredOrders]
  );

  const totalCashCollected = useMemo(
    () =>
      deliveredOrders
        .filter((o) => isCashOnDelivery(o.payment_method))
        .reduce((sum, o) => sum + Number(o.total || 0), 0),
    [deliveredOrders]
  );

  const totalDepositsAll = useMemo(
    () => filteredDeposits.reduce((sum, d) => sum + Number(d.amount || 0), 0),
    [filteredDeposits]
  );

  // Total Cash Deposited by Couriers across all courier_deposits records
  const totalCashDepositedAllTime = useMemo(
    () =>
      Number(
        deposits
          .reduce((sum, d) => sum + Number(d.amount || 0), 0)
          .toFixed(2)
      ),
    [deposits]
  );

  const totalMerchantSettlementsPaidAllTime = useMemo(
    () =>
      Number(
        merchantSettlements
          .reduce((sum, s) => sum + Number(s.amount || 0), 0)
          .toFixed(2)
      ),
    [merchantSettlements]
  );

  // Company's available cash balance from courier deposits to pay merchant settlements
  const availableCashBalanceForMerchants = useMemo(
    () =>
      Number(
        (
          totalCashDepositedAllTime - totalMerchantSettlementsPaidAllTime
        ).toFixed(2)
      ),
    [totalCashDepositedAllTime, totalMerchantSettlementsPaidAllTime]
  );

  const displayedDeposits = useMemo(
    () => (showAllDepositsHistory ? deposits : filteredDeposits),
    [showAllDepositsHistory, deposits, filteredDeposits]
  );

  const totalDisplayedDeposits = useMemo(
    () =>
      displayedDeposits.reduce((sum, d) => sum + Number(d.amount || 0), 0),
    [displayedDeposits]
  );

  const totalRemainingCustody = useMemo(
    () =>
      courierSummaries.reduce(
        (sum, c) => sum + Math.max(0, c.remainingCustody),
        0
      ),
    [courierSummaries]
  );

  const totalMerchantPayables = useMemo(
    () =>
      merchantSummaries.reduce(
        (sum, m) => sum + Math.max(0, m.remainingBalance),
        0
      ),
    [merchantSummaries]
  );

  const merchantCoverageDifference = useMemo(
    () =>
      Number(
        (availableCashBalanceForMerchants - totalMerchantPayables).toFixed(2)
      ),
    [availableCashBalanceForMerchants, totalMerchantPayables]
  );

  if (loading) {
    return (
      <div className="p-12 flex flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="w-6 h-6 text-[#FF7B00] animate-spin" />
        <span className="text-sm">جاري تحميل البيانات المالية والعهدة...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header, Actions & Month / Date Range Filter */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-[#0A192F]">
              المالية والعهدة والعمولات والمصاريف
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              توزيع رسوم التوصيل الحالي: عمولة المندوب{' '}
              <strong className="text-[#0A192F] font-mono tabular-nums">
                {commissionPct}%
              </strong>{' '}
              · حصة هاتلي{' '}
              <strong className="text-[#FF7B00] font-mono tabular-nums">
                {(100 - commissionPct).toFixed(0)}%
              </strong>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => loadFinancials(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>تحديث</span>
            </button>
            <button
              type="button"
              onClick={() => setExpenseModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-[#0A192F] text-xs font-bold cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4 text-[#FF7B00]" />
              <span>إضافة مصروف</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedMerchantId(undefined);
                setMerchantPaymentModalOpen(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0A192F] hover:bg-[#112240] text-white text-xs font-bold cursor-pointer whitespace-nowrap"
            >
              <Receipt className="w-4 h-4 text-[#FF7B00]" />
              <span>تسجيل دفعة لتاجر</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedCourierId(undefined);
                setDepositModalOpen(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#FF7B00] hover:bg-[#E56E00] text-white text-xs font-bold cursor-pointer whitespace-nowrap"
            >
              <Receipt className="w-4 h-4" />
              <span>تسجيل توريد</span>
            </button>
          </div>
        </div>

        {/* Period Filter Row */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-3 border-t border-slate-100 items-end">
          <div>
            <label
              htmlFor="fin-month-filter"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              الشهر
            </label>
            <div className="relative">
              <Calendar className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="fin-month-filter"
                type="month"
                value={selectedMonth}
                onChange={(e) => handleMonthChange(e.target.value)}
                className="w-full pr-9 pl-3 py-2 rounded-lg border border-slate-200 text-sm font-mono tabular-nums text-[#0A192F]"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="fin-date-from"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              من تاريخ
            </label>
            <input
              id="fin-date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setSelectedMonth('');
                setDateFrom(e.target.value);
              }}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono tabular-nums text-[#0A192F]"
            />
          </div>

          <div>
            <label
              htmlFor="fin-date-to"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              إلى تاريخ
            </label>
            <input
              id="fin-date-to"
              type="date"
              value={dateTo}
              onChange={(e) => {
                setSelectedMonth('');
                setDateTo(e.target.value);
              }}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono tabular-nums text-[#0A192F]"
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleResetToCurrentMonth}
              className="px-3.5 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-[#0A192F] cursor-pointer whitespace-nowrap"
            >
              الشهر الحالي
            </button>
            <span className="text-[11px] font-mono tabular-nums text-slate-500 whitespace-nowrap">
              {dateFrom} ← {dateTo}
            </span>
          </div>
        </div>
      </div>

      {feedback && (
        <div
          role="status"
          className="flex items-center justify-between gap-2.5 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-semibold"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{feedback}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs underline cursor-pointer"
          >
            إخفاء
          </button>
        </div>
      )}

      {warningNotice && (
        <div className="flex items-center gap-2.5 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{warningNotice}</span>
        </div>
      )}

      {/* Primary Financial KPI Cards (P&L + Balances) */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-semibold text-slate-500">
            إجمالي إيرادات التوصيل (هاتلي)
          </div>
          <div className="text-2xl font-extrabold text-[#0A192F] font-mono tabular-nums mt-2">
            {totalHatlyRevenue.toFixed(2)} ج.م
          </div>
          <div className="text-xs text-slate-400 mt-1">
            صافي التوصيل ({(100 - commissionPct).toFixed(0)}%) خلال الفترة
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-semibold text-slate-500">
            إيرادات الاشتراكات
          </div>
          <div className="text-2xl font-extrabold text-[#FF7B00] font-mono tabular-nums mt-2">
            {totalSubscriptionRevenues.toFixed(2)} ج.م
          </div>
          <div className="text-xs text-slate-400 mt-1">
            باقات المتاجر ({filteredSubscriptionRevenues.length} اشتراك في الفترة)
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-semibold text-slate-500">
            إيرادات الإعلانات
          </div>
          <div className="text-2xl font-extrabold text-[#0A192F] font-mono tabular-nums mt-2">
            {totalAdRevenues.toFixed(2)} ج.م
          </div>
          <div className="text-xs text-slate-400 mt-1">
            إعلانات الباقة العادية ({filteredPaidAds.length} إعلان مدفوع)
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-semibold text-slate-500">
            إجمالي المصاريف التشغيلية
          </div>
          <div className="text-2xl font-extrabold text-red-600 font-mono tabular-nums mt-2">
            {totalExpenses.toFixed(2)} ج.م
          </div>
          <div className="text-xs text-slate-400 mt-1">
            مجموع المصاريف المسجلة ({filteredExpenses.length} بند)
          </div>
        </div>

        <div
          className={`rounded-xl p-5 border sm:col-span-2 lg:col-span-2 xl:col-span-1 ${
            netProfit >= 0
              ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
              : 'bg-red-50 border-red-200 text-red-950'
          }`}
        >
          <div
            className={`text-xs font-semibold ${
              netProfit >= 0 ? 'text-emerald-800' : 'text-red-800'
            }`}
          >
            الربح الصافي للشركة
          </div>
          <div
            className={`text-2xl font-extrabold font-mono tabular-nums mt-2 ${
              netProfit >= 0 ? 'text-emerald-700' : 'text-red-700'
            }`}
          >
            {netProfit.toFixed(2)} ج.م
          </div>
          <div
            className={`text-[11px] mt-1 font-mono tabular-nums ${
              netProfit >= 0 ? 'text-emerald-700' : 'text-red-700'
            }`}
          >
            ({totalHatlyRevenue.toFixed(2)} + {totalSubscriptionRevenues.toFixed(2)} + {totalAdRevenues.toFixed(2)}) − {totalExpenses.toFixed(2)}
          </div>
          <div
            className={`text-[11px] mt-1 font-semibold ${
              netProfit >= 0 ? 'text-emerald-800/80' : 'text-red-800/80'
            }`}
          >
            إجمالي إيرادات هاتلي: {totalHatlyAllRevenue.toFixed(2)} ج.م
          </div>
        </div>
      </div>

      {/* Operational Settlement & Custody KPI Cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
          <div className="text-xs font-bold text-emerald-900">
            إجمالي الكاش المحصل من المندوبين
          </div>
          <div className="text-2xl font-extrabold text-emerald-700 font-mono tabular-nums mt-2">
            {totalCashDepositedAllTime.toFixed(2)} ج.م
          </div>
          <div className="text-[11px] text-emerald-800/80 mt-1 font-mono tabular-nums">
            {deposits.length} عملية توريد (courier_deposits)
          </div>
          <div className="text-[11px] text-emerald-700 mt-0.5 font-mono tabular-nums">
            خلال الفترة المحددة: {totalDepositsAll.toFixed(2)} ج.م
          </div>
        </div>

        <div
          className={`rounded-xl p-5 border-2 ${
            availableCashBalanceForMerchants >= totalMerchantPayables
              ? 'bg-[#0A192F] border-emerald-500/40 text-white'
              : 'bg-[#0A192F] border-[#FF7B00]/50 text-white'
          }`}
        >
          <div className="text-xs font-semibold text-slate-300">
            الرصيد المتاح لسداد التجار
          </div>
          <div
            className={`text-2xl font-extrabold font-mono tabular-nums mt-2 ${
              availableCashBalanceForMerchants >= 0
                ? 'text-emerald-400'
                : 'text-red-400'
            }`}
          >
            {availableCashBalanceForMerchants.toFixed(2)} ج.م
          </div>
          <div className="text-[11px] text-slate-300 mt-1 font-mono tabular-nums">
            {totalCashDepositedAllTime.toFixed(2)} − {totalMerchantSettlementsPaidAllTime.toFixed(2)} (مسدد للتجار)
          </div>
          <div
            className={`text-[11px] mt-1 font-semibold ${
              merchantCoverageDifference >= 0
                ? 'text-emerald-300'
                : 'text-[#FF7B00]'
            }`}
          >
            {merchantCoverageDifference >= 0
              ? `يغطي كامل مستحقات التجار (فائض ${merchantCoverageDifference.toFixed(2)} ج.م)`
              : `يحتاج ${Math.abs(merchantCoverageDifference).toFixed(2)} ج.م لتغطية كل التجار`}
          </div>
        </div>

        <div className="bg-white border-2 border-[#FF7B00]/40 rounded-xl p-5">
          <div className="text-xs font-semibold text-slate-600">
            إجمالي مستحقات التجار
          </div>
          <div className="text-2xl font-extrabold text-[#0A192F] font-mono tabular-nums mt-2">
            {totalMerchantPayables.toFixed(2)} ج.م
          </div>
          <div className="text-xs text-slate-500 mt-1">
            ما تدين به هاتلي للتجار (أرصدة غير مسددة)
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-semibold text-slate-500">
            تحصيلات المندوبين (العهدة المتبقية)
          </div>
          <div className="text-2xl font-extrabold text-[#FF7B00] font-mono tabular-nums mt-2">
            {totalRemainingCustody.toFixed(2)} ج.م
          </div>
          <div className="text-xs text-slate-500 mt-1">
            ما يدين به المناديب للشركة خلال الفترة
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 sm:col-span-2 lg:col-span-2 xl:col-span-1">
          <div className="text-xs font-semibold text-slate-500">
            إجمالي عمولات المندوبين
          </div>
          <div className="text-2xl font-extrabold text-emerald-700 font-mono tabular-nums mt-2">
            {totalCourierCommissions.toFixed(2)} ج.م
          </div>
          <div className="text-xs text-slate-400 mt-1">
            مستحقات المناديب ({commissionPct}%) خلال الفترة
          </div>
        </div>
      </div>

      {/* Commission & Custody Formula Summary */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="text-xs font-bold text-[#0A192F] mb-3">
          ملخص احتساب العمولات والعهدة (للطلبات المُسلّمة: {deliveredOrders.length} طلب)
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
            <div className="text-slate-500">نسبة العمولة (system_settings)</div>
            <div className="font-mono tabular-nums font-bold text-[#0A192F] mt-1">
              {commissionPct}% للمندوب · {(100 - commissionPct).toFixed(0)}% لهاتلي
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
            <div className="text-slate-500">إجمالي رسوم التوصيل المُسلّمة</div>
            <div className="font-mono tabular-nums font-bold text-[#0A192F] mt-1">
              {totalDeliveryFees.toFixed(2)} ج.م
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
            <div className="text-slate-500">إجمالي الكاش المحصّل (COD)</div>
            <div className="font-mono tabular-nums font-bold text-[#0A192F] mt-1">
              {totalCashCollected.toFixed(2)} ج.م
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
            <div className="text-slate-500">إجمالي التوريدات المخصومة</div>
            <div className="font-mono tabular-nums font-bold text-emerald-700 mt-1">
              {totalDepositsAll.toFixed(2)} ج.م
            </div>
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* SECTION A: Courier Custody & Deposits (ما يدين به المناديب لهاتلي)      */}
      {/* ===================================================================== */}
      <div className="space-y-4 p-4 sm:p-5 rounded-2xl bg-slate-100/70 border border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-[#0A192F]">
              تحصيلات المندوبين (العهدة — ما يدين به المناديب لهاتلي)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              إجمالي الكاش المحصّل من العملاء مطروحاً منه عمولة المندوب والتوريدات المودعة
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setSelectedCourierId(undefined);
              setDepositModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#FF7B00] hover:bg-[#E56E00] text-white text-xs font-bold cursor-pointer whitespace-nowrap"
          >
            <Receipt className="w-3.5 h-3.5" />
            <span>تسجيل توريد</span>
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 font-bold text-sm text-[#0A192F]">
            أرصدة عهدة المناديب (العهدة = الكاش المحصّل − عمولة المندوب − التوريدات)
          </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                <th className="py-3 px-4">المندوب</th>
                <th className="py-3 px-4">الطلبات المُسلّمة</th>
                <th className="py-3 px-4">إجمالي المحصل (COD)</th>
                <th className="py-3 px-4">عمولة المندوب ({commissionPct}%)</th>
                <th className="py-3 px-4">إجمالي المورد</th>
                <th className="py-3 px-4">العهدة المتبقية</th>
                <th className="py-3 px-4">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {courierSummaries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-xs text-slate-400">
                    لا يوجد مناديب مسجلون
                  </td>
                </tr>
              ) : (
                courierSummaries.map((s) => (
                  <tr key={s.courier.id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-4 font-bold text-[#0A192F]">
                      {s.name}
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-xs text-slate-600">
                      {s.deliveredOrdersCount}
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums">
                      {s.grossCollected.toFixed(2)} ج.م
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-emerald-700 font-semibold">
                      {s.totalCommission.toFixed(2)} ج.م
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-600">
                      {s.totalDeposited.toFixed(2)} ج.م
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums font-bold text-[#FF7F00]">
                      {s.remainingCustody.toFixed(2)} ج.م
                      {(s.totalPenalties ?? 0) > 0 && (
                        <div className="text-[11px] font-sans font-semibold text-[#EF2323]">
                          بعد خصم جزاء: {(s.totalPenalties ?? 0).toFixed(2)} ج.م
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-4">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCourierId(s.courier.id);
                          setDepositModalOpen(true);
                        }}
                        className="px-3 py-1 rounded-lg bg-[#0A192F] hover:bg-[#112240] text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
                      >
                        تسجيل توريد
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Deposit Receipts History (still inside Courier Custody section) */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-bold text-sm text-[#0A192F]">
              سجل توريدات المناديب وإيصالات الإيداع (courier_deposits)
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              {showAllDepositsHistory
                ? `عرض كافة التوريدات (${deposits.length} عملية)`
                : `توريدات الفترة المحددة (${filteredDeposits.length} من أصل ${deposits.length})`}
              {' · '}
              الإجمالي:{' '}
              <strong className="font-mono tabular-nums text-emerald-700">
                {totalDisplayedDeposits.toFixed(2)} ج.م
              </strong>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAllDepositsHistory(false)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer transition-colors ${
                !showAllDepositsHistory
                  ? 'bg-[#0A192F] text-white border-[#0A192F]'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              الفترة المحددة ({filteredDeposits.length})
            </button>
            <button
              type="button"
              onClick={() => setShowAllDepositsHistory(true)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer transition-colors ${
                showAllDepositsHistory
                  ? 'bg-[#0A192F] text-white border-[#0A192F]'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              كل التوريدات ({deposits.length})
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                <th className="py-3 px-4">المندوب</th>
                <th className="py-3 px-4">المبلغ المورد</th>
                <th className="py-3 px-4">ملاحظات</th>
                <th className="py-3 px-4">الإيصال</th>
                <th className="py-3 px-4">التاريخ</th>
                {isAdmin && <th className="py-3 px-4 whitespace-nowrap">إجراء</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayedDeposits.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 6 : 5} className="py-6 text-center text-xs text-slate-400 space-y-2">
                    <div>
                      {showAllDepositsHistory
                        ? 'لا توجد توريدات مسجلة في courier_deposits بعد'
                        : 'لا توجد توريدات مسجلة في الفترة المحددة'}
                    </div>
                    {!showAllDepositsHistory && deposits.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowAllDepositsHistory(true)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#0A192F] text-white text-xs font-bold cursor-pointer"
                      >
                        عرض كل التوريدات المسجلة ({deposits.length})
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                displayedDeposits.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-4 font-bold text-[#0A192F]">
                      {courierNameMap.get(d.courier_id) || d.courier_id}
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums font-bold text-emerald-700">
                      {Number(d.amount || 0).toFixed(2)} ج.م
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-600">
                      {d.notes || '—'}
                    </td>
                    <td className="py-2.5 px-4 text-xs">
                      {d.receipt_url ? (
                        <a
                          href={d.receipt_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-bold text-[#0A192F] hover:text-[#FF7B00]"
                        >
                          <span>عرض الإيصال</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-xs text-slate-500">
                      {new Date(d.created_at).toLocaleString('ar-EG')}
                    </td>
                    {isAdmin && (
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        <button
                          type="button"
                          disabled={deletingDepositId === d.id}
                          onClick={() => {
                            setDeleteDepositError(null);
                            setDepositToDelete(d);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold cursor-pointer disabled:opacity-50 whitespace-nowrap"
                        >
                          {deletingDepositId === d.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                          <span>مسح</span>
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
            {displayedDeposits.length > 0 && (
              <tfoot>
                <tr className="bg-[#0A192F] text-white text-xs font-bold">
                  <td className="py-3 px-4">
                    إجمالي التوريدات المعروضة ({displayedDeposits.length} عملية)
                  </td>
                  <td colSpan={isAdmin ? 5 : 4} className="py-3 px-4 font-mono tabular-nums text-emerald-400">
                    {totalDisplayedDeposits.toFixed(2)} ج.م
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      </div>

      {/* ===================================================================== */}
      {/* SECTION B: Merchant Payments (تحصيلات التجار - ما تدين به هاتلي للتجار) */}
      {/* ===================================================================== */}
      <div className="space-y-4 p-4 sm:p-5 rounded-2xl bg-orange-50/40 border border-[#FF7B00]/25">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-[#0A192F]">
              تحصيلات التجار (مستحقات التجار — ما تدين به هاتلي للتجار)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              إجمالي مبيعات التجار عن الطلبات المُسلّمة مطروحاً منها الدفعات المسددة في merchant_settlements
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setSelectedMerchantId(undefined);
              setMerchantModalShowUnsettled(false);
              setMerchantPaymentModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0A192F] hover:bg-[#112240] text-white text-xs font-bold cursor-pointer whitespace-nowrap"
          >
            <Receipt className="w-3.5 h-3.5 text-[#FF7B00]" />
            <span>تسجيل دفعة للتاجر</span>
          </button>
        </div>

        {/* Merchant Balances Breakdown */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 font-bold text-sm text-[#0A192F]">
            أرصدة مستحقات التجار (المبيعات غير المسددة − المدفوع)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                  <th className="py-3 px-4">التاجر / المتجر</th>
                  <th className="py-3 px-4">الطلبات غير المسددة</th>
                  <th className="py-3 px-4">إجمالي المبيعات</th>
                  <th className="py-3 px-4">إجمالي المدفوع</th>
                  <th className="py-3 px-4">الرصيد المتبقي للتاجر</th>
                  <th className="py-3 px-4">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {merchantSummaries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-xs text-slate-400">
                      لا توجد متاجر مسجلة
                    </td>
                  </tr>
                ) : (
                  merchantSummaries.map((m) => (
                    <tr key={m.merchant.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-4 font-bold text-[#0A192F]">
                        {m.name}
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-xs text-slate-600">
                        {m.unsettledOrdersCount} طلب
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums">
                        {m.totalSales.toFixed(2)} ج.م
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-emerald-700 font-semibold">
                        {m.totalPaid.toFixed(2)} ج.م
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums font-bold text-[#FF7B00]">
                        {m.remainingBalance.toFixed(2)} ج.م
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedMerchantId(m.merchant.id);
                              setMerchantModalShowUnsettled(true);
                              setMerchantPaymentModalOpen(true);
                            }}
                            className="px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-[#0A192F] text-xs font-semibold cursor-pointer whitespace-nowrap"
                          >
                            عرض الطلبات غير المسددة
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedMerchantId(m.merchant.id);
                              setMerchantModalShowUnsettled(false);
                              setMerchantPaymentModalOpen(true);
                            }}
                            className="px-3 py-1 rounded-lg bg-[#FF7B00] hover:bg-[#E56E00] text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
                          >
                            تسجيل دفعة
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recorded Merchant Payments Table */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 font-bold text-sm text-[#0A192F]">
            سجل المدفوعات المسجلة للتجار (merchant_settlements)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                  <th className="py-3 px-4">التاجر</th>
                  <th className="py-3 px-4">المبلغ المدفوع</th>
                  <th className="py-3 px-4">ملاحظات</th>
                  <th className="py-3 px-4">الإيصال</th>
                  <th className="py-3 px-4">تاريخ الدفع</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSettlements.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-xs text-slate-400">
                      لا توجد دفعات مسجلة للتجار في الفترة المحددة
                    </td>
                  </tr>
                ) : (
                  filteredSettlements.map((s) => (
                    <tr key={s.id}>
                      <td className="py-2.5 px-4 font-bold text-[#0A192F]">
                        {merchantNameMap.get(s.merchant_id) || s.merchant_id}
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums font-bold text-emerald-700">
                        {Number(s.amount || 0).toFixed(2)} ج.م
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-600">
                        {s.notes || '—'}
                      </td>
                      <td className="py-2.5 px-4 text-xs">
                        {s.receipt_url ? (
                          <a
                            href={s.receipt_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-bold text-[#0A192F] hover:text-[#FF7B00]"
                          >
                            <span>عرض الإيصال</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-xs text-slate-500">
                        {new Date(
                          s.payment_date || s.created_at || new Date().toISOString()
                        ).toLocaleString('ar-EG')}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* SECTION C: Operational Expenses (المصاريف التشغيلية)                  */}
      {/* ===================================================================== */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#0A192F] text-[#FF7B00] flex items-center justify-center shrink-0">
              <Wallet className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#0A192F]">
                المصاريف التشغيلية
              </h3>
              <p className="text-xs text-slate-500">
                {filteredExpenses.length} مصروف في الفترة ({dateFrom} ← {dateTo}) · الإجمالي:{' '}
                <strong className="font-mono tabular-nums text-red-600">
                  {totalExpenses.toFixed(2)} ج.م
                </strong>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setExpenseModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#FF7B00] hover:bg-[#E56E00] text-white text-xs font-bold cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة مصروف جديد</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                <th className="py-3 px-4 whitespace-nowrap">التاريخ</th>
                <th className="py-3 px-4 whitespace-nowrap">نوع المصروف</th>
                <th className="py-3 px-4">البيان</th>
                <th className="py-3 px-4 whitespace-nowrap">المبلغ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredExpenses.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-10 text-center space-y-3">
                    <div className="text-xs text-slate-500">
                      لا توجد مصاريف تشغيلية مسجلة في الفترة المحددة
                    </div>
                    <button
                      type="button"
                      onClick={() => setExpenseModalOpen(true)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0A192F] hover:bg-[#112240] text-white text-xs font-bold cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5 text-[#FF7B00]" />
                      <span>تسجيل أول مصروف</span>
                    </button>
                  </td>
                </tr>
              ) : (
                filteredExpenses.map((ex) => (
                  <tr key={ex.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap align-top">
                      {formatExpenseDate(ex.expense_date)}
                    </td>
                    <td className="py-3 px-4 font-bold text-[#0A192F] whitespace-nowrap align-top">
                      {ex.title}
                    </td>
                    <td className="py-3 px-4 text-slate-700 text-xs sm:text-sm leading-relaxed max-w-md whitespace-normal align-top">
                      {ex.description || '—'}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums font-bold text-red-600 whitespace-nowrap align-top">
                      {Number(ex.amount || 0).toFixed(2)} ج.م
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {filteredExpenses.length > 0 && (
              <tfoot>
                <tr className="bg-[#0A192F] text-white text-xs font-bold">
                  <td colSpan={3} className="py-3 px-4">
                    إجمالي المصاريف التشغيلية خلال الفترة
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-[#FF7B00] whitespace-nowrap">
                    {totalExpenses.toFixed(2)} ج.م
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* SECTION D: Subscription Revenues (إيرادات الاشتراكات)                 */}
      {/* ===================================================================== */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-bold text-sm text-[#0A192F]">
              سجل إيرادات اشتراكات المتاجر (subscription_revenues)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {filteredSubscriptionRevenues.length} اشتراك في الفترة ({dateFrom} ← {dateTo}) · الإجمالي:{' '}
              <strong className="font-mono tabular-nums text-[#FF7B00]">
                {totalSubscriptionRevenues.toFixed(2)} ج.م
              </strong>
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                <th className="py-3 px-4 whitespace-nowrap">المتجر</th>
                <th className="py-3 px-4 whitespace-nowrap">الباقة</th>
                <th className="py-3 px-4 whitespace-nowrap">تاريخ البدء</th>
                <th className="py-3 px-4 whitespace-nowrap">تاريخ الانتهاء</th>
                <th className="py-3 px-4 whitespace-nowrap">المبلغ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredSubscriptionRevenues.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-xs text-slate-400">
                    لا توجد إيرادات اشتراكات مسجلة في الفترة المحددة
                  </td>
                </tr>
              ) : (
                filteredSubscriptionRevenues.map((sr) => (
                  <tr key={sr.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-bold text-[#0A192F] whitespace-nowrap">
                      {merchantNameMap.get(sr.merchant_id) || sr.merchant_id}
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-700 whitespace-nowrap">
                      {getPlanLabel(sr.plan_name)}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                      {formatSubscriptionDate(sr.start_date)}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                      {formatSubscriptionDate(sr.end_date)}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums font-bold text-emerald-700 whitespace-nowrap">
                      {Number(sr.amount || 0).toFixed(2)} ج.م
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {filteredSubscriptionRevenues.length > 0 && (
              <tfoot>
                <tr className="bg-[#0A192F] text-white text-xs font-bold">
                  <td colSpan={4} className="py-3 px-4">
                    إجمالي إيرادات الاشتراكات خلال الفترة
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-[#FF7B00] whitespace-nowrap">
                    {totalSubscriptionRevenues.toFixed(2)} ج.م
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* SECTION E: Ad Revenues (إيرادات الإعلانات المدفوعة)                   */}
      {/* ===================================================================== */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-bold text-sm text-[#0A192F]">
              سجل إيرادات الإعلانات المدفوعة (advertisements)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {filteredPaidAds.length} إعلان مدفوع في الفترة ({dateFrom} ← {dateTo}) · الإجمالي:{' '}
              <strong className="font-mono tabular-nums text-[#FF7B00]">
                {totalAdRevenues.toFixed(2)} ج.م
              </strong>
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                <th className="py-3 px-4 whitespace-nowrap">المتجر</th>
                <th className="py-3 px-4 whitespace-nowrap">عنوان الإعلان</th>
                <th className="py-3 px-4 whitespace-nowrap">تاريخ البدء</th>
                <th className="py-3 px-4 whitespace-nowrap">تاريخ الانتهاء</th>
                <th className="py-3 px-4 whitespace-nowrap">المبلغ المدفوع</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredPaidAds.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-xs text-slate-400">
                    لا توجد إيرادات إعلانات مدفوعة مسجلة في الفترة المحددة
                  </td>
                </tr>
              ) : (
                filteredPaidAds.map((ad) => (
                  <tr key={ad.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-bold text-[#0A192F] whitespace-nowrap">
                      {merchantNameMap.get(ad.merchant_id) || ad.merchant_id}
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-700 whitespace-nowrap">
                      {ad.title}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                      {formatSubscriptionDate(ad.start_date)}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                      {formatSubscriptionDate(ad.end_date)}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums font-bold text-emerald-700 whitespace-nowrap">
                      {Number(ad.amount_paid || 0).toFixed(2)} ج.م
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {filteredPaidAds.length > 0 && (
              <tfoot>
                <tr className="bg-[#0A192F] text-white text-xs font-bold">
                  <td colSpan={4} className="py-3 px-4">
                    إجمالي إيرادات الإعلانات المدفوعة خلال الفترة
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-[#FF7B00] whitespace-nowrap">
                    {totalAdRevenues.toFixed(2)} ج.م
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 font-bold text-sm text-[#0A192F]">
          جدول المعاملات المالية للطلبات
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                <th className="py-3 px-4 whitespace-nowrap">رقم الطلب</th>
                <th className="py-3 px-4 whitespace-nowrap">مستحقات المتجر</th>
                <th className="py-3 px-4 whitespace-nowrap">إيراد هاتلي</th>
                <th className="py-3 px-4 whitespace-nowrap">عمولة المندوب</th>
                <th className="py-3 px-4 whitespace-nowrap">إجمالي المحصل</th>
                <th className="py-3 px-4 whitespace-nowrap">طريقة الدفع</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {nonCancelledOrders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-xs text-slate-400">
                    لا توجد معاملات مالية مسجلة في الفترة المحددة
                  </td>
                </tr>
              ) : (
                nonCancelledOrders.map((o) => {
                  const assignedRows = orderCouriersMap.get(o.id) || [];
                  const {
                    deliveryFeeNet,
                    merchantPayable,
                    hatlyNetRevenue,
                    courierCommission,
                    courierCount,
                  } = resolveOrderFinancials(o, commissionPct, assignedRows);
                  const delivered = isOrderDelivered(o.status);

                  return (
                    <tr key={o.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-4 font-mono tabular-nums font-bold text-[#0A192F] whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span>{o.order_number}</span>
                          <span
                            className={`text-[10px] font-sans font-bold ${
                              delivered ? 'text-emerald-700' : 'text-slate-400'
                            }`}
                          >
                            ({delivered ? 'تم التسليم' : o.status})
                          </span>
                        </div>
                        <div className="text-[11px] font-sans font-normal text-slate-500">
                          رسوم التوصيل: {deliveryFeeNet.toFixed(2)} ج.م · عمولة {commissionPct}%
                        </div>
                        {(o.is_large_order || courierCount > 1) && (
                          <div className="text-[11px] font-sans font-bold text-[#FF7B00]">
                            أوردر كبير ({courierCount} مناديب)
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums whitespace-nowrap">
                        {merchantPayable.toFixed(2)} ج.م
                      </td>
                      <td
                        className={`py-2.5 px-4 font-mono tabular-nums font-semibold whitespace-nowrap ${
                          hatlyNetRevenue < 0 ? 'text-red-600' : 'text-[#0A192F]'
                        }`}
                      >
                        {hatlyNetRevenue.toFixed(2)} ج.م
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums font-semibold text-emerald-700 whitespace-nowrap">
                        {courierCommission.toFixed(2)} ج.م
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums font-bold text-[#FF7B00] whitespace-nowrap">
                        {Number(o.total || 0).toFixed(2)} ج.م
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap text-xs font-semibold text-slate-700">
                        {isCashOnDelivery(o.payment_method) ? 'كاش (COD)' : 'بطاقة بنكية'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <RecordDepositModal
        open={depositModalOpen}
        onClose={() => setDepositModalOpen(false)}
        couriers={courierSummaries}
        commissionPct={commissionPct}
        initialCourierId={selectedCourierId}
        onSaved={(msg) => {
          setFeedback(msg);
          invalidateSummaryCache();
          loadFinancials(true);
        }}
      />

      <RecordMerchantPaymentModal
        open={merchantPaymentModalOpen}
        onClose={() => setMerchantPaymentModalOpen(false)}
        merchants={merchantSummaries}
        initialMerchantId={selectedMerchantId}
        initialShowUnsettledOrders={merchantModalShowUnsettled}
        onSaved={(msg) => {
          setFeedback(msg);
          invalidateSummaryCache();
          loadFinancials(true);
        }}
      />

      <AddExpenseModal
        open={expenseModalOpen}
        onClose={() => setExpenseModalOpen(false)}
        onSaved={(msg) => {
          setFeedback(msg);
          invalidateSummaryCache();
          loadFinancials(true);
        }}
      />

      {isAdmin && depositToDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-deposit-title"
          className="fixed inset-0 z-50 bg-[#0A192F]/60 flex items-center justify-center p-4"
        >
          <div
            dir="rtl"
            className="bg-white rounded-2xl border border-slate-200 w-full max-w-md p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3
                    id="delete-deposit-title"
                    className="text-base font-bold text-[#0A192F]"
                  >
                    مسح عملية التوريد
                  </h3>
                  <p className="text-xs text-slate-500">
                    {courierNameMap.get(depositToDelete.courier_id) ||
                      depositToDelete.courier_id}{' '}
                    ·{' '}
                    <span className="font-mono tabular-nums font-bold text-red-600">
                      {Number(depositToDelete.amount || 0).toFixed(2)} ج.م
                    </span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={deletingDepositId !== null}
                onClick={() => {
                  setDepositToDelete(null);
                  setDeleteDepositError(null);
                }}
                aria-label="إغلاق"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-slate-700 leading-relaxed font-semibold">
              هل أنت متأكد من مسح عملية التوريد هذه؟ سيتم إرجاع المبلغ لعهدة المندوب.
            </p>

            {deleteDepositError && (
              <div
                role="alert"
                className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{deleteDepositError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={deletingDepositId !== null}
                onClick={() => {
                  setDepositToDelete(null);
                  setDeleteDepositError(null);
                }}
                className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={deletingDepositId !== null}
                onClick={handleConfirmDeleteDeposit}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
              >
                {deletingDepositId !== null ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                <span>تأكيد المسح</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function SettingsView() {
  const [percentage, setPercentage] = useState<string>('70');
  const [dailyLimit, setDailyLimit] = useState<string>(
    String(DEFAULT_DAILY_CASH_LIMIT)
  );
  const [maxLimit, setMaxLimit] = useState<string>(
    String(DEFAULT_MAX_CASH_LIMIT)
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingLimits, setSavingLimits] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limitsFeedback, setLimitsFeedback] = useState<string | null>(null);
  const [limitsError, setLimitsError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchCourierCommissionPct(), fetchCashLimits()]).then(
      ([pct, limits]) => {
        setPercentage(String(pct));
        setDailyLimit(String(limits.dailyLimit));
        setMaxLimit(String(limits.maxLimit));
        setLoading(false);
      }
    );
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setError(null);

    const num = Number(percentage);
    if (!Number.isFinite(num) || num < 0 || num > 100) {
      setError('يرجى إدخال نسبة مئوية صحيحة بين 0 و 100');
      return;
    }

    setSaving(true);
    const { error: saveErr } = await saveCourierCommissionPct(num);
    setSaving(false);

    if (saveErr) {
      setError(saveErr);
      return;
    }

    setFeedback(`تم حفظ نسبة عمولة المندوب (${num}%) في system_settings بنجاح`);
  };

  const handleSaveCashLimits = async (e: React.FormEvent) => {
    e.preventDefault();
    setLimitsFeedback(null);
    setLimitsError(null);

    const dailyNum = Number(dailyLimit);
    const maxNum = Number(maxLimit);

    if (!Number.isFinite(dailyNum) || dailyNum <= 0) {
      setLimitsError('يرجى إدخال قيمة صحيحة أكبر من صفر للحد اليومي لكاش المندوب');
      return;
    }
    if (!Number.isFinite(maxNum) || maxNum < dailyNum) {
      setLimitsError(
        'الحد الأقصى لكاش المندوب يجب أن يكون أكبر من أو يساوي الحد اليومي'
      );
      return;
    }

    setSavingLimits(true);
    const { error: saveErr } = await saveCashLimits(dailyNum, maxNum);
    setSavingLimits(false);

    if (saveErr) {
      setLimitsError(saveErr);
      return;
    }

    setLimitsFeedback(
      `تم حفظ حدود كاش المندوب (اليومي: ${dailyNum.toFixed(0)} ج.م — الأقصى: ${maxNum.toFixed(0)} ج.م) في system_settings بنجاح`
    );
  };

  if (loading) {
    return (
      <div className="p-12 flex justify-center">
        <Loader2 className="w-6 h-6 text-[#FF7B00] animate-spin" />
      </div>
    );
  }

  const parsedPct = Number(percentage);
  const validPct = Number.isFinite(parsedPct)
    ? Math.max(0, Math.min(100, parsedPct))
    : 70;

  const parsedDaily = Number(dailyLimit) || DEFAULT_DAILY_CASH_LIMIT;
  const parsedMax = Number(maxLimit) || DEFAULT_MAX_CASH_LIMIT;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
          <div className="w-10 h-10 rounded-xl bg-[#0A192F] text-[#FF7B00] flex items-center justify-center">
            <Percent className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#0A192F]">
              إعدادات تقسيم رسوم التوصيل
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              تعديل نسبة عمولة المندوب (courier_commission_percentage) في جدول system_settings
            </p>
          </div>
        </div>

        {feedback && (
          <div className="flex items-center gap-2 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{feedback}</span>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-5">
          <div>
            <label
              htmlFor="courier-commission-pct"
              className="block text-sm font-bold text-[#0A192F] mb-2"
            >
              نسبة عمولة المندوب (%)
            </label>
            <input
              id="courier-commission-pct"
              type="number"
              min={0}
              max={100}
              step="1"
              value={percentage}
              onChange={(e) => setPercentage(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 text-base font-mono tabular-nums font-bold text-[#0A192F] focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
            />
          </div>

          <div className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200 text-sm">
            <div>
              <div className="text-xs text-slate-500">حصة المندوب</div>
              <div className="text-lg font-extrabold text-emerald-700 font-mono tabular-nums mt-1">
                {validPct}%
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">صافي إيراد هاتلي</div>
              <div className="text-lg font-extrabold text-[#FF7B00] font-mono tabular-nums mt-1">
                {(100 - validPct).toFixed(0)}%
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#FF7B00] hover:bg-[#E56E00] disabled:opacity-60 text-white text-sm font-bold cursor-pointer"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              <span>حفظ</span>
            </button>
          </div>
        </form>
      </div>

      {/* Courier Cash Limits Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
          <div className="w-10 h-10 rounded-xl bg-[#0A192F] text-[#FF7B00] flex items-center justify-center">
            <Wallet className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#0A192F]">
              إعدادات حد الكاش للمندوب (إدارة المخاطر)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              تحديد الحد اليومي والحد الأقصى لرصيد الكاش في جدول system_settings
            </p>
          </div>
        </div>

        {limitsFeedback && (
          <div className="flex items-center gap-2 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{limitsFeedback}</span>
          </div>
        )}

        {limitsError && (
          <div className="flex items-center gap-2 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{limitsError}</span>
          </div>
        )}

        <form onSubmit={handleSaveCashLimits} className="space-y-5">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="courier-daily-cash-limit"
                className="block text-sm font-bold text-[#0A192F] mb-2"
              >
                الحد اليومي لكاش المندوب (ج.م)
              </label>
              <input
                id="courier-daily-cash-limit"
                type="number"
                min={1}
                step="10"
                required
                value={dailyLimit}
                onChange={(e) => setDailyLimit(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 text-base font-mono tabular-nums font-bold text-[#0A192F] focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
              />
            </div>

            <div>
              <label
                htmlFor="courier-max-cash-limit"
                className="block text-sm font-bold text-[#0A192F] mb-2"
              >
                الحد الأقصى لكاش المندوب (ج.م)
              </label>
              <input
                id="courier-max-cash-limit"
                type="number"
                min={1}
                step="10"
                required
                value={maxLimit}
                onChange={(e) => setMaxLimit(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 text-base font-mono tabular-nums font-bold text-[#0A192F] focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
              />
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1.5 leading-relaxed">
            <div>
              • عند وصول رصيد كاش المندوب (المحصّل − التوريدات) إلى{' '}
              <strong className="font-mono text-[#0A192F]">
                {parsedDaily.toFixed(0)} ج.م
              </strong>
              : يكمل ورديته اليوم، وفي اليوم التالي (الساعة 12:00 ص) يتحول تلقائياً إلى غير متصل حتى يتم التوريد.
            </div>
            <div>
              • عند وصول رصيد كاش المندوب إلى{' '}
              <strong className="font-mono text-red-700">
                {parsedMax.toFixed(0)} ج.م
              </strong>
              : يتم إيقاف الحساب فوراً وتحويل المندوب إلى صفحة التوريد الإجبارية حتى ينخفض رصيده عن{' '}
              <strong className="font-mono text-emerald-700">
                {parsedDaily.toFixed(0)} ج.م
              </strong>
              .
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingLimits}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#0A192F] hover:bg-[#112240] disabled:opacity-60 text-white text-sm font-bold cursor-pointer"
            >
              {savingLimits ? (
                <Loader2 className="w-4 h-4 animate-spin text-[#FF7B00]" />
              ) : (
                <Save className="w-4 h-4 text-[#FF7B00]" />
              )}
              <span>حفظ حدود الكاش</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function SettlementsView() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });
    setOrders((data as Order[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const markPaid = async (orderId: string) => {
    await supabase
      .from('orders')
      .update({ payment_status: 'paid' })
      .eq('id', orderId);
    await load();
  };

  if (loading) {
    return (
      <div className="p-12 flex justify-center">
        <Loader2 className="w-6 h-6 text-[#FF7B00] animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="p-4 border-b border-slate-200 flex items-center justify-between">
        <div className="font-bold text-sm text-[#0A192F]">
          التسويات وحالات التحصيل والمدفوعات
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>تحديث</span>
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-right text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
              <th className="py-3 px-4">رقم الطلب</th>
              <th className="py-3 px-4">العميل</th>
              <th className="py-3 px-4">الطريقة</th>
              <th className="py-3 px-4">الإجمالي</th>
              <th className="py-3 px-4">حالة التحصيل</th>
              <th className="py-3 px-4">إجراء</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {orders.map((o) => (
              <tr key={o.id}>
                <td className="py-2.5 px-4 font-mono tabular-nums font-bold">
                  {o.order_number}
                </td>
                <td className="py-2.5 px-4">{o.customer_name}</td>
                <td className="py-2.5 px-4">
                  {o.payment_method === 'card' ? 'بطاقة' : 'كاش'}
                </td>
                <td className="py-2.5 px-4 font-mono tabular-nums font-bold">
                  {Number(o.total || 0).toFixed(2)} ج.م
                </td>
                <td
                  className={`py-2.5 px-4 text-xs font-bold ${
                    o.payment_status === 'paid'
                      ? 'text-emerald-700'
                      : 'text-amber-700'
                  }`}
                >
                  {o.payment_status === 'paid' ? 'تم التحصيل' : 'غير محصّل'}
                </td>
                <td className="py-2.5 px-4">
                  {o.payment_status !== 'paid' && (
                    <button
                      type="button"
                      onClick={() => markPaid(o.id)}
                      className="px-3 py-1 rounded-lg bg-[#0A192F] text-white text-xs font-semibold cursor-pointer"
                    >
                      تأكيد التحصيل
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AuditView() {
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('orders')
      .select('id, order_number, status, courier_id, customer_name, created_at')
      .order('created_at', { ascending: false })
      .limit(25)
      .then(({ data }) => {
        setRecentOrders((data as Order[]) || []);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="p-12 flex justify-center">
        <Loader2 className="w-6 h-6 text-[#FF7B00] animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="p-4 border-b border-slate-200 font-bold text-sm text-[#0A192F]">
        سجل المراجعة والعمليات الأخيرة
      </div>
      <div className="divide-y divide-slate-100">
        {recentOrders.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            لا توجد عمليات مسجلة بعد
          </div>
        ) : (
          recentOrders.map((o) => (
            <div
              key={o.id}
              className="p-4 flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              <div>
                <span className="font-mono tabular-nums font-bold text-[#0A192F]">
                  {o.order_number}
                </span>{' '}
                <span className="text-slate-400">·</span>{' '}
                <span className="text-slate-700">
                  طلب للعميل {o.customer_name} — الحالة الحالية: {o.status}
                </span>
              </div>
              <span className="text-xs font-mono tabular-nums text-slate-400">
                {new Date(o.created_at).toLocaleString('ar-EG')}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const ROLE_BADGES: Record<UserRole, { label: string; badgeClass: string }> = {
  admin: {
    label: 'مدير (Admin)',
    badgeClass: 'bg-[#0B1A33] text-white',
  },
  operations: {
    label: 'مشرف (Operations)',
    badgeClass: 'bg-[#FF7F00]/15 text-[#FF7F00] border border-[#FF7F00]/30',
  },
  support: {
    label: 'علاقات عامة (Support)',
    badgeClass: 'bg-sky-100 text-sky-800 border border-sky-200',
  },
  finance: {
    label: 'محاسب (Finance)',
    badgeClass: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  },
  merchant: {
    label: 'متجر (Merchant)',
    badgeClass: 'bg-indigo-100 text-indigo-800 border border-indigo-200',
  },
  courier: {
    label: 'مندوب (Courier)',
    badgeClass: 'bg-amber-100 text-amber-800 border border-amber-200',
  },
};

export function UsersView() {
  const { role: currentUserRole, user: currentUser, refreshProfile } = useAuth();
  const isAdmin = currentUserRole === 'admin';

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Granular Permissions Modal State (Admin Only)
  const [permTarget, setPermTarget] = useState<Profile | null>(null);
  const [permModalRole, setPermModalRole] = useState<UserRole>('operations');
  const [permModalMap, setPermModalMap] = useState<
    Record<DashboardSection, boolean>
  >(() => getDefaultPermissionsForRole('operations'));
  const [savingPermissions, setSavingPermissions] = useState(false);
  const [permError, setPermError] = useState<string | null>(null);

  // Add Team Member Modal State (Admin Only)
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selectedRole, setSelectedRole] = useState<UserRole>('operations');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Delete Account Modal State (Admin Only)
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      setFeedback({ type: 'error', text: `تعذر تحميل المستخدمين: ${error.message}` });
      setProfiles([]);
    } else {
      setProfiles((data as Profile[]) || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  const openPermissionsModal = (profile: Profile) => {
    if (!isAdmin) return;
    const normalized = normalizePermissionsObject(profile.permissions);
    setPermTarget(profile);
    setPermModalRole(profile.role);
    setPermModalMap(resolveEffectivePermissions(profile.role, normalized));
    setPermError(null);
  };

  const handleSavePermissions = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !permTarget) return;

    setPermError(null);
    setSavingPermissions(true);

    const permissionsPayload: Record<DashboardSection, boolean> = {
      ...permModalMap,
    };
    const hasOverride = hasCustomPermissionsOverride(
      permModalRole,
      permModalMap
    );

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          role: permModalRole,
          permissions: permissionsPayload,
        })
        .eq('id', permTarget.id);

      if (error) {
        const lower = `${error.code || ''} ${error.message || ''}`.toLowerCase();
        if (
          lower.includes('permissions') &&
          (lower.includes('column') || lower.includes('schema'))
        ) {
          if (!hasOverride) {
            const { error: roleOnlyErr } = await supabase
              .from('profiles')
              .update({ role: permModalRole })
              .eq('id', permTarget.id);
            if (roleOnlyErr) {
              throw new Error(`تعذر تعديل الصلاحية: ${roleOnlyErr.message}`);
            }
          } else {
            throw new Error(
              'عمود permissions غير موجود بعد في جدول profiles. يرجى تنفيذ كود SQL الخاص بإضافة العمود في Supabase أولاً.'
            );
          }
        } else {
          throw new Error(`تعذر حفظ الصلاحيات: ${error.message}`);
        }
      }

      setProfiles((prev) =>
        prev.map((p) =>
          p.id === permTarget.id
            ? {
                ...p,
                role: permModalRole,
                permissions: permissionsPayload,
              }
            : p
        )
      );

      if (permTarget.id === currentUser?.id) {
        await refreshProfile();
      }

      const enabledCount = DASHBOARD_MODULES.filter(
        (m) => permModalMap[m.id]
      ).length;
      const targetName =
        permTarget.full_name || permTarget.email || 'المستخدم';
      setPermTarget(null);
      setFeedback({
        type: 'success',
        text: `تم حفظ صلاحيات "${targetName}" بنجاح (${enabledCount} قسم مفعّل من أصل ${DASHBOARD_MODULES.length}).`,
      });
    } catch (err) {
      setPermError(
        err instanceof Error ? err.message : 'حدث خطأ أثناء حفظ الصلاحيات'
      );
    } finally {
      setSavingPermissions(false);
    }
  };

  const handleResetPermissionsToNull = async () => {
    if (!isAdmin || !permTarget) return;
    setPermError(null);
    setSavingPermissions(true);

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          role: permModalRole,
          permissions: null,
        })
        .eq('id', permTarget.id);

      if (error) {
        throw new Error(`تعذر استعادة الافتراضيات: ${error.message}`);
      }

      setProfiles((prev) =>
        prev.map((p) =>
          p.id === permTarget.id
            ? { ...p, role: permModalRole, permissions: null }
            : p
        )
      );

      if (permTarget.id === currentUser?.id) {
        await refreshProfile();
      }

      const targetName =
        permTarget.full_name || permTarget.email || 'المستخدم';
      setPermTarget(null);
      setFeedback({
        type: 'success',
        text: `تمت استعادة الصلاحيات الافتراضية لدور "${ROLE_BADGES[permModalRole]?.label || permModalRole}" لحساب "${targetName}".`,
      });
    } catch (err) {
      setPermError(
        err instanceof Error ? err.message : 'تعذر استعادة الافتراضيات'
      );
    } finally {
      setSavingPermissions(false);
    }
  };

  const handleToggleSuspend = async (profile: Profile) => {
    if (!isAdmin) return;
    if (profile.id === currentUser?.id) {
      setFeedback({
        type: 'error',
        text: 'لا يمكنك حظر حساب المدير الحالي المسجّل به حالياً',
      });
      return;
    }

    const currentlyActive =
      profile.is_active !== false && profile.status !== 'suspended';
    const nextActive = !currentlyActive;
    const nextStatus = nextActive ? 'active' : 'suspended';

    setBusyId(profile.id);
    const { error } = await supabase
      .from('profiles')
      .update({ is_active: nextActive, status: nextStatus })
      .eq('id', profile.id);
    setBusyId(null);

    if (error) {
      setFeedback({
        type: 'error',
        text: `تعذر تحديث حالة الحساب: ${error.message}`,
      });
      return;
    }

    setProfiles((prev) =>
      prev.map((p) =>
        p.id === profile.id
          ? { ...p, is_active: nextActive, status: nextStatus }
          : p
      )
    );
    setFeedback({
      type: 'success',
      text: nextActive
        ? `تم تفعيل حساب "${profile.full_name || profile.email}" بنجاح`
        : `تم حظر حساب "${profile.full_name || profile.email}" ومنعه من تسجيل الدخول`,
    });
  };

  const openDeleteUserModal = (profile: Profile) => {
    if (!isAdmin) return;
    if (profile.id === currentUser?.id) {
      setFeedback({
        type: 'error',
        text: 'لا يمكنك حذف حساب المدير الحالي المسجّل به حالياً',
      });
      return;
    }
    setDeleteError(null);
    setDeleteTarget(profile);
  };

  const handleConfirmDeleteUser = async () => {
    if (!isAdmin || !deleteTarget) return;

    if (deleteTarget.id === currentUser?.id) {
      setDeleteError('لا يمكنك حذف حساب المدير الحالي المسجّل به حالياً');
      return;
    }

    const DEPENDENCY_ERROR_MSG =
      'لا يمكن حذف هذا الحساب لوجود طلبات مرتبطة به. يرجى حظره بدلاً من ذلك.';

    setDeletingUser(true);
    setDeleteError(null);

    try {
      // 1. Check for linked role entities & orders before deleting
      const [courierRes, merchantRes, customerRes] = await Promise.all([
        supabase
          .from('couriers')
          .select('id')
          .eq('profile_id', deleteTarget.id),
        supabase
          .from('merchants')
          .select('id')
          .eq('profile_id', deleteTarget.id),
        supabase
          .from('customers')
          .select('id')
          .eq('profile_id', deleteTarget.id),
      ]);

      const courierIds = (courierRes.data || []).map((r: { id: string }) => r.id);
      const merchantIds = (merchantRes.data || []).map((r: { id: string }) => r.id);
      const customerIds = (customerRes.data || []).map((r: { id: string }) => r.id);

      const orderFilterParts: string[] = [
        `customer_id.eq.${deleteTarget.id}`,
        `merchant_id.eq.${deleteTarget.id}`,
        `courier_id.eq.${deleteTarget.id}`,
      ];
      courierIds.forEach((cid) => orderFilterParts.push(`courier_id.eq.${cid}`));
      merchantIds.forEach((mid) => orderFilterParts.push(`merchant_id.eq.${mid}`));
      customerIds.forEach((cuid) =>
        orderFilterParts.push(`customer_id.eq.${cuid}`)
      );

      const { count: linkedOrdersCount, error: ordersErr } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .or(orderFilterParts.join(','));

      if (!ordersErr && (linkedOrdersCount ?? 0) > 0) {
        setDeleteError(DEPENDENCY_ERROR_MSG);
        return;
      }

      // 2. Try deleting from auth.users first (cascades to profiles when permitted)
      let deletedFromAuth = false;
      try {
        const { error: authDelErr } = await supabase.auth.admin.deleteUser(
          deleteTarget.id
        );
        if (!authDelErr) {
          deletedFromAuth = true;
        } else {
          const msg = authDelErr.message?.toLowerCase() || '';
          if (
            msg.includes('foreign key') ||
            msg.includes('constraint') ||
            msg.includes('orders') ||
            msg.includes('violates')
          ) {
            setDeleteError(DEPENDENCY_ERROR_MSG);
            return;
          }
        }
      } catch {
        // Fallback to profiles & role cleanup if client does not hold service_role
      }

      if (!deletedFromAuth) {
        // Clean up role-specific records if present and unlinked
        if (courierIds.length > 0) {
          const { error: cErr } = await supabase
            .from('couriers')
            .delete()
            .in('id', courierIds);
          if (cErr) {
            const cMsg = `${cErr.code || ''} ${cErr.message || ''}`.toLowerCase();
            if (
              cMsg.includes('23503') ||
              cMsg.includes('foreign key') ||
              cMsg.includes('constraint')
            ) {
              setDeleteError(DEPENDENCY_ERROR_MSG);
              return;
            }
          }
        }

        if (merchantIds.length > 0) {
          const { error: mErr } = await supabase
            .from('merchants')
            .delete()
            .in('id', merchantIds);
          if (mErr) {
            const mMsg = `${mErr.code || ''} ${mErr.message || ''}`.toLowerCase();
            if (
              mMsg.includes('23503') ||
              mMsg.includes('foreign key') ||
              mMsg.includes('constraint')
            ) {
              setDeleteError(DEPENDENCY_ERROR_MSG);
              return;
            }
          }
        }

        if (customerIds.length > 0) {
          const { error: cuErr } = await supabase
            .from('customers')
            .delete()
            .in('id', customerIds);
          if (cuErr) {
            const cuMsg = `${cuErr.code || ''} ${cuErr.message || ''}`.toLowerCase();
            if (
              cuMsg.includes('23503') ||
              cuMsg.includes('foreign key') ||
              cuMsg.includes('constraint')
            ) {
              setDeleteError(DEPENDENCY_ERROR_MSG);
              return;
            }
          }
        }

        const { error: profDelErr } = await supabase
          .from('profiles')
          .delete()
          .eq('id', deleteTarget.id);

        if (profDelErr) {
          const pMsg =
            `${profDelErr.code || ''} ${profDelErr.message || ''}`.toLowerCase();
          if (
            pMsg.includes('23503') ||
            pMsg.includes('foreign key') ||
            pMsg.includes('constraint') ||
            pMsg.includes('violates') ||
            pMsg.includes('orders')
          ) {
            setDeleteError(DEPENDENCY_ERROR_MSG);
            return;
          }
          throw new Error(`تعذر حذف الحساب: ${profDelErr.message}`);
        }
      }

      const deletedName =
        deleteTarget.full_name || deleteTarget.email || 'المستخدم';
      setProfiles((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      setDeleteTarget(null);
      setFeedback({
        type: 'success',
        text: `تم حذف حساب "${deletedName}" نهائياً من النظام.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      const lower = msg.toLowerCase();
      if (
        lower.includes('23503') ||
        lower.includes('foreign key') ||
        lower.includes('constraint') ||
        lower.includes('violates')
      ) {
        setDeleteError(DEPENDENCY_ERROR_MSG);
      } else {
        setDeleteError(msg || 'حدث خطأ أثناء حذف الحساب');
      }
    } finally {
      setDeletingUser(false);
    }
  };

  const handleCreateTeamMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setFormError(null);

    if (!fullName.trim() || !phone.trim() || !email.trim() || password.length < 6) {
      setFormError(
        'يرجى إدخال الاسم والهاتف والبريد الإلكتروني وكلمة مرور لا تقل عن 6 أحرف'
      );
      return;
    }

    setSubmitting(true);
    try {
      const { data: signUpData, error: signUpError } =
        await supabaseSignUpClient.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              full_name: fullName.trim(),
              phone: phone.trim(),
              role: selectedRole,
            },
          },
        });

      if (signUpError || !signUpData.user) {
        throw new Error(
          signUpError?.message || 'تعذر إنشاء حساب المستخدم في نظام المصادقة'
        );
      }

      const { error: profileErr } = await supabase.from('profiles').upsert({
        id: signUpData.user.id,
        full_name: fullName.trim(),
        phone: phone.trim(),
        email: email.trim(),
        role: selectedRole,
        status: 'active',
        is_active: true,
      });

      if (profileErr) {
        throw new Error(`تعذر حفظ بيانات المستخدم: ${profileErr.message}`);
      }

      setFeedback({
        type: 'success',
        text: `تم إنشاء حساب "${fullName.trim()}" بصلاحية (${ROLE_BADGES[selectedRole]?.label}) وتفعيله بنجاح`,
      });
      setAddModalOpen(false);
      setFullName('');
      setPhone('');
      setEmail('');
      setPassword('');
      setSelectedRole('operations');
      await loadProfiles();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-12 flex justify-center">
        <Loader2 className="w-6 h-6 text-[#FF7F00] animate-spin" />
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-5">
      {feedback && (
        <div
          role="status"
          className={`flex items-center justify-between gap-3 p-4 rounded-xl border text-sm font-semibold ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs underline cursor-pointer"
          >
            إخفاء
          </button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-[#0B1A33] text-[#FF7F00] flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-sm text-[#0B1A33]">
                إدارة الفريق والمستخدمين والصلاحيات (RBAC)
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                إضافة أعضاء فريق العمل (العمليات، الدعم، المالية) والتحكم في الصلاحيات والحظر
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadProfiles}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>تحديث</span>
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => {
                  setFormError(null);
                  setAddModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#FF7F00] hover:bg-[#E57000] text-white text-xs font-bold cursor-pointer whitespace-nowrap"
              >
                <UserPlus className="w-4 h-4" />
                <span>إضافة مستخدم جديد</span>
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                <th className="py-3 px-4 whitespace-nowrap">الاسم</th>
                <th className="py-3 px-4 whitespace-nowrap">البريد الإلكتروني</th>
                <th className="py-3 px-4 whitespace-nowrap">الهاتف</th>
                <th className="py-3 px-4 whitespace-nowrap">الصلاحية / الدور</th>
                <th className="py-3 px-4 whitespace-nowrap">حالة الحساب</th>
                {isAdmin && (
                  <th className="py-3 px-4 whitespace-nowrap">الإجراءات</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {profiles.map((p) => {
                const roleMeta = ROLE_BADGES[p.role] || {
                  label: p.role,
                  badgeClass: 'bg-slate-100 text-slate-700',
                };
                const isActive =
                  p.is_active !== false && p.status !== 'suspended';
                const customPerms = normalizePermissionsObject(p.permissions);
                const isCustomized = hasCustomPermissionsOverride(
                  p.role,
                  customPerms
                );

                return (
                  <tr
                    key={p.id}
                    className={`hover:bg-slate-50/70 ${!isActive ? 'opacity-65 bg-red-50/20' : ''}`}
                  >
                    <td className="py-3 px-4 font-bold text-[#0B1A33] whitespace-nowrap">
                      {p.full_name || '—'}
                    </td>
                    <td
                      className="py-3 px-4 text-slate-600 whitespace-nowrap text-right"
                      dir="ltr"
                    >
                      {p.email || '—'}
                    </td>
                    <td
                      className="py-3 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap text-right"
                      dir="ltr"
                    >
                      {p.phone || '—'}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold ${roleMeta.badgeClass}`}
                        >
                          {roleMeta.label}
                        </span>
                        {isCustomized && (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#FF7F00]/15 text-[#FF7F00] border border-[#FF7F00]/30">
                            صلاحيات مخصصة
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold ${
                          isActive
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-red-100 text-[#EF2323]'
                        }`}
                      >
                        {isActive ? 'نشط' : 'محظور'}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={busyId === p.id}
                            onClick={() => openPermissionsModal(p)}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-[#0B1A33] cursor-pointer"
                          >
                            تعديل الصلاحية
                          </button>

                          <button
                            type="button"
                            disabled={busyId === p.id || p.id === currentUser?.id}
                            onClick={() => handleToggleSuspend(p)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-40 ${
                              isActive
                                ? 'bg-[#EF2323] hover:bg-red-700 text-white'
                                : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                            }`}
                          >
                            <Ban className="w-3 h-3" />
                            <span>{isActive ? 'حظر' : 'تفعيل'}</span>
                          </button>

                          <button
                            type="button"
                            disabled={busyId === p.id || p.id === currentUser?.id}
                            onClick={() => openDeleteUserModal(p)}
                            title={
                              p.id === currentUser?.id
                                ? 'لا يمكنك حذف حسابك الشخصي'
                                : 'حذف الحساب نهائياً'
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#EF2323] hover:bg-red-700 text-white text-xs font-bold cursor-pointer disabled:opacity-40"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>حذف</span>
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add New Team Member Modal (Admin Only) */}
      {addModalOpen && isAdmin && (
        <div className="fixed inset-0 z-50 bg-[#0B1A33]/65 flex items-center justify-center p-4 overflow-y-auto">
          <div
            dir="rtl"
            className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg p-6 space-y-5 my-8"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-[#0B1A33] text-[#FF7F00] flex items-center justify-center">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#0B1A33]">
                    إضافة مستخدم جديد للفريق
                  </h3>
                  <p className="text-xs text-slate-500">
                    إنشاء حساب عضو فريق العمل وتحديد صلاحياته بدقة
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAddModalOpen(false)}
                aria-label="إغلاق"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div
                role="alert"
                className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleCreateTeamMember} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    الاسم الكامل <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="مثال: سارة أحمد"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    رقم الهاتف <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="tel"
                    required
                    dir="ltr"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="010XXXXXXXX"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-left font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    البريد الإلكتروني <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    dir="ltr"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="member@hatly.app"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-left"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    كلمة المرور <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    dir="ltr"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-left"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  الدور الوظيفي والصلاحيات <span className="text-red-600">*</span>
                </label>
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value as UserRole)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-sm font-bold text-[#0B1A33]"
                >
                  <option value="admin">مدير النظام — Admin (كامل الصلاحيات)</option>
                  <option value="operations">
                    مشرف عمليات — Operations (الطلبات، المناديب، الورديات، المتاجر، العملاء، المناطق)
                  </option>
                  <option value="support">
                    علاقات عامة ودعم — Support (العملاء، المتاجر، الشكاوى)
                  </option>
                  <option value="finance">
                    محاسب ومالية — Finance (المالية، التسويات، سجل المراجعة)
                  </option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setAddModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#FF7F00] hover:bg-[#E57000] disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
                >
                  {submitting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <UserPlus className="w-3.5 h-3.5" />
                  )}
                  <span>إنشاء الحساب وتفعيله</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Delete Account Confirmation Modal (Admin Only) */}
      {deleteTarget && isAdmin && (
        <div className="fixed inset-0 z-50 bg-[#0B1A33]/65 flex items-center justify-center p-4 overflow-y-auto">
          <div
            dir="rtl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-user-dialog-title"
            className="bg-white rounded-2xl border border-slate-200 w-full max-w-md p-6 space-y-4 my-8"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-red-50 border border-red-200 text-[#EF2323] flex items-center justify-center shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <h3
                  id="delete-user-dialog-title"
                  className="text-base font-bold text-[#0B1A33]"
                >
                  حذف الحساب
                </h3>
              </div>
              <button
                type="button"
                disabled={deletingUser}
                onClick={() => setDeleteTarget(null)}
                aria-label="إغلاق"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <div className="text-sm font-bold text-[#0B1A33]">
                {deleteTarget.full_name || 'مستخدم'}
              </div>
              <div
                className="text-xs text-slate-500 font-mono tabular-nums"
                dir="ltr"
              >
                {deleteTarget.email || '—'} · {deleteTarget.phone || '—'}
              </div>
            </div>

            <p className="text-sm font-semibold text-[#0B1A33] leading-relaxed">
              هل أنت متأكد من حذف هذا الحساب نهائياً؟ لا يمكن التراجع عن هذه الخطوة.
            </p>

            {deleteError && (
              <div
                role="alert"
                className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold leading-relaxed"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{deleteError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                disabled={deletingUser}
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={deletingUser || deleteTarget.id === currentUser?.id}
                onClick={handleConfirmDeleteUser}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#EF2323] hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
              >
                {deletingUser ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                <span>تأكيد الحذف النهائي</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Granular Permissions Modal (Admin Only) */}
      {permTarget && isAdmin && (
        <div className="fixed inset-0 z-50 bg-[#0B1A33]/65 flex items-center justify-center p-4 overflow-y-auto">
          <div
            dir="rtl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-permissions-dialog-title"
            className="bg-white rounded-2xl border border-slate-200 w-full max-w-2xl p-6 space-y-5 my-8"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-[#0B1A33] text-[#FF7F00] flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3
                    id="edit-permissions-dialog-title"
                    className="text-base font-bold text-[#0B1A33]"
                  >
                    تعديل الدور والصلاحيات المخصصة
                  </h3>
                  <p className="text-xs text-slate-500">
                    {permTarget.full_name || 'مستخدم'} ·{' '}
                    <span dir="ltr" className="font-mono">
                      {permTarget.email || permTarget.phone || '—'}
                    </span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={savingPermissions}
                onClick={() => setPermTarget(null)}
                aria-label="إغلاق"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {permError && (
              <div
                role="alert"
                className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold leading-relaxed"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{permError}</span>
              </div>
            )}

            <form onSubmit={handleSavePermissions} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-3 items-end">
                <div>
                  <label
                    htmlFor="perm-modal-role"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    الدور الأساسي (Role)
                  </label>
                  <select
                    id="perm-modal-role"
                    value={permModalRole}
                    onChange={(e) => {
                      const nextRole = e.target.value as UserRole;
                      setPermModalRole(nextRole);
                      setPermModalMap(getDefaultPermissionsForRole(nextRole));
                    }}
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-sm font-bold text-[#0B1A33] focus:outline-none focus:ring-2 focus:ring-[#FF7F00]/30 focus:border-[#FF7F00]"
                  >
                    <option value="admin">مدير (Admin)</option>
                    <option value="operations">مشرف عمليات (Operations)</option>
                    <option value="support">علاقات عامة / دعم (Support)</option>
                    <option value="finance">محاسب / مالية (Finance)</option>
                    <option value="merchant">متجر (Merchant)</option>
                    <option value="courier">مندوب (Courier)</option>
                  </select>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setPermModalMap(getDefaultPermissionsForRole(permModalRole))
                    }
                    className="px-2.5 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-[#0B1A33] cursor-pointer"
                  >
                    افتراضيات الدور
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const allTrue = {} as Record<DashboardSection, boolean>;
                      DASHBOARD_MODULES.forEach((m) => {
                        allTrue[m.id] = true;
                      });
                      setPermModalMap(allTrue);
                    }}
                    className="px-2.5 py-2 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-xs font-semibold text-emerald-800 cursor-pointer"
                  >
                    تحديد الكل
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const allFalse = {} as Record<DashboardSection, boolean>;
                      DASHBOARD_MODULES.forEach((m) => {
                        allFalse[m.id] = false;
                      });
                      setPermModalMap(allFalse);
                    }}
                    className="px-2.5 py-2 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-xs font-semibold text-[#EF2323] cursor-pointer"
                  >
                    إلغاء الكل
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-[#0B1A33]">
                    صلاحيات الوصول للأقسام والصفحات
                  </span>
                  <span className="text-slate-500 font-mono tabular-nums">
                    المفعّل:{' '}
                    <strong className="text-[#FF7F00]">
                      {
                        DASHBOARD_MODULES.filter((m) => permModalMap[m.id])
                          .length
                      }
                    </strong>{' '}
                    / {DASHBOARD_MODULES.length}
                  </span>
                </div>

                <div className="grid sm:grid-cols-2 gap-2.5 max-h-80 overflow-y-auto p-3 rounded-xl bg-slate-50 border border-slate-200">
                  {DASHBOARD_MODULES.map((mod) => {
                    const checked = Boolean(permModalMap[mod.id]);
                    return (
                      <div
                        key={mod.id}
                        onClick={() =>
                          setPermModalMap((prev) => ({
                            ...prev,
                            [mod.id]: !prev[mod.id],
                          }))
                        }
                        className={`flex items-center justify-between gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          checked
                            ? 'bg-white border-[#FF7F00] text-[#0B1A33]'
                            : 'bg-white/70 border-slate-200 text-slate-500 hover:border-slate-300'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-bold truncate">
                            {mod.label}
                          </div>
                          <div className="text-[11px] text-slate-400 leading-snug mt-0.5">
                            {mod.description}
                          </div>
                        </div>

                        <button
                          type="button"
                          dir="ltr"
                          role="switch"
                          aria-checked={checked}
                          aria-label={mod.label}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPermModalMap((prev) => ({
                              ...prev,
                              [mod.id]: !prev[mod.id],
                            }));
                          }}
                          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                            checked ? 'bg-[#FF7F00]' : 'bg-slate-300'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              checked ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  disabled={savingPermissions}
                  onClick={handleResetPermissionsToNull}
                  className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                >
                  استعادة افتراضي الدور (NULL)
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={savingPermissions}
                    onClick={() => setPermTarget(null)}
                    className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={savingPermissions}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#FF7F00] hover:bg-[#E57000] disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
                  >
                    {savingPermissions ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Save className="w-3.5 h-3.5" />
                    )}
                    <span>حفظ</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
