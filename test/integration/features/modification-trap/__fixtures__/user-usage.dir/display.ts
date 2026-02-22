import type { User } from './user-types';

export function formatUserName(user: User): string {
  return `${user.firstName} ${user.lastName}`;
}
