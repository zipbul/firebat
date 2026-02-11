import { describe, expect, it } from 'bun:test';

import { parseSource } from '../../engine/parse-source';
import { analyzeExceptionHygiene } from './analyzer';

const analyzeSingle = (filePath: string, sourceText: string) => {
  // Arrange
  const program = [parseSource(filePath, sourceText)];
  // Act
  const analysis = analyzeExceptionHygiene(program);

  // Assert (shape)
  expect(analysis.status).toBeDefined();
  expect(analysis.tool).toBe('oxc');
  expect(Array.isArray(analysis.findings)).toBe(true);

  return analysis;
};

const kinds = (analysis: ReturnType<typeof analyzeSingle>) => analysis.findings.map(f => f.kind);

const assertFindingShape = (analysis: ReturnType<typeof analyzeSingle>) => {
  // Arrange
  const findings = analysis.findings;

  // Act / Assert
  for (const finding of findings) {
    expect(finding.filePath.length).toBeGreaterThan(0);
    expect(finding.message.length).toBeGreaterThan(0);
    expect(finding.evidence.length).toBeGreaterThan(0);
    expect(Array.isArray(finding.recipes)).toBe(true);
    expect(finding.recipes.length).toBeGreaterThanOrEqual(1);
    expect(finding.span.start.line).toBeGreaterThanOrEqual(1);
    expect(finding.span.end.line).toBeGreaterThanOrEqual(finding.span.start.line);
    expect(finding.boundaryRole).toBeDefined();
  }
};

