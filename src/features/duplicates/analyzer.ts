/**
 * 통합 중복 코드 분석기.
 *
 * Level 1: Hash 기반 정규형 매칭 (exact / shape / normalized)
 * Level 2: Anti-unification 상세 분석 + outlier detection
 *
 * 이 파일이 duplicates 피처의 유일한 public 진입점이다.
 */

import type { Node } from 'oxc-parser';

import type { ParsedFile } from '../../engine/types';
import type {
  CloneDiff,
  CloneDiffPair,
  DuplicateCloneType,
  DuplicateFindingKind,
  DuplicateGroup,
  DuplicateItem,
  SourceSpan,
} from '../../types';
import type { InternalCloneGroup, InternalCloneItem } from './types';

import { collectOxcNodes, getNodeHeader } from '../../engine/ast/oxc-ast-utils';
import {
  createOxcFingerprintExact,
  createOxcFingerprintNormalized,
  createOxcFingerprintShape,
} from '../../engine/ast/oxc-fingerprint';
import { countOxcSize } from '../../engine/ast/oxc-size-count';
import { pushToMultiMap } from '../../shared/multi-map';
import { antiUnify, classifyDiff, type AntiUnificationResult } from './anti-unifier';
import { getItemKind, isBelowDecisionFloor, isCloneTarget, isDecisionlessSkeleton, resolveSpan } from './clone-targets';
import { detectFragmentClones } from './fragment-detector';

export { isCloneTarget };

// ─── Public Types ─────────────────────────────────────────────────────────────

