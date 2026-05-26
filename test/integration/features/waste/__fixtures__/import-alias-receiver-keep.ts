// KEEP boundary: `c` aliases an imported binding, not a fresh allocation, so
// `c.push(1)` mutates a shared external reference — observable. gildash
// standalone omits the import's binding identity, but the detector still
// correctly KEEPs because case 6/7 requires a fresh local allocation
// (ArrayExpression/ObjectExpression/...), which `def` is not.
import { def } from './other-module';

export function f(): void {
  const c = def;

  c.push(1);
}
