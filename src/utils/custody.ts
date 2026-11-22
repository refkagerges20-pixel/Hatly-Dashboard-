import type {
  Courier,
  CourierDeposit,
  CourierPenalty,
  Merchant,
  MerchantSettlement,
  Order,
  OrderCourier,
} from '../types/database';
import type { CourierCustodySummary } from '../components/RecordDepositModal';
import { calculateCommissionSplit } from './commissions';
import { splitAmountEqually } from './autoDispatch';

export interface MerchantPayableSummary {
  merchant: Merchant;
  name: string;
  phone: string;
  deliveredOrdersCount: number;
  unsettledOrdersCount: number;
  unsettledOrders: Order[];
  totalSales: number;
  settledSales: number;
  totalPaid: number;
  remainingBalance: number;
}

export function isOrderDelivered(status?: string | null): boolean {
  return String(status || '').trim().toLowerCase() === 'delivered';
}

export function isOrderMerchantSettled(
  order: Pick<Order, 'is_merchant_settled'>
): boolean {
  return order.is_merchant_settled === true;
}

export function isCashOnDelivery(paymentMethod?: string | null): boolean {
  const pm = String(paymentMethod ?? 'cash')
    .trim()
    .toLowerCase();
  return (
    pm === '' ||
    pm === 'cash' ||
    pm === 'cod' ||
    pm === 'cash_on_delivery' ||
    pm === 'كاش'
  );
}

export function matchesCourier(
  targetId: string | null | undefined,
  courier: Courier
): boolean {
  if (!targetId) return false;
  return targetId === courier.id || targetId === courier.profile_id;
}

export function getOrderDeliveryFeeNet(order: Order): number {
  const rawNet = order.delivery_fee_net;
  if (rawNet !== null && rawNet !== undefined && Number(rawNet) > 0) {
    return Number(rawNet);
  }
  const base = Number(order.delivery_fee_base || 0);
  const discount = Number(order.partner_discount || 0);
  return Math.max(0, Number((base - discount).toFixed(2)));
}

export function getOrderMerchantPayable(order: Order): number {
  if (
    order.merchant_payable !== null &&
    order.merchant_payable !== undefined &&
    Number(order.merchant_payable) > 0
  ) {
    return Number(order.merchant_payable);
  }
  return Number(order.products_total || 0) || Number(order.amount_to_collect || 0);
}

export function groupOrderCouriersByOrder(
  orderCouriers: OrderCourier[]
): Map<string, OrderCourier[]> {
  const map = new Map<string, OrderCourier[]>();
  for (const row of orderCouriers) {
    const list = map.get(row.order_id);
    if (list) {
      list.push(row);
    } else {
      map.set(row.order_id, [row]);
    }
  }
  return map;
}

export function resolveOrderFinancials(
  order: Order,
  commissionPct: number,
  orderCouriersForOrder: OrderCourier[] = []
) {
  const deliveryFeeNet = getOrderDeliveryFeeNet(order);
  const split = calculateCommissionSplit(deliveryFeeNet, commissionPct);

  const merchantPayable = getOrderMerchantPayable(order);

  if (orderCouriersForOrder.length > 0) {
    const totalCourierCommissions = Number(
      orderCouriersForOrder
        .reduce((sum, oc) => {
          const rowComm = Number(oc.commission_amount || 0);
          return sum + (rowComm > 0 ? rowComm : split.courierCommission);
        }, 0)
        .toFixed(2)
    );
    const hatlyNetRevenue = Number(
      (deliveryFeeNet - totalCourierCommissions).toFixed(2)
    );
    return {
      deliveryFeeNet,
      courierCommission: totalCourierCommissions,
      hatlyNetRevenue,
      merchantPayable,
      courierCount: orderCouriersForOrder.length,
    };
  }

  if (order.is_large_order) {
    const reqCount = Math.max(2, Number(order.required_couriers || 2));
    const savedComm = Number(order.courier_commission || 0);
    const totalCourierCommissions =
      savedComm > 0
        ? savedComm
        : Number((split.courierCommission * reqCount).toFixed(2));
    const hatlyNetRevenue = Number(
      (deliveryFeeNet - totalCourierCommissions).toFixed(2)
    );
    return {
      deliveryFeeNet,
      courierCommission: totalCourierCommissions,
      hatlyNetRevenue,
      merchantPayable,
      courierCount: reqCount,
    };
  }

  const savedComm = Number(order.courier_commission || 0);
  const courierCommission =
    savedComm > 0 ? savedComm : split.courierCommission;

  const hatlyNetRevenue = Number(
    (deliveryFeeNet - courierCommission).toFixed(2)
  );

  return {
    deliveryFeeNet,
    courierCommission,
    hatlyNetRevenue,
    merchantPayable,
    courierCount: 1,
  };
}

