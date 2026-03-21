export const parsed = JSON.parse('{}') as Record<string, unknown>;
export const name = (parsed['name'] as string | undefined) ?? 'default';
