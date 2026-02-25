# Duplicates 기능 — 잔여 결함 및 보강 계획

> `src/features/duplicates/` 심층 분석 결과.
> 엔진 정확성, 알고리즘 결함, 로직 오류, 테스트 부족, 미구현 기능을 모두 포함한다.

---

## 1. 전체 파이프라인 정확도

| Level | 모듈 | 정확도 | 핵심 문제 |
|-------|------|:------:|----------|
| Level 1 | Hash 그룹핑 (`analyzer.ts`) | **95%** | 중첩 노드 이중 보고 |
| Level 2 | MinHash/LSH (`minhash.ts`) | **80%** | threshold 파라미터 미사용 |
| Level 3 | LCS 검증 (`lcs.ts`) | **98%** | 알고리즘 완벽, 호출 경로에서 교차 비교 누락 |
| Level 4 | Anti-unification (`anti-unifier.ts`) | **85%** | TSTypeReference 조기 return, pattern-outlier 미구현 |
| **종합** | | **~85%** | |

---

## 2. 결함 목록

### CRITICAL (정확도에 직접 영향)

#### C-1: small × large 교차 비교 완전 누락

- **위치**: `near-miss-detector.ts` L97–L127
- **내용**: `detectNearMissClones`에서 small 함수(statement < `minStatementCount`)와 large 함수(statement ≥ `minStatementCount`) 간의 비교가 전혀 수행되지 않는다.
  ```
  // large끼리만 비교
  if (largeItems.length >= 2) { ... }
  // small끼리만 비교
  if (smallItems.length >= 2) { ... }
  // small × large 교차 비교 → 없음!
  ```
- **영향**: statement 수가 `minStatementCount`(기본 5) 경계에 걸치는 유사한 함수 쌍이 **false negative** 된다.

#### C-2: `pattern-outlier` findingKind 완전 미구현

- **위치**: `analyzer.ts` 전체
- **내용**: `DUPLICATE_PLAN.md`에 명시된 5가지 findingKind 중 `pattern-outlier`가 코드 어디에도 생성되지 않는다. `types.ts`에 타입만 정의되어 있고, "변수 수 >> 그룹 평균 → outlier 탐지" 로직은 존재하지 않는다. symmetry-breaking 기능의 통합이 미완료 상태.

---

### HIGH (정확도에 간접 영향)

#### H-1: LSH `threshold` 파라미터 무시

- **위치**: `minhash.ts` L72
- **내용**: `findLshCandidates`의 `threshold` 파라미터가 `void threshold;`로 폐기된다.  bands=16, rows=8이 하드코딩되어 있어 사용자가 `jaccardThreshold`를 변경해도 LSH 후보 선별 기준이 불변. API 계약 위반.

#### H-2: ClassDeclaration + 내부 MethodDefinition 이중 보고

- **위치**: `analyzer.ts` L135–L146
- **내용**: `CLONE_TARGET_TYPES`에 `ClassDeclaration`과 `MethodDefinition`이 모두 포함. `collectOxcNodes` DFS 순회로 동일 클래스 2개가 있으면 ClassDeclaration 전체 + 내부 MethodDefinition이 모두 별도 그룹으로 잡혀 이중 보고.

#### H-3: 통합 테스트 assertion이 코드 로직과 모순

- **위치**: `test/integration/features/duplicates/analysis.test.ts` L36–L45
- **내용**: `createFunctionSource('alpha', 1)` vs `createFunctionSource('alpha', 2)` — 이름 같고 literal만 다름. `createOxcFingerprintShape`는 literal/identifier 제외하므로 shape fingerprint 동일 → type-2-shape 그룹이 반드시 생성. 그런데 `expect(groups.length).toBe(0)` assertion.

---

### MEDIUM (부정확한 결과 가능)

#### M-1: MinHash bag semantics에서 중복 원소 무시

- **위치**: `minhash.ts` L123–L131
- **내용**: MinHash는 집합(set) Jaccard를 추정. 동일 shape fingerprint를 가진 statement가 반복되면 bag 내 중복이 무시되어 Jaccard 과대 추정 가능.

#### M-2: 그룹 similarity 평균 계산이 비대칭

