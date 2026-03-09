import { describe, expect, it } from 'bun:test';

import { analyzeCollapsibleIf } from './analyzer';
import { parseSource } from '../../engine/ast/parse-source';

describe('analyzeCollapsibleIf - false negative / false positive scenarios', () => {
  const parse = (source: string) => [parseSource('/virtual/test.ts', source)];

  // ── 거짓 음성 후보 (감지되어야 하는 것) ──────────────────────────────────

  it('analyzeCollapsibleIf - [FN-G] async function 안에서 - 감지', () => {
    // Arrange
    const files = parse(`
export async function f(a: boolean, b: boolean) {
  if (a) {
    if (b) {
      await doA();
      await doB();
      await doC();
    }
  }
}
`);
    // Act
    const result = analyzeCollapsibleIf(files);

    // Assert — async는 일반 함수와 동일하게 처리
    // outer if: no else, body 1 stmt (inner if)
    // inner if: no else, 3 AwaitExpressions (ExpressionStatements)
    // 기대: collapsible-if 감지, score=3
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('collapsible-if');
    expect(result[0]!.score).toBe(3);
  });

  it('analyzeCollapsibleIf - [FN-H] arrow function에서 - 감지', () => {
    // Arrange
    const files = parse(`
export const f = (a: boolean, b: boolean) => {
  if (a) {
    if (b) {
      doA(); doB(); doC();
    }
  }
};
`);
    // Act
    const result = analyzeCollapsibleIf(files);

    // Assert — arrow function도 isFunctionNode로 감지됨
    // 기대: collapsible-if 감지, score=3
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('collapsible-if');
    expect(result[0]!.score).toBe(3);
  });

  // ── 거짓 양성 후보 (감지되면 안 되는 것) ──────────────────────────────────

  it('analyzeCollapsibleIf - [FP-I] 외부 if에 else 있음 - 감지 안 됨', () => {
    // Arrange
    const files = parse(`
export function f(a: boolean, b: boolean) {
  if (a) {
    if (b) { doA(); doB(); doC(); }
  } else {
    doElse();
  }
}
`);
    // Act
    const result = analyzeCollapsibleIf(files);

    // Assert — outer if has alternate → detectCollapsibleIf returns null
    // 기대: 감지 안 됨
    expect(result).toEqual([]);
  });

  it('analyzeCollapsibleIf - [FP-J] 외부 body에 다른 stmt 있음 - 감지 안 됨', () => {
    // Arrange
    const files = parse(`
export function f(a: boolean, b: boolean) {
  if (a) {
    setup();
    if (b) { doA(); doB(); doC(); }
  }
}
`);
    // Act
    const result = analyzeCollapsibleIf(files);

    // Assert — outer body has 2 stmts (setup, if(b)) → outerBody.length !== 1 → null
    // 기대: 감지 안 됨
    expect(result).toEqual([]);
  });
});
