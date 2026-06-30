// K — a self-recursive wrapper forwards to itself; there is no underlying layer
// to inline away (removing it breaks the self-reference). Not indirection.
const boom = (): unknown => boom();
boom();

function loop(x: number): number {
  return loop(x);
}
loop(1);
