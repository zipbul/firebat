// Fixture: TypeScript advanced syntax — generics, enum, namespace
// Verifies that the early-return analyzer handles these constructs.

enum Result {
  Ok = 'ok',
  Err = 'err',
}

interface Validated<T> {
  result: Result;
  value: T | null;
  error: string | null;
}

export function validate<T>(input: unknown, guard: (v: unknown) => v is T): Validated<T> {
  if (input === null) {
    return { result: Result.Err, value: null, error: 'null input' };
  }

  if (input === undefined) {
    return { result: Result.Err, value: null, error: 'undefined input' };
  }

  if (!guard(input)) {
    return { result: Result.Err, value: null, error: 'type mismatch' };
  }

  return { result: Result.Ok, value: input, error: null };
}

namespace Guards {
  export function isString(value: unknown): value is string {
    if (typeof value !== 'string') {
      return false;
    }

    return true;
  }

  export function isNumber(value: unknown): value is number {
    if (typeof value !== 'number') {
      return false;
    }

    if (Number.isNaN(value)) {
      return false;
    }

    return true;
  }
}

export function processAll<T>(
  items: readonly T[],
  handler: (item: T) => boolean,
): { passed: T[]; failed: T[] } {
  const passed: T[] = [];
  const failed: T[] = [];

  for (const item of items) {
    if (handler(item)) {
      passed.push(item);
    } else {
      failed.push(item);
    }
  }

  return { passed, failed };
}

export { Guards, Result };
