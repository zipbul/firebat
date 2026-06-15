import type { Gildash, CodeRelation, FullSymbol, SymbolSearchResult } from '@zipbul/gildash';

import { GildashError } from '@zipbul/gildash';
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

interface TypeRemapReportCase {
  name: string;
  source: string;
  header: string;
}

interface TypeRemapSkipCase {
  name: string;
  filePath: string;
  source: string;
}

interface InterfaceRewrapReportCase {
  name: string;
  source: string;
  header: string;
}

interface InterfaceRewrapSkipCase {
  name: string;
  filePath: string;
  source: string;
  gildash: Gildash;
}

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

  it('analyzeIndirection - arrow callback to .map - not flagged as thin-wrapper (arity-protective)', async () => {
    // Arrange — `(x) => target(x)` is NOT equivalent to `target` when used as
    // `.map` callback because .map passes (item, index, array). Inlining changes semantics.
    const source = [
      'function target(value: any) { return value + 1; }',
      'function caller(items: any[]) { return items.map(x => target(x)); }',
    ].join('\n');
    const program = createProgram('/virtual/arity-map.ts', source);
    const gildash = createMockGildash();
    // Act
    const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
    const thinWrappers = findKinds(analysis, 'thin-wrapper');

    // Assert — the arrow callback itself should NOT be a thin-wrapper finding.
    // (The named function `caller` is not a wrapper either since it does .map(...).)
    expect(thinWrappers.length).toBe(0);
  });

  it('analyzeIndirection - arrow callback to .forEach/.filter/.then - not flagged as thin-wrapper', async () => {
    // Arrange — multiple high-order method callbacks
    const source = [
      'declare const items: any[];',
      'declare const promise: Promise<any>;',
      'function process(x: any) { return x; }',
      'function run() {',
      '  items.forEach(x => process(x));',
      '  items.filter(x => process(x));',
      '  promise.then(x => process(x));',
      '}',
    ].join('\n');
    const program = createProgram('/virtual/high-order.ts', source);
    const gildash = createMockGildash();
    // Act
    const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
    const thinWrappers = findKinds(analysis, 'thin-wrapper');

    // Assert
    expect(thinWrappers.length).toBe(0);
  });

  it('analyzeIndirection - standalone arrow wrapper (not in high-order callback) - still flagged as thin-wrapper', async () => {
    // Arrange — control case: arrow assigned to const, not used as high-order callback
    const source = [
      'function target(value: any) { return value + 1; }',
      'const wrapper = (x: any) => target(x);',
      'export { wrapper };',
    ].join('\n');
    const program = createProgram('/virtual/standalone-arrow.ts', source);
    const gildash = createMockGildash();
    // Act
    const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
    const thinWrappers = findKinds(analysis, 'thin-wrapper');

    // Assert — standalone arrow IS a real thin-wrapper opportunity
    expect(thinWrappers.length).toBe(1);
  });

  it('analyzeIndirection - wrapper calling target via optional call - reports thin-wrapper', async () => {
    // Arrange — `wrapper(x) { return target?.(x); }` is a thin wrapper:
    // inlining is safe (or at least the wrapper is detectable). Previously skipped
    // because `core?.(x)` is wrapped in ChainExpression, not a bare CallExpression.
    const source = [
      'function target(value: any) { return value + 1; }',
      'function wrapper(value: any) { return target?.(value); }',
    ].join('\n');
    const program = createProgram('/virtual/optional-call.ts', source);
    const gildash = createMockGildash();
    // Act
    const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
    const thinWrappers = findKinds(analysis, 'thin-wrapper');

    // Assert — wrapper function should be flagged
    expect(thinWrappers.length).toBeGreaterThanOrEqual(1);
    expect(thinWrappers.some(t => t.header === 'wrapper')).toBe(true);
  });

  it('analyzeIndirection - wrapper calling target via awaited optional call - reports thin-wrapper', async () => {
    // Arrange — `async wrapper(x) { return await target?.(x); }`
    const source = [
      'async function target(value: any) { return value + 1; }',
      'async function wrapper(value: any) { return await target?.(value); }',
    ].join('\n');
    const program = createProgram('/virtual/awaited-optional.ts', source);
    const gildash = createMockGildash();
    // Act
    const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
    const thinWrappers = findKinds(analysis, 'thin-wrapper');

    // Assert
    expect(thinWrappers.some(t => t.header === 'wrapper')).toBe(true);
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
    // Each row declares a type alias that is a direct synonym; `header` is the
    // reported alias name.
    const reportCases: TypeRemapReportCase[] = [
      { name: 'type alias is direct synonym', source: 'type A = B;', header: 'A' },
      { name: 'exported type alias synonym', source: 'export type A = B;', header: 'A' },
      { name: 'namespace qualified type synonym', source: 'type Node = ts.Node;', header: 'Node' },
    ];

    it.each(reportCases)('analyzeIndirection - $name - reports type-remap', async ({ source, header }) => {
      // Arrange
      const program = createProgram('/virtual/remap.ts', source);
      // Act
      const analysis = await analyzeIndirection(
        createMockGildash(),
        program,
        { maxForwardDepth: 0, crossFileMinDepth: 2 },
        '/virtual',
      );
      const remaps = findKinds(analysis, 'type-remap');

      // Assert
      expect(remaps.length).toBe(1);
      expect(remaps[0]?.header).toBe(header);
    });

    // Each row is a type alias that must NOT be reported as a synonym; `filePath`
    // carries the d.ts variant for the ambient-declaration case.
    const skipCases: TypeRemapSkipCase[] = [
      { name: 'type alias to primitive keyword', filePath: '/virtual/remap.ts', source: 'type UserId = string;' },
      { name: 'type alias with generic args', filePath: '/virtual/remap.ts', source: 'type StringArray = Array<string>;' },
      { name: 'type alias with type params', filePath: '/virtual/remap.ts', source: 'type MyArray<T> = Array<T>;' },
      { name: 'union type alias', filePath: '/virtual/remap.ts', source: 'type A = B | null;' },
      { name: 'intersection type alias', filePath: '/virtual/remap.ts', source: 'type A = B & { x: 1 };' },
      { name: 'typeof type alias', filePath: '/virtual/remap.ts', source: 'const x = 1; type Config = typeof x;' },
      {
        name: 'utility type alias with generic args',
        filePath: '/virtual/remap.ts',
        source: 'type ReadonlyUser = Readonly<User>;',
      },
      { name: 'keyof type alias', filePath: '/virtual/remap.ts', source: 'type Keys = keyof User;' },
      { name: 'indexed access type alias', filePath: '/virtual/remap.ts', source: "type Name = User['name'];" },
      { name: 'template literal type alias', filePath: '/virtual/remap.ts', source: 'type E = `on${string}`;' },
      { name: 'object literal type alias', filePath: '/virtual/remap.ts', source: 'type T = { x: number };' },
      { name: 'declare type alias', filePath: '/virtual/remap.ts', source: 'declare type A = B;' },
      { name: 'd.ts file type alias', filePath: '/virtual/remap.d.ts', source: 'type A = B;' },
    ];

    it.each(skipCases)('analyzeIndirection - $name - skips', async ({ filePath, source }) => {
      // Arrange
      const program = createProgram(filePath, source);
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
    // Each row is an empty interface that only re-wraps its base(s); `header` is
    // the reported interface name.
    const reportCases: InterfaceRewrapReportCase[] = [
      { name: 'empty interface with single extends', source: 'interface A extends B {}', header: 'A' },
      { name: 'empty interface with multiple extends', source: 'interface A extends B, C {}', header: 'A' },
      { name: 'empty interface extends generic base', source: 'interface A extends BaseRepo<User> {}', header: 'A' },
    ];

    it.each(reportCases)('analyzeIndirection - $name - reports interface-rewrap', async ({ source, header }) => {
      // Arrange
      const program = createProgram('/virtual/rewrap.ts', source);
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
      expect(rewraps[0]?.header).toBe(header);
    });

    // Each row is an interface that must NOT be reported as a re-wrap. `filePath`
    // carries the d.ts variant; `gildash` carries the cross-file-merge override
    // (default mock otherwise) so the callback never needs a conditional.
    const skipCases: InterfaceRewrapSkipCase[] = [
      {
        name: 'interface with members',
        filePath: '/virtual/rewrap.ts',
        source: 'interface A extends B { x: number }',
        gildash: createMockGildash(),
      },
      {
        name: 'marker interface without extends',
        filePath: '/virtual/rewrap.ts',
        source: 'interface A {}',
        gildash: createMockGildash(),
      },
      {
        name: 'declare interface',
        filePath: '/virtual/rewrap.ts',
        source: 'declare interface A extends B {}',
        gildash: createMockGildash(),
      },
      {
        name: 'same-file interface declaration merging',
        filePath: '/virtual/rewrap.ts',
        source: 'interface Foo extends Bar {}\ninterface Foo { x: number }',
        gildash: createMockGildash(),
      },
      {
        name: 'class-interface declaration merging',
        filePath: '/virtual/rewrap.ts',
        source: 'interface Table extends SQLWrapper {}\nclass Table implements SQLWrapper { static kind = "Table"; }',
        gildash: createMockGildash(),
      },
      {
        name: 'cross-file declaration merging',
        filePath: '/virtual/rewrap.ts',
        source: 'interface Express extends Base {}',
        gildash: createMockGildash({
          searchSymbols: () => [
            { name: 'Express', filePath: '/virtual/rewrap.ts', kind: 'interface' } as unknown as SymbolSearchResult,
            { name: 'Express', filePath: '/virtual/other.ts', kind: 'interface' } as unknown as SymbolSearchResult,
          ],
        }),
      },
      {
        name: 'module augmentation interface',
        filePath: '/virtual/rewrap.ts',
        source: "declare module 'express' { interface Request extends Base {} }",
        gildash: createMockGildash(),
      },
      {
        name: 'd.ts file interface',
        filePath: '/virtual/rewrap.d.ts',
        source: 'interface A extends B {}',
        gildash: createMockGildash(),
      },
    ];

    it.each(skipCases)('analyzeIndirection - $name - skips', async ({ filePath, source, gildash }) => {
      // Arrange
      const program = createProgram(filePath, source);
      // Act
      const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');

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
          throw new GildashError('semantic', 'semantic layer unavailable');
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
              detail: { modifiers: [] },
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
          throw new GildashError('semantic', 'gildash unavailable');
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
