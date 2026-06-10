import { describe, expect, it } from 'bun:test';

import { parseSource } from '../../engine/ast/parse-source';
import { detectFragmentClones } from './fragment-detector';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const run = (source: string, minSize = 12) => detectFragmentClones([parseSource('/v/frag.ts', source)], { minSize });

const kinds = (source: string, minSize = 12) => run(source, minSize).map(g => g.findingKind);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('detectFragmentClones', () => {
  // ── W: 추출 가능한 연속 문장열 ────────────────────────────────────────────

  it('should report a fragment clone shared by two different functions', () => {
    const src = `
function a(ids: string[]): number {
  const seen = new Set<string>();
  for (const id of ids) {
    seen.add(id.trim());
  }
  const count = seen.size;
  return count * 3;
}
function b(ids: string[]): string {
  const seen = new Set<string>();
  for (const id of ids) {
    seen.add(id.trim());
  }
  const count = seen.size;
  return count > 0 ? 'y' : 'n';
}
`;
    const groups = run(src);

    expect(groups.length).toBe(1);
    expect(groups[0]!.findingKind).toBe('fragment-clone');
    expect(groups[0]!.items.length).toBe(2);
  });

  it('should merge bound-variable renames in a statement run', () => {
    const src = `
function a(rows: number[]): number {
  const acc = [];
  for (const row of rows) {
    acc.push(row * 2);
  }
  const head = acc[0];
  return head + 1;
}
function b(rows: number[]): number {
  const out = [];
  for (const row of rows) {
    out.push(row * 2);
  }
  const lead = out[0];
  return lead * 9;
}
`;

    expect(kinds(src)).toEqual(['fragment-clone']);
  });

  // ── K: 추출 안전성 ────────────────────────────────────────────────────────

  it('should NOT report when two bindings declared in the run are used after it (2 live-outs)', () => {
    const src = `
function a(xs: number[]): number {
  let total = 0;
  for (const x of xs) {
    total += x;
  }
  const avg = total / xs.length;
  return avg > 10 ? total : avg;
}
function b(xs: number[]): string {
  let total = 0;
  for (const x of xs) {
    total += x;
  }
  const avg = total / xs.length;
  return 'sum=' + String(total + avg);
}
`;

    expect(run(src)).toEqual([]);
  });

  it('should NOT report a run that escapes control flow with a return', () => {
    const src = `
function a(xs: number[]): number {
  for (const x of xs) {
    if (x < 0) {
      return -1;
    }
    process(x);
  }
  return 0;
}
function b(xs: number[]): number {
  for (const x of xs) {
    if (x < 0) {
      return -1;
    }
    process(x);
  }
  return 1;
}
`;
    // run with the early return is not a clean slice; only the trivial tail differs
    const groups = run(src);

    for (const g of groups) {
      // 어떤 fragment도 return을 포함한 run을 보고하면 안 됨 (size로도 걸러지지만 안전성 우선)
      expect(g.findingKind).toBe('fragment-clone');
    }
    // 핵심: 제어 이탈 run은 비보고 → for 본문 전체 run은 잡히지 않음
    expect(groups.length).toBe(0);
  });

  // ── K: 자유 식별자 / 최소 크기 ────────────────────────────────────────────

  it('should NOT report when the run calls different free functions', () => {
    const src = `
function a(items: number[]): number {
  const mapped = [];
  for (const item of items) {
    mapped.push(transformOne(item));
  }
  return mapped.length;
}
function b(items: number[]): number {
  const mapped = [];
  for (const item of items) {
    mapped.push(transformTwo(item));
  }
  return mapped.length;
}
`;

    expect(run(src)).toEqual([]);
  });

  it('should NOT report a run below the minimum size floor', () => {
    const src = `
function a(x: number): number {
  console.log(x);
  return alpha(x);
}
function b(y: number): number {
  console.log(y);
  return beta(y);
}
`;

    expect(run(src, 12)).toEqual([]);
  });

  // ── 경계 ──────────────────────────────────────────────────────────────────

  it('should report across two files', () => {
    const mk = (tail: string) => `function f(ids: string[]): number {
  const seen = new Set<string>();
  for (const id of ids) {
    seen.add(id.trim());
  }
  const count = seen.size;
  ${tail}
}`;
    const groups = detectFragmentClones(
      [parseSource('/v/a.ts', mk('return count * 2;')), parseSource('/v/b.ts', mk('return count > 0 ? 1 : 0;'))],
      { minSize: 12 },
    );

    expect(groups.length).toBeGreaterThanOrEqual(1);
    expect(groups[0]!.findingKind).toBe('fragment-clone');
  });

  it('should return empty for a single function with no internal repetition', () => {
    const src = `
function solo(x: number): number {
  const a = x + 1;
  const b = a * 2;
  return b;
}
`;

    expect(run(src)).toEqual([]);
  });

  it('should skip files with parse errors', () => {
    const ok = parseSource('/v/ok.ts', 'function f(x: number) { return x; }');
    const bad = {
      filePath: '/v/bad.ts',
      program: {} as never,
      errors: [{ message: 'err' }] as never,
      comments: [],
      sourceText: 'invalid {{{',
      module: {} as never,
    };

    expect(detectFragmentClones([ok, bad], { minSize: 1 })).toEqual([]);
  });
});
