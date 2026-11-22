import { supabase } from '../lib/supabase';
import type {
  Courier,
  CourierDeposit,
  Order,
  OrderCourier,
} from '../types/database';
import { splitAmountEqually } from './autoDispatch';
import {
  isCashOnDelivery,
  isOrderDelivered,
  matchesCourier,
} from './custody';

export const DEFAULT_DAILY_CASH_LIMIT = 500;
export const DEFAULT_MAX_CASH_LIMIT = 1000;

export const SETTING_KEY_DAILY_CASH_LIMIT = 'courier_daily_cash_limit';
export const SETTING_KEY_MAX_CASH_LIMIT = 'courier_max_cash_limit';

const DAILY_LIMIT_STORAGE_KEY = 'hatly_courier_daily_cash_limit';
const MAX_LIMIT_STORAGE_KEY = 'hatly_courier_max_cash_limit';
const DAILY_HIT_PREFIX = 'hatly_courier_daily_hit_';

export const DAILY_LIMIT_BLOCKED_MSG =
  'لقد وصلت للحد اليومي للكاش. يرجى توريد المبلغ لفتح الشغل.';
export const MAX_LIMIT_SUSPENDED_MSG =
  'تم إيقاف حسابك مؤقتاً لتجاوز حد الكاش. يرجى تسجيل توريد للمبلغ لتتمكن من استكمال العمل.';

export interface CashLimitSettings {
  dailyLimit: number;
  maxLimit: number;
}

export interface CourierCashStatus {
  courierId: string;
  grossCollected: number;
  totalDeposited: number;
  cashBalance: number;
  dailyLimit: number;
  maxLimit: number;
  firstHitDailyDate: string | null;
  reachedDailyLimit: boolean;
  dailyLimitGraceToday: boolean;
  dailyLimitBlocked: boolean;
  maxLimitBlocked: boolean;
  canGoOnline: boolean;
  canAcceptOrders: boolean;
  lockReason: 'none' | 'daily_grace' | 'daily_blocked' | 'max_suspended';
  message: string | null;
}

export function getLocalDateKey(value?: string | Date | null): string {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getMillisecondsUntilMidnight(): number {
  const now = new Date();
  const nextMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    3,
    0
  );
  return Math.max(5000, nextMidnight.getTime() - now.getTime());
}

export function getCachedCashLimits(): CashLimitSettings {
  if (typeof window === 'undefined') {
    return {
      dailyLimit: DEFAULT_DAILY_CASH_LIMIT,
      maxLimit: DEFAULT_MAX_CASH_LIMIT,
    };
  }
  const rawDaily = Number(window.localStorage.getItem(DAILY_LIMIT_STORAGE_KEY));
  const rawMax = Number(window.localStorage.getItem(MAX_LIMIT_STORAGE_KEY));
  const dailyLimit =
    Number.isFinite(rawDaily) && rawDaily >= 0
      ? rawDaily
      : DEFAULT_DAILY_CASH_LIMIT;
  const maxLimit =
    Number.isFinite(rawMax) && rawMax >= dailyLimit
      ? rawMax
      : Math.max(dailyLimit, DEFAULT_MAX_CASH_LIMIT);
  return { dailyLimit, maxLimit };
}

export function cacheCashLimits(limits: CashLimitSettings): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    DAILY_LIMIT_STORAGE_KEY,
    String(Math.max(0, limits.dailyLimit))
  );
  window.localStorage.setItem(
    MAX_LIMIT_STORAGE_KEY,
    String(Math.max(limits.dailyLimit, limits.maxLimit))
  );
}

