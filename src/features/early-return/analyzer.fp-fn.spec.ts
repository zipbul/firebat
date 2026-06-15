import { describe, it } from 'bun:test';

import type { DetectionCase, NoFindingCase } from '../../../test/integration/shared/early-return-cases';

import { expectDetection, expectNoFinding } from '../../../test/integration/shared/early-return-cases';

describe('analyzeEarlyReturn - false negative / false positive scenarios', () => {
  // eslint-disable-line firebat/test-describe-sut-name -- FP/FN 시나리오 전용 파일

  // ── 거짓 음성 후보: 감지되어야 하는 것 ──────────────────────────────────
  const falseNegativeCases: DetectionCase[] = [
    {
      // [FN-A] throw로 끝나는 consequent (3 stmts) → implicit-else 감지
      label: 'throw-ending consequent yields implicit-else',
      source: `
export function f(data: unknown) {
  if (isInvalid(data)) {
    logError();
    cleanup();
    throw new Error('invalid');
  }
  return process(data);
}
`,
      expected: { kind: 'implicit-else', metrics: { statementsAffected: 3 } },
    },
    {
      // [FN-B] 중간 if + 마지막 bare if(2 stmts) → wrapping-if 감지, implicit-else 비감지
      label: 'mid-if plus trailing bare if yields wrapping-if (not implicit-else)',
      source: `
export function f(a: boolean, b: boolean) {
  if (a) {
    doA(); doB(); doC(); doD();
    return 'a';
  }
  doMiddle();
  if (b) { doX(); doY(); }
}
`,
      expected: { kind: 'wrapping-if', metrics: { statementsAffected: 2 } },
    },
    {
      // [FN-C] 루프에서 break로 끝나는 consequent (4 stmts) → implicit-else 감지
      label: 'break-ending consequent in loop yields implicit-else',
      source: `
export function processItems(items: string[]) {
  for (const item of items) {
    if (item.isDone()) {
      finalizeA(item);
      finalizeB(item);
      finalizeC(item);
      break;
    }
    processNormal(item);
  }
}
`,
      expected: { kind: 'implicit-else', metrics: { statementsAffected: 4 } },
    },
    {
      // [FN-G] non-consecutive trailing-if → dispatch threshold 미충족 → wrapping-if 감지 유지
      label: 'single trailing if (preceded by non-if) still yields wrapping-if',
      source: `
export function process(data: { valid: boolean }) {
  const x = prepare(data);
  if (data.valid) { doA(x); doB(x); doC(x); }
}
`,
      expected: { kind: 'wrapping-if' },
    },
    {
      // [FN-I] guards exit early, wrapping-if at tail position → 감지 유지
      label: 'wrapping-if at tail position after guards still detected',
      source: `
export function process(data: { valid: boolean; ready: boolean }) {
  if (!data.valid) { return null; }
  if (!data.ready) { throw new Error('not ready'); }
  const prepared = prepare(data);
  if (prepared.ok) { doA(prepared); doB(prepared); doC(prepared); }
}
`,
      expected: { kind: 'wrapping-if' },
    },
    {
      // [FN-J] loop body wrapping-if in non-tail context → insideLoop override → 감지 유지
      label: 'wrapping-if inside loop body (non-tail) still detected',
      source: `
export function visit(nodes: Array<{ type: string; items: string[] }>) {
  if (nodes.length === 0) { logEmpty(); return; }
  for (const node of nodes) {
    if (node.type === 'A') {
      for (const item of node.items) {
        if (item.length > 0) { processA(item); processB(item); processC(item); }
      }
    }
    if (node.type === 'B') { handleB1(node); handleB2(node); }
  }
}
`,
      expected: { kind: 'wrapping-if' },
    },
    {
      // [FN-H] multi-stmt cascade chain (no single-exit) → cascade-guard 감지 유지
      label: 'multi-statement cascade chain yields cascade-guard',
      source: `
export function handle(type: string): string {
  if (type === 'a') { logA(); setupA(); return 'alpha'; }
  else if (type === 'b') { logB(); setupB(); return 'beta'; }
  else { return 'unknown'; }
}
`,
      expected: { kind: 'cascade-guard' },
    },
  ];

  it.each(falseNegativeCases)('should not miss the pattern when $label', expectDetection);

  // ── 거짓 양성 후보: 감지되면 안 되는 것 ──────────────────────────────────
  const falsePositiveCases: NoFindingCase[] = [
    {
      // [FP-D] 이미 guard clause 형태 (consequent가 short side) → ratio FAIL
      label: 'existing guard clause (short consequent) is not flagged',
      source: `
export function f(x: unknown) {
  if (!x) { return null; }
  doA(); doB(); doC(); doD();
  return result;
}
`,
    },
    {
      // [FP-E] remaining이 exit으로 안 끝남 (void 함수) → implicit-else 비감지
      label: 'remaining tail without exit (void function) is not flagged',
      source: `
export function f(x: boolean) {
  if (x) {
    doA(); doB(); doC(); doD(); doE();
    return 'done';
  }
  logWarning();
}
`,
    },
    {
      // [FP-F] consequent가 exit 없이 끝남 → implicit-else 비감지
      label: 'consequent without exit is not flagged',
      source: `
export function f(x: boolean) {
  if (x) {
    doA(); doB(); doC(); doD();
  }
  return null;
}
`,
    },
    {
      // [FP-G] visitor/dispatch (3 trailing ifs) → sequential dispatch → wrapping-if 비감지
      label: 'three trailing dispatch ifs (visitor) are not flagged',
      source: `
export function visitNode(node: { type: string }) {
  if (node.type === 'IfStatement') { handleIf1(); handleIf2(); handleIf3(); }
  if (node.type === 'ForStatement') { handleFor1(); handleFor2(); handleFor3(); }
  if (node.type === 'WhileStatement') { handleWhile1(); handleWhile2(); handleWhile3(); }
}
`,
    },
    {
      // [FP-I] visitor (2 trailing ifs) → sequential dispatch → implicit-else 비감지
      label: 'two trailing dispatch ifs (classify) are not flagged',
      source: `
export function classify(node: { type: string }): string {
  if (node.type === 'Identifier') { s1(); s2(); s3(); s4(); s5(); s6(); return 'id'; }
  if (node.type === 'Literal') { return 'lit'; }
  return 'unknown';
}
`,
    },
    {
      // [FP-J] non-tail dispatch cases with nested wrapping-ifs → 비감지
      label: 'nested wrapping-ifs inside non-tail dispatch cases are not flagged',
      source: `
export function visit(node: { type: string; value: unknown }) {
  if (node.type === 'A') {
    const x = prepare(node);
    if (isValid(x)) { doA1(x); doA2(x); doA3(x); }
  }
  if (node.type === 'B') {
    const y = prepare(node);
    if (isReady(y)) { doB1(y); doB2(y); doB3(y); }
  }
  if (node.type === 'C') { handleC(node); }
}
`,
    },
    {
      // [FP-H] single-exit dispatch (every branch is a bare return) → cascade-guard 비감지
      label: 'single-exit dispatch cascade is not flagged',
      source: `
export function dispatch(type: string): string {
  if (type === 'a') { return 'alpha'; }
  else if (type === 'b') { return 'beta'; }
  else { return 'unknown'; }
}
`,
    },
  ];

  it.each(falsePositiveCases)('should not raise a false positive when $label', expectNoFinding);
});
