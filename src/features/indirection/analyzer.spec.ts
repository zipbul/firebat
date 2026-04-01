import type { Gildash, CodeRelation, FullSymbol, SymbolSearchResult } from '@zipbul/gildash';

import { describe, expect, it } from 'bun:test';

import type { ParsedFile } from '../../engine/types';

import { parseSource } from '../../engine/ast/parse-source';
import { analyzeIndirection } from './analyzer';

/* ------------------------------------------------------------------ */
/*  Mock gildash factory                                               */
/* ------------------------------------------------------------------ */

interface MockGildashOverrides {
  searchRelations?: (q: unknown) => CodeRelation[];
  searchSymbols?: (q: unknown) => SymbolSearchResult[];
  isTypeAssignableTo?: (src: string, srcFile: string, dst: string, dstFile: string) => boolean | null;
  getFullSymbol?: (name: string, filePath: string) => FullSymbol | null;
}

const createMockGildash = (overrides: MockGildashOverrides = {}): Gildash => {
  return {
    searchRelations: overrides.searchRelations ?? (() => []),
    searchSymbols: overrides.searchSymbols ?? (() => []),
    isTypeAssignableTo: overrides.isTypeAssignableTo ?? (() => null),
    getFullSymbol: overrides.getFullSymbol ?? (() => null),
  } as unknown as Gildash;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const createProgram = (filePath: string, sourceText: string): ParsedFile[] => {
  return [parseSource(filePath, sourceText)];
};

const findKinds = (findings: Awaited<ReturnType<typeof analyzeIndirection>>, kind: string) => {
  return findings.filter(finding => finding.kind === kind);
};

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('analyzer', () => {
  it('analyzeIndirection - function only forwards call - reports thin-wrapper', async () => {
    // Arrange
    const source = [
      'function target(value) {',
      '  return value + 1;',
      '}',
      'function wrapper(value) {',
      '  return target(value);',
      '}',
    ].join('\n');
    const program = createProgram('/virtual/indirection.ts', source);
    const gildash = createMockGildash();
    // Act
    const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
    const thinWrappers = findKinds(analysis, 'thin-wrapper');

    // Assert
    expect(thinWrappers.length).toBe(1);
    expect(thinWrappers[0]?.header).toBe('wrapper');
  });

  it('analyzeIndirection - overloaded and non-overloaded coexist - only non-overloaded flagged', async () => {
    // Arrange — file has both overloaded greet and non-overloaded wrapper
    const source = [
      'function greet(name: string): string;',
      'function greet(name: string, age: number): string;',
      'function greet(name: string, age?: number): string {',
      '  return formatGreeting(name, age);',
      '}',
      'function wrapper(value) {',
      '  return target(value);',
      '}',
    ].join('\n');
    const program = createProgram('/virtual/mixed.ts', source);
    const gildash = createMockGildash({
      searchSymbols: () =>
        [
          {
            name: 'greet',
            kind: 'function',
            filePath: 'mixed.ts',
            isExported: false,
            span: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
            id: 1,
            signature: 'params:1|async:0',
            fingerprint: null,
          },
          {
            name: 'greet',
            kind: 'function',
            filePath: 'mixed.ts',
            isExported: false,
            span: { start: { line: 2, column: 0 }, end: { line: 2, column: 0 } },
            id: 2,
            signature: 'params:2|async:0',
            fingerprint: null,
          },
          {
            name: 'greet',
            kind: 'function',
            filePath: 'mixed.ts',
            isExported: false,
            span: { start: { line: 3, column: 0 }, end: { line: 5, column: 0 } },
            id: 3,
            signature: 'params:2|async:0',
            fingerprint: null,
          },
          {
            name: 'wrapper',
            kind: 'function',
            filePath: 'mixed.ts',
            isExported: false,
            span: { start: { line: 6, column: 0 }, end: { line: 8, column: 0 } },
            id: 4,
            signature: 'params:1|async:0',
            fingerprint: null,
          },
        ] as unknown as SymbolSearchResult[],
    });
    // Act
    const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
    const thinWrappers = findKinds(analysis, 'thin-wrapper');

    // Assert — greet (overloaded) skipped, wrapper (non-overloaded) flagged
    expect(thinWrappers.length).toBe(1);
    expect(thinWrappers[0]?.header).toBe('wrapper');
  });

  it('analyzeIndirection - overloaded function with pass-through - skips wrapper', async () => {
    // Arrange — overloaded functions provide type narrowing, not simple indirection
    const source = [
      'function greet(name: string): string;',
      'function greet(name: string, age: number): string;',
      'function greet(name: string, age?: number): string {',
      '  return formatGreeting(name, age);',
      '}',
    ].join('\n');
    const program = createProgram('/virtual/overloaded.ts', source);
    // Mock: searchSymbols returns 3 rows for 'greet' (2 overloads + 1 impl)
    const gildash = createMockGildash({
      searchSymbols: () =>
        [
          {
            name: 'greet',
            kind: 'function',
            filePath: 'overloaded.ts',
            isExported: false,
            span: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
            id: 1,
            signature: 'params:1|async:0',
            fingerprint: null,
          },
          {
            name: 'greet',
            kind: 'function',
            filePath: 'overloaded.ts',
            isExported: false,
            span: { start: { line: 2, column: 0 }, end: { line: 2, column: 0 } },
            id: 2,
            signature: 'params:2|async:0',
            fingerprint: null,
          },
          {
            name: 'greet',
            kind: 'function',
            filePath: 'overloaded.ts',
            isExported: false,
            span: { start: { line: 3, column: 0 }, end: { line: 5, column: 0 } },
            id: 3,
            signature: 'params:2|async:0',
            fingerprint: null,
          },
        ] as unknown as SymbolSearchResult[],
    });
    // Act
    const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
    const thinWrappers = findKinds(analysis, 'thin-wrapper');

    // Assert — overloaded function should NOT be flagged as thin-wrapper
    expect(thinWrappers.length).toBe(0);
  });

  it('analyzeIndirection - overloaded method with memberName - skips wrapper', async () => {
    // Arrange — method overload: sym.name = "MyClass.greet", sym.memberName = "greet"
    const source = [
      'class MyClass {',
      '  greet(name: string): string;',
      '  greet(name: string, age: number): string;',
      '  greet(name: string, age?: number): string {',
      '    return formatGreeting(name, age);',
      '  }',
      '}',
    ].join('\n');
    const program = createProgram('/virtual/method-overload.ts', source);
    const gildash = createMockGildash({
      searchSymbols: () =>
        [
          {
            name: 'MyClass.greet',
            memberName: 'greet',
            kind: 'method',
            filePath: 'method-overload.ts',
            isExported: false,
            span: { start: { line: 2, column: 2 }, end: { line: 2, column: 30 } },
            id: 1,
            signature: 'params:1|async:0',
            fingerprint: null,
          },
          {
            name: 'MyClass.greet',
            memberName: 'greet',
            kind: 'method',
            filePath: 'method-overload.ts',
            isExported: false,
            span: { start: { line: 3, column: 2 }, end: { line: 3, column: 38 } },
            id: 2,
            signature: 'params:2|async:0',
            fingerprint: null,
          },
          {
            name: 'MyClass.greet',
            memberName: 'greet',
            kind: 'method',
            filePath: 'method-overload.ts',
            isExported: false,
            span: { start: { line: 4, column: 2 }, end: { line: 6, column: 3 } },
            id: 3,
            signature: 'params:2|async:0',
            fingerprint: null,
          },
        ] as unknown as SymbolSearchResult[],
    });
    // Act
    const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
    const thinWrappers = findKinds(analysis, 'thin-wrapper');

    // Assert — overloaded method should NOT be flagged as thin-wrapper
    expect(thinWrappers.length).toBe(0);
  });

  it('analyzeIndirection - function and method with same unqualified name - no false overload collision', async () => {
    // Arrange — top-level function "greet" and method "MyClass.greet" coexist
    // They should NOT be counted together as overloads
    const source = [
      'function greet(name) { return format(name); }',
      'class MyClass {',
      '  greet(name) { return format(name); }',
      '}',
    ].join('\n');
    const program = createProgram('/virtual/collision.ts', source);
    const gildash = createMockGildash({
      searchSymbols: () =>
        [
          {
            name: 'greet',
            memberName: null,
            kind: 'function',
            filePath: 'collision.ts',
            isExported: false,
            span: { start: { line: 1, column: 0 }, end: { line: 1, column: 40 } },
            id: 1,
            signature: 'params:1|async:0',
            fingerprint: null,
          },
          {
            name: 'MyClass.greet',
            memberName: 'greet',
            kind: 'method',
            filePath: 'collision.ts',
            isExported: false,
            span: { start: { line: 3, column: 2 }, end: { line: 3, column: 40 } },
            id: 2,
            signature: 'params:1|async:0',
            fingerprint: null,
          },
        ] as unknown as SymbolSearchResult[],
    });
    // Act
    const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
    const thinWrappers = findKinds(analysis, 'thin-wrapper');

    // Assert — neither is overloaded, both should be flagged as thin-wrapper
    expect(thinWrappers.length).toBe(2);
  });

  it('analyzeIndirection - arguments are transformed - skips wrapper', async () => {
    // Arrange
    const source = [
      'function target(value) {',
      '  return value + 1;',
      '}',
      'function wrapper(value) {',
      '  return target(value + 1);',
      '}',
    ].join('\n');
    const program = createProgram('/virtual/indirection-transform.ts', source);
    const gildash = createMockGildash();
    // Act
    const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
    const thinWrappers = findKinds(analysis, 'thin-wrapper');

    // Assert
    expect(thinWrappers.length).toBe(0);
  });

  it('analyzeIndirection - chain depth exceeds max - reports forward-chain', async () => {
    // Arrange
    const source = [
      'function c(value) {',
      '  return value;',
      '}',
      'function b(value) {',
      '  return c(value);',
      '}',
      'function a(value) {',
      '  return b(value);',
      '}',
    ].join('\n');
    const program = createProgram('/virtual/indirection-chain.ts', source);
    const gildash = createMockGildash();
    // Act
    const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 1, crossFileMinDepth: 2 }, '/virtual');
    const chainFindings = findKinds(analysis, 'forward-chain');

    // Assert
    expect(chainFindings.length).toBe(1);
    expect(chainFindings[0]?.header).toBe('a');
  });

  it('analyzeIndirection - chain depth within max - skips forward-chain', async () => {
    // Arrange
    const source = [
      'function c(value) {',
      '  return value;',
      '}',
      'function b(value) {',
      '  return c(value);',
      '}',
      'function a(value) {',
      '  return b(value);',
      '}',
    ].join('\n');
    const program = createProgram('/virtual/indirection-depth.ts', source);
    const gildash = createMockGildash();
    // Act
    const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 2, crossFileMinDepth: 2 }, '/virtual');
    const chainFindings = findKinds(analysis, 'forward-chain');

    // Assert
    expect(chainFindings.length).toBe(0);
  });

  describe('type-remap', () => {
    it('analyzeIndirection - type alias is direct synonym - reports type-remap', async () => {
      // Arrange
      const program = createProgram('/virtual/remap.ts', 'type A = B;');
      const gildash = createMockGildash();
      // Act
      const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
      const remaps = findKinds(analysis, 'type-remap');

      // Assert
      expect(remaps.length).toBe(1);
      expect(remaps[0]?.header).toBe('A');
    });

    it('analyzeIndirection - exported type alias synonym - reports type-remap', async () => {
      // Arrange
      const program = createProgram('/virtual/remap.ts', 'export type A = B;');
      // Act
      const analysis = await analyzeIndirection(
        createMockGildash(),
        program,
        { maxForwardDepth: 0, crossFileMinDepth: 2 },
        '/virtual',
      );

      // Assert
      expect(findKinds(analysis, 'type-remap').length).toBe(1);
    });

    it('analyzeIndirection - namespace qualified type synonym - reports type-remap', async () => {
      // Arrange
      const program = createProgram('/virtual/remap.ts', 'type Node = ts.Node;');
      // Act
      const analysis = await analyzeIndirection(
        createMockGildash(),
        program,
        { maxForwardDepth: 0, crossFileMinDepth: 2 },
        '/virtual',
      );

      // Assert
      expect(findKinds(analysis, 'type-remap').length).toBe(1);
    });

    it('analyzeIndirection - type alias to primitive keyword - skips', async () => {
      // Arrange
      const program = createProgram('/virtual/remap.ts', 'type UserId = string;');
      // Act
      const analysis = await analyzeIndirection(
        createMockGildash(),
        program,
        { maxForwardDepth: 0, crossFileMinDepth: 2 },
        '/virtual',
      );

      // Assert
      expect(findKinds(analysis, 'type-remap').length).toBe(0);
    });

    it('analyzeIndirection - type alias with generic args - skips', async () => {
      // Arrange
      const program = createProgram('/virtual/remap.ts', 'type StringArray = Array<string>;');
      // Act
      const analysis = await analyzeIndirection(
        createMockGildash(),
        program,
        { maxForwardDepth: 0, crossFileMinDepth: 2 },
        '/virtual',
      );

      // Assert
      expect(findKinds(analysis, 'type-remap').length).toBe(0);
    });

    it('analyzeIndirection - type alias with type params - skips', async () => {
      // Arrange
      const program = createProgram('/virtual/remap.ts', 'type MyArray<T> = Array<T>;');
      // Act
      const analysis = await analyzeIndirection(
        createMockGildash(),
        program,
        { maxForwardDepth: 0, crossFileMinDepth: 2 },
        '/virtual',
      );

      // Assert
      expect(findKinds(analysis, 'type-remap').length).toBe(0);
    });

    it('analyzeIndirection - union type alias - skips', async () => {
      // Arrange
      const program = createProgram('/virtual/remap.ts', 'type A = B | null;');
      // Act
      const analysis = await analyzeIndirection(
        createMockGildash(),
        program,
        { maxForwardDepth: 0, crossFileMinDepth: 2 },
        '/virtual',
      );

      // Assert
      expect(findKinds(analysis, 'type-remap').length).toBe(0);
    });

    it('analyzeIndirection - intersection type alias - skips', async () => {
      // Arrange
      const program = createProgram('/virtual/remap.ts', 'type A = B & { x: 1 };');
      // Act
      const analysis = await analyzeIndirection(
        createMockGildash(),
        program,
        { maxForwardDepth: 0, crossFileMinDepth: 2 },
        '/virtual',
      );

      // Assert
      expect(findKinds(analysis, 'type-remap').length).toBe(0);
    });

    it('analyzeIndirection - typeof type alias - skips', async () => {
      // Arrange
      const program = createProgram('/virtual/remap.ts', 'const x = 1; type Config = typeof x;');
      // Act
      const analysis = await analyzeIndirection(
        createMockGildash(),
        program,
        { maxForwardDepth: 0, crossFileMinDepth: 2 },
        '/virtual',
      );

      // Assert
      expect(findKinds(analysis, 'type-remap').length).toBe(0);
    });

    it('analyzeIndirection - utility type alias with generic args - skips', async () => {
      // Arrange
      const program = createProgram('/virtual/remap.ts', 'type ReadonlyUser = Readonly<User>;');
      // Act
      const analysis = await analyzeIndirection(
        createMockGildash(),
        program,
        { maxForwardDepth: 0, crossFileMinDepth: 2 },
        '/virtual',
      );

      // Assert
      expect(findKinds(analysis, 'type-remap').length).toBe(0);
    });

    it('analyzeIndirection - keyof type alias - skips', async () => {
      // Arrange
      const program = createProgram('/virtual/remap.ts', 'type Keys = keyof User;');
      // Act
      const analysis = await analyzeIndirection(
        createMockGildash(),
        program,
        { maxForwardDepth: 0, crossFileMinDepth: 2 },
        '/virtual',
      );

      // Assert
      expect(findKinds(analysis, 'type-remap').length).toBe(0);
    });

    it('analyzeIndirection - indexed access type alias - skips', async () => {
      // Arrange
      const program = createProgram('/virtual/remap.ts', "type Name = User['name'];");
      // Act
      const analysis = await analyzeIndirection(
        createMockGildash(),
        program,
        { maxForwardDepth: 0, crossFileMinDepth: 2 },
        '/virtual',
      );

      // Assert
      expect(findKinds(analysis, 'type-remap').length).toBe(0);
    });

    it('analyzeIndirection - template literal type alias - skips', async () => {
      // Arrange
      const program = createProgram('/virtual/remap.ts', 'type E = `on${string}`;');
      // Act
      const analysis = await analyzeIndirection(
        createMockGildash(),
        program,
        { maxForwardDepth: 0, crossFileMinDepth: 2 },
        '/virtual',
      );

      // Assert
      expect(findKinds(analysis, 'type-remap').length).toBe(0);
    });

    it('analyzeIndirection - object literal type alias - skips', async () => {
      // Arrange
      const program = createProgram('/virtual/remap.ts', 'type T = { x: number };');
      // Act
      const analysis = await analyzeIndirection(
        createMockGildash(),
        program,
        { maxForwardDepth: 0, crossFileMinDepth: 2 },
        '/virtual',
      );

      // Assert
      expect(findKinds(analysis, 'type-remap').length).toBe(0);
    });

    it('analyzeIndirection - declare type alias - skips', async () => {
      // Arrange
      const program = createProgram('/virtual/remap.ts', 'declare type A = B;');
      // Act
      const analysis = await analyzeIndirection(
        createMockGildash(),
        program,
        { maxForwardDepth: 0, crossFileMinDepth: 2 },
        '/virtual',
      );

      // Assert
      expect(findKinds(analysis, 'type-remap').length).toBe(0);
    });

    it('analyzeIndirection - d.ts file type alias - skips', async () => {
      // Arrange
      const program = createProgram('/virtual/remap.d.ts', 'type A = B;');
      // Act
      const analysis = await analyzeIndirection(
        createMockGildash(),
        program,
        { maxForwardDepth: 0, crossFileMinDepth: 2 },
        '/virtual',
      );

      // Assert
      expect(findKinds(analysis, 'type-remap').length).toBe(0);
    });
  });

  describe('interface-rewrap', () => {
    it('analyzeIndirection - empty interface with single extends - reports interface-rewrap', async () => {
      // Arrange
      const program = createProgram('/virtual/rewrap.ts', 'interface A extends B {}');
      // Act
      const analysis = await analyzeIndirection(
        createMockGildash(),
        program,
        { maxForwardDepth: 0, crossFileMinDepth: 2 },
        '/virtual',
      );
      const rewraps = findKinds(analysis, 'interface-rewrap');

      // Assert
      expect(rewraps.length).toBe(1);
      expect(rewraps[0]?.header).toBe('A');
    });

    it('analyzeIndirection - empty interface with multiple extends - reports interface-rewrap', async () => {
      // Arrange
      const program = createProgram('/virtual/rewrap.ts', 'interface A extends B, C {}');
      // Act
      const analysis = await analyzeIndirection(
        createMockGildash(),
        program,
        { maxForwardDepth: 0, crossFileMinDepth: 2 },
        '/virtual',
      );

      // Assert
      expect(findKinds(analysis, 'interface-rewrap').length).toBe(1);
    });

    it('analyzeIndirection - empty interface extends generic base - reports interface-rewrap', async () => {
      // Arrange
      const program = createProgram('/virtual/rewrap.ts', 'interface A extends BaseRepo<User> {}');
      // Act
      const analysis = await analyzeIndirection(
        createMockGildash(),
        program,
        { maxForwardDepth: 0, crossFileMinDepth: 2 },
        '/virtual',
      );

      // Assert
      expect(findKinds(analysis, 'interface-rewrap').length).toBe(1);
    });

    it('analyzeIndirection - interface with members - skips', async () => {
      // Arrange
      const program = createProgram('/virtual/rewrap.ts', 'interface A extends B { x: number }');
      // Act
      const analysis = await analyzeIndirection(
        createMockGildash(),
        program,
        { maxForwardDepth: 0, crossFileMinDepth: 2 },
        '/virtual',
      );

      // Assert
      expect(findKinds(analysis, 'interface-rewrap').length).toBe(0);
    });

    it('analyzeIndirection - marker interface without extends - skips', async () => {
      // Arrange
      const program = createProgram('/virtual/rewrap.ts', 'interface A {}');
      // Act
      const analysis = await analyzeIndirection(
        createMockGildash(),
        program,
        { maxForwardDepth: 0, crossFileMinDepth: 2 },
        '/virtual',
      );

      // Assert
      expect(findKinds(analysis, 'interface-rewrap').length).toBe(0);
    });

    it('analyzeIndirection - declare interface - skips', async () => {
      // Arrange
      const program = createProgram('/virtual/rewrap.ts', 'declare interface A extends B {}');
      // Act
      const analysis = await analyzeIndirection(
        createMockGildash(),
        program,
        { maxForwardDepth: 0, crossFileMinDepth: 2 },
        '/virtual',
      );

      // Assert
      expect(findKinds(analysis, 'interface-rewrap').length).toBe(0);
    });

    it('analyzeIndirection - same-file interface declaration merging - skips', async () => {
      // Arrange
      const source = 'interface Foo extends Bar {}\ninterface Foo { x: number }';
      const program = createProgram('/virtual/rewrap.ts', source);
      // Act
      const analysis = await analyzeIndirection(
        createMockGildash(),
        program,
        { maxForwardDepth: 0, crossFileMinDepth: 2 },
        '/virtual',
      );

      // Assert
      expect(findKinds(analysis, 'interface-rewrap').length).toBe(0);
    });

    it('analyzeIndirection - class-interface declaration merging - skips', async () => {
      // Arrange
      const source = 'interface Table extends SQLWrapper {}\nclass Table implements SQLWrapper { static kind = "Table"; }';
      const program = createProgram('/virtual/rewrap.ts', source);
      // Act
      const analysis = await analyzeIndirection(
        createMockGildash(),
        program,
        { maxForwardDepth: 0, crossFileMinDepth: 2 },
        '/virtual',
      );

      // Assert
      expect(findKinds(analysis, 'interface-rewrap').length).toBe(0);
    });

    it('analyzeIndirection - cross-file declaration merging - skips', async () => {
      // Arrange
      const program = createProgram('/virtual/rewrap.ts', 'interface Express extends Base {}');
      const gildash = createMockGildash({
        searchSymbols: () => [
          { name: 'Express', filePath: '/virtual/rewrap.ts', kind: 'interface' } as unknown as SymbolSearchResult,
          { name: 'Express', filePath: '/virtual/other.ts', kind: 'interface' } as unknown as SymbolSearchResult,
        ],
      });
      // Act
      const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');

      // Assert
      expect(findKinds(analysis, 'interface-rewrap').length).toBe(0);
    });

    it('analyzeIndirection - module augmentation interface - skips', async () => {
      // Arrange
      const source = "declare module 'express' { interface Request extends Base {} }";
      const program = createProgram('/virtual/rewrap.ts', source);
      // Act
      const analysis = await analyzeIndirection(
        createMockGildash(),
        program,
        { maxForwardDepth: 0, crossFileMinDepth: 2 },
        '/virtual',
      );

      // Assert
      expect(findKinds(analysis, 'interface-rewrap').length).toBe(0);
    });

    it('analyzeIndirection - d.ts file interface - skips', async () => {
      // Arrange
      const program = createProgram('/virtual/rewrap.d.ts', 'interface A extends B {}');
      // Act
      const analysis = await analyzeIndirection(
        createMockGildash(),
        program,
        { maxForwardDepth: 0, crossFileMinDepth: 2 },
        '/virtual',
      );

      // Assert
      expect(findKinds(analysis, 'interface-rewrap').length).toBe(0);
    });
  });

  describe('crossFileMinDepth', () => {
    // Scenario:
    //   a.ts: export function foo(x) { return bar(x); }  — thin-wrapper, calls bar from b.ts
    //   b.ts: export function bar(x) { return baz(x); }  — thin-wrapper, calls baz from c.ts
    //   c.ts: export function baz(x) { return x + 1; }   — non-wrapper (terminal, not in crossFileWrappers)
    //
    // Depth resolution (fixpoint):
    //   bar.targetKey = /virtual/c.ts:baz, but baz is not a wrapper → bar.depth stays 0
    //   foo.targetKey = /virtual/b.ts:bar, bar is in crossFileWrappers (depth=0) → foo.depth = 1 + 0 = 1
    //
    // So: foo.depth=1, bar.depth=0
    const buildCrossFileSetup = () => {
      const files = [
        parseSource('/virtual/a.ts', 'import { bar } from "./b";\nexport function foo(x: any) { return bar(x); }'),
        parseSource('/virtual/b.ts', 'import { baz } from "./c";\nexport function bar(x: any) { return baz(x); }'),
        parseSource('/virtual/c.ts', 'export function baz(x: any) { return x + 1; }'),
      ];
      const gildash = createMockGildash({
        searchRelations: () => [
          {
            type: 'imports' as const,
            srcFilePath: '/virtual/a.ts',
            srcSymbolName: 'bar',
            dstFilePath: '/virtual/b.ts',
            dstSymbolName: 'bar',
          },
          {
            type: 'imports' as const,
            srcFilePath: '/virtual/b.ts',
            srcSymbolName: 'baz',
            dstFilePath: '/virtual/c.ts',
            dstSymbolName: 'baz',
          },
        ],
        searchSymbols: () => [
          { name: 'foo', filePath: '/virtual/a.ts' } as unknown as import('@zipbul/gildash').SymbolSearchResult,
          { name: 'bar', filePath: '/virtual/b.ts' } as unknown as import('@zipbul/gildash').SymbolSearchResult,
          { name: 'baz', filePath: '/virtual/c.ts' } as unknown as import('@zipbul/gildash').SymbolSearchResult,
        ],
      });

      return { files, gildash };
    };

    it('analyzeIndirection - cross-file chain depth 1 with minDepth 1 - reports foo finding', async () => {
      // Arrange: foo.depth=1 (foo→bar, bar is a wrapper in another file)
      const { files, gildash } = buildCrossFileSetup();
      // Act
      const analysis = await analyzeIndirection(gildash, files, { maxForwardDepth: 0, crossFileMinDepth: 1 }, '/virtual');
      const crossFindings = findKinds(analysis, 'cross-file-forwarding-chain');

      // Assert
      expect(crossFindings.length).toBeGreaterThanOrEqual(1);
      expect(crossFindings.some(f => f.header === 'foo')).toBe(true);
    });

    it('analyzeIndirection - cross-file chain depth 1 with minDepth 2 - skips', async () => {
      // Arrange: foo.depth=1 < minDepth=2 → no findings
      const { files, gildash } = buildCrossFileSetup();
      // Act
      const analysis = await analyzeIndirection(gildash, files, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
      const crossFindings = findKinds(analysis, 'cross-file-forwarding-chain');

      // Assert
      expect(crossFindings.length).toBe(0);
    });

    it('analyzeIndirection - cross-file terminal wrapper with minDepth 0 - reports bar finding', async () => {
      // Arrange: bar.depth=0 (bar→baz, baz is not a cross-file wrapper) → reported only when minDepth=0
      const { files, gildash } = buildCrossFileSetup();
      // Act
      const analysis = await analyzeIndirection(gildash, files, { maxForwardDepth: 0, crossFileMinDepth: 0 }, '/virtual');
      const crossFindings = findKinds(analysis, 'cross-file-forwarding-chain');

      // Assert
      expect(crossFindings.some(f => f.header === 'bar')).toBe(true);
    });
  });

  describe('type-remap semantic verification', () => {
    it('analyzeIndirection - complex alias with bidirectional assignability - reports type-remap', async () => {
      // Arrange: type AlreadyReadonly = Readonly<User> where User is already readonly (bidirectionally assignable)
      const source = 'type AlreadyReadonly = Readonly<User>;';
      const program = createProgram('/virtual/remap.ts', source);
      const gildash = createMockGildash({
        isTypeAssignableTo: (src, _srcFile, dst, _dstFile) => {
          // Both directions return true — structurally equivalent
          if (src === 'AlreadyReadonly' && dst === 'Readonly') {
            return true;
          }

          if (src === 'Readonly' && dst === 'AlreadyReadonly') {
            return true;
          }

          return null;
        },
      });
      // Act
      const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
      const remaps = findKinds(analysis, 'type-remap');

      // Assert
      expect(remaps.length).toBe(1);
      expect(remaps[0]?.header).toBe('AlreadyReadonly');
      expect(remaps[0]?.evidence).toContain('structurally equivalent');
    });

    it('analyzeIndirection - complex alias where only forward assignable - skips type-remap', async () => {
      // Arrange: type Narrowed = Readonly<User> where Narrowed is NOT assignable back to Readonly<User>
      const source = 'type Narrowed = Readonly<User>;';
      const program = createProgram('/virtual/remap.ts', source);
      const gildash = createMockGildash({
        isTypeAssignableTo: (src, _srcFile, dst, _dstFile) => {
          if (src === 'Narrowed' && dst === 'Readonly') {
            return true;
          }

          if (src === 'Readonly' && dst === 'Narrowed') {
            return false;
          } // not bidirectional

          return null;
        },
      });
      // Act
      const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
      const remaps = findKinds(analysis, 'type-remap');

      // Assert
      expect(remaps.length).toBe(0);
    });

    it('analyzeIndirection - complex alias where semantic check throws - skips gracefully', async () => {
      // Arrange: isTypeAssignableTo throws — should not propagate error
      const source = 'type Safe = Readonly<User>;';
      const program = createProgram('/virtual/remap.ts', source);
      const gildash = createMockGildash({
        isTypeAssignableTo: () => {
          throw new Error('semantic layer unavailable');
        },
      });
      // Act
      const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
      const remaps = findKinds(analysis, 'type-remap');

      // Assert: error is swallowed, no finding added for this complex case
      expect(remaps.length).toBe(0);
    });

    it('analyzeIndirection - declare complex alias - skips semantic check', async () => {
      // Arrange: declare type aliases are ambient declarations, must be skipped
      const source = 'declare type A = Readonly<User>;';
      const program = createProgram('/virtual/remap.ts', source);
      let called = false;
      const gildash = createMockGildash({
        isTypeAssignableTo: () => {
          called = true;

          return true;
        },
      });

      // Act
      await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');

      // Assert: semantic check must not be called for declare aliases
      expect(called).toBe(false);
    });
  });

  describe('thin-wrapper decorator filter', () => {
    it('analyzeIndirection - decorated wrapper function - skips thin-wrapper', async () => {
      // Arrange: wrapper has decorators (e.g. @Injectable) — intentional wrapping
      const source = [
        'function target(value) {',
        '  return value;',
        '}',
        'function wrapper(value) {',
        '  return target(value);',
        '}',
      ].join('\n');
      const program = createProgram('/virtual/decorated.ts', source);
      const gildash = createMockGildash({
        getFullSymbol: (name, _filePath) => {
          if (name === 'wrapper') {
            return {
              name: 'wrapper',
              kind: 'function',
              filePath: '/virtual/decorated.ts',
              isExported: false,
              span: { start: { line: 4, column: 0 }, end: { line: 6, column: 1 } },
              id: 1,
              signature: 'params:1|async:0',
              fingerprint: null,
              decorators: [{ name: 'Injectable' }],
            } as unknown as FullSymbol;
          }

          return null;
        },
      });
      // Act
      const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
      const thinWrappers = findKinds(analysis, 'thin-wrapper');

      // Assert: decorated wrapper should be skipped
      expect(thinWrappers.some(f => f.header === 'wrapper')).toBe(false);
    });

    it('analyzeIndirection - undecorated wrapper function - reports thin-wrapper', async () => {
      // Arrange: wrapper has no decorators → still flagged
      const source = [
        'function target(value) {',
        '  return value;',
        '}',
        'function wrapper(value) {',
        '  return target(value);',
        '}',
      ].join('\n');
      const program = createProgram('/virtual/nodecorators.ts', source);
      const gildash = createMockGildash({
        getFullSymbol: (name, _filePath) => {
          if (name === 'wrapper') {
            return {
              name: 'wrapper',
              kind: 'function',
              filePath: '/virtual/nodecorators.ts',
              isExported: false,
              span: { start: { line: 4, column: 0 }, end: { line: 6, column: 1 } },
              id: 1,
              signature: 'params:1|async:0',
              fingerprint: null,
              decorators: [],
            } as unknown as FullSymbol;
          }

          return null;
        },
      });
      // Act
      const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
      const thinWrappers = findKinds(analysis, 'thin-wrapper');

      // Assert: no decorators → still flagged as thin-wrapper
      expect(thinWrappers.some(f => f.header === 'wrapper')).toBe(true);
    });

    it('analyzeIndirection - getFullSymbol throws - keeps existing thin-wrapper behavior', async () => {
      // Arrange: getFullSymbol throws — fallback to original behavior
      const source = [
        'function target(value) {',
        '  return value;',
        '}',
        'function wrapper(value) {',
        '  return target(value);',
        '}',
      ].join('\n');
      const program = createProgram('/virtual/fallback.ts', source);
      const gildash = createMockGildash({
        getFullSymbol: () => {
          throw new Error('gildash unavailable');
        },
      });
      // Act
      const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
      const thinWrappers = findKinds(analysis, 'thin-wrapper');

      // Assert: error swallowed, original thin-wrapper finding preserved
      expect(thinWrappers.some(f => f.header === 'wrapper')).toBe(true);
    });
  });
});
