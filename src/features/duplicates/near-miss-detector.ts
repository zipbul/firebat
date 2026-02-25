/**
 * Near-miss clone detector — Level 2 (MinHash/LSH) + Level 3 (LCS 검증).
 *
 * Level 1 hash 그룹에 속하지 않는 함수들을 대상으로:
 * 1. statement fingerprint 추출
 * 2. MinHash 시그니처 계산 + LSH banding → 후보 쌍
 * 3. 크기 비율 필터
 * 4. LCS 유사도 검증 → threshold 이상이면 확정
 * 5. Union-Find 전이 폐포로 그룹 형성
 *
 * 소규모 함수(statement < minStatementCount)는 MinHash를 생략하고 직접 pairwise LCS.
 */

import type { Node } from 'oxc-parser';

import type { FirebatItemKind, SourceSpan } from '../../types';
import type { ParsedFile } from '../../engine/types';

import { collectOxcNodes, getNodeHeader, getNodeType } from '../../engine/ast/oxc-ast-utils';
import { countOxcSize } from '../../engine/ast/oxc-size-count';
import { createOxcFingerprintShape } from '../../engine/ast/oxc-fingerprint';
import { getLineColumn } from '../../engine/source-position';
import { createMinHasher, findLshCandidates } from './minhash';
import { computeSequenceSimilarity } from './lcs';
import { extractStatementFingerprintBag, extractStatementFingerprints } from './statement-fingerprint';

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface NearMissCloneItem {
  readonly node: Node;
  readonly kind: FirebatItemKind;
  readonly header: string;
  readonly filePath: string;
  readonly span: SourceSpan;
  readonly size: number;
  readonly statementFingerprints: ReadonlyArray<string>;
}

export interface NearMissCloneGroup {
  readonly items: ReadonlyArray<NearMissCloneItem>;
  readonly similarity: number;
}

