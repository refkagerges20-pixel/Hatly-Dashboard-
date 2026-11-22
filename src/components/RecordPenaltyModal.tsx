import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileUp,
  Gavel,
  Loader2,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { Courier } from '../types/database';

interface RecordPenaltyModalProps {
  open: boolean;
  onClose: () => void;
  couriers: Courier[];
  initialCourierId?: string;
  onSaved: (message: string) => void;
}

export function RecordPenaltyModal({
  open,
  onClose,
  couriers,
  initialCourierId,
  onSaved,
}: RecordPenaltyModalProps) {
  const { user } = useAuth();
  const [courierId, setCourierId] = useState<string>(
    initialCourierId || couriers[0]?.id || ''
  );
  const [penaltyType, setPenaltyType] = useState<'تأخير' | 'غياب' | 'أخرى'>('تأخير');
  const [amount, setAmount] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCourierId(initialCourierId || couriers[0]?.id || '');
      setPenaltyType('تأخير');
      setAmount('');
      setReason('');
      setProofFile(null);
      setError(null);
    }
  }, [open, initialCourierId, couriers]);

  if (!open) return null;

  const selectedCourier = couriers.find((c) => c.id === courierId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsedAmount = Number(amount);
    if (!courierId) {
      setError('يرجى اختيار المندوب');
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('يرجى إدخال قيمة جزاء صحيحة أكبر من صفر');
      return;
    }
    if (!reason.trim()) {
      setError('يرجى كتابة سبب الجزاء');
      return;
    }

    setSubmitting(true);

    try {
      let proofUrl: string | null = null;
      if (proofFile) {
        const ext = proofFile.name.split('.').pop() || 'jpg';
        const filePath = `${courierId}/penalty_${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from('courier_documents')
          .upload(filePath, proofFile, { upsert: true });
        if (uploadErr) {
          throw new Error(`تعذر رفع إثبات الجزاء: ${uploadErr.message}`);
        }
        const { data: urlData } = supabase.storage
          .from('courier_documents')
          .getPublicUrl(filePath);
        proofUrl = urlData.publicUrl;
      }

      const { error: insertErr } = await supabase
        .from('courier_penalties')
        .insert({
          courier_id: courierId,
          penalty_type: penaltyType,
          amount: Number(parsedAmount.toFixed(2)),
          reason: reason.trim(),
          proof_url: proofUrl,
          created_by: user?.id || null,
        });

      if (insertErr) {
        throw new Error(
          `تعذر حفظ الجزاء في courier_penalties: ${insertErr.message}`
        );
      }

      const courierName = selectedCourier?.profiles?.full_name || 'المندوب';
      onSaved(
        `تم تسجيل جزاء (${penaltyType}) بمبلغ ${parsedAmount.toFixed(2)} ج.م على المندوب ${courierName} وخصمه من العهدة`
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء تسجيل الجزاء');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0B1A33]/65 flex items-center justify-center p-4 overflow-y-auto">
      <div
        dir="rtl"
        className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg p-6 space-y-5 my-8"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-[#0B1A33] text-[#EF2323] flex items-center justify-center">
              <Gavel className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#0B1A33]">
                تسجيل جزاء على مندوب
              </h3>
              <p className="text-xs text-slate-500">
                يُخصم مبلغ الجزاء تلقائياً من عهدة المندوب المستحقة
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
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
              اختر المندوب <span className="text-red-600">*</span>
            </label>
            <select
              value={courierId}
              onChange={(e) => setCourierId(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm bg-white text-[#0B1A33] font-semibold"
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

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                نوع الجزاء <span className="text-red-600">*</span>
              </label>
              <select
                value={penaltyType}
                onChange={(e) =>
                  setPenaltyType(e.target.value as 'تأخير' | 'غياب' | 'أخرى')
                }
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm bg-white text-[#0B1A33] font-semibold"
              >
                <option value="تأخير">تأخير عن الوردية (Late)</option>
                <option value="غياب">غياب بدون إذن (Absent)</option>
                <option value="أخرى">مخالفة تشغيلية أخرى</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                مبلغ الجزاء (ج.م) <span className="text-red-600">*</span>
              </label>
              <input
                type="number"
                required
                min={1}
                step="0.5"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="50"
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-[#FF7F00]/30 focus:border-[#FF7F00]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              السبب / التفاصيل <span className="text-red-600">*</span>
            </label>
            <textarea
              rows={3}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="مثال: تأخير 45 دقيقة عن بداية الوردية الصباحية"
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF7F00]/30 focus:border-[#FF7F00]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              مرفق إثبات (اختياري)
            </label>
            <label className="flex flex-col items-center justify-center gap-1 p-3.5 rounded-xl border border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 cursor-pointer text-center">
              <FileUp className="w-4 h-4 text-[#FF7F00]" />
              <span className="text-xs font-semibold text-[#0B1A33]">
                {proofFile ? proofFile.name : 'إرفاق صورة أو ملف إثبات (اختياري)'}
              </span>
              <input
                type="file"
                accept="image/*,.pdf"
                onChange={(e) => setProofFile(e.target.files?.[0] || null)}
                className="hidden"
              />
            </label>
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
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#EF2323] hover:bg-red-700 disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
            >
              {submitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5" />
              )}
              <span>حفظ الجزاء وخصمه من العهدة</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
