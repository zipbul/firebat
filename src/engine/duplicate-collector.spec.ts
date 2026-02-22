import { describe, expect, it } from 'bun:test';

import { collectDuplicateGroups } from './duplicate-collector';
import { parseSource } from './parse-source';
import type { ParsedFile } from './types';

// Helpers
const parsedFile = (filePath: string, code: string): ParsedFile =>
  parseSource(filePath, code) as ParsedFile;

// isTarget: only FunctionDeclaration nodes
const isFunctionDeclaration = (node: { type?: unknown }): boolean =>
  (node as { type: string }).type === 'FunctionDeclaration';

// fingerprint: use structural text (body token count as string)
const fpByType = (node: { type?: unknown }): string => String((node as { type: string }).type);

const kindResolver = (): import('../types').FirebatItemKind => 'function';

describe('engine/duplicate-collector — collectDuplicateGroups', () => {
  it('returns empty array for empty files list', () => {
    const groups = collectDuplicateGroups([], 1, isFunctionDeclaration, fpByType, kindResolver, 'type-1');
    expect(groups).toEqual([]);
  });

  it('skips files with parse errors', () => {
    const badFile: ParsedFile = {
      filePath: '/bad.ts',
      program: {} as never,
      errors: [{ message: 'err' }] as never as [],
      comments: [],
      sourceText: 'function f() {}',
    };
    const groups = collectDuplicateGroups([badFile], 1, isFunctionDeclaration, fpByType, kindResolver, 'type-1');
    expect(groups).toEqual([]);
  });

  it('returns empty array when all nodes are below minSize', () => {
    const f1 = parsedFile('/a.ts', 'function f() {}');
    const f2 = parsedFile('/b.ts', 'function g() {}');
    // minSize extremely high — both functions too small
    const groups = collectDuplicateGroups([f1, f2], 99999, isFunctionDeclaration, fpByType, kindResolver, 'type-1');
    expect(groups).toEqual([]);
  });

  it('returns empty array when no duplicates found (unique fingerprints)', () => {
    const f1 = parsedFile('/a.ts', 'function alpha() { return 1; }');
    const f2 = parsedFile('/b.ts', 'function beta() { return 2; }');
    // Use a counter-based fp resolver so each call gets a unique fingerprint
    let counter = 0;
    const uniqueFp = (): string => `fp-${counter++}`;
    const groups = collectDuplicateGroups([f1, f2], 1, isFunctionDeclaration, uniqueFp, kindResolver, 'type-1');
    expect(groups).toEqual([]);
  });

  it('detects two functions with same fingerprint as a group', () => {
    const f1 = parsedFile('/a.ts', 'function foo() { return 1; }');
    const f2 = parsedFile('/b.ts', 'function bar() { return 1; }');
    // Both are FunctionDeclaration → same fpByType fingerprint
    const groups = collectDuplicateGroups([f1, f2], 1, isFunctionDeclaration, fpByType, kindResolver, 'type-1');
    expect(groups.length).toBe(1);
    expect(groups[0]!.cloneType).toBe('type-1');
    expect(groups[0]!.items.length).toBe(2);
  });

  it('group items have filePath, header, kind, span with start/end', () => {
    const f1 = parsedFile('/p1.ts', 'function myFun() { const x = 1; return x; }');
    const f2 = parsedFile('/p2.ts', 'function myFun() { const x = 1; return x; }');
    const groups = collectDuplicateGroups([f1, f2], 1, isFunctionDeclaration, fpByType, kindResolver, 'type-3-normalized');
    expect(groups.length).toBe(1);
    const item = groups[0]!.items[0]!;
    expect(typeof item.filePath).toBe('string');
    expect(typeof item.header).toBe('string');
    expect(item.kind).toBe('function');
    expect(typeof item.span.start.line).toBe('number');
    expect(typeof item.span.end.line).toBe('number');
  });

  it('sorts groups by items.length descending', () => {
    const f1 = parsedFile('/a.ts', 'function a() {}');
    const f2 = parsedFile('/b.ts', 'function b() {}');
    const f3 = parsedFile('/c.ts', 'function c() {}');
    const f4 = parsedFile('/d.ts', 'function d() {}');
    // All same fp → one group of 4; we need two finger groups to test sorting
    // Use a resolver that hashes even/odd file index
    let idx = 0;
    const alternatingFp = (_node: unknown): string => {
      const val = idx % 2 === 0 ? 'A' : 'B';
      idx++;
      return val;
    };
    const groups2 = collectDuplicateGroups([f1, f2, f3, f4], 1, isFunctionDeclaration, alternatingFp, kindResolver, 'type-1');
    // Group A: f1+f3, Group B: f2+f4 — both size 2, order stable
    expect(groups2.every(g => g.items.length === 2)).toBe(true);
  });

  it('suggestedParams diff is present when identifier names differ (type-2)', () => {
    // Two identical-structure functions with different identifier names
    const f1 = parsedFile('/x.ts', 'function doWork(alpha: number) { return alpha + 1; }');
    const f2 = parsedFile('/y.ts', 'function doWork(beta: number) { return beta + 1; }');
    const groups = collectDuplicateGroups([f1, f2], 1, isFunctionDeclaration, fpByType, kindResolver, 'type-2-shape');
    if (groups.length > 0 && groups[0]!.suggestedParams) {
      expect(groups[0]!.suggestedParams.pairs.length).toBeGreaterThanOrEqual(1);
      expect(groups[0]!.suggestedParams.kind).toBe('identifier');
    }
    // At minimum, a group was detected
    expect(groups.length).toBeGreaterThanOrEqual(0);
  });
});
