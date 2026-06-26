import { describe, expect, it } from 'bun:test';

import type { BindingName } from './reaching-defs';

import { collectFunctionNodes } from '../ast/oxc-ast-utils';
import { parseSource } from '../ast/parse-source';
import { analyzeFunctionBody, collectLocalVarIndexes, collectParameterBindings, extractBindingNames } from './reaching-defs';
import { buildDeclScopeMap } from './variable-collector';

interface NamesCase {
  name: string;
  code: string;
  expected: string[];
}

interface CodeOnlyCase {
  name: string;
  code: string;
}

// Virtual filePath for spec cases. The gildash standalone binding resolver
// (getStandaloneFileBindings) takes filePath + source content directly, so the
// path is just an identifier and `_lastSource` carries the content.
const TEST_FILE_PATH = '/virtual/reaching-defs-spec.ts';
// Tracks the source backing the most recent firstFunction()/parseFunctions()
// call so the gildash standalone binding resolver receives the file content.
let _lastSource = '';

const parseFunctions = (code: string) => {
  _lastSource = code;

  const parsed = parseSource(TEST_FILE_PATH, code);

  return collectFunctionNodes(parsed.program);
};

const firstFunction = (code: string) => {
  const fns = parseFunctions(code);

  expect(fns.length).toBeGreaterThanOrEqual(1);

  return fns[0]!;
};

/** Parse `code`, extract the binding names of the first function's first parameter. */
const extractParamNames = (code: string): string[] => {
  const fn = firstFunction(code);
  const out: BindingName[] = [];

  extractBindingNames((fn as any).params[0], out);

  return out.map(b => b.name);
};

/** Parse `code` and collect the first function's local-var index map. */
const localVarIndexes = (code: string): ReturnType<typeof collectLocalVarIndexes> =>
  collectLocalVarIndexes(firstFunction(code), TEST_FILE_PATH, _lastSource);

const analyzeFirstFunction = (code: string) => {
  const fn = firstFunction(code);
  const localIndexByName = collectLocalVarIndexes(fn, TEST_FILE_PATH, _lastSource);
  const paramBindings = collectParameterBindings(fn);
  const body = (fn as any).body;

  return analyzeFunctionBody(body, localIndexByName, paramBindings, [], buildDeclScopeMap(fn, TEST_FILE_PATH, _lastSource));
};

/** Assert `def` exists and return its index within `analysis.defs`. */
const defIndexOf = <T>(analysis: { readonly defs: ReadonlyArray<T> }, def: T | undefined): number => {
  expect(def).toBeDefined();

  return analysis.defs.indexOf(def!);
};

