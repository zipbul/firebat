import type { Gildash } from '@zipbul/gildash';

import { describe, expect, it } from 'bun:test';

import type { ErrorFlowFindingKind } from './types';

import { parseSource } from '../../engine/ast/parse-source';
import { analyzeErrorFlow } from './analyzer';

const noopGildash = {
  isThenableAtSpan: () => null,
  getExpressionTypeAtSpan: () => null,
  getContextualCallReturnsAtSpan: () => null,
} as unknown as Gildash;

type IsThenableAtSpan = (
  filePath: string,
  span: { start: number; end: number },
  options?: { anyConstituent?: boolean },
) => boolean | null;

const analyzeSingle = async (filePath: string, sourceText: string) => {
  // Arrange
  const program = [parseSource(filePath, sourceText)];
  // Act
  const findings = analyzeErrorFlow(program, { gildash: noopGildash });

  // Assert (shape)
  expect(Array.isArray(findings)).toBe(true);

  return findings;
};

// The error-flow detector reaches gildash only through the TypeOracle, whose sole thenable seam is
// `isThenableAtSpan(filePath, span, { anyConstituent })`. These unit tests stub that seam directly:
// `mockIsThenableAtSpan` decides, for any queried expression span, whether the value is a thenable
// (`true`), provably not (`false`), or unresolvable (`null` → treated conservatively as not).
const analyzeWithSemantic = async (filePath: string, sourceText: string, mockIsThenableAtSpan: IsThenableAtSpan) => {
  const program = [parseSource(filePath, sourceText)];
  const gildash = {
    isThenableAtSpan: mockIsThenableAtSpan,
    getExpressionTypeAtSpan: () => null,
    getContextualCallReturnsAtSpan: () => null,
  } as unknown as Gildash;

  return analyzeErrorFlow(program, { gildash });
};

type Findings = Awaited<ReturnType<typeof analyzeSingle>>;

const SYNC_HELPER_SRC = ['export function f() {', '  const x = syncHelper();', '  console.log("done");', '}'].join('\n');

/** Single-file program for the `syncHelper()` conservative-fallback scenarios. */
const syncHelperProgram = (filePath: string) => [parseSource(filePath, SYNC_HELPER_SRC)];

/** Assert `program` yields no `unobserved-variable` finding under `options`. */
const expectNoUnobserved = (
  program: ReturnType<typeof syncHelperProgram>,
  options?: Parameters<typeof analyzeErrorFlow>[1],
): void => {
  const hits = analyzeErrorFlow(program, options).filter(f => f.kind === 'unobserved-variable');

  expect(hits.length).toBe(0);
};

const kinds = (findings: Findings) => findings.map(f => f.kind);

const countKind = (findings: Findings, kind: ErrorFlowFindingKind) => findings.filter(f => f.kind === kind).length;

// Shared runners for the data-driven tables: parse → analyze (with the noop or a mock gildash) →
// assert the count of one finding kind. Each table supplies only the rows that differ.
const expectKindCount = async (source: string, kind: ErrorFlowFindingKind, expected: number) => {
  const analysis = await analyzeSingle('/virtual/src/features/case.ts', source);

  expect(countKind(analysis, kind)).toBe(expected);
};

const expectSemanticKindCount = async (source: string, mock: IsThenableAtSpan, kind: ErrorFlowFindingKind, expected: number) => {
  const analysis = await analyzeWithSemantic('/virtual/src/features/semantic-case.ts', source, mock);

  expect(countKind(analysis, kind)).toBe(expected);
};

