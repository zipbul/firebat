import { describe, expect, it } from 'bun:test';

import type { Gildash } from '@zipbul/gildash';

import { analyzeErrorFlow } from '../../../../src/test-api';
import { createProgramFromMap } from '../../shared/test-kit';

const noopGildash = {
  isTypeAssignableToType: () => null,
  getResolvedTypesAtPositions: () => new Map(),
  isTypeAssignableToTypeAtPositions: () => new Map(),
} as unknown as Gildash;

describe('integration/error-flow', () => {
  it('should return no findings when input is empty', async () => {
    // Arrange
    let sources = new Map<string, string>();
    // Act
    let program = createProgramFromMap(sources);
    let analysis = await analyzeErrorFlow(program, { gildash: noopGildash });

    // Assert
    expect(analysis.length).toBe(0);
  });

  it('should report floating-promises when a promise-like expression statement is unobserved', async () => {
    // Arrange
    let sources = new Map<string, string>();
    let filePath = '/virtual/src/features/floating.ts';
    let source = ['export function f() {', '  Promise.resolve(1);', '}'].join('\n');

    sources.set(filePath, source);

    // Act
    let program = createProgramFromMap(sources);
    let analysis = await analyzeErrorFlow(program, { gildash: noopGildash });
    let hits = analysis.filter(f => f.kind === 'floating-promises');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should report floating-promises when Promise.reject is unobserved', async () => {
    // Arrange
    let sources = new Map<string, string>();
    let filePath = '/virtual/src/features/floating-reject.ts';
    let source = ['export function f() {', '  Promise.reject(new Error("x"));', '}'].join('\n');

    sources.set(filePath, source);

    // Act
    let program = createProgramFromMap(sources);
    let analysis = await analyzeErrorFlow(program, { gildash: noopGildash });
    let hits = analysis.filter(f => f.kind === 'floating-promises');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should report floating-promises when Promise.all is unobserved', async () => {
    // Arrange
    let sources = new Map<string, string>();
    let filePath = '/virtual/src/features/floating-all.ts';
    let source = ['export function f() {', '  Promise.all([Promise.resolve(1)]);', '}'].join('\n');

    sources.set(filePath, source);

    // Act
    let program = createProgramFromMap(sources);
    let analysis = await analyzeErrorFlow(program, { gildash: noopGildash });
    let hits = analysis.filter(f => f.kind === 'floating-promises');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should report floating-promises when new Promise is unobserved', async () => {
    // Arrange
    let sources = new Map<string, string>();
    let filePath = '/virtual/src/features/floating-new-promise.ts';
    let source = ['export function f() {', '  new Promise(resolve => resolve(1));', '}'].join('\n');

    sources.set(filePath, source);

    // Act
    let program = createProgramFromMap(sources);
    let analysis = await analyzeErrorFlow(program, { gildash: noopGildash });
    let hits = analysis.filter(f => f.kind === 'floating-promises');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should not report floating-promises when promise is explicitly ignored with void', async () => {
    // Arrange
    let sources = new Map<string, string>();
    let filePath = '/virtual/src/features/floating-ok.ts';
    let source = ['export function f() {', '  void Promise.resolve(1);', '}'].join('\n');

    sources.set(filePath, source);

    // Act
    let program = createProgramFromMap(sources);
    let analysis = await analyzeErrorFlow(program, { gildash: noopGildash });
    let hits = analysis.filter(f => f.kind === 'floating-promises');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report floating-promises when promise is returned', async () => {
    // Arrange
    let sources = new Map<string, string>();
    let filePath = '/virtual/src/features/floating-returned.ts';
    let source = ['export function f() {', '  return Promise.resolve(1);', '}'].join('\n');

    sources.set(filePath, source);

    // Act
    let program = createProgramFromMap(sources);
    let analysis = await analyzeErrorFlow(program, { gildash: noopGildash });
    let hits = analysis.filter(f => f.kind === 'floating-promises');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report floating-promises when promise is awaited', async () => {
    // Arrange
    let sources = new Map<string, string>();
    let filePath = '/virtual/src/features/floating-awaited.ts';
    let source = ['export async function f() {', '  await Promise.resolve(1);', '}'].join('\n');

    sources.set(filePath, source);

    // Act
    let program = createProgramFromMap(sources);
    let analysis = await analyzeErrorFlow(program, { gildash: noopGildash });
    let hits = analysis.filter(f => f.kind === 'floating-promises');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report floating-promises when promise has catch handler', async () => {
    // Arrange
    let sources = new Map<string, string>();
    let filePath = '/virtual/src/features/floating-caught.ts';
    let source = ['export function f() {', '  Promise.resolve(1).catch(() => 0);', '}'].join('\n');

    sources.set(filePath, source);

    // Act
    let program = createProgramFromMap(sources);
    let analysis = await analyzeErrorFlow(program, { gildash: noopGildash });
    let hits = analysis.filter(f => f.kind === 'floating-promises');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should report misused-promises when an async callback is passed to forEach', async () => {
    // Arrange
    let sources = new Map<string, string>();
    let filePath = '/virtual/src/features/misused.ts';
    let source = [
      'export async function doThing(value: number) {',
      '  return value + 1;',
      '}',
      '',
      'export function f() {',
      '  [1, 2, 3].forEach(async value => {',
      '    await doThing(value);',
      '  });',
      '}',
    ].join('\n');

    sources.set(filePath, source);

    // Act
    let program = createProgramFromMap(sources);
    let analysis = await analyzeErrorFlow(program, { gildash: noopGildash });
    let hits = analysis.filter(f => f.kind === 'misused-promises');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should report misused-promises when an async callback is passed to map', async () => {
    // Arrange
    let sources = new Map<string, string>();
    let filePath = '/virtual/src/features/misused-map.ts';
    let source = [
      'export async function doThing(value: number) {',
      '  return value + 1;',
      '}',
      '',
      'export function f() {',
      '  return [1, 2, 3].map(async value => {',
      '    return await doThing(value);',
      '  });',
      '}',
    ].join('\n');

    sources.set(filePath, source);

    // Act
    let program = createProgramFromMap(sources);
    let analysis = await analyzeErrorFlow(program, { gildash: noopGildash });
    let hits = analysis.filter(f => f.kind === 'misused-promises');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should report misused-promises when an async callback is passed to filter', async () => {
    // Arrange
    let sources = new Map<string, string>();
    let filePath = '/virtual/src/features/misused-filter.ts';
    let source = [
      'export async function isGood(value: number) {',
      '  return value > 0;',
      '}',
      '',
      'export function f() {',
      '  return [1, 2, 3].filter(async value => {',
      '    return await isGood(value);',
      '  });',
      '}',
    ].join('\n');

    sources.set(filePath, source);

    // Act
    let program = createProgramFromMap(sources);
    let analysis = await analyzeErrorFlow(program, { gildash: noopGildash });
    let hits = analysis.filter(f => f.kind === 'misused-promises');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should not report misused-promises when a sync wrapper is used', async () => {
    // Arrange
    let sources = new Map<string, string>();
    let filePath = '/virtual/src/features/misused-ok.ts';
    let source = [
      'export async function doThing(value: number) {',
      '  return value + 1;',
      '}',
      '',
      'export function f() {',
      '  [1, 2, 3].forEach(value => {',
      '    void doThing(value);',
      '  });',
      '}',
    ].join('\n');

    sources.set(filePath, source);

    // Act
    let program = createProgramFromMap(sources);
    let analysis = await analyzeErrorFlow(program, { gildash: noopGildash });
    let hits = analysis.filter(f => f.kind === 'misused-promises');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should report throw-non-error when throwing a non-Error value', async () => {
    // Arrange
    let sources = new Map<string, string>();
    let filePath = '/virtual/src/features/throw-non-error.ts';
    let source = ['export function f() {', '  throw "boom";', '}'].join('\n');

    sources.set(filePath, source);

    // Act
    let program = createProgramFromMap(sources);
    let analysis = await analyzeErrorFlow(program, { gildash: noopGildash });
    let hits = analysis.filter(f => f.kind === 'throw-non-error');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should not report throw-non-error when throwing an identifier', async () => {
    // Arrange
    let sources = new Map<string, string>();
    let filePath = '/virtual/src/features/throw-non-error-ok.ts';
    let source = ['export function f(err: unknown) {', '  throw err;', '}'].join('\n');

    sources.set(filePath, source);

    // Act
    let program = createProgramFromMap(sources);
    let analysis = await analyzeErrorFlow(program, { gildash: noopGildash });
    let hits = analysis.filter(f => f.kind === 'throw-non-error');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should report promise-constructor-hygiene when Promise executor is async', async () => {
    // Arrange
    let sources = new Map<string, string>();
    let filePath = '/virtual/src/features/async-promise-executor.ts';
    let source = ['export function f() {', '  return new Promise(async resolve => {', '    resolve(1);', '  });', '}'].join('\n');

    sources.set(filePath, source);

    // Act
    let program = createProgramFromMap(sources);
    let analysis = await analyzeErrorFlow(program, { gildash: noopGildash });
    let hits = analysis.filter(f => f.kind === 'promise-constructor-hygiene');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should not report misused-promises when callback is sync', async () => {
    // Arrange
    let sources = new Map<string, string>();
    let filePath = '/virtual/src/features/misused-sync.ts';
    let source = ['export function f() {', '  [1, 2, 3].forEach(value => {', '    console.log(value);', '  });', '}'].join('\n');

    sources.set(filePath, source);

    // Act
    let program = createProgramFromMap(sources);
    let analysis = await analyzeErrorFlow(program, { gildash: noopGildash });
    let hits = analysis.filter(f => f.kind === 'misused-promises');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should report return-await-in-try when call is returned without await in try with catch', async () => {
    // Arrange
    let sources = new Map<string, string>();
    let filePath = '/virtual/src/features/return-no-await.ts';
    let source = [
      'export async function f() {',
      '  try {',
      '    return fetchData();',
      '  } catch (e) {',
      '    handleError(e);',
      '  }',
      '}',
    ].join('\n');

    sources.set(filePath, source);

    // Act
    let program = createProgramFromMap(sources);
    let analysis = await analyzeErrorFlow(program, { gildash: noopGildash });
    let hits = analysis.filter(f => f.kind === 'return-await-in-try');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should not report return-await-in-try when return uses await in try with catch', async () => {
    // Arrange
    let sources = new Map<string, string>();
    let filePath = '/virtual/src/features/return-with-await.ts';
    let source = [
      'export async function f() {',
      '  try {',
      '    return await fetchData();',
      '  } catch (e) {',
      '    handleError(e);',
      '  }',
      '}',
    ].join('\n');

    sources.set(filePath, source);

    // Act
    let program = createProgramFromMap(sources);
    let analysis = await analyzeErrorFlow(program, { gildash: noopGildash });
    let hits = analysis.filter(f => f.kind === 'return-await-in-try');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report return-await-in-try when return is outside try block', async () => {
    // Arrange
    let sources = new Map<string, string>();
    let filePath = '/virtual/src/features/return-outside-try.ts';
    let source = ['export async function f() {', '  return fetchData();', '}'].join('\n');

    sources.set(filePath, source);

    // Act
    let program = createProgramFromMap(sources);
    let analysis = await analyzeErrorFlow(program, { gildash: noopGildash });
    let hits = analysis.filter(f => f.kind === 'return-await-in-try');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report return-await-in-try for literal return in try block', async () => {
    // Arrange
    let sources = new Map<string, string>();
    let filePath = '/virtual/src/features/return-literal-try.ts';
    let source = [
      'export function f() {',
      '  try {',
      '    return "ok";',
      '  } catch (e) {',
      '    return "error";',
      '  }',
      '}',
    ].join('\n');

    sources.set(filePath, source);

    // Act
    let program = createProgramFromMap(sources);
    let analysis = await analyzeErrorFlow(program, { gildash: noopGildash });
    let hits = analysis.filter(f => f.kind === 'return-await-in-try');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should not report return-await-in-try in nested function even if outer has try/catch', async () => {
    // Arrange
    let sources = new Map<string, string>();
    let filePath = '/virtual/src/features/return-nested-fn.ts';
    let source = [
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
    ].join('\n');

    sources.set(filePath, source);

    // Act
    let program = createProgramFromMap(sources);
    let analysis = await analyzeErrorFlow(program, { gildash: noopGildash });
    let hits = analysis.filter(f => f.kind === 'return-await-in-try');

    // Assert — inner arrow's return is NOT inside its own try/catch, so should not be flagged
    expect(hits.length).toBe(0);
  });

  it('should report missing-error-cause when catch throws a new Error without { cause }', async () => {
    // Arrange
    let sources = new Map<string, string>();
    let filePath = '/virtual/src/features/transform-bad.ts';
    let source = [
      'export function f() {',
      '  try {',
      '    throw new Error("x");',
      '  } catch (e) {',
      '    throw new Error("wrap");',
      '  }',
      '}',
    ].join('\n');

    sources.set(filePath, source);

    // Act
    let program = createProgramFromMap(sources);
    let analysis = await analyzeErrorFlow(program, { gildash: noopGildash });
    let hits = analysis.filter(f => f.kind === 'missing-error-cause');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should not report missing-error-cause when cause is preserved', async () => {
    // Arrange
    let sources = new Map<string, string>();
    let filePath = '/virtual/src/features/transform-ok-cause.ts';
    let source = [
      'export function f() {',
      '  try {',
      '    throw new Error("x");',
      '  } catch (e) {',
      '    throw new Error("wrap", { cause: e });',
      '  }',
      '}',
    ].join('\n');

    sources.set(filePath, source);

    // Act
    let program = createProgramFromMap(sources);
    let analysis = await analyzeErrorFlow(program, { gildash: noopGildash });
    let hits = analysis.filter(f => f.kind === 'missing-error-cause');

    // Assert
    expect(hits.length).toBe(0);
  });

  it('should report missing-error-cause when cause/context is lost for non-Error constructors', async () => {
    // Arrange
    let sources = new Map<string, string>();
    let filePath = '/virtual/src/features/transform-custom.ts';
    let source = [
      'export function f() {',
      '  try {',
      '    throw new Error("x");',
      '  } catch (e) {',
      '    throw new WrapError("wrap");',
      '  }',
      '}',
    ].join('\n');

    sources.set(filePath, source);

    // Act
    let program = createProgramFromMap(sources);
    let analysis = await analyzeErrorFlow(program, { gildash: noopGildash });
    let hits = analysis.filter(f => f.kind === 'missing-error-cause');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should report useless-catch when inner useless catch exists under an outer catch', async () => {
    // Arrange
    let sources = new Map<string, string>();
    let filePath = '/virtual/src/features/nested-redundant.ts';
    let source = [
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

    sources.set(filePath, source);

    // Act
    let program = createProgramFromMap(sources);
    let analysis = await analyzeErrorFlow(program, { gildash: noopGildash });
    let hits = analysis.filter(f => f.kind === 'useless-catch');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('should not report useless-catch (nested variant) when there is no outer catch', async () => {
    // Arrange
    let sources = new Map<string, string>();
    let filePath = '/virtual/src/features/nested-ok-no-outer.ts';
    let source = [
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
    ].join('\n');

    sources.set(filePath, source);

    // Act
    let program = createProgramFromMap(sources);
    let analysis = await analyzeErrorFlow(program, { gildash: noopGildash });
    let hits = analysis.filter(f => f.kind === 'useless-catch');

    // Assert
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });
});