export function buildCourierCustodySummaries(
  couriers: Courier[],
  orders: Order[],
  deposits: CourierDeposit[],
  commissionPct: number,
  orderCouriers: OrderCourier[] = [],
  penalties: CourierPenalty[] = []
): CourierCustodySummary[] {
  const byOrder = groupOrderCouriersByOrder(orderCouriers);
  const deliveredOrders = orders.filter((o) => isOrderDelivered(o.status));

  return couriers.map((courier) => {
    let grossCollected = 0;
    let totalCommission = 0;
    let deliveredOrdersCount = 0;
    let deliveredCodCount = 0;

    for (const order of deliveredOrders) {
      const rows = byOrder.get(order.id) || [];
      const deliveryFeeNet = getOrderDeliveryFeeNet(order);
      const split = calculateCommissionSplit(deliveryFeeNet, commissionPct);

      if (rows.length > 0) {
        const myIndex = rows.findIndex((r) => matchesCourier(r.courier_id, courier));
        if (myIndex === -1) continue;

        deliveredOrdersCount += 1;
        const myRow = rows[myIndex];
        const rowComm = Number(myRow.commission_amount || 0);
        totalCommission += rowComm > 0 ? rowComm : split.courierCommission;

        if (isCashOnDelivery(order.payment_method)) {
          deliveredCodCount += 1;
          const explicitSum = rows.reduce(
            (sum, r) => sum + Number(r.cash_collected || 0),
            0
          );
          if (explicitSum > 0) {
            grossCollected += Number(myRow.cash_collected || 0);
          } else {
            const equalSplits = splitAmountEqually(
              Number(order.total || 0),
              rows.length
            );
            grossCollected += equalSplits[myIndex] ?? 0;
          }
        }
      } else if (matchesCourier(order.courier_id, courier)) {
        deliveredOrdersCount += 1;
        const { courierCommission } = resolveOrderFinancials(order, commissionPct);
        totalCommission += courierCommission;

        if (isCashOnDelivery(order.payment_method)) {
          deliveredCodCount += 1;
          grossCollected += Number(order.total || 0);
        }
      }
    }

    const totalDeposited = deposits
      .filter((d) => matchesCourier(d.courier_id, courier))
      .reduce((sum, d) => sum + Number(d.amount || 0), 0);

    const totalPenalties = penalties
      .filter((p) => matchesCourier(p.courier_id, courier))
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

    const totalOwed = Number((grossCollected - totalCommission).toFixed(2));
    const remainingCustody = Number(
      (totalOwed - totalDeposited - totalPenalties).toFixed(2)
    );

    return {
      courier,
      name: courier.profiles?.full_name || 'مندوب',
      phone: courier.profiles?.phone || '—',
      deliveredOrdersCount,
      deliveredCodCount,
      grossCollected: Number(grossCollected.toFixed(2)),
      totalCommission: Number(totalCommission.toFixed(2)),
      totalOwed,
      totalDeposited: Number(totalDeposited.toFixed(2)),
      totalPenalties: Number(totalPenalties.toFixed(2)),
      remainingCustody,
    };
  });
}

export function buildMerchantPayableSummaries(
  merchants: Merchant[],
  orders: Order[],
  settlements: MerchantSettlement[]
): MerchantPayableSummary[] {
  const deliveredOrders = orders.filter((o) => isOrderDelivered(o.status));

  return merchants.map((merchant) => {
    const merchantOrders = deliveredOrders.filter(
      (o) => o.merchant_id === merchant.id
    );

    const unsettledOrders = merchantOrders
      .filter((o) => !isOrderMerchantSettled(o))
      .sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );

    const settledOrders = merchantOrders.filter((o) =>
      isOrderMerchantSettled(o)
    );

    // Total Sales = Sum of merchant_payable where status='delivered' and is_merchant_settled=false
    const totalSales = Number(
      unsettledOrders
        .reduce((sum, o) => sum + getOrderMerchantPayable(o), 0)
        .toFixed(2)
    );

    const settledSales = Number(
      settledOrders
        .reduce((sum, o) => sum + getOrderMerchantPayable(o), 0)
        .toFixed(2)
    );

    const totalPaid = Number(
      settlements
        .filter((s) => s.merchant_id === merchant.id)
        .reduce((sum, s) => sum + Number(s.amount || 0), 0)
        .toFixed(2)
    );

    // Account for settlements already matched to settled orders so paying off
    // unsettled orders reduces remaining balance cleanly to 0 rather than negative.
    const unallocatedPaid = Math.max(
      0,
      Number((totalPaid - settledSales).toFixed(2))
    );
    const remainingBalance = Number((totalSales - unallocatedPaid).toFixed(2));

    return {
      merchant,
      name:
        merchant.store_name ||
        merchant.profiles?.full_name ||
        merchant.name ||
        'متجر',
      phone: merchant.profiles?.phone || merchant.phone || '—',
      deliveredOrdersCount: merchantOrders.length,
      unsettledOrdersCount: unsettledOrders.length,
      unsettledOrders,
      totalSales,
      settledSales,
      totalPaid,
      remainingBalance,
    };
  });
}
