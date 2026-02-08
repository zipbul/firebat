// Fixture for edit tools – will be COPIED to tmpdir before modification.

export function greet(name: string): string {
  return `Hello, ${name}!`;
}

export function farewell(name: string): string {
  return `Goodbye, ${name}!`;
}

export class Greeter {
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  greet(): string {
    return `Hello, ${this.name}!`;
  }

  farewell(): string {
    return `Goodbye, ${this.name}!`;
  }
}

export const GREETING_PREFIX = 'Hello';

export const FAREWELL_PREFIX = 'Goodbye';

export function formatMessage(prefix: string, name: string): string {
  return `${prefix}, ${name}!`;
}

export function identity<T>(value: T): T {
  return value;
}

export const arrowFn = (x: number): number => x * 2;
