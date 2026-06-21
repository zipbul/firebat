import { describe, expect, it } from 'bun:test';

import { collectLocallyUsedImportNames } from './collect-locally-used-import-names';
import { parseSource } from './parse-source';

interface ImportUsageCase {
  name: string;
  source: string;
  importedNames: string[];
  expected: Array<[string, boolean]>;
}

describe('collect-locally-used-import-names', () => {
  const cases: ImportUsageCase[] = [
    {
      name: 'import X referenced in variable initializer — X included',
      source: `import { X } from '../other';
const val: X = {};`,
      importedNames: ['X'],
      expected: [['X', true]],
    },
    {
      name: 'import X referenced in function body — X included',
      source: `import { X } from '../other';
function foo() { return X; }`,
      importedNames: ['X'],
      expected: [['X', true]],
    },
    {
      name: 'export named specifier only — X not counted as local usage',
      source: `import { X } from '../other';
export { X };`,
      importedNames: ['X'],
      expected: [['X', false]],
    },
    {
      name: 'export default identifier only — X not counted as local usage',
      source: `import X from '../other';
export default X;`,
      importedNames: ['X'],
      expected: [['X', false]],
    },
    {
      name: 'function scope shadows import X — X not counted as import usage',
      source: `import { X } from '../other';
function foo() { const X = 1; return X; }
export { X };`,
      importedNames: ['X'],
      expected: [['X', false]],
    },
    {
      name: 'block scope shadow then usage after block — X counted as import usage',
      source: `import { X } from '../other';
{ const X = 1; }
const val: X = {};
export { X };`,
      importedNames: ['X'],
      expected: [['X', true]],
    },
    {
      name: 'function declaration with default param using import — X included',
      source: `import { X } from '../other';
function foo(val = X) { return val; }
export { X };`,
      importedNames: ['X'],
      expected: [['X', true]],
    },
    {
      name: 'arrow function with default param using import — X included',
      source: `import { X } from '../other';
const foo = (val = X) => val;
export { X };`,
      importedNames: ['X'],
      expected: [['X', true]],
    },
    {
      name: 'export { X, Y } — neither counted as local usage',
      source: `import { X, Y } from '../other';
export { X, Y };`,
      importedNames: ['X', 'Y'],
      expected: [
        ['X', false],
        ['Y', false],
      ],
    },
    {
      name: 'X exported and Y used locally — only Y included',
      source: `import { X, Y } from '../other';
const v: Y = {};
export { X };`,
      importedNames: ['X', 'Y'],
      expected: [
        ['X', false],
        ['Y', true],
      ],
    },
    {
      name: 'for-of loop variable shadows import — usage after loop counts as import',
      source: `import { X } from '../other';
for (const X of arr) { use(X); }
someFunction(X);
export { X };`,
      importedNames: ['X'],
      expected: [['X', true]],
    },
    {
      name: 'for-in loop variable shadows import — usage after loop counts as import',
      source: `import { X } from '../other';
for (const X in obj) { use(X); }
someFunction(X);
export { X };`,
      importedNames: ['X'],
      expected: [['X', true]],
    },
    {
      name: 'for loop variable shadows import — usage after loop counts as import',
      source: `import { X } from '../other';
for (let X = 0; X < 10; X++) { use(X); }
someFunction(X);
export { X };`,
      importedNames: ['X'],
      expected: [['X', true]],
    },
    {
      name: 'catch clause parameter shadows import — usage after catch counts as import',
      source: `import { X } from '../other';
try { } catch (X) { use(X); }
someFunction(X);
export { X };`,
      importedNames: ['X'],
      expected: [['X', true]],
    },
    {
      name: 'export { X as Y } — Y not counted as local usage even when in importedNames',
      // export-specifier alias: spec.exported has its own Identifier node, must
      // also be excluded from the use-count walk.
      source: `import { X, Y } from '../other';
export { X as Y };`,
      importedNames: ['X', 'Y'],
      expected: [
        ['X', false],
        ['Y', false],
      ],
    },
    {
      name: 'function-scope TSTypeAliasDeclaration shadows import — usage in body not counted',
      // ScopeTracker does not track TS-only declarations; firebat's parallel
      // shadow stack must catch this.
      source: `import { Foo } from '../other';
function f() {
  type Foo = string;
  const v: Foo = 'a';
  return v;
}
export { Foo };`,
      importedNames: ['Foo'],
      expected: [['Foo', false]],
    },
    {
      name: 'function-scope TSInterfaceDeclaration shadows import — usage in body not counted',
      source: `import { Foo } from '../other';
function f() {
  interface Foo { x: number; }
  const v: Foo = { x: 1 };
  return v;
}
export { Foo };`,
      importedNames: ['Foo'],
      expected: [['Foo', false]],
    },
    {
      name: 'TS type alias shadow then usage after function — usage outside counts as import',
      source: `import { Foo } from '../other';
function f() {
  type Foo = string;
  return undefined;
}
const v: Foo = {};
export { Foo };`,
      importedNames: ['Foo'],
      expected: [['Foo', true]],
    },
  ];

  it.each(cases)('$name', ({ source, importedNames, expected }) => {
    const file = parseSource('test.ts', source);
    const result = collectLocallyUsedImportNames(file.program, new Set(importedNames));

    expect(expected.map(([n]) => [n, result.has(n)])).toEqual(expected);
  });
});
