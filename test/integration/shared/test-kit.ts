import type { ParsedFile } from '../../../src/engine/types';
import type { DuplicateGroup, WasteFinding } from '../../../src/types';

import { parseSource } from '../../../src/engine/parse-source';

export const getFuzzSeed = (): number => {
  return 1;
};

export const getFuzzIterations = (fallback: number): number => {
  return fallback;
};

export const createPrng = (seed: number) => {
  // xorshift32 produces an infinite-zero sequence for seed=0 (0 is a fixed
  // point of the algorithm). Guard against it by mapping 0 → 1.
  let state = seed === 0 ? 1 : (seed | 0) >>> 0;

  const nextU32 = (): number => {
    // xorshift32
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state >>>= 0;
    state ^= state << 5;
    state >>>= 0;

    return state;
  };

  const nextInt = (maxExclusive: number): number => {
    if (maxExclusive <= 0) {
      return 0;
    }

    return nextU32() % maxExclusive;
  };

  const nextBool = (): boolean => {
    return (nextU32() & 1) === 1;
  };

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) {
      throw new Error('Expected non-empty items');
    }

    const index = nextInt(items.length);
    const item = items[index];

    if (item === undefined) {
      throw new Error('Expected item at index');
    }

    return item;
  };

  return {
    nextU32,
    nextInt,
    nextBool,
    pick,
  };
};

export const createProgramFromMap = (sources: Map<string, string>): ParsedFile[] => {
  const files: ParsedFile[] = [];

  for (const [filePath, sourceText] of sources.entries()) {
    files.push(parseSource(filePath, sourceText));
  }

  return files;
};

export const toDuplicateSignatures = (groups: ReadonlyArray<DuplicateGroup>): string[] => {
  const signatures: string[] = [];

  for (const group of groups) {
    const itemKeys = [...group.items].map(item => {
      return `${item.filePath}|${item.kind}|${item.header}|${item.span.start.line}:${item.span.start.column}`;
    });

    itemKeys.sort((left, right) => left.localeCompare(right));

    signatures.push(itemKeys.join(';'));
  }

  signatures.sort((left, right) => left.localeCompare(right));

  return signatures;
};

export const toWasteSignatures = (findings: ReadonlyArray<WasteFinding>): string[] => {
  const keys = [...findings].map(finding => {
    return `${finding.filePath}|${finding.kind}|${finding.label}`;
  });

  keys.sort((left, right) => left.localeCompare(right));

  return keys;
};
