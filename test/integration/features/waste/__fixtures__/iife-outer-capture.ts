// KEEP boundary: IIFE가 outer 변수를 read → closure capture로 인정 → outer는 use ≥ 1.
// 즉시 실행이므로 capture된 binding은 의미적으로도 read됨.

export function withIife(): number {
  const captured = 42;

  return (() => captured)();
}
