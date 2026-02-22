// Fixture: TypeScript advanced syntax — generics, enum, namespace
// Verifies that the implementation-overhead analyzer handles these constructs.

enum LogLevel {
  Debug = 0,
  Info = 1,
  Warn = 2,
  Error = 3,
}

interface Logger<T extends string = string> {
  log(level: LogLevel, message: T): void;
  child(prefix: string): Logger<T>;
}

export function createLogger<T extends string = string>(prefix: string): Logger<T> {
  const format = (level: LogLevel, msg: T): string => {
    const levelName = LogLevel[level] ?? 'UNKNOWN';

    return `[${levelName}] ${prefix}: ${msg}`;
  };

  return {
    log(level: LogLevel, message: T): void {
      const formatted = format(level, message);
      const output = formatted.trim();

      if (level >= LogLevel.Warn) {
        console.error(output);
      } else {
        console.log(output);
      }
    },

    child(childPrefix: string): Logger<T> {
      return createLogger<T>(`${prefix}/${childPrefix}`);
    },
  };
}

namespace MathUtils {
  export function clamp(value: number, min: number, max: number): number {
    if (value < min) {
      return min;
    }

    if (value > max) {
      return max;
    }

    return value;
  }

  export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * clamp(t, 0, 1);
  }
}

export function processGenericList<T extends Record<string, unknown>>(
  items: readonly T[],
  predicate: (item: T) => boolean,
): T[] {
  const result: T[] = [];

  for (const item of items) {
    if (predicate(item)) {
      result.push(item);
    }
  }

  return result;
}

export { MathUtils };
