// Fixture: async function — guard detection should work with async
export async function fetchData(url: string | null): Promise<string> {
  if (!url) {
    return 'no-url';
  }

  const response = await fetch(url);
  return response.text();
}
