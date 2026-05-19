// KEEP boundary (case 7의 반례): 객체가 return으로 escape
// 'map'은 dynamic key로 property write만 일어나지만 return으로 caller에게 전달.

export function buildRecord(keys: string[]): Record<string, number> {
  const map: Record<string, number> = {};

  for (const k of keys) {
    map[k] = k.length;
  }

  return map;
}
