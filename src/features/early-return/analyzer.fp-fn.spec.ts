import { describe, expect, it } from 'bun:test';

import { analyzeEarlyReturn } from './analyzer';
import { parseSource } from '../../engine/ast/parse-source';

describe('analyzeEarlyReturn - false negative / false positive scenarios', () => { // eslint-disable-line firebat/test-describe-sut-name -- FP/FN 시나리오 전용 파일
  const parse = (source: string) => [parseSource('/virtual/test.ts', source)];

  // ── 거짓 음성 후보 (감지되어야 하는 것) ──────────────────────────────────

  it('analyzeEarlyReturn - [FN-A] throw로 끝나는 consequent - implicit-else 감지', () => {
    // Arrange
    const files = parse(`
export function f(data: unknown) {
  if (isInvalid(data)) {
    logError();
    cleanup();
    throw new Error('invalid');
  }
  return process(data);
}
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert
    // consequent: 3 stmts (ends with throw), remaining: 1 stmt (return process)
    // isExitBlock(consequent) → ends with ThrowStatement → true
    // ratio: 3 >= 1*2=2 → PASS, remaining=1 <= 3 → PASS
    // lastRemaining = return process → isExitStatement → true
    // 기대: implicit-else 감지
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('implicit-else');
    expect(result[0]?.metrics.statementsAffected).toBe(3);
  });

  it('analyzeEarlyReturn - [FN-B] 중간 위치 if + 마지막 if (2 stmts) — wrapping-if 감지, implicit-else 비감지', () => {
    // Arrange
    const files = parse(`
export function f(a: boolean, b: boolean) {
  if (a) {
    doA(); doB(); doC(); doD();
    return 'a';
  }
  doMiddle();
  if (b) { doX(); doY(); }
}
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert
    // 함수 body = [if(a){...}, doMiddle(), if(b){doX;doY}]
    //
    // [implicit-else 후보: if(a)]
    //   consequent: 5 stmts (ends with return 'a') → isExitBlock → true
    //   remaining after if(a) = 2 stmts [doMiddle, if(b)]
    //   ratio: 5 >= 2*2=4 → PASS
    //   remaining=2 <= 3 → PASS
    //   lastRemaining = if(b) → isExitStatement? IfStatement이므로 → false → SKIP
    //   → implicit-else 비감지
    //
    // [wrapping-if 후보: body의 last stmt = if(b){doX;doY}]
    //   last stmt = if(b), no alternate, consequentCount=2 >= 2 → wrapping-if score=2
    //   → wrapping-if 감지
    //
    // 기대: wrapping-if 1건 (if(b)에 대해), implicit-else 없음
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('wrapping-if');
    expect(result[0]?.metrics.statementsAffected).toBe(2);
    // implicit-else는 감지 안 됨 — lastRemaining이 IfStatement이기 때문
  });

  it('analyzeEarlyReturn - [FN-C] 루프에서 break로 끝나는 consequent - implicit-else 감지', () => {
    // Arrange
    const files = parse(`
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
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert
    // insideLoop=true → isLoopGuardBlock(consequent) 사용
    // consequent: 4 stmts (ends with BreakStatement) → isLoopGuardBlock → true
    // remaining: 1 stmt (processNormal)
    // ratio: 4 >= 1*2=2 → PASS, remaining=1 <= 3 → PASS
    // insideLoop=true → remaining exit 체크 없음
    // 기대: implicit-else 감지
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('implicit-else');
    expect(result[0]?.metrics.statementsAffected).toBe(4);
  });

  // ── 거짓 양성 후보 (감지되면 안 되는 것) ──────────────────────────────────

  it('analyzeEarlyReturn - [FP-D] 이미 guard clause 형태 (consequent가 short side) - 감지 안 됨', () => {
    // Arrange
    const files = parse(`
export function f(x: unknown) {
  if (!x) { return null; }
  doA(); doB(); doC(); doD();
  return result;
}
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert
    // implicit-else 후보: if(!x)
    //   consequent: 1 stmt (return null), remaining: 5 stmts
    //   ratio: 1 < 5*2=10 → FAIL (consequent이 short side)
    //   → implicit-else 비감지
    // wrapping-if: body last stmt = return result → IfStatement 아님 → null
    // 기대: 감지 안 됨
    expect(result).toEqual([]);
  });

  it('analyzeEarlyReturn - [FP-E] remaining이 exit으로 안 끝남 (void 함수) - 감지 안 됨', () => {
    // Arrange
    const files = parse(`
export function f(x: boolean) {
  if (x) {
    doA(); doB(); doC(); doD(); doE();
    return 'done';
  }
  logWarning();
}
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert
    // implicit-else 후보: if(x)
    //   consequent: 6 stmts (ends with return) → isExitBlock → true
    //   remaining: 1 stmt [logWarning]
    //   ratio: 6 >= 1*2=2 → PASS, remaining=1 <= 3 → PASS
    //   insideLoop=false → lastRemaining = logWarning() (ExpressionStatement)
    //   isExitStatement(ExpressionStatement) → false → SKIP
    //   → implicit-else 비감지
    // wrapping-if: body last stmt = logWarning() → IfStatement 아님 → null
    // 기대: 감지 안 됨
    expect(result).toEqual([]);
  });

  it('analyzeEarlyReturn - [FP-F] consequent가 exit 없이 끝남 - 감지 안 됨', () => {
    // Arrange
    const files = parse(`
export function f(x: boolean) {
  if (x) {
    doA(); doB(); doC(); doD();
  }
  return null;
}
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert
    // body = [if(x){4 stmts, no exit}, return null]
    // implicit-else 후보: if(x)
    //   consequent: 4 stmts, ends with doD() (ExpressionStatement) → isExitBlock → false → SKIP
    // wrapping-if: body last stmt = return null → IfStatement 아님 → null
    // 기대: 감지 안 됨
    expect(result).toEqual([]);
  });

  // ── Filter A: Consecutive Trailing If ──────────────────────────────

  it('analyzeEarlyReturn - [FP-G] visitor/dispatch — wrapping-if 미감지', () => {
    // Arrange
    const files = parse(`
export function visitNode(node: { type: string }) {
  if (node.type === 'IfStatement') { handleIf1(); handleIf2(); handleIf3(); }
  if (node.type === 'ForStatement') { handleFor1(); handleFor2(); handleFor3(); }
  if (node.type === 'WhileStatement') { handleWhile1(); handleWhile2(); handleWhile3(); }
}
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert — 3개 trailing ifs → isSequentialDispatch → wrapping-if/implicit-else 비감지
    expect(result).toEqual([]);
  });

  it('analyzeEarlyReturn - [FP-I] visitor — implicit-else 미감지', () => {
    // Arrange
    const files = parse(`
export function classify(node: { type: string }): string {
  if (node.type === 'Identifier') { s1(); s2(); s3(); s4(); s5(); s6(); return 'id'; }
  if (node.type === 'Literal') { return 'lit'; }
  return 'unknown';
}
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert — 2개 trailing ifs → isSequentialDispatch → implicit-else 비감지
    expect(result).toEqual([]);
  });

  it('analyzeEarlyReturn - [FN-G] regression — non-consecutive trailing-if wrapping-if 감지 유지', () => {
    // Arrange
    const files = parse(`
export function process(data: { valid: boolean }) {
  const x = prepare(data);
  if (data.valid) { doA(x); doB(x); doC(x); }
}
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert — trailing ifs=1 → threshold 미충족 → wrapping-if 감지됨
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('wrapping-if');
  });

  // ── Filter: Function-level dispatch detection ──────────────────────

  it('analyzeEarlyReturn - [FP-J] non-tail dispatch case — nested wrapping-if 미감지', () => {
    // Arrange — wrapping-if inside non-last dispatch cases: return would skip subsequent cases
    const files = parse(`
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
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert — if(A), if(B) are non-last → inTailPosition=false → nested wrapping-ifs 비감지
    // Block-level: 3 trailing bare ifs → sequential dispatch → body-level also skipped
    expect(result).toEqual([]);
  });

  it('analyzeEarlyReturn - [FN-I] regression — guards + wrapping-if at tail position 감지 유지', () => {
    // Arrange — guards exit early, wrapping-if is at tail position
    const files = parse(`
export function process(data: { valid: boolean; ready: boolean }) {
  if (!data.valid) { return null; }
  if (!data.ready) { throw new Error('not ready'); }
  const prepared = prepare(data);
  if (prepared.ok) { doA(prepared); doB(prepared); doC(prepared); }
}
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert — wrapping-if is last stmt of function body → inTailPosition=true → 감지
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('wrapping-if');
  });

  it('analyzeEarlyReturn - [FN-J] loop body wrapping-if in non-tail context 감지 유지', () => {
    // Arrange — wrapping-if inside loop body (insideLoop=true overrides non-tail position)
    const files = parse(`
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
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert — wrapping-if in inner loop body → insideLoop=true → 감지
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('wrapping-if');
  });

  // ── Filter B: Single-exit Dispatch ─────────────────────────────────

  it('analyzeEarlyReturn - [FP-H] single-exit dispatch — cascade-guard 미감지', () => {
    // Arrange
    const files = parse(`
export function dispatch(type: string): string {
  if (type === 'a') { return 'alpha'; }
  else if (type === 'b') { return 'beta'; }
  else { return 'unknown'; }
}
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert — singleExitCount=2, chainLength=2 → all single-exit → 비감지
    expect(result).toEqual([]);
  });

  it('analyzeEarlyReturn - [FN-H] regression — multi-stmt cascade-guard 감지 유지', () => {
    // Arrange
    const files = parse(`
export function handle(type: string): string {
  if (type === 'a') { logA(); setupA(); return 'alpha'; }
  else if (type === 'b') { logB(); setupB(); return 'beta'; }
  else { return 'unknown'; }
}
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert — singleExitCount=0, chainLength=2 → 0≠2 → cascade-guard 감지
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('cascade-guard');
  });
});
