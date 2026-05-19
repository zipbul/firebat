// case 3: 같은 값 재할당 (case 1의 literal 특수형)
// 두 번째 'mode = "dark"'는 read 없이 첫 def를 덮으며 값까지 동일 — 완전 noop.

export function applyMode(): string {
  let mode = 'dark';

  mode = 'dark';

  return mode;
}
