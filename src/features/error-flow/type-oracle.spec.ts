import type { Gildash, ResolvedType } from '@zipbul/gildash';
import type { Node } from 'oxc-parser';

import { describe, expect, it } from 'bun:test';

import { parseSource } from '../../engine/ast/parse-source';
import { createTypeOracle, isVoidReturn, isWhollyPrimitive } from './type-oracle';

// ts.TypeFlags bits used to build fixtures.
const ANY = 1;
const UNKNOWN = 2;
const STRING = 1 << 2;
const NUMBER = 1 << 3;
const STRING_LITERAL = 1 << 7;
const OBJECT = 1 << 19;
const VOID = 1 << 14;

const leaf = (flags: number, text = 'T'): ResolvedType => ({
  text,
  flags,
  isUnion: false,
  isIntersection: false,
  isGeneric: false,
});

const union = (members: ResolvedType[]): ResolvedType => ({
  text: members.map(m => m.text).join(' | '),
  flags: 1 << 20,
  isUnion: true,
  isIntersection: false,
  isGeneric: false,
  members,
});

describe('isWhollyPrimitive', () => {
  it('is true for a string type', () => {
    expect(isWhollyPrimitive(leaf(STRING, 'string'))).toBe(true);
  });

  it('is true for a string-literal type', () => {
    expect(isWhollyPrimitive(leaf(STRING_LITERAL, '"a"'))).toBe(true);
  });

  it('is true for a number type', () => {
    expect(isWhollyPrimitive(leaf(NUMBER, 'number'))).toBe(true);
  });

  it('is false for any', () => {
    expect(isWhollyPrimitive(leaf(ANY, 'any'))).toBe(false);
  });

  it('is false for unknown', () => {
    expect(isWhollyPrimitive(leaf(UNKNOWN, 'unknown'))).toBe(false);
  });

  it('is false for an object type', () => {
    expect(isWhollyPrimitive(leaf(OBJECT, 'Error'))).toBe(false);
  });

  it('is true for a union of only primitives', () => {
    expect(isWhollyPrimitive(union([leaf(STRING_LITERAL, '"a"'), leaf(STRING_LITERAL, '"b"')]))).toBe(true);
  });

  it('is false for a union mixing a primitive and an object', () => {
    expect(isWhollyPrimitive(union([leaf(STRING, 'string'), leaf(OBJECT, 'Error')]))).toBe(false);
  });

  it('is false for a union containing any', () => {
    expect(isWhollyPrimitive(union([leaf(STRING, 'string'), leaf(ANY, 'any')]))).toBe(false);
  });

  it('is false for an empty union (no provable members)', () => {
    expect(isWhollyPrimitive({ ...union([]), members: [] })).toBe(false);
  });
});

describe('isVoidReturn', () => {
  it('is true for void', () => {
    expect(isVoidReturn(leaf(VOID, 'void'))).toBe(true);
  });

  it('is true for undefined', () => {
    expect(isVoidReturn(leaf(1 << 15, 'undefined'))).toBe(true);
  });

  it('is false for number', () => {
    expect(isVoidReturn(leaf(NUMBER, 'number'))).toBe(false);
  });

  it('is false for any', () => {
    expect(isVoidReturn(leaf(ANY, 'any'))).toBe(false);
  });

  it('is false for unknown', () => {
    expect(isVoidReturn(leaf(UNKNOWN, 'unknown'))).toBe(false);
  });

  it('is false for a Promise (object) return', () => {
    expect(isVoidReturn(leaf(OBJECT, 'Promise<void>'))).toBe(false);
  });
});

// ── createTypeOracle: the gildash-facing seam. Matrix per method: null gildash (negative),
// value mapping (happy/negative), throw (exception), and the exact query it issues (side-effect). ──

const FILE = '/virtual/sample.ts';
const NODE: Node = parseSource(FILE, 'doThing();').program;
const SPAN = { start: NODE.start, end: NODE.end };

const throws = () => {
  throw new Error('semantic layer offline');
};

