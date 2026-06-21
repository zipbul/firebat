import type { Gildash } from '@zipbul/gildash';

import { describe, expect, it } from 'bun:test';

import { analyzeErrorFlow } from '../../../../src/test-api';
import { createProgramFromMap } from '../../shared/test-kit';

const noopGildash = {
  isThenableAtSpan: () => null,
  getExpressionTypeAtSpan: () => null,
  getContextualCallReturnsAtSpan: () => null,
} as unknown as Gildash;

const analyze = (filePath: string, source: string) => {
  const sources = new Map<string, string>([[filePath, source]]);
  const program = createProgramFromMap(sources);

  return analyzeErrorFlow(program, { gildash: noopGildash });
};

const countKind = (filePath: string, source: string, kind: string): number =>
  analyze(filePath, source).filter(f => f.kind === kind).length;

interface KindCountCase {
  readonly name: string;
  readonly filePath: string;
  readonly source: string;
  readonly kind: string;
  readonly count: number;
}

interface EmptyAnalysisCase {
  readonly name: string;
  readonly filePath: string;
  readonly source: string;
}

const lines = (...parts: string[]): string => parts.join('\n');

describe('integration/error-flow', () => {
  it('should return no findings when input is empty', () => {
    const program = createProgramFromMap(new Map<string, string>());

    expect(analyzeErrorFlow(program, { gildash: noopGildash }).length).toBe(0);
  });

  const kindCountCases: KindCountCase[] = [
    {
      name: 'should report floating-promises when a promise-like expression statement is unobserved',
      filePath: '/virtual/src/features/floating.ts',
      source: lines('export function f() {', '  Promise.resolve(1);', '}'),
      kind: 'floating-promises',
      count: 1,
    },
    {
      name: 'should report floating-promises when Promise.reject is unobserved',
      filePath: '/virtual/src/features/floating-reject.ts',
      source: lines('export function f() {', '  Promise.reject(new Error("x"));', '}'),
      kind: 'floating-promises',
      count: 1,
    },
    {
      name: 'should report floating-promises when Promise.all is unobserved',
      filePath: '/virtual/src/features/floating-all.ts',
      source: lines('export function f() {', '  Promise.all([Promise.resolve(1)]);', '}'),
      kind: 'floating-promises',
      count: 1,
    },
    {
      name: 'should report floating-promises when new Promise is unobserved',
      filePath: '/virtual/src/features/floating-new-promise.ts',
      source: lines('export function f() {', '  new Promise(resolve => resolve(1));', '}'),
      kind: 'floating-promises',
      count: 1,
    },
    {
      name: 'should not report floating-promises when promise is explicitly ignored with void',
      filePath: '/virtual/src/features/floating-ok.ts',
      source: lines('export function f() {', '  void Promise.resolve(1);', '}'),
      kind: 'floating-promises',
      count: 0,
    },
    {
      name: 'should not report floating-promises when promise is returned',
      filePath: '/virtual/src/features/floating-returned.ts',
      source: lines('export function f() {', '  return Promise.resolve(1);', '}'),
      kind: 'floating-promises',
      count: 0,
    },
    {
      name: 'should not report floating-promises when promise is awaited',
      filePath: '/virtual/src/features/floating-awaited.ts',
      source: lines('export async function f() {', '  await Promise.resolve(1);', '}'),
      kind: 'floating-promises',
      count: 0,
    },
    {
      name: 'should not report floating-promises when promise has catch handler',
      filePath: '/virtual/src/features/floating-caught.ts',
      source: lines('export function f() {', '  Promise.resolve(1).catch(() => 0);', '}'),
      kind: 'floating-promises',
      count: 0,
    },
    {
      name: 'should report misused-promises when an async callback is passed to forEach',
      filePath: '/virtual/src/features/misused.ts',
      source: lines(
        'export async function doThing(value: number) {',
        '  return value + 1;',
        '}',
        '',
        'export function f() {',
        '  [1, 2, 3].forEach(async value => {',
        '    await doThing(value);',
        '  });',
        '}',
      ),
      kind: 'misused-promises',
      count: 1,
    },
    {
      // map returns the promises, and the array is returned to the caller, so the rejections are
      // observable. map is in the result-returning group: W only when discarded.
      name: 'should not report misused-promises when an async map result is returned (K: rejections propagate)',
      filePath: '/virtual/src/features/misused-map.ts',
      source: lines(
        'export async function doThing(value: number) {',
        '  return value + 1;',
        '}',
        '',
        'export function f() {',
        '  return [1, 2, 3].map(async value => {',
        '    return await doThing(value);',
        '  });',
        '}',
      ),
      kind: 'misused-promises',
      count: 0,
    },
    {
      name: 'should report misused-promises when an async callback is passed to filter',
      filePath: '/virtual/src/features/misused-filter.ts',
      source: lines(
        'export async function isGood(value: number) {',
        '  return value > 0;',
        '}',
        '',
        'export function f() {',
        '  return [1, 2, 3].filter(async value => {',
        '    return await isGood(value);',
        '  });',
        '}',
      ),
      kind: 'misused-promises',
      count: 1,
    },
    {
      name: 'should not report misused-promises when a sync wrapper is used',
      filePath: '/virtual/src/features/misused-ok.ts',
      source: lines(
        'export async function doThing(value: number) {',
        '  return value + 1;',
        '}',
        '',
        'export function f() {',
        '  [1, 2, 3].forEach(value => {',
        '    void doThing(value);',
        '  });',
        '}',
      ),
      kind: 'misused-promises',
      count: 0,
    },
    {
      name: 'should report throw-non-error when throwing a non-Error value',
      filePath: '/virtual/src/features/throw-non-error.ts',
      source: lines('export function f() {', '  throw "boom";', '}'),
      kind: 'throw-non-error',
      count: 1,
    },
    {
      name: 'should not report throw-non-error when throwing an identifier',
      filePath: '/virtual/src/features/throw-non-error-ok.ts',
      source: lines('export function f(err: unknown) {', '  throw err;', '}'),
      kind: 'throw-non-error',
      count: 0,
    },
    {
      name: 'should report promise-constructor-hygiene when Promise executor is async',
      filePath: '/virtual/src/features/async-promise-executor.ts',
      source: lines('export function f() {', '  return new Promise(async resolve => {', '    resolve(1);', '  });', '}'),
      kind: 'promise-constructor-hygiene',
      count: 1,
    },
    {
      name: 'should not report misused-promises when callback is sync',
      filePath: '/virtual/src/features/misused-sync.ts',
      source: lines('export function f() {', '  [1, 2, 3].forEach(value => {', '    console.log(value);', '  });', '}'),
      kind: 'misused-promises',
      count: 0,
    },
    {
      // import() is syntactically always a Promise, so it is flagged without gildash.
      name: 'should report return-await-in-try when import() is returned without await in try with catch',
      filePath: '/virtual/src/features/return-no-await.ts',
      source: lines(
        'export async function f() {',
        '  try {',
        '    return import("./mod");',
        '  } catch (e) {',
        '    handleError(e);',
        '  }',
        '}',
      ),
      kind: 'return-await-in-try',
      count: 1,
    },
    {
      name: 'should not report return-await-in-try when return uses await in try with catch',
      filePath: '/virtual/src/features/return-with-await.ts',
      source: lines(
        'export async function f() {',
        '  try {',
        '    return await fetchData();',
        '  } catch (e) {',
        '    handleError(e);',
        '  }',
        '}',
      ),
      kind: 'return-await-in-try',
      count: 0,
    },
    {
      name: 'should not report return-await-in-try when return is outside try block',
      filePath: '/virtual/src/features/return-outside-try.ts',
      source: lines('export async function f() {', '  return fetchData();', '}'),
      kind: 'return-await-in-try',
      count: 0,
    },
    {
      name: 'should not report return-await-in-try for literal return in try block',
      filePath: '/virtual/src/features/return-literal-try.ts',
      source: lines('export function f() {', '  try {', '    return "ok";', '  } catch (e) {', '    return "error";', '  }', '}'),
      kind: 'return-await-in-try',
      count: 0,
    },
    {
      // inner arrow's return is NOT inside its own try/catch, so should not be flagged
      name: 'should not report return-await-in-try in nested function even if outer has try/catch',
      filePath: '/virtual/src/features/return-nested-fn.ts',
      source: lines(
        'export async function outer() {',
        '  try {',
        '    const inner = async () => {',
        '      return fetchData();',
        '    };',
        '    return await inner();',
        '  } catch (e) {',
        '    throw e;',
        '  }',
        '}',
      ),
      kind: 'return-await-in-try',
      count: 0,
    },
    {
      name: 'should report missing-error-cause when catch throws a new Error without { cause }',
      filePath: '/virtual/src/features/transform-bad.ts',
      source: lines(
        'export function f() {',
        '  try {',
        '    throw new Error("x");',
        '  } catch (e) {',
        '    throw new Error("wrap");',
        '  }',
        '}',
      ),
      kind: 'missing-error-cause',
      count: 1,
    },
    {
      name: 'should not report missing-error-cause when cause is preserved',
      filePath: '/virtual/src/features/transform-ok-cause.ts',
      source: lines(
        'export function f() {',
        '  try {',
        '    throw new Error("x");',
        '  } catch (e) {',
        '    throw new Error("wrap", { cause: e });',
        '  }',
        '}',
      ),
      kind: 'missing-error-cause',
      count: 0,
    },
    {
      // WrapError is a custom class; only an Error subtype loses a cause by wrapping. Degraded gildash
      // cannot prove the subtype, so the rule stays conservatively silent (no FP on a non-Error class).
      // The real-typed positive is covered in missing-error-cause-custom.test.ts.
      name: 'does not report missing-error-cause for a custom (non-built-in) constructor without semantic info',
      filePath: '/virtual/src/features/transform-custom.ts',
      source: lines(
        'export function f() {',
        '  try {',
        '    throw new Error("x");',
        '  } catch (e) {',
        '    throw new WrapError("wrap");',
        '  }',
        '}',
      ),
      kind: 'missing-error-cause',
      count: 0,
    },
  ];

  it.each(kindCountCases)('$name', ({ filePath, source, kind, count }) => {
    expect(countKind(filePath, source, kind)).toBe(count);
  });

  // The two nested-rethrow constructs produce no error-flow finding at all (out of scope:
  // redundancy is lint's domain), so the WHOLE analysis must be empty.
  const emptyAnalysisCases: EmptyAnalysisCase[] = [
    {
      name: 'should not report useless-catch for nested bare rethrows (out of scope: redundancy)',
      filePath: '/virtual/src/features/nested-redundant.ts',
      source: lines(
        'export function f() {',
        '  try {',
        '    try {',
        '      throw new Error("x");',
        '    } catch (e) {',
        '      throw e;',
        '    }',
        '  } catch (outer) {',
        '    throw outer;',
        '  }',
        '}',
      ),
    },
    {
      name: 'should not report useless-catch for a rethrow inside try/finally (out of scope: redundancy)',
      filePath: '/virtual/src/features/nested-ok-no-outer.ts',
      source: lines(
        'export function f() {',
        '  try {',
        '    try {',
        '      throw new Error("x");',
        '    } catch (e) {',
        '      throw e;',
        '    }',
        '  } finally {',
        '    void 0;',
        '  }',
        '}',
      ),
    },
  ];

  it.each(emptyAnalysisCases)('$name', ({ filePath, source }) => {
    expect(analyze(filePath, source).length).toBe(0);
  });
});
