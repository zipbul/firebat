# Duplicates Detector 통합 계획

> 4개 피처(exact-duplicates, structural-duplicates, modification-trap, symmetry-breaking)를
> 1개의 `duplicates` 디텍터로 통합하는 상세 개발 계획.
> 코드·디렉토리·테스트를 모두 `src/features/duplicates/`로 완전 통합한다.

---

## 1. 현재 상태 분석

### 1.1 통합 대상 피처

| 피처 | 파일 | LOC | 알고리즘 | 출력 타입 |
|------|------|-----|---------|----------|
| exact-duplicates | `src/features/exact-duplicates/detector.ts` | 14 | `detectClones('type-1')` | `DuplicateGroup[]` |
| structural-duplicates | `src/features/structural-duplicates/analyzer.ts` | 20 | `detectClones('type-2-shape')` + `detectClones('type-3-normalized')` | `DuplicateGroup[]` |
| modification-trap | `src/features/modification-trap/analyzer.ts` | 143 | Regex: case 라벨 + 리터럴 비교 추출 → 패턴 그룹핑 | `ModificationTrapFinding[]` |
| symmetry-breaking | `src/features/symmetry-breaking/analyzer.ts` | 202 | Regex: Handler/Controller suffix + no-arg call sequence → 다수결 투표 | `SymmetryBreakingFinding[]` |

### 1.2 기존 엔진 (duplicates 전용 — 삭제 대상)

| 파일 | LOC | 역할 | 통합 후 처리 |
|------|-----|------|-------------|
| `src/engine/duplicate-detector.ts` | 80 | `isCloneTarget`, `resolveFingerprint`, `detectClones` | **삭제** — `analyzer.ts`에 재작성 (~35줄) |
| `src/engine/duplicate-collector.ts` | 191 | `collectDuplicateGroups` (해시 그룹핑), `computeCloneDiff` | **삭제** — hash 그룹핑 `analyzer.ts` 인라인 (~50줄), `computeCloneDiff`는 anti-unifier가 상위 대체 |

*삭제 근거:* 이 두 파일을 import하는 곳은 오직 `exact-duplicates/detector.ts`, `structural-duplicates/analyzer.ts`, `test-api.ts` — 모두 통합 과정에서 제거되는 파일들이다.

### 1.3 기존 엔진 (범용 — 유지)

| 파일 | LOC | 역할 | 사용처 |
|------|-----|------|--------|
| `src/engine/ast/oxc-fingerprint.ts` | 211 | 4종 fingerprint: `createOxcFingerprintExact` (Type-1), `createOxcFingerprint` (Type-2), `createOxcFingerprintShape` (Type-2-shape), `createOxcFingerprintNormalized` (Type-3) | duplicates + 향후 AST 비교 |
| `src/engine/ast/ast-normalizer.ts` | — | `normalizeForFingerprint` (fingerprint 전처리) | oxc-fingerprint 의존 |
| `src/engine/ast/oxc-ast-utils.ts` | — | AST 순회/노드 유틸 | 20+ 피처/엔진 |
| `src/engine/ast/oxc-size-count.ts` | 42 | AST 노드 수 카운팅 | auto-min-size + duplicates |
| `src/engine/hasher.ts` | 17 | `Bun.hash.xxHash64` 래퍼 | 6곳 (scan, trace 등) |
| `src/engine/auto-min-size.ts` | 39 | 자동 minSize 계산 | scan.usecase |

### 1.4 통합 지점

| 위치 | 참조 방식 |
|------|----------|
| `src/application/scan/scan.usecase.ts` | 4개 함수 개별 import + 개별 호출 |
| `src/test-api.ts` | 4개 함수 re-export |
| `src/types.ts` → `FirebatDetector` | 4개 문자열 리터럴 |
| `src/types.ts` → `FirebatAnalyses` | 4개 필드 |
| `test/integration/features/exact-duplicates/*.test.ts` | 5개 테스트 |
| `test/integration/features/structural-duplicates/*.test.ts` | 3개 테스트 (analysis, golden, type-3-normalized) |
| `test/integration/features/modification-trap/*.test.ts` | 2개 테스트 (analysis, golden) |
| `test/integration/features/symmetry-breaking/*.test.ts` | 2개 테스트 (analysis, golden) |

---

## 2. 목표 아키텍처

### 2.1 알고리즘: 4-Level 하이브리드 클론 탐지

