import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Banknote,
  Calendar,
  Download,
  Loader2,
  PackageCheck,
  RefreshCw,
  Search,
  TrendingDown,
  Wallet,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type {
  Courier,
  CourierDeposit,
  CourierPenalty,
  Order,
  OrderCourier,
} from '../types/database';
import { fetchCourierCommissionPct } from '../utils/commissions';
import { buildCourierCustodySummaries } from '../utils/custody';
import { PaginationBar } from './PaginationBar';

const PAGE_SIZE = 20;

const ARABIC_MONTHS = [
  { value: 1, label: 'يناير' },
  { value: 2, label: 'فبراير' },
  { value: 3, label: 'مارس' },
  { value: 4, label: 'أبريل' },
  { value: 5, label: 'مايو' },
  { value: 6, label: 'يونيو' },
  { value: 7, label: 'يوليو' },
  { value: 8, label: 'أغسطس' },
  { value: 9, label: 'سبتمبر' },
  { value: 10, label: 'أكتوبر' },
  { value: 11, label: 'نوفمبر' },
  { value: 12, label: 'ديسمبر' },
] as const;

interface PayrollRow {
  courierId: string;
  name: string;
  phone: string;
  totalOrders: number;
  totalCommission: number;
  totalPenalties: number;
  totalDeposits: number;
  netPayable: number;
}

