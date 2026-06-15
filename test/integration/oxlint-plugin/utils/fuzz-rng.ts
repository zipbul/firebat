import type { AstNode } from '../../../../src/test-api';

interface Rng {
  nextU32(): number;
  int(min: number, maxInclusive: number): number;
  bool(pTrue: number): boolean;
  pick<T>(items: readonly T[]): T;
}

const mulberry32 = (seed: number): Rng => {
  let t = seed >>> 0;

  const nextU32 = (): number => {
    t += 0x6d2b79f5;

    const x1 = Math.imul(t ^ (t >>> 15), t | 1);
    const x2 = x1 ^ (x1 + Math.imul(x1 ^ (x1 >>> 7), x1 | 61));

    return (x2 ^ (x2 >>> 14)) >>> 0;
  };

  return {
    nextU32,
    int(min: number, maxInclusive: number): number {
      if (maxInclusive < min) {
        throw new Error('invalid int range');
      }

      return min + (nextU32() % (maxInclusive - min + 1));
    },
    bool(pTrue: number): boolean {
      const threshold = Math.max(0, Math.min(1, pTrue));
      const x = nextU32() / 0x1_0000_0000;

      return x < threshold;
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) {
        throw new Error('cannot pick from empty list');
      }

      const index = nextU32() % items.length;
      const item = items[index];

      if (item === undefined) {
        throw new Error('cannot pick from empty list');
      }

      return item;
    },
  };
};

const makeIdentifier = (rng: Rng, minLen = 1, maxLen = 10): string => {
  const firstChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$';
  const len = rng.int(minLen, maxLen);
  let out = rng.pick(firstChars.split(''));

  for (let i = 1; i < len; i += 1) {
    out += rng.pick((firstChars + '0123456789').split(''));
  }

  return out;
};

const makeUnsafeKey = (rng: Rng): string => {
  const parts = ['not-valid', 'with space', 'kebab-case', 'has.dot', '0starts', 'x-y', 'a:b'];
  const base = rng.pick(parts);

  if (rng.bool(0.5)) {
    return `${base}-${rng.int(0, 9)}`;
  }

  return base;
};

const whitespace = (rng: Rng): string => rng.pick(['', ' ', '  ', '\t']);

const newline = (rng: Rng): string => (rng.bool(0.5) ? '\n' : '\r\n');

const buildUniqueIdentifiers = (rng: Rng, count: number): string[] => {
  const names: string[] = [];

  while (names.length < count) {
    const candidate = makeIdentifier(rng, 1, 8);

    if (!names.includes(candidate)) {
      names.push(candidate);
    }
  }

  return names;
};

const getRange = (node: AstNode | null | undefined): [number, number] | null => {
  if (!node || !Array.isArray(node.range) || node.range.length !== 2) {
    return null;
  }

  const start = node.range[0];
  const end = node.range[1];

  if (typeof start !== 'number' || typeof end !== 'number') {
    return null;
  }

  return [start, end];
};

export type { Rng };
export { buildUniqueIdentifiers, getRange, makeIdentifier, makeUnsafeKey, mulberry32, newline, whitespace };
