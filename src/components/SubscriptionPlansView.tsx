import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Edit3,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { SubscriptionPlan } from '../types/database';

export function SubscriptionPlansView() {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [price, setPrice] = useState('0');
  const [durationDays, setDurationDays] = useState('30');
  const [maxAdsPerMonth, setMaxAdsPerMonth] = useState('4');
  const [maxInstantOrders, setMaxInstantOrders] = useState('50');
  const [isFreeAds, setIsFreeAds] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [features, setFeatures] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadPlans = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('subscription_plans')
      .select('*')
      .order('price', { ascending: true });

    if (error) {
      setFeedback({
        type: 'error',
        text: `تعذر تحميل باقات الاشتراك: ${error.message}`,
      });
      setPlans([]);
    } else {
      setPlans((data as SubscriptionPlan[]) || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  const openCreateModal = () => {
    setEditingPlan(null);
    setName('');
    setPrice('0');
    setDurationDays('30');
    setMaxAdsPerMonth('4');
    setMaxInstantOrders('100');
    setIsFreeAds(false);
    setIsActive(true);
    setFeatures('');
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (plan: SubscriptionPlan) => {
    setEditingPlan(plan);
    setName(plan.name || '');
    setPrice(String(plan.price ?? 0));
    setDurationDays(String(plan.duration_days ?? 30));
    setMaxAdsPerMonth(String(plan.max_ads_per_month ?? plan.max_ads ?? 0));
    setMaxInstantOrders(String(plan.max_instant_orders ?? 0));
    setIsFreeAds(Boolean(plan.is_free_ads));
    setIsActive(plan.is_active !== false);
    setFeatures(plan.features || '');
    setFormError(null);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!name.trim()) {
      setFormError('يرجى إدخال اسم الباقة');
      return;
    }

    const parsedPrice = Number(price);
    const parsedDays = Number(durationDays);
    const parsedMaxAds = Number(maxAdsPerMonth);
    const parsedMaxOrders = Number(maxInstantOrders);

    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setFormError('يرجى إدخال سعر صحيح (0 أو أكثر)');
      return;
    }
    if (!Number.isFinite(parsedDays) || parsedDays <= 0) {
      setFormError('مدة الباقة بالأيام يجب أن تكون أكبر من صفر');
      return;
    }

    setSaving(true);
    const payload = {
      name: name.trim(),
      price: Number(parsedPrice.toFixed(2)),
      duration_days: Math.round(parsedDays),
      max_ads: Number.isFinite(parsedMaxAds) ? Math.max(0, Math.round(parsedMaxAds)) : 0,
      max_ads_per_month: Number.isFinite(parsedMaxAds)
        ? Math.max(0, Math.round(parsedMaxAds))
        : 0,
      max_instant_orders: Number.isFinite(parsedMaxOrders)
        ? Math.max(0, Math.round(parsedMaxOrders))
        : 0,
      is_free_ads: isFreeAds,
      is_active: isActive,
      features: features.trim() || null,
    };

    const res = editingPlan
      ? await supabase
          .from('subscription_plans')
          .update(payload)
          .eq('id', editingPlan.id)
      : await supabase.from('subscription_plans').insert(payload);

    setSaving(false);

    if (res.error) {
      setFormError(`تعذر حفظ الباقة: ${res.error.message}`);
      return;
    }

    setFeedback({
      type: 'success',
      text: editingPlan
        ? `تم تحديث باقة "${name.trim()}" بنجاح`
        : `تمت إضافة باقة "${name.trim()}" بنجاح`,
    });
    setModalOpen(false);
    await loadPlans();
  };

  const handleTogglePlanActive = async (plan: SubscriptionPlan) => {
    const nextActive = plan.is_active === false;
    const { error } = await supabase
      .from('subscription_plans')
      .update({ is_active: nextActive })
      .eq('id', plan.id);

    if (error) {
      setFeedback({ type: 'error', text: error.message });
      return;
    }
    setPlans((prev) =>
      prev.map((p) => (p.id === plan.id ? { ...p, is_active: nextActive } : p))
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
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#0B1A33]">
              إدارة باقات الاشتراك (subscription_plans)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              تعديل أسعار ومدد الباقات وقواعد الإعلانات المجانية للتجار والبراندات
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadPlans}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>تحديث</span>
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#FF7F00] hover:bg-[#E57000] text-white text-xs font-bold cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة باقة جديدة</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 flex flex-col items-center justify-center gap-3 text-slate-500">
          <Loader2 className="w-6 h-6 text-[#FF7F00] animate-spin" />
          <span className="text-sm">جاري تحميل الباقات...</span>
        </div>
      ) : plans.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-3">
          <div className="text-sm font-bold text-[#0B1A33]">
            لا توجد باقات مسجلة حالياً
          </div>
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#FF7F00] text-white text-xs font-bold cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>إضافة أول باقة</span>
          </button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map((plan) => {
            const active = plan.is_active !== false;
            return (
              <div
                key={plan.id}
                className={`bg-white border rounded-2xl p-5 flex flex-col justify-between gap-4 ${
                  active ? 'border-slate-200' : 'border-slate-200 opacity-70'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-base font-extrabold text-[#0B1A33]">
                        {plan.name}
                      </h3>
                      <div className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                        المدة: {plan.duration_days} يوم
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleTogglePlanActive(plan)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold cursor-pointer ${
                        active
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {active ? 'نشطة' : 'معطّلة'}
                    </button>
                  </div>

                  <div className="text-2xl font-extrabold text-[#FF7F00] font-mono tabular-nums">
                    {Number(plan.price || 0).toFixed(2)} ج.م
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <div>
                      <span className="text-slate-500 block">إعلانات / شهر</span>
                      <strong className="font-mono tabular-nums text-[#0B1A33]">
                        {plan.max_ads_per_month ?? plan.max_ads ?? 0}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">قواعد الإعلانات</span>
                      <strong
                        className={
                          plan.is_free_ads ? 'text-emerald-700' : 'text-amber-700'
                        }
                      >
                        {plan.is_free_ads ? 'مجانية ضمن الباقة' : 'مدفوعة'}
                      </strong>
                    </div>
                  </div>

                  {plan.features && (
                    <p className="text-xs text-slate-600 leading-relaxed">
                      {plan.features}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => openEditModal(plan)}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-bold text-[#0B1A33] cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5 text-[#FF7F00]" />
                  <span>تعديل الباقة والسعر</span>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-[#0B1A33]/65 flex items-center justify-center p-4 overflow-y-auto">
          <div
            dir="rtl"
            className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg p-6 space-y-5 my-8"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h3 className="text-base font-bold text-[#0B1A33]">
                {editingPlan ? `تعديل باقة: ${editingPlan.name}` : 'إضافة باقة اشتراك جديدة'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="إغلاق"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    اسم الباقة <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="مثال: الباقة الاحترافية Pro"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    السعر (ج.م) <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="number"
                    required
                    min={0}
                    step="10"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    المدة بالأيام <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    step="1"
                    value={durationDays}
                    onChange={(e) => setDurationDays(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    الحد الأقصى للإعلانات / شهر
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="1"
                    value={maxAdsPerMonth}
                    onChange={(e) => setMaxAdsPerMonth(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    حد الطلبات الفورية
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="1"
                    value={maxInstantOrders}
                    onChange={(e) => setMaxInstantOrders(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono tabular-nums"
                  />
                </div>
                <div className="flex flex-col justify-end gap-2 pb-1">
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#0B1A33] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isFreeAds}
                      onChange={(e) => setIsFreeAds(e.target.checked)}
                      className="rounded border-slate-300 text-[#FF7F00]"
                    />
                    <span>إعلانات مجانية ضمن الباقة</span>
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#0B1A33] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={(e) => setIsActive(e.target.checked)}
                      className="rounded border-slate-300 text-[#FF7F00]"
                    />
                    <span>الباقة مفعّلة ومتاحة</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  وصف ومزايا الباقة
                </label>
                <textarea
                  rows={2}
                  value={features}
                  onChange={(e) => setFeatures(e.target.value)}
                  placeholder="مثال: إعلانات مجانية طوال الاشتراك + أولوية ظهور في التطبيق"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#FF7F00] hover:bg-[#E57000] disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
                >
                  {saving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  <span>حفظ الباقة</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
