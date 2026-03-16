import { describe, expect, it } from 'bun:test';

import { parseSource } from '../../engine/ast/parse-source';
import { analyzeErrorFlow } from './analyzer';

const analyzeSingle = (filePath: string, sourceText: string) => {
  // Arrange
  const program = [parseSource(filePath, sourceText)];
  // Act
  const findings = analyzeErrorFlow(program);

  // Assert (shape)
  expect(Array.isArray(findings)).toBe(true);

  return findings;
};

const kinds = (findings: ReturnType<typeof analyzeSingle>) => findings.map(f => f.kind);

const assertFindingShape = (findings: ReturnType<typeof analyzeSingle>) => {
  // Act / Assert
  for (const finding of findings) {
    expect(finding.evidence.length).toBeGreaterThan(0);
    expect(finding.file.length).toBeGreaterThan(0);
    expect(finding.span.start.line).toBeGreaterThanOrEqual(1);
    expect(finding.span.end.line).toBeGreaterThanOrEqual(finding.span.start.line);
  }
};

describe('error-flow/analyzer', () => {
  it('should return no findings when input is empty', () => {
    // Arrange
    const program: ReturnType<typeof parseSource>[] = [];
    // Act
    const findings = analyzeErrorFlow(program);

    // Assert
    expect(findings.length).toBe(0);
  });

  it('should not include natural-language fields in findings', () => {
    // Arrange
    const filePath = '/virtual/src/adapters/cli/entry.ts';
    const source = [
      'export function f() {',
      '  doThing().then(() => 1);',
      '}',
      'function doThing() { return Promise.resolve(1); }',
    ].join('\n');
    // Act
    const findings = analyzeSingle(filePath, source);

    // Assert
    expect(findings.length).toBeGreaterThanOrEqual(1);
    assertFindingShape(findings);

    const sample = findings[0] as unknown as Record<string, unknown>;

    expect(sample.filePath).toBeUndefined();
    expect(sample.message).toBeUndefined();
    expect(sample.recipes).toBeUndefined();
  });

  it('should report useless-catch when catch rethrows the same error', () => {
    // Arrange
    const filePath = '/virtual/src/features/useless.ts';
    const source = ['export function f() {', '  try {', '    return 1;', '  } catch (e) {', '    throw e;', '  }', '}'].join(
      '\n',
    );
    // Act
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'useless-catch');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should report useless-catch when catch rethrows the same error with a different name', () => {
    // Arrange
    const filePath = '/virtual/src/features/useless-rename.ts';
    const source = ['export function f() {', '  try {', '    return 1;', '  } catch (err) {', '    throw err;', '  }', '}'].join(
      '\n',
    );
    // Act
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'useless-catch');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should not report useless-catch when catch logs and rethrows', () => {
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
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'useless-catch');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report useless-catch when catch rethrows a new error with cause', () => {
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
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'useless-catch');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report useless-catch when catch adds context', () => {
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
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'useless-catch');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should report unsafe-finally when finally returns and masks a throw', () => {
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
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should report unsafe-finally when finally throws and masks a return', () => {
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
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should report unsafe-finally when nested return exists inside finally', () => {
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
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should not report unsafe-finally when finally only performs cleanup', () => {
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
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should report unsafe-finally when finally callback returns a value', () => {
    // Arrange
    const filePath = '/virtual/src/features/promise-finally.ts';
    const source = ['export function f() {', '  return Promise.resolve(1).finally(() => {', '    return 2;', '  });', '}'].join(
      '\n',
    );
    // Act
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should report unsafe-finally when finally callback has expression body', () => {
    // Arrange
    const filePath = '/virtual/src/features/promise-finally-expr.ts';
    const source = ['export function f() {', '  return Promise.resolve(1).finally(() => 1);', '}'].join('\n');
    // Act
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should report unsafe-finally when finally callback returns undefined explicitly', () => {
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
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should not report unsafe-finally (.finally() variant) when finally callback has no return', () => {
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
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should report catch-or-return when a then-chain has no catch', () => {
    // Arrange
    const filePath = '/virtual/src/features/then-no-catch.ts';
    const source = [
      'export function f() {',
      '  doThing().then(() => 1);',
      '}',
      'function doThing() { return Promise.resolve(1); }',
    ].join('\n');
    // Act
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'catch-or-return');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should not report catch-or-return when then-chain is returned', () => {
    // Arrange
    const filePath = '/virtual/src/features/then-returned.ts';
    const source = [
      'export function f() {',
      '  return doThing().then(() => 1);',
      '}',
      'function doThing() { return Promise.resolve(1); }',
    ].join('\n');
    // Act
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'catch-or-return');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report catch-or-return when then-chain is awaited', () => {
    // Arrange
    const filePath = '/virtual/src/features/then-awaited.ts';
    const source = [
      'export async function f() {',
      '  await doThing().then(() => 1);',
      '}',
      'function doThing() { return Promise.resolve(1); }',
    ].join('\n');
    // Act
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'catch-or-return');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report catch-or-return when promise chain has catch', () => {
    // Arrange
    const filePath = '/virtual/src/features/then-has-catch.ts';
    const source = [
      'export function f() {',
      '  doThing().then(() => 1).catch(() => 0);',
      '}',
      'function doThing() { return Promise.resolve(1); }',
    ].join('\n');
    // Act
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'catch-or-return');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should report prefer-catch when then handles rejection with a second argument', () => {
    // Arrange
    const filePath = '/virtual/src/features/prefer-catch.ts';
    const source = ['export function f() {', '  return Promise.resolve(1).then(() => 1, () => 0);', '}'].join('\n');
    // Act
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'prefer-catch');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should report prefer-catch even when a catch is also chained', () => {
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
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'prefer-catch');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should not report prefer-catch when catch is used', () => {
    // Arrange
    const filePath = '/virtual/src/features/prefer-catch-ok.ts';
    const source = ['export function f() {', '  return Promise.resolve(1).then(() => 1).catch(() => 0);', '}'].join('\n');
    // Act
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'prefer-catch');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should report prefer-await-to-then when then-chains are long and used for control flow', () => {
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
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'prefer-await-to-then');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should report prefer-await-to-then when then-chain contains side effects', () => {
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
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'prefer-await-to-then');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should not report prefer-await-to-then when then is a short value mapping', () => {
    // Arrange
    const filePath = '/virtual/src/features/prefer-await-ok.ts';
    const source = ['export function f() {', '  return Promise.resolve(1).then(x => x + 1);', '}'].join('\n');
    // Act
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'prefer-await-to-then');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report prefer-await-to-then when chain is short even if callback uses block', () => {
    // Arrange
    const filePath = '/virtual/src/features/prefer-await-short-block.ts';
    const source = ['export function f() {', '  return Promise.resolve(1).then(x => {', '    return x + 1;', '  });', '}'].join(
      '\n',
    );
    // Act
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'prefer-await-to-then');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not over-report unrelated kinds when only one rule is violated', () => {
    // Arrange
    const filePath = '/virtual/src/features/single-violation.ts';
    const source = ['export function f() {', '  Promise.resolve(1).then(() => 1, () => 0);', '}'].join('\n');
    // Act
    const analysis = analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).toContain('prefer-catch');
    expect(kinds(analysis)).not.toContain('useless-catch');
    expect(kinds(analysis)).not.toContain('unsafe-finally');
  });

  it('should report missing-error-cause when catch throws new Error without cause', () => {
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
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'missing-error-cause');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should not report missing-error-cause (catch-transform variant) when cause is preserved', () => {
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
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'missing-error-cause');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should report useless-catch when an inner useless catch exists under an outer catch', () => {
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
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'useless-catch');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should not report useless-catch (nested variant) when there is no outer catch', () => {
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
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'useless-catch');

    // Assert
    expect(hits.length).toBe(1);
  });

  // --- useless-catch: nested try/catch ---

  it('should report useless-catch for nested try/catch inside try block', () => {
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
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'useless-catch');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should not report useless-catch (nested variant) for try/finally without catch nested inside try block', () => {
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
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'useless-catch');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report useless-catch (nested variant) for try/catch in catch block (cleanup pattern)', () => {
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
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'useless-catch');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report useless-catch (nested variant) for try/catch inside a function defined in try block', () => {
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
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'useless-catch');

    // Assert
    expect(hits.length).toBe(0);
  });

  // --- unsafe-finally: break/continue ---

  it('should report unsafe-finally when finally contains break targeting outer loop', () => {
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
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should report unsafe-finally when finally contains continue targeting outer loop', () => {
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
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should not report unsafe-finally when break is inside a loop within finally', () => {
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
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report unsafe-finally when return is inside a nested function in finally', () => {
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
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBe(0);
  });

  // --- missing-error-cause: extensions ---

  it('should report missing-error-cause for vibe pattern — catch param in Error message', () => {
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
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'missing-error-cause');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should report missing-error-cause for optional catch binding', () => {
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
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'missing-error-cause');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should report missing-error-cause for catch param reassignment', () => {
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
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'missing-error-cause');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should report missing-error-cause for AggregateError without cause', () => {
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
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'missing-error-cause');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should not report missing-error-cause for AggregateError with cause', () => {
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
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.filter(f => f.kind === 'missing-error-cause');

    // Assert
    expect(hits.length).toBe(0);
  });

  // --- P3-1 throw-non-error ---

  it('should report throw-non-error for string literal throw', () => {
    // Arrange
    const filePath = '/virtual/src/features/throw-string.ts';
    const source = 'export function f() { throw "boom"; }';
    // Act
    const analysis = analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).toContain('throw-non-error');
  });

  it('should report throw-non-error for numeric literal throw', () => {
    // Arrange
    const filePath = '/virtual/src/features/throw-number.ts';
    const source = 'export function f() { throw 42; }';
    // Act
    const analysis = analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).toContain('throw-non-error');
  });

  it('should report throw-non-error for primitive wrapper call (String)', () => {
    // Arrange
    const filePath = '/virtual/src/features/throw-wrapper.ts';
    const source = 'export function f() { throw String("hello"); }';
    // Act
    const analysis = analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).toContain('throw-non-error');
  });

  it('should not report throw-non-error for new Error()', () => {
    // Arrange
    const filePath = '/virtual/src/features/throw-error.ts';
    const source = 'export function f() { throw new Error("x"); }';
    // Act
    const analysis = analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).not.toContain('throw-non-error');
  });

  it('should not report throw-non-error for factory call', () => {
    // Arrange
    const filePath = '/virtual/src/features/throw-factory.ts';
    const source = 'export function f() { throw createError(); }';
    // Act
    const analysis = analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).not.toContain('throw-non-error');
  });

  // --- P3-2 async-promise-executor ---

  it('should report async-promise-executor for async executor', () => {
    // Arrange
    const filePath = '/virtual/src/features/async-executor.ts';
    const source = 'export const p = new Promise(async () => { await fetch("/"); });';
    // Act
    const analysis = analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).toContain('async-promise-executor');
  });

  it('should report async-promise-executor for globalThis.Promise', () => {
    // Arrange
    const filePath = '/virtual/src/features/async-executor-global.ts';
    const source = 'export const p = new globalThis.Promise(async () => { await fetch("/"); });';
    // Act
    const analysis = analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).toContain('async-promise-executor');
  });

  it('should not report async-promise-executor for sync executor', () => {
    // Arrange
    const filePath = '/virtual/src/features/sync-executor.ts';
    const source = 'export const p = new Promise((resolve) => { resolve(42); });';
    // Act
    const analysis = analyzeSingle(filePath, source);

    // Assert
    expect(kinds(analysis)).not.toContain('async-promise-executor');
  });
});
