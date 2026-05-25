import * as path from 'node:path';

import type { ParsedFile } from '../../../src/test-api';
import type { DuplicateGroup, WasteFinding } from '../../../src/test-api';

import { parseSource } from '../../../src/test-api';
import { registerVirtualSourcesBatch } from '../../../src/engine/dataflow/gildash-binding-source';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const AD_HOC_DIR = path.join(PROJECT_ROOT, '.firebat-test-tmp');

// Deterministic mapping virtualPath → adHoc disk path. Same virtualPath
// always maps to the same target so repeated calls (e.g. fuzz iterations
// that reuse a path with different content) replace the in-memory file in
// tsc Program rather than accumulating new ones.
const adHocPathFor = (virtualPath: string): string => {
  const safe = virtualPath.replace(/[^A-Za-z0-9._-]+/g, '_');

  return path.join(AD_HOC_DIR, safe);
};

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
  // Batch-register all entries with the gildash semantic layer in one tsc
  // Program rebuild (per gildash 0.31 release notes: 10× faster than
  // per-file notify+query interleaving).
  const entries: Array<{ virtualPath: string; targetPath: string; content: string }> = [];

  for (const [virtualPath, content] of sources.entries()) {
    entries.push({ virtualPath, targetPath: adHocPathFor(virtualPath), content });
  }

  registerVirtualSourcesBatch(entries);

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
