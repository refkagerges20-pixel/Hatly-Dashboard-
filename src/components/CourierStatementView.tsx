import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  ExternalLink,
  Loader2,
  Receipt,
  RefreshCw,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type {
  Courier,
  CourierDeposit,
  CourierPenalty,
  Order,
  OrderCourier,
} from '../types/database';
import {
  calculateCommissionSplit,
  fetchCourierCommissionPct,
} from '../utils/commissions';
import { splitAmountEqually } from '../utils/autoDispatch';
import {
  getOrderDeliveryFeeNet,
  groupOrderCouriersByOrder,
  isCashOnDelivery,
  isOrderDelivered,
  matchesCourier,
  resolveOrderFinancials,
} from '../utils/custody';
import { RecordDepositModal, type CourierCustodySummary } from './RecordDepositModal';

interface CourierStatementViewProps {
  couriers: Courier[];
  initialCourierId?: string;
  onDepositSaved?: (message: string) => void;
}

interface StatementRow {
  id: string;
  createdAt: string;
  reference: string;
  subLabel?: string;
  receiptUrl?: string | null;
  type: 'order' | 'deposit' | 'penalty';
  amountCollected: number | null;
  commission: number | null;
  depositAmount: number | null;
  penaltyAmount?: number | null;
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

export function CourierStatementView({
  couriers,
  initialCourierId,
  onDepositSaved,
}: CourierStatementViewProps) {
  const [selectedCourierId, setSelectedCourierId] = useState<string>(
    initialCourierId || couriers[0]?.id || ''
  );
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonthValue);
  const [dateFrom, setDateFrom] = useState<string>(
    () => getMonthDateBounds(getCurrentMonthValue()).from
  );
  const [dateTo, setDateTo] = useState<string>(
    () => getMonthDateBounds(getCurrentMonthValue()).to
  );

  const [orders, setOrders] = useState<Order[]>([]);
  const [orderCouriers, setOrderCouriers] = useState<OrderCourier[]>([]);
  const [deposits, setDeposits] = useState<CourierDeposit[]>([]);
  const [penalties, setPenalties] = useState<CourierPenalty[]>([]);
  const [commissionPct, setCommissionPct] = useState<number>(70);
  const [loading, setLoading] = useState<boolean>(true);
  const [warningNotice, setWarningNotice] = useState<string | null>(null);
  const [depositModalOpen, setDepositModalOpen] = useState<boolean>(false);

  useEffect(() => {
    if (initialCourierId) {
      setSelectedCourierId(initialCourierId);
    } else if (!selectedCourierId && couriers.length > 0) {
      setSelectedCourierId(couriers[0].id);
    }
  }, [initialCourierId, couriers, selectedCourierId]);

  const handleMonthChange = (monthVal: string) => {
    setSelectedMonth(monthVal);
    if (monthVal) {
      const bounds = getMonthDateBounds(monthVal);
      setDateFrom(bounds.from);
      setDateTo(bounds.to);
    }
  };

