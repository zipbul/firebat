# Duplicates Detector 통합 계획

> 4개 피처(exact-duplicates, structural-duplicates, modification-trap, symmetry-breaking)를
> 1개의 `duplicates` 디텍터로 통합하는 상세 개발 계획.

## 1. 현재 상태 분석

### 1.1 통합 대상 피처

| 피처 | 파일 | LOC | 알고리즘 | 출력 타입 |
|------|------|-----|---------|----------|
| exact-duplicates | `src/features/exact-duplicates/detector.ts` | 12 | `detectClones('type-1')` | `DuplicateGroup[]` |
| structural-duplicates | `src/features/structural-duplicates/analyzer.ts` | 18 | `detectClones('type-2-shape')` + `detectClones('type-3-normalized')` | `DuplicateGroup[]` |
| modification-trap | `src/features/modification-trap/analyzer.ts` | 143 | Regex: case 라벨 + 리터럴 비교 추출 → 패턴 그룹핑 | `ModificationTrapFinding[]` |
| symmetry-breaking | `src/features/symmetry-breaking/analyzer.ts` | 202 | Regex: Handler/Controller suffix + no-arg call sequence → 다수결 투표 | `SymmetryBreakingFinding[]` |

### 1.2 기존 엔진

| 파일 | LOC | 역할 |
|------|-----|------|
| `src/engine/duplicate-detector.ts` | 80 | `isCloneTarget`, `detectClones` 진입점 |
| `src/engine/duplicate-collector.ts` | 191 | `collectDuplicateGroups` (해시 그룹핑), `computeCloneDiff` |
| `src/engine/ast/oxc-fingerprint.ts` | 211 | 4종 fingerprint 생성 (Exact/Normal/Shape/Normalized) |
| `src/engine/ast/oxc-size-count.ts` | 42 | AST 노드 수 카운팅 |
| `src/engine/hasher.ts` | 17 | `Bun.hash.xxHash64` 래퍼 |
| `src/engine/auto-min-size.ts` | 39 | 자동 minSize 계산 |

### 1.3 통합 지점

| 위치 | 참조 방식 |
|------|----------|
| `src/application/scan/scan.usecase.ts` | 4개 함수 개별 import + 개별 호출 |
| `src/test-api.ts` | 4개 함수 re-export (통합/e2e 테스트용) |
| `src/types.ts` → `FirebatDetector` | 4개 문자열 리터럴 |
| `src/types.ts` → `FirebatAnalyses` | 4개 필드 |
| `test/integration/features/*/` | 각 피처별 테스트 디렉토리 |

## 2. 목표 아키텍처

### 2.1 알고리즘: 4-Level 하이브리드 클론 탐지

