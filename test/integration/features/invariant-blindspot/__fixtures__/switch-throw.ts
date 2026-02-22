export function parseKind(kind: string): string {
  switch (kind) {
    case 'a':
      return 'type-a';
    case 'b':
      return 'type-b';
    default:
      throw new Error(`Unknown kind: ${kind}`);
  }
}
