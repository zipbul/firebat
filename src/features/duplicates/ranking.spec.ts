import { describe, expect, it } from 'bun:test';

import { parseSource } from '../../engine/ast/parse-source';
import { analyzeDuplicates } from './analyzer';

// severity = size × 사이트수 (결정적·닫힘), 출력은 severity 내림차순.

describe('duplicates ranking', () => {
  it('should set severity = size * site count and sort findings by severity desc', () => {
    // 큰 3-site 클론 + 작은 2-site 클론 → 큰 것이 먼저
    const big = (n: string) => `function ${n}(a: number): number {
  const x = a * 2;
  const y = x + 3;
  const z = y * 4;
  const w = z - 5;
  return w;
}`;
    const small = (n: string) => `function ${n}(p: number): number {
  const q = p + 1;
  return q;
}`;
    const src = [big('b1'), big('b2'), big('b3'), small('s1'), small('s2')].join('\n');
    const groups = analyzeDuplicates([parseSource('/v/x.ts', src)], { minSize: 1 });

    expect(groups.length).toBeGreaterThanOrEqual(2);

    // 각 그룹 severity == size * items.length
    for (const g of groups) {
      expect(g.severity).toBe(g.size * g.items.length);
    }

    // severity 내림차순
    for (let i = 1; i < groups.length; i++) {
      expect(groups[i - 1]!.severity).toBeGreaterThanOrEqual(groups[i]!.severity);
    }

    // 큰 3-site 클론이 첫 번째
    expect(groups[0]!.items.length).toBe(3);
  });
});
