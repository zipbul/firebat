import { describe, expect, it } from 'bun:test';

import { parseSource } from './ast/parse-source';

/**
 * Golden contract for the duplicates min-size floor (REDESIGN).
 *
 * The floor MUST be corpus-INDEPENDENT: whether two units are a clone is a closed
 * property of those two units, never a function of the rest of the repository. The
 * previous implementation set the floor to a PERCENTILE of the corpus's declaration
 * sizes, which made the same pair's verdict depend on unrelated files — breaking
 * firebat's closed/corpus-independent identity and making the reported clone count
 * non-monotonic (removing code lowered the floor and surfaced previously-hidden
 * clones). See memory: project-duplicates-auto-minsize-design-flaw.
 *
 * These tests encode the target contract and FAIL against the corpus-relative
 * implementation (TDD red). They pass once the floor is a fixed constant.
 */

// ── Fixtures: two corpora that differ ONLY in unrelated surrounding code ────────

const TWO_TINY_DECLS = `
function a(): number { return 1; }
function b(): number { return 2; }
`;

const oneBigFn = (n: number): string => `
function big${n}(xs: number[]): number {
  let total = 0;
  for (const x of xs) {
    if (x > 0) {
      total += x * 2;
    } else {
      total -= x;
    }
  }
  const avg = total / xs.length;
  return avg > 10 ? total : avg;
}
`;

// Many large declarations — under a percentile floor this drags the corpus median
// far above the size of any small clone, hiding it. Under a fixed floor it is inert.
const MANY_BIG_DECLS = Array.from({ length: 40 }, (_unused, i) => oneBigFn(i)).join('\n');
const small = [parseSource('/p/small.ts', TWO_TINY_DECLS)];
const big = [parseSource('/p/big.ts', `${TWO_TINY_DECLS}\n${MANY_BIG_DECLS}`)];

describe('duplicates min-size floor — corpus independence', () => {
  it('resolves the SAME floor regardless of surrounding unrelated code', async () => {
    const { computeAutoMinSize } = await import('./auto-min-size');

    // The core invariant: adding 40 large unrelated declarations must not move the floor.
    expect(computeAutoMinSize(big)).toBe(computeAutoMinSize(small));
  });

  it('resolves a floor that does not depend on corpus size at all', async () => {
    const { computeAutoMinSize } = await import('./auto-min-size');
    const empty = computeAutoMinSize([]);
    const one = computeAutoMinSize(small);
    const many = computeAutoMinSize(big);

    // All three identical — the floor is a fixed policy constant, not a statistic.
    expect(one).toBe(empty);
    expect(many).toBe(empty);
  });

  it('equals the documented policy constant', async () => {
    const mod = (await import('./auto-min-size')) as {
      computeAutoMinSize: (f: unknown[]) => number;
      DUPLICATES_MIN_SIZE: number;
    };

    expect(typeof mod.DUPLICATES_MIN_SIZE).toBe('number');
    expect(mod.computeAutoMinSize(small)).toBe(mod.DUPLICATES_MIN_SIZE);
  });

  it('is deterministic across repeated calls on the same input', async () => {
    const { computeAutoMinSize } = await import('./auto-min-size');

    expect(computeAutoMinSize(small)).toBe(computeAutoMinSize(small));
  });
});
