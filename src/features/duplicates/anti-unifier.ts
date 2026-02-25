/**
 * Plotkin's Anti-unification 알고리즘 구현.
 *
 * 두 AST 노드의 "최대공통일반화(least general generalization)"를 구한다.
 * 공유 구조와 차이점(변수)을 모두 추출하여 클론 쌍의 정확한 분류를 지원한다.
 *
 * 알고리즘 복잡도: O(|T₁| + |T₂|) — 배열 자식에 LCS 정렬이 필요하면 추가 비용.
 *
 * 참고: Plotkin (1970), Bulychev & Minea (2008) "Duplicate Code Detection Using Anti-Unification"
 */

import type { Node } from 'oxc-parser';

import type { NodeRecord, NodeValue } from '../../engine/types';

import { isNodeRecord, isOxcNode, isOxcNodeArray } from '../../engine/ast/oxc-ast-utils';
import { createOxcFingerprintShape } from '../../engine/ast/oxc-fingerprint';
import { countOxcSize } from '../../engine/ast/oxc-size-count';
import { computeLcsAlignment } from './lcs';

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface AntiUnificationVariable {
  readonly id: number;
  /** dotpath — 예: "body.body[0].consequent.body[2]" */
  readonly location: string;
  readonly leftType: string;
  readonly rightType: string;
  readonly kind: 'identifier' | 'literal' | 'type' | 'structural';
}

export interface AntiUnificationResult {
  readonly sharedSize: number;
  readonly leftSize: number;
  readonly rightSize: number;
  /** sharedSize / max(leftSize, rightSize). 1이면 구조 동일. */
  readonly similarity: number;
  readonly variables: ReadonlyArray<AntiUnificationVariable>;
}

export type DiffClassification =
  | 'rename-only'
  | 'literal-variant'
  | 'structural-diff'
  | 'mixed';

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * 두 AST 노드의 anti-unification을 수행한다.
 *
 * - 같은 type → 재귀적 자식 비교
 * - 다른 type → 변수(차이점) 생성
 * - 배열 자식 → LCS 정렬 후 매칭된 쌍만 재귀, 미매칭은 structural variable
 */
export const antiUnify = (
  left: Node,
  right: Node,
): AntiUnificationResult => {
  const leftSize = countOxcSize(left);
  const rightSize = countOxcSize(right);

  const ctx: TraversalContext = {
    variables: [],
    sharedSize: 0,
    nextId: 1,
  };

  traverse(ctx, left, right, '');

  const maxSize = Math.max(leftSize, rightSize);
  const similarity = maxSize === 0 ? 1 : ctx.sharedSize / maxSize;

  return {
    sharedSize: ctx.sharedSize,
    leftSize,
    rightSize,
    similarity,
    variables: ctx.variables,
  };
};

/**
 * anti-unification 결과의 diff를 분류한다.
 *
 * - variables 없음 → 'rename-only' (완전 동일 포함)
 * - 모든 kind가 'identifier' → 'rename-only'
 * - 모든 kind가 'literal' → 'literal-variant'
 * - 'structural' kind가 하나라도 → 'structural-diff'
 * - 그 외 (identifier+literal 혼합, type 포함 등) → 'mixed'
 */
export const classifyDiff = (
  result: AntiUnificationResult,
): DiffClassification => {
  const { variables } = result;

  if (variables.length === 0) return 'rename-only';

  let hasIdentifier = false;
  let hasLiteral = false;
  let hasStructural = false;
  let hasType = false;

  for (const v of variables) {
    if (v.kind === 'identifier') hasIdentifier = true;
    else if (v.kind === 'literal') hasLiteral = true;
    else if (v.kind === 'structural') hasStructural = true;
    else if (v.kind === 'type') hasType = true;
  }

  if (hasStructural) return 'structural-diff';
  if (hasIdentifier && !hasLiteral && !hasType) return 'rename-only';
  if (hasLiteral && !hasIdentifier && !hasType) return 'literal-variant';

  return 'mixed';
};

// ─── Internal ─────────────────────────────────────────────────────────────────

interface TraversalContext {
  variables: AntiUnificationVariable[];
  sharedSize: number;
  nextId: number;
}

/** 메타/positional 키 — 비교에서 제외 */
const SKIP_KEYS = new Set(['type', 'start', 'end', 'loc', 'span', 'comments', 'raw', 'directive']);

const pushVariable = (
  ctx: TraversalContext,
  location: string,
  leftType: string,
  rightType: string,
  kind: AntiUnificationVariable['kind'],
): void => {
  ctx.variables.push({
    id: ctx.nextId++,
    location,
    leftType,
    rightType,
    kind,
  });
};