// A partial gildash test double — only the queried method matters per test (mirrors the noopGildash
// pattern used across the integration suites).
const oracleWith = (methods: Partial<Gildash>) => createTypeOracle(methods as unknown as Gildash, FILE);

describe('createTypeOracle — null gildash answers false for every query (degraded scan)', () => {
  const oracle = createTypeOracle(null, FILE);

  it('isThenable', () => expect(oracle.isThenable(NODE)).toBe(false));

  it('isPrimitiveValue', () => expect(oracle.isPrimitiveValue(NODE)).toBe(false));

  it('expectsVoidReturningCallback', () => expect(oracle.expectsVoidReturningCallback(NODE)).toBe(false));

  it('isErrorSubtype', () => expect(oracle.isErrorSubtype(NODE)).toBe(false));
});

describe('createTypeOracle — isThenable', () => {
  it('true when isThenableAtSpan returns true', () => {
    expect(oracleWith({ isThenableAtSpan: () => true }).isThenable(NODE)).toBe(true);
  });

  it('false when isThenableAtSpan returns false', () => {
    expect(oracleWith({ isThenableAtSpan: () => false }).isThenable(NODE)).toBe(false);
  });

  it('false when isThenableAtSpan returns null (unresolved)', () => {
    expect(oracleWith({ isThenableAtSpan: () => null }).isThenable(NODE)).toBe(false);
  });

  it('false when isThenableAtSpan throws (exception swallowed)', () => {
    expect(oracleWith({ isThenableAtSpan: throws }).isThenable(NODE)).toBe(false);
  });

  it('queries the node span with anyConstituent (side-effect)', () => {
    const calls: unknown[] = [];

    oracleWith({
      isThenableAtSpan: (f, span, options) => {
        calls.push({ f, span, options });

        return true;
      },
    }).isThenable(NODE);

    expect(calls).toEqual([{ f: FILE, span: SPAN, options: { anyConstituent: true } }]);
  });
});

describe('createTypeOracle — isPrimitiveValue', () => {
  const primitive: ResolvedType = leaf(STRING, 'string');
  const object: ResolvedType = leaf(OBJECT, 'Error');

  it('true when the expression type is wholly primitive', () => {
    expect(oracleWith({ getExpressionTypeAtSpan: () => primitive }).isPrimitiveValue(NODE)).toBe(true);
  });

  it('false when the expression type is an object', () => {
    expect(oracleWith({ getExpressionTypeAtSpan: () => object }).isPrimitiveValue(NODE)).toBe(false);
  });

  it('false when the type is unresolved (null)', () => {
    expect(oracleWith({ getExpressionTypeAtSpan: () => null }).isPrimitiveValue(NODE)).toBe(false);
  });

  it('false when getExpressionTypeAtSpan throws (exception swallowed)', () => {
    expect(oracleWith({ getExpressionTypeAtSpan: throws }).isPrimitiveValue(NODE)).toBe(false);
  });
});

describe('createTypeOracle — expectsVoidReturningCallback', () => {
  it('true when every contextual call signature returns void', () => {
    expect(oracleWith({ getContextualCallReturnsAtSpan: () => [leaf(VOID, 'void')] }).expectsVoidReturningCallback(NODE)).toBe(
      true,
    );
  });

  it('false when a signature returns a non-void value', () => {
    expect(
      oracleWith({ getContextualCallReturnsAtSpan: () => [leaf(NUMBER, 'number')] }).expectsVoidReturningCallback(NODE),
    ).toBe(false);
  });

  it('false when the slot is not callable (empty array)', () => {
    expect(oracleWith({ getContextualCallReturnsAtSpan: () => [] }).expectsVoidReturningCallback(NODE)).toBe(false);
  });

  it('false when there is no contextual type (null)', () => {
    expect(oracleWith({ getContextualCallReturnsAtSpan: () => null }).expectsVoidReturningCallback(NODE)).toBe(false);
  });

  it('false when getContextualCallReturnsAtSpan throws (exception swallowed)', () => {
    expect(oracleWith({ getContextualCallReturnsAtSpan: throws }).expectsVoidReturningCallback(NODE)).toBe(false);
  });
});

