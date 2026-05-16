/**
 * 함수 AST 노드에서 statement 단위 fingerprint를 추출한다.
 *
 * - `extractStatementFingerprints`: 순서가 있는 시퀀스 (LCS 입력용)
 * - `extractStatementFingerprintBag`: 순서 없는 bag (MinHash 입력용)
 *
 * 지원하는 함수 노드 타입:
 *   - FunctionDeclaration / FunctionExpression → BlockStatement.body
 *   - ArrowFunctionExpression → BlockStatement.body 또는 expression body (단일 statement)
 *   - MethodDefinition → value(FunctionExpression)에서 재귀
 */

import type { Node } from 'oxc-parser';

import { createOxcFingerprintShape } from '../../engine/ast/oxc-fingerprint';

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * 함수 AST 노드에서 top-level statement별 fingerprint 시퀀스를 추출한다.
 *
 * - BlockStatement.body의 각 직계 statement에 shape fingerprint 적용
 * - ArrowFunction expression body → 단일 statement로 취급
 * - MethodDefinition → value(FunctionExpression)에서 추출
 * - 함수 body가 없는 노드(TypeAlias, Interface 등) → 빈 배열
 */
export const extractStatementFingerprints = (functionNode: Node): ReadonlyArray<string> => {
  const statements = getBodyStatements(functionNode);

  return statements.map(s => createOxcFingerprintShape(s));
};

/**
 * 함수의 statement fingerprint를 bag(중복 허용 집합)으로 반환.
 * MinHash 입력용. 순서 정보가 없으므로 삽입/삭제된 코드에 더 robust.
 */
export const extractStatementFingerprintBag = (functionNode: Node): ReadonlyArray<string> => {
  const fps = extractStatementFingerprints(functionNode);
  const counts = new Map<string, number>();

  return fps.map(fp => {
    const count = counts.get(fp) ?? 0;

    counts.set(fp, count + 1);

    return count === 0 ? fp : `${fp}#${count}`;
  });
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * 함수 노드에서 직계 statement 목록을 반환한다.
 * 중첩 함수는 하나의 statement(FunctionDeclaration 등)로 취급 — 내부 재귀 없음.
 */
const getBodyStatements = (node: Node): ReadonlyArray<Node> => {
  // MethodDefinition → value는 FunctionExpression
  if (node.type === 'MethodDefinition') {
    return getBodyStatements(node.value);
  }

  // FunctionDeclaration, FunctionExpression, ArrowFunctionExpression
  if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
    const body = node.body;

    if (body === null) {
      return [];
    }

    // BlockStatement → .body 배열
    if (body.type === 'BlockStatement') {
      return body.body;
    }

    // ArrowFunction expression body → 단일 statement
    return [body];
  }

  return [];
};
