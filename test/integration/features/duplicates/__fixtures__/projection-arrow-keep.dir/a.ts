// K: 두 함수는 다르지만 공유하는 건 단일 필드 projection 화살표(u => u.isRead)뿐 —
// 결정(분기·계산)을 담지 않은 selector 골격이라 보고 금지.
export function countReads(items: { isRead: boolean }[]): number {
  return items.filter(u => u.isRead).length;
}
