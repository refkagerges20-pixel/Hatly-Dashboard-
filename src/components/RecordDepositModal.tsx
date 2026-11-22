import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileUp,
  Loader2,
  Receipt,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Courier } from '../types/database';
import { syncSingleCourierCashLimit } from '../utils/cashLimits';

export interface CourierCustodySummary {
  courier: Courier;
  name: string;
  phone: string;
  deliveredOrdersCount: number;
  deliveredCodCount: number;
  grossCollected: number;
  totalCommission: number;
  totalOwed: number;
  totalDeposited: number;
  totalPenalties?: number;
  remainingCustody: number;
}

interface RecordDepositModalProps {
  open: boolean;
  onClose: () => void;
  couriers: CourierCustodySummary[];
  commissionPct?: number;
  initialCourierId?: string;
  onSaved: (message: string) => void;
}

function pickDefaultCourierId(
  couriers: CourierCustodySummary[],
  initialCourierId?: string
): string {
  if (initialCourierId) return initialCourierId;
  const activeWithBalance = couriers.find(
    (c) =>
      c.remainingCustody > 0 ||
      c.grossCollected > 0 ||
      c.totalCommission > 0 ||
      c.deliveredOrdersCount > 0
  );
  return activeWithBalance?.courier.id || couriers[0]?.courier.id || '';
}

