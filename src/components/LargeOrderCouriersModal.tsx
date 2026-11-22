import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Plus,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Courier, Order, OrderCourier } from '../types/database';
import { calculateCommissionSplit } from '../utils/commissions';
import { splitAmountEqually } from '../utils/autoDispatch';

interface LargeOrderCouriersModalProps {
  open: boolean;
  order: Order | null;
  couriers: Courier[];
  assignedRows: OrderCourier[];
  commissionPct: number;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function LargeOrderCouriersModal({
  open,
  order,
  couriers,
  assignedRows,
  commissionPct,
  onClose,
  onSaved,
}: LargeOrderCouriersModalProps) {
  const [rows, setRows] = useState<
    Array<{
      id: string;
      courier_id: string;
      commission_amount: number;
      cash_collected: string;
    }>
  >([]);
  const [selectedNewCourierId, setSelectedNewCourierId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !order) return;
    setError(null);

    const mapped = assignedRows.map((r) => ({
      id: r.id,
      courier_id: r.courier_id,
      commission_amount: Number(r.commission_amount || 0),
      cash_collected: String(Number(r.cash_collected || 0)),
    }));

    // If cash order and all cash_collected are 0 while couriers > 0, prefill equal split visually
    if (
      order.payment_method === 'cash' &&
      mapped.length > 0 &&
      mapped.every((m) => Number(m.cash_collected) === 0)
    ) {
      const equal = splitAmountEqually(Number(order.total || 0), mapped.length);
      mapped.forEach((m, idx) => {
        m.cash_collected = String(equal[idx] ?? 0);
      });
    }

    setRows(mapped);

    const assignedSet = new Set(mapped.map((m) => m.courier_id));
    const firstAvailable = couriers.find(
      (c) => c.account_status === 'active' && !assignedSet.has(c.id)
    );
    setSelectedNewCourierId(firstAvailable?.id || '');
  }, [open, order, assignedRows, couriers]);

  if (!open || !order) return null;

  const isCash = order.payment_method === 'cash';
  const requiredCount = Math.max(1, Number(order.required_couriers || 1));
  const { courierCommission: perCourierFullCommission } = calculateCommissionSplit(
    Number(order.delivery_fee_net || 0),
    commissionPct
  );

  const courierMap = new Map<string, Courier>();
  couriers.forEach((c) => courierMap.set(c.id, c));

  const assignedSet = new Set(rows.map((r) => r.courier_id));
  const availableToAdd = couriers.filter(
    (c) => c.account_status === 'active' && !assignedSet.has(c.id)
  );

  const totalCashEntered = rows.reduce(
    (sum, r) => sum + (Number(r.cash_collected) || 0),
    0
  );
  const orderTotal = Number(order.total || 0);
  const cashDiff = Number((orderTotal - totalCashEntered).toFixed(2));

  const handleSplitEqually = () => {
    if (rows.length === 0) return;
    const equal = splitAmountEqually(orderTotal, rows.length);
    setRows((prev) =>
      prev.map((r, idx) => ({ ...r, cash_collected: String(equal[idx] ?? 0) }))
    );
  };

  const handleAddCourier = async () => {
    if (!selectedNewCourierId) return;
    setError(null);
    setSaving(true);

    try {
      const { data: inserted, error: insertErr } = await supabase
        .from('order_couriers')
        .insert({
          order_id: order.id,
          courier_id: selectedNewCourierId,
          commission_amount: perCourierFullCommission,
          cash_collected: 0,
          status: order.status === 'new' ? 'assigned' : order.status,
        })
        .select('*')
        .single();

      if (insertErr || !inserted) {
        throw new Error(insertErr?.message || 'تعذر إضافة المندوب');
      }

      if (!order.courier_id || order.status === 'new') {
        await supabase
          .from('orders')
          .update({
            courier_id: order.courier_id || selectedNewCourierId,
            status: order.status === 'new' ? 'assigned' : order.status,
          })
          .eq('id', order.id);
      }

      if (order.status !== 'delivered' && order.status !== 'cancelled') {
        const target = courierMap.get(selectedNewCourierId);
        if (target) {
          await supabase
            .from('couriers')
            .update({ active_orders_count: (target.active_orders_count || 0) + 1 })
            .eq('id', target.id);
        }
      }

      const nextRows = [
        ...rows,
        {
          id: inserted.id,
          courier_id: selectedNewCourierId,
          commission_amount: perCourierFullCommission,
          cash_collected: '0',
        },
      ];

      if (isCash) {
        const equal = splitAmountEqually(orderTotal, nextRows.length);
        nextRows.forEach((r, idx) => {
          r.cash_collected = String(equal[idx] ?? 0);
        });
      }

      setRows(nextRows);
      const nextAssigned = new Set(nextRows.map((r) => r.courier_id));
      const nextAvail = couriers.find(
        (c) => c.account_status === 'active' && !nextAssigned.has(c.id)
      );
      setSelectedNewCourierId(nextAvail?.id || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إضافة المندوب');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveCourier = async (rowId: string, courierId: string) => {
    setError(null);
    setSaving(true);
    try {
      const { error: delErr } = await supabase
        .from('order_couriers')
        .delete()
        .eq('id', rowId);
      if (delErr) throw new Error(delErr.message);

      if (order.status !== 'delivered' && order.status !== 'cancelled') {
        const target = courierMap.get(courierId);
        if (target) {
          await supabase
            .from('couriers')
            .update({
              active_orders_count: Math.max(0, (target.active_orders_count || 0) - 1),
            })
            .eq('id', target.id);
        }
      }

      const remaining = rows.filter((r) => r.id !== rowId);
      setRows(remaining);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إزالة المندوب');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSplits = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isCash && rows.length > 0 && Math.abs(cashDiff) > 0.05) {
      setError(
        `مجموع مبالغ التحصيل (${totalCashEntered.toFixed(2)} ج.م) يجب أن يساوي إجمالي الطلب (${orderTotal.toFixed(2)} ج.م)`
      );
      return;
    }

    setSaving(true);
    try {
      for (const r of rows) {
        const val = isCash ? Math.max(0, Number(r.cash_collected) || 0) : 0;
        const { error: updErr } = await supabase
          .from('order_couriers')
          .update({
            cash_collected: val,
            commission_amount: r.commission_amount,
          })
          .eq('id', r.id);
        if (updErr) throw new Error(updErr.message);
      }

      onSaved(`تم تحديث توزيع المناديب وتحصيل الكاش للطلب ${order.order_number}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ التوزيع');
    } finally {
      setSaving(false);
    }
  };

  const totalOrderCommissions = rows.reduce(
    (sum, r) => sum + Number(r.commission_amount || 0),
    0
  );

  return (
    <div className="fixed inset-0 z-50 bg-[#0A192F]/60 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-2xl p-6 space-y-5 my-8">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-[#0A192F] text-[#FF7B00] flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#0A192F]">
                إدارة مناديب وتحصيل الأوردر الكبير ({order.order_number})
              </h3>
              <p className="text-xs text-slate-500">
                المطلوب: <strong className="font-mono">{requiredCount}</strong> مناديب · إجمالي الطلب:{' '}
                <strong className="font-mono text-[#FF7B00]">{orderTotal.toFixed(2)} ج.م</strong>{' '}
                ({isCash ? 'كاش' : 'بطاقة بنكية'})
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
          <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Add courier bar */}
        {availableToAdd.length > 0 && (
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center gap-2.5">
            <select
              value={selectedNewCourierId}
              onChange={(e) => setSelectedNewCourierId(e.target.value)}
              className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-[#0A192F]"
            >
              {availableToAdd.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.profiles?.full_name || 'مندوب'} —{' '}
                  {c.status === 'online' ? 'متصل' : 'غير متصل'} (نشط: {c.active_orders_count}/2)
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={saving || !selectedNewCourierId}
              onClick={handleAddCourier}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0A192F] hover:bg-[#112240] disabled:opacity-50 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5 text-[#FF7B00]" />
              <span>إضافة مندوب للطلب</span>
            </button>
          </div>
        )}

        <form onSubmit={handleSaveSplits} className="space-y-4">
          {isCash && rows.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs bg-orange-50/60 border border-[#FF7B00]/25 rounded-xl p-3">
              <div>
                <span className="font-bold text-[#0A192F]">تقسيم تحصيل الكاش على المناديب:</span>{' '}
                <span className="text-slate-600">
                  المجموع المدخل:{' '}
                  <strong className="font-mono tabular-nums text-[#0A192F]">
                    {totalCashEntered.toFixed(2)} ج.م
                  </strong>{' '}
                  من أصل{' '}
                  <strong className="font-mono tabular-nums text-[#FF7B00]">
                    {orderTotal.toFixed(2)} ج.م
                  </strong>
                </span>
              </div>
              <button
                type="button"
                onClick={handleSplitEqually}
                className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-xs font-bold text-[#0A192F] cursor-pointer"
              >
                توزيع بالتساوي
              </button>
            </div>
          )}

          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-right text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                  <th className="py-2.5 px-3">المندوب</th>
                  <th className="py-2.5 px-3">العمولة الكاملة</th>
                  {isCash && <th className="py-2.5 px-3">الكاش المحصّل (العهدة)</th>}
                  <th className="py-2.5 px-3 w-12">إزالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={isCash ? 4 : 3}
                      className="py-6 text-center text-xs text-slate-400"
                    >
                      لم يتم تعيين مناديب لهذا الطلب بعد — أضف مناديب من القائمة أعلاه
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const c = courierMap.get(r.courier_id);
                    return (
                      <tr key={r.id}>
                        <td className="py-2.5 px-3 font-bold text-[#0A192F]">
                          {c?.profiles?.full_name || 'مندوب'}
                          <div className="text-[11px] font-normal text-slate-500 font-mono" dir="ltr">
                            {c?.profiles?.phone || ''}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-mono tabular-nums font-bold text-emerald-700">
                          {Number(r.commission_amount).toFixed(2)} ج.م
                        </td>
                        {isCash && (
                          <td className="py-2.5 px-3">
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={r.cash_collected}
                              onChange={(e) => {
                                const val = e.target.value;
                                setRows((prev) =>
                                  prev.map((item) =>
                                    item.id === r.id
                                      ? { ...item, cash_collected: val }
                                      : item
                                  )
                                );
                              }}
                              className="w-32 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-mono tabular-nums font-bold text-[#0A192F]"
                            />
                          </td>
                        )}
                        <td className="py-2.5 px-3 text-center">
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => handleRemoveCourier(r.id, r.courier_id)}
                            title="إزالة المندوب"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
            <span className="text-slate-600">
              إجمالي عمولات المناديب على هذا الطلب ({rows.length} مناديب):
            </span>
            <strong className="font-mono tabular-nums text-[#0A192F] text-sm">
              {totalOrderCommissions.toFixed(2)} ج.م
            </strong>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              إغلاق
            </button>
            <button
              type="submit"
              disabled={saving || rows.length === 0}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#FF7B00] hover:bg-[#E56E00] disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
            >
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5" />
              )}
              <span>حفظ تقسيم التحصيل</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
