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
import type { Merchant, MerchantSettlement, Order } from '../types/database';
import {
  getOrderMerchantPayable,
  isOrderDelivered,
  isOrderMerchantSettled,
  type MerchantPayableSummary,
} from '../utils/custody';
import { RecordMerchantPaymentModal } from './RecordMerchantPaymentModal';

interface MerchantStatementViewProps {
  merchants: Merchant[];
  initialMerchantId?: string;
  onPaymentSaved?: (message: string) => void;
}

interface MerchantTransactionRow {
  id: string;
  date: string;
  reference: string;
  subLabel?: string;
  receiptUrl?: string | null;
  amount: number;
  type: 'order' | 'settlement';
  settled?: boolean;
}

function getCurrentMonthValue(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function getMonthBounds(monthValue: string): { from: string; to: string } {
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

export function MerchantStatementView({
  merchants,
  initialMerchantId,
  onPaymentSaved,
}: MerchantStatementViewProps) {
  const [selectedMerchantId, setSelectedMerchantId] = useState<string>(
    initialMerchantId || merchants[0]?.id || ''
  );
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonthValue);
  const [dateFrom, setDateFrom] = useState<string>(
    () => getMonthBounds(getCurrentMonthValue()).from
  );
  const [dateTo, setDateTo] = useState<string>(
    () => getMonthBounds(getCurrentMonthValue()).to
  );

  const [orders, setOrders] = useState<Order[]>([]);
  const [settlements, setSettlements] = useState<MerchantSettlement[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [paymentModalOpen, setPaymentModalOpen] = useState<boolean>(false);
  const [openWithUnsettledOrders, setOpenWithUnsettledOrders] =
    useState<boolean>(false);

  useEffect(() => {
    if (initialMerchantId) {
      setSelectedMerchantId(initialMerchantId);
    } else if (!selectedMerchantId && merchants.length > 0) {
      setSelectedMerchantId(merchants[0].id);
    }
  }, [initialMerchantId, merchants, selectedMerchantId]);

  const handleMonthChange = (monthVal: string) => {
    setSelectedMonth(monthVal);
    if (monthVal) {
      const bounds = getMonthBounds(monthVal);
      setDateFrom(bounds.from);
      setDateTo(bounds.to);
    }
  };

  const loadStatement = useCallback(async () => {
    if (!selectedMerchantId) {
      setOrders([]);
      setSettlements([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorNotice(null);

    const startIso = `${dateFrom}T00:00:00.000Z`;
    const endIso = `${dateTo}T23:59:59.999Z`;

    const [ordersRes, settlementsRes] = await Promise.all([
      supabase
        .from('orders')
        .select('*')
        .eq('merchant_id', selectedMerchantId)
        .gte('created_at', startIso)
        .lte('created_at', endIso)
        .order('created_at', { ascending: false }),
      supabase
        .from('merchant_settlements')
        .select('*')
        .eq('merchant_id', selectedMerchantId)
        .gte('payment_date', startIso)
        .lte('payment_date', endIso)
        .order('payment_date', { ascending: false }),
    ]);

    setOrders((ordersRes.data as Order[]) || []);
    if (settlementsRes.error) {
      setSettlements([]);
      setErrorNotice(settlementsRes.error.message);
    } else {
      setSettlements((settlementsRes.data as MerchantSettlement[]) || []);
    }
    setLoading(false);
  }, [selectedMerchantId, dateFrom, dateTo]);

  useEffect(() => {
    loadStatement();
  }, [loadStatement]);

  const selectedMerchant = useMemo(
    () => merchants.find((m) => m.id === selectedMerchantId) || null,
    [merchants, selectedMerchantId]
  );

  const summary = useMemo(() => {
    const deliveredOrders = orders.filter((o) => isOrderDelivered(o.status));
    const unsettledOrders = deliveredOrders
      .filter((o) => !isOrderMerchantSettled(o))
      .sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    const settledOrders = deliveredOrders.filter((o) =>
      isOrderMerchantSettled(o)
    );

    const totalOrders = deliveredOrders.length;
    const totalSales = Number(
      unsettledOrders
        .reduce((sum, o) => sum + getOrderMerchantPayable(o), 0)
        .toFixed(2)
    );
    const settledSales = Number(
      settledOrders
        .reduce((sum, o) => sum + getOrderMerchantPayable(o), 0)
        .toFixed(2)
    );
    const totalPaid = Number(
      settlements
        .reduce((sum, s) => sum + Number(s.amount || 0), 0)
        .toFixed(2)
    );
    const unallocatedPaid = Math.max(
      0,
      Number((totalPaid - settledSales).toFixed(2))
    );
    const remainingBalance = Number((totalSales - unallocatedPaid).toFixed(2));

    const rows: MerchantTransactionRow[] = [
      ...deliveredOrders.map((o) => ({
        id: `ord-${o.id}`,
        date: o.created_at,
        reference: o.order_number,
        subLabel: `${o.customer_name} · ${
          o.payment_method === 'card' ? 'بطاقة' : 'كاش'
        }`,
        amount: Number(getOrderMerchantPayable(o).toFixed(2)),
        type: 'order' as const,
        settled: isOrderMerchantSettled(o),
      })),
      ...settlements.map((s) => ({
        id: `set-${s.id}`,
        date: s.payment_date || s.created_at || new Date().toISOString(),
        reference: 'دفعة / تسوية',
        subLabel: s.notes || 'سداد مستحقات التاجر',
        receiptUrl: s.receipt_url,
        amount: Number(Number(s.amount || 0).toFixed(2)),
        type: 'settlement' as const,
      })),
    ];

    rows.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    return {
      totalOrders,
      unsettledOrders,
      unsettledOrdersCount: unsettledOrders.length,
      totalSales,
      settledSales,
      totalPaid,
      remainingBalance,
      rows,
    };
  }, [orders, settlements]);

  const modalMerchantSummary: MerchantPayableSummary[] = useMemo(() => {
    if (!selectedMerchant) return [];
    return [
      {
        merchant: selectedMerchant,
        name: selectedMerchant.store_name || selectedMerchant.name || 'متجر',
        phone: selectedMerchant.phone || '—',
        deliveredOrdersCount: summary.totalOrders,
        unsettledOrdersCount: summary.unsettledOrdersCount,
        unsettledOrders: summary.unsettledOrders,
        totalSales: summary.totalSales,
        settledSales: summary.settledSales,
        totalPaid: summary.totalPaid,
        remainingBalance: summary.remainingBalance,
      },
    ];
  }, [selectedMerchant, summary]);

  const hasPayableBalance = summary.remainingBalance > 0;

  return (
    <div className="space-y-5">
      {/* Filters Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[#0A192F]">
              كشف حساب تاجر شهري
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              متابعة مبيعات المتجر من الطلبات المُسلّمة والدفعات المسددة في merchant_settlements
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={loadStatement}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>تحديث</span>
            </button>
            {selectedMerchant && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setOpenWithUnsettledOrders(true);
                    setPaymentModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-[#0A192F] text-xs font-bold cursor-pointer whitespace-nowrap"
                >
                  <span>عرض الطلبات غير المسددة ({summary.unsettledOrdersCount})</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOpenWithUnsettledOrders(false);
                    setPaymentModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#FF7B00] hover:bg-[#E56E00] text-white text-xs font-bold cursor-pointer whitespace-nowrap"
                >
                  <Receipt className="w-4 h-4" />
                  <span>تسجيل دفعة للتاجر</span>
                </button>
              </>
            )}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              اختر التاجر / المتجر
            </label>
            <select
              value={selectedMerchantId}
              onChange={(e) => setSelectedMerchantId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-bold text-[#0A192F]"
            >
              {merchants.length === 0 ? (
                <option value="">لا توجد متاجر</option>
              ) : (
                merchants.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.store_name || m.name || m.email || m.id}
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

      {errorNotice && (
        <div className="flex items-center gap-2.5 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorNotice}</span>
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 flex flex-col items-center justify-center gap-3 text-slate-500">
          <Loader2 className="w-6 h-6 text-[#FF7B00] animate-spin" />
          <span className="text-sm">جاري تحميل كشف حساب التاجر...</span>
        </div>
      ) : !selectedMerchant ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
          يرجى اختيار تاجر لعرض كشف الحساب
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
                {summary.totalOrders}
              </div>
              <div className="text-xs text-slate-400 mt-1">
                طلبات تم تسليمها للتاجر خلال الفترة
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs font-semibold text-slate-500">
                إجمالي المبيعات (غير المسددة)
              </div>
              <div className="text-2xl font-extrabold text-[#0A192F] font-mono tabular-nums mt-2">
                {summary.totalSales.toFixed(2)} ج.م
              </div>
              <div className="text-xs text-slate-400 mt-1">
                {summary.unsettledOrdersCount} طلب مُسلّم غير مسدد (is_merchant_settled = false)
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs font-semibold text-slate-500">
                إجمالي المدفوع
              </div>
              <div className="text-2xl font-extrabold text-emerald-700 font-mono tabular-nums mt-2">
                {summary.totalPaid.toFixed(2)} ج.م
              </div>
              <div className="text-xs text-slate-400 mt-1">
                مجموع الدفعات المسددة للتاجر
              </div>
            </div>

            <div
              className={`rounded-xl p-5 border ${
                hasPayableBalance
                  ? 'bg-[#0A192F] text-white border-[#0A192F]'
                  : 'bg-emerald-50 text-emerald-900 border-emerald-200'
              }`}
            >
              <div
                className={`text-xs font-semibold ${
                  hasPayableBalance ? 'text-slate-300' : 'text-emerald-700'
                }`}
              >
                الرصيد المتبقي
              </div>
              <div
                className={`text-2xl font-extrabold font-mono tabular-nums mt-2 ${
                  hasPayableBalance ? 'text-[#FF7B00]' : 'text-emerald-700'
                }`}
              >
                {summary.remainingBalance.toFixed(2)} ج.م
              </div>
              <div
                className={`text-xs mt-1 ${
                  hasPayableBalance ? 'text-slate-300' : 'text-emerald-700'
                }`}
              >
                {hasPayableBalance
                  ? 'مستحق الدفع للتاجر (المبيعات − المدفوع)'
                  : 'تمت تسوية الرصيد بالكامل'}
              </div>
            </div>
          </div>

          {/* Transaction Details Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div className="font-bold text-sm text-[#0A192F]">
                تفاصيل حركات التاجر ({summary.rows.length} حركة)
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
                    <th className="py-3 px-4 whitespace-nowrap">رقم الطلب / التسوية</th>
                    <th className="py-3 px-4 whitespace-nowrap">المبلغ</th>
                    <th className="py-3 px-4 whitespace-nowrap">النوع</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="py-10 text-center text-xs text-slate-400"
                      >
                        لا توجد طلبات مُسلّمة أو دفعات مسجلة لهذا التاجر في الفترة المحددة
                      </td>
                    </tr>
                  ) : (
                    summary.rows.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                          {new Date(row.date).toLocaleString('ar-EG')}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="font-mono tabular-nums font-bold text-[#0A192F]">
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
                              className="inline-flex items-center gap-1 text-[11px] font-bold text-[#FF7B00] hover:underline mt-0.5"
                            >
                              <span>عرض الإيصال</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </td>
                        <td
                          className={`py-3 px-4 font-mono tabular-nums font-bold whitespace-nowrap ${
                            row.type === 'order'
                              ? 'text-[#0A192F]'
                              : 'text-emerald-700'
                          }`}
                        >
                          {row.type === 'order' ? '+' : '−'} {row.amount.toFixed(2)} ج.م
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`text-xs font-bold ${
                              row.type === 'settlement' || row.settled
                                ? 'text-emerald-700'
                                : 'text-[#0A192F]'
                            }`}
                          >
                            {row.type === 'order'
                              ? row.settled
                                ? 'طلب مُسلّم (تمت التسوية)'
                                : 'طلب مُسلّم (غير مسدد)'
                              : 'دفعة مسددة للتاجر'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <RecordMerchantPaymentModal
        open={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        merchants={modalMerchantSummary}
        initialMerchantId={selectedMerchantId}
        initialShowUnsettledOrders={openWithUnsettledOrders}
        onSaved={(msg) => {
          onPaymentSaved?.(msg);
          loadStatement();
        }}
      />
    </div>
  );
}
