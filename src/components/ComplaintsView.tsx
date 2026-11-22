import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Send,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Complaint, Customer, Order } from '../types/database';

const COMPLAINT_REPLY_PREFIX = 'complaint_reply_';

export function ComplaintsView() {
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [repliesMap, setRepliesMap] = useState<Map<string, string>>(new Map());
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'resolved'>(
    'all'
  );
  const [loading, setLoading] = useState(true);
  const [selectedComplaint, setSelectedComplaint] = useState<Complaint | null>(
    null
  );
  const [replyText, setReplyText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const loadComplaints = useCallback(async () => {
    setLoading(true);

    const [compRes, custRes, ordRes, settingsRes] = await Promise.all([
      supabase
        .from('complaints')
        .select('*')
        .order('created_at', { ascending: false }),
      supabase.from('customers').select('*, profiles(full_name, phone, email)'),
      supabase.from('orders').select('id, order_number, customer_name, customer_phone'),
      supabase
        .from('system_settings')
        .select('*')
        .like('setting_key', `${COMPLAINT_REPLY_PREFIX}%`),
    ]);

    if (compRes.error) {
      setFeedback({
        type: 'error',
        text: `تعذر تحميل الشكاوى: ${compRes.error.message}`,
      });
      setComplaints([]);
    } else {
      setComplaints((compRes.data as Complaint[]) || []);
    }

    setCustomers((custRes.data as Customer[]) || []);
    setOrders((ordRes.data as Order[]) || []);

    const rMap = new Map<string, string>();
    if (!settingsRes.error && settingsRes.data) {
      for (const row of settingsRes.data as Array<{
        setting_key: string;
        setting_value: string;
      }>) {
        const compId = row.setting_key.replace(COMPLAINT_REPLY_PREFIX, '');
        if (compId && row.setting_value) {
          rMap.set(compId, row.setting_value);
        }
      }
    }
    setRepliesMap(rMap);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadComplaints();
  }, [loadComplaints]);

  const customerMap = useMemo(() => {
    const map = new Map<string, { name: string; phone: string }>();
    customers.forEach((c) => {
      const info = {
        name: c.profiles?.full_name || 'عميل',
        phone: c.profiles?.phone || '—',
      };
      map.set(c.id, info);
      if (c.profile_id) map.set(c.profile_id, info);
    });
    return map;
  }, [customers]);

  const orderMap = useMemo(() => {
    const map = new Map<string, Order>();
    orders.forEach((o) => map.set(o.id, o));
    return map;
  }, [orders]);

  const filteredComplaints = useMemo(() => {
    return complaints.filter((c) => {
      const st = String(c.status || 'open').toLowerCase();
      if (statusFilter === 'resolved') return st === 'resolved';
      if (statusFilter === 'open') return st !== 'resolved';
      return true;
    });
  }, [complaints, statusFilter]);

  const openReplyModal = (c: Complaint) => {
    setSelectedComplaint(c);
    setReplyText(repliesMap.get(c.id) || '');
  };

  const handleSaveReplyAndResolve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedComplaint) return;
    if (!replyText.trim()) {
      setFeedback({ type: 'error', text: 'يرجى كتابة نص الرد على الشكوى' });
      return;
    }

    setSubmitting(true);

    const settingKey = `${COMPLAINT_REPLY_PREFIX}${selectedComplaint.id}`;
    const [replyUpsert, statusUpdate] = await Promise.all([
      supabase.from('system_settings').upsert(
        {
          setting_key: settingKey,
          setting_value: replyText.trim(),
        },
        { onConflict: 'setting_key' }
      ),
      supabase
        .from('complaints')
        .update({ status: 'resolved' })
        .eq('id', selectedComplaint.id),
    ]);

    setSubmitting(false);

    if (statusUpdate.error) {
      setFeedback({
        type: 'error',
        text: `تعذر تحديث حالة الشكوى: ${statusUpdate.error.message}`,
      });
      return;
    }

    if (replyUpsert.error) {
      setFeedback({
        type: 'error',
        text: `تم إغلاق الشكوى لكن تعذر حفظ نص الرد: ${replyUpsert.error.message}`,
      });
    } else {
      setFeedback({
        type: 'success',
        text: `تم تسجيل الرد وتغيير حالة الشكوى إلى "تم الحل"`,
      });
    }

    setSelectedComplaint(null);
    await loadComplaints();
  };

  const handleQuickStatus = async (c: Complaint, nextStatus: 'open' | 'resolved') => {
    const { error } = await supabase
      .from('complaints')
      .update({ status: nextStatus })
      .eq('id', c.id);
    if (error) {
      setFeedback({ type: 'error', text: error.message });
      return;
    }
    setComplaints((prev) =>
      prev.map((item) =>
        item.id === c.id ? { ...item, status: nextStatus } : item
      )
    );
  };

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

      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-[#0B1A33] text-[#FF7F00] flex items-center justify-center shrink-0">
            <MessageSquareText className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#0B1A33]">
              الشكاوى والدعم الفني (complaints)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              متابعة شكاوى العملاء والرد عليها وإغلاقها بعد المعالجة
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {[
              { id: 'all', label: 'الكل' },
              { id: 'open', label: 'قيد المراجعة' },
              { id: 'resolved', label: 'تم الحل' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() =>
                  setStatusFilter(tab.id as 'all' | 'open' | 'resolved')
                }
                className={`px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                  statusFilter === tab.id
                    ? 'bg-white text-[#0B1A33] shadow-xs'
                    : 'text-slate-600'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={loadComplaints}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>تحديث</span>
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-10 flex flex-col items-center justify-center gap-3 text-slate-500">
            <Loader2 className="w-6 h-6 text-[#FF7F00] animate-spin" />
            <span className="text-sm">جاري تحميل الشكاوى...</span>
          </div>
        ) : filteredComplaints.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-500">
            لا توجد شكاوى مسجلة في هذا التصنيف حالياً
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                  <th className="py-3 px-4 whitespace-nowrap">العميل / الطلب</th>
                  <th className="py-3 px-4 whitespace-nowrap">الموضوع</th>
                  <th className="py-3 px-4">تفاصيل الشكوى والرد</th>
                  <th className="py-3 px-4 whitespace-nowrap">التاريخ</th>
                  <th className="py-3 px-4 whitespace-nowrap">الحالة</th>
                  <th className="py-3 px-4 whitespace-nowrap">الإجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredComplaints.map((c) => {
                  const order = c.order_id ? orderMap.get(c.order_id) : undefined;
                  const cust = c.customer_id
                    ? customerMap.get(c.customer_id)
                    : undefined;
                  const savedReply = repliesMap.get(c.id);
                  const isResolved =
                    String(c.status || '').toLowerCase() === 'resolved';

                  return (
                    <tr key={c.id} className="hover:bg-slate-50/70 align-top">
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-bold text-[#0B1A33]">
                          {cust?.name || order?.customer_name || 'عميل'}
                        </div>
                        {(cust?.phone || order?.customer_phone) && (
                          <div
                            className="text-xs text-slate-500 font-mono tabular-nums"
                            dir="ltr"
                          >
                            {cust?.phone || order?.customer_phone}
                          </div>
                        )}
                        {order?.order_number && (
                          <div className="text-[11px] font-mono font-bold text-[#FF7F00] mt-0.5">
                            طلب: {order.order_number}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 font-bold text-[#0B1A33] whitespace-nowrap">
                        {c.subject}
                      </td>
                      <td className="py-3 px-4 max-w-md space-y-2">
                        <p className="text-xs sm:text-sm text-slate-700 leading-relaxed whitespace-normal">
                          {c.message}
                        </p>
                        {savedReply && (
                          <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
                            <span className="font-bold">رد الدعم: </span>
                            {savedReply}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-500 whitespace-nowrap">
                        {new Date(c.created_at).toLocaleString('ar-EG')}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold ${
                            isResolved
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {isResolved ? 'تم الحل' : 'مفتوحة'}
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openReplyModal(c)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#FF7F00] hover:bg-[#E57000] text-white text-xs font-bold cursor-pointer"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>{savedReply ? 'تعديل الرد' : 'رد وحل'}</span>
                          </button>
                          {isResolved && (
                            <button
                              type="button"
                              onClick={() => handleQuickStatus(c, 'open')}
                              className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                            >
                              إعادة فتح
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedComplaint && (
        <div className="fixed inset-0 z-50 bg-[#0B1A33]/65 flex items-center justify-center p-4">
          <div
            dir="rtl"
            className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-[#0B1A33]">
                  الرد على الشكوى وحلها
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {selectedComplaint.subject}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedComplaint(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 leading-relaxed">
              {selectedComplaint.message}
            </div>

            <form onSubmit={handleSaveReplyAndResolve} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  نص الرد للعميل <span className="text-red-600">*</span>
                </label>
                <textarea
                  rows={4}
                  required
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="اكتب رد خدمة العملاء أو الإجراء المتخذ لحل الشكوى..."
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF7F00]/30 focus:border-[#FF7F00]"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setSelectedComplaint(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
                >
                  {submitting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  )}
                  <span>إرسال الرد وتحديد كـ "تم الحل"</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
