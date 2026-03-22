import type { Node } from 'oxc-parser';

import { describe, expect, it } from 'bun:test';

import type { ResolvedType } from '../../engine/semantic-types';
import { parseSource } from '../../engine/ast/parse-source';
import { __testing__ } from './semantic-checks';

const { containsUnknownOrAny, collectSafeContextRanges, isSafelyUsed } = __testing__;
// ResolvedType factory helpers
const TYPE_FLAG_ANY = 1;
const TYPE_FLAG_UNKNOWN = 2;

const makeType = (overrides: {
  flags?: number;
  text?: string;
  isUnion?: boolean;
  isIntersection?: boolean;
  isGeneric?: boolean;
  members?: ResolvedType[];
  typeArguments?: ResolvedType[];
}): ResolvedType => ({
  text: overrides.text ?? '',
  flags: overrides.flags ?? 0,
  isUnion: overrides.isUnion ?? false,
  isIntersection: overrides.isIntersection ?? false,
  isGeneric: overrides.isGeneric ?? false,
  ...(overrides.members !== undefined ? { members: overrides.members } : {}),
  ...(overrides.typeArguments !== undefined ? { typeArguments: overrides.typeArguments } : {}),
});

describe('containsUnknownOrAny', () => {
  it('direct unknown flag - returns unknown true, isDirect true', () => {
    const result = containsUnknownOrAny(makeType({ flags: TYPE_FLAG_UNKNOWN }));

    expect(result).toEqual({ unknown: true, any: false, isDirect: true });
  });

  it('direct any flag - returns any true, isDirect true', () => {
    const result = containsUnknownOrAny(makeType({ flags: TYPE_FLAG_ANY }));

    expect(result).toEqual({ unknown: false, any: true, isDirect: true });
  });

  it('no unknown or any - returns all false', () => {
    const result = containsUnknownOrAny(makeType({ flags: 0 }));

    expect(result).toEqual({ unknown: false, any: false, isDirect: false });
  });

  it('unknown in typeArguments - isDirect false', () => {
    const result = containsUnknownOrAny(
      makeType({
        isGeneric: true,
        typeArguments: [makeType({ flags: TYPE_FLAG_UNKNOWN })],
      }),
    );

    expect(result).toEqual({ unknown: true, any: false, isDirect: false });
  });

  it('any in typeArguments - isDirect false', () => {
    const result = containsUnknownOrAny(
      makeType({
        isGeneric: true,
        typeArguments: [makeType({ flags: 0 }), makeType({ flags: TYPE_FLAG_ANY })],
      }),
    );

    expect(result).toEqual({ unknown: false, any: true, isDirect: false });
  });

  it('unknown in union members - isDirect true (direct member)', () => {
    const result = containsUnknownOrAny(
      makeType({
        isUnion: true,
        members: [makeType({ flags: 0, text: 'string' }), makeType({ flags: TYPE_FLAG_UNKNOWN })],
      }),
    );

    expect(result).toEqual({ unknown: true, any: false, isDirect: true });
  });

  it('any in intersection members - isDirect true (direct member)', () => {
    const result = containsUnknownOrAny(
      makeType({
        isIntersection: true,
        members: [makeType({ flags: TYPE_FLAG_ANY })],
      }),
    );

    expect(result).toEqual({ unknown: false, any: true, isDirect: true });
  });

  it('unknown nested in member typeArguments - isDirect false', () => {
    const result = containsUnknownOrAny(
      makeType({
        isUnion: true,
        members: [
          makeType({
            isGeneric: true,
            typeArguments: [makeType({ flags: TYPE_FLAG_UNKNOWN })],
          }),
        ],
      }),
    );

    expect(result).toEqual({ unknown: true, any: false, isDirect: false });
  });

  it('flags has both any and unknown bits - both flags true', () => {
    const result = containsUnknownOrAny(makeType({ flags: TYPE_FLAG_ANY | TYPE_FLAG_UNKNOWN }));

    expect(result).toEqual({ unknown: true, any: true, isDirect: true });
  });

  it('union members with any first then unknown - both accumulated', () => {
    const result = containsUnknownOrAny(
      makeType({
        isUnion: true,
        members: [makeType({ flags: TYPE_FLAG_ANY }), makeType({ flags: TYPE_FLAG_UNKNOWN })],
      }),
    );

    expect(result).toEqual({ unknown: true, any: true, isDirect: true });
  });

  it('empty members array - returns all false', () => {
    const result = containsUnknownOrAny(makeType({ isUnion: true, members: [] }));

    expect(result).toEqual({ unknown: false, any: false, isDirect: false });
  });

  it('members with unknown + typeArguments with any - both accumulated', () => {
    const result = containsUnknownOrAny(
      makeType({
        isUnion: true,
        isGeneric: true,
        members: [makeType({ flags: TYPE_FLAG_UNKNOWN })],
        typeArguments: [makeType({ flags: TYPE_FLAG_ANY })],
      }),
    );

    expect(result).toEqual({ unknown: true, any: true, isDirect: true });
  });

  it('isGeneric true with undefined typeArguments - no crash', () => {
    const result = containsUnknownOrAny(makeType({ isGeneric: true }));

    expect(result).toEqual({ unknown: false, any: false, isDirect: false });
  });

  // NOTE: circular reference test removed — gildash 0.9.4+ guarantees ResolvedType is an acyclic tree
  // (bounded finite tree, no cycles), so visited Set protection is no longer needed.
});

