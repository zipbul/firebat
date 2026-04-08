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

import type { ParsedFile } from '../../engine/types';
import type { FirebatItemKind, SourceSpan } from '../../types';

import { collectOxcNodes, getNodeHeader } from '../../engine/ast/oxc-ast-utils';
import { createOxcFingerprintShape } from '../../engine/ast/oxc-fingerprint';
import { countOxcSize } from '../../engine/ast/oxc-size-count';
import { isCloneTarget, getItemKind, resolveSpan } from './clone-targets';
import { computeSequenceSimilarity } from './lcs';
import { createMinHasher, findLshCandidates } from './minhash';
import { extractStatementFingerprintBag, extractStatementFingerprints } from './statement-fingerprint';

// ─── Public Types ─────────────────────────────────────────────────────────────

interface NearMissCloneItem {
  readonly node: Node;
  readonly kind: FirebatItemKind;
  readonly header: string;
  readonly filePath: string;
  readonly span: SourceSpan;
  readonly size: number;
  readonly statementFingerprints: ReadonlyArray<string>;
  readonly fingerprintBag: ReadonlyArray<string>;
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

  if (items.length < 2) {
    return [];
  }

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
    const signatures = largeItems.map(({ item }) => hasher.computeSignature(item.fingerprintBag));
    const candidates = findLshCandidates(signatures, options.jaccardThreshold);

    for (const { i, j } of candidates) {
      const a = largeItems[i]!;
      const b = largeItems[j]!;

      if (!passesSizeFilter(a.item, b.item, options.sizeRatio)) {
        continue;
      }

      const sim = computeSequenceSimilarity(a.item.statementFingerprints, b.item.statementFingerprints);

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

        if (!passesSizeFilter(a.item, b.item, options.sizeRatio)) {
          continue;
        }

        const sim = computeSequenceSimilarity(a.item.statementFingerprints, b.item.statementFingerprints);

        if (sim >= options.similarityThreshold) {
          confirmedPairs.push({ a: a.index, b: b.index, similarity: sim });
        }
      }
    }
  }

  // 6. small × large 교차 비교: 직접 pairwise LCS
  if (smallItems.length > 0 && largeItems.length > 0) {
    for (const small of smallItems) {
      for (const large of largeItems) {
        if (!passesSizeFilter(small.item, large.item, options.sizeRatio)) {
          continue;
        }

        const sim = computeSequenceSimilarity(small.item.statementFingerprints, large.item.statementFingerprints);

        if (sim >= options.similarityThreshold) {
          confirmedPairs.push({ a: small.index, b: large.index, similarity: sim });
        }
      }
    }
  }

  if (confirmedPairs.length === 0) {
    return [];
  }

  // 7. Union-Find 전이 폐포로 그룹 형성
  const uf = new UnionFind(items.length);
  const pairSimilarities = new Map<string, number>();

  for (const { a, b, similarity } of confirmedPairs) {
    uf.union(a, b);

    const key = `${Math.min(a, b)}-${Math.max(a, b)}`;

    pairSimilarities.set(key, similarity);
  }

  // 8. 그룹별로 items + 평균 similarity 계산
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
    if (memberIndices.length < 2) {
      continue;
    }

    // 미비교 쌍 보충 LCS 계산
    const fingerprints = items.map(item => item.statementFingerprints);

    fillMissingPairSimilarities(memberIndices, fingerprints, pairSimilarities);

    // threshold 미달 쌍 제거 후 연결 컴포넌트 재계산
    const subComponents = splitByThreshold(memberIndices, pairSimilarities, options.similarityThreshold);

    for (const component of subComponents) {
      let simSum = 0;
      let simCount = 0;

      for (let p = 0; p < component.length; p++) {
        for (let q = p + 1; q < component.length; q++) {
          const a = component[p]!;
          const b = component[q]!;
          const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
          const sim = pairSimilarities.get(key);

          if (sim === undefined) {
            continue;
          }

          simSum += sim;
          simCount++;
        }
      }

      result.push({
        items: component.map(i => items[i]!),
        similarity: simCount > 0 ? simSum / simCount : 0,
      });
    }
  }

  return result;
};

// ─── Internal ─────────────────────────────────────────────────────────────────