export async function fetchCashLimits(): Promise<CashLimitSettings> {
  const cached = getCachedCashLimits();
  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('setting_key, setting_value')
      .in('setting_key', [
        SETTING_KEY_DAILY_CASH_LIMIT,
        SETTING_KEY_MAX_CASH_LIMIT,
      ]);

    if (!error && Array.isArray(data) && data.length > 0) {
      let dailyLimit = cached.dailyLimit;
      let maxLimit = cached.maxLimit;

      for (const row of data) {
        const val = Number(String(row.setting_value ?? '').trim());
        if (!Number.isFinite(val) || val < 0) continue;
        if (row.setting_key === SETTING_KEY_DAILY_CASH_LIMIT) {
          dailyLimit = val;
        } else if (row.setting_key === SETTING_KEY_MAX_CASH_LIMIT) {
          maxLimit = val;
        }
      }

      if (maxLimit < dailyLimit) {
        maxLimit = dailyLimit;
      }

      const resolved = { dailyLimit, maxLimit };
      cacheCashLimits(resolved);
      return resolved;
    }
  } catch {
    // fallback to cache
  }

  return cached;
}

async function upsertSetting(
  key: string,
  value: string
): Promise<{ error: string | null }> {
  const { data: existing, error: selectErr } = await supabase
    .from('system_settings')
    .select('id, setting_key')
    .eq('setting_key', key)
    .maybeSingle();

  if (selectErr) {
    return { error: selectErr.message };
  }

  if (existing?.id) {
    const { error: updateErr } = await supabase
      .from('system_settings')
      .update({ setting_value: value })
      .eq('id', existing.id);
    return { error: updateErr ? updateErr.message : null };
  }

  const { error: insertErr } = await supabase.from('system_settings').insert({
    setting_key: key,
    setting_value: value,
  });
  return { error: insertErr ? insertErr.message : null };
}

export async function saveCashLimits(
  dailyLimit: number,
  maxLimit: number
): Promise<{ error: string | null }> {
  const cleanDaily = Math.max(0, Number(dailyLimit));
  const cleanMax = Math.max(cleanDaily, Number(maxLimit));
  cacheCashLimits({ dailyLimit: cleanDaily, maxLimit: cleanMax });

  const dailyRes = await upsertSetting(
    SETTING_KEY_DAILY_CASH_LIMIT,
    String(cleanDaily)
  );
  if (dailyRes.error) return dailyRes;

  const maxRes = await upsertSetting(
    SETTING_KEY_MAX_CASH_LIMIT,
    String(cleanMax)
  );
  return maxRes;
}

function getStoredDailyHitDate(courierId: string): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(`${DAILY_HIT_PREFIX}${courierId}`);
}

function setStoredDailyHitDate(courierId: string, dateKey: string | null): void {
  if (typeof window === 'undefined') return;
  const key = `${DAILY_HIT_PREFIX}${courierId}`;
  if (dateKey) {
    window.localStorage.setItem(key, dateKey);
  } else {
    window.localStorage.removeItem(key);
  }
}

