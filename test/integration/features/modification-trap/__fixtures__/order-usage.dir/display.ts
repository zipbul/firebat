import type { Order } from './order-types';

export function formatOrderSummary(order: Order): string {
  return `Order #${order.id}: ${order.total}`;
}
