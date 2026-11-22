import { supabase } from '../lib/supabase';
import type { Merchant } from '../types/database';

export type SubscriptionPlanKey = 'standard' | 'plus' | 'pro';

export interface SubscriptionPlanMeta {
  key: SubscriptionPlanKey;
  labelAr: string;
  durationAr: string;
  months: number;
}

export const SUBSCRIPTION_PLANS: Record<SubscriptionPlanKey, SubscriptionPlanMeta> = {
  standard: {
    key: 'standard',
    labelAr: 'عادي',
    durationAr: 'شهر واحد',
    months: 1,
  },
  plus: {
    key: 'plus',
    labelAr: 'بلس',
    durationAr: '6 شهور',
    months: 6,
  },
  pro: {
    key: 'pro',
    labelAr: 'برو',
    durationAr: '12 شهر',
    months: 12,
  },
};

export const SUBSCRIPTION_PLAN_OPTIONS: SubscriptionPlanMeta[] = [
  SUBSCRIPTION_PLANS.standard,
  SUBSCRIPTION_PLANS.plus,
  SUBSCRIPTION_PLANS.pro,
];

export function normalizeSubscriptionPlan(
  value?: string | null
): SubscriptionPlanKey | null {
  if (!value) return null;
  const clean = value.trim().toLowerCase();
  if (clean === 'standard' || clean === 'عادي' || clean.includes('عادي')) {
    return 'standard';
  }
  if (clean === 'plus' || clean === 'بلس' || clean.includes('بلس')) {
    return 'plus';
  }
  if (clean === 'pro' || clean === 'برو' || clean.includes('برو')) {
    return 'pro';
  }
  return null;
}

export function getPlanLabel(value?: string | null): string {
  const key = normalizeSubscriptionPlan(value);
  if (key) {
    return SUBSCRIPTION_PLANS[key].labelAr;
  }
  return value?.trim() || 'غير محدد';
}

export function addMonthsSafe(baseDate: Date, months: number): Date {
  const result = new Date(baseDate.getTime());
  const targetMonth = result.getMonth() + months;
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(targetMonth);
  const maxDayInMonth = new Date(
    result.getFullYear(),
    result.getMonth() + 1,
    0
  ).getDate();
  result.setDate(Math.min(day, maxDayInMonth));
  return result;
}

export function calculateSubscriptionDates(
  planKey: SubscriptionPlanKey,
  startDate: Date = new Date()
): { startDateIso: string; endDateIso: string } {
  const meta = SUBSCRIPTION_PLANS[planKey];
  const start = new Date(startDate.getTime());
  const end = addMonthsSafe(start, meta.months);
  return {
    startDateIso: start.toISOString(),
    endDateIso: end.toISOString(),
  };
}

export function isMerchantSubscriptionExpired(
  merchant: Pick<Merchant, 'subscription_end_date' | 'is_active'> | null | undefined
): boolean {
  if (!merchant) return false;
  if (merchant.subscription_end_date) {
    const endTime = new Date(merchant.subscription_end_date).getTime();
    if (!Number.isNaN(endTime) && endTime < Date.now()) {
      return true;
    }
  }
  if (merchant.is_active === false) {
    return true;
  }
  return false;
}

export function isMerchantOperational(merchant: Merchant): boolean {
  if (merchant.account_status !== 'active') return false;
  if (merchant.is_active === false) return false;
  if (isMerchantSubscriptionExpired(merchant)) return false;
  return true;
}

