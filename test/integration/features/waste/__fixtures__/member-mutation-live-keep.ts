// KEEP (member-mutation bug repro): `q` is a live binding — the member writes
// `q[0] = [1]` and the mutating read `q.shift()` both read the base object `q`.
// A member-write / mutating-method-call is NOT a def-kill of the initializer; the
// base-object reference is still used. Removing `const q = []` breaks `return`.
// Spec waste K: "다중 사용처에서의 평가 횟수/순서 보존".
export function f(): unknown {
  const q: number[][] = [];

  q[0] = [1];

  return q.shift();
}
