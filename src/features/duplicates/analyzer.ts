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
  FirebatItemKind,
  SourceSpan,
} from '../../types';
import type { ParsedFile } from '../../engine/types';
import type { InternalCloneGroup, InternalCloneItem } from './types';

import { collectOxcNodes, getNodeHeader, getNodeType } from '../../engine/ast/oxc-ast-utils';
import { countOxcSize } from '../../engine/ast/oxc-size-count';
import {
  createOxcFingerprintExact,
  createOxcFingerprintNormalized,
  createOxcFingerprintShape,
} from '../../engine/ast/oxc-fingerprint';
import { getLineColumn } from '../../engine/source-position';
import { antiUnify, classifyDiff, type AntiUnificationResult } from './anti-unifier';
import { detectNearMissClones, type NearMissDetectorOptions } from './near-miss-detector';

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

  // ── Level 1: Hash 기반 그룹핑 ──────────────────────────────────────────────

  const type1Groups = groupByHash(files, minSize, createOxcFingerprintExact, 'type-1');
  const type2ShapeGroups = groupByHash(files, minSize, createOxcFingerprintShape, 'type-2-shape');
  const type3NormGroups = groupByHash(files, minSize, createOxcFingerprintNormalized, 'type-3-normalized');

  // Type-1에 이미 잡힌 해시는 Type-2/3에서 제외 (중복 보고 방지)
  const type1Hashes = new Set(type1Groups.map((g) => createOxcFingerprintShape(g.items[0]!.node)));

  const filteredType2 = type2ShapeGroups.filter((g) => {
    const hash = createOxcFingerprintShape(g.items[0]!.node);
    return !type1Hashes.has(hash);
  });

  // Type-2-shape에 잡힌 해시도 Type-3에서 제외
  const type2Hashes = new Set(filteredType2.map((g) => createOxcFingerprintNormalized(g.items[0]!.node)));

  const filteredType3 = type3NormGroups.filter((g) => {
    const hash = createOxcFingerprintNormalized(g.items[0]!.node);
    return !type1Hashes.has(createOxcFingerprintShape(g.items[0]!.node)) && !type2Hashes.has(hash);
  });

  let allGroups: InternalCloneGroup[] = [...type1Groups, ...filteredType2, ...filteredType3];

  // ── Level 2+3: Near-miss clone detection ───────────────────────────────────

  if (enableNearMiss) {
    // Level 1에서 그룹핑된 모든 노드의 shape hash → excluded
    const excludedHashes = new Set<string>();
    for (const group of allGroups) {
      for (const item of group.items) {
        excludedHashes.add(createOxcFingerprintShape(item.node));
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

    const nearMissGroups = detectNearMissClones(files, nearMissOpts, excludedHashes);

    for (const nmGroup of nearMissGroups) {
      allGroups.push({
        cloneType: 'type-3-near-miss',
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
      const outputGroup = applyAntiUnification(group);
      result.push(outputGroup);
    } else {
      result.push(toDuplicateGroup(group, undefined));
    }
  }

  return result;
};

/**
 * 빈 DuplicateGroup 배열을 반환.
 */
export const createEmptyDuplicates = (): ReadonlyArray<DuplicateGroup> => [];

// ─── Level 1: Hash 기반 그룹핑 ───────────────────────────────────────────────

const CLONE_TARGET_TYPES = new Set([
  'FunctionDeclaration',
  'ClassDeclaration',
  'ClassExpression',
  'MethodDefinition',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'TSTypeAliasDeclaration',
  'TSInterfaceDeclaration',
]);

const isCloneTarget = (node: Node): boolean =>
  CLONE_TARGET_TYPES.has(getNodeType(node));

const getItemKind = (node: Node): FirebatItemKind => {
  const t = getNodeType(node);
  if (t === 'FunctionDeclaration' || t === 'FunctionExpression' || t === 'ArrowFunctionExpression') return 'function';
  if (t === 'MethodDefinition') return 'method';
  if (t === 'ClassDeclaration' || t === 'ClassExpression' || t === 'TSTypeAliasDeclaration') return 'type';
  if (t === 'TSInterfaceDeclaration') return 'interface';
  return 'node';
};

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

const applyAntiUnification = (group: InternalCloneGroup): DuplicateGroup => {
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
    return toDuplicateGroup(group, undefined);
  }

  // diff 분류 결정
  const classifications = auResults.map(({ result }) => classifyDiff(result));
  const allRenameOnly = classifications.every((c) => c === 'rename-only');
  const allLiteralVariant = classifications.every((c) => c === 'literal-variant');

  // suggestedParams 생성 (rename-only 또는 literal-variant인 경우)
  let suggestedParams: CloneDiff | undefined;
  let findingKindOverride: DuplicateFindingKind | undefined;

  if (allRenameOnly && auResults.length > 0) {
    suggestedParams = buildCloneDiff('identifier', auResults[0]!.result);
  } else if (allLiteralVariant && auResults.length > 0) {
    suggestedParams = buildCloneDiff('literal', auResults[0]!.result);
    findingKindOverride = 'literal-variant';
  }

  return toDuplicateGroup(group, suggestedParams, findingKindOverride);
};

const buildCloneDiff = (
  kind: CloneDiff['kind'],
  auResult: AntiUnificationResult,
): CloneDiff => {
  const pairs: CloneDiffPair[] = auResult.variables
    .filter((v) => v.kind === kind || v.kind === 'identifier' || v.kind === 'literal')
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
    case 'type-1':
      return 'exact-clone';
    case 'type-2':
    case 'type-2-shape':
    case 'type-3-normalized':
      return 'structural-clone';
    case 'type-3-near-miss':
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

const resolveSpan = (sourceText: string, node: Node): SourceSpan => ({
  start: getLineColumn(sourceText, node.start),
  end: getLineColumn(sourceText, node.end),
});