- **위치**: `near-miss-detector.ts` L148–L165
- **내용**: Union-Find 전이 폐포로 A≈B, B≈C → {A,B,C} 그룹 형성 시, (A,C) 쌍의 similarity는 계산되지 않았을 수 있다. 직접 비교된 쌍만 평균에 포함되어 그룹 similarity 과대 추정.

#### M-3: TSTypeReference 조기 return으로 sharedSize 왜곡

- **위치**: `anti-unifier.ts` L157–L164
- **내용**: TSTypeReference 동일 시 즉시 return → 자식 노드(typeParameters 등)가 sharedSize에 미반영. `Array<number>` vs `Array<number>` 같은 동일 타입에서 sharedSize에 1만 반영 → similarity 과소 추정.

#### M-4: `buildCloneDiff` 필터 로직이 `kind` 파라미터 무시

- **위치**: `analyzer.ts` L208–L215
- **내용**: `.filter((v) => v.kind === kind || v.kind === 'identifier' || v.kind === 'literal')` — `kind`에 관계없이 항상 identifier + literal 모두 포함. 현재는 allRenameOnly / allLiteralVariant 조건에서만 호출되어 우연히 정상 작동.

---

### LOW (코드 품질/유지보수)

| # | 위치 | 설명 |
|---|------|------|
| L-1 | `analyzer.ts` + `near-miss-detector.ts` | `CLONE_TARGET_TYPES`, `isCloneTarget`, `getItemKind`가 두 파일에 동일 코드로 중복 정의 (DRY 위반) |
| L-2 | `anti-unifier.ts` L95 | `variables.length === 0` → `'rename-only'` 반환. 완전 동일 구조를 "rename-only"로 분류하는 것은 의미론적 부정확 |
| L-3 | `statement-fingerprint.spec.ts` L163 | `it('abstract 메서드...')` 블록이 `describe('extractStatementFingerprints')` 바깥에 위치 (구조 오류) |
| L-4 | `near-miss-detector.ts` L28 | `extractStatementFingerprintBag` import 후 미사용 (dead import) |
| L-5 | `near-miss-detector.ts` L109–L112 | `[...item.statementFingerprints]` spread 불필요 (`ReadonlyArray<string>` 직접 전달 가능) |
| L-6 | `analyzer.ts` L243 | `cloneTypeToFindingKind`에 `case 'type-2':` 분기가 있지만 `'type-2'` cloneType 그룹 생성 코드 없음 (dead code) |

---

## 3. 테스트 부족 영역

### 수량 현황

| Spec 파일 | `it` 수 | 평가 |
|-----------|:------:|------|
| `analyzer.spec.ts` | 37 | 양호 |
| `anti-unifier.spec.ts` | 19 | 양호 |
| `lcs.spec.ts` | 24 | **우수** |
| `minhash.spec.ts` | 20 | 양호 |
| `near-miss-detector.spec.ts` | 13 | 부족 |
| `statement-fingerprint.spec.ts` | 12 | 부족 |
| 통합 테스트 | 5 | 부족 |
| **합계** | **130** | |

### 누락된 핵심 테스트 시나리오

| # | 모듈 | 누락 시나리오 | 심각도 |
|---|------|-------------|:------:|
| T-1 | near-miss-detector | small × large 교차 비교 되지 않는 것을 검증하는 테스트 | CRITICAL |
| T-2 | anti-unifier | `traverseArrayChildren`의 aOnly/bOnly variable 생성 정확성 | HIGH |
| T-3 | anti-unifier | `TSTypeReference` 같음/다름 시 variable 및 sharedSize 검증 | HIGH |
| T-4 | anti-unifier | 한쪽에만 키가 있는 경우 (`leftChild===undefined`) | HIGH |
| T-5 | anti-unifier | 연산자 차이(===, !==) → structural 분류 검증 | MEDIUM |
| T-6 | near-miss-detector | Union-Find 전이 폐포 시 similarity 평균 정확성 | MEDIUM |
| T-7 | near-miss-detector | MinHash path에서 유사(≠동일) 시그니처의 후보 선별 정밀 검증 | MEDIUM |
| T-8 | minhash | `findLshCandidates`의 `threshold` 파라미터 효과 검증 | MEDIUM |
| T-9 | minhash | `bands` 커스텀 파라미터 동작 검증 | LOW |
| T-10 | statement-fingerprint | ClassDeclaration/TSTypeAliasDeclaration → 빈 배열 반환 확인 | LOW |
| T-11 | analyzer | `ClassExpression`, `FunctionExpression` 단독의 type-1 탐지 | LOW |
| T-12 | analyzer | `applyAntiUnification`에서 `auResults.length===0` 도달 불가 확인 (dead code) | LOW |

