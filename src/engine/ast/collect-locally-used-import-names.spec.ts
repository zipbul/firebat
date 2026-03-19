import { describe, expect, it } from 'bun:test';

import { collectLocallyUsedImportNames } from './collect-locally-used-import-names';
import { parseSource } from './parse-source';

describe('collect-locally-used-import-names', () => {
  it('import X referenced in variable initializer — X included', () => {
    const file = parseSource(
      'test.ts',
      `import { X } from '../other';
const val: X = {};`,
    );
    const result = collectLocallyUsedImportNames(file.program, new Set(['X']));

    expect(result.has('X')).toBe(true);
  });

  it('import X referenced in function body — X included', () => {
    const file = parseSource(
      'test.ts',
      `import { X } from '../other';
function foo() { return X; }`,
    );
    const result = collectLocallyUsedImportNames(file.program, new Set(['X']));

    expect(result.has('X')).toBe(true);
  });

  it('export named specifier only — X not counted as local usage', () => {
    const file = parseSource(
      'test.ts',
      `import { X } from '../other';
export { X };`,
    );
    const result = collectLocallyUsedImportNames(file.program, new Set(['X']));

    expect(result.has('X')).toBe(false);
  });

  it('export default identifier only — X not counted as local usage', () => {
    const file = parseSource(
      'test.ts',
      `import X from '../other';
export default X;`,
    );
    const result = collectLocallyUsedImportNames(file.program, new Set(['X']));

    expect(result.has('X')).toBe(false);
  });

  it('function scope shadows import X — X not counted as import usage', () => {
    const file = parseSource(
      'test.ts',
      `import { X } from '../other';
function foo() { const X = 1; return X; }
export { X };`,
    );
    const result = collectLocallyUsedImportNames(file.program, new Set(['X']));

    expect(result.has('X')).toBe(false);
  });

  it('block scope shadow then usage after block — X counted as import usage', () => {
    const file = parseSource(
      'test.ts',
      `import { X } from '../other';
{ const X = 1; }
const val: X = {};
export { X };`,
    );
    const result = collectLocallyUsedImportNames(file.program, new Set(['X']));

    expect(result.has('X')).toBe(true);
  });

  it('function declaration with default param using import — X included', () => {
    const file = parseSource(
      'test.ts',
      `import { X } from '../other';
function foo(val = X) { return val; }
export { X };`,
    );
    const result = collectLocallyUsedImportNames(file.program, new Set(['X']));

    expect(result.has('X')).toBe(true);
  });

  it('arrow function with default param using import — X included', () => {
    const file = parseSource(
      'test.ts',
      `import { X } from '../other';
const foo = (val = X) => val;
export { X };`,
    );
    const result = collectLocallyUsedImportNames(file.program, new Set(['X']));

    expect(result.has('X')).toBe(true);
  });

  it('export { X, Y } — neither counted as local usage', () => {
    const file = parseSource(
      'test.ts',
      `import { X, Y } from '../other';
export { X, Y };`,
    );
    const result = collectLocallyUsedImportNames(file.program, new Set(['X', 'Y']));

    expect(result.has('X')).toBe(false);
    expect(result.has('Y')).toBe(false);
  });

  it('X exported and Y used locally — only Y included', () => {
    const file = parseSource(
      'test.ts',
      `import { X, Y } from '../other';
const v: Y = {};
export { X };`,
    );
    const result = collectLocallyUsedImportNames(file.program, new Set(['X', 'Y']));

    expect(result.has('X')).toBe(false);
    expect(result.has('Y')).toBe(true);
  });

  it('for-of loop variable shadows import — usage after loop counts as import', () => {
    const file = parseSource(
      'test.ts',
      `import { X } from '../other';
for (const X of arr) { use(X); }
someFunction(X);
export { X };`,
    );
    const result = collectLocallyUsedImportNames(file.program, new Set(['X']));

    expect(result.has('X')).toBe(true);
  });

  it('for-in loop variable shadows import — usage after loop counts as import', () => {
    const file = parseSource(
      'test.ts',
      `import { X } from '../other';
for (const X in obj) { use(X); }
someFunction(X);
export { X };`,
    );
    const result = collectLocallyUsedImportNames(file.program, new Set(['X']));

    expect(result.has('X')).toBe(true);
  });

  it('for loop variable shadows import — usage after loop counts as import', () => {
    const file = parseSource(
      'test.ts',
      `import { X } from '../other';
for (let X = 0; X < 10; X++) { use(X); }
someFunction(X);
export { X };`,
    );
    const result = collectLocallyUsedImportNames(file.program, new Set(['X']));

    expect(result.has('X')).toBe(true);
  });

  it('catch clause parameter shadows import — usage after catch counts as import', () => {
    const file = parseSource(
      'test.ts',
      `import { X } from '../other';
try { } catch (X) { use(X); }
someFunction(X);
export { X };`,
    );
    const result = collectLocallyUsedImportNames(file.program, new Set(['X']));

    expect(result.has('X')).toBe(true);
  });
});
