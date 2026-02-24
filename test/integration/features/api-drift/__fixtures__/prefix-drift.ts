// prefix-drift: 3+ same-prefix functions with different shapes
// Tests prefix family detection and stop-word filtering

// "user" prefix — NOT a stop-word → should form group
export function userCreate(name: string, age: number): void {
  console.log(name, age);
}

export async function userDelete(id: string): Promise<boolean> {
  return id.length > 0;
}

export function userUpdate(id: string, name: string, age?: number): string {
  return `${id}:${name}:${age ?? 0}`;
}

// "get" prefix — IS a stop-word → should NOT form group
export function getUser(): string {
  return 'user';
}

export function getData(): number {
  return 42;
}

export async function getConfig(): Promise<string> {
  return 'config';
}
