import type { Gildash } from '@zipbul/gildash';

import { describe, expect, it } from 'bun:test';

import { parseSource } from '../../engine/ast/parse-source';
import { analyzeErrorFlow } from './analyzer';

const noopGildash = {
  isThenableAtSpan: () => null,
  getExpressionTypeAtSpan: () => null,
  getContextualCallReturnsAtSpan: () => null,
} as unknown as Gildash;

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
const analyzeWithSemantic = async (
  filePath: string,
  sourceText: string,
  mockIsThenableAtSpan: (
    filePath: string,
    span: { start: number; end: number },
    options?: { anyConstituent?: boolean },
  ) => boolean | null,
) => {
  const program = [parseSource(filePath, sourceText)];
  const gildash = {
    isThenableAtSpan: mockIsThenableAtSpan,
    getExpressionTypeAtSpan: () => null,
    getContextualCallReturnsAtSpan: () => null,
  } as unknown as Gildash;

  return analyzeErrorFlow(program, { gildash });
};

type Findings = Awaited<ReturnType<typeof analyzeSingle>>;

const kinds = (findings: Findings) => findings.map(f => f.kind);

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
      '  doThing().then(() => 1);',
      '}',
      'function doThing() { return Promise.resolve(1); }',
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

  it('should not report useless-catch for a bare rethrow (out of scope: redundancy)', async () => {
    // Arrange — a rethrow preserves observability/propagation/cause; redundancy is lint's domain.
    const filePath = '/virtual/src/features/useless.ts';
    const source = ['export function f() {', '  try {', '    return 1;', '  } catch (e) {', '    throw e;', '  }', '}'].join(
      '\n',
    );
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis;

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report useless-catch for a bare rethrow under a different name (out of scope: redundancy)', async () => {
    // Arrange
    const filePath = '/virtual/src/features/useless-rename.ts';
    const source = ['export function f() {', '  try {', '    return 1;', '  } catch (err) {', '    throw err;', '  }', '}'].join(
      '\n',
    );
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis;

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report useless-catch when catch logs and rethrows', async () => {
    // Arrange
    const filePath = '/virtual/src/features/useless-logged.ts';
    const source = [
      'export function f() {',
      '  try {',
      '    return 1;',
      '  } catch (e) {',
      '    console.error(e);',
      '    throw e;',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis;

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report useless-catch when catch rethrows a new error with cause', async () => {
    // Arrange
    const filePath = '/virtual/src/features/useless-wrapped.ts';
    const source = [
      'export function f() {',
      '  try {',
      '    return 1;',
      '  } catch (e) {',
      '    throw new Error("wrap", { cause: e });',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis;

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report useless-catch when catch adds context', async () => {
    // Arrange
    const filePath = '/virtual/src/features/context.ts';
    const source = [
      'export function f() {',
      '  try {',
      '    return 1;',
      '  } catch (e) {',
      '    throw new Error("wrap", { cause: e });',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis;

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should report unsafe-finally when finally returns and masks a throw', async () => {
    // Arrange
    const filePath = '/virtual/src/features/finally-return.ts';
    const source = [
      'export function f() {',
      '  try {',
      '    throw new Error("x");',
      '  } finally {',
      '    return 1;',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBe(1);
  });

  it('should report unsafe-finally when finally throws and masks a return', async () => {
    // Arrange
    const filePath = '/virtual/src/features/finally-throw.ts';
    const source = [
      'export function f() {',
      '  try {',
      '    return 1;',
      '  } finally {',
      '    throw new Error("x");',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBe(1);
  });

  it('should report unsafe-finally when nested return exists inside finally', async () => {
    // Arrange
    const filePath = '/virtual/src/features/finally-nested-return.ts';
    const source = [
      'export function f(flag: boolean) {',
      '  try {',
      '    throw new Error("x");',
      '  } finally {',
      '    if (flag) {',
      '      return 1;',
      '    }',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBe(1);
  });

  it('should not report unsafe-finally when finally only performs cleanup', async () => {
    // Arrange
    const filePath = '/virtual/src/features/finally-cleanup.ts';
    const source = [
      'export function f() {',
      '  let handle;',
      '  try {',
      '    handle = 1;',
      '    return handle;',
      '  } finally {',
      '    console.log(handle);',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should report unsafe-finally when a .finally callback throws (masks the original rejection)', async () => {
    // Arrange — a throw in the finally callback rejects the result, discarding the original error.
    const filePath = '/virtual/src/features/promise-finally-throw.ts';
    const source = [
      'export function f() {',
      '  return Promise.resolve(1).finally(() => {',
      '    throw new Error("boom");',
      '  });',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBe(1);
  });

  it('should report unsafe-finally when an unlabeled continue in finally escapes to the enclosing loop', async () => {
    // Arrange — the continue has no loop inside the finally, so it targets the outer for, abandoning
    // whatever the try was settling (its return/throw is discarded).
    const filePath = '/virtual/src/features/finally-continue.ts';
    const source = [
      'export function f(items: number[]) {',
      '  for (const x of items) {',
      '    try { return x; } finally { continue; }',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBe(1);
  });

  it('should report unsafe-finally when a labeled break in finally targets a label outside it', async () => {
    // Arrange — `break outer` jumps out of the finally to the labeled loop, discarding the try outcome.
    const filePath = '/virtual/src/features/finally-labeled-break.ts';
    const source = [
      'export function f(items: number[]) {',
      '  outer: for (const x of items) {',
      '    try { return x; } finally { break outer; }',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBe(1);
  });

  it('should report unsafe-finally when a labeled continue in finally targets a label outside it', async () => {
    // Arrange — `continue outer` jumps out of the finally to the labeled loop, discarding the try outcome.
    const filePath = '/virtual/src/features/finally-labeled-continue.ts';
    const source = [
      'export function f(items: number[]) {',
      '  outer: for (const x of items) {',
      '    try { return x; } finally { continue outer; }',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBe(1);
  });

  it('should not report unsafe-finally when a break stays inside a loop declared in the finally', async () => {
    // Arrange — the break targets the finally-local for, so it never escapes the finally (K).
    const filePath = '/virtual/src/features/finally-local-loop-break.ts';
    const source = [
      'export function f() {',
      '  try { return 1; } finally {',
      '    for (let i = 0; i < 3; i++) { if (i === 1) break; }',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report unsafe-finally when a break stays inside a switch declared in the finally', async () => {
    // Arrange — the break belongs to the finally-local switch, not an escape (K).
    const filePath = '/virtual/src/features/finally-local-switch-break.ts';
    const source = [
      'export function f(k: number) {',
      '  try { return 1; } finally {',
      '    switch (k) { case 1: break; default: break; }',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report unsafe-finally when a .finally callback returns a value (Promise.finally ignores it)', async () => {
    // Arrange — Promise.finally discards the callback return; the original settlement passes through.
    const filePath = '/virtual/src/features/promise-finally.ts';
    const source = ['export function f() {', '  return Promise.resolve(1).finally(() => {', '    return 2;', '  });', '}'].join(
      '\n',
    );
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report unsafe-finally when a .finally callback has an expression body', async () => {
    // Arrange — the returned value is ignored.
    const filePath = '/virtual/src/features/promise-finally-expr.ts';
    const source = ['export function f() {', '  return Promise.resolve(1).finally(() => 1);', '}'].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report unsafe-finally when a .finally callback throw is caught locally', async () => {
    // Arrange — the throw is caught inside the callback, so it does not escape / mask anything.
    const filePath = '/virtual/src/features/promise-finally-caught.ts';
    const source = [
      'export function f() {',
      '  return Promise.resolve(1).finally(() => {',
      '    try { risky(); } catch (e) { handle(e); }',
      '  });',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report unsafe-finally (.finally() variant) when finally callback has no return', async () => {
    // Arrange
    const filePath = '/virtual/src/features/promise-finally-ok.ts';
    const source = [
      'export function f() {',
      '  return Promise.resolve(1).finally(() => {',
      '    console.log("cleanup");',
      '  });',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should report catch-or-return when a then-chain has no catch', async () => {
    // Arrange
    const filePath = '/virtual/src/features/then-no-catch.ts';
    const source = [
      'export function f() {',
      '  doThing().then(() => 1);',
      '}',
      'function doThing() { return Promise.resolve(1); }',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'catch-or-return');

    // Assert
    expect(hits.length).toBe(1);
  });

  it('should not report catch-or-return when then-chain is returned', async () => {
    // Arrange
    const filePath = '/virtual/src/features/then-returned.ts';
    const source = [
      'export function f() {',
      '  return doThing().then(() => 1);',
      '}',
      'function doThing() { return Promise.resolve(1); }',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'catch-or-return');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report catch-or-return when then-chain is awaited', async () => {
    // Arrange
    const filePath = '/virtual/src/features/then-awaited.ts';
    const source = [
      'export async function f() {',
      '  await doThing().then(() => 1);',
      '}',
      'function doThing() { return Promise.resolve(1); }',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'catch-or-return');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report catch-or-return when promise chain has catch', async () => {
    // Arrange
    const filePath = '/virtual/src/features/then-has-catch.ts';
    const source = [
      'export function f() {',
      '  doThing().then(() => 1).catch(() => 0);',
      '}',
      'function doThing() { return Promise.resolve(1); }',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'catch-or-return');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report catch-or-return when then has a rejection handler (2-arg form)', async () => {
    // Arrange — .then(onFulfilled, onRejected) handles rejection just like .catch()
    const filePath = '/virtual/src/features/then-2arg.ts';
    const source = [
      'export function f() {',
      '  doThing().then(',
      '    (v) => v + 1,',
      '    (e) => 0,',
      '  );',
      '}',
      'function doThing() { return Promise.resolve(1); }',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'catch-or-return');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report catch-or-return when an earlier then in chain has rejection handler', async () => {
    // Arrange — earlier .then(_, onRejected) handles rejection for subsequent chain
    const filePath = '/virtual/src/features/then-2arg-chain.ts';
    const source = [
      'export function f() {',
      '  doThing().then(',
      '    (v) => v + 1,',
      '    (e) => 0,',
      '  ).then((v) => v * 2);',
      '}',
      'function doThing() { return Promise.resolve(1); }',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'catch-or-return');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report prefer-catch for a second-argument rejection handler (out of scope: style)', async () => {
    // Arrange — onErr observes the upstream rejection, so the reason reaches a handler;
    // preferring `.catch` over a second argument is a pure notation convention (lint domain).
    const filePath = '/virtual/src/features/prefer-catch.ts';
    const source = ['export function f() {', '  return Promise.resolve(1).then(() => 1, () => 0);', '}'].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis;

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report prefer-catch when a downstream catch also exists (rejection fully observed)', async () => {
    // Arrange — both the upstream rejection (onErr) and any onOk throw (downstream .catch) are
    // observed, so nothing is lost; flagging this was a clear over-report.
    const filePath = '/virtual/src/features/prefer-catch-and-catch.ts';
    const source = [
      'export function f() {',
      '  return Promise.resolve(1)',
      '    .then(() => 1, () => 0)',
      '    .catch(() => -1);',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis;

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report prefer-catch when catch is used', async () => {
    // Arrange
    const filePath = '/virtual/src/features/prefer-catch-ok.ts';
    const source = ['export function f() {', '  return Promise.resolve(1).then(() => 1).catch(() => 0);', '}'].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis;

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report prefer-await-to-then for long control-flow chains (out of scope: style)', async () => {
    // Arrange — await-vs-then is a style preference; the chain is returned, so its rejection
    // propagates to the caller.
    const filePath = '/virtual/src/features/prefer-await.ts';
    const source = [
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
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis;

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report prefer-await-to-then for a chain with side effects (out of scope: style)', async () => {
    // Arrange
    const filePath = '/virtual/src/features/prefer-await-side-effect.ts';
    const source = [
      'export function f() {',
      '  return Promise.resolve(1)',
      '    .then(x => x + 1)',
      '    .then(x => {',
      '      console.log(x);',
      '      return x;',
      '    });',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis;

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report prefer-await-to-then when then is a short value mapping', async () => {
    // Arrange
    const filePath = '/virtual/src/features/prefer-await-ok.ts';
    const source = ['export function f() {', '  return Promise.resolve(1).then(x => x + 1);', '}'].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis;

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report prefer-await-to-then when chain is short even if callback uses block', async () => {
    // Arrange
    const filePath = '/virtual/src/features/prefer-await-short-block.ts';
    const source = ['export function f() {', '  return Promise.resolve(1).then(x => {', '    return x + 1;', '  });', '}'].join(
      '\n',
    );
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis;

    // Assert
    expect(hits.length).toBe(0);
  });

  // --- floating-promises ---

  it('should report floating-promises for unobserved Promise.resolve', async () => {
    // Arrange
    const filePath = '/virtual/src/features/floating.ts';
    const source = 'export function f() { Promise.resolve(1); }';
    // Act
    const analysis = await analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).toContain('floating-promises');
  });

  it('should report floating-promises for unobserved dynamic import()', async () => {
    // Arrange — `import('./mod')` returns a Promise; bare expression statement leaks rejection
    const filePath = '/virtual/src/features/dynamic-import-floating.ts';
    const source = 'export function f() { import("./mod"); }';
    // Act
    const analysis = await analyzeSingle(filePath, source);

    // Assert
    expect(analysis.filter(f => f.kind === 'floating-promises').length).toBe(1);
  });

  it('should not report floating-promises when dynamic import is voided', async () => {
    // Arrange
    const filePath = '/virtual/src/features/dynamic-import-voided.ts';
    const source = 'export function f() { void import("./mod"); }';
    // Act
    const analysis = await analyzeSingle(filePath, source);

    // Assert — control: voided import should NOT report floating-promises
    expect(analysis.filter(f => f.kind === 'floating-promises').length).toBe(0);
  });

  it('should not report floating-promises when promise is voided', async () => {
    // Arrange
    const filePath = '/virtual/src/features/floating-void.ts';
    const source = 'export function f() { void Promise.resolve(1); }';
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'floating-promises');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should report floating-promises for a bare call whose result gildash proves is a Promise', async () => {
    // Arrange — `fetchData();` discards a Promise; its rejection is unobserved.
    const filePath = '/virtual/src/features/floating-bare-call.ts';
    const source = 'export function f() { fetchData(); }';
    // Act — gildash reports the callee returns a PromiseLike.
    const analysis = await analyzeWithSemantic(filePath, source, () => true);

    // Assert
    expect(analysis.filter(f => f.kind === 'floating-promises').length).toBe(1);
  });

  it('should not report floating-promises for a bare call gildash cannot prove returns a Promise', async () => {
    // Arrange — conservative: an unresolved/non-Promise call type is never flagged.
    const filePath = '/virtual/src/features/floating-bare-sync.ts';
    const source = 'export function f() { syncFn(); }';
    // Act
    const analysis = await analyzeWithSemantic(filePath, source, () => false);

    // Assert
    expect(analysis.filter(f => f.kind === 'floating-promises').length).toBe(0);
  });

  it('should not report floating-promises for a voided bare Promise-returning call', async () => {
    // Arrange — `void` is an explicit discard (K), even when gildash proves a Promise.
    const filePath = '/virtual/src/features/floating-bare-void.ts';
    const source = 'export function f() { void fetchData(); }';
    // Act
    const analysis = await analyzeWithSemantic(filePath, source, () => true);

    // Assert
    expect(analysis.filter(f => f.kind === 'floating-promises').length).toBe(0);
  });

  it('should not flag a bare call when gildash is unavailable (degraded scans never over-report)', async () => {
    // Arrange — without the semantic layer, a bare call type is unknown → not flagged.
    const filePath = '/virtual/src/features/floating-bare-nogildash.ts';
    const source = 'export function f() { fetchData(); }';
    // Act
    const analysis = await analyzeSingle(filePath, source);

    // Assert
    expect(analysis.filter(f => f.kind === 'floating-promises').length).toBe(0);
  });

  // --- empty rejection handler (promise form of empty-catch), gildash-gated ---

  it('should report empty-catch for an empty .catch(() => {}) when gildash proves the receiver is a Promise', async () => {
    // Arrange — an empty .catch swallows the rejection just like an empty catch block.
    const filePath = '/virtual/src/features/empty-catch-handler.ts';
    const source = 'export function f(p: Promise<number>) { p.catch(() => {}); }';
    // Act — gildash confirms the receiver is PromiseLike.
    const analysis = await analyzeWithSemantic(filePath, source, () => true);

    // Assert
    expect(analysis.filter(f => f.kind === 'empty-catch').length).toBe(1);
  });

  it('should report empty-catch for an empty second .then(_, () => {}) handler on a Promise', async () => {
    // Arrange
    const filePath = '/virtual/src/features/empty-then-handler.ts';
    const source = 'export function f(p: Promise<number>) { p.then(v => v, () => {}); }';
    // Act
    const analysis = await analyzeWithSemantic(filePath, source, () => true);

    // Assert
    expect(analysis.filter(f => f.kind === 'empty-catch').length).toBe(1);
  });

  it('should not report empty-catch for an empty .catch on a non-Promise fluent API', async () => {
    // Arrange — a query builder with its own `.catch` method is not a rejection channel.
    const filePath = '/virtual/src/features/empty-catch-nonpromise.ts';
    const source = 'export function f(q: { catch(cb: () => void): void }) { q.catch(() => {}); }';
    // Act — gildash reports the receiver is NOT PromiseLike.
    const analysis = await analyzeWithSemantic(filePath, source, () => false);

    // Assert
    expect(analysis.filter(f => f.kind === 'empty-catch').length).toBe(0);
  });

  it('should not report empty-catch when the rejection handler has a body', async () => {
    // Arrange — observing the error (logging) is not a swallow.
    const filePath = '/virtual/src/features/nonempty-catch-handler.ts';
    const source = 'export function f(p: Promise<number>) { p.catch((e) => { console.error(e); }); }';
    // Act
    const analysis = await analyzeWithSemantic(filePath, source, () => true);

    // Assert
    expect(analysis.filter(f => f.kind === 'empty-catch').length).toBe(0);
  });

  it('should not flag an empty .catch when gildash is unavailable (degraded scans never over-report)', async () => {
    // Arrange — without the semantic layer the receiver type is unknown → not flagged.
    const filePath = '/virtual/src/features/empty-catch-nogildash.ts';
    const source = 'export function f(p: Promise<number>) { p.catch(() => {}); }';
    // Act
    const analysis = await analyzeSingle(filePath, source);

    // Assert
    expect(analysis.filter(f => f.kind === 'empty-catch').length).toBe(0);
  });

  // --- misused-promises ---

  it('should report misused-promises for async callback in forEach', async () => {
    // Arrange
    const filePath = '/virtual/src/features/misused.ts';
    const source = 'export function f() { [1,2].forEach(async x => { await fetch(String(x)); }); }';
    // Act
    const analysis = await analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).toContain('misused-promises');
  });

  it('should not report misused-promises for sync callback in forEach', async () => {
    // Arrange
    const filePath = '/virtual/src/features/misused-sync.ts';
    const source = 'export function f() { [1,2].forEach(x => console.log(x)); }';
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'misused-promises');

    // Assert
    expect(hits.length).toBe(0);
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

  it('should report missing-error-cause when catch throws new Error without cause', async () => {
    // Arrange
    const filePath = '/virtual/src/features/transform-bad.ts';
    const source = [
      'export function f() {',
      '  try {',
      '    throw new Error("x");',
      '  } catch (e) {',
      '    throw new Error("wrap");',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'missing-error-cause');

    // Assert
    expect(hits.length).toBe(1);
  });

  it('should not report missing-error-cause (catch-transform variant) when cause is preserved', async () => {
    // Arrange
    const filePath = '/virtual/src/features/transform-ok.ts';
    const source = [
      'export function f() {',
      '  try {',
      '    throw new Error("x");',
      '  } catch (e) {',
      '    throw new Error("wrap", { cause: e });',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'missing-error-cause');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report useless-catch for nested bare rethrows (out of scope: redundancy)', async () => {
    // Arrange
    const filePath = '/virtual/src/features/nested-redundant.ts';
    const source = [
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
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis;

    // Assert — every site rethrows the original error unchanged (observability/cause preserved).
    expect(hits.length).toBe(0);
  });

  it('should not report useless-catch for a single bare rethrow (out of scope: redundancy)', async () => {
    // Arrange
    const filePath = '/virtual/src/features/nested-no-outer.ts';
    const source = [
      'export function f() {',
      '  try {',
      '    throw new Error("x");',
      '  } catch (e) {',
      '    throw e;',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis;

    // Assert
    expect(hits.length).toBe(0);
  });

  // --- useless-catch: nested try/catch (complexity is out of scope) ---

  it('should not report useless-catch for nested try/catch complexity (out of scope: redundancy)', async () => {
    // Arrange — nested try/catch is a complexity/redundancy smell, not an error-flow loss.
    const filePath = '/virtual/src/features/nested-try.ts';
    const source = [
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
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis;

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report useless-catch (nested variant) for try/finally without catch nested inside try block', async () => {
    // Arrange
    const filePath = '/virtual/src/features/nested-try-finally.ts';
    const source = [
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
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis;

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report useless-catch (nested variant) for try/catch in catch block (cleanup pattern)', async () => {
    // Arrange
    const filePath = '/virtual/src/features/nested-in-catch.ts';
    const source = [
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
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis;

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report useless-catch (nested variant) for try/catch inside a function defined in try block', async () => {
    // Arrange
    const filePath = '/virtual/src/features/nested-in-function.ts';
    const source = [
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
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis;

    // Assert
    expect(hits.length).toBe(0);
  });

  // --- unsafe-finally: break/continue ---

  it('should report unsafe-finally when finally contains break targeting outer loop', async () => {
    // Arrange
    const filePath = '/virtual/src/features/finally-break.ts';
    const source = [
      'export function f() {',
      '  for (let i = 0; i < 10; i++) {',
      '    try {',
      '      doSomething();',
      '    } finally {',
      '      break;',
      '    }',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBe(1);
  });

  it('should report unsafe-finally when finally contains continue targeting outer loop', async () => {
    // Arrange
    const filePath = '/virtual/src/features/finally-continue.ts';
    const source = [
      'export function f() {',
      '  for (let i = 0; i < 10; i++) {',
      '    try {',
      '      doSomething();',
      '    } finally {',
      '      continue;',
      '    }',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBe(1);
  });

  it('should not report unsafe-finally when break is inside a loop within finally', async () => {
    // Arrange
    const filePath = '/virtual/src/features/finally-break-in-loop.ts';
    const source = [
      'export function f() {',
      '  try {',
      '    doSomething();',
      '  } finally {',
      '    for (let i = 0; i < 10; i++) {',
      '      if (i === 5) break;',
      '    }',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report unsafe-finally when return is inside a nested function in finally', async () => {
    // Arrange
    const filePath = '/virtual/src/features/finally-fn-return.ts';
    const source = [
      'export function f() {',
      '  try {',
      '    doSomething();',
      '  } finally {',
      '    const fn = () => { return 1; };',
      '    fn();',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report unsafe-finally when labeled break targets a label inside finally', async () => {
    // Arrange
    const filePath = '/virtual/src/features/finally-labeled-inner.ts';
    const source = [
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
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report unsafe-finally for .finally callback with return inside nested function', async () => {
    // Arrange
    const filePath = '/virtual/src/features/finally-cb-nested-fn.ts';
    const source = [
      'export function f() {',
      '  return Promise.resolve(1).finally(() => {',
      '    const cleanup = () => { return 1; };',
      '    cleanup();',
      '  });',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBe(0);
  });

  // --- missing-error-cause: extensions ---

  it('should report missing-error-cause for vibe pattern — catch param in Error message', async () => {
    // Arrange
    const filePath = '/virtual/src/features/vibe-pattern.ts';
    const source = [
      'export function f() {',
      '  try {',
      '    doSomething();',
      '  } catch (e) {',
      '    throw new Error(String(e));',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'missing-error-cause');

    // Assert
    expect(hits.length).toBe(1);
  });

  it('should report missing-error-cause for optional catch binding', async () => {
    // Arrange
    const filePath = '/virtual/src/features/optional-catch.ts';
    const source = [
      'export function f() {',
      '  try {',
      '    doSomething();',
      '  } catch {',
      '    throw new Error("operation failed");',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'missing-error-cause');

    // Assert
    expect(hits.length).toBe(1);
  });

  it('should report missing-error-cause for catch param reassignment', async () => {
    // Arrange
    const filePath = '/virtual/src/features/catch-reassign.ts';
    const source = [
      'export function f() {',
      '  try {',
      '    doSomething();',
      '  } catch (e) {',
      '    e = new Error("replaced");',
      '    throw e;',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'missing-error-cause');

    // Assert
    expect(hits.length).toBe(1);
  });

  it('should report missing-error-cause for AggregateError without cause', async () => {
    // Arrange
    const filePath = '/virtual/src/features/aggregate-error.ts';
    const source = [
      'export function f() {',
      '  try {',
      '    doSomething();',
      '  } catch (e) {',
      '    throw new AggregateError([], "multiple failures");',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'missing-error-cause');

    // Assert
    expect(hits.length).toBe(1);
  });

  it('should not report missing-error-cause for AggregateError with cause', async () => {
    // Arrange
    const filePath = '/virtual/src/features/aggregate-error-ok.ts';
    const source = [
      'export function f() {',
      '  try {',
      '    doSomething();',
      '  } catch (e) {',
      '    throw new AggregateError([], "multiple failures", { cause: e });',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'missing-error-cause');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should report missing-error-cause for vibe pattern with e.message', async () => {
    // Arrange
    const filePath = '/virtual/src/features/vibe-message.ts';
    const source = [
      'export function f() {',
      '  try {',
      '    doSomething();',
      '  } catch (e) {',
      '    throw new Error(e.message);',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'missing-error-cause');

    // Assert
    expect(hits.length).toBe(1);
  });

  it('should report missing-error-cause for vibe pattern with template literal', async () => {
    // Arrange
    const filePath = '/virtual/src/features/vibe-template.ts';
    const source = [
      'export function f() {',
      '  try {',
      '    doSomething();',
      '  } catch (e) {',
      '    throw new Error(`Failed: ${e}`);',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'missing-error-cause');

    // Assert
    expect(hits.length).toBe(1);
  });

  it('should not report missing-error-cause when catch returns without throwing', async () => {
    // Arrange
    const filePath = '/virtual/src/features/catch-return.ts';
    const source = [
      'export function f() {',
      '  try {',
      '    return doSomething();',
      '  } catch (e) {',
      '    return defaultValue;',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'missing-error-cause');

    // Assert
    expect(hits.length).toBe(0);
  });

  // --- throw-non-error ---

  it('should report throw-non-error for string literal throw', async () => {
    // Arrange
    const filePath = '/virtual/src/features/throw-string.ts';
    const source = 'export function f() { throw "boom"; }';
    // Act
    const analysis = await analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).toContain('throw-non-error');
  });

  it('should report throw-non-error for numeric literal throw', async () => {
    // Arrange
    const filePath = '/virtual/src/features/throw-number.ts';
    const source = 'export function f() { throw 42; }';
    // Act
    const analysis = await analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).toContain('throw-non-error');
  });

  it('should report throw-non-error for primitive wrapper call (String)', async () => {
    // Arrange
    const filePath = '/virtual/src/features/throw-wrapper.ts';
    const source = 'export function f() { throw String("hello"); }';
    // Act
    const analysis = await analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).toContain('throw-non-error');
  });

  it('should not report throw-non-error for new Error()', async () => {
    // Arrange
    const filePath = '/virtual/src/features/throw-error.ts';
    const source = 'export function f() { throw new Error("x"); }';
    // Act
    const analysis = await analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).not.toContain('throw-non-error');
  });

  it('should not report throw-non-error for factory call', async () => {
    // Arrange
    const filePath = '/virtual/src/features/throw-factory.ts';
    const source = 'export function f() { throw createError(); }';
    // Act
    const analysis = await analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).not.toContain('throw-non-error');
  });

  it('should report throw-non-error for an object literal throw', async () => {
    // Arrange — a plain object is not an Error instance (loses stack/cause).
    const filePath = '/virtual/src/features/throw-object.ts';
    const source = 'export function f() { throw { code: "E_FAIL" }; }';
    // Act
    const analysis = await analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).toContain('throw-non-error');
  });

  it('should report throw-non-error for a string asserted as Error (cast is a runtime lie)', async () => {
    // Arrange — `as unknown as Error` does not change the runtime string; stack is still lost.
    const filePath = '/virtual/src/features/throw-cast.ts';
    const source = 'export function f() { throw "boom" as unknown as Error; }';
    // Act
    const analysis = await analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).toContain('throw-non-error');
  });

  it('should not report throw-non-error for a member-expression throw (could hold an Error)', async () => {
    // Arrange — `state.error` may well be an Error; without proof it gets the benefit of doubt.
    const filePath = '/virtual/src/features/throw-member.ts';
    const source = 'export function f(state: { error: Error }) { throw state.error; }';
    // Act
    const analysis = await analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).not.toContain('throw-non-error');
  });

  it('should not report throw-non-error for an array-element throw (could hold an Error)', async () => {
    // Arrange — `errs[0]` may be an Error; member access is not provably non-Error.
    const filePath = '/virtual/src/features/throw-index.ts';
    const source = 'export function f(errs: Error[]) { throw errs[0]; }';
    // Act
    const analysis = await analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).not.toContain('throw-non-error');
  });

  it('should not report throw-non-error for an identifier of unknown type', async () => {
    // Arrange — a bare identifier (e.g. a catch binding) could be an Error → benefit of doubt.
    const filePath = '/virtual/src/features/throw-ident.ts';
    const source = 'export function f() { try { risky(); } catch (e) { throw e; } }';
    // Act
    const analysis = await analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).not.toContain('throw-non-error');
  });

  it('should report throw-non-error for Promise.reject with a non-Error literal', async () => {
    // Arrange — Promise.reject('x') loses the stack trace / cause like `throw 'x'`.
    const filePath = '/virtual/src/features/reject-literal.ts';
    const source = 'export function f() { return Promise.reject("boom"); }';
    // Act
    const analysis = await analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).toContain('throw-non-error');
  });

  it('should not report throw-non-error for Promise.reject with a new Error', async () => {
    // Arrange
    const filePath = '/virtual/src/features/reject-error.ts';
    const source = 'export function f() { return Promise.reject(new Error("x")); }';
    // Act
    const analysis = await analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).not.toContain('throw-non-error');
  });

  it('should not report throw-non-error for Promise.reject with an identifier', async () => {
    // Arrange — the rejected value could be an Error → benefit of the doubt.
    const filePath = '/virtual/src/features/reject-ident.ts';
    const source = 'export function f(err: unknown) { return Promise.reject(err); }';
    // Act
    const analysis = await analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).not.toContain('throw-non-error');
  });

  // --- return-await-in-try ---

  it('should report return-await-in-try when returning a call without await in try block with catch', async () => {
    // Arrange
    const filePath = '/virtual/src/features/return-no-await.ts';
    const source = [
      'export async function f() {',
      '  try {',
      '    return fetchData();',
      '  } catch (e) {',
      '    handleError(e);',
      '  }',
      '}',
    ].join('\n');
    // Act — gildash proves the callee returns a Promise.
    const analysis = await analyzeWithSemantic(filePath, source, () => true);
    const hits = analysis.filter(f => f.kind === 'return-await-in-try');

    // Assert
    expect(hits.length).toBe(1);
  });

  it('should report return-await-in-try when returning import() without await in try block with catch', async () => {
    // Arrange — dynamic import returns a Promise; without await, catch cannot intercept
    const filePath = '/virtual/src/features/return-import-no-await.ts';
    const source = [
      'export async function f() {',
      '  try {',
      '    return import("./mod");',
      '  } catch (e) {',
      '    return null;',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'return-await-in-try');

    // Assert
    expect(hits.length).toBe(1);
  });

  it('should not report return-await-in-try when return uses await', async () => {
    // Arrange
    const filePath = '/virtual/src/features/return-with-await.ts';
    const source = [
      'export async function f() {',
      '  try {',
      '    return await fetchData();',
      '  } catch (e) {',
      '    handleError(e);',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'return-await-in-try');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report return-await-in-try when return is outside try block', async () => {
    // Arrange
    const filePath = '/virtual/src/features/return-outside-try.ts';
    const source = ['export async function f() {', '  return fetchData();', '}'].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'return-await-in-try');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report return-await-in-try for literal return in try block', async () => {
    // Arrange
    const filePath = '/virtual/src/features/return-literal-in-try.ts';
    const source = [
      'export function f() {',
      '  try {',
      '    return "ok";',
      '  } catch (e) {',
      '    return "error";',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'return-await-in-try');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report return-await-in-try when try has only finally (no catch)', async () => {
    // Arrange
    const filePath = '/virtual/src/features/return-try-finally.ts';
    const source = [
      'export async function f() {',
      '  try {',
      '    return fetchData();',
      '  } finally {',
      '    cleanup();',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'return-await-in-try');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('return-await-in-try - non-async function with return call in try - no finding', async () => {
    // Arrange
    const filePath = '/virtual/src/features/non-async-try.ts';
    const source = [
      'export function f() {',
      '  try {',
      '    return fetch("url");',
      '  } catch (e) {',
      '    console.error(e);',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'return-await-in-try');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('return-await-in-try - semantic Promise CallExpression - flags finding', async () => {
    // Arrange
    const filePath = '/virtual/src/features/semantic-promise.ts';
    const source = [
      'export async function f() {',
      '  try {',
      '    return fetchData();',
      '  } catch (e) {',
      '    console.error(e);',
      '  }',
      '}',
    ].join('\n');
    // Act — CallExpression: target is '(...args: any[]) => PromiseLike<any>'
    const analysis = await analyzeWithSemantic(filePath, source, () => true);
    const hits = analysis.filter(f => f.kind === 'return-await-in-try');

    // Assert
    expect(hits.length).toBe(1);
  });

  it('return-await-in-try - semantic sync CallExpression - no finding', async () => {
    // Arrange
    const filePath = '/virtual/src/features/semantic-sync.ts';
    const source = [
      'export async function f() {',
      '  try {',
      '    return parseInt(s);',
      '  } catch (e) {',
      '    console.error(e);',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeWithSemantic(filePath, source, () => false);
    const hits = analysis.filter(f => f.kind === 'return-await-in-try');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('return-await-in-try - semantic Promise Identifier - flags finding', async () => {
    // Arrange
    const filePath = '/virtual/src/features/semantic-ident-promise.ts';
    const source = [
      'export async function f() {',
      '  const p = fetchData();',
      '  try {',
      '    return p;',
      '  } catch (e) {',
      '    console.error(e);',
      '  }',
      '}',
    ].join('\n');
    // Act — Identifier: target is 'PromiseLike<any>'
    const analysis = await analyzeWithSemantic(filePath, source, () => true);
    const hits = analysis.filter(f => f.kind === 'return-await-in-try');

    // Assert
    expect(hits.length).toBe(1);
  });

  it('return-await-in-try - semantic sync Identifier - no finding', async () => {
    // Arrange
    const filePath = '/virtual/src/features/semantic-ident-sync.ts';
    const source = [
      'export async function f() {',
      '  const val = "hello";',
      '  try {',
      '    return val;',
      '  } catch (e) {',
      '    console.error(e);',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeWithSemantic(filePath, source, () => false);
    const hits = analysis.filter(f => f.kind === 'return-await-in-try');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('return-await-in-try - gildash cannot resolve the type - no finding (conservative)', async () => {
    // Arrange
    const filePath = '/virtual/src/features/semantic-null.ts';
    const source = [
      'export async function f() {',
      '  try {',
      '    return fetchData();',
      '  } catch (e) {',
      '    console.error(e);',
      '  }',
      '}',
    ].join('\n');
    // Act — gildash returns null (cannot determine); there is no flag-all fallback.
    const analysis = await analyzeWithSemantic(filePath, source, () => null);
    const hits = analysis.filter(f => f.kind === 'return-await-in-try');

    // Assert — unresolved type is not flagged (zero-FP over degraded coverage).
    expect(hits.length).toBe(0);
  });

  it('return-await-in-try - semantic union with Promise member (CallExpression) - flags finding', async () => {
    // Arrange
    const filePath = '/virtual/src/features/semantic-union-promise.ts';
    const source = [
      'export async function f() {',
      '  try {',
      '    return fetchData();',
      '  } catch (e) {',
      '    console.error(e);',
      '  }',
      '}',
    ].join('\n');
    // Act — () => Promise<Response> | null is assignable to (...args: any[]) => PromiseLike<any>
    const analysis = await analyzeWithSemantic(filePath, source, () => true);
    const hits = analysis.filter(f => f.kind === 'return-await-in-try');

    // Assert
    expect(hits.length).toBe(1);
  });

  it('return-await-in-try - semantic union all sync members - no finding', async () => {
    // Arrange
    const filePath = '/virtual/src/features/semantic-union-sync.ts';
    const source = [
      'export async function f() {',
      '  try {',
      '    return getValue();',
      '  } catch (e) {',
      '    console.error(e);',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeWithSemantic(filePath, source, () => false);
    const hits = analysis.filter(f => f.kind === 'return-await-in-try');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('return-await-in-try - semantic intersection with Promise member - flags finding', async () => {
    // Arrange
    const filePath = '/virtual/src/features/semantic-intersection-promise.ts';
    const source = [
      'export async function f() {',
      '  try {',
      '    return fetchData();',
      '  } catch (e) {',
      '    console.error(e);',
      '  }',
      '}',
    ].join('\n');
    // Act — () => Promise<Response> & Loggable is assignable to (...args: any[]) => PromiseLike<any>
    const analysis = await analyzeWithSemantic(filePath, source, () => true);
    const hits = analysis.filter(f => f.kind === 'return-await-in-try');

    // Assert
    expect(hits.length).toBe(1);
  });

  it('return-await-in-try - semantic PromiseLike type - flags finding', async () => {
    // Arrange
    const filePath = '/virtual/src/features/semantic-promiselike.ts';
    const source = [
      'export async function f() {',
      '  try {',
      '    return getThenable();',
      '  } catch (e) {',
      '    console.error(e);',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeWithSemantic(filePath, source, () => true);
    const hits = analysis.filter(f => f.kind === 'return-await-in-try');

    // Assert
    expect(hits.length).toBe(1);
  });

  it('return-await-in-try - CallExpression result span is probed with anyConstituent', async () => {
    // Arrange
    const filePath = '/virtual/src/features/semantic-call-target.ts';
    const source = [
      'export async function f() {',
      '  try {',
      '    return fetchData();',
      '  } catch (e) {',
      '    console.error(e);',
      '  }',
      '}',
    ].join('\n');
    // Act — the oracle queries the call-result span for thenable-ness, passing anyConstituent.
    const analysis = await analyzeWithSemantic(filePath, source, (_f, _span, options) => {
      expect(options).toEqual({ anyConstituent: true });

      return true;
    });
    const hits = analysis.filter(f => f.kind === 'return-await-in-try');

    // Assert
    expect(hits.length).toBe(1);
  });

  it('return-await-in-try - Identifier passes anyConstituent option', async () => {
    // Arrange
    const filePath = '/virtual/src/features/semantic-id-target.ts';
    const source = [
      'export async function f() {',
      '  const p = fetchData();',
      '  try {',
      '    return p;',
      '  } catch (e) {',
      '    console.error(e);',
      '  }',
      '}',
    ].join('\n');
    // Act — the value's span is probed for thenable-ness, passing anyConstituent.
    const analysis = await analyzeWithSemantic(filePath, source, (_f, _span, options) => {
      expect(options).toEqual({ anyConstituent: true });

      return true;
    });
    const hits = analysis.filter(f => f.kind === 'return-await-in-try');

    // Assert
    expect(hits.length).toBe(1);
  });

  it('return-await-in-try - semantic layer throws - no finding (conservative)', async () => {
    // Arrange
    const filePath = '/virtual/src/features/semantic-throw.ts';
    const source = [
      'export async function f() {',
      '  try {',
      '    return fetchData();',
      '  } catch (e) {',
      '    console.error(e);',
      '  }',
      '}',
    ].join('\n');
    // Act — mock throws (semantic layer not enabled)
    const analysis = await analyzeWithSemantic(filePath, source, () => {
      throw new Error('semantic layer is not enabled');
    });
    const hits = analysis.filter(f => f.kind === 'return-await-in-try');

    // Assert — a thrown semantic query is swallowed and not flagged.
    expect(hits.length).toBe(0);
  });

  it('return-await-in-try - NewExpression is not flagged (a constructed instance is not a thenable)', async () => {
    // Arrange
    const filePath = '/virtual/src/features/return-new-expr.ts';
    const source = [
      'export async function f() {',
      '  try {',
      '    return new MyPromise(resolve => resolve(1));',
      '  } catch (e) {',
      '    console.error(e);',
      '  }',
      '}',
    ].join('\n');
    // Act — even with gildash, `new X()` results are not treated as promises here.
    const analysis = await analyzeWithSemantic(filePath, source, () => true);
    const hits = analysis.filter(f => f.kind === 'return-await-in-try');

    // Assert
    expect(hits.length).toBe(0);
  });

  // --- promise-constructor-hygiene ---

  it('should report promise-constructor-hygiene for async executor', async () => {
    // Arrange
    const filePath = '/virtual/src/features/async-executor.ts';
    const source = 'export const p = new Promise(async () => { await fetch("/"); });';
    // Act
    const analysis = await analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).toContain('promise-constructor-hygiene');
  });

  it('should report promise-constructor-hygiene for globalThis.Promise async executor', async () => {
    // Arrange
    const filePath = '/virtual/src/features/async-executor-global.ts';
    const source = 'export const p = new globalThis.Promise(async () => { await fetch("/"); });';
    // Act
    const analysis = await analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).toContain('promise-constructor-hygiene');
  });

  it('should not report promise-constructor-hygiene for sync executor with resolve', async () => {
    // Arrange
    const filePath = '/virtual/src/features/sync-executor.ts';
    const source = 'export const p = new Promise((resolve) => { resolve(42); });';
    // Act
    const analysis = await analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).not.toContain('promise-constructor-hygiene');
  });

  it('should not report promise-constructor-hygiene for throw inside nested function in executor', async () => {
    // Arrange
    const filePath = '/virtual/src/features/executor-throw-nested.ts';
    const source = [
      'export const p = new Promise((resolve) => {',
      '  setTimeout(() => { throw new Error("timeout"); }, 100);',
      '  resolve(42);',
      '});',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'promise-constructor-hygiene');

    // Assert — throw is inside setTimeout callback, not executor itself
    expect(hits.length).toBe(0);
  });

  it('should not report promise-constructor-hygiene for a bare throw before settling', async () => {
    // Arrange — a throw before resolve/reject is converted to a rejection by the Promise
    // constructor (observable, propagated, cause preserved), so it is K.
    const filePath = '/virtual/src/features/executor-throw.ts';
    const source = [
      'export const p = new Promise((resolve) => {',
      '  if (!valid) throw new Error("invalid");',
      '  resolve(42);',
      '});',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'promise-constructor-hygiene');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should report promise-constructor-hygiene for a throw after settling', async () => {
    // Arrange — once resolve has run the promise is settled, so the later throw is swallowed.
    const filePath = '/virtual/src/features/executor-throw-after-settle.ts';
    const source = [
      'export const p = new Promise((resolve) => {',
      '  resolve(42);',
      '  throw new Error("swallowed");',
      '});',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).toContain('promise-constructor-hygiene');
  });

  it('should not report promise-constructor-hygiene for a return inside a sync executor (out of scope)', async () => {
    // Arrange — a value `return` in the executor is hygiene, not error propagation. (The same holds
    // for the `return reject(err)` early-exit idiom, where the rejection is still delivered.)
    const filePath = '/virtual/src/features/executor-return.ts';
    const source = ['export const p = new Promise((resolve) => {', '  return 42;', '});'].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'promise-constructor-hygiene');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should report promise-constructor-hygiene for swapped params (reject, resolve)', async () => {
    // Arrange
    const filePath = '/virtual/src/features/swapped-params.ts';
    const source = 'export const p = new Promise((reject, resolve) => { resolve(42); });';
    // Act
    const analysis = await analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).toContain('promise-constructor-hygiene');
  });

  it('should not report promise-constructor-hygiene for new Promise in an async function (out of scope: style)', async () => {
    // Arrange — "prefer await over new Promise" is a style preference; the promise here is
    // returned, so its rejection is fully observable/propagated.
    const filePath = '/virtual/src/features/unnecessary-promise.ts';
    const source = ['export async function f() {', '  return new Promise((resolve) => {', '    resolve(42);', '  });', '}'].join(
      '\n',
    );
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'promise-constructor-hygiene');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report unnecessary new Promise when wrapping callback API', async () => {
    // Arrange
    const filePath = '/virtual/src/features/callback-wrap.ts';
    const source = [
      'export async function f() {',
      '  return new Promise((resolve) => {',
      '    emitter.on("data", resolve);',
      '  });',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'promise-constructor-hygiene');

    // Assert — callback wrapping is allowed, so no finding
    expect(hits.length).toBe(0);
  });

  // --- no-return-wrap ---

  it('should not report no-return-wrap for Promise.resolve in then expression body (out of scope: style)', async () => {
    // Arrange — Promise.resolve wrapping is redundant style; the value still flows onward.
    const filePath = '/virtual/src/features/return-wrap-expr.ts';
    const source = 'export const p = Promise.resolve(1).then(x => Promise.resolve(x + 1));';
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis;

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report no-return-wrap for Promise.resolve in then block body (out of scope: style)', async () => {
    // Arrange
    const filePath = '/virtual/src/features/return-wrap-block.ts';
    const source = ['export const p = Promise.resolve(1).then(x => {', '  return Promise.resolve(x + 1);', '});'].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis;

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report no-return-wrap for direct value return in then callback', async () => {
    // Arrange
    const filePath = '/virtual/src/features/return-direct.ts';
    const source = 'export const p = Promise.resolve(1).then(x => x + 1);';
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis;

    // Assert
    expect(hits.length).toBe(0);
  });

  // --- always-return ---

  it('should not report always-return for a then callback without return (out of scope: style)', async () => {
    // Arrange — a missing return is a chain-style smell, not an error-flow loss.
    const filePath = '/virtual/src/features/always-return.ts';
    const source = ['export const p = Promise.resolve(1).then(x => {', '  console.log(x);', '});'].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis;

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report always-return when then callback returns a value', async () => {
    // Arrange
    const filePath = '/virtual/src/features/always-return-ok.ts';
    const source = ['export const p = Promise.resolve(1).then(x => {', '  return x + 1;', '});'].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis;

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report always-return when then callback has expression body', async () => {
    // Arrange
    const filePath = '/virtual/src/features/always-return-expr.ts';
    const source = 'export const p = Promise.resolve(1).then(x => console.log(x));';
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis;

    // Assert — expression body always returns implicitly
    expect(hits.length).toBe(0);
  });

  it('should not report always-return for a return only in an inner function (out of scope: style)', async () => {
    // Arrange
    const filePath = '/virtual/src/features/always-return-nested-fn.ts';
    const source = [
      'export const p = Promise.resolve(1).then(x => {',
      '  const log = () => { return x; };',
      '  log();',
      '});',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis;

    // Assert
    expect(hits.length).toBe(0);
  });

  // --- no-return-wrap: additional ---

  it('should not report no-return-wrap for Promise.reject wrapping (out of scope: style)', async () => {
    // Arrange — wrapping is redundant style; the rejection still propagates down the chain.
    const filePath = '/virtual/src/features/return-wrap-reject.ts';
    const source = 'export const p = Promise.resolve(1).then(x => Promise.reject(new Error("fail")));';
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis;

    // Assert
    expect(hits.length).toBe(0);
  });

  // --- catch-or-return: additional ---

  it('should not report catch-or-return when catch comes before then', async () => {
    // Arrange
    const filePath = '/virtual/src/features/catch-before-then.ts';
    const source = [
      'export function f() {',
      '  doThing().catch(() => 0).then(() => 1);',
      '}',
      'function doThing() { return Promise.resolve(1); }',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'catch-or-return');

    // Assert — catch is already in the chain, even if before then
    expect(hits.length).toBe(0);
  });

  // --- no-callback-in-promise ---

  it('should report no-callback-in-promise when callback API is used inside then', async () => {
    // Arrange
    const filePath = '/virtual/src/features/callback-in-promise.ts';
    const source = [
      'import * as fs from "fs";',
      'export const p = fetch("/api").then(res => {',
      '  fs.readFile("data.txt", (err, data) => {',
      '    console.log(data);',
      '  });',
      '});',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'no-callback-in-promise');

    // Assert
    expect(hits.length).toBe(1);
  });

  it('should not report no-callback-in-promise when no callback API is used', async () => {
    // Arrange
    const filePath = '/virtual/src/features/no-callback-ok.ts';
    const source = ['export const p = fetch("/api").then(res => {', '  return res.json();', '});'].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'no-callback-in-promise');

    // Assert
    expect(hits.length).toBe(0);
  });

  // --- unobserved-variable ---

  it('should report unobserved-variable when Promise call result is never awaited', async () => {
    // Arrange — the oracle confirms the init expression's type is a thenable.
    const filePath = '/virtual/src/features/unobserved-var.ts';
    const source = ['export function f() {', '  const p = fetchData();', '  console.log("done");', '}'].join('\n');
    // Act
    const analysis = await analyzeWithSemantic(filePath, source, () => true);
    const hits = analysis.filter(f => f.kind === 'unobserved-variable');

    // Assert
    expect(hits.length).toBe(1);
  });

  it('should not report unobserved-variable when non-Promise call result (gildash confirms)', async () => {
    // Arrange — the oracle confirms the init expression's type is NOT a thenable.
    const filePath = '/virtual/src/features/sync-var.ts';
    const source = ['export function f() {', '  const x = getData();', '  console.log("done");', '}'].join('\n');
    // Act
    const analysis = await analyzeWithSemantic(filePath, source, () => false);
    const hits = analysis.filter(f => f.kind === 'unobserved-variable');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report unobserved-variable when gildash is unavailable (conservative fallback)', async () => {
    // Arrange — without gildash, detector cannot confirm Promise-ness of the call result.
    // Fallback policy: register NO candidates (vs. the old behavior of registering ALL,
    // which re-introduced the original broad-FP regression).
    const filePath = '/virtual/src/features/no-gildash.ts';
    const source = ['export function f() {', '  const x = syncHelper();', '  console.log("done");', '}'].join('\n');
    const program = [parseSource(filePath, source)];
    // Act — no gildash passed
    const analysis = analyzeErrorFlow(program);
    const hits = analysis.filter(f => f.kind === 'unobserved-variable');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report unobserved-variable when gildash throws (conservative fallback)', async () => {
    // Arrange — gildash present but its semantic methods throw.
    // Same conservative policy: don't broadcast FP for every call result.
    const filePath = '/virtual/src/features/gildash-throws.ts';
    const source = ['export function f() {', '  const x = syncHelper();', '  console.log("done");', '}'].join('\n');
    const program = [parseSource(filePath, source)];
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
    // Act
    const analysis = analyzeErrorFlow(program, { gildash: throwingGildash });
    const hits = analysis.filter(f => f.kind === 'unobserved-variable');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report unobserved-variable when call result is awaited', async () => {
    // Arrange — the init is a thenable (candidate registered); the `await p` read observes it.
    const filePath = '/virtual/src/features/observed-var.ts';
    const source = ['export async function f() {', '  const p = fetchData();', '  await p;', '}'].join('\n');
    // Act
    const analysis = await analyzeWithSemantic(filePath, source, () => true);
    const hits = analysis.filter(f => f.kind === 'unobserved-variable');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report unobserved-variable when call result is returned', async () => {
    // Arrange — the init is a thenable (candidate registered); the `return p` read observes it.
    const filePath = '/virtual/src/features/returned-var.ts';
    const source = ['export function f() {', '  const p = fetchData();', '  return p;', '}'].join('\n');
    // Act
    const analysis = await analyzeWithSemantic(filePath, source, () => true);
    const hits = analysis.filter(f => f.kind === 'unobserved-variable');

    // Assert
    expect(hits.length).toBe(0);
  });

  // --- missing-error-cause: indirect throw via variable ---

  it('should report missing-error-cause when error is assigned to variable then thrown without cause', async () => {
    // Arrange
    const filePath = '/virtual/src/features/indirect-throw.ts';
    const source = [
      'export function f() {',
      '  try { doSomething(); } catch (e) {',
      '    const wrapped = new Error("failed");',
      '    throw wrapped;',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'missing-error-cause');

    // Assert
    expect(hits.length).toBe(1);
  });

  it('should not report missing-error-cause when error variable has cause and is thrown', async () => {
    // Arrange
    const filePath = '/virtual/src/features/indirect-throw-ok.ts';
    const source = [
      'export function f() {',
      '  try { doSomething(); } catch (e) {',
      '    const wrapped = new Error("failed", { cause: e });',
      '    throw wrapped;',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'missing-error-cause');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should report missing-error-cause when error variable is declared inside nested block in catch', async () => {
    // Arrange
    const filePath = '/virtual/src/features/indirect-throw-nested.ts';
    const source = [
      'export function f() {',
      '  try { doSomething(); } catch (e) {',
      '    if (isRetryable(e)) {',
      '      const wrapped = new Error("retry failed");',
      '      throw wrapped;',
      '    }',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'missing-error-cause');

    // Assert
    expect(hits.length).toBe(1);
  });
});
