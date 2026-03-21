export function processRequest(data: Record<string, string>): string {
  const token = data['auth'] ?? '';
  const a = data['key1'];
  const b = data['key2'];
  const c = data['key3'];
  const d = data['key4'];
  const e = data['key5'];

  console.log('token', a, b);

  return c + d + e;
}
