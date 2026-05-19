// KEEP boundary (case 1의 반례): mutation 전 snapshot
// 'prev'는 read됨 (return). 단순 alias처럼 보이지만 user.name이 직후 mutate되므로
// inline 치환 시 다른 값을 read하게 됨 → 변수 제거 불가, KEEP.

export function previousName(user: { name: string }): string {
  const prev = user.name;

  user.name = 'anonymous';

  return prev;
}