```
Input: OXC 파싱된 AST 함수들

┌─ Level 1: Hash 기반 정확 매칭 ─────────────────────────────┐
│ type-1 fingerprint → exact-clone 그룹                       │
│ type-2-shape fingerprint → structural-clone 그룹            │
│ type-3-normalized fingerprint → structural-clone 그룹       │
│ (hash Map 그룹핑 — analyzer.ts 인라인)                       │
└─────────────────────────────────────────────────────────────┘
         │ 그룹에 속하지 않은 함수들
         ▼
┌─ Level 2: MinHash Pre-filter ───────────────────────────────┐
│ 함수별: statement 단위 type-2-shape fingerprint 생성         │
│ bag-of-statement-fingerprints → MinHash 시그니처 (k=128)    │
│ LSH banding → 후보 쌍 (estimated Jaccard ≥ threshold)       │
│ 크기 필터: AST 노드 수 ±50% 이내만 비교                      │
│ (statement ＜ 5개 → MinHash 생략, 직접 pairwise LCS)         │
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
│ 그룹 내 representative(median-size) × 각 멤버               │
│ Plotkin anti-unification → 차이점(변수) 분류:                │
│  - Identifier만 다름 → structural-clone                      │
│  - Literal만 다름 → literal-variant (modification-trap)      │
│  - 구조적 차이 → near-miss-clone                             │
│  - 변수 수 >> 그룹 평균 → pattern-outlier (symmetry-break)   │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 알고리즘 선정 근거

| 단계 | 알고리즘 | 선정 이유 |
|------|----------|----------|
| Level 1 | Hash exact match | Type-1/2에 **수학적 완전** (false positive 0). |
| Level 2 | MinHash/LSH | 집합 유사도 pre-filtering에 **확률론적 최적**. Pr[h(A)=h(B)] = Jaccard(A,B). |
| Level 3 | LCS | 문장 삽입/삭제 패턴(가장 흔한 Type-3)에 **최적 DP**. Hunt-Szymanski O(r log n). |
| Level 4 | Anti-unification | 구조 비교에서 **정보량 최대** — 파라미터화 템플릿 + 정확한 차이점 추출. Plotkin O(\|T₁\|+\|T₂\|). |

**기각한 대안:**

| 대안 | 기각 이유 |
|------|----------|
| 순수 SourcererCC (token Jaccard) | 토큰 순서 정보 손실 → 재배치된 코드에서 false positive 높음 |
| Deckard (특성 벡터) | AST 노드 타입 카운트만 사용 → 세부 구조 손실 |
| 순수 Tree edit distance | anti-unification보다 비용 크고 "공유 템플릿" 대신 "편집 수"만 제공 |
| PDG 기반 | Type-4(의미적 클론) 탐지용, NP-hard, 이 프로젝트 범위 밖 |

**출처:**
- SourcererCC: arXiv:1512.06448 (ICSE'16), Sajnani et al.
- Anti-unification: Plotkin (1970), Bulychev & Minea (2008) "Duplicate Code Detection Using Anti-Unification"
- MinHash/LSH: Broder et al. (1997), Wikipedia "Locality-sensitive hashing"

### 2.3 Finding 종류

```typescript
type DuplicateFindingKind =
  | 'exact-clone'        // Type-1: 동일 코드
  | 'structural-clone'   // Type-2: 구조 동일, identifier/literal/type만 다름
  | 'near-miss-clone'    // Type-3: statement 수준 편집 있는 유사 코드
  | 'literal-variant'    // modification-trap: 같은 분기 구조, 다른 리터럴 값
  | 'pattern-outlier';   // symmetry-breaking: 그룹에서 유의미 이탈 멤버
```

**findingKind → FirebatCatalogCode 매핑:**

| findingKind | catalogCode | 신규/기존 |
|-------------|-------------|----------|
| `exact-clone` | `EXACT_DUP_TYPE_1` | 기존 |
| `structural-clone` | `STRUCT_DUP_TYPE_2_SHAPE` 또는 `STRUCT_DUP_TYPE_3_NORMALIZED` (cloneType 기준) | 기존 |
| `near-miss-clone` | `DUP_NEAR_MISS` | **신규** |
| `literal-variant` | `MOD_TRAP` | 기존 재활용 |
| `pattern-outlier` | `SYMMETRY_BREAK` | 기존 재활용 |

### 2.4 디렉토리 구조 (최종)

```
src/features/duplicates/
  index.ts                       # public API re-export
  types.ts                       # 내부 타입 (InternalCloneGroup, InternalCloneItem)
  analyzer.ts                    # Level 1(인라인) + Level 2~4 오케스트레이션
  analyzer.spec.ts
  near-miss-detector.ts          # Level 2+3 (MinHash/LSH + LCS 검증)
  near-miss-detector.spec.ts
  anti-unifier.ts                # Level 4 (Plotkin anti-unification)
  anti-unifier.spec.ts
  lcs.ts                         # 순수 알고리즘: LCS
  lcs.spec.ts
  minhash.ts                     # 순수 알고리즘: MinHash/LSH
  minhash.spec.ts
  statement-fingerprint.ts       # statement 단위 fingerprint
  statement-fingerprint.spec.ts
