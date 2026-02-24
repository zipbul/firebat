// edge-cases: for-of semicolon correction, arrow export overhead, complex return type

export function forOfLoop(items: string[]): string {
  let result = '';

  for (const item of items) {
    result += item;
  }

  return result;
}

export function cStyleFor(n: number): number {
  let sum = 0;

  for (let i = 0; i < n; i++) {
    sum += i;
    sum += i * 2;
    sum += i * 3;
  }

  return sum;
}

export const arrowExport = (
  input: Map<string, number[]>,
): Promise<Map<string, number[]>> => {
  const result = new Map<string, number[]>();

  for (const [key, values] of input) {
    result.set(key, values.filter((v) => v > 0));
    result.set(`${key}_sum`, [values.reduce((a, b) => a + b, 0)]);
    result.set(`${key}_count`, [values.length]);
  }

  return Promise.resolve(result);
};

export function complexReturnType(
  data: Record<string, unknown>,
): Promise<Map<string, Array<{ id: number; value: string }>>> {
  const result = new Map<string, Array<{ id: number; value: string }>>();
  const keys = Object.keys(data);

  for (const key of keys) {
    result.set(key, [{ id: 1, value: String(data[key]) }]);
    result.set(`${key}_extra`, [{ id: 2, value: 'extra' }]);
  }

  return Promise.resolve(result);
}
