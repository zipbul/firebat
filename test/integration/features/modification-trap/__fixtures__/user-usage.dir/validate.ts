import type { User } from './user-types';

export function validateUser(user: User): boolean {
  return user.firstName.length > 0 && user.lastName.length > 0;
}
