import { describe, expect, it } from 'bun:test';

import {
  type SourceCase,
  analyzeSource,
  expectNoFindings,
  expectSingleFindingKind,
} from '../../../test/integration/shared/test-kit';
import { analyzeCollapsibleIf } from './analyzer';

type DetectCase = SourceCase;

type NoDetectCase = SourceCase;

// ── 거짓 음성 후보 (감지되어야 하는 것) ──────────────────────────────────
const detectCases: DetectCase[] = [
  {
    // async는 일반 함수와 동일하게 처리: outer if(no else, 1 stmt) + inner if(no else, 3 stmts)
    name: '[FN-G] async function 안에서',
    source: `
export async function f(a: boolean, b: boolean) {
  if (a) {
    if (b) {
      await doA();
      await doB();
      await doC();
    }
  }
}
`,
  },
  {
    // arrow function도 isFunctionNode로 감지됨
    name: '[FN-H] arrow function에서',
    source: `
export const f = (a: boolean, b: boolean) => {
  if (a) {
    if (b) {
      doA(); doB(); doC();
    }
  }
};
`,
  },
];
// ── 거짓 양성 후보 (감지되면 안 되는 것) ──────────────────────────────────
const noDetectCases: NoDetectCase[] = [
  {
    // outer if has alternate → detectCollapsibleIf returns null
    name: '[FP-I] 외부 if에 else 있음',
    source: `
export function f(a: boolean, b: boolean) {
  if (a) {
    if (b) { doA(); doB(); doC(); }
  } else {
    doElse();
  }
}
`,
  },
  {
    // outer body has 2 stmts (setup, if(b)) → outerBody.length !== 1 → null
    name: '[FP-J] 외부 body에 다른 stmt 있음',
    source: `
export function f(a: boolean, b: boolean) {
  if (a) {
    setup();
    if (b) { doA(); doB(); doC(); }
  }
}
`,
  },
];

describe('analyzeCollapsibleIf - false negative / false positive scenarios', () => {
  it.each(detectCases)('analyzeCollapsibleIf - $name - 감지', ({ source }) => {
    // Arrange & Act
    const result = expectSingleFindingKind(source, analyzeCollapsibleIf, 'collapsible-if');

    expect(result[0]!.score).toBe(3);
  });

  it.each(noDetectCases)('analyzeCollapsibleIf - $name - 감지 안 됨', ({ source }) => {
    // Arrange & Act
    expectNoFindings(source, analyzeCollapsibleIf);
  });
});