export function evaluateCourierCashStatus(
  courier: Courier,
  orders: Order[],
  deposits: CourierDeposit[],
  orderCouriers: OrderCourier[],
  limits: CashLimitSettings
): CourierCashStatus {
  const byOrder = new Map<string, OrderCourier[]>();
  for (const row of orderCouriers) {
    const arr = byOrder.get(row.order_id);
    if (arr) arr.push(row);
    else byOrder.set(row.order_id, [row]);
  }

  interface CashEvent {
    ts: number;
    dateKey: string;
    delta: number;
  }

  const events: CashEvent[] = [];
  let grossCollected = 0;

  for (const order of orders) {
    if (!isOrderDelivered(order.status)) continue;
    if (!isCashOnDelivery(order.payment_method)) continue;

    const rows = byOrder.get(order.id) || [];
    let collectedForOrder = 0;

    if (rows.length > 0) {
      const myIndex = rows.findIndex((r) => matchesCourier(r.courier_id, courier));
      if (myIndex === -1) continue;

      const explicitSum = rows.reduce(
        (sum, r) => sum + Number(r.cash_collected || 0),
        0
      );
      if (explicitSum > 0) {
        collectedForOrder = Number(rows[myIndex].cash_collected || 0);
      } else {
        const equalSplits = splitAmountEqually(
          Number(order.total || 0),
          rows.length
        );
        collectedForOrder = equalSplits[myIndex] ?? 0;
      }
    } else if (matchesCourier(order.courier_id, courier)) {
      collectedForOrder = Number(order.total || 0);
    } else {
      continue;
    }

    if (collectedForOrder > 0) {
      grossCollected += collectedForOrder;
      const ts = new Date(order.created_at).getTime();
      events.push({
        ts: Number.isNaN(ts) ? Date.now() : ts,
        dateKey: getLocalDateKey(order.created_at),
        delta: collectedForOrder,
      });
    }
  }

  let totalDeposited = 0;
  for (const dep of deposits) {
    if (!matchesCourier(dep.courier_id, courier)) continue;
    const amt = Number(dep.amount || 0);
    if (amt <= 0) continue;
    totalDeposited += amt;
    const ts = new Date(dep.created_at).getTime();
    events.push({
      ts: Number.isNaN(ts) ? Date.now() : ts,
      dateKey: getLocalDateKey(dep.created_at),
      delta: -amt,
    });
  }

  grossCollected = Number(grossCollected.toFixed(2));
  totalDeposited = Number(totalDeposited.toFixed(2));
  const cashBalance = Number((grossCollected - totalDeposited).toFixed(2));

  events.sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    // Inflows before outflows on exact timestamp collision
    return b.delta - a.delta;
  });

  let running = 0;
  let replayedHitDate: string | null = null;
  for (const ev of events) {
    running = Number((running + ev.delta).toFixed(2));
    if (running >= limits.dailyLimit) {
      if (!replayedHitDate) {
        replayedHitDate = ev.dateKey;
      }
    } else {
      replayedHitDate = null;
    }
  }

  const todayKey = getLocalDateKey();
  const reachedDailyLimit = cashBalance >= limits.dailyLimit;

  let firstHitDailyDate: string | null = null;
  if (reachedDailyLimit) {
    const stored = getStoredDailyHitDate(courier.id);
    if (replayedHitDate) {
      firstHitDailyDate = replayedHitDate;
    } else if (stored) {
      firstHitDailyDate = stored;
    } else {
      firstHitDailyDate = todayKey;
    }
    setStoredDailyHitDate(courier.id, firstHitDailyDate);
  } else {
    setStoredDailyHitDate(courier.id, null);
  }

  const hitMaxLimit = cashBalance >= limits.maxLimit;
  const suspendedStillAboveDaily =
    courier.account_status === 'suspended' && cashBalance >= limits.dailyLimit;

  const maxLimitBlocked = hitMaxLimit || suspendedStillAboveDaily;

  const dailyLimitBlocked =
    !maxLimitBlocked &&
    reachedDailyLimit &&
    firstHitDailyDate !== null &&
    firstHitDailyDate < todayKey;

  const dailyLimitGraceToday =
    !maxLimitBlocked && reachedDailyLimit && !dailyLimitBlocked;

  const canGoOnline = !maxLimitBlocked && !dailyLimitBlocked;
  const canAcceptOrders = !maxLimitBlocked && !dailyLimitBlocked;

  let lockReason: CourierCashStatus['lockReason'] = 'none';
  let message: string | null = null;

  if (maxLimitBlocked) {
    lockReason = 'max_suspended';
    message = MAX_LIMIT_SUSPENDED_MSG;
  } else if (dailyLimitBlocked) {
    lockReason = 'daily_blocked';
    message = DAILY_LIMIT_BLOCKED_MSG;
  } else if (dailyLimitGraceToday) {
    lockReason = 'daily_grace';
    message = `وصل رصيد الكاش إلى ${cashBalance.toFixed(2)} ج.م (الحد اليومي ${limits.dailyLimit.toFixed(0)} ج.م). يمكنك إنهاء ورديتك اليوم، وسيتم إيقاف الحساب عن العمل تلقائياً الساعة 12:00 منتصف الليل حتى يتم التوريد.`;
  }

  return {
    courierId: courier.id,
    grossCollected,
    totalDeposited,
    cashBalance,
    dailyLimit: limits.dailyLimit,
    maxLimit: limits.maxLimit,
    firstHitDailyDate,
    reachedDailyLimit,
    dailyLimitGraceToday,
    dailyLimitBlocked,
    maxLimitBlocked,
    canGoOnline,
    canAcceptOrders,
    lockReason,
    message,
  };
}