describe('collectSafeContextRanges', () => {
  const getCtx = (code: string) => {
    const parsed = parseSource('/virtual/test.ts', code);

    return collectSafeContextRanges(parsed.program as Node);
  };

  const hasRangeContaining = (
    ranges: ReadonlyArray<{ readonly start: number; readonly end: number }>,
    code: string,
    substring: string,
  ): boolean => {
    const pos = code.indexOf(substring);

    if (pos === -1) {throw new Error(`Substring "${substring}" not found in code`);}

    return ranges.some(r => r.start <= pos && pos < r.end);
  };

  it('ThrowStatement - argument is safe', () => {
    const code = 'throw e;';
    const ctx = getCtx(code);

    expect(hasRangeContaining(ctx.ranges, code, 'e')).toBe(true);
  });

  it('CallExpression - arguments in callArgRanges (not unconditional ranges)', () => {
    const code = 'console.log(e);';
    const ctx = getCtx(code);

    expect(hasRangeContaining(ctx.ranges, code, 'e)')).toBe(false);
    expect(hasRangeContaining(ctx.callArgRanges, code, 'e)')).toBe(true);
  });

  it('NewExpression - arguments in callArgRanges', () => {
    const code = 'new Error(e);';
    const ctx = getCtx(code);

    expect(hasRangeContaining(ctx.callArgRanges, code, 'e)')).toBe(true);
  });

  it('CallExpression - callArgRanges include calleeEnd', () => {
    const code = 'foo(e);';
    const ctx = getCtx(code);

    expect(ctx.callArgRanges.length).toBeGreaterThan(0);
    expect(ctx.callArgRanges[0]!.calleeEnd).toBeGreaterThan(0);
  });

  it('CallExpression - nested member a.b.c(e) calleeEnd points to last property', () => {
    const code = 'a.b.c(e);';
    const ctx = getCtx(code);

    expect(ctx.callArgRanges.length).toBe(1);
    // callee is "a.b.c" [0..5], calleeEnd=5, calleeEnd-1 → 'c' at pos 4
    expect(ctx.callArgRanges[0]!.calleeEnd).toBe(5);
    expect(code[ctx.callArgRanges[0]!.calleeEnd - 1]).toBe('c');
  });

  it('CallExpression - computed property obj["key"](e) calleeEnd points to bracket', () => {
    const code = 'obj["key"](e);';
    const ctx = getCtx(code);

    expect(ctx.callArgRanges.length).toBe(1);
    // callee is 'obj["key"]' [0..10], calleeEnd-1 → ']'
    expect(code[ctx.callArgRanges[0]!.calleeEnd - 1]).toBe(']');
  });

  it('CallExpression - optional chaining a?.b(e) captures args', () => {
    const code = 'a?.b(e);';
    const ctx = getCtx(code);

    expect(ctx.callArgRanges.length).toBe(1);
    expect(hasRangeContaining(ctx.callArgRanges, code, 'e)')).toBe(true);
    // callee is "a?.b" [0..4], calleeEnd-1 → 'b'
    expect(code[ctx.callArgRanges[0]!.calleeEnd - 1]).toBe('b');
  });

  it('CallExpression - chained call a()(e) calleeEnd points to paren', () => {
    const code = 'a()(e);';
    const ctx = getCtx(code);
    // Two CallExpressions: a() and a()(e)
    // The outer call a()(e) has callee "a()" — calleeEnd-1 → ')'
    const outerArg = ctx.callArgRanges.find(r => code.substring(r.start, r.end) === 'e');

    expect(outerArg).toBeDefined();
    expect(code[outerArg!.calleeEnd - 1]).toBe(')');
  });

  it('NewExpression - new a.B(e) calleeEnd points to constructor name', () => {
    const code = 'new a.B(e);';
    const ctx = getCtx(code);

    expect(ctx.callArgRanges.length).toBe(1);
    expect(code[ctx.callArgRanges[0]!.calleeEnd - 1]).toBe('B');
  });

  it('TSAsExpression - expression is safe (non-any/unknown target)', () => {
    const code = 'const x = e as Error;';
    const ctx = getCtx(code);

    expect(hasRangeContaining(ctx.ranges, code, 'e as')).toBe(true);
  });

  it('TSAsExpression - as any is NOT safe', () => {
    const code = 'const x = e as any;';
    const ctx = getCtx(code);

    expect(hasRangeContaining(ctx.ranges, code, 'e as')).toBe(false);
  });

  it('TSAsExpression - as unknown is NOT safe', () => {
    const code = 'const x = e as unknown;';
    const ctx = getCtx(code);

    expect(hasRangeContaining(ctx.ranges, code, 'e as')).toBe(false);
  });

  it('BinaryExpression instanceof - both sides safe', () => {
    const code = 'e instanceof Error;';
    const ctx = getCtx(code);

    expect(hasRangeContaining(ctx.ranges, code, 'e ')).toBe(true);
  });

  it('BinaryExpression === - both sides safe', () => {
    const code = 'e === null;';
    const ctx = getCtx(code);

    expect(hasRangeContaining(ctx.ranges, code, 'e ')).toBe(true);
  });

  it('UnaryExpression typeof - argument is safe', () => {
    const code = 'typeof myVar;';
    const ctx = getCtx(code);

    expect(hasRangeContaining(ctx.ranges, code, 'myVar')).toBe(true);
  });

  it('UnaryExpression ! - argument is safe', () => {
    const code = '!e;';
    const ctx = getCtx(code);

    expect(hasRangeContaining(ctx.ranges, code, 'e')).toBe(true);
  });

  it('TemplateLiteral - expression is safe', () => {
    const code = '`${e}`;';
    const ctx = getCtx(code);

    expect(hasRangeContaining(ctx.ranges, code, 'e}')).toBe(true);
  });

  it('ReturnStatement with explicit return type - safe', () => {
    const code = 'function f(): string { return e; }';
    const ctx = getCtx(code);

    expect(hasRangeContaining(ctx.ranges, code, 'e;')).toBe(true);
  });

  it('ReturnStatement without explicit return type - NOT safe', () => {
    const code = 'function f() { return e; }';
    const ctx = getCtx(code);

    expect(hasRangeContaining(ctx.ranges, code, 'e;')).toBe(false);
  });

  it('ReturnStatement in arrow with explicit return type - safe', () => {
    const code = 'const f = (): string => { return e; };';
    const ctx = getCtx(code);

    expect(hasRangeContaining(ctx.ranges, code, 'e;')).toBe(true);
  });

  it('ReturnStatement in class method with return type - safe', () => {
    const code = 'class A { foo(): string { return e; } }';
    const ctx = getCtx(code);

    expect(hasRangeContaining(ctx.ranges, code, 'e;')).toBe(true);
  });

  it('ReturnStatement in class method without return type - NOT safe', () => {
    const code = 'class A { foo() { return e; } }';
    const ctx = getCtx(code);

    expect(hasRangeContaining(ctx.ranges, code, 'e;')).toBe(false);
  });

  it('ReturnStatement in getter with return type - safe', () => {
    const code = 'class A { get x(): string { return e; } }';
    const ctx = getCtx(code);

    expect(hasRangeContaining(ctx.ranges, code, 'e;')).toBe(true);
  });

  it('ReturnStatement in async function with return type - safe', () => {
    const code = 'async function f(): Promise<string> { return e; }';
    const ctx = getCtx(code);

    expect(hasRangeContaining(ctx.ranges, code, 'e;')).toBe(true);
  });

  it('ReturnStatement in generator without return type - NOT safe', () => {
    const code = 'function* g() { return e; }';
    const ctx = getCtx(code);

    expect(hasRangeContaining(ctx.ranges, code, 'e;')).toBe(false);
  });

  it('ReturnStatement nested - inner untyped, outer typed - NOT safe (innermost wins)', () => {
    const code = 'function outer(): string { function inner() { return e; } return ""; }';
    const ctx = getCtx(code);

    // 'return e' is inside inner() which has no return type → NOT safe
    expect(hasRangeContaining(ctx.ranges, code, 'e;')).toBe(false);
  });

  it('ReturnStatement nested - inner typed, outer untyped - safe (innermost wins)', () => {
    const code = 'function outer() { function inner(): string { return e; } return ""; }';
    const ctx = getCtx(code);

    // 'return e' is inside inner() which has return type → safe
    expect(hasRangeContaining(ctx.ranges, code, 'e;')).toBe(true);
  });

  it('SpreadElement - argument is safe', () => {
    const code = 'const arr = [...e];';
    const ctx = getCtx(code);

    expect(hasRangeContaining(ctx.ranges, code, 'e]')).toBe(true);
  });

  it('LogicalExpression ?? - both operands safe', () => {
    const code = 'e ?? fallback;';
    const ctx = getCtx(code);

    expect(hasRangeContaining(ctx.ranges, code, 'e ')).toBe(true);
    expect(hasRangeContaining(ctx.ranges, code, 'fallback')).toBe(true);
  });

  it('LogicalExpression || - both operands safe', () => {
    const code = 'a || e;';
    const ctx = getCtx(code);

    expect(hasRangeContaining(ctx.ranges, code, 'e;')).toBe(true);
  });

  it('ConditionalExpression - test is safe', () => {
    const code = 'e ? a : b;';
    const ctx = getCtx(code);

    expect(hasRangeContaining(ctx.ranges, code, 'e ')).toBe(true);
  });

  it('MemberExpression - NOT safe', () => {
    const code = 'e.prop;';
    const ctx = getCtx(code);

    expect(hasRangeContaining(ctx.ranges, code, 'e.')).toBe(false);
  });

  it('AssignmentExpression value - NOT safe', () => {
    const code = 'x = e;';
    const ctx = getCtx(code);

    expect(hasRangeContaining(ctx.ranges, code, 'e;')).toBe(false);
  });

  it('BinaryExpression < - NOT safe (not in allowed operator list)', () => {
    const code = 'e < 10;';
    const ctx = getCtx(code);

    expect(hasRangeContaining(ctx.ranges, code, 'e ')).toBe(false);
  });

  it('BinaryExpression !== - safe', () => {
    const code = 'e !== undefined;';
    const ctx = getCtx(code);

    expect(hasRangeContaining(ctx.ranges, code, 'e ')).toBe(true);
  });

  it('BinaryExpression in - safe', () => {
    const code = '"key" in e;';
    const ctx = getCtx(code);

    expect(hasRangeContaining(ctx.ranges, code, 'e;')).toBe(true);
  });

  it('LogicalExpression && - both operands safe', () => {
    const code = 'a && e;';
    const ctx = getCtx(code);

    expect(hasRangeContaining(ctx.ranges, code, 'e;')).toBe(true);
  });

  it('UnaryExpression void - NOT safe', () => {
    const code = 'void e;';
    const ctx = getCtx(code);

    expect(hasRangeContaining(ctx.ranges, code, 'e;')).toBe(false);
  });

  it('ConditionalExpression consequent - NOT safe', () => {
    const code = 'x ? e : b;';
    const ctx = getCtx(code);

    // 'e' at position 4 is the consequent, not the test
    expect(hasRangeContaining(ctx.ranges, code, 'e :')).toBe(false);
  });

  it('ConditionalExpression alternate - NOT safe', () => {
    const code = 'x ? a : e;';
    const ctx = getCtx(code);

    expect(hasRangeContaining(ctx.ranges, code, 'e;')).toBe(false);
  });

  it('TemplateLiteral multiple expressions - all safe', () => {
    const code = '`${a}${e}`;';
    const ctx = getCtx(code);

    expect(hasRangeContaining(ctx.ranges, code, 'e}')).toBe(true);
  });

  it('ReturnStatement bare return - no crash', () => {
    const code = 'function f(): void { return; }';

    expect(() => getCtx(code)).not.toThrow();
  });

  it('CallExpression no arguments - no crash', () => {
    const code = 'foo();';

    expect(() => getCtx(code)).not.toThrow();
    expect(getCtx(code).callArgRanges.length).toBe(0);
  });

  it('CallExpression generic foo<T>(e) - calleeEnd points to function name not type param', () => {
    const code = 'foo<T>(e);';
    const ctx = getCtx(code);

    expect(ctx.callArgRanges.length).toBe(1);
    // oxc puts type arguments on CallExpression, callee is just 'foo'
    expect(code[ctx.callArgRanges[0]!.calleeEnd - 1]).toBe('o');
  });

  it('SpreadElement in call args fn(...e) - argument is safe', () => {
    const code = 'fn(...e);';
    const ctx = getCtx(code);

    // SpreadElement's argument 'e' is in unconditional safe ranges
    expect(hasRangeContaining(ctx.ranges, code, 'e)')).toBe(true);
  });
});