```
Input: OXC 파싱된 AST 함수들

┌─ Level 1: Hash 기반 정확 매칭 ─────────────────────────────┐
│ type-1 fingerprint → exact-clone 그룹                       │
│ type-2-shape fingerprint → structural-clone 그룹            │
│ type-3-normalized fingerprint → structural-clone 그룹       │
│ (기존 엔진 유지)                                             │
└─────────────────────────────────────────────────────────────┘
         │ 그룹에 속하지 않은 함수들
         ▼
┌─ Level 2: MinHash Pre-filter ───────────────────────────────┐
│ 함수별: statement 단위 type-2-shape fingerprint 생성         │
│ bag-of-statement-fingerprints → MinHash 시그니처 (k=128)    │
│ LSH banding → 후보 쌍 (estimated Jaccard ≥ threshold)       │
│ 크기 필터: AST 노드 수 ±50% 이내만 비교                      │
└─────────────────────────────────────────────────────────────┘
         │ 후보 쌍
         ▼
┌─ Level 3: LCS 유사도 검증 ──────────────────────────────────┐
│ statement fingerprint 시퀀스 → LCS (Longest Common Subseq)  │
│ 유사도 = 2×|LCS| / (|A|+|B|) ≥ threshold → near-miss-clone │
│ 전이 폐포(transitive closure)로 그룹 형성                    │
└─────────────────────────────────────────────────────────────┘
         │ 모든 클론 그룹 (Type-1, 2, 3)
         ▼
┌─ Level 4: Anti-unification 상세 분석 ───────────────────────┐
│ 그룹 내 대표 × 각 멤버: Plotkin anti-unification             │
│ 생성된 변수(차이점) 분류:                                     │
│  - Identifier만 다름 → structural-clone                      │
│  - Literal만 다름 → literal-variant (modification-trap)      │
│  - 구조적 차이 → near-miss-clone                             │
│  - 변수 수 >> 그룹 평균 → pattern-outlier (symmetry-break)   │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 알고리즘 선정 근거

| 단계 | 알고리즘 | 선정 이유 |
|------|----------|----------|
| Level 1 | Hash exact match | Type-1/2에 **수학적 완전** (false positive 0). 기존 엔진 그대로 사용. |
| Level 2 | MinHash/LSH | 집합 유사도 pre-filtering에 **확률론적 최적**. Pr[h(A)=h(B)] = Jaccard(A,B). |
| Level 3 | LCS | 문장 삽입/삭제 패턴(가장 흔한 Type-3)에 **최적 DP**. Hunt-Szymanski O(r log n). |
| Level 4 | Anti-unification | 구조 비교에서 **정보량 최대** — 파라미터화 템플릿 + 정확한 차이점 추출. Plotkin O(\|T₁\|+\|T₂\|). |

**기각한 대안:**
- 순수 SourcererCC (token Jaccard): 토큰 순서 정보 손실 → 재배치된 코드에서 false positive 높음
- Deckard (특성 벡터): AST 노드 타입 카운트만 사용 → 세부 구조 손실
- 순수 Tree edit distance: anti-unification보다 비용 크고 "공유 템플릿" 대신 "편집 수"만 제공
- PDG 기반: Type-4(의미적 클론) 탐지용, NP-hard, 이 프로젝트 범위 밖

**출처:**
- SourcererCC: arXiv:1512.06448 (ICSE'16), Sajnani et al.
- Anti-unification: Plotkin (1970), Bulychev & Minea (2008) "Duplicate Code Detection Using Anti-Unification"
- MinHash/LSH: Wikipedia "Locality-sensitive hashing", Broder et al. (1997)

### 2.3 Finding 종류

```typescript
type DuplicateFindingKind =
  | 'exact-clone'        // Type-1: 동일 코드
  | 'structural-clone'   // Type-2: 구조 동일, identifier/literal/type만 다름
  | 'near-miss-clone'    // Type-3: statement 수준 편집 있는 유사 코드
  | 'literal-variant'    // modification-trap: 같은 분기 구조, 다른 리터럴 값
  | 'pattern-outlier';   // symmetry-breaking: 그룹에서 유의미 이탈 멤버
```

### 2.4 디렉토리 구조 (최종)

```
src/features/duplicates/
  index.ts                    # public API re-export
  analyzer.ts                 # 메인 진입점: analyzeDuplicates()
  analyzer.spec.ts            # 유닛 테스트
src/engine/
  duplicate-detector.ts       # Level 1 (기존, refactored)
  duplicate-collector.ts      # Level 1 (기존, refactored)
  near-miss-detector.ts       # Level 2+3 (신규)
  near-miss-detector.spec.ts
  anti-unifier.ts             # Level 4 (신규)
  anti-unifier.spec.ts
  minhash.ts                  # MinHash/LSH (신규)
  minhash.spec.ts
  lcs.ts                      # LCS 알고리즘 (신규)
  lcs.spec.ts
  statement-fingerprint.ts    # statement 단위 fingerprint (신규)
  statement-fingerprint.spec.ts
```

## 3. 구현 단계

### Phase 0: 기반 작업 (코드 변경 없음)

#### Step 0-1: 기존 테스트 스냅샷
- `bun test` 실행, 현재 통과/실패 수 기록
- 4개 피처의 기존 테스트 파일 목록 확인:
  - `src/features/exact-duplicates/detector.spec.ts`
  - `src/features/structural-duplicates/analyzer.spec.ts`
  - `src/features/modification-trap/analyzer.spec.ts`
  - `src/features/symmetry-breaking/analyzer.spec.ts`
  - `test/integration/features/exact-duplicates/*.test.ts` (5개)
  - `test/integration/features/structural-duplicates/*.test.ts` (2개)
  - `test/integration/features/modification-trap/*.test.ts` (1개)

---

### Phase 1: 신규 엔진 모듈 (하위 → 상위)

#### Step 1-1: `src/engine/lcs.ts` — LCS 알고리즘

**인터페이스:**
```typescript
/**
 * 두 문자열 배열의 Longest Common Subsequence 길이를 계산한다.
 * Hunt-Szymanski 알고리즘 (평균 O(r log n), 최악 O(n²)).
 * atoms이 해시 문자열이므로 비교는 문자열 등호.
 */
