import type { Status } from './types';

export function handleOrder(status: Status): string {
  switch (status) {
    case 'pending':
      return 'wait';
    case 'shipped':
      return 'track';
    case 'delivered':
      return 'done';
    default:
      return 'unknown';
  }
}