interface DuplicatesAnalyzerOptions {
  readonly minSize: number;
  /** anti-unification 활성화 (default: true) */
  readonly enableAntiUnification?: boolean;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * 통합 중복 코드 분석기.
 */
export const analyzeDuplicates = (
  files: ReadonlyArray<ParsedFile>,
  options: DuplicatesAnalyzerOptions,
): ReadonlyArray<DuplicateGroup> => {
  const { minSize } = options;
  // ── Step 2-6: 파일 중복 입력 방어 ─────────────────────────────────────────
  const uniqueFiles = (() => {
    const seenPaths = new Set<string>();

    return files.filter(f => {
      if (seenPaths.has(f.filePath)) {
        return false;
      }

      seenPaths.add(f.filePath);

      return true;
    });
  })();
  // ── Step 2-5: fingerprint 캐시 ─────────────────────────────────────────────
  const cachedExact = createCachedFingerprint(createOxcFingerprintExact);
  const cachedShape = createCachedFingerprint(createOxcFingerprintShape);
  const cachedNormalized = createCachedFingerprint(createOxcFingerprintNormalized);
  // ── Level 1: Hash 기반 그룹핑 ──────────────────────────────────────────────
  const exactGroups = groupByHash(uniqueFiles, cachedExact, 'exact', minSize);
  const shapeGroups = groupByHash(uniqueFiles, cachedShape, 'shape', minSize);
  const normalizedGroups = groupByHash(uniqueFiles, cachedNormalized, 'normalized', minSize);
  // exact에 이미 잡힌 해시는 shape/normalized에서 제외 (중복 보고 방지)
  const exactHashes = new Set(exactGroups.map(g => cachedShape(g.items[0]!.node)));
  const filteredShape = shapeGroups.filter(g => {
    const hash = cachedShape(g.items[0]!.node);

    return !exactHashes.has(hash);
  });
  // shape에 잡힌 해시도 normalized에서 제외
  const shapeHashes = new Set(filteredShape.map(g => cachedNormalized(g.items[0]!.node)));
  const filteredNormalized = normalizedGroups.filter(g => {
    const hash = cachedNormalized(g.items[0]!.node);

    return !exactHashes.has(cachedShape(g.items[0]!.node)) && !shapeHashes.has(hash);
  });
  const grouped: InternalCloneGroup[] = [...exactGroups, ...filteredShape, ...filteredNormalized];

  // ── 결정성 보장: 입력 파일 순서와 무관하게 그룹 내 항목 순서 고정 ─────────
  const allGroups = grouped.map(group => ({ ...group, items: sortItemsDeterministic(group.items) }));

  // ── Level 4: Anti-unification ──────────────────────────────────────────────
  const enableAntiUnification = options.enableAntiUnification ?? true;
  const result: DuplicateGroup[] = [];

  for (const group of allGroups) {
    if (enableAntiUnification && group.items.length >= 2) {
      const outputGroups = applyAntiUnification(group);

      result.push(...outputGroups);
    } else {
      result.push(toDuplicateGroup(group, undefined));
    }
  }

  // ── 함수 내부 연속 문장열(statement run) 클론 ──────────────────────────────
  const fragmentGroups = detectFragmentClones(uniqueFiles, { minSize });

  result.push(...fragmentGroups);

  // ── 규칙 데이터(매핑·룩업 테이블) 클론 ──────────────────────────────────────
  result.push(...detectDataTableClones(uniqueFiles, minSize));

  return filterSubsumedGroups(result);
};

// ─── 규칙 데이터 클론 ─────────────────────────────────────────────────────────

/** 값이 정적(리터럴·정적 객체/배열)인지 — 변수 참조·호출이 있으면 데이터 규칙이 아니다 */
const isStaticValue = (node: Node): boolean => {
  if (node.type === 'Literal') {
    return true;
  }

  // 보간 없는 템플릿 리터럴은 정적 (값이 곧 데이터)
  if (node.type === 'TemplateLiteral') {
    return (node as Node & { readonly expressions: ReadonlyArray<Node> }).expressions.length === 0;
  }

  if (node.type === 'UnaryExpression') {
    const arg = (node as Node & { readonly argument: Node }).argument;

    return arg.type === 'Literal';
  }

  if (node.type === 'ObjectExpression') {
    return (node as Node & { readonly properties: ReadonlyArray<Node> }).properties.every(isStaticProperty);
  }

  if (node.type === 'ArrayExpression') {
    return (node as Node & { readonly elements: ReadonlyArray<Node | null> }).elements.every(isStaticElement);
  }

  return false;
};

const isStaticProperty = (prop: Node): boolean => {
  if (prop.type !== 'Property') {
    return false;
  }

  const p = prop as Node & { readonly computed: boolean; readonly value: Node };

  return !p.computed && isStaticValue(p.value);
};

/** An array element is static when it is present (non-hole) and itself a static value. */
const isStaticElement = (el: Node | null): boolean => el !== null && isStaticValue(el);

const isDataTableDeclarator = (node: Node): boolean => {
  if (node.type !== 'VariableDeclarator') {
    return false;
  }

  const init = (node as Node & { readonly init: Node | null }).init;

  if (init === null) {
    return false;
  }

  // 모든 값이 정적인 매핑/룩업 테이블만 — 계산된 객체(변수 참조 포함)는 데이터 규칙이 아님
  if (init.type === 'ObjectExpression') {
    const props = (init as Node & { readonly properties: ReadonlyArray<Node> }).properties;

    return props.length >= 2 && props.every(isStaticProperty);
  }

  if (init.type === 'ArrayExpression') {
    const elements = (init as Node & { readonly elements: ReadonlyArray<Node | null> }).elements;

    // 룩업 테이블 = 행(row)의 배열. 모든 원소가 구조화된 값(객체·배열 = 행)이어야 한다.
    // 평탄한 스칼라 리스트(['a','b','c'])는 "단일 상수 값의 반복"(redundancy 영역, 비대상)
    // 이지 규칙 데이터가 아니다.
    return (
      elements.length >= 2 &&
      elements.every(el => el !== null && (el.type === 'ObjectExpression' || el.type === 'ArrayExpression') && isStaticElement(el))
    );
  }

  return false;
};

/** 규칙 데이터의 비교 대상 노드: 변수 테이블은 init, enum은 body(멤버 이름+값). 선언 이름은 제외. */
const ruleDataContentNode = (node: Node): Node | null => {
  if (isDataTableDeclarator(node)) {
    return (node as Node & { readonly init: Node }).init;
  }

  // enum = 이름→값 매핑. 멤버 이름·값이 곧 결정이므로 body를 그대로(리터럴 보존) 비교하고
  // enum 자신의 이름은 제외 → 같은 멤버면 이름이 달라도 W, 값이 다르면 K.
  if (node.type === 'TSEnumDeclaration') {
    const body = (node as Node & { readonly body: Node & { readonly members: ReadonlyArray<Node> } }).body;

    return body.members.length >= 2 ? body : null;
  }

  return null;
};

const isRuleDataDeclaration = (node: Node): boolean => ruleDataContentNode(node) !== null;

/**
 * 규칙 데이터(매핑·룩업 테이블·enum)의 중복을 잡는다. 내용이 곧 결정이므로 리터럴을
 * 보존(exact)하여 비교한다 — 같은 내용이면 선언 이름이 달라도 W, 내용이 다르면 K.
 */
const detectDataTableClones = (files: ReadonlyArray<ParsedFile>, minSize: number): DuplicateGroup[] => {
  const map = new Map<string, InternalCloneItem[]>();

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    for (const decl of collectOxcNodes(file.program, isRuleDataDeclaration)) {
      const content = ruleDataContentNode(decl)!;
      const size = countOxcSize(content);

      if (size < minSize) {
        continue;
      }

      const hash = createOxcFingerprintExact(content);
      const item: InternalCloneItem = {
        node: decl,
        kind: 'node',
        header: getNodeHeader(decl),
        filePath: file.filePath,
        span: resolveSpan(file.sourceText, decl),
        size,
      };

      pushToMultiMap(map, hash, item);
    }
  }