export const computeLcsLength = (
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): number;

/**
 * LCS 기반 Dice 유사도: 2×|LCS| / (|A|+|B|).
 * 범위: [0, 1]. 1이면 동일 시퀀스. 양쪽 모두 빈 경우 0.
 */
export const computeSequenceSimilarity = (
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): number;

/**
 * LCS 정렬 결과: 매칭된 인덱스 쌍, 삽입/삭제 인덱스.
 * anti-unification 입력용.
 */
export interface LcsAlignment {
  readonly matched: ReadonlyArray<{
    readonly aIndex: number;
    readonly bIndex: number;
  }>;
  readonly aOnly: ReadonlyArray<number>;  // A에만 있는 인덱스
  readonly bOnly: ReadonlyArray<number>;  // B에만 있는 인덱스
}

export const computeLcsAlignment = (
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): LcsAlignment;
```

**테스트 케이스:**
- 빈 배열 × 빈 배열 → 길이 0, 유사도 0 (NaN 방지: 0/0 = 0)
- 동일 배열 → 유사도 1.0
- 완전 불일치 → 유사도 0.0
- 앞/중간/뒤 삽입 → 정확한 정렬
- 단일 원소 차이 → 유사도 = 2*(n-1)/(2n)
- 1000개 원소 성능 테스트 (< 100ms)

---

#### Step 1-2: `src/engine/minhash.ts` — MinHash + LSH

**인터페이스:**
```typescript
/**
 * MinHash 시그니처 생성기.
 * k개의 해시 함수로 bag-of-items의 MinHash 시그니처를 계산한다.
 *
 * 내부: k개의 서로 다른 seed로 xxHash64 사용.
 * Pr[sig_A[i] === sig_B[i]] ≈ Jaccard(A, B)
 */
export interface MinHasher {
  /** bag-of-items에서 k개 MinHash 값 계산 */
  readonly computeSignature: (
    items: ReadonlyArray<string>,
  ) => ReadonlyArray<bigint>;
}

export const createMinHasher = (k?: number): MinHasher;
// default k=128

/**
 * LSH banding으로 후보 쌍 생성.
 * b bands × r rows = k.
 * Jaccard ≥ threshold일 때 후보가 될 확률 ≈ 1 - (1 - t^r)^b.
 *
 * @param signatures - 각 아이템의 MinHash 시그니처 배열
 * @param threshold - Jaccard 유사도 임계값 (default: 0.5)
 * @param bands - band 수 (default: 자동 계산)
 * @returns 후보 쌍 [index_i, index_j][]
 */
export interface LshCandidate {
  readonly i: number;
  readonly j: number;
}

export const findLshCandidates = (
  signatures: ReadonlyArray<ReadonlyArray<bigint>>,
  threshold?: number,
  bands?: number,
): ReadonlyArray<LshCandidate>;
```

**테스트 케이스:**
- 동일 bag → 시그니처 동일 → 반드시 후보 쌍
- 완전 불일치 bag → 후보 아님
- Jaccard 0.8인 두 bag → threshold 0.7에서 후보
- Jaccard 0.3인 두 bag → threshold 0.5에서 후보 아님
- 빈 bag → 시그니처 계산 가능 (에러 없음)
- 1000개 아이템, 500개 bag → < 500ms (성능)

---

#### Step 1-3: `src/engine/statement-fingerprint.ts` — Statement 단위 Fingerprint

**인터페이스:**
```typescript
import type { Node } from 'oxc-parser';

/**
 * 함수 AST 노드에서 top-level statement별 fingerprint 시퀀스를 추출한다.
 *
 * 절차:
 * 1. 함수 body의 직계 statement 노드들을 순서대로 추출
 * 2. 각 statement에 대해 type-2-shape fingerprint 생성
 * 3. fingerprint 문자열 배열 반환
 *
 * BlockStatement가 아닌 body (ArrowFunction expression body):
 * → 단일 statement로 취급하여 1개 fingerprint 반환
 */
