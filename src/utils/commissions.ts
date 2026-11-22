import { supabase } from '../lib/supabase';

const STORAGE_KEY = 'hatly_courier_commission_pct';
export const DEFAULT_COURIER_COMMISSION_PCT = 70;
export const SETTING_KEY_COMMISSION = 'courier_commission_percentage';

export function getCachedCourierCommissionPct(): number {
  if (typeof window === 'undefined') return DEFAULT_COURIER_COMMISSION_PCT;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    return DEFAULT_COURIER_COMMISSION_PCT;
  }
  return parsed;
}

export function cacheCourierCommissionPct(pct: number): void {
  if (typeof window === 'undefined') return;
  const clamped = Math.max(0, Math.min(100, pct));
  window.localStorage.setItem(STORAGE_KEY, String(clamped));
}

/**
 * Fetches `courier_commission_percentage` from Supabase `system_settings` table.
 * Supports `setting_key` / `setting_value` schema cleanly and falls back to local cache / 70%.
 */
export async function fetchCourierCommissionPct(): Promise<number> {
  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('setting_key, setting_value')
      .eq('setting_key', SETTING_KEY_COMMISSION)
      .limit(1);

    const row = Array.isArray(data) ? data[0] : data;
    if (!error && row && row.setting_value !== undefined && row.setting_value !== null) {
      const cleaned = String(row.setting_value).replace('%', '').trim();
      const parsed = Number(cleaned);
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) {
        cacheCourierCommissionPct(parsed);
        return parsed;
      }
    }
  } catch {
    // fallback below
  }

  return getCachedCourierCommissionPct();
}

/**
 * Saves `courier_commission_percentage` to Supabase `system_settings` table.
 */
export async function saveCourierCommissionPct(
  pct: number
): Promise<{ error: string | null }> {
  const clamped = Math.max(0, Math.min(100, Number(pct)));
  cacheCourierCommissionPct(clamped);

  const { data: existing, error: selectErr } = await supabase
    .from('system_settings')
    .select('id, setting_key')
    .eq('setting_key', SETTING_KEY_COMMISSION)
    .maybeSingle();

  if (selectErr) {
    return { error: selectErr.message };
  }

  if (existing?.id) {
    const { error: updateErr } = await supabase
      .from('system_settings')
      .update({ setting_value: String(clamped) })
      .eq('id', existing.id);
    return { error: updateErr ? updateErr.message : null };
  }

  const { error: insertErr } = await supabase.from('system_settings').insert({
    setting_key: SETTING_KEY_COMMISSION,
    setting_value: String(clamped),
  });
  return { error: insertErr ? insertErr.message : null };
}

/**
 * Splits `delivery_fee_net` based on the dynamic `courier_commission_percentage`:
 * - courier_commission = delivery_fee_net * (percentage / 100)
 * - hatly_net_revenue = delivery_fee_net - courier_commission
 */
export function calculateCommissionSplit(
  deliveryFeeNet: number,
  courierPct: number = getCachedCourierCommissionPct()
): {
  courierCommission: number;
  hatlyNetRevenue: number;
} {
  const fee = Math.max(0, Number(deliveryFeeNet || 0));
  const rate = Math.max(0, Math.min(100, Number(courierPct))) / 100;
  const courierCommission = Number((fee * rate).toFixed(2));
  const hatlyNetRevenue = Number((fee - courierCommission).toFixed(2));
  return {
    courierCommission,
    hatlyNetRevenue,
  };
}
