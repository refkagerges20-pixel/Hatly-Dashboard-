import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileUp,
  Loader2,
  LogOut,
  Receipt,
  ShieldAlert,
  Wallet,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { HatlyLogo } from './HatlyLogo';
import {
  MAX_LIMIT_SUSPENDED_MSG,
  syncSingleCourierCashLimit,
} from '../utils/cashLimits';
import { invalidateSummaryCache } from '../utils/summaryCache';

export function CourierDepositLockPage() {
  const {
    fullName,
    courierRecord,
    courierCashStatus,
    refreshProfile,
    signOut,
  } = useAuth();

  const [amount, setAmount] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!courierRecord || !courierCashStatus) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-[#0A192F] text-[#FF7B00] flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h1 className="text-lg font-extrabold text-[#0A192F]">
            حساب المندوب غير مكتمل الربط
          </h1>
          <p className="text-sm text-slate-600">
            لم يتم العثور على ملف مندوب مرتبط بحسابك حالياً. يرجى التواصل مع الإدارة أو تسجيل الخروج.
          </p>
          <button
            type="button"
            onClick={signOut}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#0A192F] text-white text-sm font-bold cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </div>
    );
  }

  const {
    grossCollected,
    totalDeposited,
    cashBalance,
    dailyLimit,
    maxLimit,
  } = courierCashStatus;

  const minRequiredToUnlock = Math.max(
    0,
    Number((cashBalance - (dailyLimit - 1)).toFixed(2))
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const parsedAmount = Number(amount);
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
      const filePath = `${courierRecord.id}/deposit_${Date.now()}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from('deposit_receipts')
        .upload(filePath, receiptFile, { upsert: true });

      if (uploadErr) {
        throw new Error(`فشل رفع صورة الإيصال: ${uploadErr.message}`);
      }

      const { data: urlData } = supabase.storage
        .from('deposit_receipts')
        .getPublicUrl(filePath);

      const { error: insertErr } = await supabase
        .from('courier_deposits')
        .insert({
          courier_id: courierRecord.id,
          amount: parsedAmount,
          receipt_url: urlData.publicUrl,
          notes: notes.trim() || 'توريد لفك إيقاف حد الكاش',
        });

      if (insertErr) {
        throw new Error(`تعذر حفظ التوريد في courier_deposits: ${insertErr.message}`);
      }

      invalidateSummaryCache();
      const syncRes = await syncSingleCourierCashLimit(courierRecord.id);
      const newBalance = syncRes.status?.cashBalance ?? cashBalance - parsedAmount;

      setAmount('');
      setNotes('');
      setReceiptFile(null);

      if (newBalance < dailyLimit) {
        setSuccessMsg(
          `تم تسجيل توريد ${parsedAmount.toFixed(2)} ج.م وإعادة تفعيل حسابك بنجاح! جاري نقلك إلى لوحة العمل...`
        );
      } else {
        const remainingToUnlock = Math.max(
          0,
          Number((newBalance - (dailyLimit - 1)).toFixed(2))
        );
        setSuccessMsg(
          `تم تسجيل التوريد (${parsedAmount.toFixed(2)} ج.م). الرصيد المتبقي حالياً ${newBalance.toFixed(2)} ج.م، ويرجى توريد ${remainingToUnlock.toFixed(2)} ج.م إضافية على الأقل لينخفض الرصيد دون ${dailyLimit.toFixed(0)} ج.م ويفتح الحساب.`
        );
      }

      await refreshProfile();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'حدث خطأ أثناء تسجيل التوريد'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top Bar */}
      <header className="h-16 bg-[#0B1A33] text-white px-4 sm:px-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <HatlyLogo size="sm" darkBg />
          <div className="text-[11px] text-slate-300 hidden sm:block">
            صفحة توريد العهدة · {fullName || 'مندوب توصيل'}
          </div>
        </div>
        <button
          type="button"
          onClick={signOut}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/20 text-xs font-semibold text-slate-100 hover:bg-white/10 cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>تسجيل الخروج</span>
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-2xl space-y-5">
          {/* Mandatory Lock Alert */}
          <div className="bg-red-50 border-2 border-red-300 rounded-2xl p-5 flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-red-600 text-white flex items-center justify-center shrink-0">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <h1 className="text-base sm:text-lg font-extrabold text-red-900">
                الحساب موقوف مؤقتاً — تجاوز الحد الأقصى للكاش
              </h1>
              <p className="text-sm font-bold text-red-800 leading-relaxed">
                {MAX_LIMIT_SUSPENDED_MSG}
              </p>
              <p className="text-xs text-red-700">
                لإعادة تفعيل الحساب والعودة للوحة العمل، يجب تسجيل توريد يخفض رصيد الكاش إلى أقل من{' '}
                <strong className="font-mono tabular-nums">
                  {dailyLimit.toFixed(0)} ج.م
                </strong>
                .
              </p>
            </div>
          </div>

          {/* Cash Balance Breakdown */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-[#0A192F]">
              <Wallet className="w-4 h-4 text-[#FF7B00]" />
              <span>ملخص رصيد الكاش الحالي</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-[11px] text-slate-500">محصّل طلبات الكاش</div>
                <div className="text-base font-extrabold font-mono tabular-nums text-[#0A192F] mt-1">
                  {grossCollected.toFixed(2)} ج.م
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-[11px] text-slate-500">إجمالي التوريدات</div>
                <div className="text-base font-extrabold font-mono tabular-nums text-emerald-700 mt-1">
                  {totalDeposited.toFixed(2)} ج.م
                </div>
              </div>
              <div className="p-3 rounded-xl bg-red-50 border border-red-200">
                <div className="text-[11px] text-red-700 font-semibold">
                  رصيد الكاش الحالي
                </div>
                <div className="text-base font-extrabold font-mono tabular-nums text-red-700 mt-1">
                  {cashBalance.toFixed(2)} ج.م
                </div>
              </div>
              <div className="p-3 rounded-xl bg-[#0A192F] text-white">
                <div className="text-[11px] text-slate-300">
                  الحد الأقصى / حد الفتح
                </div>
                <div className="text-sm font-extrabold font-mono tabular-nums text-[#FF7B00] mt-1">
                  {maxLimit.toFixed(0)} / &lt;{dailyLimit.toFixed(0)} ج.م
                </div>
              </div>
            </div>
          </div>

          {/* Deposit Submission Card */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
            <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4">
              <div className="w-9 h-9 rounded-lg bg-[#0A192F] text-[#FF7B00] flex items-center justify-center">
                <Receipt className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-[#0A192F]">
                  صفحة تسجيل التوريد
                </h2>
                <p className="text-xs text-slate-500">
                  قم بتسجيل مبلغ التوريد وإرفاق إيصال الدفع لإعادة تفعيل حسابك فوراً
                </p>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="flex items-center gap-2 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold"
              >
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {successMsg && (
              <div
                role="status"
                className="flex items-center gap-2 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  مبلغ التوريد (ج.م)
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    step="0.5"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={minRequiredToUnlock.toFixed(2)}
                    className="flex-1 min-w-[180px] px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm font-mono tabular-nums font-bold text-[#0A192F] focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
                  />
                  {minRequiredToUnlock > 0 && (
                    <button
                      type="button"
                      onClick={() => setAmount(minRequiredToUnlock.toFixed(2))}
                      className="px-3 py-2.5 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-xs font-bold text-emerald-800 cursor-pointer whitespace-nowrap"
                    >
                      الحد الأدنى للفتح ({minRequiredToUnlock.toFixed(2)} ج.م)
                    </button>
                  )}
                  {cashBalance > 0 && (
                    <button
                      type="button"
                      onClick={() => setAmount(cashBalance.toFixed(2))}
                      className="px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-[#0A192F] cursor-pointer whitespace-nowrap"
                    >
                      كامل الكاش ({cashBalance.toFixed(2)} ج.م)
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  صورة إيصال التوريد (رفع إلى deposit_receipts)
                </label>
                <label className="flex flex-col items-center justify-center gap-1.5 p-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 cursor-pointer text-center">
                  <FileUp className="w-6 h-6 text-[#FF7B00]" />
                  <span className="text-xs font-bold text-[#0A192F]">
                    {receiptFile
                      ? receiptFile.name
                      : 'اضغط لاختيار صورة الإيصال (JPG / PNG / PDF)'}
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
                  placeholder="مثال: تحويل إنستاباي / توريد نقدي"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#FF7B00] hover:bg-[#E56E00] disabled:opacity-60 text-white text-sm font-bold cursor-pointer"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                <span>تسجيل التوريد وإعادة فتح الحساب</span>
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