```

**설계 원칙:**
- duplicates 관련 모든 코드가 **한 디렉토리**에 존재 (self-contained module)
- 범용 인프라(`engine/ast/*`, `engine/hasher.ts`)만 외부 import
- `lcs.ts`, `minhash.ts` 등 순수 알고리즘이 향후 다른 피처에서 필요해지면 `engine/`으로 promote (YAGNI)

---

## 3. 구현 단계

### Phase 0: 기반 작업 (코드 변경 없음) 🤖 Sonnet

#### Step 0-1: 기존 테스트 스냅샷
- `bun test` 실행, 현재 통과/실패 수 기록
- 4개 피처의 기존 테스트 파일 목록 확인:
  - `src/features/exact-duplicates/detector.spec.ts`
  - `src/features/structural-duplicates/analyzer.spec.ts`
  - `src/features/modification-trap/analyzer.spec.ts`
  - `src/features/symmetry-breaking/analyzer.spec.ts`
  - `test/integration/features/exact-duplicates/*.test.ts` (5개: analysis, golden, fuzz, blocks-fuzz, noise-fuzz)
  - `test/integration/features/structural-duplicates/*.test.ts` (3개: analysis, golden, type-3-normalized)
  - `test/integration/features/modification-trap/*.test.ts` (2개: analysis, golden)
  - `test/integration/features/symmetry-breaking/*.test.ts` (2개: analysis, golden)

---

### Phase 1: 신규 모듈 (하위 → 상위)

#### Step 1-1: `src/features/duplicates/lcs.ts` — LCS 알고리즘 🤖 Sonnet

**인터페이스:**
```typescript
/**
 * 두 문자열 배열의 Longest Common Subsequence 길이를 계산한다.
 * Hunt-Szymanski 알고리즘 (평균 O(r log n), 최악 O(n²)).
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
  readonly aOnly: ReadonlyArray<number>;
  readonly bOnly: ReadonlyArray<number>;
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

#### Step 1-2: `src/features/duplicates/minhash.ts` — MinHash + LSH 🤖 Sonnet

**인터페이스:**
```typescript
export interface MinHasher {
  readonly computeSignature: (
    items: ReadonlyArray<string>,
  ) => ReadonlyArray<bigint>;
}

export const createMinHasher = (k?: number): MinHasher;
// default k=128

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

**의존성:** `../../engine/hasher.ts` (xxHash64)

**테스트 케이스:**
- 동일 bag → 시그니처 동일 → 반드시 후보 쌍
- 완전 불일치 bag → 후보 아님
- Jaccard 0.8인 두 bag → threshold 0.7에서 후보
- Jaccard 0.3인 두 bag → threshold 0.5에서 후보 아님
- 빈 bag → 시그니처 계산 가능 (에러 없음)
- 1000개 아이템, 500개 bag → < 500ms (성능)

---

#### Step 1-3: `src/features/duplicates/statement-fingerprint.ts` — Statement 단위 Fingerprint 🤖 Sonnet

**인터페이스:**
```typescript
import type { Node } from 'oxc-parser';

/**
 * 함수 AST 노드에서 top-level statement별 fingerprint 시퀀스를 추출한다.
 *
 * 1. 함수 body의 직계 statement 노드들을 순서대로 추출
 * 2. 각 statement에 대해 type-2-shape fingerprint 생성
 * 3. fingerprint 문자열 배열 반환
 *
 * ArrowFunction expression body → 단일 statement로 취급.
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

**의존성:** `../../engine/ast/oxc-fingerprint.ts` (`createOxcFingerprintShape`), `../../engine/ast/oxc-ast-utils.ts`

**테스트 케이스:**
- 빈 함수 body → 빈 배열
- 3개 statement 함수 → 3개 fingerprint
- 동일 구조 다른 이름 두 함수 → 동일 fingerprint 시퀀스
- ArrowFunction expression body → 1개 fingerprint
- 중첩 함수 → 외부 함수의 statement만 추출 (내부 함수는 하나의 statement로)

---

#### Step 1-4: `src/features/duplicates/anti-unifier.ts` — Anti-unification (Plotkin's lgg) 🤖 Opus

**인터페이스:**
```typescript
import type { Node } from 'oxc-parser';

export interface AntiUnificationVariable {
  readonly id: number;
  readonly location: string;    // dotpath (예: "body[0].consequent.body[2]")
  readonly leftType: string;
  readonly rightType: string;
  readonly kind: 'identifier' | 'literal' | 'type' | 'structural';
}

export interface AntiUnificationResult {
  readonly sharedSize: number;
  readonly leftSize: number;
  readonly rightSize: number;
  readonly similarity: number;  // sharedSize / max(leftSize, rightSize)
  readonly variables: ReadonlyArray<AntiUnificationVariable>;
}

/**
 * 두 AST 노드의 anti-unification을 수행한다.
 *
 * Plotkin's algorithm:
 * - 같은 type → 재귀적 자식 비교
 * - 다른 type → 변수(차이점) 생성
 * - 배열 자식(BlockStatement.body 등) → LCS 정렬 후 매칭된 쌍만 재귀
 */
