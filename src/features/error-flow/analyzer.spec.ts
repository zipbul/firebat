import type { Gildash } from '@zipbul/gildash';

import { describe, expect, it } from 'bun:test';

import { parseSource } from '../../engine/ast/parse-source';
import { analyzeErrorFlow } from './analyzer';

const noopGildash = {
  isTypeAssignableToType: () => null,
  getResolvedTypesAtPositions: () => new Map(),
  isTypeAssignableToTypeAtPositions: () => new Map<number, boolean>(),
} as unknown as Gildash;

const analyzeSingle = async (filePath: string, sourceText: string) => {
  // Arrange
  const program = [parseSource(filePath, sourceText)];
  // Act
  const findings = await analyzeErrorFlow(program, { gildash: noopGildash });

  // Assert (shape)
  expect(Array.isArray(findings)).toBe(true);

  return findings;
};

const analyzeWithSemantic = async (
  filePath: string,
  sourceText: string,
  mockIsTypeAssignableToType: (
    filePath: string,
    position: number,
    targetTypeExpression: string,
    options?: { anyConstituent?: boolean },
  ) => boolean | null,
  mockBatchPositions?: (
    filePath: string,
    positions: number[],
    targetTypeExpression: string,
    options?: { anyConstituent?: boolean },
  ) => Map<number, boolean>,
) => {
  const program = [parseSource(filePath, sourceText)];
  const gildash = {
    isTypeAssignableToType: mockIsTypeAssignableToType,
    getResolvedTypesAtPositions: (_f: string, positions: number[]) => {
      const result = new Map<number, { text: string; flags: number }>();

      for (const pos of positions) {
        result.set(pos, { text: 'unknown', flags: 0 });
      }

      return result;
    },
    isTypeAssignableToTypeAtPositions:
      mockBatchPositions ??
      ((_f: string, positions: number[]) => {
        const result = new Map<number, boolean>();

        for (const pos of positions) {
          result.set(pos, true);
        }

        return result;
      }),
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
    const findings = await analyzeErrorFlow(program, { gildash: noopGildash });

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
    expect(findings.length).toBeGreaterThanOrEqual(1);

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

  it('should report useless-catch when catch rethrows the same error', async () => {
    // Arrange
    const filePath = '/virtual/src/features/useless.ts';
    const source = ['export function f() {', '  try {', '    return 1;', '  } catch (e) {', '    throw e;', '  }', '}'].join(
      '\n',
    );
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'useless-catch');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should report useless-catch when catch rethrows the same error with a different name', async () => {
    // Arrange
    const filePath = '/virtual/src/features/useless-rename.ts';
    const source = ['export function f() {', '  try {', '    return 1;', '  } catch (err) {', '    throw err;', '  }', '}'].join(
      '\n',
    );
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'useless-catch');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
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
    const hits = analysis.filter(f => f.kind === 'useless-catch');

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
    const hits = analysis.filter(f => f.kind === 'useless-catch');

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
    const hits = analysis.filter(f => f.kind === 'useless-catch');

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
    expect(hits.length).toBeGreaterThanOrEqual(1);
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
    expect(hits.length).toBeGreaterThanOrEqual(1);
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
    expect(hits.length).toBeGreaterThanOrEqual(1);
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

  it('should report unsafe-finally when finally callback returns a value', async () => {
    // Arrange
    const filePath = '/virtual/src/features/promise-finally.ts';
    const source = ['export function f() {', '  return Promise.resolve(1).finally(() => {', '    return 2;', '  });', '}'].join(
      '\n',
    );
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should report unsafe-finally when finally callback has expression body', async () => {
    // Arrange
    const filePath = '/virtual/src/features/promise-finally-expr.ts';
    const source = ['export function f() {', '  return Promise.resolve(1).finally(() => 1);', '}'].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should report unsafe-finally when finally callback returns undefined explicitly', async () => {
    // Arrange
    const filePath = '/virtual/src/features/promise-finally-undefined.ts';
    const source = [
      'export function f() {',
      '  return Promise.resolve(1).finally(() => {',
      '    return undefined;',
      '  });',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
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
    expect(hits.length).toBeGreaterThanOrEqual(1);
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

  it('should report prefer-catch when then handles rejection with a second argument', async () => {
    // Arrange
    const filePath = '/virtual/src/features/prefer-catch.ts';
    const source = ['export function f() {', '  return Promise.resolve(1).then(() => 1, () => 0);', '}'].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'prefer-catch');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should report prefer-catch even when a catch is also chained', async () => {
    // Arrange
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
    const hits = analysis.filter(f => f.kind === 'prefer-catch');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should not report prefer-catch when catch is used', async () => {
    // Arrange
    const filePath = '/virtual/src/features/prefer-catch-ok.ts';
    const source = ['export function f() {', '  return Promise.resolve(1).then(() => 1).catch(() => 0);', '}'].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'prefer-catch');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should report prefer-await-to-then when then-chains are long and used for control flow', async () => {
    // Arrange
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
    const hits = analysis.filter(f => f.kind === 'prefer-await-to-then');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should report prefer-await-to-then when then-chain contains side effects', async () => {
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
    const hits = analysis.filter(f => f.kind === 'prefer-await-to-then');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should not report prefer-await-to-then when then is a short value mapping', async () => {
    // Arrange
    const filePath = '/virtual/src/features/prefer-await-ok.ts';
    const source = ['export function f() {', '  return Promise.resolve(1).then(x => x + 1);', '}'].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'prefer-await-to-then');

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
    const hits = analysis.filter(f => f.kind === 'prefer-await-to-then');

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
    expect(analysis.filter(f => f.kind === 'floating-promises').length).toBeGreaterThanOrEqual(1);
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
    // Arrange
    const filePath = '/virtual/src/features/single-violation.ts';
    const source = ['export function f() {', '  Promise.resolve(1).then(() => 1, () => 0);', '}'].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).toContain('prefer-catch');
    expect(kinds(analysis)).not.toContain('useless-catch');
    expect(kinds(analysis)).not.toContain('unsafe-finally');
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
    expect(hits.length).toBeGreaterThanOrEqual(1);
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

  it('should report useless-catch when an inner useless catch exists under an outer catch', async () => {
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
    const hits = analysis.filter(f => f.kind === 'useless-catch');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should not report useless-catch (nested variant) when there is no outer catch', async () => {
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
    const hits = analysis.filter(f => f.kind === 'useless-catch');

    // Assert
    expect(hits.length).toBe(1);
  });

  // --- useless-catch: nested try/catch ---

  it('should report useless-catch for nested try/catch inside try block', async () => {
    // Arrange
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
    const hits = analysis.filter(f => f.kind === 'useless-catch');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
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
    const hits = analysis.filter(f => f.kind === 'useless-catch');

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
    const hits = analysis.filter(f => f.kind === 'useless-catch');

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
    const hits = analysis.filter(f => f.kind === 'useless-catch');

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
    expect(hits.length).toBeGreaterThanOrEqual(1);
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
    expect(hits.length).toBeGreaterThanOrEqual(1);
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
    expect(hits.length).toBeGreaterThanOrEqual(1);
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
    expect(hits.length).toBeGreaterThanOrEqual(1);
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
    expect(hits.length).toBeGreaterThanOrEqual(1);
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
    expect(hits.length).toBeGreaterThanOrEqual(1);
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
    expect(hits.length).toBeGreaterThanOrEqual(1);
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
    expect(hits.length).toBeGreaterThanOrEqual(1);
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

  // --- P3-1 throw-non-error ---

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
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'return-await-in-try');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
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
    expect(hits.length).toBeGreaterThanOrEqual(1);
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

  it('return-await-in-try - isTypeAssignableToType returns null - falls back to AST heuristic', async () => {
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
    // Act
    const analysis = await analyzeWithSemantic(filePath, source, () => null);
    const hits = analysis.filter(f => f.kind === 'return-await-in-try');

    // Assert — CallExpression이므로 AST 휴리스틱으로 플래그
    expect(hits.length).toBe(1);
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

  it('return-await-in-try - CallExpression passes function target type', async () => {
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
    // Act — mock inspects targetTypeExpression
    const analysis = await analyzeWithSemantic(filePath, source, (_f, _p, target, options) => {
      expect(target).toBe('(...args: any[]) => PromiseLike<any>');
      expect(options).toBeUndefined();

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
    // Act — mock inspects targetTypeExpression and options
    const analysis = await analyzeWithSemantic(filePath, source, (_f, _p, target, options) => {
      expect(target).toBe('PromiseLike<any>');
      expect(options).toEqual({ anyConstituent: true });

      return true;
    });
    const hits = analysis.filter(f => f.kind === 'return-await-in-try');

    // Assert
    expect(hits.length).toBe(1);
  });

  it('return-await-in-try - semantic layer throws - falls back to AST heuristic', async () => {
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

    // Assert — CallExpression이므로 AST 휴리스틱으로 플래그
    expect(hits.length).toBe(1);
  });

  it('return-await-in-try - fallback NewExpression in async function - flags finding', async () => {
    // Arrange
    const filePath = '/virtual/src/features/fallback-new-expr.ts';
    const source = [
      'export async function f() {',
      '  try {',
      '    return new MyPromise(resolve => resolve(1));',
      '  } catch (e) {',
      '    console.error(e);',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'return-await-in-try');

    // Assert
    expect(hits.length).toBe(1);
  });

  // --- P3-2 promise-constructor-hygiene ---

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

  it('should report promise-constructor-hygiene for throw in sync executor', async () => {
    // Arrange
    const filePath = '/virtual/src/features/executor-throw.ts';
    const source = [
      'export const p = new Promise((resolve) => {',
      '  if (!valid) throw new Error("invalid");',
      '  resolve(42);',
      '});',
    ].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).toContain('promise-constructor-hygiene');
  });

  it('should report promise-constructor-hygiene for return value in executor', async () => {
    // Arrange
    const filePath = '/virtual/src/features/executor-return.ts';
    const source = ['export const p = new Promise((resolve) => {', '  return 42;', '});'].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).toContain('promise-constructor-hygiene');
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

  it('should report promise-constructor-hygiene for unnecessary new Promise in async function', async () => {
    // Arrange
    const filePath = '/virtual/src/features/unnecessary-promise.ts';
    const source = ['export async function f() {', '  return new Promise((resolve) => {', '    resolve(42);', '  });', '}'].join(
      '\n',
    );
    // Act
    const analysis = await analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).toContain('promise-constructor-hygiene');
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

  it('should report no-return-wrap for Promise.resolve in then callback expression body', async () => {
    // Arrange
    const filePath = '/virtual/src/features/return-wrap-expr.ts';
    const source = 'export const p = Promise.resolve(1).then(x => Promise.resolve(x + 1));';
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'no-return-wrap');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should report no-return-wrap for Promise.resolve in then callback block body', async () => {
    // Arrange
    const filePath = '/virtual/src/features/return-wrap-block.ts';
    const source = ['export const p = Promise.resolve(1).then(x => {', '  return Promise.resolve(x + 1);', '});'].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'no-return-wrap');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should not report no-return-wrap for direct value return in then callback', async () => {
    // Arrange
    const filePath = '/virtual/src/features/return-direct.ts';
    const source = 'export const p = Promise.resolve(1).then(x => x + 1);';
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'no-return-wrap');

    // Assert
    expect(hits.length).toBe(0);
  });

  // --- always-return ---

  it('should report always-return when then callback has block body without return', async () => {
    // Arrange
    const filePath = '/virtual/src/features/always-return.ts';
    const source = ['export const p = Promise.resolve(1).then(x => {', '  console.log(x);', '});'].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'always-return');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should not report always-return when then callback returns a value', async () => {
    // Arrange
    const filePath = '/virtual/src/features/always-return-ok.ts';
    const source = ['export const p = Promise.resolve(1).then(x => {', '  return x + 1;', '});'].join('\n');
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'always-return');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report always-return when then callback has expression body', async () => {
    // Arrange
    const filePath = '/virtual/src/features/always-return-expr.ts';
    const source = 'export const p = Promise.resolve(1).then(x => console.log(x));';
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'always-return');

    // Assert — expression body always returns implicitly
    expect(hits.length).toBe(0);
  });

  it('should report always-return when then callback has nested return only in inner function', async () => {
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
    const hits = analysis.filter(f => f.kind === 'always-return');

    // Assert — inner function's return doesn't count as callback return
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  // --- no-return-wrap: additional ---

  it('should report no-return-wrap for Promise.reject wrapping in then callback', async () => {
    // Arrange
    const filePath = '/virtual/src/features/return-wrap-reject.ts';
    const source = 'export const p = Promise.resolve(1).then(x => Promise.reject(new Error("fail")));';
    // Act
    const analysis = await analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'no-return-wrap');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
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
    expect(hits.length).toBeGreaterThanOrEqual(1);
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
    // Arrange — gildash batch confirms fetchData returns Promise
    const filePath = '/virtual/src/features/unobserved-var.ts';
    const source = ['export function f() {', '  const p = fetchData();', '  console.log("done");', '}'].join('\n');
    // Act
    const analysis = await analyzeWithSemantic(filePath, source, () => null);
    const hits = analysis.filter(f => f.kind === 'unobserved-variable');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should not report unobserved-variable when non-Promise call result (gildash confirms)', async () => {
    // Arrange — gildash batch confirms fetchData does NOT return Promise
    const filePath = '/virtual/src/features/sync-var.ts';
    const source = ['export function f() {', '  const x = getData();', '  console.log("done");', '}'].join('\n');
    // Act
    const analysis = await analyzeWithSemantic(
      filePath,
      source,
      () => null,
      (_f, positions) => {
        const m = new Map<number, boolean>();

        for (const p of positions) {
          m.set(p, false);
        }

        return m;
      },
    );
    const hits = analysis.filter(f => f.kind === 'unobserved-variable');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report unobserved-variable when call result is awaited', async () => {
    // Arrange
    const filePath = '/virtual/src/features/observed-var.ts';
    const source = ['export async function f() {', '  const p = fetchData();', '  await p;', '}'].join('\n');
    // Act
    const analysis = await analyzeWithSemantic(filePath, source, () => null);
    const hits = analysis.filter(f => f.kind === 'unobserved-variable');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report unobserved-variable when call result is returned', async () => {
    // Arrange
    const filePath = '/virtual/src/features/returned-var.ts';
    const source = ['export function f() {', '  const p = fetchData();', '  return p;', '}'].join('\n');
    // Act
    const analysis = await analyzeWithSemantic(filePath, source, () => null);
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
    expect(hits.length).toBeGreaterThanOrEqual(1);
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
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });
});
