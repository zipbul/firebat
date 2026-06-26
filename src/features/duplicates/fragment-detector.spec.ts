import { describe, expect, it } from 'bun:test';

import { expectLength } from '../../../test/integration/shared/test-kit';
import { parseSource } from '../../engine/ast/parse-source';
import { detectFragmentClones } from './fragment-detector';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const run = (source: string, minSize = 12) => detectFragmentClones([parseSource('/v/frag.ts', source)], { minSize });

/** Run fragment detection on `src` and assert exactly one clone group, returning the groups. */
const runExpectOne = (src: string): ReturnType<typeof run> => expectLength(run(src), 1) as unknown as ReturnType<typeof run>;

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
    const groups = runExpectOne(src);

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

  it('should report a run whose final statement is a top-level return (extractable as a value)', () => {
    const src = `
function a(xs: number[]): number {
  warmA();
  const seen = new Set<number>();
  for (const x of xs) {
    seen.add(x);
  }
  const total = seen.size;
  return total + 1;
}
function b(ys: number[]): number {
  prepB();
  other();
  const seen = new Set<number>();
  for (const x of ys) {
    seen.add(x);
  }
  const total = seen.size;
  return total + 1;
}
`;

    expect(kinds(src)).toEqual(['fragment-clone']);
  });

  it('should NOT report a run with a non-terminal early return', () => {
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

  it('should flip a run from K to W exactly at the minimum-size floor', () => {
    // 동일한 추출 가능 run을 floor 위/아래에서 평가 — 임계 자체를 직접 probe한다.
    const src = `
function a(xs: number[]): number {
  warmA();
  const seen = new Set<number>();
  for (const x of xs) {
    seen.add(x);
  }
  const total = seen.size;
  return total + 1;
}
function b(ys: number[]): number {
  prepB();
  other();
  const seen = new Set<number>();
  for (const x of ys) {
    seen.add(x);
  }
  const total = seen.size;
  return total + 1;
}
`;

    // 아주 큰 floor → 모든 run이 걸러짐 (K)
    expect(run(src, 10_000)).toEqual([]);
    // floor 1 → run 보고 (W)
    expect(kinds(src, 1)).toEqual(['fragment-clone']);
  });

  it('should NOT report a run containing a yield (generator protocol binds its position)', () => {
    const src = `
function* a(xs: number[]): Generator<number> {
  primeA();
  const s = aggregate(xs);
  yield s;
  const z = s + 1;
  emit(z);
}
function* b(ys: number[]): Generator<number> {
  primeB();
  const s = aggregate(ys);
  yield s;
  const z = s + 1;
  emit(z);
}
`;

    expect(run(src)).toEqual([]);
  });

  it('should report a nested-block statement run (run lives inside an if-body)', () => {
    const src = `
function a(flag: boolean, xs: number[]): number {
  if (flag) {
    const seen = new Set<number>();
    for (const x of xs) {
      seen.add(x);
    }
    const c = seen.size;
    const w = c * 3;
    recordX(w);
  }
  return uniqueA();
}
function b(flag: boolean, xs: number[]): number {
  warm();
  if (flag) {
    const seen = new Set<number>();
    for (const x of xs) {
      seen.add(x);
    }
    const c = seen.size;
    const w = c * 3;
    recordX(w);
  }
  return uniqueB();
}
`;
    // detector 레벨에서는 중첩 블록 run을 잡는다 (if-문 자체와 if-body run; pipeline이 subsume).
    const ks = kinds(src);

    expect(ks.length).toBeGreaterThanOrEqual(1);
    expect(ks.every(k => k === 'fragment-clone')).toBe(true);
  });

  it('should not emit overlapping runs from a tandem-repeated statement', () => {
    // p()가 반복되는 블록 — 겹치는 슬라이스를 서로의 클론으로 보고하면 안 된다.
    const src = `
function a(): void {
  lead(11, 22);
  payload(33, 44);
  payload(33, 44);
  payload(33, 44);
  tailA(55, 66);
}
function b(): void {
  warm(77, 88);
  payload(33, 44);
  payload(33, 44);
  payload(33, 44);
  tailB(99, 10);
}
`;
    const groups = run(src, 1);

    // 보고된 fragment 그룹들 안에서 같은 파일 내 span이 서로 겹치면 안 됨
    for (const g of groups) {
      const byFile = new Map<string, Array<{ s: number; e: number }>>();

      for (const item of g.items) {
        const list = byFile.get(item.filePath) ?? [];

        list.push({ s: item.span.start.line, e: item.span.end.line });
        byFile.set(item.filePath, list);
      }

      for (const spans of byFile.values()) {
        spans.sort((p, q) => p.s - q.s);

        for (let i = 1; i < spans.length; i++) {
          expect(spans[i]!.s).toBeGreaterThan(spans[i - 1]!.e);
        }
      }
    }
  });

  it('should attach a deterministic extraction plan (params, return, this) to a fragment', () => {
    const src = `
function a(ids: string[]): number {
  warmA();
  const seen = new Set<string>();
  for (const id of ids) {
    seen.add(id.trim());
  }
  const count = seen.size;
  return count + 1;
}
function b(ids: string[]): number {
  prepB();
  other();
  const seen = new Set<string>();
  for (const id of ids) {
    seen.add(id.trim());
  }
  const count = seen.size;
  return count * 9;
}
`;
    const groups = runExpectOne(src);
    const plan = groups[0]!.suggestedExtraction;

    expect(plan).toBeDefined();
    expect(plan!.params).toEqual(['ids']); // 런이 읽는 외부 지역변수
    expect(plan!.returns).toBe('count'); // 단일 live-out (return이 달라 run에서 제외됨)
    expect(plan!.usesThis).toBe(false);
  });

  it('should flag usesThis when the run references this', () => {
    const src = `
class A {
  svc: Store;
  run(id: string): number {
    leadA();
    const key = id.trim();
    const row = this.svc.find(key);
    const n = row.count;
    return n + sideA();
  }
  other(id: string): number {
    warmB();
    extra();
    const key = id.trim();
    const row = this.svc.find(key);
    const n = row.count;
    return n + sideB();
  }
}
`;
    const groups = run(src);

    expect(groups.length).toBeGreaterThanOrEqual(1);
    expect(groups[0]!.suggestedExtraction!.usesThis).toBe(true);
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
