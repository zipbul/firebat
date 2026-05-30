import type { ResolvedType } from '@zipbul/gildash';

import { describe, expect, it } from 'bun:test';

import { isVoidReturn, isWhollyPrimitive } from './type-oracle';

// ts.TypeFlags bits used to build fixtures.
const ANY = 1;
const UNKNOWN = 2;
const STRING = 1 << 2;
const NUMBER = 1 << 3;
const STRING_LITERAL = 1 << 7;
const OBJECT = 1 << 19;
const VOID = 1 << 14;
const UNDEFINED = 1 << 15;

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
    expect(isVoidReturn(leaf(UNDEFINED, 'undefined'))).toBe(true);
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
