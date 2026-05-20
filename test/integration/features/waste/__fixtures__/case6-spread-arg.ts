// case 6 KEEP boundary: spread argument invokes iterator protocol.
// `c.push(...arr)` calls `arr[Symbol.iterator]()` and `.next()` repeatedly — user-
// defined iterables can attach arbitrary side-effects. Dropping the push would
// erase those iterator calls, violating "side-effect 횟수·순서 보존".
// `SpreadElement` is in IMPURE_NODE_TYPES.

export function f(arr: number[]): void {
  const c: number[] = [];

  c.push(...arr);
}
