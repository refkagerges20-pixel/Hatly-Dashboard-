import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Wallet,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

interface AddExpenseModalProps {
  open: boolean;
  onClose: () => void;
  defaultDate?: string;
  onSaved: (message: string) => void;
}

function getTodayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function AddExpenseModal({
  open,
  onClose,
  defaultDate,
  onSaved,
}: AddExpenseModalProps) {
  const [title, setTitle] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [expenseDate, setExpenseDate] = useState<string>(
    defaultDate || getTodayDateString()
  );
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setExpenseDate(defaultDate || getTodayDateString());
      setError(null);
    }
  }, [open, defaultDate]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    const parsedAmount = Number(amount);

    if (!trimmedTitle) {
      setError('يرجى إدخال نوع المصروف / العنوان');
      return;
    }
    if (!trimmedDescription) {
      setError('البيان / التفاصيل حقل إجباري، يرجى توضيح سبب المصروف');
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('يرجى إدخال مبلغ صحيح أكبر من صفر');
      return;
    }
    if (!expenseDate) {
      setError('يرجى تحديد تاريخ المصروف');
      return;
    }

    setSubmitting(true);

    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id || null;

      const payload: {
        title: string;
        description: string;
        amount: number;
        expense_date: string;
        created_by?: string | null;
      } = {
        title: trimmedTitle,
        description: trimmedDescription,
        amount: Number(parsedAmount.toFixed(2)),
        expense_date: expenseDate,
      };

      if (userId) {
        payload.created_by = userId;
      }

      const { error: insertErr } = await supabase.from('expenses').insert(payload);

      if (insertErr) {
        throw new Error(`تعذر حفظ المصروف: ${insertErr.message}`);
      }

      setTitle('');
      setDescription('');
      setAmount('');
      onSaved(
        `تم تسجيل مصروف "${trimmedTitle}" بمبلغ ${parsedAmount.toFixed(2)} ج.م`
      );
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'حدث خطأ أثناء حفظ المصروف'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0A192F]/60 flex items-center justify-center p-4 overflow-y-auto">
      <div
        dir="rtl"
        className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg p-6 space-y-5 my-8"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-[#0A192F] text-[#FF7B00] flex items-center justify-center">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#0A192F]">
                إضافة مصروف جديد
              </h3>
              <p className="text-xs text-slate-500">
                تسجيل المصاريف التشغيلية مع توضيح البيان التفصيلي
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
            <label
              htmlFor="expense-title"
              className="block text-xs font-semibold text-slate-700 mb-1.5"
            >
              نوع المصروف / العنوان <span className="text-red-600">*</span>
            </label>
            <input
              id="expense-title"
              type="text"
              required
              list="expense-title-suggestions"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: بنزين، صيانة، مرتب"
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm text-[#0A192F] font-semibold focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
            />
            <datalist id="expense-title-suggestions">
              <option value="بنزين" />
              <option value="صيانة" />
              <option value="مرتب" />
              <option value="إيجار" />
              <option value="اتصالات وإنترنت" />
              <option value="أدوات ومستلزمات" />
            </datalist>
          </div>

          <div>
            <label
              htmlFor="expense-description"
              className="block text-xs font-semibold text-slate-700 mb-1.5"
            >
              البيان / التفاصيل <span className="text-red-600">*</span>
            </label>
            <textarea
              id="expense-description"
              required
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="مثال: بنزين لموتوسيكل جون - 3 لتر"
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm text-[#0A192F] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00] resize-y"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="expense-amount"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                المبلغ (ج.م) <span className="text-red-600">*</span>
              </label>
              <input
                id="expense-amount"
                type="number"
                required
                min={0.5}
                step="0.5"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm font-mono tabular-nums text-[#0A192F] focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
              />
            </div>

            <div>
              <label
                htmlFor="expense-date"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                التاريخ <span className="text-red-600">*</span>
              </label>
              <input
                id="expense-date"
                type="date"
                required
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm font-mono tabular-nums text-[#0A192F] focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#FF7B00] hover:bg-[#E56E00] disabled:opacity-60 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
            >
              {submitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5" />
              )}
              <span>حفظ المصروف</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
