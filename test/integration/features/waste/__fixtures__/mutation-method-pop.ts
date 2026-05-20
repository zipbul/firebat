// case 6 (DEAD): non-`push` Array mutator. pop / shift / unshift / splice / sort /
// reverse / fill / copyWithin are all in-place mutators with no externally observable
// effect when the receiver is a fresh allocation. Same safety claim as push.

export function f(): void {
  const c: number[] = [1, 2, 3];

  c.pop();
}