  const groups: DuplicateGroup[] = [];

  for (const items of map.values()) {
    if (items.length >= 2) {
      groups.push({
        cloneType: 'exact',
        findingKind: 'exact-clone',
        items: sortItemsDeterministic(items).map(toDuplicateItem),
      });
    }
  }

  return groups;
};

/**
 * 빈 DuplicateGroup 배열을 반환.
 */
export const createEmptyDuplicates = (): ReadonlyArray<DuplicateGroup> => [];

// ─── 결정성 정렬 ─────────────────────────────────────────────────────────────

const sortItemsDeterministic = (items: ReadonlyArray<InternalCloneItem>): ReadonlyArray<InternalCloneItem> =>
  [...items].sort((a, b) => {
    if (a.filePath !== b.filePath) {
      return a.filePath < b.filePath ? -1 : 1;
    }

    if (a.span.start.line !== b.span.start.line) {
      return a.span.start.line - b.span.start.line;
    }

    return a.span.start.column - b.span.start.column;
  });

// ─── 캐시 래퍼 ───────────────────────────────────────────────────────────────

const createCachedFingerprint = (fn: (node: Node) => string): ((node: Node) => string) => {
  const cache = new WeakMap<Node, string>();

  return (node: Node): string => {
    const cached = cache.get(node);

    if (cached !== undefined) {
      return cached;
    }

    const hash = fn(node);

    cache.set(node, hash);

    return hash;
  };
};

// ─── Level 1: Hash 기반 그룹핑 ───────────────────────────────────────────────

