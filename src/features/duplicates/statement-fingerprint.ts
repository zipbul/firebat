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

import type { NodeRecord } from '../../engine/types';

import { createOxcFingerprintShape } from '../../engine/ast/oxc-fingerprint';
import {
  isNodeRecord,
  isOxcNode,
  isOxcNodeArray,
} from '../../engine/ast/oxc-ast-utils';

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * 함수 AST 노드에서 top-level statement별 fingerprint 시퀀스를 추출한다.
 *
 * - BlockStatement.body의 각 직계 statement에 type-2-shape fingerprint 적용
 * - ArrowFunction expression body → 단일 statement로 취급
 * - MethodDefinition → value(FunctionExpression)에서 추출
 * - 함수 body가 없는 노드(TypeAlias, Interface 등) → 빈 배열
 */
export const extractStatementFingerprints = (
  functionNode: Node,
): ReadonlyArray<string> => {
  const statements = getBodyStatements(functionNode);
  return statements.map((s) => createOxcFingerprintShape(s));
};

/**
 * 함수의 statement fingerprint를 bag(중복 허용 집합)으로 반환.
 * MinHash 입력용. 순서 정보가 없으므로 삽입/삭제된 코드에 더 robust.
 */
export const extractStatementFingerprintBag = (
  functionNode: Node,
): ReadonlyArray<string> => {
  // bag은 시퀀스와 동일 — MinHash는 집합 연산이므로 순서 무시됨
  return extractStatementFingerprints(functionNode);
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * 함수 노드에서 직계 statement 목록을 반환한다.
 * 중첩 함수는 하나의 statement(FunctionDeclaration 등)로 취급 — 내부 재귀 없음.
 */
const getBodyStatements = (node: Node): ReadonlyArray<Node> => {
  if (!isNodeRecord(node)) return [];

  const record = node as NodeRecord;
  const type = record.type as string;

  // MethodDefinition → value는 FunctionExpression
  if (type === 'MethodDefinition') {
    const value = record.value;
    if (isOxcNode(value)) return getBodyStatements(value);
    return [];
  }

  // FunctionDeclaration, FunctionExpression, ArrowFunctionExpression
  if (
    type === 'FunctionDeclaration' ||
    type === 'FunctionExpression' ||
    type === 'ArrowFunctionExpression'
  ) {
    const body = record.body;

    if (!isOxcNode(body)) return [];

    const bodyRecord = body as NodeRecord;

    // BlockStatement → .body 배열
    if ((bodyRecord.type as string) === 'BlockStatement') {
      const stmts = bodyRecord.body;
      if (isOxcNodeArray(stmts)) return stmts;
      return [];
    }

    // ArrowFunction expression body → 단일 statement
    return [body];
  }

  return [];
};
