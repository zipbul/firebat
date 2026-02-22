export function getUserById(id: string) {
  return { id };
}

export function getUserByName(name: string) {
  return { name };
}

export async function getUserByEmail(email: string) {
  return { email };
}

export async function createUser() {
  return { id: '1', name: 'new' };
}