  const loadStatementData = useCallback(async () => {
    if (!selectedCourierId) {
      setOrders([]);
      setOrderCouriers([]);
      setDeposits([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setWarningNotice(null);

    const startIso = `${dateFrom}T00:00:00.000Z`;
    const endIso = `${dateTo}T23:59:59.999Z`;

    const courierObj = couriers.find((c) => c.id === selectedCourierId);
    const courierIds = Array.from(
      new Set(
        [selectedCourierId, courierObj?.profile_id].filter(Boolean) as string[]
      )
    );

    const [ordersRes, orderCouriersRes, depositsRes, penaltiesRes, pct] =
      await Promise.all([
        supabase
          .from('orders')
          .select('*')
          .gte('created_at', startIso)
          .lte('created_at', endIso)
          .order('created_at', { ascending: false }),
        supabase.from('order_couriers').select('*'),
        supabase
          .from('courier_deposits')
          .select('*')
          .in('courier_id', courierIds)
          .gte('created_at', startIso)
          .lte('created_at', endIso)
          .order('created_at', { ascending: false }),
        supabase
          .from('courier_penalties')
          .select('*')
          .in('courier_id', courierIds)
          .gte('created_at', startIso)
          .lte('created_at', endIso)
          .order('created_at', { ascending: false }),
        fetchCourierCommissionPct(),
      ]);

    setOrders((ordersRes.data as Order[]) || []);
    setOrderCouriers((orderCouriersRes.data as OrderCourier[]) || []);

    if (depositsRes.error) {
      setDeposits([]);
      if (depositsRes.error.code === 'PGRST205') {
        setWarningNotice(
          'جدول courier_deposits غير منشأ بعد في Supabase — لن تظهر التوريدات حتى يتم إنشاؤه.'
        );
      }
    } else {
      setDeposits((depositsRes.data as CourierDeposit[]) || []);
    }

    if (!penaltiesRes.error && penaltiesRes.data) {
      setPenalties((penaltiesRes.data as CourierPenalty[]) || []);
    } else {
      setPenalties([]);
    }

    setCommissionPct(pct);
    setLoading(false);
  }, [selectedCourierId, dateFrom, dateTo, couriers]);

  useEffect(() => {
    loadStatementData();
  }, [loadStatementData]);

  const selectedCourier = useMemo(
    () => couriers.find((c) => c.id === selectedCourierId) || null,
    [couriers, selectedCourierId]
  );

  const statementSummary = useMemo(() => {
    if (!selectedCourier) {
      return {
        totalOrders: 0,
        deliveredCodCount: 0,
        totalCollected: 0,
        totalCommissions: 0,
        totalDeposits: 0,
        totalPenalties: 0,
        netCustody: 0,
        rows: [] as StatementRow[],
      };
    }

    const byOrder = groupOrderCouriersByOrder(orderCouriers);
    const deliveredOrders = orders.filter((o) => isOrderDelivered(o.status));

    let totalOrders = 0;
    let deliveredCodCount = 0;
    let totalCollected = 0;
    let totalCommissions = 0;
    const rows: StatementRow[] = [];

    for (const order of deliveredOrders) {
      const ocRows = byOrder.get(order.id) || [];
      const deliveryFeeNet = getOrderDeliveryFeeNet(order);
      const split = calculateCommissionSplit(deliveryFeeNet, commissionPct);
      const isCash = isCashOnDelivery(order.payment_method);

      let orderComm = 0;
      let orderCash = 0;
      let belongsToCourier = false;

      if (ocRows.length > 0) {
        const myIndex = ocRows.findIndex((r) =>
          matchesCourier(r.courier_id, selectedCourier)
        );
        if (myIndex !== -1) {
          belongsToCourier = true;
          const myRow = ocRows[myIndex];
          const rowComm = Number(myRow.commission_amount || 0);
          orderComm = rowComm > 0 ? rowComm : split.courierCommission;

          if (isCash) {
            const explicitSum = ocRows.reduce(
              (sum, r) => sum + Number(r.cash_collected || 0),
              0
            );
            if (explicitSum > 0) {
              orderCash = Number(myRow.cash_collected || 0);
            } else {
              const equalSplits = splitAmountEqually(
                Number(order.total || 0),
                ocRows.length
              );
              orderCash = equalSplits[myIndex] ?? 0;
            }
          }
        }
      } else if (matchesCourier(order.courier_id, selectedCourier)) {
        belongsToCourier = true;
        orderComm = resolveOrderFinancials(order, commissionPct).courierCommission;
        if (isCash) {
          orderCash = Number(order.total || 0);
        }
      }

      if (!belongsToCourier) continue;

      totalOrders += 1;
      if (isCash) {
        deliveredCodCount += 1;
      }
      totalCollected += orderCash;
      totalCommissions += orderComm;

      rows.push({
        id: `order-${order.id}`,
        createdAt: order.created_at,
        reference: order.order_number,
        subLabel: `${order.customer_name}${
          order.is_large_order ? ' · أوردر كبير' : ''
        } · ${isCash ? 'كاش' : 'بطاقة'}`,
        type: 'order',
        amountCollected: Number(orderCash.toFixed(2)),
        commission: Number(orderComm.toFixed(2)),
        depositAmount: null,
        penaltyAmount: null,
      });
    }

    let totalDeposits = 0;
    for (const dep of deposits) {
      if (!matchesCourier(dep.courier_id, selectedCourier)) continue;
      const amt = Number(dep.amount || 0);
      totalDeposits += amt;
      rows.push({
        id: `dep-${dep.id}`,
        createdAt: dep.created_at,
        reference: 'توريد',
        subLabel: dep.notes || 'إيصال توريد عهدة',
        receiptUrl: dep.receipt_url,
        type: 'deposit',
        amountCollected: null,
        commission: null,
        depositAmount: Number(amt.toFixed(2)),
        penaltyAmount: null,
      });
    }

    let totalPenalties = 0;
    for (const pen of penalties) {
      if (!matchesCourier(pen.courier_id, selectedCourier)) continue;
      const amt = Number(pen.amount || 0);
      totalPenalties += amt;
      rows.push({
        id: `pen-${pen.id}`,
        createdAt: pen.created_at || new Date().toISOString(),
        reference: `جزاء (${pen.penalty_type})`,
        subLabel: pen.reason || 'خصم جزاء إداري',
        receiptUrl: pen.proof_url,
        type: 'penalty',
        amountCollected: null,
        commission: null,
        depositAmount: null,
        penaltyAmount: Number(amt.toFixed(2)),
      });
    }

    rows.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const netCustody = Number(
      (totalCollected - totalCommissions - totalDeposits - totalPenalties).toFixed(2)
    );

    return {
      totalOrders,
      deliveredCodCount,
      totalCollected: Number(totalCollected.toFixed(2)),
      totalCommissions: Number(totalCommissions.toFixed(2)),
      totalDeposits: Number(totalDeposits.toFixed(2)),
      totalPenalties: Number(totalPenalties.toFixed(2)),
      netCustody,
      rows,
    };
  }, [selectedCourier, orders, orderCouriers, deposits, penalties, commissionPct]);

  const modalCourierSummaries: CourierCustodySummary[] = useMemo(() => {
    if (!selectedCourier) return [];
    return [
      {
        courier: selectedCourier,
        name: selectedCourier.profiles?.full_name || 'مندوب',
        phone: selectedCourier.profiles?.phone || '—',
        deliveredOrdersCount: statementSummary.totalOrders,
        deliveredCodCount: statementSummary.deliveredCodCount,
        grossCollected: statementSummary.totalCollected,
        totalCommission: statementSummary.totalCommissions,
        totalOwed: Number(
          (
            statementSummary.totalCollected - statementSummary.totalCommissions
          ).toFixed(2)
        ),
        totalDeposited: statementSummary.totalDeposits,
        totalPenalties: statementSummary.totalPenalties,
        remainingCustody: statementSummary.netCustody,
      },
    ];
  }, [selectedCourier, statementSummary]);

  const isOwingCustody = statementSummary.netCustody > 0;

  return (
    <div className="space-y-5">
      {/* Filters Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[#0A192F]">
              كشف حساب مندوب شهري
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              متابعة الطلبات المُسلّمة، التحصيل، العمولات ({commissionPct}%)، والتوريدات خلال الفترة المحددة
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={loadStatementData}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>تحديث</span>
            </button>
            {selectedCourier && (
              <button
                type="button"
                onClick={() => setDepositModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#FF7B00] hover:bg-[#E56E00] text-white text-xs font-bold cursor-pointer whitespace-nowrap"
              >
                <Receipt className="w-4 h-4" />
                <span>تسجيل توريد للمندوب</span>
              </button>
            )}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              اختر المندوب
            </label>
            <select
              value={selectedCourierId}
              onChange={(e) => setSelectedCourierId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-bold text-[#0A192F]"
            >
              {couriers.length === 0 ? (
                <option value="">لا يوجد مناديب</option>
              ) : (
                couriers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.profiles?.full_name || 'مندوب'}{' '}
                    {c.profiles?.phone ? `(${c.profiles.phone})` : ''}
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              الشهر
            </label>
            <div className="relative">
              <Calendar className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => handleMonthChange(e.target.value)}
                className="w-full pr-9 pl-3 py-2 rounded-lg border border-slate-200 text-sm font-mono tabular-nums text-[#0A192F]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              من تاريخ
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono tabular-nums text-[#0A192F]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              إلى تاريخ
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono tabular-nums text-[#0A192F]"
            />
          </div>
        </div>
      </div>

      {warningNotice && (
        <div className="flex items-center gap-2.5 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{warningNotice}</span>
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 flex flex-col items-center justify-center gap-3 text-slate-500">
          <Loader2 className="w-6 h-6 text-[#FF7B00] animate-spin" />
          <span className="text-sm">جاري تحميل كشف حساب المندوب...</span>
        </div>
      ) : !selectedCourier ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
          يرجى اختيار مندوب لعرض كشف الحساب
        </div>
      ) : (
        <>
          {/* 4 Summary Cards */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs font-semibold text-slate-500">
                إجمالي الطلبات
              </div>
              <div className="text-2xl font-extrabold text-[#0A192F] font-mono tabular-nums mt-2">
                {statementSummary.totalOrders}
              </div>
              <div className="text-xs text-slate-400 mt-1">
                طلبات تم تسليمها في الفترة المحددة
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs font-semibold text-slate-500">
                إجمالي المحصل
              </div>
              <div className="text-2xl font-extrabold text-[#0A192F] font-mono tabular-nums mt-2">
                {statementSummary.totalCollected.toFixed(2)} ج.م
              </div>
              <div className="text-xs text-slate-400 mt-1">
                طلبات الدفع عند الاستلام ({statementSummary.deliveredCodCount} طلب كاش)
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs font-semibold text-slate-500">
                إجمالي العمولات
              </div>
              <div className="text-2xl font-extrabold text-emerald-700 font-mono tabular-nums mt-2">
                {statementSummary.totalCommissions.toFixed(2)} ج.م
              </div>
              <div className="text-xs text-slate-400 mt-1">
                مستحقات المندوب بنسبة {commissionPct}%
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs font-semibold text-slate-500">
                إجمالي التوريدات
              </div>
              <div className="text-2xl font-extrabold text-[#FF7B00] font-mono tabular-nums mt-2">
                {statementSummary.totalDeposits.toFixed(2)} ج.م
              </div>
              <div className="text-xs text-slate-400 mt-1">
                مجموع الإيداعات المسجلة في الفترة
              </div>
            </div>
          </div>

          {/* Prominent Net Custody Banner */}
          <div
            className={`rounded-xl p-5 border flex flex-wrap items-center justify-between gap-4 ${
              isOwingCustody
                ? 'bg-red-50 border-red-200'
                : 'bg-emerald-50 border-emerald-200'
            }`}
          >
            <div>
              <div
                className={`text-sm font-bold ${
                  isOwingCustody ? 'text-red-900' : 'text-emerald-900'
                }`}
              >
                العهدة المتبقية — {selectedCourier.profiles?.full_name || 'مندوب'}
              </div>
              <div
                className={`text-xs mt-1 ${
                  isOwingCustody ? 'text-red-700' : 'text-emerald-700'
                }`}
              >
                المعادلة: إجمالي المحصل ({statementSummary.totalCollected.toFixed(2)}) − إجمالي العمولات ({statementSummary.totalCommissions.toFixed(2)}) − إجمالي التوريدات ({statementSummary.totalDeposits.toFixed(2)})
                {statementSummary.totalPenalties > 0
                  ? ` − الجزاءات المخصومة (${statementSummary.totalPenalties.toFixed(2)})`
                  : ''}
              </div>
            </div>

            <div className="text-left">
              <div
                className={`text-2xl sm:text-3xl font-extrabold font-mono tabular-nums ${
                  isOwingCustody ? 'text-red-600' : 'text-emerald-700'
                }`}
              >
                {statementSummary.netCustody.toFixed(2)} ج.م
              </div>
              <div
                className={`text-xs font-bold mt-0.5 ${
                  isOwingCustody ? 'text-red-700' : 'text-emerald-700'
                }`}
              >
                {isOwingCustody
                  ? 'مبلغ مستحق التوريد للشركة'
                  : statementSummary.netCustody < 0
                  ? 'رصيد دائن مستحق للمندوب'
                  : 'الحساب مصفّى بالكامل'}
              </div>
            </div>
          </div>

          {/* Transaction Details Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div className="font-bold text-sm text-[#0B1A33]">
                تفاصيل حركات كشف الحساب ({statementSummary.rows.length} حركة)
              </div>
              <div className="text-xs text-slate-500 font-mono tabular-nums">
                {dateFrom} ← {dateTo}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                    <th className="py-3 px-4 whitespace-nowrap">التاريخ</th>
                    <th className="py-3 px-4 whitespace-nowrap">رقم الطلب / المرجع</th>
                    <th className="py-3 px-4 whitespace-nowrap">النوع</th>
                    <th className="py-3 px-4 whitespace-nowrap">المحصل</th>
                    <th className="py-3 px-4 whitespace-nowrap">العمولة</th>
                    <th className="py-3 px-4 whitespace-nowrap">المورد / الجزاء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {statementSummary.rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="py-10 text-center text-xs text-slate-400"
                      >
                        لا توجد طلبات مُسلّمة أو توريدات أو جزاءات لهذا المندوب في الفترة المحددة
                      </td>
                    </tr>
                  ) : (
                    statementSummary.rows.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                          {new Date(row.createdAt).toLocaleString('ar-EG')}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="font-mono tabular-nums font-bold text-[#0B1A33]">
                            {row.reference}
                          </div>
                          {row.subLabel && (
                            <div className="text-[11px] text-slate-500">
                              {row.subLabel}
                            </div>
                          )}
                          {row.receiptUrl && (
                            <a
                              href={row.receiptUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] font-bold text-[#FF7F00] hover:underline mt-0.5"
                            >
                              <span>عرض المرفق</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`text-xs font-bold ${
                              row.type === 'order'
                                ? 'text-[#0B1A33]'
                                : row.type === 'penalty'
                                ? 'text-[#EF2323]'
                                : 'text-[#FF7F00]'
                            }`}
                          >
                            {row.type === 'order'
                              ? 'طلب'
                              : row.type === 'penalty'
                              ? 'جزاء'
                              : 'توريد'}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap text-[#0B1A33] font-semibold">
                          {row.amountCollected !== null
                            ? `${row.amountCollected.toFixed(2)} ج.م`
                            : '—'}
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap text-emerald-700 font-semibold">
                          {row.commission !== null
                            ? `${row.commission.toFixed(2)} ج.م`
                            : '—'}
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap font-bold">
                          {row.depositAmount !== null ? (
                            <span className="text-[#FF7F00]">
                              {row.depositAmount.toFixed(2)} ج.م
                            </span>
                          ) : row.penaltyAmount !== null &&
                            row.penaltyAmount !== undefined ? (
                            <span className="text-[#EF2323]">
                              −{row.penaltyAmount.toFixed(2)} ج.م (جزاء)
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {statementSummary.rows.length > 0 && (
                  <tfoot>
                    <tr className="bg-[#0B1A33] text-white text-xs font-bold">
                      <td colSpan={3} className="py-3 px-4">
                        الإجمالي خلال الفترة
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">
                        {statementSummary.totalCollected.toFixed(2)} ج.م
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap text-emerald-300">
                        {statementSummary.totalCommissions.toFixed(2)} ج.م
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap text-[#FF7F00]">
                        {statementSummary.totalDeposits.toFixed(2)} ج.م
                        {statementSummary.totalPenalties > 0
                          ? ` | جزاءات: ${statementSummary.totalPenalties.toFixed(2)}`
                          : ''}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}

      <RecordDepositModal
        open={depositModalOpen}
        onClose={() => setDepositModalOpen(false)}
        couriers={modalCourierSummaries}
        commissionPct={commissionPct}
        initialCourierId={selectedCourierId}
        onSaved={(msg) => {
          onDepositSaved?.(msg);
          loadStatementData();
        }}
      />
    </div>
  );
}