const groupByHash = (
  files: ReadonlyArray<ParsedFile>,
  fingerprintFn: (node: Node) => string,
  cloneType: DuplicateCloneType,
  minSize: number,
): InternalCloneGroup[] => {
  const map = new Map<string, InternalCloneItem[]>();

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    // 수집 단계 제외 (둘 다 CLAUDE.md 닫힌 규칙):
    //  1. 골격(결정 없음) — 정규형이 같아도 K (구조 일치 예외)
    //  2. 결정-존재 floor 미만의 익명 인라인 표현식 — 드리프트할 결정을 담기엔 너무 작음
    const nodes = collectOxcNodes(
      file.program,
      node => isCloneTarget(node) && !isDecisionlessSkeleton(node) && !isBelowDecisionFloor(node, minSize),
    );

    for (const node of nodes) {
      // 명명 선언(함수·클래스·타입·계약)은 크기 floor가 없다 — 작은 중복도 주소 지정
      // 가능한 변경지점이므로 잡는다(false negative 방지). 익명 인라인 표현식의 floor는
      // 위 isBelowDecisionFloor가 수집 단계에서 처리한다.
      const size = countOxcSize(node);
      const hash = fingerprintFn(node);
      const span = resolveSpan(file.sourceText, node);
      const header = getNodeHeader(node);
      const item: InternalCloneItem = {
        node,
        kind: getItemKind(node),
        header,
        filePath: file.filePath,
        span,
        size,
      };

      pushToMultiMap(map, hash, item);
    }
  }

  const groups: InternalCloneGroup[] = [];

  for (const items of map.values()) {
    if (items.length >= 2) {
      groups.push({ cloneType, items });
    }
  }

  return groups;
};

// ─── Level 4: Anti-unification 적용 ──────────────────────────────────────────

const deriveSuggestedParams = (
  classifications: DiffClassification[],
  auResults: ReadonlyArray<{ idx: number; result: AntiUnificationResult }>,
): { params: CloneDiff | undefined; findingKindOverride: DuplicateFindingKind | undefined } => {
  const allRenameOnly = classifications.every(c => c === 'rename-only');
  const allLiteralVariant = classifications.every(c => c === 'literal-variant');
  const allTypeVariant = classifications.every(c => c === 'type-variant');
  let params: CloneDiff | undefined;
  let findingKindOverride: DuplicateFindingKind | undefined;

  if (allRenameOnly && auResults.length > 0) {
    params = buildCloneDiff('identifier', auResults[0]!.result);
  } else if (allLiteralVariant && auResults.length > 0) {
    params = buildCloneDiff('literal', auResults[0]!.result);
    findingKindOverride = 'literal-variant';
  } else if (allTypeVariant && auResults.length > 0) {
    params = buildCloneDiff('type', auResults[0]!.result);
  }

  return { params, findingKindOverride };
};

type DiffClassification = ReturnType<typeof classifyDiff>;

const applyAntiUnification = (group: InternalCloneGroup): DuplicateGroup[] => {
  const { items } = group;
  // representative: AST 노드 수가 median에 가장 가까운 멤버
  const sizes = items.map(item => item.size);
  const sorted = [...sizes].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const repIdx = sizes.reduce((best, size, idx) => (Math.abs(size - median) < Math.abs(sizes[best]! - median) ? idx : best), 0);
  const representative = items[repIdx]!;
  // 각 멤버(≠ representative)에 anti-unify
  const auResults: Array<{ idx: number; result: AntiUnificationResult }> = [];

  for (let i = 0; i < items.length; i++) {
    if (i === repIdx) {
      continue;
    }

    const result = antiUnify(representative.node, items[i]!.node);

    auResults.push({ idx: i, result });
  }

  if (auResults.length === 0) {
    return [toDuplicateGroup(group, undefined)];
  }

  // 같은 정규형(L1 해시)으로 묶인 멤버는 모두 같은 구조적 결정 → 하나의 그룹으로 보고한다.
  // (과거의 통계적 outlier 분리(mean+2σ)는 임계 기반이라 닫힌 규칙을 위반 — 제거됨.)
  const classifications = auResults.map(({ result }) => classifyDiff(result));
  const { params: suggestedParams, findingKindOverride } = deriveSuggestedParams(classifications, auResults);

  return [toDuplicateGroup(group, suggestedParams, findingKindOverride)];
};

