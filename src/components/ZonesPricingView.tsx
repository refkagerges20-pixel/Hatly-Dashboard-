import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Loader2,
  Pencil,
  RefreshCw,
  X,
} from 'lucide-react';
import { supabase, supabaseUrl } from '../lib/supabase';
import type {
  CustomDeliveryPricing,
  DeliveryPricing,
  Zone,
} from '../types/database';

function getZoneDisplayName(zone?: Zone | null): string {
  if (!zone) return '';
  return zone.name_ar || zone.name || zone.zone_name || zone.title || zone.id;
}

interface CombinedPricingRow {
  key: string;
  id?: string;
  fromZone: Zone;
  toZone: Zone;
  price: number;
  partnerDiscount: number;
  hasDeliveryFeeBaseField: boolean;
}

export function ZonesPricingView() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [brandPricing, setBrandPricing] = useState<DeliveryPricing[]>([]);
  const [customPricing, setCustomPricing] = useState<CustomDeliveryPricing[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Optional zone filter (defaults to 'all' so all N x N combinations display)
  const [filterFromZoneId, setFilterFromZoneId] = useState<string>('all');

  // Inline editing state for custom_delivery_pricing
  const [editingCustomKey, setEditingCustomKey] = useState<string | null>(null);
  const [editingCustomPrice, setEditingCustomPrice] = useState<string>('');
  const [savingCustomKey, setSavingCustomKey] = useState<string | null>(null);

  // Inline editing state for delivery_pricing (Brand)
  const [editingBrandKey, setEditingBrandKey] = useState<string | null>(null);
  const [editingBrandPrice, setEditingBrandPrice] = useState<string>('');
  const [savingBrandKey, setSavingBrandKey] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setFetchError(null);

    const fetchZones = async () =>
      supabase
        .from('zones')
        .select('*')
        .order('created_at', { ascending: true });

    const fetchBrandPricing = async () => {
      const res = await supabase
        .from('delivery_pricing')
        .select('*, from_zone:from_zone_id(*), to_zone:to_zone_id(*)');
      if (res.error) {
        return supabase.from('delivery_pricing').select('*');
      }
      return res;
    };

    const fetchCustomPricing = async () => {
      const res = await supabase
        .from('custom_delivery_pricing')
        .select('*, from_zone:from_zone_id(*), to_zone:to_zone_id(*)');
      if (res.error) {
        return supabase.from('custom_delivery_pricing').select('*');
      }
      return res;
    };

    const [zRes, bRes, cRes] = await Promise.all([
      fetchZones(),
      fetchBrandPricing(),
      fetchCustomPricing(),
    ]);

    console.log('[Hatly ZonesPricing] Supabase URL:', supabaseUrl);
    console.log('[Hatly ZonesPricing] zones:', zRes.data, zRes.error);
    console.log('[Hatly ZonesPricing] delivery_pricing:', bRes.data, bRes.error);
    console.log('[Hatly ZonesPricing] custom_delivery_pricing:', cRes.data, cRes.error);

    const errors = [zRes.error, bRes.error, cRes.error]
      .filter(Boolean)
      .map((e) => e!.message);

    if (errors.length > 0) {
      setFetchError(errors.join(' | '));
    }

    setZones((zRes.data as Zone[]) || []);
    setBrandPricing((bRes.data as DeliveryPricing[]) || []);
    setCustomPricing((cRes.data as CustomDeliveryPricing[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Build full N x N matrix for delivery_pricing (all zones x all zones, default 0.00)
  const brandMatrixRows = useMemo<CombinedPricingRow[]>(() => {
    const existingMap = new Map<string, DeliveryPricing>();
    brandPricing.forEach((row) => {
      const f = row.from_zone_id || '';
      const t = row.to_zone_id || row.zone_id || '';
      if (f && t) {
        existingMap.set(`${f}__${t}`, row);
      }
    });

    const rows: CombinedPricingRow[] = [];
    zones.forEach((fromZ) => {
      if (filterFromZoneId !== 'all' && fromZ.id !== filterFromZoneId) return;
      zones.forEach((toZ) => {
        const pairKey = `${fromZ.id}__${toZ.id}`;
        const existing = existingMap.get(pairKey);
        const price = existing
          ? Number(
              existing.price ??
                existing.delivery_fee_base ??
                existing.base_fee ??
                0
            )
          : 0;

        rows.push({
          key: `brand__${pairKey}`,
          id: existing?.id,
          fromZone: fromZ,
          toZone: toZ,
          price,
          partnerDiscount: Number(existing?.partner_discount ?? 0),
          hasDeliveryFeeBaseField:
            existing?.delivery_fee_base !== undefined &&
            existing?.price === undefined,
        });
      });
    });

    return rows;
  }, [zones, brandPricing, filterFromZoneId]);

  // Build full N x N matrix for custom_delivery_pricing (all zones x all zones, default 0.00)
  const customMatrixRows = useMemo<CombinedPricingRow[]>(() => {
    const existingMap = new Map<string, CustomDeliveryPricing>();
    customPricing.forEach((row) => {
      if (row.from_zone_id && row.to_zone_id) {
        existingMap.set(`${row.from_zone_id}__${row.to_zone_id}`, row);
      }
    });

    const rows: CombinedPricingRow[] = [];
    zones.forEach((fromZ) => {
      if (filterFromZoneId !== 'all' && fromZ.id !== filterFromZoneId) return;
      zones.forEach((toZ) => {
        const pairKey = `${fromZ.id}__${toZ.id}`;
        const existing = existingMap.get(pairKey);
        const price = existing
          ? Number(existing.price ?? existing.delivery_fee ?? existing.fee ?? 0)
          : 0;

        rows.push({
          key: `custom__${pairKey}`,
          id: existing?.id,
          fromZone: fromZ,
          toZone: toZ,
          price,
          partnerDiscount: 0,
          hasDeliveryFeeBaseField: false,
        });
      });
    });

    return rows;
  }, [zones, customPricing, filterFromZoneId]);

  const handleStartEditBrand = (row: CombinedPricingRow) => {
    setEditingBrandKey(row.key);
    setEditingBrandPrice(String(row.price));
    setFetchError(null);
    setFeedback(null);
  };

  const handleSaveBrand = async (row: CombinedPricingRow) => {
    const parsed = Number(editingBrandPrice);
    if (Number.isNaN(parsed) || parsed < 0) {
      setFetchError('يرجى إدخال سعر صحيح');
      return;
    }

    setSavingBrandKey(row.key);
    setFetchError(null);
    setFeedback(null);

    let errorMessage: string | null = null;

    if (row.id) {
      const payload = row.hasDeliveryFeeBaseField
        ? { delivery_fee_base: parsed }
        : { price: parsed };
      const { error } = await supabase
        .from('delivery_pricing')
        .update(payload)
        .eq('id', row.id);
      if (error) errorMessage = error.message;
    } else {
      const { error } = await supabase.from('delivery_pricing').insert({
        from_zone_id: row.fromZone.id,
        to_zone_id: row.toZone.id,
        price: parsed,
      });
      if (error) errorMessage = error.message;
    }

    setSavingBrandKey(null);

    if (errorMessage) {
      setFetchError(errorMessage);
      return;
    }

    setEditingBrandKey(null);
    setFeedback(
      `تم حفظ سعر البراندات (${getZoneDisplayName(row.fromZone)} ← ${getZoneDisplayName(row.toZone)}) بنجاح`
    );
    await loadAll();
  };

  const handleStartEditCustom = (row: CombinedPricingRow) => {
    setEditingCustomKey(row.key);
    setEditingCustomPrice(String(row.price));
    setFetchError(null);
    setFeedback(null);
  };

  const handleSaveCustom = async (row: CombinedPricingRow) => {
    const parsed = Number(editingCustomPrice);
    if (Number.isNaN(parsed) || parsed < 0) {
      setFetchError('يرجى إدخال سعر صحيح');
      return;
    }

    setSavingCustomKey(row.key);
    setFetchError(null);
    setFeedback(null);

    let errorMessage: string | null = null;

    if (row.id) {
      const { error } = await supabase
        .from('custom_delivery_pricing')
        .update({ price: parsed })
        .eq('id', row.id);
      if (error) errorMessage = error.message;
    } else {
      const { error } = await supabase.from('custom_delivery_pricing').insert({
        from_zone_id: row.fromZone.id,
        to_zone_id: row.toZone.id,
        price: parsed,
      });
      if (error) errorMessage = error.message;
    }

    setSavingCustomKey(null);

    if (errorMessage) {
      setFetchError(errorMessage);
      return;
    }

    setEditingCustomKey(null);
    setFeedback(
      `تم حفظ سعر المخصوص (${getZoneDisplayName(row.fromZone)} ← ${getZoneDisplayName(row.toZone)}) بنجاح`
    );
    await loadAll();
  };

  if (loading) {
    return (
      <div className="p-12 flex flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="w-6 h-6 text-[#FF7B00] animate-spin" />
        <span className="text-sm">جاري تحميل المناطق وجداول التسعير...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-[#0A192F]">المناطق والتسعير</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            عرض وتعديل جميع مسارات التوصيل بين كل المناطق ({zones.length} مناطق ·{' '}
            {zones.length * zones.length} مسار)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label
              htmlFor="zone-matrix-filter"
              className="text-xs font-semibold text-slate-600 whitespace-nowrap"
            >
              تصفية حسب منطقة البداية:
            </label>
            <select
              id="zone-matrix-filter"
              value={filterFromZoneId}
              onChange={(e) => setFilterFromZoneId(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-[#0A192F]"
            >
              <option value="all">
                كل المناطق ({zones.length * zones.length} مسار)
              </option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  من: {getZoneDisplayName(z)}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={loadAll}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>تحديث</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div
          role="status"
          className="flex items-center justify-between gap-2.5 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-semibold"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{feedback}</span>
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

      {fetchError && (
        <div
          role="alert"
          className="flex items-center gap-2.5 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>خطأ في قاعدة البيانات: {fetchError}</span>
        </div>
      )}

      {/* Zones Grid */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-[#0A192F]">
            المناطق المعرّفة ({zones.length})
          </h3>
        </div>
        {zones.length === 0 ? (
          <p className="text-xs text-slate-500">لا توجد مناطق مضافة في جدول zones.</p>
        ) : (
          <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {zones.map((z) => (
              <div
                key={z.id}
                className="p-3.5 rounded-lg border border-slate-200 bg-slate-50"
              >
                <div className="font-bold text-sm text-[#0A192F]">
                  {getZoneDisplayName(z)}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  {z.city ? z.city : z.id.slice(0, 8)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Brand Delivery Pricing Table (delivery_pricing) */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <span className="font-bold text-sm text-[#0A192F]">
            تسعير البراندات (delivery_pricing)
          </span>
          <span className="text-xs font-mono tabular-nums text-slate-500">
            {brandMatrixRows.length} مسار
          </span>
        </div>
        <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
          <table className="w-full text-right text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                <th className="py-2.5 px-4">من منطقة</th>
                <th className="py-2.5 px-4">إلى منطقة</th>
                <th className="py-2.5 px-4">السعر</th>
                <th className="py-2.5 px-4">خصم الشريك</th>
                <th className="py-2.5 px-4">الإجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {brandMatrixRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-xs text-slate-400">
                    لا توجد مناطق لعرض المسارات
                  </td>
                </tr>
              ) : (
                brandMatrixRows.map((row) => {
                  const isEditing = editingBrandKey === row.key;
                  const isSaving = savingBrandKey === row.key;

                  return (
                    <tr key={row.key} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-4 font-medium text-slate-800 whitespace-nowrap">
                        {getZoneDisplayName(row.fromZone)}
                      </td>
                      <td className="py-2.5 px-4 font-medium text-slate-800 whitespace-nowrap">
                        {getZoneDisplayName(row.toZone)}
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums font-bold text-[#0A192F] whitespace-nowrap">
                        {isEditing ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={0}
                              step="0.5"
                              value={editingBrandPrice}
                              onChange={(e) => setEditingBrandPrice(e.target.value)}
                              className="w-28 px-2.5 py-1.5 rounded-lg border border-[#FF7B00] bg-white text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30"
                            />
                            <span className="text-xs text-slate-500 font-sans">ج.م</span>
                          </div>
                        ) : (
                          <span className={row.price === 0 ? 'text-slate-400' : 'text-[#0A192F]'}>
                            {row.price.toFixed(2)} ج.م
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-emerald-700 whitespace-nowrap">
                        {row.partnerDiscount.toFixed(2)} ج.م
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        {isEditing ? (
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              disabled={isSaving}
                              onClick={() => handleSaveBrand(row)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#FF7B00] hover:bg-[#E56E00] disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
                            >
                              {isSaving ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Check className="w-3.5 h-3.5" />
                              )}
                              <span>حفظ</span>
                            </button>
                            <button
                              type="button"
                              disabled={isSaving}
                              onClick={() => setEditingBrandKey(null)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 text-xs font-semibold cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                              <span>إلغاء</span>
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleStartEditBrand(row)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:border-[#0A192F] text-[#0A192F] text-xs font-bold cursor-pointer transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5 text-[#FF7B00]" />
                            <span>تعديل</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Custom Delivery Pricing Table (custom_delivery_pricing) */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <span className="font-bold text-sm text-[#0A192F]">
            تسعير الأوردر المخصوص (custom_delivery_pricing)
          </span>
          <span className="text-xs font-mono tabular-nums text-slate-500">
            {customMatrixRows.length} مسار
          </span>
        </div>
        <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
          <table className="w-full text-right text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                <th className="py-2.5 px-4">من منطقة</th>
                <th className="py-2.5 px-4">إلى منطقة</th>
                <th className="py-2.5 px-4">السعر</th>
                <th className="py-2.5 px-4">الإجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {customMatrixRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-xs text-slate-400">
                    لا توجد مناطق لعرض المسارات
                  </td>
                </tr>
              ) : (
                customMatrixRows.map((row) => {
                  const isEditing = editingCustomKey === row.key;
                  const isSaving = savingCustomKey === row.key;

                  return (
                    <tr key={row.key} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-4 font-medium text-slate-800 whitespace-nowrap">
                        {getZoneDisplayName(row.fromZone)}
                      </td>
                      <td className="py-2.5 px-4 font-medium text-slate-800 whitespace-nowrap">
                        {getZoneDisplayName(row.toZone)}
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums font-bold text-[#0A192F] whitespace-nowrap">
                        {isEditing ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={0}
                              step="0.5"
                              value={editingCustomPrice}
                              onChange={(e) => setEditingCustomPrice(e.target.value)}
                              className="w-28 px-2.5 py-1.5 rounded-lg border border-[#FF7B00] bg-white text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30"
                            />
                            <span className="text-xs text-slate-500 font-sans">ج.م</span>
                          </div>
                        ) : (
                          <span className={row.price === 0 ? 'text-slate-400' : 'text-[#0A192F]'}>
                            {row.price.toFixed(2)} ج.م
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        {isEditing ? (
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              disabled={isSaving}
                              onClick={() => handleSaveCustom(row)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#FF7B00] hover:bg-[#E56E00] disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
                            >
                              {isSaving ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Check className="w-3.5 h-3.5" />
                              )}
                              <span>حفظ</span>
                            </button>
                            <button
                              type="button"
                              disabled={isSaving}
                              onClick={() => setEditingCustomKey(null)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 text-xs font-semibold cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                              <span>إلغاء</span>
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleStartEditCustom(row)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:border-[#0A192F] text-[#0A192F] text-xs font-bold cursor-pointer transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5 text-[#FF7B00]" />
                            <span>تعديل</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
