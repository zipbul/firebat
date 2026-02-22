import type { Order } from './order-types';

export function processOrder(order: Order): string {
  switch (order.status) {
    case 'pending': return 'Processing';
    case 'shipped': return 'In transit';
    default: return 'Unknown';
  }
}