export const antiUnify = (
  left: Node,
  right: Node,
): AntiUnificationResult;

export type DiffClassification =
  | 'rename-only'
  | 'literal-variant'
  | 'structural-diff'
  | 'mixed';

export const classifyDiff = (
  result: AntiUnificationResult,
): DiffClassification;
```

**의존성:** `./lcs.ts` (`computeLcsAlignment`), `../../engine/ast/oxc-fingerprint.ts` (`createOxcFingerprintShape`), `../../engine/ast/oxc-ast-utils.ts`, `../../engine/ast/oxc-size-count.ts`

**테스트 케이스:**
- 동일 노드 → variables 빈 배열, similarity 1.0
- Identifier만 다른 두 함수 → kind='identifier' 변수만 생성, classify='rename-only'
- Literal만 다른 두 함수 → kind='literal' 변수만 생성, classify='literal-variant'
- Statement 추가된 함수 → kind='structural' 변수 포함, classify='structural-diff'
- 완전히 다른 두 함수 → similarity ≈ 0, variables 다수
- 중첩 구조 차이 (if 내부 조건 다름) → 정확한 location dotpath

---

#### Step 1-5: `src/features/duplicates/near-miss-detector.ts` — Level 2+3 통합 🤖 Opus

**인터페이스:**
```typescript
import type { Node } from 'oxc-parser';
import type { SourceSpan, FirebatItemKind } from '../../types';
import type { ParsedFile } from '../../engine/types';

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
  readonly similarityThreshold: number; // LCS 유사도 임계값 (default: 0.7)
  readonly jaccardThreshold: number;    // MinHash pre-filter (default: 0.5)
  readonly minHashK: number;            // MinHash 해시 수 (default: 128)
  readonly sizeRatio: number;           // 크기 비율 필터 (default: 0.5)
  readonly minStatementCount: number;   // MinHash 최소 statement 수 (default: 5)
}

/**
 * Level 2+3: near-miss 클론 탐지.
 *
 * 1. 모든 파일에서 clone 대상 노드 추출
 * 2. Level 1 해시 그룹에 이미 속한 노드 제외 (excludedHashes)
 * 3. 각 노드의 statement fingerprint 시퀀스 추출
 * 4. statement ≥ minStatementCount → MinHash/LSH, 미만 → 직접 pairwise
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

**의존성:** `./minhash.ts`, `./lcs.ts`, `./statement-fingerprint.ts`, `../../engine/ast/oxc-ast-utils.ts`, `../../engine/ast/oxc-size-count.ts`, `../../engine/ast/oxc-fingerprint.ts`, `../../engine/source-position.ts`

**테스트 케이스:**
- 빈 파일 배열 → 빈 결과
- Statement 1개만 다른 두 함수 → near-miss 그룹 형성
- 완전 동일 함수 → Level 1에서 잡히므로 excludedHashes로 제외됨
- threshold 0.9에서 80% 유사 함수 → 그룹 미형성
- 3개 함수 A≈B, B≈C → transitive closure로 {A,B,C} 그룹
- statement 3개 함수 (< minStatementCount) → MinHash 생략, 직접 LCS 비교

---

#### Step 1-6: `src/features/duplicates/types.ts` — 내부 타입 🤖 Sonnet

```typescript
import type { Node } from 'oxc-parser';
import type { DuplicateCloneType, FirebatItemKind, SourceSpan } from '../../types';

/**
 * 내부 처리용 클론 아이템.
 * AST Node를 보존하여 Level 4 anti-unification에서 사용.
 * 최종 출력 시 node를 drop하여 DuplicateItem으로 변환.
 */
export interface InternalCloneItem {
  readonly node: Node;
  readonly kind: FirebatItemKind;
  readonly header: string;
  readonly filePath: string;
  readonly span: SourceSpan;
  readonly size: number;
}

/**
 * 내부 처리용 클론 그룹.
 * Level 1~3 → InternalCloneGroup[] 형태로 수집
 * Level 4 → node를 이용해 antiUnify 수행
 * 최종 출력 → node drop → DuplicateGroup[]
 */