export const extractStatementFingerprints = (
  functionNode: Node,
): ReadonlyArray<string>;

/**
 * 함수의 statement fingerprint를 bag (중복 허용 집합)으로 반환.
 * MinHash 입력용.
 */
export const extractStatementFingerprintBag = (
  functionNode: Node,
): ReadonlyArray<string>;
```

**의존성:** `oxc-fingerprint.ts`의 `createOxcFingerprintShape`, `oxc-ast-utils.ts`

**테스트 케이스:**
- 빈 함수 body → 빈 배열
- 3개 statement 함수 → 3개 fingerprint
- 동일 구조 다른 이름 두 함수 → 동일 fingerprint 시퀀스
- ArrowFunction expression body → 1개 fingerprint
- 중첩 함수 → 외부 함수의 statement만 추출 (내부 함수는 하나의 statement로)

---

#### Step 1-4: `src/engine/anti-unifier.ts` — Anti-unification (Plotkin's lgg)

**인터페이스:**
```typescript
import type { Node } from 'oxc-parser';

/**
 * Anti-unification에서 발견된 하나의 차이점(변수).
 */
export interface AntiUnificationVariable {
  readonly id: number;
  readonly location: string;    // dotpath (예: "body[0].consequent.body[2]")
  readonly leftType: string;    // 왼쪽 노드 타입 또는 값
  readonly rightType: string;   // 오른쪽 노드 타입 또는 값
  readonly kind: 'identifier' | 'literal' | 'type' | 'structural';
}

/**
 * Anti-unification 결과.
 */
export interface AntiUnificationResult {
  readonly sharedSize: number;  // lgg의 노드 수
  readonly leftSize: number;    // 왼쪽 원본 노드 수
  readonly rightSize: number;   // 오른쪽 원본 노드 수
  readonly similarity: number;  // sharedSize / max(leftSize, rightSize)
  readonly variables: ReadonlyArray<AntiUnificationVariable>;
}

/**
 * 두 AST 노드의 anti-unification을 수행한다.
 *
 * Plotkin's algorithm 적용:
 * - 같은 type의 노드 → 재귀적으로 자식 비교
 * - 다른 type의 노드 → 변수(차이점) 생성
 * - 배열 자식(BlockStatement.body 등) → LCS 정렬 후 매칭된 쌍만 재귀
 */
export const antiUnify = (
  left: Node,
  right: Node,
): AntiUnificationResult;

/**
 * AntiUnificationResult의 variables를 분류하여
 * 주요 차이 종류를 결정한다.
 *
 * - 모든 변수가 identifier → 'rename-only'
 * - 모든 변수가 literal → 'literal-variant'
 * - structural 변수 존재 → 'structural-diff'
 * - 혼합 → 'mixed'
 */
export type DiffClassification =
  | 'rename-only'
  | 'literal-variant'
  | 'structural-diff'
  | 'mixed';

export const classifyDiff = (
  result: AntiUnificationResult,
): DiffClassification;
```

**테스트 케이스:**
- 동일 노드 → variables 빈 배열, similarity 1.0
- Identifier만 다른 두 함수 → kind='identifier' 변수만 생성, classify='rename-only'
- Literal만 다른 두 함수 → kind='literal' 변수만 생성, classify='literal-variant'
- Statement 추가된 함수 → kind='structural' 변수 포함, classify='structural-diff'
- 완전히 다른 두 함수 → similarity ≈ 0, variables 다수
- 중첩 구조 차이 (if 내부 조건 다름) → 정확한 location dotpath

---

#### Step 1-5: `src/engine/near-miss-detector.ts` — Level 2+3 통합

**인터페이스:**
```typescript
import type { ParsedFile } from './types';

export interface NearMissCloneItem {
  readonly functionNode: unknown;      // AST Node (opaque)
  readonly kind: 'function' | 'method' | 'type' | 'interface' | 'node';
  readonly header: string;
  readonly filePath: string;
  readonly span: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  readonly size: number;
  readonly statementFingerprints: ReadonlyArray<string>;
}

export interface NearMissCloneGroup {
  readonly items: ReadonlyArray<NearMissCloneItem>;
  readonly similarity: number; // 그룹 내 평균 pairwise 유사도
}

