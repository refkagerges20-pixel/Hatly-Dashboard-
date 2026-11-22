import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileUp,
  ListChecks,
  Loader2,
  Receipt,
  RefreshCw,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Merchant, MerchantSettlement, Order } from '../types/database';
import {
  buildMerchantPayableSummaries,
  getOrderMerchantPayable,
  type MerchantPayableSummary,
} from '../utils/custody';

interface RecordMerchantPaymentModalProps {
  open: boolean;
  onClose: () => void;
  merchants: MerchantPayableSummary[];
  initialMerchantId?: string;
  initialShowUnsettledOrders?: boolean;
  onSaved: (message: string) => void;
}

function pickDefaultMerchantId(
  merchants: MerchantPayableSummary[],
  initialMerchantId?: string
): string {
  if (initialMerchantId) return initialMerchantId;
  const withBalance = merchants.find(
    (m) =>
      m.remainingBalance > 0 ||
      m.totalSales > 0 ||
      m.unsettledOrdersCount > 0
  );
  return withBalance?.merchant.id || merchants[0]?.merchant.id || '';
}

export function RecordMerchantPaymentModal({
  open,
  onClose,
  merchants,
  initialMerchantId,
  initialShowUnsettledOrders = false,
  onSaved,
}: RecordMerchantPaymentModalProps) {
  const [liveMerchants, setLiveMerchants] =
    useState<MerchantPayableSummary[]>(merchants);
  const [syncingLive, setSyncingLive] = useState<boolean>(false);

  const [merchantId, setMerchantId] = useState<string>(() =>
    pickDefaultMerchantId(merchants, initialMerchantId)
  );
  const [showUnsettledOrders, setShowUnsettledOrders] = useState<boolean>(
    initialShowUnsettledOrders
  );
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);

  const [amount, setAmount] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const loadLiveMerchantSummaries = useCallback(async () => {
    setSyncingLive(true);
    try {
      const [merchRes, ordersRes, settlementsRes] = await Promise.all([
        supabase
          .from('merchants')
          .select('*')
          .order('created_at', { ascending: false }),
        supabase
          .from('orders')
          .select('*')
          .eq('status', 'delivered')
          .order('created_at', { ascending: true }),
        supabase
          .from('merchant_settlements')
          .select('*')
          .order('payment_date', { ascending: false }),
      ]);

      const merchantRows =
        (merchRes.data as Merchant[] | null) ||
        merchants.map((m) => m.merchant);
      const orderRows = (ordersRes.data as Order[] | null) || [];
      const settlementRows =
        (settlementsRes.data as MerchantSettlement[] | null) || [];

      if (merchantRows.length > 0 && !ordersRes.error) {
        const computed = buildMerchantPayableSummaries(
          merchantRows,
          orderRows,
          settlementRows
        );
        setLiveMerchants(computed);
      } else {
        setLiveMerchants(merchants);
      }
    } catch {
      setLiveMerchants(merchants);
    } finally {
      setSyncingLive(false);
    }
  }, [merchants]);

  useEffect(() => {
    if (open) {
      setLiveMerchants(merchants);
      setShowUnsettledOrders(initialShowUnsettledOrders);
      setSelectedOrderIds([]);
      setError(null);
      setMerchantId((prev) => {
        if (initialMerchantId) return initialMerchantId;
        if (prev && merchants.some((m) => m.merchant.id === prev)) {
          const current = merchants.find((m) => m.merchant.id === prev);
          if (
            current &&
            (current.remainingBalance > 0 || current.totalSales > 0)
          ) {
            return prev;
          }
        }
        return pickDefaultMerchantId(merchants, initialMerchantId);
      });
      loadLiveMerchantSummaries();
    }
  }, [
    open,
    initialMerchantId,
    initialShowUnsettledOrders,
    merchants,
    loadLiveMerchantSummaries,
  ]);

  const effectiveMerchants = liveMerchants.length > 0 ? liveMerchants : merchants;

  const selectedSummary = useMemo(
    () => effectiveMerchants.find((m) => m.merchant.id === merchantId),
    [effectiveMerchants, merchantId]
  );

  const unsettledOrders = useMemo(
    () => selectedSummary?.unsettledOrders || [],
    [selectedSummary]
  );

  const handleMerchantChange = (nextId: string) => {
    setMerchantId(nextId);
    setSelectedOrderIds([]);
    setAmount('');
    setError(null);
  };

  const toggleOrderSelection = (orderId: string) => {
    setSelectedOrderIds((prev) => {
      const next = prev.includes(orderId)
        ? prev.filter((id) => id !== orderId)
        : [...prev, orderId];

      const selectedSum = unsettledOrders
        .filter((o) => next.includes(o.id))
        .reduce((sum, o) => sum + getOrderMerchantPayable(o), 0);

      if (next.length > 0) {
        setAmount(selectedSum.toFixed(2));
      }
      return next;
    });
  };

  const handleToggleAllUnsettled = () => {
    if (selectedOrderIds.length === unsettledOrders.length) {
      setSelectedOrderIds([]);
      setAmount('');
    } else {
      const allIds = unsettledOrders.map((o) => o.id);
      setSelectedOrderIds(allIds);
      if (selectedSummary) {
        setAmount(
          Math.max(0, selectedSummary.remainingBalance).toFixed(2)
        );
      }
    }
  };

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsedAmount = Number(amount);
    if (!merchantId) {
      setError('يرجى اختيار التاجر / المتجر');
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('يرجى إدخال مبلغ دفع صحيح أكبر من صفر');
      return;
    }
    if (!receiptFile) {
      setError('يرجى إرفاق صورة إيصال التحويل / الدفع للتاجر');
      return;
    }

    setSubmitting(true);

    try {
      const ext = receiptFile.name.split('.').pop() || 'jpg';
      const filePath = `${merchantId}/settlement_${Date.now()}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from('merchant_receipts')
        .upload(filePath, receiptFile, { upsert: true });

      if (uploadErr) {
        throw new Error(`فشل رفع صورة الإيصال: ${uploadErr.message}`);
      }

      const { data: urlData } = supabase.storage
        .from('merchant_receipts')
        .getPublicUrl(filePath);

      const receiptUrl = urlData.publicUrl;

      const { error: insertErr } = await supabase
        .from('merchant_settlements')
        .insert({
          merchant_id: merchantId,
          amount: parsedAmount,
          receipt_url: receiptUrl,
          notes: notes.trim() || null,
          payment_date: new Date().toISOString(),
        });

      if (insertErr) {
        throw new Error(
          `تعذر حفظ الدفعة في merchant_settlements: ${insertErr.message}`
        );
      }

      // Determine which unsettled orders are covered by this payment and mark is_merchant_settled = true
      let orderIdsToSettle: string[] = [];

      if (selectedOrderIds.length > 0) {
        orderIdsToSettle = selectedOrderIds;
      } else if (unsettledOrders.length > 0 && selectedSummary) {
        if (parsedAmount >= selectedSummary.remainingBalance - 0.01) {
          orderIdsToSettle = unsettledOrders.map((o) => o.id);
        } else {
          const priorUnallocatedCredit = Math.max(
            0,
            Number(
              (selectedSummary.totalPaid - selectedSummary.settledSales).toFixed(2)
            )
          );
          let budgetRemaining = Number(
            (parsedAmount + priorUnallocatedCredit).toFixed(2)
          );

          for (const ord of unsettledOrders) {
            const payable = getOrderMerchantPayable(ord);
            if (payable <= budgetRemaining + 0.01) {
              orderIdsToSettle.push(ord.id);
              budgetRemaining = Number((budgetRemaining - payable).toFixed(2));
            }
          }
        }
      }

      if (orderIdsToSettle.length > 0) {
        const { error: settleOrdersErr } = await supabase
          .from('orders')
          .update({ is_merchant_settled: true })
          .in('id', orderIdsToSettle);

        if (settleOrdersErr) {
          throw new Error(
            `تم حفظ الدفعة ولكن تعذر تحديث حالة تسوية الطلبات (is_merchant_settled): ${settleOrdersErr.message}`
          );
        }
      }

      const merchantName = selectedSummary?.name || 'التاجر';
      setAmount('');
      setNotes('');
      setReceiptFile(null);
      setSelectedOrderIds([]);

      await loadLiveMerchantSummaries();

      onSaved(
        orderIdsToSettle.length > 0
          ? `تم تسجيل دفعة بمبلغ ${parsedAmount.toFixed(2)} ج.م للتاجر "${merchantName}" وتسوية ${orderIdsToSettle.length} طلب بنجاح`
          : `تم تسجيل دفعة بمبلغ ${parsedAmount.toFixed(2)} ج.م للتاجر "${merchantName}" وخصمها من الرصيد المتبقي`
      );
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'حدث خطأ أثناء تسجيل دفعة التاجر'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0A192F]/60 flex items-center justify-center p-4 overflow-y-auto">
      <div
        dir="rtl"
        className="bg-white rounded-2xl border border-slate-200 w-full max-w-2xl p-6 space-y-5 my-8"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-[#0A192F] text-[#FF7B00] flex items-center justify-center shrink-0">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#0A192F]">
                تسجيل دفعة للتاجر
              </h3>
              <p className="text-xs text-slate-500">
                مزامنة المبيعات غير المسددة (is_merchant_settled = false) وتسجيل السداد في merchant_settlements
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={loadLiveMerchantSummaries}
              title="تحديث الأرصدة من الطلبات"
              className="p-1.5 rounded-lg text-slate-400 hover:text-[#0A192F] cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${syncingLive ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="إغلاق"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              اختر التاجر / المتجر
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={merchantId}
                onChange={(e) => handleMerchantChange(e.target.value)}
                className="flex-1 min-w-[230px] px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm bg-white text-[#0A192F] font-semibold"
              >
                {effectiveMerchants.length === 0 ? (
                  <option value="">لا توجد متاجر</option>
                ) : (
                  effectiveMerchants.map((m) => (
                    <option key={m.merchant.id} value={m.merchant.id}>
                      {m.name} — الرصيد المتبقي: {m.remainingBalance.toFixed(2)} ج.م
                    </option>
                  ))
                )}
              </select>

              <button
                type="button"
                onClick={() => setShowUnsettledOrders((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg border border-[#0A192F]/20 bg-slate-50 hover:bg-slate-100 text-[#0A192F] text-xs font-bold cursor-pointer whitespace-nowrap shrink-0"
              >
                <ListChecks className="w-4 h-4 text-[#FF7B00]" />
                <span>عرض الطلبات غير المسددة ({unsettledOrders.length})</span>
                {showUnsettledOrders ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          {selectedSummary && (
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-3 gap-3 text-xs">
              <div>
                <div className="text-slate-500">
                  إجمالي المبيعات (غير المسددة)
                </div>
                <div className="font-mono tabular-nums font-bold text-[#0A192F] mt-0.5">
                  {selectedSummary.totalSales.toFixed(2)} ج.م
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {selectedSummary.unsettledOrdersCount} طلب مُسلّم غير مسدد
                </div>
              </div>
              <div>
                <div className="text-slate-500">إجمالي المدفوع</div>
                <div className="font-mono tabular-nums font-bold text-emerald-700 mt-0.5">
                  {selectedSummary.totalPaid.toFixed(2)} ج.م
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  مسجل في merchant_settlements
                </div>
              </div>
              <div>
                <div className="text-slate-500">الرصيد المتبقي</div>
                <div className="font-mono tabular-nums font-bold text-[#FF7B00] mt-0.5">
                  {selectedSummary.remainingBalance.toFixed(2)} ج.م
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {selectedSummary.remainingBalance > 0
                    ? 'مستحق الدفع للتاجر'
                    : 'لا توجد مستحقات متبقية'}
                </div>
              </div>
            </div>
          )}

          {/* Unsettled Orders Breakdown Panel */}
          {showUnsettledOrders && (
            <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
              <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-[#0A192F]">
                  الطلبات المُسلّمة غير المسددة ({unsettledOrders.length})
                </span>
                {unsettledOrders.length > 0 && (
                  <button
                    type="button"
                    onClick={handleToggleAllUnsettled}
                    className="text-[11px] font-bold text-[#FF7B00] hover:underline cursor-pointer"
                  >
                    {selectedOrderIds.length === unsettledOrders.length
                      ? 'إلغاء تحديد الكل'
                      : 'تحديد الكل للسداد'}
                  </button>
                )}
              </div>

              {unsettledOrders.length === 0 ? (
                <div className="p-5 text-center text-xs text-slate-500">
                  لا توجد طلبات مُسلّمة غير مسددة لهذا التاجر حالياً
                </div>
              ) : (
                <div className="max-h-52 overflow-y-auto divide-y divide-slate-100">
                  {unsettledOrders.map((ord) => {
                    const checked = selectedOrderIds.includes(ord.id);
                    const payable = getOrderMerchantPayable(ord);
                    return (
                      <label
                        key={ord.id}
                        className={`flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs cursor-pointer transition-colors ${
                          checked ? 'bg-orange-50/60' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleOrderSelection(ord.id)}
                            className="rounded border-slate-300 text-[#FF7B00] focus:ring-[#FF7B00]"
                          />
                          <div className="min-w-0">
                            <div className="font-mono tabular-nums font-bold text-[#0A192F]">
                              {ord.order_number || ord.id.slice(0, 8)}
                            </div>
                            <div className="text-[11px] text-slate-500 truncate">
                              {ord.customer_name || 'عميل'} ·{' '}
                              {new Date(ord.created_at).toLocaleDateString('ar-EG')}
                            </div>
                          </div>
                        </div>

                        <div className="font-mono tabular-nums font-bold text-[#0A192F] whitespace-nowrap">
                          {payable.toFixed(2)} ج.م
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              المبلغ المدفوع (ج.م)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0.5}
                step="0.5"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="flex-1 px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
              />
              {selectedSummary && selectedSummary.remainingBalance > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setAmount(selectedSummary.remainingBalance.toFixed(2));
                    setSelectedOrderIds(unsettledOrders.map((o) => o.id));
                  }}
                  className="px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-[#0A192F] whitespace-nowrap cursor-pointer"
                >
                  كامل المستحق
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              صورة إيصال التحويل / الدفع (رفع إلى merchant_receipts)
            </label>
            <label className="flex flex-col items-center justify-center gap-1.5 p-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 cursor-pointer text-center">
              <FileUp className="w-5 h-5 text-[#FF7B00]" />
              <span className="text-xs font-bold text-[#0A192F]">
                {receiptFile
                  ? receiptFile.name
                  : 'اختر صورة الإيصال (JPG / PNG / PDF)'}
              </span>
              <input
                type="file"
                accept="image/*,.pdf"
                onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
                className="hidden"
              />
            </label>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              ملاحظات (اختياري)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="مثال: تحويل إنستاباي / تسوية أسبوعية"
              className="w-full px-3.5 py-2 rounded-lg border border-slate-200 text-sm"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={submitting || effectiveMerchants.length === 0}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#FF7B00] hover:bg-[#E56E00] disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
            >
              {submitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5" />
              )}
              <span>حفظ الدفعة للتاجر</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
