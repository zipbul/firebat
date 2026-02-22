export async function loadConfig(path: string): Promise<Record<string, string>> {
  try {
    const text = await Promise.resolve(path);

    return JSON.parse(text) as Record<string, string>;
  } catch (_e) {}

  return {};
}