/**
 * threshold 미달 쌍을 제거하고 남은 간선으로 연결 컴포넌트를 재계산한다.
 * Union-Find 전이 폐포에서 A~B, B~C이지만 A~C < threshold인 경우를 분리한다.
 */
const splitByThreshold = (
  indices: readonly number[],
  pairSimilarities: ReadonlyMap<string, number>,
  threshold: number,
): number[][] => {
  const adj = new Map<number, number[]>();

  for (const idx of indices) {
    adj.set(idx, []);
  }

  for (let p = 0; p < indices.length; p++) {
    for (let q = p + 1; q < indices.length; q++) {
      const a = indices[p]!;
      const b = indices[q]!;
      const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
      const sim = pairSimilarities.get(key);

      if (sim === undefined || sim < threshold) {
        continue;
      }

      adj.get(a)!.push(b);
      adj.get(b)!.push(a);
    }
  }

  const visited = new Set<number>();
  const components: number[][] = [];

  for (const idx of indices) {
    if (visited.has(idx)) {
      continue;
    }

    const component: number[] = [];
    const queue = [idx];

    visited.add(idx);

    while (queue.length > 0) {
      const curr = queue.shift()!;

      component.push(curr);

      for (const neighbor of adj.get(curr)!) {
        if (visited.has(neighbor)) {
          continue;
        }

        visited.add(neighbor);
        queue.push(neighbor);
      }
    }

    if (component.length < 2) {
      continue;
    }

    components.push(component);
  }

  return components;
};

/**
 * 그룹 내 직접 비교되지 않은 쌍을 보충 LCS 계산으로 채운다.
 *
 * Union-Find 전이 폐포로 묶인 그룹에는 A≈B, B≈C → {A,B,C} 처럼
 * A-C 쌍이 pairSimilarities에 없는 경우가 있다.
 * 이 함수는 누락된 쌍을 발견하면 LCS similarity를 계산해 맵에 추가한다.
 */
const fillMissingPairSimilarities = (
  memberIndices: readonly number[],
  fingerprints: readonly ReadonlyArray<string>[],
  pairSimilarities: Map<string, number>,
): void => {
  for (let p = 0; p < memberIndices.length; p++) {
    for (let q = p + 1; q < memberIndices.length; q++) {
      const a = memberIndices[p]!;
      const b = memberIndices[q]!;
      const key = `${Math.min(a, b)}-${Math.max(a, b)}`;

      if (pairSimilarities.has(key)) {
        continue;
      }

      const sim = computeSequenceSimilarity(fingerprints[a]!, fingerprints[b]!);

      pairSimilarities.set(key, sim);
    }
  }
};

interface IndexedItem {
  readonly index: number;
  readonly item: NearMissCloneItem;
}

interface ConfirmedPair {
  readonly a: number;
  readonly b: number;
  readonly similarity: number;
}

const collectCloneItems = (
  files: ReadonlyArray<ParsedFile>,
  minSize: number,
  excludedHashes: ReadonlySet<string> | undefined,
): NearMissCloneItem[] => {
  const items: NearMissCloneItem[] = [];

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    const nodes = collectOxcNodes(file.program, isCloneTarget);

    for (const node of nodes) {
      const size = countOxcSize(node);

      if (size < minSize) {
        continue;
      }

      // excludedHashes로 Level 1 그룹핑된 노드 제외
      if (excludedHashes !== undefined) {
        const hash = createOxcFingerprintShape(node);

        if (excludedHashes.has(hash)) {
          continue;
        }
      }

      const fingerprints = extractStatementFingerprints(node);

      // statement가 0개인 노드(빈 함수, TypeAlias 등)는 near-miss 비교 불가
      if (fingerprints.length === 0) {
        continue;
      }

      const bag = extractStatementFingerprintBag(node);
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
        fingerprintBag: bag,
      });
    }
  }

  return items;
};

const passesSizeFilter = (a: NearMissCloneItem, b: NearMissCloneItem, sizeRatio: number): boolean => {
  const minSize = Math.min(a.size, b.size);
  const maxSize = Math.max(a.size, b.size);

  if (maxSize === 0) {
    return false;
  }

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

    if (rx === ry) {
      return;
    }

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

// ─── Test Exports ─────────────────────────────────────────────────────────────

export const __testing__ = {
  fillMissingPairSimilarities,
};