function escapeCsvCell(val: string | number): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function CourierPayrollView() {
  const now = useMemo(() => new Date(), []);
  const [selectedYear, setSelectedYear] = useState<number>(() =>
    now.getFullYear()
  );
  const [selectedMonth, setSelectedMonth] = useState<number>(
    () => now.getMonth() + 1
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyActiveInMonth, setOnlyActiveInMonth] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commissionPct, setCommissionPct] = useState<number>(70);

  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const list: number[] = [];
    for (let y = currentYear + 1; y >= currentYear - 4; y -= 1) {
      list.push(y);
    }
    return list;
  }, []);

  const loadPayroll = useCallback(async () => {
    setLoading(true);
    setError(null);

    const startOfMonth = new Date(
      selectedYear,
      selectedMonth - 1,
      1,
      0,
      0,
      0,
      0
    ).toISOString();
    const endOfMonth = new Date(
      selectedYear,
      selectedMonth,
      0,
      23,
      59,
      59,
      999
    ).toISOString();

    const [couriersRes, ordersRes, penaltiesRes, depositsRes, pct] =
      await Promise.all([
        supabase
          .from('couriers')
          .select('*, profiles(full_name, phone, email)')
          .order('created_at', { ascending: false }),
        supabase
          .from('orders')
          .select(
            'id, order_number, courier_id, delivery_fee_base, partner_discount, delivery_fee_net, custom_fee, courier_commission, is_large_order, required_couriers, payment_method, total, status, created_at'
          )
          .eq('status', 'delivered')
          .gte('created_at', startOfMonth)
          .lte('created_at', endOfMonth),
        supabase
          .from('courier_penalties')
          .select('*')
          .gte('created_at', startOfMonth)
          .lte('created_at', endOfMonth),
        supabase
          .from('courier_deposits')
          .select('*')
          .gte('created_at', startOfMonth)
          .lte('created_at', endOfMonth),
        fetchCourierCommissionPct(),
      ]);

    if (ordersRes.error) {
      setError(`تعذر تحميل الطلبات للشهر المحدد: ${ordersRes.error.message}`);
      setRows([]);
      setLoading(false);
      return;
    }

    let loadedCouriers: Courier[] = [];
    if (!couriersRes.error && couriersRes.data) {
      loadedCouriers = couriersRes.data as Courier[];
    } else if (couriersRes.error) {
      const fb = await supabase
        .from('couriers')
        .select('*')
        .order('created_at', { ascending: false });
      loadedCouriers = (fb.data as Courier[]) || [];
    }

    const monthOrders = (ordersRes.data as Order[]) || [];
    const monthOrderIds = monthOrders.map((o) => o.id);

    let monthOrderCouriers: OrderCourier[] = [];
    if (monthOrderIds.length > 0) {
      const ocRes = await supabase
        .from('order_couriers')
        .select('*')
        .in('order_id', monthOrderIds);
      if (!ocRes.error && ocRes.data) {
        monthOrderCouriers = ocRes.data as OrderCourier[];
      }
    }

    const monthPenalties =
      !penaltiesRes.error && penaltiesRes.data
        ? (penaltiesRes.data as CourierPenalty[])
        : [];
    const monthDeposits =
      !depositsRes.error && depositsRes.data
        ? (depositsRes.data as CourierDeposit[])
        : [];

    const summaries = buildCourierCustodySummaries(
      loadedCouriers,
      monthOrders,
      monthDeposits,
      pct,
      monthOrderCouriers,
      monthPenalties
    );

    const payrollRows: PayrollRow[] = summaries
      .map((s) => {
        const totalComm = Number(s.totalCommission.toFixed(2));
        const totalPen = Number((s.totalPenalties ?? 0).toFixed(2));
        const totalDep = Number((s.totalDeposited ?? 0).toFixed(2));
        return {
          courierId: s.courier.id,
          name: s.name,
          phone: s.phone,
          totalOrders: s.deliveredOrdersCount,
          totalCommission: totalComm,
          totalPenalties: totalPen,
          totalDeposits: Number(totalDep.toFixed(2)),
          netPayable: Number((totalComm - totalPen).toFixed(2)),
        };
      })
      .sort((a, b) => b.netPayable - a.netPayable || b.totalOrders - a.totalOrders);

    setCommissionPct(pct);
    setRows(payrollRows);
    setLoading(false);
  }, [selectedYear, selectedMonth]);

  useEffect(() => {
    loadPayroll();
  }, [loadPayroll]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (
        onlyActiveInMonth &&
        r.totalOrders === 0 &&
        r.totalPenalties === 0 &&
        r.totalDeposits === 0
      ) {
        return false;
      }
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) || r.phone.toLowerCase().includes(q)
      );
    });
  }, [rows, searchQuery, onlyActiveInMonth]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, onlyActiveInMonth, selectedMonth, selectedYear]);

  const paginatedRows = useMemo(() => {
    const from = (currentPage - 1) * PAGE_SIZE;
    return filteredRows.slice(from, from + PAGE_SIZE);
  }, [filteredRows, currentPage]);

  const totals = useMemo(() => {
    return filteredRows.reduce(
      (acc, r) => ({
        orders: acc.orders + r.totalOrders,
        commission: Number((acc.commission + r.totalCommission).toFixed(2)),
        penalties: Number((acc.penalties + r.totalPenalties).toFixed(2)),
        deposits: Number((acc.deposits + r.totalDeposits).toFixed(2)),
        netPayable: Number((acc.netPayable + r.netPayable).toFixed(2)),
      }),
      {
        orders: 0,
        commission: 0,
        penalties: 0,
        deposits: 0,
        netPayable: 0,
      }
    );
  }, [filteredRows]);

  const monthNameLabel =
    ARABIC_MONTHS.find((m) => m.value === selectedMonth)?.label ||
    String(selectedMonth);

  const handleExportCsv = () => {
    const headers = [
      'اسم المندوب',
      'رقم الهاتف',
      'عدد الأوردرات',
      'إجمالي العمولة (ج.م)',
      'إجمالي الخصومات (ج.م)',
      'إجمالي التوريدات (ج.م)',
      'صافي المستحق (ج.م)',
    ];

    const lines = [
      headers.map(escapeCsvCell).join(','),
      ...filteredRows.map((r) =>
        [
          r.name,
          r.phone,
          r.totalOrders,
          r.totalCommission.toFixed(2),
          r.totalPenalties.toFixed(2),
          r.totalDeposits.toFixed(2),
          r.netPayable.toFixed(2),
        ]
          .map(escapeCsvCell)
          .join(',')
      ),
      [
        'الإجمالي',
        '',
        totals.orders,
        totals.commission.toFixed(2),
        totals.penalties.toFixed(2),
        totals.deposits.toFixed(2),
        totals.netPayable.toFixed(2),
      ]
        .map(escapeCsvCell)
        .join(','),
    ];

    const csvContent = `\uFEFF${lines.join('\n')}`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const mm = String(selectedMonth).padStart(2, '0');
    link.href = url;
    link.setAttribute('download', `hatly-courier-payroll-${selectedYear}-${mm}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleResetToCurrentMonth = () => {
    const d = new Date();
    setSelectedYear(d.getFullYear());
    setSelectedMonth(d.getMonth() + 1);
  };

  return (
    <div dir="rtl" className="space-y-6">
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-[#EF2323] text-xs font-semibold"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={loadPayroll}
            className="underline font-bold cursor-pointer"
          >
            إعادة المحاولة
          </button>
        </div>
      )}

      {/* Header & Month/Year Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-[#0B1A33]">
              كشف رواتب ومستحقات المناديب — {monthNameLabel}{' '}
              <span className="font-mono tabular-nums">{selectedYear}</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              حساب عمولات الطلبات المُسلّمة مخصوماً منها الجزاءات المسجلة خلال الشهر (نسبة عمولة المندوب الحالية:{' '}
              <strong className="font-mono tabular-nums text-[#0B1A33]">
                {commissionPct}%
              </strong>
              )
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={loadPayroll}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
              />
              <span>تحديث</span>
            </button>
            <button
              type="button"
              disabled={loading || filteredRows.length === 0}
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0B1A33] hover:bg-[#13294B] disabled:opacity-50 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
            >
              <Download className="w-4 h-4 text-[#FF7B00]" />
              <span>تصدير CSV / Excel</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3 pt-3 border-t border-slate-100">
          <div>
            <label
              htmlFor="payroll-month-select"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              الشهر
            </label>
            <div className="relative">
              <Calendar className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                id="payroll-month-select"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="pr-9 pl-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-bold text-[#0B1A33] min-w-[140px]"
              >
                {ARABIC_MONTHS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label
              htmlFor="payroll-year-select"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              السنة
            </label>
            <select
              id="payroll-year-select"
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-mono tabular-nums font-bold text-[#0B1A33] min-w-[100px]"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={handleResetToCurrentMonth}
            className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-[#0B1A33] cursor-pointer whitespace-nowrap"
          >
            الشهر الحالي
          </button>

          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث باسم المندوب أو الهاتف..."
              className="w-full pr-9 pl-3 py-2 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
            />
          </div>

          <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={onlyActiveInMonth}
              onChange={(e) => setOnlyActiveInMonth(e.target.checked)}
              className="rounded border-slate-300 text-[#FF7B00] focus:ring-[#FF7B00]"
            />
            <span>المناديب ذوو النشاط فقط</span>
          </label>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>إجمالي الأوردرات المُسلّمة</span>
            <PackageCheck className="w-4 h-4 text-[#0B1A33]" />
          </div>
          <div className="text-2xl font-extrabold text-[#0B1A33] font-mono tabular-nums mt-2">
            {totals.orders}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            في شهر {monthNameLabel} {selectedYear}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>إجمالي العمولات</span>
            <Wallet className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-extrabold text-emerald-700 font-mono tabular-nums mt-2">
            {totals.commission.toFixed(2)} ج.م
          </div>
          <div className="text-xs text-slate-500 mt-1">مستحقات التوصيل قبل الخصم</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>إجمالي الخصومات (الجزاءات)</span>
            <TrendingDown className="w-4 h-4 text-[#EF2323]" />
          </div>
          <div className="text-2xl font-extrabold text-[#EF2323] font-mono tabular-nums mt-2">
            {totals.penalties.toFixed(2)} ج.م
          </div>
          <div className="text-xs text-slate-500 mt-1">مخصومة من عمولات الشهر</div>
        </div>

        <div className="bg-[#0B1A33] text-white rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
            <span>إجمالي صافي المستحق</span>
            <Banknote className="w-4 h-4 text-[#FF7B00]" />
          </div>
          <div className="text-2xl font-extrabold text-[#FF7B00] font-mono tabular-nums mt-2">
            {totals.netPayable.toFixed(2)} ج.م
          </div>
          <div className="text-xs text-slate-300 mt-1">
            العمولات − الخصومات ({filteredRows.length} مندوب)
          </div>
        </div>
      </div>

      {/* Payroll Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center gap-3 text-slate-500">
            <Loader2 className="w-6 h-6 text-[#FF7B00] animate-spin" />
            <span className="text-sm">جاري احتساب رواتب المناديب...</span>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <div className="text-sm font-bold text-[#0B1A33]">
              لا توجد بيانات رواتب مطابقة للبحث
            </div>
            <p className="text-xs text-slate-500">
              جرّب اختيار شهر آخر أو إلغاء فلتر البحث لعرض جميع المناديب.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                  <th className="py-3 px-4 whitespace-nowrap">اسم المندوب</th>
                  <th className="py-3 px-4 whitespace-nowrap">عدد الأوردرات</th>
                  <th className="py-3 px-4 whitespace-nowrap">إجمالي العمولة</th>
                  <th className="py-3 px-4 whitespace-nowrap">إجمالي الخصومات</th>
                  <th className="py-3 px-4 whitespace-nowrap">إجمالي التوريدات</th>
                  <th className="py-3 px-4 whitespace-nowrap">صافي المستحق</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {paginatedRows.map((row) => (
                  <tr key={row.courierId} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="font-bold text-[#0B1A33]">{row.name}</div>
                      <div
                        className="text-xs text-slate-500 font-mono tabular-nums text-right"
                        dir="ltr"
                      >
                        {row.phone}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums font-bold text-[#0B1A33] whitespace-nowrap">
                      {row.totalOrders}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums font-bold text-emerald-700 whitespace-nowrap">
                      {row.totalCommission.toFixed(2)} ج.م
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums font-bold text-[#EF2323] whitespace-nowrap">
                      {row.totalPenalties > 0
                        ? `-${row.totalPenalties.toFixed(2)} ج.م`
                        : '0.00 ج.م'}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums font-semibold text-slate-700 whitespace-nowrap">
                      {row.totalDeposits.toFixed(2)} ج.م
                    </td>
                    <td
                      className={`py-3 px-4 font-mono tabular-nums font-extrabold whitespace-nowrap ${
                        row.netPayable >= 0 ? 'text-[#0B1A33]' : 'text-[#EF2323]'
                      }`}
                    >
                      {row.netPayable.toFixed(2)} ج.م
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-[#0B1A33] text-white text-xs font-extrabold">
                  <td className="py-3 px-4 whitespace-nowrap">
                    الإجمالي ({filteredRows.length} مندوب)
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">
                    {totals.orders}
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-emerald-300 whitespace-nowrap">
                    {totals.commission.toFixed(2)} ج.م
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-red-300 whitespace-nowrap">
                    {totals.penalties.toFixed(2)} ج.م
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-slate-200 whitespace-nowrap">
                    {totals.deposits.toFixed(2)} ج.م
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-[#FF7B00] text-sm whitespace-nowrap">
                    {totals.netPayable.toFixed(2)} ج.م
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {!loading && filteredRows.length > PAGE_SIZE && (
          <PaginationBar
            currentPage={currentPage}
            pageSize={PAGE_SIZE}
            totalCount={filteredRows.length}
            loading={loading}
            onPageChange={setCurrentPage}
          />
        )}
      </div>
    </div>
  );
}