describe('error-flow/analyzer', () => {
  it('should return no findings when input is empty', async () => {
    // Arrange
    const program: ReturnType<typeof parseSource>[] = [];
    // Act
    const findings = analyzeErrorFlow(program, { gildash: noopGildash });

    // Assert
    expect(findings.length).toBe(0);
  });

  it('should not include natural-language fields in findings', async () => {
    // Arrange
    const filePath = '/virtual/src/adapters/cli/entry.ts';
    const source = [
      'export function f() {',
      '  Promise.resolve(1).then(() => 1);',
      '}',
    ].join('\n');
    // Act
    const findings = await analyzeSingle(filePath, source);

    // Assert
    expect(findings.length).toBe(1);

    const first = findings[0]!;

    expect(first.evidence.length).toBeGreaterThan(0);
    expect(first.file.length).toBeGreaterThan(0);
    expect(first.span.start.line).toBeGreaterThanOrEqual(1);
    expect(first.span.end.line).toBeGreaterThanOrEqual(first.span.start.line);

    const sample = findings[0] as unknown as Record<string, unknown>;

    expect(sample.filePath).toBeUndefined();
    expect(sample.message).toBeUndefined();
    expect(sample.recipes).toBeUndefined();
  });

  // Out-of-scope / control cases: the detector returns no findings at all. Each row keeps its own
  // source so the distinct rationale (redundancy/style/cleanup) is still exercised end to end.
  it.each<[string, string]>([
    [
      'a bare rethrow (out of scope: redundancy)',
      ['export function f() {', '  try {', '    return 1;', '  } catch (e) {', '    throw e;', '  }', '}'].join('\n'),
    ],
    [
      'a bare rethrow under a different name (out of scope: redundancy)',
      ['export function f() {', '  try {', '    return 1;', '  } catch (err) {', '    throw err;', '  }', '}'].join('\n'),
    ],
    [
      'catch logs and rethrows',
      [
        'export function f() {',
        '  try {',
        '    return 1;',
        '  } catch (e) {',
        '    console.error(e);',
        '    throw e;',
        '  }',
        '}',
      ].join('\n'),
    ],
    [
      'catch rethrows a new error with cause',
      [
        'export function f() {',
        '  try {',
        '    return 1;',
        '  } catch (e) {',
        '    throw new Error("wrap", { cause: e });',
        '  }',
        '}',
      ].join('\n'),
    ],
    [
      'catch adds context',
      [
        'export function f() {',
        '  try {',
        '    return 1;',
        '  } catch (e) {',
        '    throw new Error("wrap", { cause: e });',
        '  }',
        '}',
      ].join('\n'),
    ],
    [
      'a second-argument rejection handler (out of scope: style)',
      ['export function f() {', '  return Promise.resolve(1).then(() => 1, () => 0);', '}'].join('\n'),
    ],
    [
      'a downstream catch also exists (rejection fully observed)',
      ['export function f() {', '  return Promise.resolve(1)', '    .then(() => 1, () => 0)', '    .catch(() => -1);', '}'].join(
        '\n',
      ),
    ],
    [
      'catch is used after then',
      ['export function f() {', '  return Promise.resolve(1).then(() => 1).catch(() => 0);', '}'].join('\n'),
    ],
    [
      'a long control-flow then chain (out of scope: style)',
      [
        'export function f() {',
        '  return Promise.resolve(1)',
        '    .then(x => x + 1)',
        '    .then(x => {',
        '      if (x > 1) {',
        '        console.log(x);',
        '      }',
        '      return x;',
        '    });',
        '}',
      ].join('\n'),
    ],
    [
      'a then chain with side effects (out of scope: style)',
      [
        'export function f() {',
        '  return Promise.resolve(1)',
        '    .then(x => x + 1)',
        '    .then(x => {',
        '      console.log(x);',
        '      return x;',
        '    });',
        '}',
      ].join('\n'),
    ],
    ['then is a short value mapping', ['export function f() {', '  return Promise.resolve(1).then(x => x + 1);', '}'].join('\n')],
    [
      'a short chain even if callback uses a block',
      ['export function f() {', '  return Promise.resolve(1).then(x => {', '    return x + 1;', '  });', '}'].join('\n'),
    ],
    [
      'nested bare rethrows (out of scope: redundancy)',
      [
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
      ].join('\n'),
    ],
    [
      'a single bare rethrow (out of scope: redundancy)',
      ['export function f() {', '  try {', '    throw new Error("x");', '  } catch (e) {', '    throw e;', '  }', '}'].join('\n'),
    ],
    [
      'nested try/catch complexity (out of scope: redundancy)',
      [
        'export function f() {',
        '  try {',
        '    try {',
        '      doSomething();',
        '    } catch (inner) {',
        '      handleInner(inner);',
        '    }',
        '  } catch (outer) {',
        '    handleOuter(outer);',
        '  }',
        '}',
      ].join('\n'),
    ],
    [
      'try/finally without catch nested inside a try block',
      [
        'export function f() {',
        '  try {',
        '    try {',
        '      doSomething();',
        '    } finally {',
        '      cleanup();',
        '    }',
        '  } catch (e) {',
        '    handleError(e);',
        '  }',
        '}',
      ].join('\n'),
    ],
    [
      'try/catch in a catch block (cleanup pattern)',
      [
        'export function f() {',
        '  try {',
        '    doSomething();',
        '  } catch (e) {',
        '    try {',
        '      cleanup();',
        '    } catch (inner) {',
        '      console.log(inner);',
        '    }',
        '    throw new Error("failed", { cause: e });',
        '  }',
        '}',
      ].join('\n'),
    ],
    [
      'try/catch inside a function defined in a try block',
      [
        'export function f() {',
        '  try {',
        '    const handler = () => {',
        '      try {',
        '        riskyOp();',
        '      } catch (e) {',
        '        handleError(e);',
        '      }',
        '    };',
        '    handler();',
        '  } catch (e) {',
        '    handleOuter(e);',
        '  }',
        '}',
      ].join('\n'),
    ],
    [
      'Promise.resolve in then expression body (out of scope: style)',
      'export const p = Promise.resolve(1).then(x => Promise.resolve(x + 1));',
    ],
    [
      'Promise.resolve in then block body (out of scope: style)',
      ['export const p = Promise.resolve(1).then(x => {', '  return Promise.resolve(x + 1);', '});'].join('\n'),
    ],
    ['a direct value return in a then callback', 'export const p = Promise.resolve(1).then(x => x + 1);'],
    [
      'a then callback without return (out of scope: style)',
      ['export const p = Promise.resolve(1).then(x => {', '  console.log(x);', '});'].join('\n'),
    ],
    [
      'a then callback that returns a value',
      ['export const p = Promise.resolve(1).then(x => {', '  return x + 1;', '});'].join('\n'),
    ],
    ['a then callback with an expression body', 'export const p = Promise.resolve(1).then(x => console.log(x));'],
    [
      'a return only in an inner function (out of scope: style)',
      ['export const p = Promise.resolve(1).then(x => {', '  const log = () => { return x; };', '  log();', '});'].join('\n'),
    ],
    [
      'Promise.reject wrapping (out of scope: style)',
      'export const p = Promise.resolve(1).then(x => Promise.reject(new Error("fail")));',
    ],
  ])('should report no findings when %s', async (_label, source) => {
    // Act
    const analysis = await analyzeSingle('/virtual/src/features/no-finding.ts', source);

    // Assert
    expect(analysis.length).toBe(0);
  });

  // Findings whose presence is asserted via `kinds(...).toContain(kind)` (other unrelated kinds may
  // co-occur). Each row pairs a triggering source with the kind it must surface.
  it.each<[string, string, ErrorFlowFindingKind]>([
    ['unobserved Promise.resolve', 'export function f() { Promise.resolve(1); }', 'floating-promises'],
    [
      'async callback in forEach',
      'export function f() { [1,2].forEach(async x => { await fetch(String(x)); }); }',
      'misused-promises',
    ],
    ['a string literal throw', 'export function f() { throw "boom"; }', 'throw-non-error'],
    ['a numeric literal throw', 'export function f() { throw 42; }', 'throw-non-error'],
    ['a primitive wrapper call (String)', 'export function f() { throw String("hello"); }', 'throw-non-error'],
    ['an object literal throw', 'export function f() { throw { code: "E_FAIL" }; }', 'throw-non-error'],
    [
      'a string asserted as Error (cast is a runtime lie)',
      'export function f() { throw "boom" as unknown as Error; }',
      'throw-non-error',
    ],
    ['Promise.reject with a non-Error literal', 'export function f() { return Promise.reject("boom"); }', 'throw-non-error'],
    ['an async executor', 'export const p = new Promise(async () => { await fetch("/"); });', 'promise-constructor-hygiene'],
    [
      'a globalThis.Promise async executor',
      'export const p = new globalThis.Promise(async () => { await fetch("/"); });',
      'promise-constructor-hygiene',
    ],
    [
      'a throw after settling',
      ['export const p = new Promise((resolve) => {', '  resolve(42);', '  throw new Error("swallowed");', '});'].join('\n'),
      'promise-constructor-hygiene',
    ],
  ])('should report a finding for %s', async (_label, source, kind) => {
    // Act
    const analysis = await analyzeSingle('/virtual/src/features/report-kind.ts', source);

    // Assert
    expect(kinds(analysis)).toContain(kind);
  });

  // The benefit-of-the-doubt / control cases for kind presence: the kind must be ABSENT.
  it.each<[string, string, ErrorFlowFindingKind]>([
    ['new Error()', 'export function f() { throw new Error("x"); }', 'throw-non-error'],
    ['a factory call', 'export function f() { throw createError(); }', 'throw-non-error'],
    [
      'a member-expression throw (could hold an Error)',
      'export function f(state: { error: Error }) { throw state.error; }',
      'throw-non-error',
    ],
    ['an array-element throw (could hold an Error)', 'export function f(errs: Error[]) { throw errs[0]; }', 'throw-non-error'],
    ['an identifier of unknown type', 'export function f() { try { risky(); } catch (e) { throw e; } }', 'throw-non-error'],
    ['Promise.reject with a new Error', 'export function f() { return Promise.reject(new Error("x")); }', 'throw-non-error'],
    ['Promise.reject with an identifier', 'export function f(err: unknown) { return Promise.reject(err); }', 'throw-non-error'],
    [
      'a sync executor with resolve',
      'export const p = new Promise((resolve) => { resolve(42); });',
      'promise-constructor-hygiene',
    ],
  ])('should not report %s', async (_label, source, kind) => {
    // Act
    const analysis = await analyzeSingle('/virtual/src/features/no-kind.ts', source);

    // Assert
    expect(kinds(analysis)).not.toContain(kind);
  });

  it('should not over-report unrelated kinds when only one rule is violated', async () => {
    // Arrange — a single floating promise (rejection unobserved); nothing else is violated.
    const filePath = '/virtual/src/features/single-violation.ts';
    const source = ['export function f() {', '  Promise.resolve(1);', '}'].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).toContain('floating-promises');
    expect(kinds(analysis)).not.toContain('unsafe-finally');
    expect(kinds(analysis)).not.toContain('missing-error-cause');
  });

  // unsafe-finally: a finally clause that masks the try's outcome. `expected` is the number of
  // unsafe-finally findings (1 = masked/escapes, 0 = stays local / cleanup only).
  it.each<[string, string, number]>([
    [
      'finally returns and masks a throw',
      ['export function f() {', '  try {', '    throw new Error("x");', '  } finally {', '    return 1;', '  }', '}'].join('\n'),
      1,
    ],
    [
      'finally throws and masks a return',
      ['export function f() {', '  try {', '    return 1;', '  } finally {', '    throw new Error("x");', '  }', '}'].join('\n'),
      1,
    ],
    [
      'a nested return exists inside finally',
      [
        'export function f(flag: boolean) {',
        '  try {',
        '    throw new Error("x");',
        '  } finally {',
        '    if (flag) {',
        '      return 1;',
        '    }',
        '  }',
        '}',
      ].join('\n'),
      1,
    ],
    [
      'a .finally callback throws (masks the original rejection)',
      ['export function f() {', '  return Promise.resolve(1).finally(() => {', '    throw new Error("boom");', '  });', '}'].join(
        '\n',
      ),
      1,
    ],
    [
      'an unlabeled continue in finally escapes to the enclosing loop',
      [
        'export function f(items: number[]) {',
        '  for (const x of items) {',
        '    try { return x; } finally { continue; }',
        '  }',
        '}',
      ].join('\n'),
      1,
    ],
    [
      'a labeled break in finally targets a label outside it',
      [
        'export function f(items: number[]) {',
        '  outer: for (const x of items) {',
        '    try { return x; } finally { break outer; }',
        '  }',
        '}',
      ].join('\n'),
      1,
    ],
    [
      'a labeled continue in finally targets a label outside it',
      [
        'export function f(items: number[]) {',
        '  outer: for (const x of items) {',
        '    try { return x; } finally { continue outer; }',
        '  }',
        '}',
      ].join('\n'),
      1,
    ],
    [
      'finally contains break targeting an outer loop',
      [
        'export function f() {',
        '  for (let i = 0; i < 10; i++) {',
        '    try {',
        '      doSomething();',
        '    } finally {',
        '      break;',
        '    }',
        '  }',
        '}',
      ].join('\n'),
      1,
    ],
    [
      'finally contains continue targeting an outer loop',
      [
        'export function f() {',
        '  for (let i = 0; i < 10; i++) {',
        '    try {',
        '      doSomething();',
        '    } finally {',
        '      continue;',
        '    }',
        '  }',
        '}',
      ].join('\n'),
      1,
    ],
    [
      'finally only performs cleanup',
      [
        'export function f() {',
        '  let handle;',
        '  try {',
        '    handle = 1;',
        '    return handle;',
        '  } finally {',
        '    console.log(handle);',
        '  }',
        '}',
      ].join('\n'),
      0,
    ],
    [
      'a break stays inside a loop declared in the finally',
      [
        'export function f() {',
        '  try { return 1; } finally {',
        '    for (let i = 0; i < 3; i++) { if (i === 1) break; }',
        '  }',
        '}',
      ].join('\n'),
      0,
    ],
    [
      'a break stays inside a switch declared in the finally',
      [
        'export function f(k: number) {',
        '  try { return 1; } finally {',
        '    switch (k) { case 1: break; default: break; }',
        '  }',
        '}',
      ].join('\n'),
      0,
    ],
    [
      'a .finally callback returns a value (Promise.finally ignores it)',
      ['export function f() {', '  return Promise.resolve(1).finally(() => {', '    return 2;', '  });', '}'].join('\n'),
      0,
    ],
    [
      'a .finally callback has an expression body',
      ['export function f() {', '  return Promise.resolve(1).finally(() => 1);', '}'].join('\n'),
      0,
    ],
    [
      'a .finally callback throw is caught locally',
      [
        'export function f() {',
        '  return Promise.resolve(1).finally(() => {',
        '    try { risky(); } catch (e) { handle(e); }',
        '  });',
        '}',
      ].join('\n'),
      0,
    ],
    [
      'a .finally callback has no return',
      ['export function f() {', '  return Promise.resolve(1).finally(() => {', '    console.log("cleanup");', '  });', '}'].join(
        '\n',
      ),
      0,
    ],
    [
      'break is inside a loop within finally',
      [
        'export function f() {',
        '  try {',
        '    doSomething();',
        '  } finally {',
        '    for (let i = 0; i < 10; i++) {',
        '      if (i === 5) break;',
        '    }',
        '  }',
        '}',
      ].join('\n'),
      0,
    ],
    [
      'return is inside a nested function in finally',
      [
        'export function f() {',
        '  try {',
        '    doSomething();',
        '  } finally {',
        '    const fn = () => { return 1; };',
        '    fn();',
        '  }',
        '}',
      ].join('\n'),
      0,
    ],
    [
      'a labeled break targets a label inside finally',
      [
        'export function f() {',
        '  try {',
        '    doSomething();',
        '  } finally {',
        '    outer: for (let i = 0; i < 10; i++) {',
        '      for (let j = 0; j < 10; j++) {',
        '        if (j === 5) break outer;',
        '      }',
        '    }',
        '  }',
        '}',
      ].join('\n'),
      0,
    ],
    [
      'a .finally callback has a return inside a nested function',
      [
        'export function f() {',
        '  return Promise.resolve(1).finally(() => {',
        '    const cleanup = () => { return 1; };',
        '    cleanup();',
        '  });',
        '}',
      ].join('\n'),
      0,
    ],
  ])('should resolve unsafe-finally when %s', async (_label, source, expected) => {
    await expectKindCount(source, 'unsafe-finally', expected);
  });

  // catch-or-return: a then-chain whose rejection is neither caught nor propagated.
  it.each<[string, string, number]>([
    [
      'a then-chain has no catch',
      ['export function f() {', '  Promise.resolve(1).then(() => 1);', '}'].join('\n'),
      1,
    ],
    [
      'then-chain is returned',
      [
        'export function f() {',
        '  return Promise.resolve(1).then(() => 1);',
        '}',
        ].join('\n'),
      0,
    ],
    [
      'then-chain is awaited',
      [
        'export async function f() {',
        '  await Promise.resolve(1).then(() => 1);',
        '}',
        ].join('\n'),
      0,
    ],
    [
      'promise chain has catch',
      [
        'export function f() {',
        '  Promise.resolve(1).then(() => 1).catch(() => 0);',
        '}',
        ].join('\n'),
      0,
    ],
    [
      'then has a rejection handler (2-arg form)',
      [
        'export function f() {',
        '  Promise.resolve(1).then(',
        '    (v) => v + 1,',
        '    (e) => 0,',
        '  );',
        '}',
        ].join('\n'),
      0,
    ],
    [
      'an earlier then in chain has a rejection handler',
      [
        'export function f() {',
        '  Promise.resolve(1).then(',
        '    (v) => v + 1,',
        '    (e) => 0,',
        '  ).then((v) => v * 2);',
        '}',
        ].join('\n'),
      0,
    ],
    [
      'catch comes before then',
      [
        'export function f() {',
        '  Promise.resolve(1).catch(() => 0).then(() => 1);',
        '}',
        ].join('\n'),
      0,
    ],
  ])('should resolve catch-or-return when %s', async (_label, source, expected) => {
    await expectKindCount(source, 'catch-or-return', expected);
  });

  // missing-error-cause: a catch that re-throws a fresh error without threading the original cause.
  it.each<[string, string, number]>([
    [
      'catch throws new Error without cause',
      [
        'export function f() {',
        '  try {',
        '    throw new Error("x");',
        '  } catch (e) {',
        '    throw new Error("wrap");',
        '  }',
        '}',
      ].join('\n'),
      1,
    ],
    [
      'the vibe pattern wraps the catch param in an Error message',
      [
        'export function f() {',
        '  try {',
        '    doSomething();',
        '  } catch (e) {',
        '    throw new Error(String(e));',
        '  }',
        '}',
      ].join('\n'),
      1,
    ],
    [
      'an optional catch binding throws a fresh Error',
      [
        'export function f() {',
        '  try {',
        '    doSomething();',
        '  } catch {',
        '    throw new Error("operation failed");',
        '  }',
        '}',
      ].join('\n'),
      1,
    ],
    [
      'the catch param is reassigned before throw',
      [
        'export function f() {',
        '  try {',
        '    doSomething();',
        '  } catch (e) {',
        '    e = new Error("replaced");',
        '    throw e;',
        '  }',
        '}',
      ].join('\n'),
      1,
    ],
    [
      'an AggregateError is thrown without cause',
      [
        'export function f() {',
        '  try {',
        '    doSomething();',
        '  } catch (e) {',
        '    throw new AggregateError([], "multiple failures");',
        '  }',
        '}',
      ].join('\n'),
      1,
    ],
    [
      'the vibe pattern uses e.message',
      [
        'export function f() {',
        '  try {',
        '    doSomething();',
        '  } catch (e) {',
        '    throw new Error(e.message);',
        '  }',
        '}',
      ].join('\n'),
      1,
    ],
    [
      'the vibe pattern uses a template literal',
      [
        'export function f() {',
        '  try {',
        '    doSomething();',
        '  } catch (e) {',
        '    throw new Error(`Failed: ${e}`);',
        '  }',
        '}',
      ].join('\n'),
      1,
    ],
    [
      'an error is assigned to a variable then thrown without cause',
      [
        'export function f() {',
        '  try { doSomething(); } catch (e) {',
        '    const wrapped = new Error("failed");',
        '    throw wrapped;',
        '  }',
        '}',
      ].join('\n'),
      1,
    ],
    [
      'an error variable is declared inside a nested block in catch',
      [
        'export function f() {',
        '  try { doSomething(); } catch (e) {',
        '    if (isRetryable(e)) {',
        '      const wrapped = new Error("retry failed");',
        '      throw wrapped;',
        '    }',
        '  }',
        '}',
      ].join('\n'),
      1,
    ],
    [
      'cause is preserved (catch-transform variant)',
      [
        'export function f() {',
        '  try {',
        '    throw new Error("x");',
        '  } catch (e) {',
        '    throw new Error("wrap", { cause: e });',
        '  }',
        '}',
      ].join('\n'),
      0,
    ],
    [
      'an AggregateError is thrown with cause',
      [
        'export function f() {',
        '  try {',
        '    doSomething();',
        '  } catch (e) {',
        '    throw new AggregateError([], "multiple failures", { cause: e });',
        '  }',
        '}',
      ].join('\n'),
      0,
    ],
    [
      'catch returns without throwing',
      [
        'export function f() {',
        '  try {',
        '    return doSomething();',
        '  } catch (e) {',
        '    return defaultValue;',
        '  }',
        '}',
      ].join('\n'),
      0,
    ],
    [
      'the error variable has cause and is thrown',
      [
        'export function f() {',
        '  try { doSomething(); } catch (e) {',
        '    const wrapped = new Error("failed", { cause: e });',
        '    throw wrapped;',
        '  }',
        '}',
      ].join('\n'),
      0,
    ],
  ])('should resolve missing-error-cause when %s', async (_label, source, expected) => {
    await expectKindCount(source, 'missing-error-cause', expected);
  });

  // promise-constructor-hygiene: throws inside a Promise executor after it may already be settled.
  it.each<[string, string, number]>([
    [
      'a throw is inside a nested function in the executor',
      [
        'export const p = new Promise((resolve) => {',
        '  setTimeout(() => { throw new Error("timeout"); }, 100);',
        '  resolve(42);',
        '});',
      ].join('\n'),
      0,
    ],
    [
      'a bare throw happens before settling',
      ['export const p = new Promise((resolve) => {', '  if (!valid) throw new Error("invalid");', '  resolve(42);', '});'].join(
        '\n',
      ),
      0,
    ],
    [
      'a value is returned inside a sync executor (out of scope)',
      ['export const p = new Promise((resolve) => {', '  return 42;', '});'].join('\n'),
      0,
    ],
    [
      'a new Promise appears in an async function (out of scope: style)',
      ['export async function f() {', '  return new Promise((resolve) => {', '    resolve(42);', '  });', '}'].join('\n'),
      0,
    ],
    [
      'a new Promise wraps a callback API',
      [
        'export async function f() {',
        '  return new Promise((resolve) => {',
        '    emitter.on("data", resolve);',
        '  });',
        '}',
      ].join('\n'),
      0,
    ],
  ])('should resolve promise-constructor-hygiene when %s', async (_label, source, expected) => {
    await expectKindCount(source, 'promise-constructor-hygiene', expected);
  });

  // floating-promises with a syntactic (non-semantic) signal: void/import discards.
  it.each<[string, string, number]>([
    ['an unobserved dynamic import()', 'export function f() { import("./mod"); }', 1],
    ['a voided dynamic import', 'export function f() { void import("./mod"); }', 0],
    ['a voided promise', 'export function f() { void Promise.resolve(1); }', 0],
  ])('should resolve floating-promises (syntactic) when %s', async (_label, source, expected) => {
    await expectKindCount(source, 'floating-promises', expected);
  });

  // misused-promises: single representative negative case.
  it.each<[string, string, ErrorFlowFindingKind, number]>([
    [
      'a sync callback in forEach is not misused-promises',
      'export function f() { [1,2].forEach(x => console.log(x)); }',
      'misused-promises',
      0,
    ],
  ])('should resolve %s', async (_label, source, kind, expected) => {
    await expectKindCount(source, kind, expected);
  });

  // floating-promises / empty-catch gated by the semantic (gildash) layer. `mock` decides whether
  // the queried span is a thenable; `expected` is the resulting finding count for `kind`.
  it.each<[string, string, IsThenableAtSpan, ErrorFlowFindingKind, number]>([
    ['a bare call gildash proves is a Promise', 'export function f() { fetchData(); }', () => true, 'floating-promises', 1],
    [
      'a bare call gildash cannot prove returns a Promise',
      'export function f() { syncFn(); }',
      () => false,
      'floating-promises',
      0,
    ],
    ['a voided bare Promise-returning call', 'export function f() { void fetchData(); }', () => true, 'floating-promises', 0],
    [
      'an empty .catch(() => {}) when gildash proves the receiver is a Promise',
      'export function f(p: Promise<number>) { p.catch(() => {}); }',
      () => true,
      'empty-catch',
      1,
    ],
    [
      'an empty second .then(_, () => {}) handler on a Promise',
      'export function f(p: Promise<number>) { p.then(v => v, () => {}); }',
      () => true,
      'empty-catch',
      1,
    ],
    [
      'an empty .catch on a non-Promise fluent API',
      'export function f(q: { catch(cb: () => void): void }) { q.catch(() => {}); }',
      () => false,
      'empty-catch',
      0,
    ],
    [
      'the rejection handler has a body',
      'export function f(p: Promise<number>) { p.catch((e) => { console.error(e); }); }',
      () => true,
      'empty-catch',
      0,
    ],
  ])('should resolve a gildash-gated finding for %s', async (_label, source, mock, kind, expected) => {
    await expectSemanticKindCount(source, mock, kind, expected);
  });

  // Degraded scans (noop gildash): a type that only the semantic layer could confirm is never
  // flagged, so the gildash-gated kinds never over-report when the type is unknown.
  it.each<[string, string, ErrorFlowFindingKind]>([
    ['a bare call', 'export function f() { fetchData(); }', 'floating-promises'],
    ['an empty .catch', 'export function f(p: Promise<number>) { p.catch(() => {}); }', 'empty-catch'],
  ])('should not flag %s when gildash is unavailable (degraded scans never over-report)', async (_label, source, kind) => {
    // Act — no semantic layer, so the receiver/call type is unknown.
    const analysis = await analyzeSingle('/virtual/src/features/degraded.ts', source);

    // Assert
    expect(analysis.filter(f => f.kind === kind).length).toBe(0);
  });

  // return-await-in-try: a Promise-returning `return` inside a try-with-catch needs `await` so the
  // catch can intercept the rejection. `mock` is the gildash thenable verdict for the returned value.
  it.each<[string, string, IsThenableAtSpan, number]>([
    [
      'returning a call without await in a try block with catch (gildash proves a Promise)',
      [
        'export async function f() {',
        '  try {',
        '    return fetchData();',
        '  } catch (e) {',
        '    handleError(e);',
        '  }',
        '}',
      ].join('\n'),
      () => true,
      1,
    ],
    [
      'a semantic Promise CallExpression flags a finding',
      [
        'export async function f() {',
        '  try {',
        '    return fetchData();',
        '  } catch (e) {',
        '    console.error(e);',
        '  }',
        '}',
      ].join('\n'),
      () => true,
      1,
    ],
    [
      'a semantic Promise Identifier flags a finding',
      [
        'export async function f() {',
        '  const p = fetchData();',
        '  try {',
        '    return p;',
        '  } catch (e) {',
        '    console.error(e);',
        '  }',
        '}',
      ].join('\n'),
      () => true,
      1,
    ],
    [
      'a semantic union with a Promise member (CallExpression) flags a finding',
      [
        'export async function f() {',
        '  try {',
        '    return fetchData();',
        '  } catch (e) {',
        '    console.error(e);',
        '  }',
        '}',
      ].join('\n'),
      () => true,
      1,
    ],
    [
      'a semantic intersection with a Promise member flags a finding',
      [
        'export async function f() {',
        '  try {',
        '    return fetchData();',
        '  } catch (e) {',
        '    console.error(e);',
        '  }',
        '}',
      ].join('\n'),
      () => true,
      1,
    ],
    [
      'a semantic PromiseLike type flags a finding',
      [
        'export async function f() {',
        '  try {',
        '    return getThenable();',
        '  } catch (e) {',
        '    console.error(e);',
        '  }',
        '}',
      ].join('\n'),
      () => true,
      1,
    ],
    [
      'a semantic sync CallExpression yields no finding',
      [
        'export async function f() {',
        '  try {',
        '    return parseInt(s);',
        '  } catch (e) {',
        '    console.error(e);',
        '  }',
        '}',
      ].join('\n'),
      () => false,
      0,
    ],
    [
      'a semantic sync Identifier yields no finding',
      [
        'export async function f() {',
        '  const val = "hello";',
        '  try {',
        '    return val;',
        '  } catch (e) {',
        '    console.error(e);',
        '  }',
        '}',
      ].join('\n'),
      () => false,
      0,
    ],
    [
      'a semantic union of all-sync members yields no finding',
      [
        'export async function f() {',
        '  try {',
        '    return getValue();',
        '  } catch (e) {',
        '    console.error(e);',
        '  }',
        '}',
      ].join('\n'),
      () => false,
      0,
    ],
    [
      'gildash cannot resolve the type yields no finding (conservative)',
      [
        'export async function f() {',
        '  try {',
        '    return fetchData();',
        '  } catch (e) {',
        '    console.error(e);',
        '  }',
        '}',
      ].join('\n'),
      () => null,
      0,
    ],
    [
      'the semantic layer throws yields no finding (conservative)',
      [
        'export async function f() {',
        '  try {',
        '    return fetchData();',
        '  } catch (e) {',
        '    console.error(e);',
        '  }',
        '}',
      ].join('\n'),
      () => {
        throw new Error('semantic layer is not enabled');
      },
      0,
    ],
    [
      'a NewExpression is not flagged (a constructed instance is not a thenable)',
      [
        'export async function f() {',
        '  try {',
        '    return new MyPromise(resolve => resolve(1));',
        '  } catch (e) {',
        '    console.error(e);',
        '  }',
        '}',
      ].join('\n'),
      () => true,
      0,
    ],
  ])('should resolve return-await-in-try when %s', async (_label, source, mock, expected) => {
    await expectSemanticKindCount(source, mock, 'return-await-in-try', expected);
  });

  // return-await-in-try, syntactic (noop gildash): import() is statically a Promise; everything else
  // here is provably not a flag.
  it.each<[string, string, number]>([
    [
      'returning import() without await in a try block with catch',
      [
        'export async function f() {',
        '  try {',
        '    return import("./mod");',
        '  } catch (e) {',
        '    return null;',
        '  }',
        '}',
      ].join('\n'),
      1,
    ],
    [
      'return uses await',
      [
        'export async function f() {',
        '  try {',
        '    return await fetchData();',
        '  } catch (e) {',
        '    handleError(e);',
        '  }',
        '}',
      ].join('\n'),
      0,
    ],
    ['return is outside the try block', ['export async function f() {', '  return fetchData();', '}'].join('\n'), 0],
    [
      'a literal return in a try block',
      ['export function f() {', '  try {', '    return "ok";', '  } catch (e) {', '    return "error";', '  }', '}'].join('\n'),
      0,
    ],
    [
      'try has only finally (no catch)',
      ['export async function f() {', '  try {', '    return fetchData();', '  } finally {', '    cleanup();', '  }', '}'].join(
        '\n',
      ),
      0,
    ],
    [
      'a non-async function returns a call in a try block',
      [
        'export function f() {',
        '  try {',
        '    return fetch("url");',
        '  } catch (e) {',
        '    console.error(e);',
        '  }',
        '}',
      ].join('\n'),
      0,
    ],
  ])('should resolve return-await-in-try (syntactic) when %s', async (_label, source, expected) => {
    await expectKindCount(source, 'return-await-in-try', expected);
  });

  // The oracle probes the value span with the `anyConstituent` option; assert that inside the mock.
  it.each<[string, string]>([
    [
      'CallExpression result span is probed with anyConstituent',
      [
        'export async function f() {',
        '  try {',
        '    return fetchData();',
        '  } catch (e) {',
        '    console.error(e);',
        '  }',
        '}',
      ].join('\n'),
    ],
    [
      'Identifier passes anyConstituent option',
      [
        'export async function f() {',
        '  const p = fetchData();',
        '  try {',
        '    return p;',
        '  } catch (e) {',
        '    console.error(e);',
        '  }',
        '}',
      ].join('\n'),
    ],
  ])('return-await-in-try - %s', async (_label, source) => {
    // Act — the oracle queries the value's span for thenable-ness, passing anyConstituent.
    const analysis = await analyzeWithSemantic('/virtual/src/features/return-await-probe.ts', source, (_f, _span, options) => {
      expect(options).toEqual({ anyConstituent: true });

      return true;
    });
    const hits = analysis.filter(f => f.kind === 'return-await-in-try');

    // Assert
    expect(hits.length).toBe(1);
  });

  // unobserved-variable: a Promise-typed local that is never awaited/returned. `mock` is the gildash
  // thenable verdict for the variable's init.
  it.each<[string, string, IsThenableAtSpan, number]>([
    [
      'a Promise call result is never awaited',
      ['export function f() {', '  const p = fetchData();', '  console.log("done");', '}'].join('\n'),
      () => true,
      1,
    ],
    [
      'a non-Promise call result (gildash confirms)',
      ['export function f() {', '  const x = getData();', '  console.log("done");', '}'].join('\n'),
      () => false,
      0,
    ],
    [
      'the call result is awaited',
      ['export async function f() {', '  const p = fetchData();', '  await p;', '}'].join('\n'),
      () => true,
      0,
    ],
    [
      'the call result is returned',
      ['export function f() {', '  const p = fetchData();', '  return p;', '}'].join('\n'),
      () => true,
      0,
    ],
  ])('should resolve unobserved-variable when %s', async (_label, source, mock, expected) => {
    await expectSemanticKindCount(source, mock, 'unobserved-variable', expected);
  });

  it('should not report unobserved-variable when gildash is unavailable (conservative fallback)', async () => {
    // Arrange — without gildash, detector cannot confirm Promise-ness of the call result.
    // Fallback policy: register NO candidates (vs. the old behavior of registering ALL,
    // which re-introduced the original broad-FP regression).
    const program = syncHelperProgram('/virtual/src/features/no-gildash.ts');

    // Act & Assert — no gildash passed
    expectNoUnobserved(program);
  });

  it('should not report unobserved-variable when gildash throws (conservative fallback)', async () => {
    // Arrange — gildash present but its semantic methods throw.
    // Same conservative policy: don't broadcast FP for every call result.
    const program = syncHelperProgram('/virtual/src/features/gildash-throws.ts');
    const throwingGildash = {
      isThenableAtSpan: () => {
        throw new Error('semantic layer offline');
      },
      getExpressionTypeAtSpan: () => {
        throw new Error('semantic layer offline');
      },
      getContextualCallReturnsAtSpan: () => {
        throw new Error('semantic layer offline');
      },
    } as unknown as Gildash;

    // Act & Assert
    expectNoUnobserved(program, { gildash: throwingGildash });
  });

  it('two-arg `.then(onFulfilled, onRejected)`: real handler = K, empty handler = W (non-vacuous contrast)', async () => {
    // Regression lock: the two-arg `.then` form delivers rejections to onRejected. A REAL onRejected
    // observes the rejection (K); an EMPTY one swallows it (W). Uses a proven-thenable gildash so the
    // rejection-handler path is actually exercised (with the noop gildash it would pass vacuously).
    const filePath = '/virtual/src/features/then-two-arg.ts';
    const realHandler = [
      'export function f(p: Promise<number>): void {',
      '  p.then(v => v + 1, e => console.error(e));',
      '}',
    ].join('\n');
    const emptyHandler = ['export function f(p: Promise<number>): void {', '  p.then(v => v + 1, () => {});', '}'].join('\n');
    // Act — gildash proves `p` is thenable so the empty-rejection path runs
    const realFindings = await analyzeWithSemantic(filePath, realHandler, () => true);
    const emptyFindings = await analyzeWithSemantic(filePath, emptyHandler, () => true);

    // Assert — real onRejected observes the rejection (no empty-catch); empty onRejected swallows (exactly one)
    expect(realFindings.some(f => f.kind === 'empty-catch')).toBe(false);
    expect(emptyFindings.filter(f => f.kind === 'empty-catch').length).toBe(1);
  });

  // ── 명세이름 identity 게이트: 파일 내에서 섀도잉된 전역 이름은 명세 사실로 취급하지 않는다 ──
  //
  // CLAUDE.md 공통 원칙: 명세가 정의한 이름은 identity가 확인될 때만 명세 사실이다.
  // 파일이 같은 이름의 바인딩을 선언하면(클래스·함수·변수·import) 그 이름의 전역 identity가
  // 닫히지 않으므로 W를 만들지 않는다(보류, FN 방향). 섀도잉이 없으면 모듈 스코프의 전역
  // 참조는 언어의 이름 해석 규칙으로 닫힌 사실이다 — 기존 W는 그대로 유지된다.

  describe('shadowed spec-name identity gate', () => {
    it('holds promise-constructor-hygiene when Promise is a local class', async () => {
      const source = [
        'class Promise<T> { constructor(fn: (res: (v: T) => void) => void) {} }',
        'export const p = new Promise<number>(async res => { res(1); });',
      ].join('\n');

      await expectKindCount(source, 'promise-constructor-hygiene', 0);
    });

    it('holds throw-non-error for Promise.reject when Promise is locally bound', async () => {
      const source = [
        'import { Promise } from "./my-promise";',
        'export function f() { return Promise.reject("plain string"); }',
      ].join('\n');

      await expectKindCount(source, 'throw-non-error', 0);
    });

    it('holds missing-error-cause when Error is a local class', async () => {
      const source = [
        'class Error { constructor(public message: string) {} }',
        'export function f(): void {',
        '  try {',
        '    JSON.parse("x");',
        '  } catch (err) {',
        '    throw new Error("wrapped");',
        '  }',
        '}',
      ].join('\n');

      await expectKindCount(source, 'missing-error-cause', 0);
    });

    it('holds throw-non-error for a primitive-wrapper call when String is locally bound', async () => {
      const source = [
        'function String(x: unknown): unknown { return x; }',
        'export function f(x: unknown): void {',
        '  throw String(x);',
        '}',
      ].join('\n');

      await expectKindCount(source, 'throw-non-error', 0);
    });

    it('holds floating-promises for a discarded new Promise when Promise is a local class', async () => {
      const source = [
        'class Promise<T> { constructor(fn: (res: (v: T) => void) => void) {} }',
        'export function f(): void {',
        '  new Promise<number>(res => res(1));',
        '}',
      ].join('\n');

      await expectKindCount(source, 'floating-promises', 0);
    });

    it('still reports promise-constructor-hygiene for the unshadowed global Promise (guard)', async () => {
      const source = 'export const p = new Promise<number>(async res => { res(1); });';

      await expectKindCount(source, 'promise-constructor-hygiene', 1);
    });

    it('holds when the file member-writes the global (globalThis.Promise = fake)', async () => {
      const source = [
        'declare const fake: PromiseConstructor;',
        'globalThis.Promise = fake;',
        'export const p = new Promise<number>(async res => { res(1); });',
      ].join('\n');

      await expectKindCount(source, 'promise-constructor-hygiene', 0);
    });

    it('does NOT treat an ambient declare as shadowing (declare creates no runtime binding)', async () => {
      // `declare const` asserts the GLOBAL exists — it is a spec-fact declaration, not a shadow.
      const source = [
        'declare const globalThis: { Promise: PromiseConstructor };',
        'export const p = new globalThis.Promise<number>(async res => { res(1); });',
      ].join('\n');

      await expectKindCount(source, 'promise-constructor-hygiene', 1);
    });

    it('still reports throw-non-error for the unshadowed Promise.reject with a literal (guard)', async () => {
      const source = 'export function f() { return Promise.reject("plain string"); }';

      await expectKindCount(source, 'throw-non-error', 1);
    });
  });

  // ── thenable identity 게이트: 이름만으로는 W를 만들지 않는다 ────────────────
  //
  // `.then`/`.finally`/`forEach`는 명세이름이지만 임의 수신자의 프로퍼티명 매칭만으로는
  // identity가 안 닫힌다(파서 콤비네이터의 `.then` 등 동명 API). W는 두 사실 중 하나가 만든다:
  //  (a) 구문 spec-fact 체인 — 루트가 Promise 팩토리(new Promise/Promise.*/import(), 섀도잉
  //      게이트 통과)이고 모든 hop이 명세 메서드(then/catch/finally: 반환도 명세상 Promise).
  //  (b) gildash 타입 증명 (oracle.isThenable / 배열 증명).
  //  misused-promises의 구문 사실은 ArrayExpression 리터럴 수신자다.

  describe('thenable identity gate (name alone never fires)', () => {
    it('holds catch-or-return for an arbitrary unproven receiver `.then` chain', async () => {
      const source = ['declare const parser: any;', 'export function f(): void {', '  parser.then((r: unknown) => r);', '}'].join('\n');

      await expectKindCount(source, 'catch-or-return', 0);
    });

    it('still reports catch-or-return for a spec-fact Promise chain (syntactic root)', async () => {
      const source = 'export function f(): void { Promise.resolve(1).then(v => v + 1); }';

      await expectKindCount(source, 'catch-or-return', 1);
    });

    it('holds catch-or-return for a spec-fact-looking chain when Promise is shadowed', async () => {
      const source = [
        'import { Promise } from "./parser-lib";',
        'export function f(): void { Promise.resolve(1).then((v: number) => v + 1); }',
      ].join('\n');

      await expectKindCount(source, 'catch-or-return', 0);
    });

    it('reports catch-or-return for an arbitrary receiver when gildash proves it thenable', async () => {
      const source = [
        'declare const task: { then(cb: (v: number) => void): unknown };',
        'export function f(): void { task.then(v => v); }',
      ].join('\n');

      await expectSemanticKindCount(source, () => true, 'catch-or-return', 1);
    });

    it('holds unsafe-finally for an arbitrary unproven receiver `.finally(throw)`', async () => {
      const source = [
        'declare const parser: any;',
        'export function f(): void {',
        "  parser.finally(() => { throw new Error('x'); });",
        '}',
      ].join('\n');

      await expectKindCount(source, 'unsafe-finally', 0);
    });

    it('still reports unsafe-finally on a spec-fact Promise chain (syntactic root)', async () => {
      const source = "export function f(): void { Promise.resolve(1).finally(() => { throw new Error('x'); }); }";

      await expectKindCount(source, 'unsafe-finally', 1);
    });

    it('reports unsafe-finally for an arbitrary receiver when gildash proves it thenable', async () => {
      const source = ['declare const p: any;', "export function f(): void { p.finally(() => { throw new Error('x'); }); }"].join('\n');

      await expectSemanticKindCount(source, () => true, 'unsafe-finally', 1);
    });

    it('holds misused-promises for an async callback on an unproven receiver forEach', async () => {
      const source = ['declare const items: any;', 'export function f(): void { items.forEach(async (i: number) => { await i; }); }'].join('\n');

      await expectKindCount(source, 'misused-promises', 0);
    });

    it('holds misused-promises for an ANY-typed receiver even though `any` is assignable to arrays', async () => {
      // Real-gildash shape: assignability says true (any is assignable to everything) but the
      // resolved type is `any` — assignability alone proves nothing, the oracle must hold.
      const source = ['declare const items: any;', 'export function f(): void { items.forEach(async (i: number) => { await i; }); }'].join('\n');
      const program = [parseSource('/virtual/src/features/any-receiver.ts', source)];
      const gildash = {
        isThenableAtSpan: () => null,
        getContextualCallReturnsAtSpan: () => null,
        isTypeAssignableToTypeAtSpan: () => true,
        getExpressionTypeAtSpan: () => ({ text: 'any', flags: 1, isUnion: false, isIntersection: false, isGeneric: false }),
      } as unknown as Gildash;
      const findings = analyzeErrorFlow(program, { gildash });

      expect(findings.filter(f => f.kind === 'misused-promises').length).toBe(0);
    });

    it('reports misused-promises when gildash proves a concrete array receiver type', async () => {
      const source = ['declare const items: number[];', 'export function f(): void { items.forEach(async (i: number) => { await i; }); }'].join(
        '\n',
      );
      const program = [parseSource('/virtual/src/features/typed-receiver.ts', source)];
      const gildash = {
        isThenableAtSpan: () => null,
        getContextualCallReturnsAtSpan: () => null,
        isTypeAssignableToTypeAtSpan: () => true,
        getExpressionTypeAtSpan: () => ({ text: 'number[]', flags: 1 << 19, isUnion: false, isIntersection: false, isGeneric: false }),
      } as unknown as Gildash;
      const findings = analyzeErrorFlow(program, { gildash });

      expect(findings.filter(f => f.kind === 'misused-promises').length).toBe(1);
    });

    it('still reports misused-promises for an async callback on an array-literal receiver (syntactic)', async () => {
      const source = 'export function f(): void { [1, 2].forEach(async i => { await i; }); }';

      await expectKindCount(source, 'misused-promises', 1);
    });

    it('treats `import Promise = require(...)` as a shadowing binding (TSImportEquals)', async () => {
      const source = ['import Promise = require("bluebird");', 'export function f() { return Promise.reject("plain string"); }'].join('\n');

      await expectKindCount(source, 'throw-non-error', 0);
    });
  });
});
