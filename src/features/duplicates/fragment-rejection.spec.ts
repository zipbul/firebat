import { describe, expect, it } from 'bun:test';

import { parseSource } from '../../engine/ast/parse-source';
import { explainFragments } from './fragment-detector';

// 골든의 -keep(빈 결과)이 "안 봄"이 아니라 "후보를 보고 사유와 함께 거부"임을 증명한다.
// (적대 리뷰 지적: 빈 배열만으로는 vacuous K와 진짜 거부를 구분 못 함)

const candidates = (source: string, minSize = 12) => explainFragments([parseSource('/v/x.ts', source)], { minSize });

describe('explainFragments — K 케이스의 거부 사유', () => {
  it('should reject a run with two live-outs as multiple-live-outs (not silently skip)', () => {
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
    const cands = candidates(src);

    // 후보가 실제로 형성됐고(=고려됨), 사유가 live-out
    expect(cands.length).toBeGreaterThanOrEqual(1);
    expect(cands.some(c => c.verdict.outcome === 'rejected' && c.verdict.reason === 'multiple-live-outs')).toBe(true);
    expect(cands.every(c => c.verdict.outcome !== 'reported')).toBe(true);
  });

  it('should reject a too-small run as below-min-size (the run was considered, then floored)', () => {
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
    const cands = candidates(src, 12);

    expect(cands.length).toBeGreaterThanOrEqual(1);
    expect(cands.some(c => c.verdict.outcome === 'rejected' && c.verdict.reason === 'below-min-size')).toBe(true);
  });

  it('should reject a mid-run early return as control-escape', () => {
    const src = `
function a(xs: number[]): number {
  for (const x of xs) {
    if (x < 0) {
      return -1;
    }
    sink(x);
  }
  return 0;
}
function b(xs: number[]): number {
  for (const x of xs) {
    if (x < 0) {
      return -1;
    }
    sink(x);
  }
  return 9;
}
`;
    const cands = candidates(src, 1);

    expect(cands.some(c => c.verdict.outcome === 'rejected' && c.verdict.reason === 'control-escape')).toBe(true);
  });

  it('should report an extractable run (positive control for the rejection machinery)', () => {
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
  return count + 1;
}
`;
    const cands = candidates(src, 12);

    expect(cands.some(c => c.verdict.outcome === 'reported')).toBe(true);
  });
});
