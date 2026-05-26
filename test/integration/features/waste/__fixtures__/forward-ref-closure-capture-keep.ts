// KEEP boundary: a module-level helper const declared AFTER a function that
// calls it (forward reference). The capturing closure's CFG entry precedes the
// helper's def, so reaching-defs alone misses the capture; isDefClosureCaptured
// additionally treats a def live at scope exit + captured by any nested function
// as captured (closures run after scope init). `helper` is used → KEEP.
const callerEarly = (): number => helper();

const helper = (): number => 1;

export function f(): number {
  return callerEarly();
}
