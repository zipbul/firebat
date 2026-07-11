// K: `q.push(1)`'s result (the new length) is RETURNED, so it observes q's state — removing `q`
// would change the returned value. Every consumed array-mutator result leaks the receiver (length
// for push/unshift, content for pop/shift/splice, identity for sort/…), so `q` is live, not a
// dead-store. Only a DISCARDED mutation (`q.push(1);` as a statement) is a dead store.
export function pushLen(): number {
  const q: number[] = [];

  return q.push(1);
}
