import { supabase } from '../lib/supabase';
import type {
  Courier,
  CourierDeposit,
  Order,
  OrderCourier,
  Zone,
} from '../types/database';
import { computeDynamicActiveOrdersMap } from './activeOrders';
import { fetchCashLimits, syncCourierCashLimits } from './cashLimits';
import {
  calculateCommissionSplit,
  fetchCourierCommissionPct,
} from './commissions';
import { isMerchantSubscriptionExpired } from './subscriptions';

export interface AutoDispatchOptions {
  requiredCouriers?: number;
  deliveryFeeNet?: number;
  commissionPct?: number;
  paymentMethod?: string;
  orderTotal?: number;
  rejectedByCouriers?: string[] | null;
  merchantId?: string | null;
  toZoneId?: string | null;
}

export interface AutoDispatchResult {
  assigned: boolean;
  assignedCount: number;
  requiredCount: number;
  couriers: Array<Courier & { full_name?: string | null }>;
  courier?: Courier & { full_name?: string | null };
  allRejected?: boolean;
  merchantInactive?: boolean;
  zoneUnavailable?: boolean;
  message: string;
}

function parseRejectedCouriers(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((id) => String(id).trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === '{}' || trimmed === '[]') return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((id) => String(id).trim()).filter(Boolean);
        }
      } catch {
        // fall through
      }
    }
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return trimmed
        .slice(1, -1)
        .split(',')
        .map((s) => s.replace(/^"|"$/g, '').trim())
        .filter(Boolean);
    }
  }
  return [];
}

/**
 * Splits a cash total across N couriers equally in piasters (2 decimals),
 * ensuring the sum matches `total` without floating-point drift.
 */
export function splitAmountEqually(total: number, count: number): number[] {
  if (count <= 0) return [];
  const totalPiasters = Math.round(Math.max(0, total) * 100);
  const base = Math.floor(totalPiasters / count);
  const remainder = totalPiasters - base * count;
  return Array.from({ length: count }, (_, idx) => {
    const piasters = idx === 0 ? base + remainder : base;
    return Number((piasters / 100).toFixed(2));
  });
}

/**
 * Auto-Dispatch Engine (supports single, Large multi-courier orders, merchant status guard & rejection filtering):
 * - Checks order's `merchant_id` (`is_active` & `subscription_end_date`); if inactive/expired, cancels with reason "المتجر غير نشط" and assigns no courier.
 * - Reads `rejected_by_couriers` on the `orders` row.
 * - Finds up to `requiredCouriers` available couriers (`status='online'`, `account_status='active'`, `active_orders_count < 2`, NOT in `rejected_by_couriers`, and within cash limits).
 * - Each assigned courier receives their FULL commission: `delivery_fee_net * (percentage / 100)`.
 * - Inserts a record into `order_couriers` for each assigned courier.
 * - Updates `orders` with primary `courier_id` and `status='assigned'`, and increments each courier's `active_orders_count`.
 * - If no courier is available (all rejected or offline), keeps order status as `'new'`.
 */
