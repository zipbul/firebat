// DEAD (Phase2): single-use `.prop` read, nothing between decl and use. The
// getter (if any) fires once at the same point → inlining preserves behavior.
export function f(obj: { prop: string }): string {
  const v = obj.prop;
  return v + '!';
}