describe('createTypeOracle — isErrorSubtype', () => {
  it('true when the type is assignable to Error', () => {
    expect(oracleWith({ isTypeAssignableToTypeAtSpan: () => true }).isErrorSubtype(NODE)).toBe(true);
  });

  it('false when the type is not assignable to Error', () => {
    expect(oracleWith({ isTypeAssignableToTypeAtSpan: () => false }).isErrorSubtype(NODE)).toBe(false);
  });

  it('false when assignability is unresolved (null)', () => {
    expect(oracleWith({ isTypeAssignableToTypeAtSpan: () => null }).isErrorSubtype(NODE)).toBe(false);
  });

  it('false when isTypeAssignableToTypeAtSpan throws (exception swallowed)', () => {
    expect(oracleWith({ isTypeAssignableToTypeAtSpan: throws }).isErrorSubtype(NODE)).toBe(false);
  });

  it('queries the node span against the Error type with anyConstituent (side-effect)', () => {
    const calls: unknown[] = [];

    oracleWith({
      isTypeAssignableToTypeAtSpan: (f, span, target, options) => {
        calls.push({ f, span, target, options });

        return true;
      },
    }).isErrorSubtype(NODE);

    expect(calls).toEqual([{ f: FILE, span: SPAN, target: 'Error', options: { anyConstituent: true } }]);
  });
});

describe('createTypeOracle — isProvenArray (only true when gildash PROVES Array identity)', () => {
  // `any`/`unknown` are assignable to EVERYTHING, so bare assignability cannot prove array
  // identity — the receiver's resolved type must first exclude any/unknown (mirror of the
  // thenable probe's built-in any-guard). Otherwise an any-typed fluent receiver (query
  // builders, untyped libs) would "prove" array and fire a false W.

  it('true when assignable AND the resolved type is a concrete object type', () => {
    const oracle = oracleWith({
      isTypeAssignableToTypeAtSpan: () => true,
      getExpressionTypeAtSpan: () => leaf(OBJECT, 'number[]'),
    });

    expect(oracle.isProvenArray(NODE)).toBe(true);
  });

  it('false when assignable but the resolved type is `any` (assignability proves nothing)', () => {
    const oracle = oracleWith({
      isTypeAssignableToTypeAtSpan: () => true,
      getExpressionTypeAtSpan: () => leaf(ANY, 'any'),
    });

    expect(oracle.isProvenArray(NODE)).toBe(false);
  });

  it('false when assignable but the resolved type is `unknown`', () => {
    const oracle = oracleWith({
      isTypeAssignableToTypeAtSpan: () => true,
      getExpressionTypeAtSpan: () => leaf(UNKNOWN, 'unknown'),
    });

    expect(oracle.isProvenArray(NODE)).toBe(false);
  });

  it('false when assignable but the receiver type cannot be resolved (null)', () => {
    const oracle = oracleWith({
      isTypeAssignableToTypeAtSpan: () => true,
      getExpressionTypeAtSpan: () => null,
    });

    expect(oracle.isProvenArray(NODE)).toBe(false);
  });

  it('false when not assignable to ReadonlyArray', () => {
    const oracle = oracleWith({
      isTypeAssignableToTypeAtSpan: () => false,
      getExpressionTypeAtSpan: () => leaf(OBJECT, 'Set<number>'),
    });

    expect(oracle.isProvenArray(NODE)).toBe(false);
  });

  it('false when gildash is absent', () => {
    expect(createTypeOracle(null, FILE).isProvenArray(NODE)).toBe(false);
  });

  it('false when the query throws', () => {
    expect(oracleWith({ isTypeAssignableToTypeAtSpan: throws, getExpressionTypeAtSpan: () => leaf(OBJECT) }).isProvenArray(NODE)).toBe(false);
  });
});
