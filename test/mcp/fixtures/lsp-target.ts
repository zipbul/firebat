// Rich types for LSP tool testing (hover, references, definitions, diagnostics, etc.)

export interface User {
  id: number;
  name: string;
  email: string;
  createdAt: Date;
}

export type UserCreateInput = Omit<User, 'id' | 'createdAt'>;

export function createUser(input: UserCreateInput): User {
  return {
    ...input,
    id: Math.floor(Math.random() * 1000),
    createdAt: new Date(),
  };
}

export function getUserName(user: User): string {
  return user.name;
}

export function greetUser(user: User): string {
  const name = getUserName(user);
  return `Hello, ${name}!`;
}

export class UserService {
  private users: User[] = [];

  add(input: UserCreateInput): User {
    const user = createUser(input);
    this.users.push(user);
    return user;
  }

  findById(id: number): User | undefined {
    return this.users.find(u => u.id === id);
  }

  findByName(name: string): User[] {
    return this.users.filter(u => u.name.includes(name));
  }

  count(): number {
    return this.users.length;
  }
}

export const DEFAULT_USER: User = {
  id: 0,
  name: 'Anonymous',
  email: 'anon@example.com',
  createdAt: new Date(0),
};

export type Callback<T> = (value: T) => void;

export type AsyncCallback<T> = (value: T) => Promise<void>;

export function processItems<T>(items: T[], cb: Callback<T>): void {
  for (const item of items) {
    cb(item);
  }
}

export async function processItemsAsync<T>(items: T[], cb: AsyncCallback<T>): Promise<void> {
  for (const item of items) {
    await cb(item);
  }
}

// Overloaded function for signature help testing
export function format(value: string): string;
export function format(value: number, decimals?: number): string;
export function format(value: string | number, decimals?: number): string {
  if (typeof value === 'string') return value.trim();
  return value.toFixed(decimals ?? 2);
}