export interface InternalCloneGroup {
  readonly cloneType: DuplicateCloneType;
  readonly items: ReadonlyArray<InternalCloneItem>;
  readonly similarity?: number;
}
```

---

### Phase 2: 통합 Analyzer 🤖 Opus

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
  readonly minStatementCount?: number;             // default: 5
}

/**
 * 통합 중복 코드 분석기.
 *
 * Level 1: Hash 기반 그룹핑 (인라인)
 *   - 파일 순회 → isCloneTarget(node) → size 필터 → fingerprint(node) → Map<hash, InternalCloneItem[]>
 *   - type-1 → exact-clone, type-2-shape/type-3-normalized → structural-clone
 *
 * Level 2+3: detectNearMissClones()
 *   - Level 1에서 미그룹핑된 노드 대상
 *   - MinHash/LSH pre-filter + LCS 유사도 검증
 *
 * Level 4: 모든 그룹에 anti-unification 적용
 *   - InternalCloneGroup의 node를 직접 사용 (drop 전)
 *   - structural-clone 중 literal 차이만 → literal-variant 재분류
 *   - near-miss 중 유의미 이탈 멤버 → pattern-outlier 마킹
 *
 * 최종: InternalCloneGroup → DuplicateGroup 변환 (node drop)
 */
export const analyzeDuplicates = (
  files: ReadonlyArray<ParsedFile>,
  options: DuplicatesAnalyzerOptions,
): ReadonlyArray<DuplicateGroup>;

export const createEmptyDuplicates = (): ReadonlyArray<DuplicateGroup> => [];
```

**Level 1 인라인 로직 (~50줄):**
```typescript
// isCloneTarget: 8개 AST 노드 타입 체크
const isCloneTarget = (node: Node): boolean => { ... };

// getItemKind: 노드 → FirebatItemKind 매핑
const getItemKind = (node: Node): FirebatItemKind => { ... };

// Level 1 hash 그룹핑
const groupByHash = (
  files: ReadonlyArray<ParsedFile>,
  minSize: number,
  fingerprintFn: (node: Node) => string,
  cloneType: DuplicateCloneType,
): InternalCloneGroup[] => {
  const map = new Map<string, InternalCloneItem[]>();
  for (const file of files) {
    if (file.errors.length > 0) continue;
    for (const node of collectOxcNodes(file.program, isCloneTarget)) {
      const size = countOxcSize(node);
      if (size < minSize) continue;
      const hash = fingerprintFn(node);
      // ... Map에 추가
    }
  }
  // 2개 이상인 그룹만 반환
};
```

**Outlier detection (Level 4 detail):**
```
for each group:
  representative = group에서 AST 노드 수가 median에 가장 가까운 멤버
  for each member (≠ representative):
    result = antiUnify(representative.node, member.node)
    classification = classifyDiff(result)
    varCount = result.variables.length

  if group.cloneType === 'type-1':
    findingKind = 'exact-clone'
  else if all classifications are 'rename-only':
    findingKind = 'structural-clone'
  else if all classifications are 'literal-variant':
    findingKind = 'literal-variant'
  else:
    findingKind = 'structural-clone'  // default

  // Outlier detection:
  mean = avg(varCount per member)
  stddev = sqrt(avg((varCount - mean)²))
  for each member where varCount > mean + 1.5 * stddev:
    → emit separate pattern-outlier finding
```

---

#### Step 2-2: 타입 변경 (`src/types.ts`) 🤖 Sonnet

```typescript
// ── FirebatDetector ──
// BEFORE: | 'exact-duplicates' | 'structural-duplicates' | 'symmetry-breaking' | 'modification-trap'
// AFTER:  | 'duplicates'

// ── FirebatCatalogCode (추가) ──
// + | 'DUP_NEAR_MISS'

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
  readonly findingKind: DuplicateFindingKind;     // 커밋 6까지 optional, 커밋 7부터 required
  readonly code?: FirebatCatalogCode;
  readonly items: ReadonlyArray<DuplicateItem>;
  readonly suggestedParams?: CloneDiff;
  readonly similarity?: number;                    // near-miss 유사도
}

// ── DuplicateCloneType (확장) ──
export type DuplicateCloneType =
  | 'type-1'
  | 'type-2'
  | 'type-2-shape'
  | 'type-3-normalized'
  | 'type-3-near-miss';                            // 신규

// ── 삭제 대상 타입 ──
// SymmetryBreakingFinding → 삭제 (findingKind='pattern-outlier'로 대체)
// ModificationTrapFinding → 삭제 (findingKind='literal-variant'로 대체)

// ── FirebatAnalyses (변경) ──
// BEFORE: 4개 필드 (exact-duplicates, structural-duplicates, symmetry-breaking, modification-trap)
// AFTER:  readonly 'duplicates': ReadonlyArray<DuplicateGroup>;
```

**findingKind optional → required 전환 전략:**
- 커밋 6 (통합 analyzer 도입)까지: `findingKind?` — 기존 코드 경로 병행
- 커밋 7 (오케스트레이터 통합): `findingKind` — 모든 DuplicateGroup이 `analyzeDuplicates()`에서만 생성
- 커밋 8 (레거시 삭제) 이후: required 확정

