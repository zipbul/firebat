let cache: Map<string, string> | null = null;

export function getCache(): Map<string, string> {
  if (!cache) {
    cache = new Map<string, string>();
  }

  return cache;
}

export function clearCache(): void {
  cache = null;
}
