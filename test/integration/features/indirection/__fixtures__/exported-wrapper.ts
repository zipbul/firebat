// K — exported single-delegation wrappers are cross-module: their uses escape the
// file, so the reference-identity gate cannot close. Export status is read from
// the AST (robust even when gildash's project index is partial).
function core(x: number): number { return x; }

export function exportedFn(x: number): number {
  return core(x);
}

export const exportedConst = (x: number): number => core(x);