const traverse = (
  ctx: TraversalContext,
  left: NodeValue,
  right: NodeValue,
  path: string,
): void => {
  // 둘 다 Node인 경우
  if (isOxcNode(left) && isOxcNode(right)) {
    const leftNode = left as Node;
    const rightNode = right as Node;

    // type이 다르면 → structural variable
    if (leftNode.type !== rightNode.type) {
      pushVariable(ctx, path, leftNode.type, rightNode.type, 'structural');
      return;
    }

    // 같은 type → shared node
    ctx.sharedSize += 1;

    // Identifier.name 비교
    if (leftNode.type === 'Identifier') {
      const leftName = (leftNode as unknown as { name: string }).name;
      const rightName = (rightNode as unknown as { name: string }).name;
      if (leftName !== rightName) {
        pushVariable(ctx, path + '.name', leftName, rightName, 'identifier');
      }
      // 자식 노드(typeAnnotation 등)는 아래 일반 순회에서 처리
    }

    // Literal.value 비교
    if (leftNode.type === 'Literal') {
      const leftVal = (leftNode as unknown as { value: unknown }).value;
      const rightVal = (rightNode as unknown as { value: unknown }).value;
      if (leftVal !== rightVal) {
        pushVariable(
          ctx,
          path + '.value',
          String(leftVal),
          String(rightVal),
          'literal',
        );
      }
      // 자식 노드는 아래 일반 순회에서 처리
    }

    // TSTypeReference 비교 (type annotation 차이)
    if (leftNode.type === 'TSTypeReference') {
      const leftFp = createOxcFingerprintShape(leftNode);
      const rightFp = createOxcFingerprintShape(rightNode);
      if (leftFp !== rightFp) {
        pushVariable(ctx, path, leftNode.type, rightNode.type, 'type');
      }
      return;
    }

    // Record로 변환 가능해야 자식 순회
    if (!isNodeRecord(leftNode) || !isNodeRecord(rightNode)) return;

    const leftRec = leftNode as NodeRecord;
    const rightRec = rightNode as NodeRecord;

    // 정렬된 키로 자식 순회
    const leftKeys = Object.keys(leftRec).filter((k) => !SKIP_KEYS.has(k)).sort();
    const rightKeys = Object.keys(rightRec).filter((k) => !SKIP_KEYS.has(k)).sort();

    // 양쪽 모두에 있는 키들만 비교
    const allKeys = new Set([...leftKeys, ...rightKeys]);

    for (const key of allKeys) {
      const leftChild = leftRec[key];
      const rightChild = rightRec[key];
      const childPath = path.length > 0 ? `${path}.${key}` : key;

      // 한쪽에만 키가 있는 경우
      if (leftChild === undefined && rightChild !== undefined) {
        pushVariable(ctx, childPath, 'undefined', describeValue(rightChild), 'structural');
        continue;
      }
      if (leftChild !== undefined && rightChild === undefined) {
        pushVariable(ctx, childPath, describeValue(leftChild), 'undefined', 'structural');
        continue;
      }
      if (leftChild === undefined && rightChild === undefined) continue;

      // 둘 다 Node 배열인 경우 → LCS 정렬
      if (isOxcNodeArray(leftChild) && isOxcNodeArray(rightChild)) {
        traverseArrayChildren(ctx, leftChild, rightChild, childPath);
        continue;
      }

      // 둘 다 Node인 경우 → 재귀
      if (isOxcNode(leftChild) && isOxcNode(rightChild)) {
        traverse(ctx, leftChild, rightChild, childPath);
        continue;
      }

      // 프리미티브 값 비교 (operator 등)
      // Identifier.name과 Literal.value/raw는 위에서 이미 처리됨 → skip
      if (key === 'name' && leftNode.type === 'Identifier') continue;
      if ((key === 'value' || key === 'raw') && leftNode.type === 'Literal') continue;

      if (leftChild !== rightChild) {
        if (key === 'name') {
          pushVariable(ctx, childPath, String(leftChild), String(rightChild), 'identifier');
        } else if (key === 'value') {
          pushVariable(ctx, childPath, String(leftChild), String(rightChild), 'literal');
        } else {
          // operator, kind 등 구조적 차이
          pushVariable(ctx, childPath, String(leftChild), String(rightChild), 'structural');
        }
      }
    }

    return;
  }

  // 둘 다 배열인 경우 (top-level에서는 드물지만 방어적)
  if (isOxcNodeArray(left) && isOxcNodeArray(right)) {
    traverseArrayChildren(ctx, left, right, path);
    return;
  }

  // 프리미티브 또는 타입 불일치
  if (left !== right) {
    pushVariable(ctx, path, describeValue(left), describeValue(right), 'structural');
  }
};

/**
 * 배열 자식을 LCS 정렬 후 매칭된 쌍은 재귀, 미매칭은 structural variable.
 */
const traverseArrayChildren = (
  ctx: TraversalContext,
  leftArr: ReadonlyArray<NodeValue>,
  rightArr: ReadonlyArray<NodeValue>,
  path: string,
): void => {
  // fingerprint로 LCS 정렬
  const leftFps = leftArr.map((n) => (isOxcNode(n) ? createOxcFingerprintShape(n) : String(n)));
  const rightFps = rightArr.map((n) => (isOxcNode(n) ? createOxcFingerprintShape(n) : String(n)));

  const alignment = computeLcsAlignment(leftFps, rightFps);

  // 매칭된 쌍 → 재귀
  for (const { aIndex, bIndex } of alignment.matched) {
    const leftChild = leftArr[aIndex]!;
    const rightChild = rightArr[bIndex]!;
    traverse(ctx, leftChild, rightChild, `${path}[${aIndex}]`);
  }

  // A에만 있는 노드 → structural variable
  for (const aIdx of alignment.aOnly) {
    const child = leftArr[aIdx];
    pushVariable(
      ctx,
      `${path}[${aIdx}]`,
      isOxcNode(child) ? (child as Node).type : 'unknown',
      'missing',
      'structural',
    );
  }

  // B에만 있는 노드 → structural variable
  for (const bIdx of alignment.bOnly) {
    const child = rightArr[bIdx];
    pushVariable(
      ctx,
      `${path}[+${bIdx}]`,
      'missing',
      isOxcNode(child) ? (child as Node).type : 'unknown',
      'structural',
    );
  }
};

const describeValue = (val: NodeValue): string => {
  if (val === null) return 'null';
  if (val === undefined) return 'undefined';
  if (isOxcNode(val)) return (val as Node).type;
  if (Array.isArray(val)) return `Array(${val.length})`;
  return typeof val;
};
