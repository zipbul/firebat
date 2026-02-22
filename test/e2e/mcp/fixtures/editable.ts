// Fixture for edit tools – will be COPIED to tmpdir before modification.

function greet(name: string): string {
  return `Hello, ${name}!`;
}

function farewell(name: string): string {
  return `Goodbye, ${name}!`;
}

class Greeter {
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

const GREETING_PREFIX = 'Hello';
const FAREWELL_PREFIX = 'Goodbye';

function formatMessage(prefix: string, name: string): string {
  return `${prefix}, ${name}!`;
}

function identity<T>(value: T): T {
  return value;
}

const arrowFn = (x: number): number => x * 2;

void Greeter;

export { FAREWELL_PREFIX, GREETING_PREFIX, arrowFn, farewell, formatMessage, greet, identity };