export interface NearMissDetectorOptions {
  readonly minSize: number;
  /** LCS 유사도 임계값 (default: 0.7) */
  readonly similarityThreshold: number;
  /** MinHash pre-filter Jaccard 임계값 (default: 0.5) */
  readonly jaccardThreshold: number;
  /** MinHash 해시 수 (default: 128) */
  readonly minHashK: number;
  /** 크기 비율 필터 — min(sA,sB)/max(sA,sB) ≥ sizeRatio (default: 0.5) */
  readonly sizeRatio: number;
  /** MinHash 최소 statement 수 (default: 5) */
  readonly minStatementCount: number;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Level 2+3: near-miss 클론 탐지.
 *
 * @param excludedHashes Level 1에서 이미 그룹핑된 노드의 fingerprint 집합.
 *                       이 해시에 해당하는 노드는 near-miss 탐지 대상에서 제외.
 */
export const detectNearMissClones = (
  files: ReadonlyArray<ParsedFile>,
  options: NearMissDetectorOptions,
  excludedHashes?: ReadonlySet<string>,
): ReadonlyArray<NearMissCloneGroup> => {
  // 1. 모든 파일에서 clone 대상 노드 추출
  const items = collectCloneItems(files, options.minSize, excludedHashes);
  if (items.length < 2) return [];

  // 2. 소규모/대규모 분류
  const smallItems: IndexedItem[] = [];
  const largeItems: IndexedItem[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (item.statementFingerprints.length < options.minStatementCount) {
      smallItems.push({ index: i, item });
    } else {
      largeItems.push({ index: i, item });
    }
  }

  // 3. 확정된 쌍 (index-a, index-b, similarity)
  const confirmedPairs: ConfirmedPair[] = [];

  // 4. 대규모 함수: MinHash/LSH → LCS 검증
  if (largeItems.length >= 2) {
    const hasher = createMinHasher(options.minHashK);
    const signatures = largeItems.map(({ item }) =>
      hasher.computeSignature([...item.statementFingerprints]),
    );

    const candidates = findLshCandidates(signatures, options.jaccardThreshold);

    for (const { i, j } of candidates) {
      const a = largeItems[i]!;
      const b = largeItems[j]!;

      if (!passesSizeFilter(a.item, b.item, options.sizeRatio)) continue;

      const sim = computeSequenceSimilarity(
        [...a.item.statementFingerprints],
        [...b.item.statementFingerprints],
      );

      if (sim >= options.similarityThreshold) {
        confirmedPairs.push({ a: a.index, b: b.index, similarity: sim });
      }
    }
  }

  // 5. 소규모 함수: 직접 pairwise LCS
  if (smallItems.length >= 2) {
    for (let p = 0; p < smallItems.length; p++) {
      for (let q = p + 1; q < smallItems.length; q++) {
        const a = smallItems[p]!;
        const b = smallItems[q]!;

        if (!passesSizeFilter(a.item, b.item, options.sizeRatio)) continue;

        const sim = computeSequenceSimilarity(
          [...a.item.statementFingerprints],
          [...b.item.statementFingerprints],
        );

        if (sim >= options.similarityThreshold) {
          confirmedPairs.push({ a: a.index, b: b.index, similarity: sim });
        }
      }
    }
  }

  if (confirmedPairs.length === 0) return [];

  // 6. Union-Find 전이 폐포로 그룹 형성
  const uf = new UnionFind(items.length);
  const pairSimilarities = new Map<string, number>();

  for (const { a, b, similarity } of confirmedPairs) {
    uf.union(a, b);
    const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
    pairSimilarities.set(key, similarity);
  }

  // 7. 그룹별로 items + 평균 similarity 계산
  const groupMap = new Map<number, number[]>();
  for (let i = 0; i < items.length; i++) {
    const root = uf.find(i);
    const group = groupMap.get(root);
    if (group === undefined) {
      groupMap.set(root, [i]);
    } else {
      group.push(i);
    }
  }

  const result: NearMissCloneGroup[] = [];

  for (const memberIndices of groupMap.values()) {
    if (memberIndices.length < 2) continue;

    // 그룹 내 쌍별 similarity의 평균
    let simSum = 0;
    let simCount = 0;
    for (let p = 0; p < memberIndices.length; p++) {
      for (let q = p + 1; q < memberIndices.length; q++) {
        const a = memberIndices[p]!;
        const b = memberIndices[q]!;
        const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
        const sim = pairSimilarities.get(key);
        if (sim !== undefined) {
          simSum += sim;
          simCount++;
        }
      }
    }

    result.push({
      items: memberIndices.map((i) => items[i]!),
      similarity: simCount > 0 ? simSum / simCount : 0,
    });
  }

  return result;
};

// ─── Internal ─────────────────────────────────────────────────────────────────

interface IndexedItem {
  readonly index: number;
  readonly item: NearMissCloneItem;
}

interface ConfirmedPair {
  readonly a: number;
  readonly b: number;
  readonly similarity: number;
}

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

const isCloneTarget = (node: Node): boolean => CLONE_TARGET_TYPES.has(getNodeType(node));

const getItemKind = (node: Node): FirebatItemKind => {
  const t = getNodeType(node);
  if (t === 'FunctionDeclaration' || t === 'FunctionExpression' || t === 'ArrowFunctionExpression') return 'function';
  if (t === 'MethodDefinition') return 'method';
  if (t === 'ClassDeclaration' || t === 'ClassExpression' || t === 'TSTypeAliasDeclaration') return 'type';
  if (t === 'TSInterfaceDeclaration') return 'interface';
  return 'node';
};

const collectCloneItems = (
  files: ReadonlyArray<ParsedFile>,
  minSize: number,
  excludedHashes: ReadonlySet<string> | undefined,
): NearMissCloneItem[] => {
  const items: NearMissCloneItem[] = [];

  for (const file of files) {
    if (file.errors.length > 0) continue;

    const nodes = collectOxcNodes(file.program, isCloneTarget);

    for (const node of nodes) {
      const size = countOxcSize(node);
      if (size < minSize) continue;

      // excludedHashes로 Level 1 그룹핑된 노드 제외
      if (excludedHashes !== undefined) {
        const hash = createOxcFingerprintShape(node);
        if (excludedHashes.has(hash)) continue;
      }

      const fingerprints = extractStatementFingerprints(node);
      // statement가 0개인 노드(빈 함수, TypeAlias 등)는 near-miss 비교 불가
      if (fingerprints.length === 0) continue;

      const span = resolveSpan(file.sourceText, node);
      const header = getNodeHeader(node);

      items.push({
        node,
        kind: getItemKind(node),
        header,
        filePath: file.filePath,
        span,
        size,
        statementFingerprints: fingerprints,
      });
    }
  }

  return items;
};

const resolveSpan = (sourceText: string, node: Node): SourceSpan => ({
  start: getLineColumn(sourceText, node.start),
  end: getLineColumn(sourceText, node.end),
});

const passesSizeFilter = (
  a: NearMissCloneItem,
  b: NearMissCloneItem,
  sizeRatio: number,
): boolean => {
  const minSize = Math.min(a.size, b.size);
  const maxSize = Math.max(a.size, b.size);
  if (maxSize === 0) return false;
  return minSize / maxSize >= sizeRatio;
};

// ─── Union-Find ───────────────────────────────────────────────────────────────

class UnionFind {
  private readonly parent: number[];
  private readonly rank: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }

  find(x: number): number {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]!);
    }
    return this.parent[x]!;
  }

  union(x: number, y: number): void {
    const rx = this.find(x);
    const ry = this.find(y);
    if (rx === ry) return;

    if (this.rank[rx]! < this.rank[ry]!) {
      this.parent[rx] = ry;
    } else if (this.rank[rx]! > this.rank[ry]!) {
      this.parent[ry] = rx;
    } else {
      this.parent[ry] = rx;
      this.rank[rx]!++;
    }
  }
}