---

## 4. PLAN 대비 구현 상태

| PLAN 항목 | 상태 | 비고 |
|-----------|:----:|------|
| Level 1: Hash 기반 정확 매칭 | ✅ | type-1, type-2-shape, type-3-normalized |
| Level 2: MinHash Pre-filter | ⚠️ | threshold 미사용 |
| Level 3: LCS 유사도 검증 | ⚠️ | small×large 교차 누락 |
| Level 4: Anti-unification | ⚠️ | 기초 구현만 완료 |
| findingKind: exact-clone | ✅ | |
| findingKind: structural-clone | ✅ | |
| findingKind: near-miss-clone | ✅ | |
| findingKind: literal-variant | ✅ | |
| findingKind: **pattern-outlier** | ❌ | **완전 미구현** |
| outlier detection (변수 수 >> 그룹 평균) | ❌ | symmetry-breaking 미통합 |
| modification-trap regex → AST 전환 | ⚠️ | literal-variant로 부분 대체 |

---

## 5. 수정/보강 계획

### Phase 0: 코드 정리 (LOW — 기존 동작 불변)

#### Step 0-1: `CLONE_TARGET_TYPES` 중복 정의 해소 (L-1)

- **신규 파일**: `src/features/duplicates/clone-targets.ts`
- `CLONE_TARGET_TYPES`, `isCloneTarget`, `getItemKind`를 이 파일로 추출
- `analyzer.ts`, `near-miss-detector.ts` 에서 import로 교체
- 순환 의존 방지 + DRY 준수

#### Step 0-2: describe 외부 `it` 블록 이동 (L-3)

- **파일**: `statement-fingerprint.spec.ts`
- `it('abstract 메서드...')` 블록을 `describe('extractStatementFingerprints')` 내부로 이동

#### Step 0-3: 불필요한 spread 제거 (L-5)

- **파일**: `near-miss-detector.ts`
- `[...a.item.statementFingerprints]` → `a.item.statementFingerprints` (2곳)

#### Step 0-4: `classifyDiff`에 JSDoc 보강 (L-2)

- **파일**: `anti-unifier.ts`
- `variables.length === 0 → 'rename-only'` 반환에 "완전 동일 구조 포함" JSDoc 추가

#### Step 0-5: `'type-2'` case에 주석 추가 (L-6)

- **파일**: `analyzer.ts`
- `case 'type-2':` 옆에 `// reserved: future identifier-only detection` 주석

---

### Phase 1: 로직 보정 (MEDIUM)

#### Step 1-1: `extractStatementFingerprintBag` multiset 변환 + dead import 해소 (M-1, L-4)