---

### Phase 3: 오케스트레이터 통합 🤖 Sonnet

#### Step 3-1: `src/application/scan/scan.usecase.ts` 수정

- 4개 import 제거: `detectExactDuplicates`, `analyzeStructuralDuplicates`, `analyzeSymmetryBreaking`, `analyzeModificationTrap`
- 1개 import 추가: `analyzeDuplicates` from `../../features/duplicates`
- 4개 `detectors.includes()` 체크 → 1개로 통합
- 4개 timing 기록 → 1개로 통합
- 결과를 `analyses.duplicates`에 할당

#### Step 3-2: `src/test-api.ts` 수정

- 4개 re-export 제거
- `analyzeDuplicates`, `createEmptyDuplicates` re-export 추가

#### Step 3-3: `src/report.ts` 수정

- 4개 피처의 보고서 렌더링 → `duplicates` 1개 섹션
- `findingKind`별 서브 그룹핑하여 표시

#### Step 3-4: CLI entry 수정 (`src/adapters/cli/entry.ts`)

- detector 이름 목록에서 4개 → 1개로 교체
- `--detector duplicates` 옵션으로 통합

---

### Phase 4: 마이그레이션 & 정리 🤖 Sonnet

#### Step 4-1: 하위호환 별칭

config 파일에서 기존 detector 이름 사용 시 → `duplicates`로 자동 매핑.

```typescript
const DETECTOR_ALIASES: Record<string, FirebatDetector> = {
  'exact-duplicates': 'duplicates',
  'structural-duplicates': 'duplicates',
  'symmetry-breaking': 'duplicates',
  'modification-trap': 'duplicates',
};
```

#### Step 4-2: 기존 코드 삭제

```
features/ 삭제 대상 (12파일):
  src/features/exact-duplicates/      (index.ts, detector.ts, detector.spec.ts)
  src/features/structural-duplicates/ (index.ts, analyzer.ts, analyzer.spec.ts)
  src/features/modification-trap/     (index.ts, analyzer.ts, analyzer.spec.ts)
  src/features/symmetry-breaking/     (index.ts, analyzer.ts, analyzer.spec.ts)

engine/ 삭제 대상 (4파일):
  src/engine/duplicate-detector.ts
  src/engine/duplicate-detector.spec.ts
  src/engine/duplicate-collector.ts
  src/engine/duplicate-collector.spec.ts
```

#### Step 4-3: 기존 통합 테스트 마이그레이션

```
이동/재작성 대상:
  test/integration/features/exact-duplicates/      → test/integration/features/duplicates/
  test/integration/features/structural-duplicates/  → (통합)
  test/integration/features/modification-trap/      → (통합)
  test/integration/features/symmetry-breaking/      → (통합)
```

---

## 4. 파일 변경 매트릭스

### 신규 (14파일)

| 파일 | Phase | 담당 |
|------|-------|------|
| `src/features/duplicates/types.ts` | 1-6 | Sonnet |
| `src/features/duplicates/lcs.ts` | 1-1 | Sonnet |
| `src/features/duplicates/lcs.spec.ts` | 1-1 | Sonnet |
| `src/features/duplicates/minhash.ts` | 1-2 | Sonnet |
| `src/features/duplicates/minhash.spec.ts` | 1-2 | Sonnet |
| `src/features/duplicates/statement-fingerprint.ts` | 1-3 | Sonnet |
| `src/features/duplicates/statement-fingerprint.spec.ts` | 1-3 | Sonnet |
| `src/features/duplicates/anti-unifier.ts` | 1-4 | Opus |
| `src/features/duplicates/anti-unifier.spec.ts` | 1-4 | Opus |
| `src/features/duplicates/near-miss-detector.ts` | 1-5 | Opus |
| `src/features/duplicates/near-miss-detector.spec.ts` | 1-5 | Opus |
| `src/features/duplicates/analyzer.ts` | 2-1 | Opus |
| `src/features/duplicates/analyzer.spec.ts` | 2-1 | Opus |
| `src/features/duplicates/index.ts` | 2-1 | Sonnet |

### 수정 (5파일)

| 파일 | Phase | 담당 |
|------|-------|------|
| `src/types.ts` | 2-2 | Sonnet |
| `src/application/scan/scan.usecase.ts` | 3-1 | Sonnet |
| `src/test-api.ts` | 3-2 | Sonnet |
| `src/report.ts` | 3-3 | Sonnet |
| `src/adapters/cli/entry.ts` | 3-4 | Sonnet |

### 삭제 (16파일)

