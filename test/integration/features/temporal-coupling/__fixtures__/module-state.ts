let currentUser = '';

export function setCurrentUser(name: string): void {
  currentUser = name;
}

export function getCurrentUser(): string {
  return currentUser;
}
