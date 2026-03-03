/**
 * 통합 중복 코드 분석기.
 *
 * Level 1: Hash 기반 정확 매칭 (인라인)
 * Level 2+3: MinHash/LSH pre-filter + LCS 유사도 검증
 * Level 4: Anti-unification 상세 분석 + outlier detection
 *
 * 이 파일이 duplicates 피처의 유일한 public 진입점이다.
 */

import type { Node } from 'oxc-parser';

import type {
  CloneDiff,
  CloneDiffPair,
  DuplicateCloneType,
  DuplicateFindingKind,
  DuplicateGroup,
  DuplicateItem,
  SourceSpan,
} from '../../types';
import type { ParsedFile } from '../../engine/types';
import type { InternalCloneGroup, InternalCloneItem } from './types';

import { collectOxcNodes, getNodeHeader } from '../../engine/ast/oxc-ast-utils';
import { countOxcSize } from '../../engine/ast/oxc-size-count';
import {
  createOxcFingerprintExact,
  createOxcFingerprintNormalized,
  createOxcFingerprintShape,
} from '../../engine/ast/oxc-fingerprint';
import { antiUnify, classifyDiff, type AntiUnificationResult } from './anti-unifier';
import { getItemKind, isCloneTarget, resolveSpan } from './clone-targets';
import { detectNearMissClones, type NearMissDetectorOptions } from './near-miss-detector';

export { isCloneTarget };

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface DuplicatesAnalyzerOptions {
  readonly minSize: number;
  /** LCS 유사도 임계값 (default: 0.7) */
  readonly nearMissSimilarityThreshold?: number;
  /** near-miss 탐지 활성화 (default: true) */
  readonly enableNearMiss?: boolean;
  /** anti-unification 활성화 (default: true) */
  readonly enableAntiUnification?: boolean;
  /** MinHash 최소 statement 수 (default: 5) */
  readonly minStatementCount?: number;
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
  const enableNearMiss = options.enableNearMiss ?? true;
  const enableAntiUnification = options.enableAntiUnification ?? true;

  // ── Step 2-6: 파일 중복 입력 방어 ─────────────────────────────────────────

  const seenPaths = new Set<string>();
  const uniqueFiles = files.filter((f) => {
    if (seenPaths.has(f.filePath)) return false;
    seenPaths.add(f.filePath);
    return true;
  });

  // ── Step 2-5: fingerprint 캐시 ─────────────────────────────────────────────

  const cachedExact = createCachedFingerprint(createOxcFingerprintExact);
  const cachedShape = createCachedFingerprint(createOxcFingerprintShape);
  const cachedNormalized = createCachedFingerprint(createOxcFingerprintNormalized);

  // ── Level 1: Hash 기반 그룹핑 ──────────────────────────────────────────────

  const exactGroups = groupByHash(uniqueFiles, minSize, cachedExact, 'exact');
  const shapeGroups = groupByHash(uniqueFiles, minSize, cachedShape, 'shape');
  const normalizedGroups = groupByHash(uniqueFiles, minSize, cachedNormalized, 'normalized');

  // exact에 이미 잡힌 해시는 shape/normalized에서 제외 (중복 보고 방지)
  const exactHashes = new Set(exactGroups.map((g) => cachedShape(g.items[0]!.node)));

  const filteredShape = shapeGroups.filter((g) => {
    const hash = cachedShape(g.items[0]!.node);
    return !exactHashes.has(hash);
  });

  // shape에 잡힌 해시도 normalized에서 제외
  const shapeHashes = new Set(filteredShape.map((g) => cachedNormalized(g.items[0]!.node)));

  const filteredNormalized = normalizedGroups.filter((g) => {
    const hash = cachedNormalized(g.items[0]!.node);
    return !exactHashes.has(cachedShape(g.items[0]!.node)) && !shapeHashes.has(hash);
  });

  let allGroups: InternalCloneGroup[] = [...exactGroups, ...filteredShape, ...filteredNormalized];

  // ── Level 2+3: Near-miss clone detection ───────────────────────────────────

  if (enableNearMiss) {
    // Level 1에서 그룹핑된 모든 노드의 shape hash → excluded
    const excludedHashes = new Set<string>();
    for (const group of allGroups) {
      for (const item of group.items) {
        excludedHashes.add(cachedShape(item.node));
      }
    }

    const nearMissOpts: NearMissDetectorOptions = {
      minSize,
      similarityThreshold: options.nearMissSimilarityThreshold ?? 0.7,
      jaccardThreshold: 0.5,
      minHashK: 128,
      sizeRatio: 0.5,
      minStatementCount: options.minStatementCount ?? 5,
    };

    const nearMissGroups = detectNearMissClones(uniqueFiles, nearMissOpts, excludedHashes);

    for (const nmGroup of nearMissGroups) {
      allGroups.push({
        cloneType: 'near-miss',
        items: nmGroup.items.map((nmItem) => ({
          node: nmItem.node,
          kind: nmItem.kind,
          header: nmItem.header,
          filePath: nmItem.filePath,
          span: nmItem.span,
          size: nmItem.size,
        })),
        similarity: nmGroup.similarity,
      });
    }
  }

  // ── Level 4: Anti-unification ──────────────────────────────────────────────

  const result: DuplicateGroup[] = [];

  for (const group of allGroups) {
    if (enableAntiUnification && group.items.length >= 2) {
      const outputGroups = applyAntiUnification(group);
      result.push(...outputGroups);
    } else {
      result.push(toDuplicateGroup(group, undefined));
    }
  }

  return filterSubsumedGroups(result);
};