const buildCloneDiff = (kind: CloneDiff['kind'], auResult: AntiUnificationResult): CloneDiff => {
  const pairs: CloneDiffPair[] = auResult.variables
    .filter(v => v.kind === kind)
    .map(v => ({
      left: v.leftType,
      right: v.rightType,
      location: v.location,
    }));

  return { kind, pairs };
};

// ─── findingKind 매핑 ─────────────────────────────────────────────────────────

const cloneTypeToFindingKind = (cloneType: DuplicateCloneType): DuplicateFindingKind => {
  switch (cloneType) {
    case 'exact':
      return 'exact-clone';
    case 'shape':
    case 'normalized':
      return 'structural-clone';
    case 'fragment':
      return 'fragment-clone';
  }
};

// ─── 변환 ─────────────────────────────────────────────────────────────────────

const toDuplicateGroup = (
  group: InternalCloneGroup,
  suggestedParams: CloneDiff | undefined,
  findingKindOverride?: DuplicateFindingKind,
): DuplicateGroup => ({
  cloneType: group.cloneType,
  findingKind: findingKindOverride ?? group.findingKind ?? cloneTypeToFindingKind(group.cloneType),
  items: group.items.map(toDuplicateItem),
  ...(suggestedParams !== undefined ? { suggestedParams } : {}),
});

const toDuplicateItem = (item: InternalCloneItem): DuplicateItem => ({
  kind: item.kind,
  header: item.header,
  filePath: item.filePath,
  span: item.span,
});

// ─── 중첩 그룹 필터링 (H-2) ──────────────────────────────────────────────────

const isSpanContained = (inner: SourceSpan, outer: SourceSpan): boolean =>
  (inner.start.line > outer.start.line || (inner.start.line === outer.start.line && inner.start.column >= outer.start.column)) &&
  (inner.end.line < outer.end.line || (inner.end.line === outer.end.line && inner.end.column <= outer.end.column));

const CLONE_TYPE_PRIORITY: Readonly<Record<DuplicateCloneType, number>> = {
  exact: 0,
  shape: 1,
  normalized: 2,
  fragment: 3,
};

const buildSpanIndex = (items: ReadonlyArray<DuplicateItem>): Map<string, ReadonlyArray<DuplicateItem>> => {
  const index = new Map<string, DuplicateItem[]>();

  for (const item of items) {
    const existing = index.get(item.filePath);

    if (existing !== undefined) {
      existing.push(item);
    } else {
      index.set(item.filePath, [item]);
    }
  }

  return index;
};

const filterSubsumedGroups = (groups: DuplicateGroup[]): DuplicateGroup[] => {
  const parentIndices = groups.map(g => buildSpanIndex(g.items));

  return groups.filter(
    (child, childIdx) =>
      !groups.some((parent, parentIdx) => {
        if (childIdx === parentIdx) {
          return false;
        }

        // 같은 tier 안에서만 item 수 가드 — 상위 tier(선언)는 item 1개가 하위 tier(fragment)
        // item 여러 개를 공간적으로 포함할 수 있으므로 수 비교로 막지 않는다.
        if (parent.cloneType === child.cloneType && parent.items.length < child.items.length) {
          return false;
        }

        // 덜 구체적인 그룹이 더 구체적인 그룹을 subsume하면 안 됨
        if (CLONE_TYPE_PRIORITY[parent.cloneType] > CLONE_TYPE_PRIORITY[child.cloneType]) {
          return false;
        }

        const parentIndex = parentIndices[parentIdx]!;

        return child.items.every(childItem => {
          const sameFileItems = parentIndex.get(childItem.filePath);

          if (sameFileItems === undefined) {
            return false;
          }

          return sameFileItems.some(parentItem => isSpanContained(childItem.span, parentItem.span));
        });
      }),
  );
};
