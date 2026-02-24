// nested-try-catch: overscoped-try, useless-catch, redundant-nested-catch,
//   missing-error-cause, return-await outside try, return-in-finally

export function overscopedTry(): string {
  try {
    const a = 1;
    const b = 2;
    const c = 3;
    const d = 4;
    const e = 5;
    const f = 6;
    const g = 7;
    const h = 8;
    const i = 9;
    const j = 10;
    const k = 11;
    return String(a + b + c + d + e + f + g + h + i + j + k);
  } catch (err) {
    return 'error';
  }
}

export function uselessCatch(): string {
  try {
    return JSON.parse('{}');
  } catch (e) {
    throw e;
  }
}

export function redundantNestedCatch(): string {
  try {
    try {
      return JSON.parse('{}');
    } catch (inner) {
      return 'inner error';
    }
  } catch (outer) {
    return 'outer error';
  }
}

export function missingErrorCause(): never {
  try {
    JSON.parse('');
  } catch (original) {
    throw new Error('wrapped');
  }
}

export async function returnAwaitOutsideTry(): Promise<string> {
  return await Promise.resolve('data');
}

export function returnInFinally(): Promise<string> {
  return Promise.resolve('value').finally(() => {
    return 'replaced';
  });
}
