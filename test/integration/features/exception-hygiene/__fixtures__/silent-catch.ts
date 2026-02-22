export function tryParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch (e) {}

  return null;
}
