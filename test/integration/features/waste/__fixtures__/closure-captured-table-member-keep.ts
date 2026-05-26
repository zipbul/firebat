// KEEP boundary: a module helper referenced only inside a table that is read
// from a function (closure capture). The dead-use fixpoint must not eliminate
// the table's read of the helper, nor treat the closure-captured table as a
// dead store.
const helper = (n: number): number => n + 1;

const TABLE: Record<string, (n: number) => number> = {
  inc: helper,
};

export function pick(key: string, n: number): number {
  const fn = TABLE[key] ?? ((x: number) => x);

  return fn(n);
}
