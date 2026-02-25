/**
 * LCS (Longest Common Subsequence) 알고리즘.
 *
 * - `computeLcsLength`: Hunt-Szymanski O((r+n) log n) — 길이만 계산
 * - `computeSequenceSimilarity`: Dice 유사도 2×|LCS|/(|A|+|B|)
 * - `computeLcsAlignment`: DP traceback — 매칭 인덱스 쌍 + aOnly + bOnly
 *
 * `computeLcsAlignment`는 statement 시퀀스(보통 수십 개) 대상이므로 DP O(mn) 사용.
 */

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * 두 문자열 배열의 Longest Common Subsequence 길이를 계산한다.
 * Hunt-Szymanski 알고리즘 — 평균 O((r+n) log n), 최악 O(n² log n).
 */
export const computeLcsLength = (
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): number => {
  if (a.length === 0 || b.length === 0) return 0;

  // b의 각 값 → 출현 인덱스 목록 (오름차순)
  const matchIndex = buildMatchIndex(b);

  // tails[k] = LCS 길이 k+1의 subsequence가 끝나는 B 인덱스의 최솟값
  const tails: number[] = [];

  for (const val of a) {
    const positions = matchIndex.get(val);
    if (positions === undefined) continue;

    // 역순으로 처리해야 같은 row에서 중복 사용 방지
    for (let p = positions.length - 1; p >= 0; p--) {
      const j = positions[p]!;
      const pos = lowerBound(tails, j);
      if (pos === tails.length) {
        tails.push(j);
      } else {
        tails[pos] = j;
      }
    }
  }

  return tails.length;
};

/**
 * LCS 기반 Dice 유사도: 2×|LCS| / (|A|+|B|).
 * 범위: [0, 1]. 1이면 동일 시퀀스. 양쪽 모두 빈 경우 0.
 */
export const computeSequenceSimilarity = (
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): number => {
  const total = a.length + b.length;
  if (total === 0) return 0;
  return (2 * computeLcsLength(a, b)) / total;
};

/**
 * LCS 정렬 결과: 매칭된 인덱스 쌍, A에만 있는 인덱스, B에만 있는 인덱스.
 * anti-unification의 배열 자식 정렬에서 사용.
 *
 * DP traceback O(mn) — statement 시퀀스(보통 수십 개)에 적합.
 */
export interface LcsAlignment {
  readonly matched: ReadonlyArray<{
    readonly aIndex: number;
    readonly bIndex: number;
  }>;
  readonly aOnly: ReadonlyArray<number>;
  readonly bOnly: ReadonlyArray<number>;
}

export const computeLcsAlignment = (
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): LcsAlignment => {
  const m = a.length;
  const n = b.length;

  // dp[i][j] = a[0..i-1], b[0..j-1]의 LCS 길이
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  // Traceback
  const matched: Array<{ aIndex: number; bIndex: number }> = [];
  const aOnlySet = new Set<number>();
  const bOnlySet = new Set<number>();

  for (let i = 0; i < m; i++) aOnlySet.add(i);
  for (let j = 0; j < n; j++) bOnlySet.add(j);

  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      matched.push({ aIndex: i - 1, bIndex: j - 1 });
      aOnlySet.delete(i - 1);
      bOnlySet.delete(j - 1);
      i--;
      j--;
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
      i--;
    } else {
      j--;
    }
  }

  matched.reverse();

  return {
    matched,
    aOnly: [...aOnlySet].sort((x, y) => x - y),
    bOnly: [...bOnlySet].sort((x, y) => x - y),
  };
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

const buildMatchIndex = (b: ReadonlyArray<string>): Map<string, number[]> => {
  const map = new Map<string, number[]>();
  for (let j = 0; j < b.length; j++) {
    const key = b[j]!;
    const list = map.get(key);
    if (list === undefined) {
      map.set(key, [j]);
    } else {
      list.push(j);
    }
  }
  return map;
};

/**
 * arr에서 target보다 크거나 같은 첫 번째 인덱스를 반환 (lower bound).
 * arr는 오름차순 정렬 상태.
 */
const lowerBound = (arr: number[], target: number): number => {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid]! < target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
};
