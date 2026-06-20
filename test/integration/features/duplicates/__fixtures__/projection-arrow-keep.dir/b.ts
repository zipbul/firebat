export function firstRead(items: { isRead: boolean }[]): { isRead: boolean } | undefined {
  return items.find(u => u.isRead);
}
