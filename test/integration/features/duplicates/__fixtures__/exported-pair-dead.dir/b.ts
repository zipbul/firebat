export function normalizeTag(tag: string): string {
  const trimmed = tag.trim();
  const lowered = trimmed.toLowerCase();
  return lowered;
}
