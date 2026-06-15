import type { ParsedFile } from '../../../src/test-api';
import type { DuplicateGroup, WasteFinding } from '../../../src/test-api';

import { parseSource } from '../../../src/test-api';

export const getFuzzSeed = (): number => {
  const envSeed = process.env.FUZZ_SEED;

  if (envSeed !== undefined && envSeed.length > 0) {
    const parsed = Number(envSeed);

    if (Number.isFinite(parsed) && parsed !== 0) {
      return parsed | 0;
    }
  }

  return 1;
};

export const getFuzzIterations = (fallback: number): number => {
  const envIter = process.env.FUZZ_ITERATIONS;

  if (envIter !== undefined && envIter.length > 0) {
    const parsed = Number(envIter);

    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed | 0;
    }
  }

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
  // parseSource fires the preload-installed hook, which notifies each source
  // to the gildash semantic layer (notify-only; the binding query + tsc
  // rebuild is deferred to the first buildDeclScopeMap call). No explicit
  // registration needed here.
  const files: ParsedFile[] = [];

  for (const [filePath, sourceText] of sources.entries()) {
    files.push(parseSource(filePath, sourceText));
  }

  return files;
};

// ---------------------------------------------------------------------------
// parseSource wrappers — re-declared identically across many feature specs.
// Hoisted here so the parse-fixture shape lives in one place.
// ---------------------------------------------------------------------------

/** Parse `sourceText` under a `/p/<relPath>` virtual path. */
export const parsePFile = (relPath: string, sourceText: string): ParsedFile => parseSource(`/p/${relPath}`, sourceText);

/** Parse `code` under the given path, asserting the `ParsedFile` shape. */
export const parseFileAs = (filePath: string, code: string): ParsedFile => parseSource(filePath, code) as ParsedFile;

/** Parse `source` under `/virtual/test.ts` and wrap it in a single-file program. */
export const parseProgram = (source: string): ParsedFile[] => [parseSource('/virtual/test.ts', source)];

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