| 파일 | Phase | 담당 |
|------|-------|------|
| `src/engine/duplicate-detector.ts` (+spec) | 4-2 | Sonnet |
| `src/engine/duplicate-collector.ts` (+spec) | 4-2 | Sonnet |
| `src/features/exact-duplicates/*` (3파일) | 4-2 | Sonnet |
| `src/features/structural-duplicates/*` (3파일) | 4-2 | Sonnet |
| `src/features/modification-trap/*` (3파일) | 4-2 | Sonnet |
| `src/features/symmetry-breaking/*` (3파일) | 4-2 | Sonnet |

### 마이그레이션

| 대상 | Phase | 담당 |
|------|-------|------|
| `test/integration/features/duplicates/*` (신규/이동) | 4-3 | Sonnet |

**총계:** 신규 14파일, 수정 5파일, 삭제 16파일

---

## 5. 알고리즘 상세

### 5.1 MinHash

```
Input: bag S = {s₁, s₂, ..., sₙ} (statement fingerprint 문자열)

for i = 1 to k:
  seed_i = BigInt(i) * 0x517CC1B727220A95n
  sig[i] = min { xxHash64(s, seed_i) for s in S }

Output: sig[1..k]
```

**LSH Banding:**
```
k = 128, b = 16 bands, r = 8 rows per band

for each band j = 0..15:
  bucketKey = hash(sig[j*8], sig[j*8+1], ..., sig[j*8+7])
  buckets[bucketKey].add(itemIndex)

// 같은 버킷에 2개 이상 아이템 → 후보 쌍
```

**Jaccard threshold와 발견 확률:**
- threshold=0.5, b=16, r=8: Pr[발견] ≈ 1-(1-0.5⁸)¹⁶ ≈ 0.9996
- threshold=0.3, b=16, r=8: Pr[발견] ≈ 1-(1-0.3⁸)¹⁶ ≈ 0.001 (거의 0)
- → 0.5 이상은 거의 모두 포착, 0.3 미만은 거의 무시

**소규모 함수 fallback:**
- statement 수 < `minStatementCount`(default: 5)인 함수 → MinHash/LSH 생략
- 직접 pairwise LCS 유사도 비교 수행 (함수 수가 적으므로 비용 무시 가능)
- 근거: k=128 시그니처가 bag 크기 대비 과대 → 의미 있는 Jaccard 추정 불가

### 5.2 LCS (Hunt-Szymanski)

```
Input: A[0..m-1], B[0..n-1] (statement fingerprint 시퀀스)

1. B의 각 값 → 출현 인덱스 맵 생성
   matchIndex: Map<string, number[]>  // 내림차순 정렬

2. A를 순회하며 patience-sort 유사 방식으로 LCS 구축
   thresh[]: increasing subsequence의 끝 값

Output: LCS 길이 + 정렬된 인덱스 쌍
```

**시간 복잡도:** O((r + n) log n), r = 매칭 쌍 총 수.

### 5.3 Anti-unification (Plotkin)

```
function antiUnify(left: Node, right: Node, path: string): void
  if left.type !== right.type:
    variables.push({ path, leftType: left.type, rightType: right.type, kind: 'structural' })
    return

  sharedSize += 1

  for key in sortedKeys(left):
    if key is positional/meta: skip
    lVal = left[key], rVal = right[key]

    if both are Node:
      antiUnify(lVal, rVal, path + '.' + key)
    elif both are Node[]:
      // 배열 자식 → LCS 정렬
      alignment = computeLcsAlignment(
        lVal.map(n => createOxcFingerprintShape(n)),
        rVal.map(n => createOxcFingerprintShape(n)),
      )
      for (aIdx, bIdx) in alignment.matched:
        antiUnify(lVal[aIdx], rVal[bIdx], path + '.' + key + '[' + aIdx + ']')
      for aIdx in alignment.aOnly:
        variables.push({ path + '.' + key + '[' + aIdx + ']', kind: 'structural' })
      for bIdx in alignment.bOnly:
        variables.push({ path + '.' + key + '[' + bIdx + ']', kind: 'structural' })
    elif both are Identifier.name && differ:
      variables.push({ path + '.name', kind: 'identifier', left: lVal, right: rVal })
    elif both are Literal.value && differ:
      variables.push({ path + '.value', kind: 'literal', left: lVal, right: rVal })
    elif both are TSTypeReference && differ:
      variables.push({ path, kind: 'type', left: lVal, right: rVal })
```

### 5.4 Outlier Detection

```
Within a clone group G = {f₁, f₂, ..., fₙ}:

1. representative = AST 노드 수가 median에 가장 가까운 멤버

2. for each fᵢ (≠ representative):
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
      "minHashK": 128,
      "minStatementCount": 5
    }
  }
}
```

하위호환: 기존 `exact-duplicates.minSize`, `structural-duplicates.minSize` → `duplicates.minSize`로 매핑.

---

## 7. 에러 처리 전략

