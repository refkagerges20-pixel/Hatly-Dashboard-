import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BellRing,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  Send,
  Trash2,
  Users,
  Zap,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Courier, CourierShift } from '../types/database';

function toLocalDateInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getTodayDateKey(): string {
  return toLocalDateInput(new Date());
}

function getTomorrowDateKey(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return toLocalDateInput(d);
}

function formatShiftTime(value?: string | null): string {
  if (!value) return '—';
  const trimmed = value.trim();
  if (/^\d{2}:\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 5);
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed;
  return parsed.toLocaleTimeString('ar-EG', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getUrgentTimeRange(): { start: string; end: string } {
  const now = new Date();
  const startH = now.getHours();
  const endH = Math.min(23, startH + 8);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    start: `${pad(startH)}:00`,
    end: `${pad(endH)}:59`,
  };
}

export function CourierShiftsView() {
  const [shifts, setShifts] = useState<CourierShift[]>([]);
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Create Shift Form State
  const [shiftDate, setShiftDate] = useState<string>(getTomorrowDateKey);
  const [startTime, setStartTime] = useState<string>('09:00');
  const [endTime, setEndTime] = useState<string>('17:00');
  const [selectedCourierIds, setSelectedCourierIds] = useState<string[]>([]);
  const [courierSearch, setCourierSearch] = useState<string>('');

  // History / Upcoming Filters
  const [historyTab, setHistoryTab] = useState<'upcoming' | 'all'>('upcoming');
  const [filterCourierId, setFilterCourierId] = useState<string>('all');

  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);

    const [shiftsRes, couriersRes] = await Promise.all([
      supabase
        .from('courier_shifts')
        .select('*')
        .order('shift_date', { ascending: true })
        .order('start_time', { ascending: true }),
      supabase
        .from('couriers')
        .select('*, profiles(full_name, phone)')
        .order('created_at', { ascending: false }),
    ]);

    if (shiftsRes.error) {
      setFeedback({
        type: 'error',
        text: `تعذر تحميل جدول الورديات: ${shiftsRes.error.message}`,
      });
      setShifts([]);
    } else {
      setShifts((shiftsRes.data as CourierShift[]) || []);
    }

    if (!couriersRes.error && couriersRes.data) {
      setCouriers((couriersRes.data as Courier[]) || []);
    } else {
      const fb = await supabase.from('couriers').select('*');
      setCouriers((fb.data as Courier[]) || []);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Realtime sync with Courier App changes
  useEffect(() => {
    const channel = supabase
      .channel('admin_courier_shifts_sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'courier_shifts' },
        () => {
          loadData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadData]);

  const courierNameMap = useMemo(() => {
    const map = new Map<string, { name: string; phone: string }>();
    couriers.forEach((c) => {
      const info = {
        name: c.profiles?.full_name || 'مندوب',
        phone: c.profiles?.phone || '—',
      };
      map.set(c.id, info);
      if (c.profile_id) map.set(c.profile_id, info);
    });
    return map;
  }, [couriers]);

  const visibleCouriersForSelect = useMemo(() => {
    const q = courierSearch.trim().toLowerCase();
    if (!q) return couriers;
    return couriers.filter((c) => {
      const name = c.profiles?.full_name?.toLowerCase() || '';
      const phone = c.profiles?.phone?.toLowerCase() || '';
      return name.includes(q) || phone.includes(q);
    });
  }, [couriers, courierSearch]);

  const activeCouriers = useMemo(
    () => couriers.filter((c) => c.account_status !== 'suspended'),
    [couriers]
  );

  const allVisibleSelected =
    visibleCouriersForSelect.length > 0 &&
    visibleCouriersForSelect.every((c) => selectedCourierIds.includes(c.id));

  const toggleCourierSelection = (id: string) => {
    setSelectedCourierIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleToggleSelectAll = () => {
    if (allVisibleSelected) {
      const visibleSet = new Set(visibleCouriersForSelect.map((c) => c.id));
      setSelectedCourierIds((prev) => prev.filter((id) => !visibleSet.has(id)));
    } else {
      const merged = new Set([
        ...selectedCourierIds,
        ...visibleCouriersForSelect.map((c) => c.id),
      ]);
      setSelectedCourierIds(Array.from(merged));
    }
  };

  const handleAssignTodayQuickAction = () => {
    const today = getTodayDateKey();
    const urgent = getUrgentTimeRange();
    setShiftDate(today);
    setStartTime(urgent.start);
    setEndTime(urgent.end);
    if (selectedCourierIds.length === 0) {
      setSelectedCourierIds(
        (activeCouriers.length > 0 ? activeCouriers : couriers).map((c) => c.id)
      );
    }
    setFeedback({
      type: 'info',
      text: `تم تجهيز وردية اليوم (${today}) من ${urgent.start} إلى ${urgent.end} — راجع المناديب المختارين واضغط "نشر الورديات"`,
    });
  };

  const handlePublishShifts = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (!shiftDate) {
      setFeedback({ type: 'error', text: 'يرجى تحديد تاريخ الوردية' });
      return;
    }
    if (!startTime || !endTime) {
      setFeedback({ type: 'error', text: 'يرجى تحديد وقت البدء ووقت الانتهاء' });
      return;
    }
    if (endTime <= startTime) {
      setFeedback({
        type: 'error',
        text: 'وقت الانتهاء يجب أن يكون بعد وقت البدء',
      });
      return;
    }
    if (selectedCourierIds.length === 0) {
      setFeedback({
        type: 'error',
        text: 'يرجى اختيار مندوب واحد على الأقل أو الضغط على "تحديد الكل"',
      });
      return;
    }

    setSubmitting(true);

    const rowsToInsert = selectedCourierIds.map((courierId) => ({
      courier_id: courierId,
      shift_date: shiftDate,
      start_time: startTime,
      end_time: endTime,
      status: 'scheduled',
      late_minutes: 0,
    }));

    const { error: insertErr } = await supabase
      .from('courier_shifts')
      .insert(rowsToInsert);

    setSubmitting(false);

    if (insertErr) {
      setFeedback({
        type: 'error',
        text: `تعذر نشر الورديات في courier_shifts: ${insertErr.message}`,
      });
      return;
    }

    setFeedback({
      type: 'success',
      text: `تم نشر الورديات وإرسال الإشعارات بنجاح (${rowsToInsert.length} مندوب ليوم ${shiftDate})`,
    });
    setSelectedCourierIds([]);
    await loadData();
  };

  const handleDeleteShift = async (shift: CourierShift) => {
    setDeletingId(shift.id);
    const { error: delErr } = await supabase
      .from('courier_shifts')
      .delete()
      .eq('id', shift.id);
    setDeletingId(null);

    if (delErr) {
      setFeedback({
        type: 'error',
        text: `تعذر حذف الوردية: ${delErr.message}`,
      });
      return;
    }

    setShifts((prev) => prev.filter((s) => s.id !== shift.id));
    setFeedback({
      type: 'success',
      text: 'تم إلغاء الوردية المجدولة بنجاح',
    });
  };

  const todayKey = getTodayDateKey();

  const displayedShifts = useMemo(() => {
    const filtered = shifts.filter((s) => {
      if (historyTab === 'upcoming' && s.shift_date < todayKey) {
        return false;
      }
      if (filterCourierId !== 'all') {
        const courier = couriers.find((c) => c.id === filterCourierId);
        if (
          s.courier_id !== filterCourierId &&
          s.courier_id !== courier?.profile_id
        ) {
          return false;
        }
      }
      return true;
    });

    // Upcoming ascending by date; All history descending so newest first
    if (historyTab === 'all') {
      return [...filtered].sort((a, b) =>
        `${b.shift_date} ${b.start_time}`.localeCompare(
          `${a.shift_date} ${a.start_time}`
        )
      );
    }
    return filtered;
  }, [shifts, historyTab, todayKey, filterCourierId, couriers]);

  const upcomingCount = useMemo(
    () => shifts.filter((s) => s.shift_date >= todayKey).length,
    [shifts, todayKey]
  );

  const lateShiftsCount = useMemo(
    () => shifts.filter((s) => Number(s.late_minutes || 0) > 0).length,
    [shifts]
  );

  return (
    <div dir="rtl" className="space-y-6">
      {feedback && (
        <div
          role="status"
          className={`flex items-center justify-between gap-3 p-4 rounded-xl border text-sm font-semibold ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : feedback.type === 'info'
              ? 'bg-amber-50 border-amber-200 text-[#0B1A33]'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <BellRing className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : feedback.type === 'info' ? (
              <Zap className="w-4 h-4 text-[#FF7F00] shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs underline cursor-pointer shrink-0"
          >
            إخفاء
          </button>
        </div>
      )}

      {/* Top Header + Quick Action */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#0B1A33] text-[#FF7F00] flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#0B1A33]">
              إدارة وجدولة ورديات المناديب
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              نشر الورديات الجماعية لجميع المناديب وإرسالها فوراً لتطبيق المندوب ({upcomingCount} وردية قادمة · {lateShiftsCount} حالة تأخير مسجلة)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleAssignTodayQuickAction}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0B1A33] hover:bg-[#13294B] text-white text-xs font-bold cursor-pointer whitespace-nowrap shrink-0"
          >
            <Zap className="w-3.5 h-3.5 text-[#FF7F00]" />
            <span>تعيين وردية اليوم</span>
          </button>

          <button
            type="button"
            onClick={loadData}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>تحديث</span>
          </button>
        </div>
      </div>

      {/* Create & Publish Shifts Form */}
      <form
        onSubmit={handlePublishShifts}
        className="bg-white border border-slate-200 rounded-xl p-5 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <h3 className="text-sm font-bold text-[#0B1A33]">
            إنشاء ونشر ورديات جديدة
          </h3>
          <span className="text-xs text-slate-500">
            المحدد حالياً:{' '}
            <strong className="font-mono tabular-nums text-[#FF7F00]">
              {selectedCourierIds.length}
            </strong>{' '}
            من {couriers.length} مندوب
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label
              htmlFor="shift-date"
              className="block text-xs font-semibold text-slate-700 mb-1.5"
            >
              التاريخ <span className="text-red-600">*</span>
            </label>
            <div className="relative">
              <Calendar className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="shift-date"
                type="date"
                required
                value={shiftDate}
                onChange={(e) => setShiftDate(e.target.value)}
                className="w-full pr-9 pl-3 py-2.5 rounded-lg border border-slate-200 text-sm font-mono tabular-nums text-[#0B1A33] focus:outline-none focus:ring-2 focus:ring-[#FF7F00]/30 focus:border-[#FF7F00]"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="shift-start-time"
              className="block text-xs font-semibold text-slate-700 mb-1.5"
            >
              وقت البدء <span className="text-red-600">*</span>
            </label>
            <input
              id="shift-start-time"
              type="time"
              required
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm font-mono tabular-nums text-[#0B1A33] focus:outline-none focus:ring-2 focus:ring-[#FF7F00]/30 focus:border-[#FF7F00]"
            />
          </div>

          <div>
            <label
              htmlFor="shift-end-time"
              className="block text-xs font-semibold text-slate-700 mb-1.5"
            >
              وقت الانتهاء <span className="text-red-600">*</span>
            </label>
            <input
              id="shift-end-time"
              type="time"
              required
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm font-mono tabular-nums text-[#0B1A33] focus:outline-none focus:ring-2 focus:ring-[#FF7F00]/30 focus:border-[#FF7F00]"
            />
          </div>
        </div>

        {/* Multi-select Couriers Box */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <Users className="w-4 h-4 text-[#FF7F00]" />
              <span>اختر المناديب المعيّنين للوردية</span>
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={courierSearch}
                onChange={(e) => setCourierSearch(e.target.value)}
                placeholder="بحث بالاسم أو الهاتف..."
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-[#FF7F00]/30 focus:border-[#FF7F00]"
              />
              <button
                type="button"
                onClick={handleToggleSelectAll}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#0B1A33] bg-[#0B1A33] text-white text-xs font-bold cursor-pointer whitespace-nowrap"
              >
                <Check className="w-3.5 h-3.5 text-[#FF7F00]" />
                <span>{allVisibleSelected ? 'إلغاء تحديد الكل' : 'تحديد الكل'}</span>
              </button>
            </div>
          </div>

          {couriers.length === 0 ? (
            <div className="p-6 text-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-xs text-slate-500">
              لا يوجد مناديب مسجلون في النظام حالياً
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-60 overflow-y-auto p-3 rounded-xl bg-slate-50 border border-slate-200">
              {visibleCouriersForSelect.map((courier) => {
                const checked = selectedCourierIds.includes(courier.id);
                const isSuspended = courier.account_status === 'suspended';
                return (
                  <label
                    key={courier.id}
                    className={`flex items-center justify-between gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                      checked
                        ? 'bg-orange-50/70 border-[#FF7F00] text-[#0B1A33]'
                        : 'bg-white border-slate-200 hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCourierSelection(courier.id)}
                        className="rounded border-slate-300 text-[#FF7F00] focus:ring-[#FF7F00]"
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-bold truncate">
                          {courier.profiles?.full_name || 'مندوب'}
                        </div>
                        <div
                          className="text-[11px] text-slate-500 font-mono tabular-nums text-right"
                          dir="ltr"
                        >
                          {courier.profiles?.phone || '—'}
                        </div>
                      </div>
                    </div>
                    <span
                      className={`text-[10px] font-bold whitespace-nowrap ${
                        isSuspended
                          ? 'text-[#EF2323]'
                          : courier.status === 'online'
                          ? 'text-emerald-700'
                          : 'text-slate-400'
                      }`}
                    >
                      {isSuspended
                        ? 'موقوف'
                        : courier.status === 'online'
                        ? 'متصل'
                        : 'غير متصل'}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <div className="text-xs text-slate-500 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>
              تصل الورديات المنشورة لحظياً لتطبيق المندوب عبر التحديث المباشر
            </span>
          </div>

          <button
            type="submit"
            disabled={submitting || selectedCourierIds.length === 0}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-[#FF7F00] hover:bg-[#E57000] disabled:opacity-50 text-white text-xs sm:text-sm font-bold cursor-pointer whitespace-nowrap shrink-0"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            <span>
              نشر الورديات ({selectedCourierIds.length})
            </span>
          </button>
        </div>
      </form>

      {/* Upcoming & Historical Shifts Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setHistoryTab('upcoming')}
              className={`px-3.5 py-1.5 rounded-md text-xs font-bold cursor-pointer whitespace-nowrap ${
                historyTab === 'upcoming'
                  ? 'bg-[#0B1A33] text-white'
                  : 'text-slate-600 hover:text-[#0B1A33]'
              }`}
            >
              الورديات القادمة واليوم ({upcomingCount})
            </button>
            <button
              type="button"
              onClick={() => setHistoryTab('all')}
              className={`px-3.5 py-1.5 rounded-md text-xs font-bold cursor-pointer whitespace-nowrap ${
                historyTab === 'all'
                  ? 'bg-[#FF7F00] text-white'
                  : 'text-slate-600 hover:text-[#0B1A33]'
              }`}
            >
              سجل جميع الورديات ({shifts.length})
            </button>
          </div>

          <select
            value={filterCourierId}
            onChange={(e) => setFilterCourierId(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-[#0B1A33]"
          >
            <option value="all">جميع المناديب</option>
            {couriers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.profiles?.full_name || 'مندوب'}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="p-10 flex flex-col items-center justify-center gap-3 text-slate-500">
            <Loader2 className="w-6 h-6 text-[#FF7F00] animate-spin" />
            <span className="text-sm">جاري تحميل الورديات...</span>
          </div>
        ) : displayedShifts.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-500">
            {historyTab === 'upcoming'
              ? 'لا توجد ورديات قادمة مجدولة حالياً — استخدم النموذج أعلاه لنشر ورديات جديدة'
              : 'لا توجد ورديات مسجلة مطابقة للفلتر'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                  <th className="py-3 px-4 whitespace-nowrap">التاريخ</th>
                  <th className="py-3 px-4 whitespace-nowrap">الوقت</th>
                  <th className="py-3 px-4 whitespace-nowrap">اسم المندوب</th>
                  <th className="py-3 px-4 whitespace-nowrap">الحضور / الانصراف</th>
                  <th className="py-3 px-4 whitespace-nowrap">التأخير</th>
                  <th className="py-3 px-4 whitespace-nowrap">الحالة</th>
                  <th className="py-3 px-4 whitespace-nowrap">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {displayedShifts.map((s) => {
                  const courierInfo = courierNameMap.get(s.courier_id);
                  const lateMins = Number(s.late_minutes || 0);
                  const isToday = s.shift_date === todayKey;
                  const statusLabel =
                    s.status === 'completed'
                      ? 'مكتملة'
                      : s.status === 'active'
                      ? 'نشطة الآن'
                      : s.status === 'absent'
                      ? 'غائب'
                      : 'مجدولة';

                  return (
                    <tr key={s.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-mono tabular-nums text-xs font-bold text-[#0B1A33] whitespace-nowrap">
                        <span>{s.shift_date}</span>
                        {isToday && (
                          <span className="mr-2 text-[11px] font-sans font-bold text-[#FF7F00]">
                            (اليوم)
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-700 whitespace-nowrap">
                        {formatShiftTime(s.start_time)} ← {formatShiftTime(s.end_time)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-bold text-[#0B1A33]">
                          {courierInfo?.name || s.courier_id.slice(0, 8)}
                        </div>
                        {courierInfo?.phone && (
                          <div
                            className="text-[11px] text-slate-500 font-mono tabular-nums text-right"
                            dir="ltr"
                          >
                            {courierInfo.phone}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                        {s.check_in_time
                          ? `${formatShiftTime(s.check_in_time)} / ${formatShiftTime(
                              s.check_out_time
                            )}`
                          : 'لم يسجل حضور بعد'}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-xs font-bold whitespace-nowrap">
                        {lateMins > 0 ? (
                          <span className="text-[#EF2323]">
                            {lateMins} دقيقة
                          </span>
                        ) : (
                          <span className="text-emerald-700">0</span>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-xs font-bold">
                        <span
                          className={
                            s.status === 'completed'
                              ? 'text-emerald-700'
                              : s.status === 'active'
                              ? 'text-[#FF7F00]'
                              : s.status === 'absent'
                              ? 'text-[#EF2323]'
                              : 'text-[#0B1A33]'
                          }
                        >
                          {statusLabel}
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {(!s.status || s.status === 'scheduled') && (
                          <button
                            type="button"
                            disabled={deletingId === s.id}
                            onClick={() => handleDeleteShift(s)}
                            aria-label="إلغاء الوردية"
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-red-200 text-[#EF2323] hover:bg-red-50 text-xs font-bold cursor-pointer disabled:opacity-50"
                          >
                            {deletingId === s.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5" />
                            )}
                            <span>إلغاء</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
