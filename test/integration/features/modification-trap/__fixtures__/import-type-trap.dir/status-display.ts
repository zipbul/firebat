import type { Status } from './types';

export function displayStatus(status: Status): string {
  switch (status) {
    case 'pending':
      return '⏳';
    case 'shipped':
      return '🚚';
    case 'delivered':
      return '✅';
    default:
      return '❓';
  }
}