| 상황 | 처리 |
|------|------|
| 파싱 에러 있는 파일 | 기존 패턴 유지: `file.errors.length > 0` → skip |
| Level 2/3 실패 (MinHash/LCS) | Level 1 결과만 반환 (graceful degradation) |
| Level 4 실패 (anti-unification) | findingKind를 cloneType 기반 기본값 사용 (type-1→exact-clone 등) |
| 과도한 함수 수 (20K+) | PromisePool 활용, 기존 배치 처리 패턴 유지 |

---

## 8. 커밋 전략

| 커밋 | 내용 | Phase | 담당 |
|------|------|-------|------|
| 1 | `feat(duplicates): add LCS algorithm` | 1-1 | Sonnet |
| 2 | `feat(duplicates): add MinHash/LSH` | 1-2 | Sonnet |
| 3 | `feat(duplicates): add statement fingerprinting` | 1-3 | Sonnet |
| 4 | `feat(duplicates): add anti-unification` | 1-4 | Opus |
| 5 | `feat(duplicates): add near-miss clone detector` | 1-5 | Opus |
| 6 | `feat(duplicates): unified duplicates analyzer` | 1-6 + 2-1 | Opus |
| 7 | `refactor(types): merge 4 duplicate detectors into 1` | 2-2 + 3-* | Sonnet |
| 8 | `refactor: remove legacy duplicate features and engine` | 4-* | Sonnet |

각 커밋은 독립적으로 빌드 + 테스트 통과해야 함.
커밋 7까지는 기존 4개 피처가 병행 존재 (deprecate 상태).
커밋 8에서 features/ 4개 디렉토리 + engine/ 2파일 최종 삭제.

---

## 9. 모델 배정 근거

| 모델 | 배정 기준 | 배정된 작업 |
|------|----------|------------|
| **Opus** | 알고리즘 설계 판단, 복잡한 AST 재귀 순회, 다중 모듈 오케스트레이션 | anti-unifier, near-miss-detector, analyzer |
| **Sonnet** | 명확한 인터페이스의 순수 함수 구현, 기계적 리팩토링, 파일 이동/삭제 | lcs, minhash, statement-fingerprint, types 수정, Phase 3~4 전체 |

**배정 상세:**

- **Opus 필수 (커밋 4, 5, 6):**
  - `anti-unifier` — Plotkin 알고리즘의 AST 재귀 + LCS 정렬 + 차이점 분류를 정확하게 조합
  - `near-miss-detector` — MinHash fallback 분기 + Union-Find transitive closure + excludedHashes 통합
  - `analyzer` — Level 1~4 파이프라인 오케스트레이션 + InternalCloneGroup → DuplicateGroup 변환 + outlier detection 통계

- **Sonnet 충분 (커밋 1, 2, 3, 7, 8):**
  - `lcs`, `minhash`, `statement-fingerprint` — 입출력이 명확한 순수 알고리즘, 테스트 케이스 상세 정의됨
  - Phase 3~4 — import 교체, re-export 수정, 파일 삭제 등 기계적 작업

---

## 10. 성능 기준

| 항목 | 기준 | 측정 시점 |
|------|------|----------|
| Level 1 (hash 그룹핑) | 10K 함수 기준 < 2초 | Phase 2 완료 후 |
| Level 2+3 (MinHash/LCS) | 10K 함수 기준 < 5초 | Phase 2 완료 후 |
| Level 4 (anti-unification) | 10K 함수 기준 < 3초 | Phase 2 완료 후 |
| 전체 분석 | 10K 함수 기준 < 10초 | Phase 2 완료 후 |
| 메모리 (MinHash 시그니처) | 20K 함수 × 128 × 8B = ~20MB | Phase 1-2 완료 후 |

---

## 11. 위험 요소 및 완화

| 위험 | 영향 | 완화 |
|------|------|------|
| MinHash 시그니처 계산 성능 | 대규모 프로젝트 (20K+ 함수)에서 느려질 수 있음 | k=128은 보수적, 프로파일링 후 k 조정 가능 |
| 소규모 함수 MinHash 의미 희석 | statement 3~5개 함수에서 부정확 | `minStatementCount` fallback: 직접 pairwise LCS 비교 |
| LCS O(n²) worst case | statement 수 100+ 함수에서 느릴 수 있음 | Hunt-Szymanski로 평균 O(r log n), 최악 시 early termination |
| Anti-unification 배열 정렬 | BlockStatement.body가 매우 길 때 | LCS 정렬 선행 → 매칭된 쌍만 재귀, 미매칭은 바로 variable |
| 하위호환 깨짐 | 기존 config 사용자 | detector alias 매핑으로 완화 |
| 기존 테스트 대량 수정 | 통합 테스트 변경 범위 | Phase 4에서 일괄 마이그레이션, 기존 테스트 로직 보존 |