/**
 * 빈 DuplicateGroup 배열을 반환.
 */
export const createEmptyDuplicates = (): ReadonlyArray<DuplicateGroup> => [];

// ─── 캐시 래퍼 ───────────────────────────────────────────────────────────────

const createCachedFingerprint = (fn: (node: Node) => string): ((node: Node) => string) => {
  const cache = new WeakMap<Node, string>();
  return (node: Node): string => {
    const cached = cache.get(node);
    if (cached !== undefined) return cached;
    const hash = fn(node);
    cache.set(node, hash);
    return hash;
  };
};

// ─── Level 1: Hash 기반 그룹핑 ───────────────────────────────────────────────

const groupByHash = (
  files: ReadonlyArray<ParsedFile>,
  minSize: number,
  fingerprintFn: (node: Node) => string,
  cloneType: DuplicateCloneType,
): InternalCloneGroup[] => {
  const map = new Map<string, InternalCloneItem[]>();

  for (const file of files) {
    if (file.errors.length > 0) continue;

    const nodes = collectOxcNodes(file.program, isCloneTarget);

    for (const node of nodes) {
      const size = countOxcSize(node);
      if (size < minSize) continue;

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

      const list = map.get(hash);
      if (list === undefined) {
        map.set(hash, [item]);
      } else {
        list.push(item);
      }
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
  const allRenameOnly = classifications.every((c) => c === 'rename-only');
  const allLiteralVariant = classifications.every((c) => c === 'literal-variant');
  const allTypeVariant = classifications.every((c) => c === 'type-variant');

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
  const sizes = items.map((item) => item.size);
  const sorted = [...sizes].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const repIdx = sizes.reduce((best, size, idx) =>
    Math.abs(size - median) < Math.abs(sizes[best]! - median) ? idx : best, 0);
  const representative = items[repIdx]!;

  // 각 멤버(≠ representative)에 anti-unify
  const auResults: Array<{ idx: number; result: AntiUnificationResult }> = [];

  for (let i = 0; i < items.length; i++) {
    if (i === repIdx) continue;
    const result = antiUnify(representative.node, items[i]!.node);
    auResults.push({ idx: i, result });
  }

  if (auResults.length === 0) {
    return [toDuplicateGroup(group, undefined)];
  }

  // ── Outlier detection (3+ 멤버 그룹만) ──────────────────────────────────────

  if (items.length >= 3) {
    const varCounts = auResults.map(({ result }) => result.variables.length);
    const mean = varCounts.reduce((s, v) => s + v, 0) / varCounts.length;
    const stdDev = Math.sqrt(varCounts.reduce((s, v) => s + (v - mean) ** 2, 0) / varCounts.length);
    const threshold = mean + 2 * stdDev;

    const outlierAuIndices = auResults
      .map(({ idx, result }, auIdx) => ({ auIdx, idx, varCount: result.variables.length }))
      .filter(({ varCount }) => varCount > threshold);

    if (outlierAuIndices.length > 0 && outlierAuIndices.length < items.length - 1) {
      const outlierItemIndices = new Set(outlierAuIndices.map(({ idx }) => idx));
      const coreItems = items.filter((_, i) => i === repIdx || !outlierItemIndices.has(i));
      const outlierItems = items.filter((_, i) => outlierItemIndices.has(i));

      const results: DuplicateGroup[] = [];

      // core group
      if (coreItems.length >= 2) {
        const coreGroup: InternalCloneGroup = { ...group, items: coreItems };
        const coreAuResults = auResults.filter(({ idx }) => !outlierItemIndices.has(idx));
        const coreClassifications = coreAuResults.map(({ result }) => classifyDiff(result));
        const { params, findingKindOverride } = deriveSuggestedParams(coreClassifications, coreAuResults);
        results.push(toDuplicateGroup(coreGroup, params, findingKindOverride));
      }

      // outlier group
      if (outlierItems.length >= 1) {
        const outlierGroup: InternalCloneGroup = {
          cloneType: group.cloneType,
          items: outlierItems,
          findingKind: 'pattern-outlier',
        };
        results.push(toDuplicateGroup(outlierGroup, undefined));
      }

      return results;
    }
  }

  // ── 기존 diff 분류 로직 ──────────────────────────────────────────────────────

  const classifications = auResults.map(({ result }) => classifyDiff(result));
  const { params: suggestedParams, findingKindOverride } = deriveSuggestedParams(classifications, auResults);

  return [toDuplicateGroup(group, suggestedParams, findingKindOverride)];
};

const buildCloneDiff = (
  kind: CloneDiff['kind'],
  auResult: AntiUnificationResult,
): CloneDiff => {
  const pairs: CloneDiffPair[] = auResult.variables
    .filter((v) => v.kind === kind)
    .map((v) => ({
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
    case 'near-miss':
      return 'near-miss-clone';
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
  ...(group.similarity !== undefined ? { similarity: group.similarity } : {}),
});

const toDuplicateItem = (item: InternalCloneItem): DuplicateItem => ({
  kind: item.kind,
  header: item.header,
  filePath: item.filePath,
  span: item.span,
});

// ─── 중첩 그룹 필터링 (H-2) ──────────────────────────────────────────────────

const isSpanContained = (inner: SourceSpan, outer: SourceSpan): boolean =>
  (inner.start.line > outer.start.line ||
    (inner.start.line === outer.start.line && inner.start.column >= outer.start.column)) &&
  (inner.end.line < outer.end.line ||
    (inner.end.line === outer.end.line && inner.end.column <= outer.end.column));

const CLONE_TYPE_PRIORITY: Readonly<Record<DuplicateCloneType, number>> = {
  exact: 0,
  shape: 1,
  normalized: 2,
  'near-miss': 3,
};

const filterSubsumedGroups = (groups: DuplicateGroup[]): DuplicateGroup[] =>
  groups.filter(
    (child, childIdx) =>
      !groups.some((parent, parentIdx) => {
        if (childIdx === parentIdx) return false;
        if (parent.items.length < child.items.length) return false;
        // 덜 구체적인 그룹이 더 구체적인 그룹을 subsume하면 안 됨
        if (CLONE_TYPE_PRIORITY[parent.cloneType] > CLONE_TYPE_PRIORITY[child.cloneType]) return false;
        return child.items.every((childItem) =>
          parent.items.some(
            (parentItem) =>
              childItem.filePath === parentItem.filePath &&
              isSpanContained(childItem.span, parentItem.span),
          ),
        );
      }),
  );