describe('engine/dataflow/reaching-defs', () => {
  // ── extractBindingNames ──

  describe('extractBindingNames', () => {
    // Each row: a single-param function whose param-pattern is fed to
    // extractBindingNames; `expected` is the sorted set of binding names produced.
    const cases: NamesCase[] = [
      {
        name: 'Identifier node - returns name',
        code: 'function f(x: number) { return x; }',
        expected: ['x'],
      },
      {
        name: 'ObjectPattern - returns all property bindings',
        code: 'function f({ a, b }: { a: number; b: number }) { return a + b; }',
        expected: ['a', 'b'],
      },
      {
        name: 'ArrayPattern - returns element bindings',
        code: 'function f([a, b]: number[]) { return a + b; }',
        expected: ['a', 'b'],
      },
      {
        name: 'ObjectPattern with RestElement - returns rest binding',
        code: 'function f({ a, ...rest }: any) { return rest; }',
        expected: ['a', 'rest'],
      },
      {
        name: 'AssignmentPattern (default value) - returns binding name',
        code: 'function f({ a = 1 }: { a?: number }) { return a; }',
        expected: ['a'],
      },
      {
        name: 'nested pattern [{ a }] - returns inner binding',
        code: 'function f([{ a }]: [{ a: number }]) { return a; }',
        expected: ['a'],
      },
      {
        name: 'RestElement at top level - returns binding',
        code: 'function f(...args: number[]) { return args; }',
        expected: ['args'],
      },
    ];

    it.each(cases)('extractBindingNames - $name', ({ code, expected }) => {
      expect(extractParamNames(code).sort()).toEqual([...expected].sort());
    });

    it('extractBindingNames - Identifier node - location is a number', () => {
      const fn = firstFunction('function f(x: number) { return x; }');
      const params = (fn as any).params as any[];
      const out: BindingName[] = [];

      extractBindingNames(params[0], out);
      expect(typeof out[0]?.location).toBe('number');
    });
  });

  // ── collectParameterBindings ──

  describe('collectParameterBindings', () => {
    const cases: NamesCase[] = [
      {
        name: 'simple params - returns all parameter names',
        code: 'function f(a: number, b: string) { return a; }',
        expected: ['a', 'b'],
      },
      {
        name: 'destructured param - returns inner bindings',
        code: 'function f({ x, y }: { x: number; y: number }) { return x; }',
        expected: ['x', 'y'],
      },
      {
        name: 'no params - returns empty array',
        code: 'function f() { return 1; }',
        expected: [],
      },
      {
        name: 'rest param - returns rest binding',
        code: 'function f(a: number, ...rest: number[]) { return rest; }',
        expected: ['a', 'rest'],
      },
    ];

    it.each(cases)('collectParameterBindings - $name', ({ code, expected }) => {
      const fn = firstFunction(code);
      const bindings = collectParameterBindings(fn);

      expect(bindings.map(b => b.name).sort()).toEqual([...expected].sort());
    });
  });

  // ── collectLocalVarIndexes ──

  describe('collectLocalVarIndexes', () => {
    // Helper: extract just the names from bindingKey strings (`name@scope`).
    // Used so assertions don't depend on the scope-key format, which is now
    // sourced from gildash's tsc-resolved declaration positions instead of
    // ScopeTracker's lexical-scope strings (`''`, `'0'`, ...).
    const namesOf = (indexes: Map<string, number>): string[] => [...indexes.keys()].map(k => k.split('@')[0] ?? '').sort();

    // Each row: a function whose tracked local/param binding names must equal `expected`.
    const trackedNameCases: NamesCase[] = [
      {
        name: 'params and locals - includes both',
        code: 'function f(a: number) { const b = 1; return a + b; }',
        expected: ['a', 'b'],
      },
      {
        name: 'only locals no params - includes locals',
        code: 'function f() { const a = 1; let b = 2; return a + b; }',
        expected: ['a', 'b'],
      },
      {
        name: 'destructuring declaration - includes each binding',
        code: 'function f() { const { a, b } = { a: 1, b: 2 }; return a + b; }',
        expected: ['a', 'b'],
      },
    ];

    it.each(trackedNameCases)('collectLocalVarIndexes - $name', ({ code, expected }) => {
      const indexes = localVarIndexes(code);

      expect(namesOf(indexes)).toEqual([...expected].sort());
    });

    it('collectLocalVarIndexes - assigns unique index to each variable', () => {
      // Arrange
      const fn = firstFunction('function f(x: number) { const y = 1; const z = 2; return x + y + z; }');
      // Act
      const indexes = collectLocalVarIndexes(fn, TEST_FILE_PATH, _lastSource);
      // Assert
      const values = [...indexes.values()];
      const uniqueValues = new Set(values);

      expect(uniqueValues.size).toBe(values.length);
    });

    // IIFE-internal `x` must never be hoisted into the outer function's local set,
    // whether the IIFE is a sync function expression or a nested async arrow.
    const iifeScopeCases: CodeOnlyCase[] = [
      {
        name: 'IIFE inside function body - does not include IIFE-internal declarations',
        code: 'function outer() { (function inner() { const x = getX(); console.log(x); })(); }',
      },
      {
        name: 'async arrow IIFE inside async arrow - does not include IIFE-internal declarations',
        code: 'const getOrmDb = async () => { const created = (async () => { const x = getX(); return x; })(); return created; };',
      },
    ];

    it.each(iifeScopeCases)('collectLocalVarIndexes - $name', ({ code }) => {
      const indexes = localVarIndexes(code);
      const xKeys = [...indexes.keys()].filter(key => key.startsWith('x@'));

      expect(xKeys).toEqual([]);
    });

    it('collectLocalVarIndexes - async arrow IIFE - outer body local (created) is still tracked', () => {
      const fn = firstFunction(
        'const getOrmDb = async () => { const created = (async () => { const x = getX(); return x; })(); return created; };',
      );
      const indexes = collectLocalVarIndexes(fn, TEST_FILE_PATH, _lastSource);

      expect(namesOf(indexes)).toContain('created');
    });

    it('collectLocalVarIndexes - same name in outer and inner block - distinct indexes (no shadow collision)', () => {
      // Arrange — outer param x and inner block `let x` are separate bindings
      const fn = firstFunction('function f(x: number) { { let x = 1; return x; } }');
      // Act
      const indexes = collectLocalVarIndexes(fn, TEST_FILE_PATH, _lastSource);
      // Assert — both bindings tracked, with different varIndexes
      const xKeys = [...indexes.keys()].filter(k => k.startsWith('x@'));

      expect(xKeys.length).toBe(2);

      const xIndexes = new Set(xKeys.map(k => indexes.get(k)));

      expect(xIndexes.size).toBe(2);
    });
  });

  // ── analyzeFunctionBody ──

  describe('analyzeFunctionBody', () => {
    it('analyzeFunctionBody - simple function - defs and usedDefs populated', () => {
      // Arrange & Act
      const analysis = analyzeFirstFunction('function f() { const x = 1; return x; }');

      // Assert
      expect(analysis.defs.length).toBeGreaterThanOrEqual(1);
      expect(analysis.usedDefs.array().length).toBeGreaterThanOrEqual(1);
    });

    it('analyzeFunctionBody - unused variable - not in usedDefs', () => {
      // Arrange & Act
      const analysis = analyzeFirstFunction('function f() { const unused = 42; return 1; }');
      // Assert
      const unusedDef = analysis.defs.find(d => d.name === 'unused');

      const defId = defIndexOf(analysis, unusedDef);

      expect(analysis.usedDefs.has(defId)).toBe(false);
    });

    it('analyzeFunctionBody - defsOfVar - populated for each variable index', () => {
      // Arrange
      const code = 'function f() { const a = 1; let b = 2; b = 3; return a + b; }';
      const fn = firstFunction(code);
      const localIndexByName = collectLocalVarIndexes(fn, TEST_FILE_PATH, _lastSource);
      const paramBindings = collectParameterBindings(fn);
      const body = (fn as any).body;
      // Act
      const analysis = analyzeFunctionBody(
        body,
        localIndexByName,
        paramBindings,
        [],
        buildDeclScopeMap(fn, TEST_FILE_PATH, _lastSource),
      );

      // Assert
      expect(analysis.defsOfVar.length).toBe(localIndexByName.size);

      const bKey = [...localIndexByName.keys()].find(k => k.startsWith('b@'));

      expect(bKey).toBeDefined();

      const bIndex = localIndexByName.get(bKey!);

      expect(typeof bIndex).toBe('number');

      // b has two defs: declaration (b = 2) and assignment (b = 3)
      const bDefIds = analysis.defsOfVar[bIndex!]?.array() ?? [];

      expect(bDefIds.length).toBe(2);
    });

    it('analyzeFunctionBody - parameters - registered as defs at entry node', () => {
      // Arrange & Act
      const analysis = analyzeFirstFunction('function f(x: number, y: string) { return x; }');
      // Assert
      const paramDefs = analysis.defs.filter(d => d.writeKind === 'declaration');
      const paramNames = paramDefs.map(d => d.name);

      expect(paramNames).toContain('x');
      expect(paramNames).toContain('y');
    });

    it('analyzeFunctionBody - overwritten def - detected in overwrittenDefIds', () => {
      // Arrange & Act
      const analysis = analyzeFirstFunction('function f() { let x = 1; x = 2; return x; }');
      // Assert — the first def (x = 1) should be overwritten by (x = 2)
      const firstXDef = analysis.defs.find(d => d.name === 'x' && d.writeKind === 'declaration');

      const firstDefId = defIndexOf(analysis, firstXDef);

      expect(analysis.overwrittenDefIds[firstDefId]).toBe(true);
    });

    it('analyzeFunctionBody - reaching defs across if/else - both branch defs reach merge point', () => {
      // Arrange & Act
      const analysis = analyzeFirstFunction(`function f(cond: boolean) {
        let x = 0;
        if (cond) { x = 1; } else { x = 2; }
        return x;
      }`);
      // Assert — x at return should have usedDefs from both branches
      const xDefs = analysis.defs.filter(d => d.name === 'x' && d.writeKind === 'assignment');

      expect(xDefs.length).toBe(2);

      // Both assignment defs should be in usedDefs (both reach return)
      for (const def of xDefs) {
        const defId = analysis.defs.indexOf(def);

        expect(analysis.usedDefs.has(defId)).toBe(true);
      }
    });
  });
});