export function RecordDepositModal({
  open,
  onClose,
  couriers,
  commissionPct = 70,
  initialCourierId,
  onSaved,
}: RecordDepositModalProps) {
  const [courierId, setCourierId] = useState<string>(() =>
    pickDefaultCourierId(couriers, initialCourierId)
  );
  const [amount, setAmount] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCourierId((prev) => {
        if (initialCourierId) return initialCourierId;
        if (prev && couriers.some((c) => c.courier.id === prev)) {
          const current = couriers.find((c) => c.courier.id === prev);
          if (
            current &&
            (current.remainingCustody > 0 ||
              current.grossCollected > 0 ||
              current.deliveredOrdersCount > 0)
          ) {
            return prev;
          }
        }
        return pickDefaultCourierId(couriers, initialCourierId);
      });
      setError(null);
    }
  }, [open, initialCourierId, couriers]);

  if (!open) return null;

  const selectedSummary = couriers.find((c) => c.courier.id === courierId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsedAmount = Number(amount);
    if (!courierId) {
      setError('يرجى اختيار المندوب');
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('يرجى إدخال مبلغ توريد صحيح أكبر من صفر');
      return;
    }
    if (!receiptFile) {
      setError('يرجى إرفاق صورة إيصال التوريد');
      return;
    }

    setSubmitting(true);

    try {
      const ext = receiptFile.name.split('.').pop() || 'jpg';
      const filePath = `${courierId}/deposit_${Date.now()}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from('deposit_receipts')
        .upload(filePath, receiptFile, { upsert: true });

      if (uploadErr) {
        throw new Error(`فشل رفع صورة الإيصال: ${uploadErr.message}`);
      }

      const { data: urlData } = supabase.storage
        .from('deposit_receipts')
        .getPublicUrl(filePath);

      const receiptUrl = urlData.publicUrl;

      const { error: insertErr } = await supabase
        .from('courier_deposits')
        .insert({
          courier_id: courierId,
          amount: parsedAmount,
          receipt_url: receiptUrl,
          notes: notes.trim() || null,
        });

      if (insertErr) {
        throw new Error(`تعذر حفظ التوريد في courier_deposits: ${insertErr.message}`);
      }

      const syncRes = await syncSingleCourierCashLimit(courierId);
      const courierName = selectedSummary?.name || 'المندوب';
      const unlockedNote =
        selectedSummary?.courier.account_status === 'suspended' &&
        syncRes.courier?.account_status === 'active'
          ? ' — وتم إعادة تفعيل حساب المندوب تلقائياً'
          : '';

      setAmount('');
      setNotes('');
      setReceiptFile(null);
      onSaved(
        `تم تسجيل توريد بمبلغ ${parsedAmount.toFixed(2)} ج.م للمندوب ${courierName} وخصمه من العهدة${unlockedNote}`
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء تسجيل التوريد');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0A192F]/60 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg p-6 space-y-5 my-8">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-[#0A192F] text-[#FF7B00] flex items-center justify-center">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#0A192F]">تسجيل توريد عهدة</h3>
              <p className="text-xs text-slate-500">
                خصم المبلغ المورد من رصيد عهدة المندوب مع إرفاق الإيصال
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              اختر المندوب
            </label>
            <select
              value={courierId}
              onChange={(e) => setCourierId(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm bg-white text-[#0A192F] font-semibold"
            >
              {couriers.length === 0 ? (
                <option value="">لا يوجد مناديب</option>
              ) : (
                couriers.map((c) => (
                  <option key={c.courier.id} value={c.courier.id}>
                    {c.name} — العهدة المتبقية: {c.remainingCustody.toFixed(2)} ج.م ({c.deliveredOrdersCount} طلب مُسلّم)
                  </option>
                ))
              )}
            </select>
          </div>

          {selectedSummary && (
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div>
                  <div className="text-slate-500">إجمالي المحصّل</div>
                  <div className="font-mono tabular-nums font-bold text-[#0A192F] mt-0.5">
                    {selectedSummary.grossCollected.toFixed(2)} ج.م
                  </div>
                  <div className="text-[10px] text-slate-400">
                    ({selectedSummary.deliveredCodCount} طلب كاش)
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">عمولة المندوب ({commissionPct}%)</div>
                  <div className="font-mono tabular-nums font-bold text-emerald-700 mt-0.5">
                    {selectedSummary.totalCommission.toFixed(2)} ج.م
                  </div>
                  <div className="text-[10px] text-slate-400">
                    ({selectedSummary.deliveredOrdersCount} طلب مُسلّم)
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">إجمالي التوريدات</div>
                  <div className="font-mono tabular-nums font-bold text-slate-700 mt-0.5">
                    {selectedSummary.totalDeposited.toFixed(2)} ج.م
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">العهدة المستحقة</div>
                  <div className="font-mono tabular-nums font-bold text-[#FF7B00] mt-0.5">
                    {selectedSummary.remainingCustody.toFixed(2)} ج.م
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200/80 text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-1">
                <span>
                  معادلة العهدة (المحصّل − العمولة − التوريدات
                  {(selectedSummary.totalPenalties ?? 0) > 0 ? ' − الجزاءات' : ''}):
                </span>
                <span className="font-mono tabular-nums font-semibold text-[#0B1A33]">
                  {selectedSummary.grossCollected.toFixed(2)} −{' '}
                  {selectedSummary.totalCommission.toFixed(2)} −{' '}
                  {selectedSummary.totalDeposited.toFixed(2)}
                  {(selectedSummary.totalPenalties ?? 0) > 0
                    ? ` − ${(selectedSummary.totalPenalties ?? 0).toFixed(2)}`
                    : ''}{' '}
                  = {selectedSummary.remainingCustody.toFixed(2)} ج.م
                </span>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              مبلغ التوريد (ج.م)
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
              {selectedSummary && selectedSummary.remainingCustody > 0 && (
                <button
                  type="button"
                  onClick={() => setAmount(selectedSummary.remainingCustody.toFixed(2))}
                  className="px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-[#0A192F] whitespace-nowrap cursor-pointer"
                >
                  كامل العهدة
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              صورة إيصال التوريد (رفع إلى deposit_receipts)
            </label>
            <label className="flex flex-col items-center justify-center gap-1.5 p-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 cursor-pointer text-center">
              <FileUp className="w-5 h-5 text-[#FF7B00]" />
              <span className="text-xs font-bold text-[#0A192F]">
                {receiptFile ? receiptFile.name : 'اختر صورة الإيصال (JPG / PNG / PDF)'}
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
              placeholder="مثال: تحويل إنستاباي / توريد نقدي للخزينة"
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
              disabled={submitting || couriers.length === 0}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#FF7B00] hover:bg-[#E56E00] disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
            >
              {submitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5" />
              )}
              <span>حفظ التوريد وخصم العهدة</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