describe('analyzer', () => {
  it('should return no findings when input is empty', () => {
    // Arrange
    const program: ReturnType<typeof parseSource>[] = [];
    // Act
    const analysis = analyzeExceptionHygiene(program);

    // Assert
    expect(analysis.findings.length).toBe(0);
  });

  it('should always include recipes and boundaryRole when finding is reported', () => {
    // Arrange
    const filePath = '/virtual/src/adapters/cli/entry.ts';
    const source = [
      'export function f() {',
      '  doThing().then(() => 1);',
      '}',
      'function doThing() { return Promise.resolve(1); }',
    ].join('\n');
    // Act
    const analysis = analyzeSingle(filePath, source);

    // Assert
    expect(analysis.findings.length).toBeGreaterThanOrEqual(1);
    assertFindingShape(analysis);
    expect(analysis.findings.some(f => f.boundaryRole === 'process')).toBe(true);
  });

  it('should report useless-catch when catch rethrows the same error', () => {
    // Arrange
    const filePath = '/virtual/src/features/useless.ts';
    const source = ['export function f() {', '  try {', '    return 1;', '  } catch (e) {', '    throw e;', '  }', '}'].join(
      '\n',
    );
    // Act
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.findings.filter(f => f.kind === 'useless-catch');

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
    const hits = analysis.findings.filter(f => f.kind === 'useless-catch');

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
    const hits = analysis.findings.filter(f => f.kind === 'useless-catch');

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
    const hits = analysis.findings.filter(f => f.kind === 'useless-catch');

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
    const hits = analysis.findings.filter(f => f.kind === 'useless-catch');

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
    const hits = analysis.findings.filter(f => f.kind === 'unsafe-finally');

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
    const hits = analysis.findings.filter(f => f.kind === 'unsafe-finally');

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
    const hits = analysis.findings.filter(f => f.kind === 'unsafe-finally');

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
    const hits = analysis.findings.filter(f => f.kind === 'unsafe-finally');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should report return-in-finally when finally callback returns a value', () => {
    // Arrange
    const filePath = '/virtual/src/features/promise-finally.ts';
    const source = ['export function f() {', '  return Promise.resolve(1).finally(() => {', '    return 2;', '  });', '}'].join(
      '\n',
    );
    // Act
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.findings.filter(f => f.kind === 'return-in-finally');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should report return-in-finally when finally callback has expression body', () => {
    // Arrange
    const filePath = '/virtual/src/features/promise-finally-expr.ts';
    const source = ['export function f() {', '  return Promise.resolve(1).finally(() => 1);', '}'].join('\n');
    // Act
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.findings.filter(f => f.kind === 'return-in-finally');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should report return-in-finally when finally callback returns undefined explicitly', () => {
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
    const hits = analysis.findings.filter(f => f.kind === 'return-in-finally');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should not report return-in-finally when finally callback has no return', () => {
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
    const hits = analysis.findings.filter(f => f.kind === 'return-in-finally');

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
    const hits = analysis.findings.filter(f => f.kind === 'catch-or-return');

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
    const hits = analysis.findings.filter(f => f.kind === 'catch-or-return');

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
    const hits = analysis.findings.filter(f => f.kind === 'catch-or-return');

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
    const hits = analysis.findings.filter(f => f.kind === 'catch-or-return');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should report prefer-catch when then handles rejection with a second argument', () => {
    // Arrange
    const filePath = '/virtual/src/features/prefer-catch.ts';
    const source = ['export function f() {', '  return Promise.resolve(1).then(() => 1, () => 0);', '}'].join('\n');
    // Act
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.findings.filter(f => f.kind === 'prefer-catch');

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
    const hits = analysis.findings.filter(f => f.kind === 'prefer-catch');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should not report prefer-catch when catch is used', () => {
    // Arrange
    const filePath = '/virtual/src/features/prefer-catch-ok.ts';
    const source = ['export function f() {', '  return Promise.resolve(1).then(() => 1).catch(() => 0);', '}'].join('\n');
    // Act
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.findings.filter(f => f.kind === 'prefer-catch');

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
    const hits = analysis.findings.filter(f => f.kind === 'prefer-await-to-then');

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
    const hits = analysis.findings.filter(f => f.kind === 'prefer-await-to-then');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should not report prefer-await-to-then when then is a short value mapping', () => {
    // Arrange
    const filePath = '/virtual/src/features/prefer-await-ok.ts';
    const source = ['export function f() {', '  return Promise.resolve(1).then(x => x + 1);', '}'].join('\n');
    // Act
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.findings.filter(f => f.kind === 'prefer-await-to-then');

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
    const hits = analysis.findings.filter(f => f.kind === 'prefer-await-to-then');

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

  it('should report silent-catch when catch is empty', () => {
    // Arrange
    const filePath = '/virtual/src/features/silent-empty.ts';
    const source = ['export function f() {', '  try {', '    throw new Error("x");', '  } catch (e) {', '  }', '}'].join('\n');
    // Act
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.findings.filter(f => f.kind === 'silent-catch');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should report silent-catch when catch only logs and does not throw', () => {
    // Arrange
    const filePath = '/virtual/src/features/silent-log.ts';
    const source = [
      'export function f() {',
      '  try {',
      '    throw new Error("x");',
      '  } catch (e) {',
      '    console.error(e);',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.findings.filter(f => f.kind === 'silent-catch');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should report silent-catch when catch returns a default value', () => {
    // Arrange
    const filePath = '/virtual/src/features/silent-default.ts';
    const source = [
      'export function f() {',
      '  try {',
      '    throw new Error("x");',
      '  } catch (e) {',
      '    return null;',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.findings.filter(f => f.kind === 'silent-catch');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should not report silent-catch when catch rethrows', () => {
    // Arrange
    const filePath = '/virtual/src/features/silent-ok.ts';
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
    const hits = analysis.findings.filter(f => f.kind === 'silent-catch');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should report catch-transform-hygiene when catch throws new Error without cause', () => {
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
    const hits = analysis.findings.filter(f => f.kind === 'catch-transform-hygiene');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should not report catch-transform-hygiene when cause is preserved', () => {
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
    const hits = analysis.findings.filter(f => f.kind === 'catch-transform-hygiene');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should report redundant-nested-catch when an inner useless catch exists under an outer catch', () => {
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
    const hits = analysis.findings.filter(f => f.kind === 'redundant-nested-catch');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should not report redundant-nested-catch when there is no outer catch', () => {
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
    const hits = analysis.findings.filter(f => f.kind === 'redundant-nested-catch');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should report overscoped-try when try block has many statements', () => {
    // Arrange
    const filePath = '/virtual/src/features/overscoped.ts';
    const source = [
      'export function f() {',
      '  try {',
      '    const a = 1;',
      '    const b = 2;',
      '    const c = 3;',
      '    const d = 4;',
      '    const e = 5;',
      '    const f = 6;',
      '    const g = 7;',
      '    const h = 8;',
      '    const i = 9;',
      '    const j = 10;',
      '    return a + b + c + d + e + f + g + h + i + j;',
      '  } catch (err) {',
      '    throw err;',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.findings.filter(f => f.kind === 'overscoped-try');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should not report overscoped-try when try block is small', () => {
    // Arrange
    const filePath = '/virtual/src/features/overscoped-ok.ts';
    const source = ['export function f() {', '  try {', '    return 1;', '  } catch (err) {', '    throw err;', '  }', '}'].join(
      '\n',
    );
    // Act
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.findings.filter(f => f.kind === 'overscoped-try');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should report exception-control-flow when try is used for branching with default return', () => {
    // Arrange
    const filePath = '/virtual/src/features/control-flow.ts';
    const source = [
      'export function f(input: string) {',
      '  try {',
      '    return JSON.parse(input);',
      '  } catch (e) {',
      '    return null;',
      '  }',
      '}',
    ].join('\n');
    // Act
    const analysis = analyzeSingle(filePath, source);
    const hits = analysis.findings.filter(f => f.kind === 'exception-control-flow');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });
});
