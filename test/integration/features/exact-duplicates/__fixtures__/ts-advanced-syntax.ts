// Fixture: TypeScript advanced syntax — generics, enum, namespace, decorators
// Verifies that the exact-duplicates analyzer handles these constructs without crashing.

enum Status {
  Active = 'active',
  Inactive = 'inactive',
  Pending = 'pending',
}

namespace Validators {
  export function isValid(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
  }

  export function isActive(status: Status): boolean {
    return status === Status.Active;
  }
}

interface Repository<T> {
  findById(id: string): T | null;
  findAll(): T[];
  save(entity: T): void;
}

class GenericRepository<T extends { id: string }> implements Repository<T> {
  private items: Map<string, T> = new Map();

  findById(id: string): T | null {
    return this.items.get(id) ?? null;
  }

  findAll(): T[] {
    return [...this.items.values()];
  }

  save(entity: T): void {
    this.items.set(entity.id, entity);
  }
}

function processItems<T>(items: readonly T[], transform: (item: T) => T): T[] {
  const result: T[] = [];

  for (const item of items) {
    result.push(transform(item));
  }

  return result;
}

// Decorator-like pattern (experimental decorators)
function log(_target: unknown, _key: string, descriptor: PropertyDescriptor): PropertyDescriptor {
  const original = descriptor.value as (...args: unknown[]) => unknown;

  descriptor.value = function (this: unknown, ...args: unknown[]) {
    return original.apply(this, args);
  };

  return descriptor;
}

class Service {
  @log
  execute(input: string): string {
    return input.toUpperCase();
  }
}

export { GenericRepository, processItems, Service, Status, Validators };
