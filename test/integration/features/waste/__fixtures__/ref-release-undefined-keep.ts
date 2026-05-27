// KEEP (FP-A): `x = undefined` releases a reference for GC. The value escaped
// via sink(); clearing it is lifetime management (CLAUDE.md K "자원 핸들 lifetime").
function sink(_v: object): void {}
export function f(): number {
  let x: object | undefined = { big: 1 };
  sink(x);
  x = undefined;
  return 0;
}
