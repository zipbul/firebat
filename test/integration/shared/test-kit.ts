import type { Gildash } from '@zipbul/gildash';

import { expect } from 'bun:test';
import * as fsp from 'node:fs/promises';

import type { ParsedFile } from '../../../src/test-api';
import type { DuplicateGroup, WasteFinding } from '../../../src/test-api';

import { detectWaste, parseSource } from '../../../src/test-api';

// ---------------------------------------------------------------------------
// Gildash mock fixtures — shared by the inputs-digest specs.
// ---------------------------------------------------------------------------

/** Build a synthetic `FileRecord` for a `getFileInfo` stub. */
export const makeFileRecord = (filePath: string, contentHash = 'abc123') => ({
  project: 'test',
  filePath,
  mtimeMs: 1000,
  size: 100,
  contentHash,
  updatedAt: new Date().toISOString(),
});

/** Wrap a `getFileInfo` impl into a minimal `Gildash` stub. */
export const makeGildash = (getFileInfoImpl: (filePath: string) => ReturnType<Gildash['getFileInfo']>): Gildash =>
  ({
    getFileInfo: getFileInfoImpl,
  }) as unknown as Gildash;

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

/** A `batchParse` gildash stub that resolves to an empty parse result. */
export const emptyBatchParse = async (_filePaths: string[]): Promise<{ parsed: Map<string, unknown>; failures: unknown[] }> => ({
  parsed: new Map(),
  failures: [],
});

/** Parse `source` under `/virtual/test.ts` and wrap it in a single-file program. */
export const parseProgram = (source: string): ParsedFile[] => [parseSource('/virtual/test.ts', source)];

/** Parse `sourceText` under `filePath` and wrap it in a single-file program. */
export const parseProgramAs = (filePath: string, sourceText: string): ParsedFile[] => [parseSource(filePath, sourceText)];

/** Parse `src` and return the first top-level program-body node, cast to `T`. */
export const firstBodyNode = <T>(src: string): T => (parseSource('test.ts', src).program as { body: unknown[] }).body[0] as T;

/** Assert `arr` has exactly `count` elements and return it (lets callers keep asserting on it). */
export const expectLength = <T>(arr: ReadonlyArray<T>, count: number): ReadonlyArray<T> => {
  expect(arr.length).toBe(count);

  return arr;
};

/** Assert a scan-style result has total 1 and a single finding. */
export const expectTotalOne = (result: { readonly total: number; readonly findings: { readonly length: number } }): void => {
  expect(result.total).toBe(1);
  expect(result.findings).toHaveLength(1);
};

/** Assert `arr` is non-empty and return its first element. */
export const firstNonEmpty = <T>(arr: ReadonlyArray<T>): T => {
  expect(arr.length).toBeGreaterThanOrEqual(1);

  return arr[0]!;
};

/** Assert a dependency result has empty fan-in and fan-out lists. */
export const expectNoFanInOut = (result: { readonly fanIn: { length: number }; readonly fanOut: { length: number } }): void => {
  expect(result.fanIn.length).toBe(0);
  expect(result.fanOut.length).toBe(0);
};

/** Assert `item.span` exists and its start/end line numbers are `number`s. */
export const expectSpanShape = (item: {
  readonly span: { readonly start: { readonly line: unknown }; readonly end: { readonly line: unknown } };
}): void => {
  expect(item.span).toBeDefined();
  expect(typeof item.span.start.line).toBe('number');
  expect(typeof item.span.end.line).toBe('number');
};

/** Parse `relPath` under `/p/` and attach a synthetic parse error — shared by analyzer specs. */
export const parsePFileWithErrors = (relPath: string, sourceText: string): ParsedFile =>
  ({ ...parsePFile(relPath, sourceText), errors: [{ message: 'synthetic' }] }) as unknown as ParsedFile;

/**
 * Parse `source` into a single-file program and run `analyze` over it.
 *
 * Collapses the repeated `parse(source)` + `analyze(files)` preamble that every
 * single-source detector spec otherwise re-states verbatim.
 */
export const analyzeSource = <T>(source: string, analyze: (files: ParsedFile[]) => T): T => analyze(parseProgram(source));

/** Analyze `source` with `analyze` and assert it produces no findings (empty array). */
export const expectNoFindings = (source: string, analyze: (files: ParsedFile[]) => ReadonlyArray<unknown>): void => {
  expect(analyzeSource(source, analyze)).toEqual([]);
};

/** Analyze `source`, assert exactly one finding of `kind`, and return the findings. */
export const expectSingleFindingKind = <T extends { readonly kind: string }>(
  source: string,
  analyze: (files: ParsedFile[]) => ReadonlyArray<T>,
  kind: string,
): ReadonlyArray<T> => {
  const result = analyzeSource(source, analyze);

  expect(result).toHaveLength(1);
  expect(result[0]!.kind).toBe(kind);

  return result;
};

/** Recursively remove a temp dir (force, no-throw-on-missing) — shared teardown helper. */
export const rmrf = (dir: string): Promise<void> => fsp.rm(dir, { recursive: true, force: true });

/** Restore a spy and close a db handle — shared store-spec teardown. */
export const restoreAndClose = (spy: { mockRestore: () => void }, db: { close: () => void }): void => {
  spy.mockRestore();
  db.close();
};

/** A named source-snippet test case: `{ name, source }` — the common table-case shape. */
export interface SourceCase {
  readonly name: string;
  readonly source: string;
}

/** A single-line `SourceSpan` (`line`→`line+1`) — shared by the report/flatten specs. */
export const span = (line = 1, col = 0) => ({
  start: { line, column: col },
  end: { line: line + 1, column: 0 },
});

/** Assert `value` is a non-empty string — the `typeof===string` + `.length>0` idiom. */
export const expectNonEmptyString = (value: unknown): void => {
  expect(typeof value).toBe('string');
  expect((value as string).length).toBeGreaterThan(0);
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

/** Re-run waste detection on `program` and assert the normalized signatures equal `first` (determinism). */
export const expectWasteDeterministic = (program: ParsedFile[], first: string[]): void => {
  expect(toWasteSignatures(detectWaste(program))).toEqual(first);
};
