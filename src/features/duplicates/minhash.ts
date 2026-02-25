/**
 * MinHash + LSH (Locality-Sensitive Hashing) 구현.
 *
 * MinHash: 집합의 Jaccard 유사도를 근사한다.
 *   sig[i] = min { xxHash64(element, seed_i) for element in bag }
 *   Pr[ sig_A[i] === sig_B[i] ] = Jaccard(A, B)
 *
 * LSH Banding: 높은 Jaccard 유사도를 가진 쌍을 후보로 선별한다.
 *   k=128, b=16 bands, r=8 rows per band
 *   Pr[같은 버킷에 배치] ≈ 1 - (1 - J^r)^b
 *
 * 참고: Broder et al. (1997), "On the Resemblance and Containment of Documents"
 */

const MAX_U64 = BigInt.asUintN(64, -1n);
const DEFAULT_K = 128;
const DEFAULT_BANDS = 16;
const DEFAULT_ROWS_PER_BAND = 8; // k / bands
const DEFAULT_THRESHOLD = 0.5;

// ─── Public API ──────────────────────────────────────────────────────────────

export interface MinHasher {
  readonly computeSignature: (items: ReadonlyArray<string>) => ReadonlyArray<bigint>;
  readonly k: number;
}

/**
 * MinHasher 인스턴스를 생성한다.
 * @param k 해시 함수 수 (시그니처 길이). 기본값 128.
 */
export const createMinHasher = (k: number = DEFAULT_K): MinHasher => {
  return {
    k,
    computeSignature: (items) => computeSignatureImpl(items, k),
  };
};

export interface LshCandidate {
  readonly i: number;
  readonly j: number;
}

/**
 * LSH banding으로 후보 쌍을 선별한다.
 *
 * @param signatures 각 아이템의 MinHash 시그니처 배열
 * @param threshold  Jaccard 임계값 (이 이상인 쌍을 찾으려는 목표). 기본값 0.5.
 * @param bands      band 수. 기본값 16. (rows = signatures[0].length / bands)
 * @returns 중복 없는 후보 쌍 (i < j 보장)
 */
export const findLshCandidates = (
  signatures: ReadonlyArray<ReadonlyArray<bigint>>,
  threshold: number = DEFAULT_THRESHOLD,
  bands: number = DEFAULT_BANDS,
): ReadonlyArray<LshCandidate> => {
  if (signatures.length < 2) return [];

  const k = signatures[0]!.length;
  const rowsPerBand = Math.max(1, Math.floor(k / bands));
  const effectiveBands = Math.floor(k / rowsPerBand);

  void threshold; // threshold는 bands/rows 파라미터 선택 시 외부에서 조정 가능, 현재는 구조 참고용

  const candidateSet = new Set<string>();
  const candidates: LshCandidate[] = [];

  for (let b = 0; b < effectiveBands; b++) {
    const start = b * rowsPerBand;
    const end = start + rowsPerBand;

    // band b의 버킷: bandKey → 아이템 인덱스 목록
    const buckets = new Map<bigint, number[]>();

    for (let idx = 0; idx < signatures.length; idx++) {
      const sig = signatures[idx]!;
      const bandKey = hashBand(sig, start, end);
      const bucket = buckets.get(bandKey);
      if (bucket === undefined) {
        buckets.set(bandKey, [idx]);
      } else {
        bucket.push(idx);
      }
    }

    // 같은 버킷에 2개 이상 → 후보 쌍
    for (const bucket of buckets.values()) {
      if (bucket.length < 2) continue;
      for (let p = 0; p < bucket.length; p++) {
        for (let q = p + 1; q < bucket.length; q++) {
          const a = bucket[p]!;
          const c = bucket[q]!;
          const lo = a < c ? a : c;
          const hi = a < c ? c : a;
          const key = BigInt(lo) * BigInt(signatures.length) + BigInt(hi);
          if (!candidateSet.has(key.toString())) {
            candidateSet.add(key.toString());
            candidates.push({ i: lo, j: hi });
          }
        }
      }
    }
  }

  return candidates;
};

/**
 * 두 시그니처의 추정 Jaccard 유사도를 계산한다.
 * 동일한 위치에서 값이 같은 비율.
 */
export const estimateJaccard = (
  sigA: ReadonlyArray<bigint>,
  sigB: ReadonlyArray<bigint>,
): number => {
  if (sigA.length === 0) return 0;
  let matches = 0;
  for (let i = 0; i < sigA.length; i++) {
    if (sigA[i] === sigB[i]) matches++;
  }
  return matches / sigA.length;
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

const computeSignatureImpl = (
  items: ReadonlyArray<string>,
  k: number,
): ReadonlyArray<bigint> => {
  const sig = new Array<bigint>(k).fill(MAX_U64);

  if (items.length === 0) return sig;

  for (const item of items) {
    for (let i = 0; i < k; i++) {
      // seed는 i (0 ~ k-1). Bun.hash.xxHash64 seed는 number 타입.
      const h = BigInt.asUintN(64, Bun.hash.xxHash64(item, i));
      if (h < sig[i]!) {
        sig[i] = h;
      }
    }
  }

  return sig;
};

/**
 * band의 row 범위 [start, end)에 해당하는 시그니처 슬라이스를 해시한다.
 * 단순 XOR + 곱셈 조합으로 band 버킷 키 생성.
 */
const hashBand = (
  sig: ReadonlyArray<bigint>,
  start: number,
  end: number,
): bigint => {
  // FNV-like 조합
  const FNV_PRIME = 1099511628211n;
  let h = 14695981039346656037n;
  for (let i = start; i < end; i++) {
    h = BigInt.asUintN(64, (h ^ sig[i]!) * FNV_PRIME);
  }
  return h;
};
