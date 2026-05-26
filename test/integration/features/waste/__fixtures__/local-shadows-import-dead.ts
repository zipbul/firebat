// DEAD (case 1): a local binding that shadows an imported name is a distinct
// binding. gildash standalone resolution gives it its own `tsc:<declPos>` key,
// so the dead-store on the local `x` is detected independently of the import.
// (Standalone omits the imported binding's identity, which is irrelevant here.)
import { x } from './other-module';

export function f(): number {
  let x = 1;
  x = 2;

  return x + 0;
}

void x;