export async function triggerAutoDispatch(
  orderId: string,
  options: AutoDispatchOptions = {}
): Promise<AutoDispatchResult> {
  const requiredCount = Math.max(1, Math.floor(options.requiredCouriers || 1));

  // Resolve fresh order details including merchant_id, to_zone_id, and rejected_by_couriers
  let deliveryFeeNet = options.deliveryFeeNet;
  let paymentMethod = options.paymentMethod;
  let orderTotal = options.orderTotal;
  let merchantId = options.merchantId ?? null;
  let toZoneId = options.toZoneId ?? null;
  const rejectedCourierIds = new Set<string>(
    parseRejectedCouriers(options.rejectedByCouriers)
  );
  let currentOrderStatus: string | null = null;
  let currentOrderCourierId: string | null = null;

  let orderQueryRes = await supabase
    .from('orders')
    .select(
      'merchant_id, to_zone_id, from_zone_id, delivery_fee_net, payment_method, total, is_large_order, required_couriers, status, courier_id, rejected_by_couriers'
    )
    .eq('id', orderId)
    .maybeSingle();

  if (
    orderQueryRes.error &&
    (orderQueryRes.error.code === '42703' ||
      orderQueryRes.error.code === 'PGRST204' ||
      orderQueryRes.error.message.includes('rejected_by_couriers'))
  ) {
    orderQueryRes = (await supabase
      .from('orders')
      .select(
        'merchant_id, to_zone_id, from_zone_id, delivery_fee_net, payment_method, total, is_large_order, required_couriers, status, courier_id'
      )
      .eq('id', orderId)
      .maybeSingle()) as typeof orderQueryRes;
  }

  const orderRow = orderQueryRes.data as
    | {
        merchant_id?: string | null;
        to_zone_id?: string | null;
        from_zone_id?: string | null;
        delivery_fee_net?: number | null;
        payment_method?: string | null;
        total?: number | null;
        status?: string | null;
        courier_id?: string | null;
        rejected_by_couriers?: unknown;
      }
    | null;

  if (orderRow) {
    merchantId = orderRow.merchant_id ?? merchantId;
    toZoneId = orderRow.to_zone_id ?? toZoneId;
    deliveryFeeNet = deliveryFeeNet ?? Number(orderRow.delivery_fee_net || 0);
    paymentMethod = paymentMethod ?? String(orderRow.payment_method || 'cash');
    orderTotal = orderTotal ?? Number(orderRow.total || 0);
    currentOrderStatus = orderRow.status ?? null;
    currentOrderCourierId = orderRow.courier_id ?? null;
    for (const id of parseRejectedCouriers(orderRow.rejected_by_couriers)) {
      rejectedCourierIds.add(id);
    }
  }

  // 1-3. Check Merchant active status & subscription expiration before assigning any courier
  if (merchantId) {
    const { data: merchantRow } = await supabase
      .from('merchants')
      .select('id, is_active, subscription_end_date')
      .eq('id', merchantId)
      .maybeSingle();

    if (merchantRow) {
      const subscriptionExpired = isMerchantSubscriptionExpired({
        is_active: merchantRow.is_active,
        subscription_end_date: merchantRow.subscription_end_date,
      });

      if (merchantRow.is_active === false || subscriptionExpired) {
        // Keep merchant's is_active synced if subscription date has passed
        if (merchantRow.is_active !== false && subscriptionExpired) {
          await supabase
            .from('merchants')
            .update({ is_active: false })
            .eq('id', merchantId);
        }

        const cancelReason = 'المتجر غير نشط';
        const { error: cancelErr } = await supabase
          .from('orders')
          .update({
            status: 'cancelled',
            courier_id: null,
            cancel_reason: cancelReason,
            cancel_status: 'approved',
            courier_commission: 0,
            hatly_net_revenue: 0,
          })
          .eq('id', orderId);

        if (
          cancelErr &&
          (cancelErr.code === '42703' || cancelErr.code === 'PGRST204')
        ) {
          const { error: fallbackCancelErr } = await supabase
            .from('orders')
            .update({
              status: 'cancelled',
              courier_id: null,
              cancel_reason: cancelReason,
            })
            .eq('id', orderId);

          if (
            fallbackCancelErr &&
            (fallbackCancelErr.code === '42703' ||
              fallbackCancelErr.code === 'PGRST204')
          ) {
            await supabase
              .from('orders')
              .update({
                status: 'cancelled',
                courier_id: null,
              })
              .eq('id', orderId);
          }
        }

        return {
          assigned: false,
          assignedCount: 0,
          requiredCount,
          couriers: [],
          merchantInactive: true,
          message:
            'تم إلغاء الطلب تلقائياً لأن المتجر غير نشط أو اشتراكه منتهي (السبب: المتجر غير نشط) ولم يتم تعيين مندوب',
        };
      }
    }
  }

  // Check if any couriers are already assigned to this order in order_couriers
  const { data: existingRows } = await supabase
    .from('order_couriers')
    .select('courier_id')
    .eq('order_id', orderId);

  const alreadyAssignedIds = new Set(
    (existingRows || []).map((r: { courier_id: string }) => r.courier_id)
  );
  const remainingNeeded = Math.max(0, requiredCount - alreadyAssignedIds.size);

  if (remainingNeeded === 0 && alreadyAssignedIds.size > 0) {
    return {
      assigned: true,
      assignedCount: alreadyAssignedIds.size,
      requiredCount,
      couriers: [],
      message: `الطلب معين بالفعل لعدد ${alreadyAssignedIds.size} مناديب`,
    };
  }

  const keepOrderAsNew = async () => {
    if (
      alreadyAssignedIds.size === 0 &&
      (currentOrderStatus !== 'new' || currentOrderCourierId !== null) &&
      currentOrderStatus !== 'delivered' &&
      currentOrderStatus !== 'cancelled' &&
      currentOrderStatus !== 'picked_up' &&
      currentOrderStatus !== 'in_transit'
    ) {
      await supabase
        .from('orders')
        .update({ status: 'new', courier_id: null })
        .eq('id', orderId);
    }
  };

  const [candidatesRes, ordersRes, ocRes, depositsRes, cashLimits, czRes, zoneRes] =
    await Promise.all([
      supabase
        .from('couriers')
        .select('id, profile_id, status, active_orders_count, account_status')
        .eq('status', 'online')
        .eq('account_status', 'active'),
      supabase.from('orders').select('*'),
      supabase.from('order_couriers').select('*'),
      supabase.from('courier_deposits').select('*'),
      fetchCashLimits(),
      toZoneId
        ? supabase
            .from('courier_zones')
            .select('courier_id')
            .eq('zone_id', toZoneId)
        : Promise.resolve({ data: null, error: null }),
      toZoneId
        ? supabase.from('zones').select('*').eq('id', toZoneId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

  const zoneObj = (zoneRes?.data as Zone | null) || null;
  const zoneLabel = zoneObj
    ? zoneObj.name_ar || zoneObj.name || zoneObj.zone_name || zoneObj.title || 'المنطقة المحددة'
    : 'المنطقة المحددة';

  let allowedCourierIdsForZone: Set<string> | null = null;
  if (toZoneId) {
    if (czRes.error) {
      console.log('[AutoDispatch] courier_zones fetch error:', czRes.error);
      await keepOrderAsNew();
      return {
        assigned: false,
        assignedCount: alreadyAssignedIds.size,
        requiredCount,
        couriers: [],
        zoneUnavailable: true,
        message: `تنبيه: تعذر التحقق من مناطق تغطية المناديب للمنطقة (${zoneLabel}) — تم الإبقاء على الطلب بحالة "جديد"`,
      };
    }

    const zoneRows = (czRes.data as Array<{ courier_id: string }> | null) || [];
    allowedCourierIdsForZone = new Set(zoneRows.map((r) => String(r.courier_id)));

    if (allowedCourierIdsForZone.size === 0) {
      await keepOrderAsNew();
      return {
        assigned: false,
        assignedCount: alreadyAssignedIds.size,
        requiredCount,
        couriers: [],
        zoneUnavailable: true,
        message: `تنبيه: لا يوجد مندوب مسجّل لخدمة منطقة التوصيل "${zoneLabel}" — تم الإبقاء على الطلب بحالة "جديد"`,
      };
    }
  }

  const { data: candidates, error: fetchError } = candidatesRes;
  const allOrders = (ordersRes.data as Order[]) || [];
  const allOrderCouriers = (ocRes.data as OrderCourier[]) || [];

  if (fetchError || !candidates || candidates.length === 0) {
    await keepOrderAsNew();
    return {
      assigned: false,
      assignedCount: alreadyAssignedIds.size,
      requiredCount,
      couriers: [],
      allRejected: false,
      zoneUnavailable: Boolean(toZoneId),
      message: toZoneId
        ? `تنبيه: لا يوجد مندوب متصل متاح حالياً لتوصيل الطلب إلى منطقة "${zoneLabel}" — تم الإبقاء على الطلب بحالة "جديد"`
        : 'لا يوجد مندوب متاح حالياً (جميع المناديب غير متصلين أو لديهم طلبات نشطة) — تم الإبقاء على الطلب بحالة "جديد"',
    };
  }

  const dynamicActiveCounts = computeDynamicActiveOrdersMap(
    candidates as Courier[],
    allOrders,
    allOrderCouriers
  );

  const nonRejectedCandidates = (candidates as Courier[])
    .map((c) => ({
      ...c,
      active_orders_count: dynamicActiveCounts.get(c.id) ?? 0,
    }))
    .filter((c) => {
      if (alreadyAssignedIds.has(c.id)) return false;
      if (rejectedCourierIds.has(c.id)) return false;
      if (c.profile_id && rejectedCourierIds.has(c.profile_id)) return false;
      if (allowedCourierIdsForZone && !allowedCourierIdsForZone.has(c.id)) {
        return false;
      }
      return (
        c.status === 'online' &&
        c.account_status === 'active' &&
        c.active_orders_count < 2
      );
    })
    .sort((a, b) => a.active_orders_count - b.active_orders_count);

  if (nonRejectedCandidates.length === 0) {
    await keepOrderAsNew();
    return {
      assigned: false,
      assignedCount: alreadyAssignedIds.size,
      requiredCount,
      couriers: [],
      allRejected: rejectedCourierIds.size > 0,
      zoneUnavailable: Boolean(toZoneId),
      message:
        rejectedCourierIds.size > 0
          ? toZoneId
            ? `تنبيه: لا يوجد مندوب متاح حالياً لمنطقة "${zoneLabel}" (مناديب المنطقة المتصلون رفضوا الطلب أو لديهم الحد الأقصى) — تم الإبقاء على الطلب بحالة "جديد"`
            : 'لا يوجد مندوب متاح حالياً (جميع المناديب المتصلين رفضوا هذا الطلب) — تم الإبقاء على الطلب بحالة "جديد"'
          : toZoneId
          ? `تنبيه: لا يوجد مندوب متصل يخدم منطقة "${zoneLabel}" لديه أقل من طلبين نشطين — تم الإبقاء على الطلب بحالة "جديد"`
          : 'لا يوجد مندوب متاح حالياً — تم الإبقاء على الطلب بحالة "جديد"',
    };
  }

  const { updatedCouriers, statusMap } = await syncCourierCashLimits(
    nonRejectedCandidates,
    (ordersRes.data as Order[]) || [],
    (depositsRes.data as CourierDeposit[]) || [],
    (ocRes.data as OrderCourier[]) || [],
    cashLimits
  );

  const eligible = updatedCouriers
    .filter((c) => {
      if (alreadyAssignedIds.has(c.id)) return false;
      if (rejectedCourierIds.has(c.id)) return false;
      if (c.profile_id && rejectedCourierIds.has(c.profile_id)) return false;
      if (allowedCourierIdsForZone && !allowedCourierIdsForZone.has(c.id)) {
        return false;
      }
      if (
        c.status !== 'online' ||
        c.account_status !== 'active' ||
        (c.active_orders_count ?? 0) >= 2
      ) {
        return false;
      }
      const st = statusMap.get(c.id);
      return st ? st.canAcceptOrders : true;
    })
    .slice(0, remainingNeeded);

  if (eligible.length === 0) {
    await keepOrderAsNew();
    return {
      assigned: false,
      assignedCount: alreadyAssignedIds.size,
      requiredCount,
      couriers: [],
      allRejected: rejectedCourierIds.size > 0,
      zoneUnavailable: Boolean(toZoneId),
      message:
        rejectedCourierIds.size > 0
          ? toZoneId
            ? `تنبيه: لا يوجد مندوب متاح لمنطقة "${zoneLabel}" (مناديب المنطقة رفضوا الطلب أو تجاوزوا حد الكاش المسموح) — تم الإبقاء على الطلب بحالة "جديد"`
            : 'لا يوجد مندوب متاح (المناديب المتاحون رفضوا الطلب أو تجاوزوا حد الكاش المسموح) — تم الإبقاء على الطلب بحالة "جديد"'
          : toZoneId
          ? `تنبيه: لا يوجد مندوب متاح لمنطقة "${zoneLabel}" (مناديب المنطقة تجاوزوا حد الكاش المسموح) — تم الإبقاء على الطلب بحالة "جديد"`
          : 'لا يوجد مندوب متاح (أو المناديب تجاوزوا حد الكاش المسموح) — تم الإبقاء على الطلب بحالة "جديد"',
    };
  }

  const pct =
    options.commissionPct !== undefined
      ? options.commissionPct
      : await fetchCourierCommissionPct();

  const { courierCommission } = calculateCommissionSplit(
    Number(deliveryFeeNet || 0),
    pct
  );

  // Update orders table primary courier & status='assigned'
  const { error: orderUpdateError } = await supabase
    .from('orders')
    .update({
      courier_id: eligible[0].id,
      status: 'assigned',
    })
    .eq('id', orderId);

  if (orderUpdateError) {
    return {
      assigned: false,
      assignedCount: alreadyAssignedIds.size,
      requiredCount,
      couriers: [],
      message: 'تعذر تعيين المندوب للطلب تلقائياً',
    };
  }

  const totalCouriersNow = alreadyAssignedIds.size + eligible.length;
  const cashSplits =
    paymentMethod === 'cash'
      ? splitAmountEqually(Number(orderTotal || 0), totalCouriersNow)
      : Array.from({ length: totalCouriersNow }, () => 0);

  // If there were existing couriers before this partial retry, update their equal cash_collected
  if (alreadyAssignedIds.size > 0 && paymentMethod === 'cash') {
    const existingArr = Array.from(alreadyAssignedIds);
    for (let i = 0; i < existingArr.length; i++) {
      await supabase
        .from('order_couriers')
        .update({ cash_collected: cashSplits[i] ?? 0 })
        .eq('order_id', orderId)
        .eq('courier_id', existingArr[i]);
    }
  }

  // Insert a record into `order_couriers` for EACH assigned courier with their FULL commission
  const orderCourierInserts = eligible.map((c, idx) => ({
    order_id: orderId,
    courier_id: c.id,
    commission_amount: courierCommission,
    cash_collected: cashSplits[alreadyAssignedIds.size + idx] ?? 0,
    status: 'assigned',
  }));

  await supabase.from('order_couriers').insert(orderCourierInserts);

  // Increment active_orders_count for each assigned courier
  const enrichedCouriers: Array<Courier & { full_name?: string | null }> = [];
  for (const chosen of eligible) {
    const nextCount = (chosen.active_orders_count ?? 0) + 1;
    await supabase
      .from('couriers')
      .update({ active_orders_count: nextCount })
      .eq('id', chosen.id);

    let courierName: string | null = null;
    if (chosen.profile_id) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', chosen.profile_id)
        .maybeSingle();
      courierName = prof?.full_name ?? null;
    }

    enrichedCouriers.push({
      ...chosen,
      active_orders_count: nextCount,
      full_name: courierName,
    });
  }

  const namesList = enrichedCouriers
    .map((c) => c.full_name || 'مندوب')
    .join('، ');

  const totalAssigned = alreadyAssignedIds.size + enrichedCouriers.length;

  let message: string;
  if (requiredCount > 1) {
    if (totalAssigned >= requiredCount) {
      message = `تم تعيين ${totalAssigned} مناديب للأوردر الكبير (${namesList}) بعمولة كاملة لكل مندوب (${courierCommission.toFixed(2)} ج.م)`;
    } else {
      message = `تم تعيين ${totalAssigned} من أصل ${requiredCount} مناديب (${namesList}) — يرجى استكمال باقي المناديب عند توفرهم`;
    }
  } else {
    message = enrichedCouriers[0]?.full_name
      ? `تم تعيين الطلب تلقائياً للمندوب: ${enrichedCouriers[0].full_name}`
      : 'تم تعيين الطلب للمندوب تلقائياً';
  }

  return {
    assigned: true,
    assignedCount: totalAssigned,
    requiredCount,
    couriers: enrichedCouriers,
    courier: enrichedCouriers[0],
    message,
  };
}