describe('isSafelyUsed', () => {
  type TypeMapEntry = { flags: number } | ResolvedType;

  const isResolvedType = (entry: TypeMapEntry): entry is ResolvedType => 'text' in entry;

  const makeSemantic = (typeMap: Record<number, TypeMapEntry> = {}) => ({
    collectTypeAt: (_filePath: string, position: number) => {
      const entry = typeMap[position];

      if (!entry) {return null;}

      return isResolvedType(entry) ? entry : makeType({ flags: entry.flags });
    },
    findReferences: () => [],
  });

  const makeRef = (
    position: number,
    isDefinition: boolean,
  ): { filePath: string; position: number; line: number; column: number; isDefinition: boolean; isWrite: boolean } => ({
    filePath: '/test.ts',
    position,
    line: 1,
    column: position,
    isDefinition,
    isWrite: false,
  });

  const emptySafeCtx = {
    ranges: [] as Array<{ start: number; end: number }>,
    callArgRanges: [] as Array<{ start: number; end: number; calleeEnd: number }>,
  };

  it('underscore prefix - always safe', () => {
    const result = isSafelyUsed(
      makeSemantic(),
      '/test.ts',
      [makeRef(0, true), makeRef(10, false)],
      '_err',
      { unknown: true, any: false, isDirect: true },
      emptySafeCtx,
      new Map(),
    );

    expect(result).toBe(true);
  });

  it('no usages (only definition) - safe', () => {
    const result = isSafelyUsed(
      makeSemantic(),
      '/test.ts',
      [makeRef(0, true)],
      'err',
      { unknown: true, any: false, isDirect: true },
      emptySafeCtx,
      new Map(),
    );

    expect(result).toBe(true);
  });

  it('all usages narrowed - safe', () => {
    const result = isSafelyUsed(
      makeSemantic({ 10: { flags: 0 }, 20: { flags: 0 } }),
      '/test.ts',
      [makeRef(0, true), makeRef(10, false), makeRef(20, false)],
      'err',
      { unknown: true, any: false, isDirect: true },
      emptySafeCtx,
      new Map(),
    );

    expect(result).toBe(true);
  });

  it('one usage narrowed, another NOT in safe context - unsafe (ALL semantics)', () => {
    const result = isSafelyUsed(
      makeSemantic({ 10: { flags: 0 }, 20: { flags: TYPE_FLAG_UNKNOWN } }),
      '/test.ts',
      [makeRef(0, true), makeRef(10, false), makeRef(20, false)],
      'err',
      { unknown: true, any: false, isDirect: true },
      emptySafeCtx,
      new Map(),
    );

    expect(result).toBe(false);
  });

  it('all usages in unconditional safe ranges - safe', () => {
    const safeCtx = {
      ranges: [
        { start: 8, end: 15 },
        { start: 18, end: 25 },
      ],
      callArgRanges: [] as Array<{ start: number; end: number; calleeEnd: number }>,
    };
    const result = isSafelyUsed(
      makeSemantic(),
      '/test.ts',
      [makeRef(0, true), makeRef(10, false), makeRef(20, false)],
      'err',
      { unknown: true, any: false, isDirect: true },
      safeCtx,
      new Map(),
    );

    expect(result).toBe(true);
  });

  it('one usage in safe context, another NOT - unsafe', () => {
    const safeCtx = {
      ranges: [{ start: 8, end: 15 }],
      callArgRanges: [] as Array<{ start: number; end: number; calleeEnd: number }>,
    };
    const result = isSafelyUsed(
      makeSemantic(),
      '/test.ts',
      [makeRef(0, true), makeRef(10, false), makeRef(20, false)],
      'err',
      { unknown: true, any: false, isDirect: true },
      safeCtx,
      new Map(),
    );

    expect(result).toBe(false);
  });

  it('usage in call arg with typed callee - safe', () => {
    const safeCtx = { ranges: [] as Array<{ start: number; end: number }>, callArgRanges: [{ start: 8, end: 15, calleeEnd: 5 }] };
    const result = isSafelyUsed(
      makeSemantic({ 4: { flags: 0 } }),
      '/test.ts',
      [makeRef(0, true), makeRef(10, false)],
      'err',
      { unknown: true, any: false, isDirect: true },
      safeCtx,
      new Map(),
    );

    expect(result).toBe(true);
  });

  it('usage in call arg with any callee - unsafe (propagation)', () => {
    const safeCtx = { ranges: [] as Array<{ start: number; end: number }>, callArgRanges: [{ start: 8, end: 15, calleeEnd: 5 }] };
    const result = isSafelyUsed(
      makeSemantic({ 4: { flags: TYPE_FLAG_ANY } }),
      '/test.ts',
      [makeRef(0, true), makeRef(10, false)],
      'err',
      { unknown: true, any: false, isDirect: true },
      safeCtx,
      new Map(),
    );

    expect(result).toBe(false);
  });

  it('fileTypes map used for batch lookup', () => {
    const fileTypes = new Map<number, ReturnType<typeof makeType>>();

    fileTypes.set(10, makeType({ flags: 0 }));

    const result = isSafelyUsed(
      makeSemantic(),
      '/test.ts',
      [makeRef(0, true), makeRef(10, false)],
      'err',
      { unknown: true, any: false, isDirect: true },
      emptySafeCtx,
      fileTypes,
    );

    expect(result).toBe(true);
  });

  it('any declared, narrowed to non-any at usage - safe', () => {
    const result = isSafelyUsed(
      makeSemantic({ 10: { flags: 0 } }),
      '/test.ts',
      [makeRef(0, true), makeRef(10, false)],
      'x',
      { unknown: false, any: true, isDirect: true },
      emptySafeCtx,
      new Map(),
    );

    expect(result).toBe(true);
  });

  it('any declared, still any at usage - unsafe', () => {
    const result = isSafelyUsed(
      makeSemantic({ 10: { flags: TYPE_FLAG_ANY } }),
      '/test.ts',
      [makeRef(0, true), makeRef(10, false)],
      'x',
      { unknown: false, any: true, isDirect: true },
      emptySafeCtx,
      new Map(),
    );

    expect(result).toBe(false);
  });

  it('single underscore _ - always safe', () => {
    const result = isSafelyUsed(
      makeSemantic(),
      '/test.ts',
      [makeRef(0, true), makeRef(10, false)],
      '_',
      { unknown: true, any: false, isDirect: true },
      emptySafeCtx,
      new Map(),
    );

    expect(result).toBe(true);
  });

  it('cross-file refs only - filtered out, safe', () => {
    const result = isSafelyUsed(
      makeSemantic(),
      '/file-a.ts',
      [
        { filePath: '/file-a.ts', position: 0, line: 1, column: 0, isDefinition: true, isWrite: false },
        { filePath: '/file-b.ts', position: 10, line: 1, column: 10, isDefinition: false, isWrite: false },
      ],
      'err',
      { unknown: true, any: false, isDirect: true },
      emptySafeCtx,
      new Map(),
    );

    expect(result).toBe(true);
  });

  it('empty refs array - safe', () => {
    const result = isSafelyUsed(
      makeSemantic(),
      '/test.ts',
      [],
      'err',
      { unknown: true, any: false, isDirect: true },
      emptySafeCtx,
      new Map(),
    );

    expect(result).toBe(true);
  });

  it('usage in call arg with unknown callee - unsafe (propagation)', () => {
    const safeCtx = { ranges: [] as Array<{ start: number; end: number }>, callArgRanges: [{ start: 8, end: 15, calleeEnd: 5 }] };
    const result = isSafelyUsed(
      makeSemantic({ 4: { flags: TYPE_FLAG_UNKNOWN } }),
      '/test.ts',
      [makeRef(0, true), makeRef(10, false)],
      'err',
      { unknown: true, any: false, isDirect: true },
      safeCtx,
      new Map(),
    );

    expect(result).toBe(false);
  });

  it('usage in call arg with calleeEnd=0 - unsafe (no callee info)', () => {
    const safeCtx = { ranges: [] as Array<{ start: number; end: number }>, callArgRanges: [{ start: 8, end: 15, calleeEnd: 0 }] };
    const result = isSafelyUsed(
      makeSemantic(),
      '/test.ts',
      [makeRef(0, true), makeRef(10, false)],
      'err',
      { unknown: true, any: false, isDirect: true },
      safeCtx,
      new Map(),
    );

    expect(result).toBe(false);
  });

  it('usage in call arg with callee type null (gildash miss) - safe (benefit of doubt)', () => {
    const safeCtx = { ranges: [] as Array<{ start: number; end: number }>, callArgRanges: [{ start: 8, end: 15, calleeEnd: 5 }] };
    // No type at position 4 → collectTypeAt returns null
    const result = isSafelyUsed(
      makeSemantic(),
      '/test.ts',
      [makeRef(0, true), makeRef(10, false)],
      'err',
      { unknown: true, any: false, isDirect: true },
      safeCtx,
      new Map(),
    );

    expect(result).toBe(true);
  });

  it('usage in call arg with isDirect=true any callee - unsafe', () => {
    const safeCtx = { ranges: [] as Array<{ start: number; end: number }>, callArgRanges: [{ start: 8, end: 15, calleeEnd: 5 }] };
    // Callee type has direct any flag → isDirect=true → propagation, not safe
    const result = isSafelyUsed(
      makeSemantic({ 4: { flags: TYPE_FLAG_ANY } }),
      '/test.ts',
      [makeRef(0, true), makeRef(10, false)],
      'err',
      { unknown: true, any: false, isDirect: true },
      safeCtx,
      new Map(),
    );

    expect(result).toBe(false);
  });

  it('usage in call arg with isDirect=false any callee (e.g. Array<any>) - safe', () => {
    const safeCtx = { ranges: [] as Array<{ start: number; end: number }>, callArgRanges: [{ start: 8, end: 15, calleeEnd: 5 }] };
    // Callee type: generic container with any in typeArguments → isDirect=false → safe
    const calleeType = makeType({
      isGeneric: true,
      typeArguments: [makeType({ flags: TYPE_FLAG_ANY })],
    });
    const result = isSafelyUsed(
      makeSemantic({ 4: calleeType }),
      '/test.ts',
      [makeRef(0, true), makeRef(10, false)],
      'err',
      { unknown: true, any: false, isDirect: true },
      safeCtx,
      new Map(),
    );

    // isDirect=false callee → typed function with container type → safe
    expect(result).toBe(true);
  });

  it('collectTypeAt null for usage - falls through to safe context check', () => {
    const safeCtx = {
      ranges: [{ start: 8, end: 15 }],
      callArgRanges: [] as Array<{ start: number; end: number; calleeEnd: number }>,
    };
    // No type info for usage at position 10, but position is in safe range
    const result = isSafelyUsed(
      makeSemantic(),
      '/test.ts',
      [makeRef(0, true), makeRef(10, false)],
      'err',
      { unknown: true, any: false, isDirect: true },
      safeCtx,
      new Map(),
    );

    expect(result).toBe(true);
  });

  it('dual declared flags - only unknown narrowed at usage - unsafe', () => {
    // declaredFlag: both unknown and any
    // usage: unknown resolved but any remains → not fully safe
    const result = isSafelyUsed(
      makeSemantic({ 10: { flags: TYPE_FLAG_ANY } }), // usage still has any
      '/test.ts',
      [makeRef(0, true), makeRef(10, false)],
      'val',
      { unknown: true, any: true, isDirect: true },
      emptySafeCtx,
      new Map(),
    );

    expect(result).toBe(false);
  });

  it('dual declared flags - both narrowed at usage - safe', () => {
    // declaredFlag: both unknown and any
    // usage: both resolved → fully safe
    const result = isSafelyUsed(
      makeSemantic({ 10: { flags: 0 } }), // no unknown, no any at usage
      '/test.ts',
      [makeRef(0, true), makeRef(10, false)],
      'val',
      { unknown: true, any: true, isDirect: true },
      emptySafeCtx,
      new Map(),
    );

    expect(result).toBe(true);
  });

  it('dual declared flags - only any narrowed at usage - unsafe', () => {
    // declaredFlag: both unknown and any
    // usage: any resolved but unknown remains → not fully safe
    const result = isSafelyUsed(
      makeSemantic({ 10: { flags: TYPE_FLAG_UNKNOWN } }), // usage still has unknown
      '/test.ts',
      [makeRef(0, true), makeRef(10, false)],
      'val',
      { unknown: true, any: true, isDirect: true },
      emptySafeCtx,
      new Map(),
    );

    expect(result).toBe(false);
  });
});
