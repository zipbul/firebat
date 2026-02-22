// Rich types for LSP tool testing (hover, references, definitions, diagnostics, etc.)

interface User {
  id: number;
  name: string;
  email: string;
  createdAt: Date;
}

type UserCreateInput = Omit<User, 'id' | 'createdAt'>;

function createUser(input: UserCreateInput): User {
  return {
    ...input,
    id: Math.floor(Math.random() * 1000),
    createdAt: new Date(),
  };
}

function getUserName(user: User): string {
  return user.name;
}

function greetUser(user: User): string {
  const name = getUserName(user);

  return `Hello, ${name}!`;
}

class UserService {
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

const DEFAULT_USER: User = {
  id: 0,
  name: 'Anonymous',
  email: 'anon@example.com',
  createdAt: new Date(0),
};

type Callback<T> = (value: T) => void;

type AsyncCallback<T> = (value: T) => Promise<void>;

function processItems<T>(items: T[], cb: Callback<T>): void {
  for (const item of items) {
    cb(item);
  }
}

async function processItemsAsync<T>(items: T[], cb: AsyncCallback<T>): Promise<void> {
  for (const item of items) {
    await cb(item);
  }
}

// Overloaded function for signature help testing
function format(value: string): string;

function format(value: number, decimals?: number): string;

function format(value: string | number, decimals?: number): string {
  if (typeof value === 'string') {
    return value.trim();
  }

  return value.toFixed(decimals ?? 2);
}

void UserService;

export type { AsyncCallback, Callback, User, UserCreateInput };
export { DEFAULT_USER, createUser, format, getUserName, greetUser, processItems, processItemsAsync };