export interface NearMissDetectorOptions {
  readonly minSize: number;
  readonly similarityThreshold: number; // LCS 유사도 임계값 (default: 0.7)
  readonly jaccardThreshold: number;    // MinHash pre-filter (default: 0.5)
  readonly minHashK: number;            // MinHash 해시 수 (default: 128)
  readonly sizeRatio: number;           // 크기 비율 필터 (default: 0.5)
}

/**
 * Level 2+3: near-miss 클론 탐지.
 *
 * 절차:
 * 1. 모든 파일에서 isCloneTarget 노드 추출
 * 2. Level 1 해시 그룹에 이미 속한 노드 제외 (excludedHashes)
 * 3. 각 노드의 statement fingerprint 시퀀스 추출
 * 4. bag-of-statement-fingerprints → MinHash 시그니처
 * 5. LSH banding → 후보 쌍
 * 6. 크기 비율 필터
 * 7. 후보 쌍에 LCS 유사도 검증 → threshold 이상이면 확정
 * 8. 전이 폐포로 그룹 형성 (Union-Find)
 */
export const detectNearMissClones = (
  files: ReadonlyArray<ParsedFile>,
  options: NearMissDetectorOptions,
  excludedHashes?: ReadonlySet<string>,
): ReadonlyArray<NearMissCloneGroup>;
```

**의존성:** `minhash.ts`, `lcs.ts`, `statement-fingerprint.ts`, `duplicate-detector.ts`

**테스트 케이스:**
- 빈 파일 배열 → 빈 결과
- Statement 1개만 다른 두 함수 → near-miss 그룹 형성
- 완전 동일 함수 → Level 1에서 잡히므로 excludedHashes로 제외됨
- threshold 0.9에서 80% 유사 함수 → 그룹 미형성
- 3개 함수 A≈B, B≈C → transitive closure로 {A,B,C} 그룹

---

### Phase 2: 통합 Analyzer

#### Step 2-1: `src/features/duplicates/analyzer.ts` — 메인 진입점

**인터페이스:**
```typescript
import type { ParsedFile } from '../../engine/types';
import type { DuplicateGroup } from '../../types';

export interface DuplicatesAnalyzerOptions {
  readonly minSize: number;
  readonly nearMissSimilarityThreshold?: number;  // default: 0.7
  readonly enableNearMiss?: boolean;               // default: true
  readonly enableAntiUnification?: boolean;        // default: true
}

/**
 * 통합 중복 코드 분석기.
 *
 * 절차:
 * 1. Level 1: detectClones('type-1') → exact-clone 그룹
 * 2. Level 1: detectClones('type-2-shape') + ('type-3-normalized')
 *    → structural-clone 그룹
 * 3. Level 2+3: detectNearMissClones() → near-miss-clone 그룹
 * 4. Level 4: 모든 그룹에 anti-unification 적용 → 상세 분류
 *    - structural-clone 그룹 중 literal 차이만 → literal-variant 재분류
 *    - near-miss 그룹 중 유의미 이탈 멤버 → pattern-outlier 마킹
 * 5. 결과 정렬 및 반환
 */
export const analyzeDuplicates = (
  files: ReadonlyArray<ParsedFile>,
  options: DuplicatesAnalyzerOptions,
): ReadonlyArray<DuplicateGroup>;

export const createEmptyDuplicates = (): ReadonlyArray<DuplicateGroup> => [];
```

**그룹 분류 로직 (Level 4 detail):**
```
for each group:
  representative = group.items[0]
  for each member in group.items[1..]:
    result = antiUnify(representative.node, member.node)
    classification = classifyDiff(result)

  if group.cloneType === 'type-1':
    findingKind = 'exact-clone'
  else if all classifications are 'rename-only':
    findingKind = 'structural-clone'
  else if all classifications are 'literal-variant':
    findingKind = 'literal-variant'
  else:
    findingKind = 'structural-clone'  // default

  // Outlier detection within group:
  for each member:
    if member.variableCount > mean + 1.5 * stddev:
      emit separate pattern-outlier finding for this member
```

---

#### Step 2-2: 타입 변경 (`src/types.ts`)

```typescript
// ── FirebatDetector ──
// BEFORE (4개 리터럴):
//   | 'exact-duplicates'
//   | 'structural-duplicates'
//   | 'symmetry-breaking'
//   | 'modification-trap'
// AFTER (1개):
//   | 'duplicates'

