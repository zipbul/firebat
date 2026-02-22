const cache = new Map<string, string>();

async function fetchWithCleanup(url: string): Promise<string> {
  try {
    return await Promise.resolve(url); // return await justified: finally must await
  } finally {
    cache.delete(url); // cleanup requires await to complete first
  }
}

export { fetchWithCleanup };
