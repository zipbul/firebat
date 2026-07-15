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

import { visitorKeys } from 'oxc-parser';

import { asRecord, collectBindingNames, countOxcSize, createOxcFingerprintShapeWithBindings, isOxcNode } from '../../engine/ast';
import { isNonNull } from '../../shared';
import { computeLcsAlignment } from './lcs';

// ─── Public Types ─────────────────────────────────────────────────────────────

interface AntiUnificationVariable {
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

export type DiffClassification = 'rename-only' | 'literal-variant' | 'type-variant' | 'structural-diff' | 'mixed';

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * 두 AST 노드의 anti-unification을 수행한다.
 *
 * - 같은 type → 재귀적 자식 비교
 * - 다른 type → 변수(차이점) 생성
 * - 배열 자식 → LCS 정렬 후 매칭된 쌍만 재귀, 미매칭은 structural variable
 */
export const antiUnify = (left: Node, right: Node): AntiUnificationResult => {
  const leftSize = countOxcSize(left);
  const rightSize = countOxcSize(right);
  const boundNames = new Set<string>([...collectBindingNames(left), ...collectBindingNames(right)]);
  const ctx: TraversalContext = {
    variables: [],
    sharedSize: 0,
    nextId: 1,
    boundNames,
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
 * - variables 없음 → 'rename-only' (완전 동일 구조 포함 — 차이점이 없으면 rename 불필요)
 * - 모든 kind가 'identifier' → 'rename-only'
 * - 모든 kind가 'literal' → 'literal-variant'
 * - 모든 kind가 'type' → 'type-variant'
 * - 'structural' kind가 하나라도 → 'structural-diff'
 * - 그 외 (identifier+literal 혼합 등) → 'mixed'
 */
export const classifyDiff = (result: AntiUnificationResult): DiffClassification => {
  const { variables } = result;

  if (variables.length === 0) {
    return 'rename-only';
  }

  let hasIdentifier = false;
  let hasLiteral = false;
  let hasStructural = false;
  let hasType = false;

  for (const v of variables) {
    if (v.kind === 'identifier') {
      hasIdentifier = true;
    } else if (v.kind === 'literal') {
      hasLiteral = true;
    } else if (v.kind === 'structural') {
      hasStructural = true;
    } else if (v.kind === 'type') {
      hasType = true;
    }
  }

  if (hasStructural) {
    return 'structural-diff';
  }

  if (hasIdentifier && !hasLiteral && !hasType) {
    return 'rename-only';
  }

  if (hasLiteral && !hasIdentifier && !hasType) {
    return 'literal-variant';
  }

  if (hasType && !hasIdentifier && !hasLiteral && !hasStructural) {
    return 'type-variant';
  }

  return 'mixed';
};

// ─── Internal ─────────────────────────────────────────────────────────────────

interface TraversalContext {
  variables: AntiUnificationVariable[];
  sharedSize: number;
  nextId: number;
  /** 비교 단위 전체(좌+우)의 바인딩 이름 — sub-node 정렬 시 enclosing 스코프 보존용 */
  boundNames: ReadonlySet<string>;
}

/** 메타/positional 키 — 비교에서 제외 */
const SKIP_KEYS = new Set(['type', 'start', 'end', 'loc', 'span', 'comments', 'raw', 'directive']);

/** Build a dotted child path: append `.key` to a non-empty parent path, else use `key` alone. */
const childPathOf = (path: string, key: string): string => (path.length > 0 ? `${path}.${key}` : key);

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

const traverse = (ctx: TraversalContext, left: Node, right: Node, path: string): void => {
  // type이 다르면 → structural variable
  if (left.type !== right.type) {
    pushVariable(ctx, path, left.type, right.type, 'structural');

    return;
  }

  // 같은 type → shared node
  ctx.sharedSize += 1;

  // Identifier.name 비교
  if (left.type === 'Identifier' && right.type === 'Identifier') {
    const leftName = left.name;
    const rightName = right.name;

    if (leftName !== rightName) {
      pushVariable(ctx, path + '.name', leftName, rightName, 'identifier');
    }
    // 자식 노드(typeAnnotation 등)는 아래 일반 순회에서 처리
  }

  // Literal.value 비교
  if (left.type === 'Literal' && right.type === 'Literal') {
    const leftVal = left.value;
    const rightVal = right.value;

    if (leftVal !== rightVal) {
      pushVariable(ctx, path + '.value', String(leftVal), String(rightVal), 'literal');
    }
    // 자식 노드는 아래 일반 순회에서 처리
  }

  // TSTypeReference 비교 (type annotation 차이)
  if (left.type === 'TSTypeReference') {
    const leftFp = createOxcFingerprintShapeWithBindings(left, ctx.boundNames);
    const rightFp = createOxcFingerprintShapeWithBindings(right, ctx.boundNames);

    if (leftFp !== rightFp) {
      pushVariable(ctx, path, left.type, right.type, 'type');
    } else {
      ctx.sharedSize += countOxcSize(left) - 1;
    }

    return;
  }

  const leftRec = asRecord(left);
  const rightRec = asRecord(right);
  // visitorKeys 기반 자식 노드 순회
  const keys = visitorKeys[left.type];

  if (keys !== undefined) {
    for (const key of keys) {
      if (SKIP_KEYS.has(key)) {
        continue;
      }

      const leftChild = leftRec[key];
      const rightChild = rightRec[key];
      const childPath = childPathOf(path, key);

      // 한쪽에만 키가 있는 경우 (optional node properties)
      if (leftChild === undefined && rightChild !== undefined) {
        pushVariable(ctx, childPath, 'undefined', isOxcNode(rightChild) ? rightChild.type : String(rightChild), 'structural');

        continue;
      }

      if (leftChild !== undefined && rightChild === undefined) {
        pushVariable(ctx, childPath, isOxcNode(leftChild) ? leftChild.type : String(leftChild), 'undefined', 'structural');

        continue;
      }

      if (leftChild === undefined && rightChild === undefined) {
        continue;
      }

      // 둘 다 Node 배열인 경우 → LCS 정렬
      if (Array.isArray(leftChild) && Array.isArray(rightChild)) {
        traverseArrayChildren(ctx, leftChild as ReadonlyArray<Node>, rightChild as ReadonlyArray<Node>, childPath);

        continue;
      }

      // 둘 다 Node인 경우 → 재귀
      if (isOxcNode(leftChild) && isOxcNode(rightChild)) {
        traverse(ctx, leftChild, rightChild, childPath);
      }
    }
  }

  // visitorKeys에 포함되지 않는 프리미티브 필드 비교 (operator, kind 등)
  // Identifier.name, Literal.value/raw는 위에서 이미 처리됨 → skip
  for (const key of Object.keys(leftRec)) {
    if (SKIP_KEYS.has(key)) {
      continue;
    }

    if (keys !== undefined && keys.includes(key)) {
      continue;
    } // 이미 처리한 노드 자식

    if (key === 'name' && left.type === 'Identifier') {
      continue;
    }

    if ((key === 'value' || key === 'raw') && left.type === 'Literal') {
      continue;
    }

    const leftVal = leftRec[key];
    const rightVal = rightRec[key];

    // 프리미티브가 아닌 값(object/array) 은 건너뜀
    if (typeof leftVal === 'object' || typeof rightVal === 'object') {
      continue;
    }

    if (leftVal !== rightVal) {
      const childPath = childPathOf(path, key);

      if (key === 'name') {
        pushVariable(ctx, childPath, String(leftVal), String(rightVal), 'identifier');
      } else if (key === 'value') {
        pushVariable(ctx, childPath, String(leftVal), String(rightVal), 'literal');
      } else {
        // operator, kind 등 구조적 차이
        pushVariable(ctx, childPath, String(leftVal), String(rightVal), 'structural');
      }
    }
  }
};

/**
 * 배열 자식을 LCS 정렬 후 매칭된 쌍은 재귀, 미매칭은 structural variable.
 */
const traverseArrayChildren = (
  ctx: TraversalContext,
  leftArr: ReadonlyArray<Node>,
  rightArr: ReadonlyArray<Node>,
  path: string,
): void => {
  // Filter out null entries (e.g. ArrayPattern.elements may contain null for holes)
  const leftFiltered = leftArr.filter(isNonNull);
  const rightFiltered = rightArr.filter(isNonNull);

  // fingerprint로 LCS 정렬
  const fingerprintOf = (n: Node) => createOxcFingerprintShapeWithBindings(n, ctx.boundNames);

  const leftFps = leftFiltered.map(fingerprintOf);
  const rightFps = rightFiltered.map(fingerprintOf);
  const alignment = computeLcsAlignment(leftFps, rightFps);

  // 매칭된 쌍 → 재귀
  for (const { aIndex, bIndex } of alignment.matched) {
    const leftChild = leftFiltered[aIndex]!;
    const rightChild = rightFiltered[bIndex]!;

    traverse(ctx, leftChild, rightChild, `${path}[${aIndex}]`);
  }

  // A에만 있는 노드 → structural variable
  for (const aIdx of alignment.aOnly) {
    const child = leftFiltered[aIdx];

    pushVariable(ctx, `${path}[${aIdx}]`, child !== undefined ? child.type : 'unknown', 'missing', 'structural');
  }

  // B에만 있는 노드 → structural variable
  for (const bIdx of alignment.bOnly) {
    const child = rightFiltered[bIdx];

    pushVariable(ctx, `${path}[+${bIdx}]`, 'missing', child !== undefined ? child.type : 'unknown', 'structural');
  }
};