- **파일**: `statement-fingerprint.ts`, `near-miss-detector.ts`
- `extractStatementFingerprintBag` 수정: 동일 fingerprint에 occurrence index suffix를 붙여 multiset→set 변환
  ```typescript
  export const extractStatementFingerprintBag = (functionNode: Node): ReadonlyArray<string> => {
    const fps = extractStatementFingerprints(functionNode);
    const counts = new Map<string, number>();
    return fps.map((fp) => {
      const count = counts.get(fp) ?? 0;
      counts.set(fp, count + 1);
      return count === 0 ? fp : `${fp}#${count}`;
    });
  };
  ```
- `near-miss-detector.ts`: MinHash signature 계산 시 `extractStatementFingerprintBag` 사용
- `NearMissCloneItem`에 `fingerprintBag: ReadonlyArray<string>` 필드 추가
- MinHash에는 bag, LCS에는 기존 fingerprints 유지

#### Step 1-2: `buildCloneDiff` 필터 정확화 (M-4)

- **파일**: `analyzer.ts`
- ```typescript
  // Before:
  .filter((v) => v.kind === kind || v.kind === 'identifier' || v.kind === 'literal')
  // After:
  .filter((v) => v.kind === kind)
  ```

#### Step 1-3: TSTypeReference `sharedSize` 보정 (M-3)

- **파일**: `anti-unifier.ts`
- TSTypeReference 동일 시 `ctx.sharedSize += countOxcSize(leftNode) - 1;` 추가
- `countOxcSize` import 추가

#### Step 1-4: 그룹 similarity 보충 계산 (M-2)

- **파일**: `near-miss-detector.ts`
- 그룹 형성 후, `pairSimilarities`에 없는 쌍은 보충 LCS similarity 계산
- 그룹 크기가 작으므로 (보통 2~5개) O(n²) 허용 가능

---

### Phase 2: 설계 수정 (HIGH)

#### Step 2-1: LSH threshold 기반 bands/rows 자동 계산 (H-1)

- **파일**: `minhash.ts`
- `void threshold;` 제거
- `computeOptimalBandConfig(k, threshold)` 내부 함수 추가:
  - S-curve `Pr = 1 - (1 - t^r)^b`에서 `Pr(threshold) ≈ 0.5`이 되는 `(b, r)` 탐색
  - `b * r ≤ k` 제약 하에 최적 쌍 선택
- `bands` 파라미터는 optional override로 유지

#### Step 2-2: 중첩 노드 이중 보고 필터링 (H-2)

- **파일**: `analyzer.ts`
- `analyzeDuplicates` 반환 직전에 `filterSubsumedGroups` 후처리 추가
- 그룹 G_child의 모든 아이템이 G_parent의 아이템 span 내부에 포함되면 G_child 제거
- `isSpanContained(inner, outer)` 유틸 함수로 span 포함 관계 판별

#### Step 2-3: 통합 테스트 assertion 수정 (H-3)

- **파일**: `test/integration/features/duplicates/analysis.test.ts`
- 테스트명: `'should not group near-duplicates when literals differ'` → `'should detect type-2-shape group when only literals differ'`
- assertion: `groups.length === 0` → shape 그룹 존재 확인 + exact-clone 아님 확인

---

### Phase 3: 핵심 기능 추가 (CRITICAL)

#### Step 3-1: small × large 교차 비교 (C-1)

- **파일**: `near-miss-detector.ts`
- large-only, small-only 루프 뒤에 세 번째 루프 추가:
  ```typescript
  if (smallItems.length > 0 && largeItems.length > 0) {
    for (const small of smallItems) {
      for (const large of largeItems) {
        if (!passesSizeFilter(small.item, large.item, options.sizeRatio)) continue;
        const sim = computeSequenceSimilarity(
          small.item.statementFingerprints,
          large.item.statementFingerprints,
        );
        if (sim >= options.similarityThreshold) {
          confirmedPairs.push({ a: small.index, b: large.index, similarity: sim });
        }
      }
    }
  }
  ```
- small 함수는 보통 적고 sizeRatio 필터로 대부분 제외되므로 성능 영향 미미

#### Step 3-2: pattern-outlier 구현 (C-2)

- **파일**: `analyzer.ts`
- `applyAntiUnification` 반환 타입을 `DuplicateGroup[]`로 변경
- Outlier detection 로직:
  1. auResults의 각 variable 수 수집
  2. mean + 2σ 초과 → outlier (그룹 멤버 3개 이상일 때만)
  3. outlier 멤버를 별도 `findingKind: 'pattern-outlier'` 그룹으로 분리
- `analyzeDuplicates`의 호출부: `result.push(outputGroup)` → `result.push(...outputGroups)`

---

### Phase 4: 테스트 보강

#### Unit Test 추가 (~20개 `it` 블록)

| # | Spec 파일 | 테스트 시나리오 | 대응 |
|---|-----------|--------------|------|
| 1 | `near-miss-detector.spec.ts` | small(4 stmt) × large(6 stmt) 유사 함수 → 그룹 형성 | C-1 |
| 2 | `near-miss-detector.spec.ts` | small × large → sizeRatio 불충족 시 제외 | C-1 |
| 3 | `analyzer.spec.ts` | 3+ 멤버 그룹에서 1개 outlier → pattern-outlier 그룹 생성 | C-2 |
| 4 | `analyzer.spec.ts` | 2멤버 그룹 → outlier 판별 안 함 | C-2 |
| 5 | `analyzer.spec.ts` | 모든 멤버 variable 수 비슷 → outlier 없음 | C-2 |
| 6 | `minhash.spec.ts` | threshold=0.9 → 유사 쌍 더 잘 선별 | H-1 |
| 7 | `minhash.spec.ts` | threshold=0.3 → 느슨한 필터링 | H-1 |
| 8 | `analyzer.spec.ts` | Class+Method 이중 보고 → 포함되는 그룹 필터링 | H-2 |
| 9 | `statement-fingerprint.spec.ts` | bag multiset — 동일 shape 2개 → 다른 suffix | M-1 |
| 10 | `anti-unifier.spec.ts` | TSTypeReference 동일 시 sharedSize에 자식 노드 수 반영 | M-3 |
| 11 | `anti-unifier.spec.ts` | traverseArrayChildren — bOnly에 structural variable 생성 | T-2 |
| 12 | `anti-unifier.spec.ts` | 한쪽에만 키 존재 → structural variable | T-4 |
| 13 | `anti-unifier.spec.ts` | 연산자 차이 → structural 분류 | T-5 |
| 14 | `anti-unifier.spec.ts` | maxSize=0 → similarity 1.0 | T-14 |
| 15 | `near-miss-detector.spec.ts` | similarity 평균이 모든 쌍 반영 | M-2 |
| 16 | `statement-fingerprint.spec.ts` | ClassDeclaration → 빈 배열 | T-10 |
| 17 | `statement-fingerprint.spec.ts` | TSTypeAliasDeclaration → 빈 배열 | T-10 |
| 18 | `analyzer.spec.ts` | ClassExpression type-1 탐지 | T-11 |
| 19 | `analyzer.spec.ts` | FunctionExpression type-1 탐지 | T-11 |
| 20 | `minhash.spec.ts` | bands 커스텀 파라미터 동작 | T-9 |

#### 통합 테스트 추가 (3개)

| # | 시나리오 |
|---|---------|
| 21 | literal만 다른 함수 → type-2-shape 그룹 형성 (H-3 수정과 동시) |
| 22 | 3개 유사 함수 중 1개 outlier → pattern-outlier 별도 보고 |
| 23 | Class + Method → 중첩 이중 보고 없음 확인 |

---

## 6. 실행 순서 & 의존 관계

```
Phase 0 (코드 정리) — 기존 동작 불변
  ├─ Step 0-1: clone-targets.ts 추출
  ├─ Step 0-2: spec describe 구조 수정
  ├─ Step 0-3: spread 제거
  ├─ Step 0-4: JSDoc 추가
  └─ Step 0-5: 주석 추가
       │
Phase 1 (로직 보정)
  ├─ Step 1-1: bag multiset (← Step 0-1 후)
  ├─ Step 1-2: buildCloneDiff 필터
  ├─ Step 1-3: TSTypeReference sharedSize
  └─ Step 1-4: similarity 보충 계산
       │
Phase 2 (설계 수정)
  ├─ Step 2-1: LSH threshold 자동 계산
  ├─ Step 2-2: 이중 보고 필터링
  └─ Step 2-3: 통합 테스트 수정
       │
Phase 3 (핵심 추가)
  ├─ Step 3-1: small×large 교차 비교 (← Step 1-1 후)
  └─ Step 3-2: pattern-outlier (← Step 1-2 후)
       │
Phase 4 (테스트 보강)
  └─ 모든 Phase 완료 후 Test-First 적용
```

## 7. 변경 규모 추정

- **총 변경 파일**: 8개 소스 + 7개 spec + 1개 통합 테스트 + 1개 신규 파일 = **17개 파일**
- **총 추가 테스트**: ~23개 `it` 블록
- **예상 규모**: 소스 ~150줄 추가/수정, 테스트 ~400줄 추가