export async function syncCourierCashLimits(
  couriers: Courier[],
  orders: Order[],
  deposits: CourierDeposit[],
  orderCouriers: OrderCourier[],
  limits: CashLimitSettings
): Promise<{
  updatedCouriers: Courier[];
  statusMap: Map<string, CourierCashStatus>;
}> {
  const statusMap = new Map<string, CourierCashStatus>();
  const updatedCouriers: Courier[] = [];

  for (const courier of couriers) {
    const st = evaluateCourierCashStatus(
      courier,
      orders,
      deposits,
      orderCouriers,
      limits
    );

    let nextCourier = courier;

    if (st.cashBalance >= limits.maxLimit) {
      if (courier.account_status !== 'suspended' || courier.status !== 'offline') {
        const { error } = await supabase
          .from('couriers')
          .update({ account_status: 'suspended', status: 'offline' })
          .eq('id', courier.id);
        if (!error) {
          nextCourier = {
            ...courier,
            account_status: 'suspended',
            status: 'offline',
          };
        }
      }
    } else if (courier.account_status === 'suspended' && st.cashBalance < limits.dailyLimit) {
      const { error } = await supabase
        .from('couriers')
        .update({ account_status: 'active' })
        .eq('id', courier.id);
      if (!error) {
        nextCourier = { ...courier, account_status: 'active' };
      }
    } else if (st.dailyLimitBlocked && courier.status !== 'offline') {
      const { error } = await supabase
        .from('couriers')
        .update({ status: 'offline' })
        .eq('id', courier.id);
      if (!error) {
        nextCourier = { ...courier, status: 'offline' };
      }
    }

    const finalStatus =
      nextCourier === courier
        ? st
        : evaluateCourierCashStatus(
            nextCourier,
            orders,
            deposits,
            orderCouriers,
            limits
          );

    statusMap.set(courier.id, finalStatus);
    updatedCouriers.push(nextCourier);
  }

  return { updatedCouriers, statusMap };
}

export async function syncSingleCourierCashLimit(courierId: string): Promise<{
  courier: Courier | null;
  status: CourierCashStatus | null;
}> {
  const [courierRes, ordersRes, ocRes, depositsRes, limits] = await Promise.all([
    supabase
      .from('couriers')
      .select('*, profiles(full_name, phone, email)')
      .eq('id', courierId)
      .maybeSingle(),
    supabase.from('orders').select('*'),
    supabase.from('order_couriers').select('*'),
    supabase
      .from('courier_deposits')
      .select('*')
      .eq('courier_id', courierId),
    fetchCashLimits(),
  ]);

  let courier = (courierRes.data as Courier) || null;
  if (!courier && courierRes.error) {
    const fallback = await supabase
      .from('couriers')
      .select('*')
      .eq('id', courierId)
      .maybeSingle();
    courier = (fallback.data as Courier) || null;
  }

  if (!courier) {
    return { courier: null, status: null };
  }

  const { updatedCouriers, statusMap } = await syncCourierCashLimits(
    [courier],
    (ordersRes.data as Order[]) || [],
    (depositsRes.data as CourierDeposit[]) || [],
    (ocRes.data as OrderCourier[]) || [],
    limits
  );

  return {
    courier: updatedCouriers[0] || courier,
    status: statusMap.get(courier.id) || null,
  };
}