export function formatSubscriptionDate(value?: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Checks any merchants whose subscription_end_date is in the past while still
 * marked is_active !== false, and automatically persists is_active = false in Supabase.
 */
export async function syncExpiredMerchants(
  merchants: Merchant[]
): Promise<Merchant[]> {
  const now = Date.now();
  const expiredIds: string[] = [];

  const updated = merchants.map((m) => {
    if (m.subscription_end_date) {
      const endMs = new Date(m.subscription_end_date).getTime();
      if (!Number.isNaN(endMs) && endMs < now) {
        if (m.is_active !== false) {
          expiredIds.push(m.id);
        }
        return { ...m, is_active: false };
      }
    }
    return m;
  });

  if (expiredIds.length > 0) {
    await supabase
      .from('merchants')
      .update({ is_active: false })
      .in('id', expiredIds);
  }

  return updated;
}

export interface AdPlanRules {
  planKey: SubscriptionPlanKey;
  planLabel: string;
  requiresPayment: boolean;
  maxDays: number | null;
  subscriptionEndDateKey: string | null;
  summaryText: string;
}

export function toDateInputKey(value?: string | null): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed.slice(0, 10);
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function getAdPlanRules(
  merchant: Pick<Merchant, 'subscription_plan' | 'subscription_end_date'> | null | undefined
): AdPlanRules {
  const planKey = normalizeSubscriptionPlan(merchant?.subscription_plan) || 'standard';
  const subEndKey = merchant?.subscription_end_date
    ? toDateInputKey(merchant.subscription_end_date)
    : null;

  if (planKey === 'plus') {
    return {
      planKey: 'plus',
      planLabel: 'بلس',
      requiresPayment: false,
      maxDays: 90,
      subscriptionEndDateKey: subEndKey,
      summaryText: 'باقة بلس: إعلانات مجانية لمدة تصل إلى 90 يوماً من تاريخ بداية الإعلان.',
    };
  }

  if (planKey === 'pro') {
    return {
      planKey: 'pro',
      planLabel: 'برو',
      requiresPayment: false,
      maxDays: null,
      subscriptionEndDateKey: subEndKey,
      summaryText: subEndKey
        ? `باقة برو: إعلانات مجانية طوال مدة الاشتراك (حتى ${formatSubscriptionDate(subEndKey)}).`
        : 'باقة برو: إعلانات مجانية طوال مدة الاشتراك.',
    };
  }

  return {
    planKey: 'standard',
    planLabel: 'عادي',
    requiresPayment: true,
    maxDays: 7,
    subscriptionEndDateKey: subEndKey,
    summaryText: 'باقة عادي: الإعلان مدفوع (يلزم إدخال سعر الإعلان) وبحد أقصى 7 أيام.',
  };
}

export function validateAdDatesForPlan(
  merchant: Pick<Merchant, 'subscription_plan' | 'subscription_end_date'> | null | undefined,
  startDateKey: string,
  endDateKey: string
): string | null {
  if (!startDateKey || !endDateKey) {
    return 'يرجى تحديد تاريخ بداية وتاريخ نهاية الإعلان';
  }

  const startMs = new Date(`${startDateKey}T00:00:00`).getTime();
  const endMs = new Date(`${endDateKey}T00:00:00`).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return 'صيغة التاريخ غير صحيحة';
  }
  if (endMs < startMs) {
    return 'تاريخ انتهاء الإعلان يجب أن يكون مساوياً أو بعد تاريخ البداية';
  }

  const diffDays = Math.round((endMs - startMs) / (1000 * 60 * 60 * 24));
  const rules = getAdPlanRules(merchant);

  if (rules.planKey === 'standard' && diffDays > 7) {
    return 'باقة عادي تسمح بمدة إعلان بحد أقصى 7 أيام فقط';
  }

  if (rules.planKey === 'plus' && diffDays > 90) {
    return 'باقة بلس تسمح بمدة إعلان مجاني بحد أقصى 90 يوماً من تاريخ البداية';
  }

  if (
    rules.planKey === 'pro' &&
    rules.subscriptionEndDateKey &&
    endDateKey > rules.subscriptionEndDateKey
  ) {
    return `باقة برو تسمح بالإعلان حتى تاريخ انتهاء الاشتراك (${formatSubscriptionDate(
      rules.subscriptionEndDateKey
    )})`;
  }

  return null;
}

export function getAdStatusMeta(
  startDate: string,
  endDate: string
): { key: 'active' | 'scheduled' | 'expired'; label: string; cls: string } {
  const today = toDateInputKey(new Date().toISOString());
  const startKey = toDateInputKey(startDate);
  const endKey = toDateInputKey(endDate);

  if (endKey && endKey < today) {
    return { key: 'expired', label: 'منتهي', cls: 'text-red-700' };
  }
  if (startKey && startKey > today) {
    return { key: 'scheduled', label: 'مجدول', cls: 'text-amber-700' };
  }
  return { key: 'active', label: 'نشط', cls: 'text-emerald-700' };
}

