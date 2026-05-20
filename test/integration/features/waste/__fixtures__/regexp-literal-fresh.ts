// case 7 boundary (DEAD): RegExp literal is a fresh allocation.
// `/foo/g` is a brand-new RegExp object each time it's evaluated; assigning
// `r.lastIndex = 0` mutates only that local instance. unwrapValueWrappers /
// fresh-allocation check accepts `Literal` nodes whose `regex` payload is set.

export function f(): void {
  const r = /foo/g;

  r.lastIndex = 0;
}