// ── DuplicateFindingKind (신규) ──
export type DuplicateFindingKind =
  | 'exact-clone'
  | 'structural-clone'
  | 'near-miss-clone'
  | 'literal-variant'
  | 'pattern-outlier';

// ── DuplicateGroup (확장) ──
export interface DuplicateGroup {
  readonly cloneType: DuplicateCloneType;
  readonly findingKind?: DuplicateFindingKind;  // 신규
  readonly code?: FirebatCatalogCode;
  readonly items: ReadonlyArray<DuplicateItem>;
  readonly suggestedParams?: CloneDiff;
  readonly similarity?: number;                  // 신규: near-miss용
}

// ── DuplicateCloneType (확장) ──
export type DuplicateCloneType =
  | 'type-1'
  | 'type-2'
  | 'type-2-shape'
  | 'type-3-normalized'
  | 'type-3-near-miss';                          // 신규

// ── 삭제 대상 타입 ──
// SymmetryBreakingFinding → 삭제 (DuplicateGroup.findingKind='pattern-outlier'로 대체)
// ModificationTrapFinding → 삭제 (DuplicateGroup.findingKind='literal-variant'로 대체)

// ── FirebatAnalyses (변경) ──
// BEFORE:
//   readonly 'exact-duplicates': ReadonlyArray<DuplicateGroup>;
//   readonly 'structural-duplicates': ReadonlyArray<DuplicateGroup>;
//   readonly 'symmetry-breaking': ReadonlyArray<SymmetryBreakingFinding>;
//   readonly 'modification-trap': ReadonlyArray<ModificationTrapFinding>;
// AFTER:
//   readonly 'duplicates': ReadonlyArray<DuplicateGroup>;
```

---

### Phase 3: 오케스트레이터 통합

#### Step 3-1: `src/application/scan/scan.usecase.ts` 수정

- 4개 import 제거: `detectExactDuplicates`, `analyzeStructuralDuplicates`, `analyzeSymmetryBreaking`, `analyzeModificationTrap`
- 1개 import 추가: `analyzeDuplicates` from `../../features/duplicates`
- 4개 `detectors.includes()` 체크 → 1개로 통합
- 4개 timing 기록 → 1개로 통합
- 결과를 `analyses.duplicates`에 할당

#### Step 3-2: `src/test-api.ts` 수정

- 4개 re-export → `analyzeDuplicates`, `createEmptyDuplicates` 1개로 교체

#### Step 3-3: `src/report.ts` 수정

- 4개 피처의 보고서 렌더링 → `duplicates` 1개 섹션
- `findingKind`별 서브 그룹핑하여 표시

#### Step 3-4: CLI entry 수정 (`src/adapters/cli/entry.ts`)

- detector 이름 목록에서 4개 → 1개로 교체
- `--detector duplicates` 옵션으로 통합

---

### Phase 4: 마이그레이션 & 정리

#### Step 4-1: 하위호환 별칭

config 파일에서 기존 detector 이름 사용 시 → `duplicates`로 자동 매핑.

```typescript
// firebat-config.loader.ts 또는 scan.usecase.ts
const DETECTOR_ALIASES: Record<string, FirebatDetector> = {
  'exact-duplicates': 'duplicates',
  'structural-duplicates': 'duplicates',
  'symmetry-breaking': 'duplicates',
  'modification-trap': 'duplicates',
};
```

#### Step 4-2: 기존 피처 디렉토리 삭제

```
삭제 대상:
  src/features/exact-duplicates/     (3 files: index.ts, detector.ts, detector.spec.ts)
  src/features/structural-duplicates/ (3 files: index.ts, analyzer.ts, analyzer.spec.ts)
  src/features/modification-trap/    (3 files: index.ts, analyzer.ts, analyzer.spec.ts)
  src/features/symmetry-breaking/    (3 files: index.ts, analyzer.ts, analyzer.spec.ts)
```

#### Step 4-3: 기존 통합 테스트 마이그레이션

```
이동/재작성 대상:
  test/integration/features/exact-duplicates/     → test/integration/features/duplicates/
  test/integration/features/structural-duplicates/ → (통합)
  test/integration/features/modification-trap/     → (통합)
