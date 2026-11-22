import type { Courier, Order, OrderCourier } from '../types/database';

export function isInactiveOrderStatus(status?: string | null): boolean {
  const normalized = String(status ?? '').trim().toLowerCase();
  return normalized === 'delivered' || normalized === 'cancelled';
}

/**
 * Dynamically calculates active_orders_count per courier by counting unique orders
 * in `orders` (and `order_couriers` for multi-courier orders) where `courier_id`
 * matches and `status` is NOT 'delivered' and NOT 'cancelled'.
 */
export function computeDynamicActiveOrdersMap(
  couriers: Array<Pick<Courier, 'id' | 'profile_id'>>,
  orders: Array<Pick<Order, 'id' | 'courier_id' | 'status'>>,
  orderCouriers: Array<Pick<OrderCourier, 'order_id' | 'courier_id' | 'status'>> = []
): Map<string, number> {
  const courierLookup = new Map<string, string>();
  const activeOrdersByCourier = new Map<string, Set<string>>();

  for (const c of couriers) {
    activeOrdersByCourier.set(c.id, new Set<string>());
    courierLookup.set(c.id, c.id);
    if (c.profile_id) {
      courierLookup.set(c.profile_id, c.id);
    }
  }

  const orderById = new Map<string, Pick<Order, 'id' | 'courier_id' | 'status'>>();
  for (const order of orders) {
    orderById.set(order.id, order);
    if (isInactiveOrderStatus(order.status)) continue;

    if (order.courier_id) {
      const targetCourierId = courierLookup.get(order.courier_id);
      if (targetCourierId) {
        activeOrdersByCourier.get(targetCourierId)?.add(order.id);
      }
    }
  }

  for (const oc of orderCouriers) {
    const parentOrder = orderById.get(oc.order_id);
    if (parentOrder) {
      if (isInactiveOrderStatus(parentOrder.status)) continue;
    } else if (isInactiveOrderStatus(oc.status)) {
      continue;
    }

    const targetCourierId = courierLookup.get(oc.courier_id);
    if (targetCourierId) {
      activeOrdersByCourier.get(targetCourierId)?.add(oc.order_id);
    }
  }

  const counts = new Map<string, number>();
  for (const [courierId, orderIds] of activeOrdersByCourier.entries()) {
    counts.set(courierId, orderIds.size);
  }
  return counts;
}
