import { describe, expect, it } from 'bun:test';

import type { BindingName } from './reaching-defs';

import { collectFunctionNodes } from '../ast/oxc-ast-utils';
import { parseSource } from '../ast/parse-source';
import { analyzeFunctionBody, collectLocalVarIndexes, collectParameterBindings, extractBindingNames } from './reaching-defs';
import { buildDeclScopeMap } from './variable-collector';

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

const analyzeFirstFunction = (code: string) => {
  const fn = firstFunction(code);
  const localIndexByName = collectLocalVarIndexes(fn, TEST_FILE_PATH, _lastSource);
  const paramBindings = collectParameterBindings(fn);
  const body = (fn as any).body;

  return analyzeFunctionBody(body, localIndexByName, paramBindings, [], buildDeclScopeMap(fn, TEST_FILE_PATH, _lastSource));
};

describe('engine/dataflow/reaching-defs', () => {
  // ── extractBindingNames ──

  describe('extractBindingNames', () => {
    it('extractBindingNames - Identifier node - returns name and location', () => {
      // Arrange
      const fn = firstFunction('function f(x: number) { return x; }');
      const params = (fn as any).params as any[];
      const out: BindingName[] = [];

      // Act
      extractBindingNames(params[0], out);
      // Assert
      expect(out.length).toBe(1);
      expect(out[0]?.name).toBe('x');
      expect(typeof out[0]?.location).toBe('number');
    });

    it('extractBindingNames - ObjectPattern - returns all property bindings', () => {
      // Arrange
      const fn = firstFunction('function f({ a, b }: { a: number; b: number }) { return a + b; }');
      const params = (fn as any).params as any[];
      const out: BindingName[] = [];

      // Act
      extractBindingNames(params[0], out);
      // Assert
      expect(out.length).toBe(2);
      expect(out.map(b => b.name).sort()).toEqual(['a', 'b']);
    });

    it('extractBindingNames - ArrayPattern - returns element bindings', () => {
      // Arrange
      const fn = firstFunction('function f([a, b]: number[]) { return a + b; }');
      const params = (fn as any).params as any[];
      const out: BindingName[] = [];

      // Act
      extractBindingNames(params[0], out);
      // Assert
      expect(out.length).toBe(2);
      expect(out.map(b => b.name).sort()).toEqual(['a', 'b']);
    });

    it('extractBindingNames - ObjectPattern with RestElement - returns rest binding', () => {
      // Arrange
      const fn = firstFunction('function f({ a, ...rest }: any) { return rest; }');
      const params = (fn as any).params as any[];
      const out: BindingName[] = [];

      // Act
      extractBindingNames(params[0], out);
      // Assert
      expect(out.map(b => b.name).sort()).toEqual(['a', 'rest']);
    });

    it('extractBindingNames - AssignmentPattern (default value) - returns binding name', () => {
      // Arrange
      const fn = firstFunction('function f({ a = 1 }: { a?: number }) { return a; }');
      const params = (fn as any).params as any[];
      const out: BindingName[] = [];

      // Act
      extractBindingNames(params[0], out);
      // Assert
      expect(out.length).toBe(1);
      expect(out[0]?.name).toBe('a');
    });

    it('extractBindingNames - nested pattern [{ a }] - returns inner binding', () => {
      // Arrange
      const fn = firstFunction('function f([{ a }]: [{ a: number }]) { return a; }');
      const params = (fn as any).params as any[];
      const out: BindingName[] = [];

      // Act
      extractBindingNames(params[0], out);
      // Assert
      expect(out.length).toBe(1);
      expect(out[0]?.name).toBe('a');
    });

    it('extractBindingNames - RestElement at top level - returns binding', () => {
      // Arrange
      const fn = firstFunction('function f(...args: number[]) { return args; }');
      const params = (fn as any).params as any[];
      const out: BindingName[] = [];

      // Act
      extractBindingNames(params[0], out);
      // Assert
      expect(out.length).toBe(1);
      expect(out[0]?.name).toBe('args');
    });
  });

  // ── collectParameterBindings ──

  describe('collectParameterBindings', () => {
    it('collectParameterBindings - simple params - returns all parameter names', () => {
      // Arrange
      const fn = firstFunction('function f(a: number, b: string) { return a; }');
      // Act
      const bindings = collectParameterBindings(fn);

      // Assert
      expect(bindings.length).toBe(2);
      expect(bindings.map(b => b.name)).toEqual(['a', 'b']);
    });

    it('collectParameterBindings - destructured param - returns inner bindings', () => {
      // Arrange
      const fn = firstFunction('function f({ x, y }: { x: number; y: number }) { return x; }');
      // Act
      const bindings = collectParameterBindings(fn);

      // Assert
      expect(bindings.length).toBe(2);
      expect(bindings.map(b => b.name).sort()).toEqual(['x', 'y']);
    });

    it('collectParameterBindings - no params - returns empty array', () => {
      // Arrange
      const fn = firstFunction('function f() { return 1; }');
      // Act
      const bindings = collectParameterBindings(fn);

      // Assert
      expect(bindings.length).toBe(0);
    });

    it('collectParameterBindings - rest param - returns rest binding', () => {
      // Arrange
      const fn = firstFunction('function f(a: number, ...rest: number[]) { return rest; }');
      // Act
      const bindings = collectParameterBindings(fn);

      // Assert
      expect(bindings.length).toBe(2);
      expect(bindings.map(b => b.name)).toEqual(['a', 'rest']);
    });
  });

  // ── collectLocalVarIndexes ──

  describe('collectLocalVarIndexes', () => {
    // Helper: extract just the names from bindingKey strings (`name@scope`).
    // Used so assertions don't depend on the scope-key format, which is now
    // sourced from gildash's tsc-resolved declaration positions instead of
    // ScopeTracker's lexical-scope strings (`''`, `'0'`, ...).
    const namesOf = (indexes: Map<string, number>): string[] => [...indexes.keys()].map(k => k.split('@')[0] ?? '').sort();

    it('collectLocalVarIndexes - params and locals - includes both', () => {
      // Arrange
      const fn = firstFunction('function f(a: number) { const b = 1; return a + b; }');
      // Act
      const indexes = collectLocalVarIndexes(fn, TEST_FILE_PATH, _lastSource);

      // Assert — both parameter and body local are tracked
      expect(indexes.size).toBe(2);
      expect(namesOf(indexes)).toEqual(['a', 'b']);
    });

    it('collectLocalVarIndexes - only locals no params - includes locals', () => {
      // Arrange
      const fn = firstFunction('function f() { const a = 1; let b = 2; return a + b; }');
      // Act
      const indexes = collectLocalVarIndexes(fn, TEST_FILE_PATH, _lastSource);

      // Assert
      expect(indexes.size).toBe(2);
      expect(namesOf(indexes)).toEqual(['a', 'b']);
    });

    it('collectLocalVarIndexes - destructuring declaration - includes each binding', () => {
      // Arrange
      const fn = firstFunction('function f() { const { a, b } = { a: 1, b: 2 }; return a + b; }');
      // Act
      const indexes = collectLocalVarIndexes(fn, TEST_FILE_PATH, _lastSource);

      // Assert
      expect(namesOf(indexes)).toEqual(['a', 'b']);
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

    it('collectLocalVarIndexes - IIFE inside function body - does not include IIFE-internal declarations', () => {
      // Arrange — x inside the IIFE belongs to the IIFE scope, not outer
      const fn = firstFunction('function outer() { (function inner() { const x = getX(); console.log(x); })(); }');
      // Act
      const indexes = collectLocalVarIndexes(fn, TEST_FILE_PATH, _lastSource);

      // Assert — outer has no locals of its own; x is IIFE-internal
      for (const key of indexes.keys()) {
        expect(key.startsWith('x@')).toBe(false);
      }
    });

    it('collectLocalVarIndexes - async arrow IIFE inside async arrow - does not include IIFE-internal declarations', () => {
      // Arrange
      const fn = firstFunction(
        'const getOrmDb = async () => { const created = (async () => { const x = getX(); return x; })(); return created; };',
      );
      // Act
      const indexes = collectLocalVarIndexes(fn, TEST_FILE_PATH, _lastSource);

      // Assert — x belongs to async IIFE scope; created belongs to outer body block
      for (const key of indexes.keys()) {
        expect(key.startsWith('x@')).toBe(false);
      }

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

      expect(unusedDef).toBeDefined();

      const defId = analysis.defs.indexOf(unusedDef!);

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

      expect(firstXDef).toBeDefined();

      const firstDefId = analysis.defs.indexOf(firstXDef!);

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