```

---

## 4. 파일 변경 매트릭스

| 파일 | 작업 | Phase |
|------|------|-------|
| `src/engine/lcs.ts` | 신규 | 1-1 |
| `src/engine/lcs.spec.ts` | 신규 | 1-1 |
| `src/engine/minhash.ts` | 신규 | 1-2 |
| `src/engine/minhash.spec.ts` | 신규 | 1-2 |
| `src/engine/statement-fingerprint.ts` | 신규 | 1-3 |
| `src/engine/statement-fingerprint.spec.ts` | 신규 | 1-3 |
| `src/engine/anti-unifier.ts` | 신규 | 1-4 |
| `src/engine/anti-unifier.spec.ts` | 신규 | 1-4 |
| `src/engine/near-miss-detector.ts` | 신규 | 1-5 |
| `src/engine/near-miss-detector.spec.ts` | 신규 | 1-5 |
| `src/features/duplicates/index.ts` | 신규 | 2-1 |
| `src/features/duplicates/analyzer.ts` | 신규 | 2-1 |
| `src/features/duplicates/analyzer.spec.ts` | 신규 | 2-1 |
| `src/types.ts` | 수정 | 2-2 |
| `src/engine/duplicate-detector.ts` | 수정 | 2-1 |
| `src/engine/duplicate-collector.ts` | 수정 | 2-1 |
| `src/application/scan/scan.usecase.ts` | 수정 | 3-1 |
| `src/test-api.ts` | 수정 | 3-2 |
| `src/report.ts` | 수정 | 3-3 |
| `src/adapters/cli/entry.ts` | 수정 | 3-4 |
| `src/shared/firebat-config.ts` | 수정 | 4-1 |
| `src/features/exact-duplicates/*` | 삭제 | 4-2 |
| `src/features/structural-duplicates/*` | 삭제 | 4-2 |
| `src/features/modification-trap/*` | 삭제 | 4-2 |
| `src/features/symmetry-breaking/*` | 삭제 | 4-2 |
| `test/integration/features/duplicates/*` | 신규/이동 | 4-3 |

**총계:** 신규 16파일, 수정 8파일, 삭제 12파일

---

## 5. 알고리즘 상세

### 5.1 MinHash

```
Input: bag S = {s₁, s₂, ..., sₙ} (statement fingerprint 문자열)

for i = 1 to k:
  seed_i = BigInt(i) * 0x517CC1B727220A95n  // 각기 다른 seed
  sig[i] = min { xxHash64(s, seed_i) for s in S }

Output: sig[1..k]
```

**LSH Banding:**
```
k = 128, b = 16 bands, r = 8 rows per band
// 한 band에서 r개 sig 값이 모두 일치하면 동일 버킷

for each band j = 0..15:
  bucketKey = hash(sig[j*8], sig[j*8+1], ..., sig[j*8+7])
  buckets[bucketKey].add(itemIndex)

// 같은 버킷에 2개 이상 아이템 → 후보 쌍
```

**Jaccard threshold와 발견 확률:**
- threshold=0.5, b=16, r=8: Pr[발견] ≈ 1-(1-0.5⁸)¹⁶ ≈ 0.9996
- threshold=0.3, b=16, r=8: Pr[발견] ≈ 1-(1-0.3⁸)¹⁶ ≈ 0.001 (거의 0)
- → 0.5 이상 유사한 쌍은 거의 모두 포착, 0.3 미만은 거의 무시

### 5.2 LCS (Hunt-Szymanski)

```
Input: A[0..m-1], B[0..n-1] (statement fingerprint 시퀀스)

1. B의 각 값 → 출현 인덱스 맵 생성
   matchIndex: Map<string, number[]>  // 내림차순 정렬

2. A를 순회하며 patience-sort 유사 방식으로 LCS 구축
   thresh[]: increasing subsequence의 끝 값

Output: LCS 길이 + 정렬된 인덱스 쌍
```

**시간 복잡도:** O((r + n) log n), r = 매칭 쌍 총 수. 해시 기반 atom이므로 r은 보통 작음.

### 5.3 Anti-unification (Plotkin)

```
function antiUnify(left: Node, right: Node, path: string): void
  if left.type !== right.type:
    variables.push({
      path,
      leftType: left.type,
      rightType: right.type,
      kind: 'structural'
    })
    return

  sharedSize += 1

  // 고정 자식 (named properties)
  for key in sortedKeys(left):
    if key is positional/meta: skip
    lVal = left[key], rVal = right[key]

    if both are Node:
      antiUnify(lVal, rVal, path + '.' + key)
    elif both are Node[]:
      // 배열 자식 → LCS 정렬
      alignment = computeLcsAlignment(
        lVal.map(fingerprint),
        rVal.map(fingerprint),
      )
      for (aIdx, bIdx) in alignment.matched:
        antiUnify(lVal[aIdx], rVal[bIdx],
          path + '.' + key + '[' + aIdx + ']')
      for aIdx in alignment.aOnly:
        variables.push({
          path + '.' + key + '[' + aIdx + ']',
          kind: 'structural'
        })
      for bIdx in alignment.bOnly:
        variables.push({
          path + '.' + key + '[' + bIdx + ']',
          kind: 'structural'
        })
    elif both are Identifier.name && differ:
      variables.push({
        path + '.name',
        kind: 'identifier',
        left: lVal, right: rVal
      })
    elif both are Literal.value && differ:
      variables.push({
        path + '.value',
        kind: 'literal',
        left: lVal, right: rVal
      })
    elif both are TSTypeReference && differ:
      variables.push({
        path, kind: 'type',
        left: lVal, right: rVal
      })
```

### 5.4 Outlier Detection

```
Within a clone group G = {f₁, f₂, ..., fₙ}:

1. representative = f₁ (first item, or median-size item)
2. for each fᵢ (i ≥ 2):
   result_i = antiUnify(representative, fᵢ)
   varCount_i = result_i.variables.length

3. mean = avg(varCount_i)
   stddev = sqrt(avg((varCount_i - mean)²))

4. for each fᵢ where varCount_i > mean + 1.5 * stddev:
   → emit pattern-outlier finding for fᵢ
   → include: group info, divergence count, expected count
```

---

## 6. 설정 (Configuration)

### firebatrc 설정 스키마 확장

```json
{
  "duplicates": {
    "minSize": "auto",
    "nearMiss": {
      "enabled": true,
      "similarityThreshold": 0.7,
      "jaccardThreshold": 0.5,
      "minHashK": 128
    }
  }
}
```

하위호환: 기존 `exact-duplicates.minSize`, `structural-duplicates.minSize` → `duplicates.minSize`로 매핑.

---

## 7. 커밋 전략

| 커밋 | 내용 | Phase |
|------|------|-------|
| 1 | `feat(engine): add LCS algorithm` | 1-1 |
| 2 | `feat(engine): add MinHash/LSH` | 1-2 |
| 3 | `feat(engine): add statement fingerprinting` | 1-3 |
| 4 | `feat(engine): add anti-unification` | 1-4 |
| 5 | `feat(engine): add near-miss clone detector` | 1-5 |
| 6 | `feat(duplicates): unified duplicates analyzer` | 2-1 |
| 7 | `refactor(types): merge 4 duplicate detectors into 1` | 2-2 + 3-* |
| 8 | `refactor: remove legacy duplicate features` | 4-* |

각 커밋은 독립적으로 빌드 + 테스트 통과해야 함.
커밋 7까지는 기존 4개 피처가 병행 존재 (deprecate 상태).
커밋 8에서 최종 삭제.

---

## 8. 위험 요소 및 완화

| 위험 | 영향 | 완화 |
|------|------|------|
| MinHash 시그니처 계산 성능 | 대규모 프로젝트 (20K+ 함수)에서 느려질 수 있음 | k=128은 보수적, 프로파일링 후 k 조정 가능 |
| LCS O(n²) worst case | statement 수 100+ 함수에서 느릴 수 있음 | Hunt-Szymanski로 평균 O(r log n), 최악 시 early termination |
| Anti-unification 배열 정렬 | BlockStatement.body가 매우 길 때 | LCS 정렬 선행 → 매칭된 쌍만 재귀, 미매칭은 바로 variable |
| 하위호환 깨짐 | 기존 config 사용자 | detector alias 매핑으로 완화 |
| 기존 테스트 대량 수정 | 통합 테스트 변경 범위 | Phase 4에서 일괄 마이그레이션, 기존 테스트 로직 보존 |
| gildash FK 제약 조건 | scan 실행 시 DB 에러 (기존 blocker) | 이 계획과 독립, 별도 수정 필요 |
