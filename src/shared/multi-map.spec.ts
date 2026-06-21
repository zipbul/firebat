import { describe, expect, mock, test } from 'bun:test';

import { keepMapBound } from './multi-map';

describe('multi-map', () => {
  describe('keepMapBound', () => {
    // EP: key absent → always inserts (isBetter not consulted)
    test('inserts the value when the key is absent', () => {
      const map = new Map<string, number>();

      keepMapBound(map, 'a', 5, (next, prev) => next < prev);

      expect(map.get('a')).toBe(5);
    });

    test('does not consult isBetter when the key is absent', () => {
      const map = new Map<string, number>();
      const isBetter = mock((next: number, prev: number) => next < prev);

      keepMapBound(map, 'a', 5, isBetter);

      expect(isBetter).not.toHaveBeenCalled();
    });

    // EP: key present, value is better → replaces
    test('replaces the current value when the new value is better (min)', () => {
      const map = new Map<string, number>([['a', 10]]);

      keepMapBound(map, 'a', 3, (next, prev) => next < prev);

      expect(map.get('a')).toBe(3);
    });

    test('replaces the current value when the new value is better (max)', () => {
      const map = new Map<string, number>([['a', 10]]);

      keepMapBound(map, 'a', 42, (next, prev) => next > prev);

      expect(map.get('a')).toBe(42);
    });

    // EP: key present, value not better → keeps
    test('keeps the current value when the new value is not better', () => {
      const map = new Map<string, number>([['a', 3]]);

      keepMapBound(map, 'a', 10, (next, prev) => next < prev);

      expect(map.get('a')).toBe(3);
    });

    // BVA: equal value — isBetter returns false for `<` / `>` → keeps existing
    test('keeps the existing value when the new value equals it (strict comparator)', () => {
      const map = new Map<string, number>([['a', 7]]);

      keepMapBound(map, 'a', 7, (next, prev) => next < prev);

      expect(map.get('a')).toBe(7);
    });

    // 0 is a valid present value (not conflated with "absent")
    test('treats a present value of 0 as existing, not absent', () => {
      const map = new Map<string, number>([['a', 0]]);

      keepMapBound(map, 'a', 5, (next, prev) => next < prev);

      expect(map.get('a')).toBe(0);
    });
  });
});
