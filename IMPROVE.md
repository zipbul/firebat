# Firebat 개선 계획

> 분석 기준일: 2026-02-13
>
> 범위: `src/features/` 전체 16개 디텍터 + `src/application/scan/scan.usecase.ts` 실행 흐름 + 출력 아키텍처 + 신규 디텍터/기능 설계
>
> 목적:
> 1. 더 좋은 기능 — 에이전트가 구조적 수정을 할 수 있는 진단/처방 체계 (★ A, B, C)
> 2. 기존 정확도/품질 — 오탐 감소, 알고리즘 개선 (Section 2-3)
> 3. 기능 병합 — 중복 순회/중복 탐지 제거 (Section 4)
> 4. 스캔 순서 최적화 — 병렬화, 단일 패스 (Section 1)
> 5. 레포트 일관화 — finding 필드 표준화 (Section 6)
> 6. 구조적 수정 메시지 — 증상이 아닌 진단 기반 수정 유도 (★ A Layer 2-3)
> 7. 극한 클린코드 유지 — 코드 위생 디텍터 보강 (★ C)
> 8. 수정 순서 제공 — topPriorities, DiagnosticAggregator (★ A Layer 3)
>
> **참고**: 코드 중복(DRY 위반)은 firebat 자체 디텍터로 탐지 → 직접 수정 예정이므로 이 문서에서 제외한다.

---

## ★ 핵심 과제 A: 에이전트 구조적 수정 유도 아키텍처

### 문제 정의

firebat의 주 소비자는 AI 에이전트(MCP 클라이언트)다. 현재 출력은 **개별 finding의 나열**이며, 에이전트는 각 finding을 독립적으로 해석하여 **국소 패치(local patch)** 로 끝낸다.

```
현재 에이전트 동작:
  scan → finding "nesting depth 5 at line 34" → 에이전트: early return 추가 → 끝
  scan → finding "dead store at line 42" → 에이전트: 변수 삭제 → 끝
  scan → finding "duplicate at line 78" → 에이전트: 함수 인라인 → 끝
  
실제 필요:
  scan → "이 3개 finding은 processOrder()가 3개 책임을 한 함수에서 처리하기 때문"
       → 에이전트: 책임별 함수 추출 → 3개 finding 동시 해소
```

**핵심**: finding은 증상(symptom)이지 진단(diagnosis)이 아니다. 에이전트에게 증상만 보여주면 증상 치료만 한다.

### 설계: 3-Layer 출력 모델

현재 `FirebatReport`의 `analyses`는 Layer 1만 존재한다. Layer 2, 3을 추가한다.

#### Layer 1: Enriched Findings (기존 finding 강화)

모든 finding에 아래 필드를 추가한다. 아래는 **최종형 인터페이스**다. 초기 도입 시에는 `Partial<EnrichedFinding>`을 허용하며, 신규 필드가 없는 finding도 정상 동작해야 한다.

**통합 전략**: 기존 디텍터별 finding 타입(`NoopFinding`, `WasteFinding`, `ForwardingFinding` 등)은 각각 다른 구조를 가진다. `EnrichedFinding`은 이들의 **공통 상위 인터페이스**가 아니라, 각 디텍터 타입에 **optional 필드를 확장**하는 방식으로 적용한다. 구체적으로:
1. 기존 타입에 `id`, `fixScope`, `diagnosisRef?`, `localFixWarning?`, `metrics?`, `why?`, `suggestedRefactor?` 필드를 optional로 추가
2. `message` 필드가 없는 타입(`NoopFinding`, `ForwardingFinding`)에는 `message: string` 필드를 추가 (Phase 0 전제 조건)
3. `kind` 필드는 각 디텍터 타입의 기존 union(`WasteKind`, `BarrelPolicyFindingKind` 등)을 유지 — `string`으로 확장하지 않아 타입 discrimination 보존
4. Layer 2~3의 `findingIds`는 `string`으로 참조하므로, Layer 1 타입의 다형성과 무관

**TypeScript 적용 패턴**: intersection type으로 기존 타입을 비파괴 확장한다. 기존 인터페이스를 직접 수정하지 않는다.
```typescript
// src/types.ts에 추가
type EnrichedWasteFinding = WasteFinding & Partial<EnrichedFindingFields>;
type EnrichedNoopFinding = (NoopFinding & { message: string }) & Partial<EnrichedFindingFields>;
type EnrichedForwardingFinding = (ForwardingFinding & { message: string }) & Partial<EnrichedFindingFields>;
type EnrichedNestingItem = NestingItem & Partial<EnrichedFindingFields>;
// ... 각 finding 타입에 대해 동일 패턴
```
`FirebatAnalyses`의 각 디텍터 결과 타입을 `Enriched*` 버전으로 교체한다. `Partial<EnrichedFindingFields>`이므로 기존 디텍터가 신규 필드를 생성하지 않아도 타입 호환된다.

```typescript
// 아래는 모든 finding 타입에 공통으로 확장되는 필드의 정의.
// 기존 디텍터 타입(WasteFinding, NoopFinding 등) 각각에 optional로 추가한다.
interface EnrichedFindingFields {
  /**
   * Finding stable ID — 결정론적 생성.
   * 형식: F-{detector}-{fileHash4}-{line}
   * 예: F-NEST-a3f1-34, F-WAST-b2c4-42
   * fileHash4 = **project root 기준 상대 경로**의 xxHash64 (기존 `hashString()` 사용) 하위 4자리 hex.
   *   절대 경로를 사용하면 머신 간 결정론이 깨지므로 반드시 상대 경로.
   *   예: `hashString('src/order/process-order.ts').slice(-4)` → `'a3f1'`
   * 같은 코드에 같은 디텍터를 돌리면 항상 같은 ID가 나와야 한다 (결정론).
   * ID는 content-addressed — 리팩토링으로 코드가 변경되면 ID도 변경되며, 이는 의도된 동작이다.
   */
  readonly id: string;
  
  /** 이 finding이 속하는 진단 그룹 ID. 없으면 독립 finding. */
  readonly diagnosisRef?: string;
  
  /** 수정 범위. 에이전트에게 "이건 줄 단위로 고칠 문제가 아니다"를 알려줌. */
  readonly fixScope: 'line' | 'function' | 'module' | 'cross-module' | 'architecture';
  
  /** 국소 패치 시 발생할 문제. 에이전트가 잘못된 방향으로 가는 것을 명시적으로 차단. */
  readonly localFixWarning?: string;
  
  /** 정량 근거 (PLAN.md §1 준수) */
  readonly metrics?: Record<string, number>;
  
  /** 왜 이 코드가 문제인지 (AX 비용 근거) */
  readonly why?: string;
  
  /** 구조적 수정 제안 */
  readonly suggestedRefactor?: string;
}
```

**신규 타입 배치 규칙** (Ports & Adapters 아키텍처 준수):
- `EnrichedFindingFields`, `Enriched*Finding` 타입, `Diagnosis`, `DiagnosisPattern`, `RefactoringPlan`, `RefactoringStep`, `CodebaseHealth` → 모두 **`src/types.ts`** 에 정의. 이유: `FirebatReport`의 구성 요소이며, 기존 finding 타입(`NoopFinding`, `WasteFinding` 등)과 같은 파일에 있어야 import path가 일관됨.
- `DiagnosticAggregatorInput`, `DiagnosticAggregatorOutput` → **`src/features/diagnostic-aggregator/aggregator.ts`** 에서 export. 내부 구현 타입이므로 `src/types.ts`에 넣지 않는다.
- `engine/` 하위에는 신규 타입 추가 없음. `engine/types.ts`는 엔진 내부(`VariableUsage`, `BitSet` 등)만 담당.

**`fixScope`가 핵심이다.** 에이전트가 `fixScope: 'module'`을 보면 "이 줄만 고쳐서는 안 된다"를 즉시 인식한다.

**fixScope 판정 규칙**:

| fixScope | 판정 기준 |
|----------|----------|
| `line` | finding이 단일 statement에 국한. 수정이 해당 줄만 변경 (예: dead store 삭제) |
| `function` | finding이 함수 내부 구조에 관련. 수정이 함수 본문을 변경하지만 시그니처/호출자는 불변 (예: nesting 리팩토링) |
| `module` | finding 수정 시 **같은 파일** 내 다른 함수/export도 변경 필요 (예: module-scope 변수 제거) |
| `cross-module` | finding 수정 시 **다른 파일**의 코드도 변경 필요. 판정 기준: 수정 대상 심볼의 외부 참조가 1개 이상 (예: shared 타입 변경, export 함수 시그니처 변경) |
| `architecture` | 파일 생성/삭제/이동이 수반되는 구조적 변환 (예: 모듈 분리, 책임 재배치). B-III Blueprint 대상 |

**`localFixWarning`도 핵심이다.** 에이전트에게 "하지 말 것"을 명시적으로 전달한다:
```
localFixWarning: "Adding an early return here reduces depth to 4 but leaves the SRP violation. 
                  The function still handles validation + persistence + notification."
```

#### Layer 2: Diagnoses (진단 그룹) — 신규 출력 섹션

개별 finding들을 **근본 원인(root cause)** 기준으로 그룹화한다.

```typescript
interface Diagnosis {
  readonly id: string;                    // "D-GOD-a3f1-34"
  // ID 생성식: D-{패턴약어}-{파일해시4자리}-{줄번호}
  // 예: D-GOD-a3f1-34, D-CLMP-b2c4-0 (줄 0 = 파일/모듈 수준)
  // 결정론적: 같은 코드 → 같은 ID. 파일해시 = 대상 파일 경로의 CRC32 하위 4자리 hex
  readonly pattern: DiagnosisPattern;     // 안티패턴 유형
  readonly severity: 'structural' | 'design' | 'hygiene';
  
  /** 한 줄 요약 — 에이전트가 가장 먼저 읽는 문장 */
  readonly summary: string;
  
  /** 이 진단에 묶인 finding ID 목록 */
  readonly findingIds: ReadonlyArray<string>;
  
  /** 근거 수치. string 값은 일관성 지표(예: 패턴명) 등 비수치 근거에 사용. */
  readonly evidence: Record<string, number | string>;
  
  /**
   * 패턴 매칭 신뢰도 (0-1).
   * ≥ 0.8: 처방(prescribe) — refactoringPlan 포함, 에이전트 즉시 실행 가능
   * 0.5~0.79: 제안(suggest) — refactoringPlan 포함하되 검증 후 실행 권고
   * < 0.5: 관찰(observe) — finding 그룹화만, refactoringPlan 생략
   */
  readonly matchConfidence: number;
  
  /** 단계별 리팩토링 계획 — 에이전트가 순서대로 실행. matchConfidence < 0.5이면 생략. */
  readonly refactoringPlan?: RefactoringPlan;
  
  /** 이 진단을 해결하면 해소되는 finding 수 */
  readonly expectedResolutions: number;
}

type DiagnosisPattern =
  | 'god-function'           // 함수가 여러 독립 책임 수행
  | 'god-module'             // 모듈이 너무 많은 심볼 export
  | 'data-clump'             // 동일 파라미터 그룹 반복
  | 'primitive-obsession'    // 도메인 타입 없이 원시값 남용
  | 'shotgun-surgery'        // 한 개념이 여러 파일에 산재
  | 'mixed-abstraction'      // 고수준/저수준 로직 혼재
  | 'over-indirection'       // 불필요한 간접 계층
  | 'circular-dependency'    // 순환 의존
  | 'leaky-abstraction'      // 추상화 경계 위반
  | 'missing-type-boundary'; // 타입 안전 경계 부재

interface RefactoringPlan {
  readonly strategy: string;  // "extract-and-delegate", "introduce-type", "inline-and-simplify"
  readonly steps: ReadonlyArray<RefactoringStep>;
  readonly estimatedImpact: string;  // "Resolves 4 findings, reduces complexity by 23 points"
}

interface RefactoringStep {
  readonly order: number;
  readonly action: 'EXTRACT' | 'MOVE' | 'INLINE' | 'INTRODUCE_TYPE' | 'DELETE' | 'RENAME' | 'MERGE';
  readonly description: string;
  readonly targetFile?: string;   // 대상 파일 (선택)
  readonly targetSymbol?: string; // 대상 심볼 (선택)
}
```

**예시: god-function 진단**

```json
{
  "id": "D-GOD-a3f1-34",
  "pattern": "god-function",
  "severity": "structural",
  "summary": "processOrder() in order.ts handles 3 independent concerns: validation (lines 10-25), persistence (lines 26-45), notification (lines 46-70). Each concern shares <12% of variables with others.",
  "findingIds": ["F-nesting-a3f1-12", "F-nesting-a3f1-28", "F-waste-a3f1-37", "F-coupling-a3f1-50"],
  "evidence": {
    "responsibilityClusters": 3,
    "variableOverlapRatio": 0.12,
    "totalCognitiveComplexity": 34,
    "nestingDepth": 5,
    "dominantClusterName": "validation"
  },
  "matchConfidence": 0.85,
  "refactoringPlan": {
    "strategy": "extract-and-delegate",
    "steps": [
      { "order": 1, "action": "EXTRACT", "description": "Extract validation logic (lines 10-25) into validateOrder(order: Order): ValidationResult", "targetSymbol": "validateOrder" },
      { "order": 2, "action": "EXTRACT", "description": "Extract persistence logic (lines 26-45) into saveOrder(order: Order): Promise<void>", "targetSymbol": "saveOrder" },
      { "order": 3, "action": "EXTRACT", "description": "Extract notification logic (lines 46-70) into notifyOrderCreated(order: Order): Promise<void>", "targetSymbol": "notifyOrderCreated" },
      { "order": 4, "action": "INLINE", "description": "Simplify processOrder to orchestrate: validate → save → notify" }
    ],
    "estimatedImpact": "Resolves 4 findings (nesting F-nesting-a3f1-12, nesting F-nesting-a3f1-28, waste F-waste-a3f1-37, coupling F-coupling-a3f1-50). Cognitive complexity drops from 34 to ~8."
  },
  "expectedResolutions": 4
}
```

**예시: data-clump 진단**

```json
{
  "id": "D-CLMP-b2c4-0",
  "pattern": "data-clump",
  "severity": "design",
  "summary": "Parameters (userId: string, userName: string, userEmail: string) appear together in 7 functions across 4 files.",
  "findingIds": ["F-paramobj-b2c4-15", "F-paramobj-c7d2-22", "F-paramobj-c7d2-41", "F-paramobj-e1a9-8", "F-paramobj-b2c4-30", "F-paramobj-c7d2-55", "F-paramobj-e1a9-19"],
  "evidence": {
    "clumpSize": 3,
    "occurrences": 7,
    "filesAffected": 4
  },
  "matchConfidence": 0.9,
  "refactoringPlan": {
    "strategy": "introduce-type",
    "steps": [
      { "order": 1, "action": "INTRODUCE_TYPE", "description": "Create interface UserInfo { userId: string; userName: string; userEmail: string }", "targetFile": "types/user.ts" },
      { "order": 2, "action": "INLINE", "description": "Replace the 3 parameters with single UserInfo parameter in all 7 functions" }
    ],
    "estimatedImpact": "Reduces total parameter count by 14. All 7 functions get simpler signatures."
  },
  "expectedResolutions": 7
}
```

#### Layer 3: Codebase Health (건강도 점수) — 신규 출력 섹션

에이전트가 "뭘 먼저 해야 하는가?"를 판단할 수 있는 전체 점수표.

```typescript
interface CodebaseHealth {
  /** 0-100 종합 점수. 가중치 미교정 상태에서는 experimental 표기 */
  readonly overallScore: number;
  readonly scoreStatus: 'calibrated' | 'experimental';  // 가중치 교정 전까지 'experimental'
  
  readonly dimensions: {
    readonly simplicity: number;       // 함수 복잡도, 중첩, 코드 길이
    readonly modularity: number;       // 모듈 경계, 결합도, 응집도
    readonly consistency: number;      // API 일관성, 네이밍, 형식
    readonly typeIntegrity: number;    // 타입 안전성, unknown/any 탈출
    readonly maintainability: number;  // 변경 비용, 산탄총 수술 위험
  };
  
  /**
   * 영향력 기준 정렬된 최우선 진단 목록.
   * 정렬 규칙: resolveCount DESC → severity(structural > design > hygiene) → diagnosisId ASC (결정론적 tie-break)
   */
  readonly topPriorities: ReadonlyArray<{
    readonly diagnosisId: string;
    readonly summary: string;
    readonly resolveCount: number;     // 해결 시 사라지는 finding 수
    readonly severity: 'structural' | 'design' | 'hygiene';
  }>;
}
```

**차원별 점수 산출 공식** (Phase 0 — `scoreStatus: 'experimental'`):

각 차원은 0-100. 관련 디텍터 finding 수를 입력으로 penalty 방식으로 산출한다. 총 파일 수 `T`로 정규화.

| 차원 | 입력 신호 | 공식 (Phase 0) |
|------|-----------|----------------|
| simplicity | nesting findings (`N_n`), waste findings (`N_w`), early-return findings (`N_e`) | `max(0, 100 - ((N_n + N_w + N_e) / T) × 200)` |
| modularity | coupling hotspots (`N_c`), dependency cycles (`N_d`), forwarding findings (`N_f`) | `max(0, 100 - ((N_c + N_d + N_f) / T) × 200)` |
| consistency | lint findings (`N_l`), format findings (`N_fmt`), api-drift findings (`N_a`) | `max(0, 100 - ((N_l + N_fmt + N_a) / T) × 100)` |
| typeIntegrity | typecheck findings (`N_t`), unknown-proof findings (`N_u`) | `max(0, 100 - ((N_t + N_u) / T) × 200)` |
| maintainability | exact-dup findings (`N_ed`), structural-dup findings (`N_sd`), barrel-policy findings (`N_b`) | `max(0, 100 - ((N_ed + N_sd + N_b) / T) × 200)` |
| **overallScore** | — | `(simplicity + modularity + consistency + typeIntegrity + maintainability) / 5` |

> 가중치 계수(`200`, `100`)는 초기값이다. 실제 프로젝트 데이터로 교정 후 `scoreStatus`를 `'calibrated'`로 전환한다. Phase 0에서는 **`'experimental'` 고정**.

### 구현: Diagnostic Aggregator

Layer 2, 3을 생성하는 **메타 분석기**. 모든 디텍터 실행 후 런타임 Stage 5에서 동작.

**모듈 위치**: `src/features/diagnostic-aggregator/aggregator.ts` (순수 계산 — I/O 없음, Ports & Adapters `features/` 레이어). `index.ts`에서 re-export.

**함수 시그니처**:
```typescript
// src/features/diagnostic-aggregator/aggregator.ts
interface DiagnosticAggregatorInput {
  readonly analyses: Partial<FirebatAnalyses>;   // 기존 16개 디텍터 결과 전체
  readonly dependencyGraph?: DependencyAnalysis; // 크로스파일 상관 분석용 (optional)
  readonly sourceFiles: ReadonlyArray<{          // AST 접근 (data-clump Phase 0 등)
    readonly relativePath: string;
    readonly ast: Program;                       // oxc parsed AST
  }>;
}

interface DiagnosticAggregatorOutput {
  readonly diagnoses: ReadonlyArray<Diagnosis>;
  readonly health: CodebaseHealth;
  readonly enrichments: ReadonlyMap<string, Partial<EnrichedFindingFields>>;
  // enrichments: findingId → 추가할 필드. scan.usecase가 이 맵으로 기존 finding에 역주입.
}

function aggregateDiagnostics(input: DiagnosticAggregatorInput): DiagnosticAggregatorOutput;
```
`scan.usecase.ts`는 Stage 5에서 이 함수를 호출하고, 반환된 `enrichments` 맵을 사용해 Layer 1 finding에 `diagnosisRef`, `localFixWarning` 등을 역주입한다.

```
scan.usecase.ts 실행 흐름:
  Stage 1-4: 기존 디텍터 실행 → Layer 1 findings 수집
  Stage 5 (신규): DiagnosticAggregator
    ├── 1. Finding 상관관계 분석
    │   ├── 동일 파일 + 동일 함수 범위의 findings 그룹화
    │   ├── 동일 심볼/파라미터 패턴의 findings 그룹화
    │   └── 의존성 그래프 기반 크로스파일 findings 그룹화
    │
    ├── 2. 패턴 매칭 → DiagnosisPattern 결정
    │   ├── (nesting.cognitiveComplexity + C-2 responsibility-boundary) in same function → god-function
    │   ├── same param group × N functions (C-3) → data-clump
    │   ├── same concept × N files (B-IV-2 concept-scatter) → shotgun-surgery
    │   ├── forwarding chains + single-impl interfaces → over-indirection
    │   ├── (unknown-proof + api-drift) in boundary files → leaky-abstraction
    │   ├── C-3 primitive param + B-V-1 invariant on same param → primitive-obsession
    │   ├── nesting depth 차이 > 2 within same function → mixed-abstraction
    │   ├── export 함수 param/return에 any/unknown 비율 > 50% → missing-type-boundary
    │   ├── coupling.god-module finding → god-module (기존 coupling 디텍터 결과 직접 승격)
    │   └── dependencies.cycle finding → circular-dependency (기존 dependencies 디텍터 결과 직접 승격)
    │
    ├── 3. RefactoringPlan 생성
    │   ├── 패턴별 템플릿 기반 step 생성
    │   └── AST 분석으로 추출 대상 변수/범위 특정
    │
    ├── 4. CodebaseHealth 산출
    │   ├── 차원별 가중 평균
    │   └── topPriorities = resolveCount DESC 정렬
    │
    └── 5. Finding 역참조 주입 (diagnosisRef, localFixWarning)
```

**fixScope 산출 주체**: fixScope는 **각 디텍터가 자기 finding 생성 시 직접 할당**한다. 디텍터만이 자기 finding의 수정 범위를 정확히 판단할 수 있다 (예: waste → `'line'`, nesting → `'function'`, coupling → `'cross-module'`). DiagnosticAggregator는 fixScope를 **상향 조정**(upgrade)할 수 있지만 하향하지 않는다: 예를 들어, finding 단독으로는 `fixScope: 'function'`이지만 Diagnosis로 묶이면 `'module'`이나 `'cross-module'`로 승격. 각 디텍터별 기본 fixScope:

| 디텍터 | 기본 fixScope |
|--------|---------------|
| waste (dead-store) | `line` |
| nesting | `function` |
| early-return | `function` |
| noop | `line` |
| forwarding (thin-wrapper) | `function` |
| forwarding (cross-file-chain) | `cross-module` |
| exception-hygiene | `function` |
| coupling (god-module) | `architecture` |
| coupling (bidirectional) | `cross-module` |
| dependencies (cycle) | `cross-module` |
| dependencies (dead-export) | `module` |
| barrel-policy | `module` |
| unknown-proof | `line` |
| api-drift | `cross-module` |
| exact-duplicates | `function` |
| structural-duplicates | `function` |
| typecheck | `line` |
| lint | `line` |
| format | `line` |

#### 정밀도 관리

DiagnosticAggregator의 패턴 매칭은 **휴리스틱 기반**이다. 오분류 위험을 관리하기 위한 원칙:

1. **보수적 매칭**: 초기 버전은 높은 확신도의 패턴만 그룹화하고, 애매한 경우 독립 finding으로 유지
2. **각 `DiagnosisPattern`에 `matchConfidence: number` (0-1)** 필드 추가.
   - **≥ 0.8**: 처방(prescribe) — refactoringPlan을 포함하여 에이전트가 즉시 실행 가능
   - **0.5 ~ 0.79**: 제안(suggest) — refactoringPlan 포함하되 에이전트에게 검증 후 실행 권고
   - **< 0.5**: 관찰(observe) — finding 그룹화만 보고, refactoringPlan 생략. 에이전트 판단에 위임
   - 초기 임계값은 OSS 3개 프로젝트(소/중/대 규모) 스캔 후 precision ≥ 0.8 기준으로 교정
3. **패턴별 필수 조건(hard rules)** 정의:
   - `god-function`: **Phase 0 (MVP)**: nesting.cognitiveComplexity ≥ 15 AND waste finding 동일 함수에 존재 시 매칭 (confidence 0.6). **Phase 2 이후**: C-2 responsibility-boundary finding 존재 (독립 클러스터 ≥ 2, 공유율 < 20%) 시 confidence 0.9로 승격
   - `data-clump`: 동일 파라미터 조합이 **3개 이상** 함수에서 반복될 때만. **Phase 0**: DiagnosticAggregator가 직접 AST에서 함수 시그니처를 수집하여 반복 파라미터 그룹을 탐지하고, synthetic `paramobj` finding(`F-paramobj-*`)을 생성한 뒤 data-clump Diagnosis에 묶는다 (기존 디텍터 finding이 아닌 aggregator 자체 분석). **Phase 2 이후**: C-3(Parameter Object Opportunity) 디텍터가 `paramobj` finding을 직접 생성하므로, aggregator의 synthetic 생성 로직을 제거하고 C-3 출력을 소비한다
   - `shotgun-surgery`: 동일 개념이 **4개 이상** 파일에 분산될 때만
   - `primitive-obsession`: C-3 primitive param ∩ B-V-1 invariant-blindspot on same param
   - `mixed-abstraction`: 같은 함수 내 최대/최소 nesting depth 차이 > 2 AND 독립 블록 2개 이상
   - `missing-type-boundary`: export 함수의 param/return 중 any/unknown 비율 > 50%
4. **다중 소속 규칙**: 하나의 finding이 여러 Diagnosis에 매칭될 수 있다. 처리 규칙:
   - finding은 **matchConfidence가 가장 높은 Diagnosis 1개에만** 소속된다 (1:1)
   - confidence 동률 시 tie-break: `expectedResolutions` 더 큰 쪽 우선 (더 많이 해결하는 진단이 우선)
   - 그래도 동률이면 `diagnosisId` 사전순 (결정론적 보장)
5. **테스트 전략**: 각 DiagnosisPattern에 대해 true-positive, true-negative, edge-case 시나리오를 `test/integration/diagnostic-aggregator/`에 작성. OSS 프로젝트 스캔으로 정밀도 측정 후 임계값 교정

### MCP 출력 포맷 변경

```typescript
interface FirebatReport {
  readonly meta: FirebatMeta;
  readonly analyses: Partial<FirebatAnalyses>;
  
  // ── 신규 ──
  readonly diagnoses?: ReadonlyArray<Diagnosis>;      // Layer 2 (optional — 후방 호환)
  readonly health?: CodebaseHealth;                     // Layer 3 (optional — 후방 호환)
}
```

MCP `scan` 도구 결과에 `diagnoses`와 `health`가 포함되면, 에이전트의 system prompt나 MCP 도구 설명에 아래 지시를 추가할 수 있다:

```
When firebat scan returns diagnoses, prioritize structural fixes over local patches.
Read diagnoses[].refactoringPlan.steps and execute them in order.
Do NOT fix individual findings that have a diagnosisRef — fix the diagnosis instead.
Check health.topPriorities to determine what to fix first.
```

---

## ★ 핵심 과제 B: 에이전트 실패 모드 기반 분석 엔진

### 패러다임 전환

기존 접근: "코드 냄새(code smell)를 탐지한다" → 이것은 **인간 개발자**를 위한 프레임이다. Martin Fowler의 리팩토링 카탈로그를 디텍터로 재포장하면, 결국 기존 linter/analyzer와 같은 카테고리의 도구가 된다.

firebat의 소비자는 **AI 에이전트**다. 에이전트는 인간과 **다르게 실패**한다:

| 인간의 실패 | 에이전트의 실패 |
|------------|---------------|
| 복잡한 코드를 보면 "혼란스럽다" | 복잡한 코드도 읽지만, **보이지 않는 규약을 위반**한다 |
| 긴 함수를 보면 "압도당한다" | 긴 함수도 처리하지만, **크로스커팅 관심사를 누락**한다 |
| 나쁜 네이밍에 "직감적으로 불편하다" | 네이밍은 무시하지만, **일관성을 가정하고 예외에서 깨진다** |
| 추상적 아키텍처를 "전체적으로 파악"한다 | 로컬 컨텍스트만 보고 **전체 영향을 모른 채 수정**한다 |
| 경험으로 "이건 건드리면 안 돼"를 안다 | **암묵적 제약을 인식하지 못하고 파괴**한다 |

따라서 firebat이 제공해야 할 것은 "코드 냄새 목록"이 아니라:

1. **에이전트가 잘못 수정할 위치를 예측**하고
2. **보이지 않는 것을 보이게 만들고**
3. **증상이 아니라 변환(transformation)을 처방**하는 것이다.

---

### B-I. 보이지 않는 것을 보이게 만들기 (Invisible → Visible)

에이전트는 import 그래프는 읽을 수 있다. 타입 시그니처도 읽을 수 있다. 에이전트가 읽을 수 **없는** 것을 firebat이 가시화해야 한다.

#### B-I-1. Temporal Coupling (시간적 결합)

**문제**: 함수 A를 함수 B보다 먼저 호출해야 하지만, 타입 시스템이 이를 강제하지 않는다. 에이전트는 이 순서를 모르고 B를 먼저 호출하거나 A를 빼먹는다.

**감지 방법**:
1. 모듈 스코프의 mutable 변수(`let`)를 추적
2. 변수를 **write하는 함수**와 **read하는 함수**를 식별
3. write → read 순서가 강제되지만 타입으로 표현되지 않는 쌍 = temporal coupling
4. 클래스에서는: `this.initialized` 같은 guard가 있으면 → 그 guard를 설정하는 메서드가 선행 호출 필수

```
"Temporal coupling: initDatabase() must be called before queryUsers().
 queryUsers() reads 'dbConnection' (module-scope let) that initDatabase() sets.
 No type enforcement exists — an agent can call queryUsers() first and get a runtime error.
 
 suggestedRefactor: Make dbConnection a parameter of queryUsers(), or return it from initDatabase() and thread it through. Eliminate the module-scope mutable state."
```

**에이전트 영향**: 이것은 에이전트가 **절대 스스로 발견할 수 없는** 정보다. import를 읽어도, 타입을 읽어도, 호출 순서 의존성은 보이지 않는다. firebat만이 dataflow 분석으로 이를 가시화할 수 있다.

> **구현 노트**: `OxcCFGBuilder.buildFunctionBody()`는 **단일 함수 본문** 스코프의 CFG를 구축한다. Temporal Coupling은 **모듈 스코프**의 `let`/`var`를 여러 함수가 공유하는 패턴이므로, CFG가 아닌 **모듈 레벨 AST 순회**로 탐지한다: (1) 모듈 스코프 `let`/`var` 선언 수집, (2) 각 export 함수 본문에서 해당 변수의 read/write 참조 추적 (variable-collector 활용), (3) write 함수 → read 함수 간 순서 의존성 그래프 구성.

**기존 엔진 재활용**: CFG builder + variable-collector

> **⚠ 전제 조건**: 현재 reaching-definitions(정의 도달) 분석은 `waste-detector-oxc.ts`의 `analyzeFunctionBody`에 하드코딩되어 있고, `dataflow.ts`는 BitSet 유틸리티만 제공한다. B-I-1 구현 전에 reaching-definitions 로직을 **독립 모듈(`engine/reaching-definitions.ts`)로 추출**해야 한다. 이 추출은 Phase 0(기반)에 포함한다.

> **참고**: `variable-collector.ts`는 `{name, isRead, isWrite, location, writeKind?}` 수준의 VariableUsage를 반환한다 (`writeKind`는 `'declaration' | 'assignment' | 'compound-assignment' | 'logical-assignment' | 'update'`). def-use chain 자체를 제공하지 않는다. def-use chain은 위의 reaching-definitions 모듈 위에서 구축한다.

---

#### B-I-2. Implicit State Protocol (암묵적 상태 프로토콜)

**문제**: 여러 파일이 import/export 없이 공유 상태(전역 변수, 환경변수, 파일시스템, 싱글톤 내부 상태)를 통해 결합되어 있다. 에이전트는 import 그래프만 보고 "이 두 모듈은 독립"이라고 판단하지만, 실제로는 공유 상태를 통해 강하게 결합되어 있다.

**감지 방법**:
1. `process.env.X` 직접 참조: 동일 키를 참조하는 모든 파일 → 암묵적 결합
2. module-scope `let`/`var`: export되지 않아도, 같은 모듈의 여러 함수가 읽고 쓰면 → 내부 프로토콜
3. 싱글톤 패턴: `getInstance()` → 호출하는 모든 곳이 암묵적으로 같은 인스턴스 공유
4. 이벤트 이름 문자열: `emit('user:created')` / `on('user:created')` → 문자열 기반 결합

```
"Implicit state protocol: 5 files share process.env.DATABASE_URL without a single source of truth.
 Files: db.ts, migration.ts, health.ts, seed.ts, test-setup.ts
 
 This coupling is INVISIBLE in the import graph. An agent modifying db.ts has no way to know
 that health.ts also reads the same env var and will break if the var name changes.
 
 suggestedRefactor: Create config.ts that reads env vars once. All 5 files import from config.
 The dependency becomes explicit and traceable."
```

---

#### B-I-3. Symmetry Breaking (대칭성 파괴)

**문제**: 에이전트는 **패턴의 일관성을 가정**한다. 10개 handler가 동일한 패턴(validate → process → respond)을 따르면, 에이전트는 11번째도 같은 패턴으로 작성한다. 하지만 7번째 handler만 다른 패턴을 따르면, 에이전트가 7번째를 수정할 때 다른 10개와 동일한 패턴을 적용하여 **기존의 의도적 예외를 파괴**한다.

**감지 방법**:
1. **그룹 식별 (하이브리드 방식)**:
   - **Config 기반 (우선)**: `.firebatrc`에 명시적 그룹 정의
     ```jsonc
     { "features": { "symmetry-breaking": {
       "groups": [
         { "name": "handlers", "glob": "src/handlers/**", "exportPattern": "*Handler" },
         { "name": "controllers", "glob": "src/controllers/**" }
       ]
     }}}
     ```
   - **자동 탐지 (보조)**: config에 정의되지 않은 경우, 동일 디렉토리 내 동일 export 접미사(`*Controller`, `*Service`, `*Handler`)를 가진 파일을 그룹으로 추론. 자동 탐지 결과는 `confidence: 'inferred'`로 표시하여 구분.
2. 그룹 내 각 함수의 "구조 시그니처" 추출:
   - **statement 타입 시퀀스**: 각 top-level statement의 AST 노드 타입 (VariableDeclaration, IfStatement, ReturnStatement 등)을 순서대로 나열
   - **호출 패턴**: callee 이름을 순서대로 나열 (`[validate, authorize, execute, respond]`)
   - **return 위치**: early return 유무, return 수
   - **유사도**: 두 시그니처 간 Levenshtein 거리 / max(길이) → 0-1 정규화. 0.3 이하이면 동일 패턴으로 간주
3. 다수결 패턴(majority pattern) 결정: 그룹 내 50% 이상이 같은 패턴
4. 소수 이탈자(outlier) 보고: 다수결 패턴과의 차이(누락 step, 추가 step, 순서 변경)를 구조적으로 출력

```
"Symmetry break: 9/10 handlers in controllers/ follow [validate → authorize → execute → respond].
 paymentHandler deviates: [authorize → validate → execute → retryOnFailure → respond].
 
 Differences from majority pattern:
 - Reordered: authorize before validate
 - Added: retryOnFailure (not in majority pattern)"
```

**이것이 왜 중요한가**: known mainstream tools 기준으로 이 기능을 제공하는 도구가 없다. lint는 파일 단독으로 본다. 코드 리뷰 도구는 diff만 본다. **그룹 내 패턴 일관성을 분석하고 이탈을 탐지하는 도구는 알려진 주류 도구 중 존재하지 않는다.** firebat은 이탈의 의도성을 판단하지 않는다 — 이탈 사실과 구조적 차이를 보고할 뿐이다.

---

### B-II. 에이전트 컨텍스트 비용 정량화 (Context Cost Modeling)

에이전트의 실패는 대부분 **컨텍스트 부족**에서 온다. 코드가 나쁜 것이 아니라, 에이전트가 올바른 수정을 하기 위해 읽어야 할 것이 너무 많은 것이다.

#### B-II-1. Variable Lifetime Analysis (변수 수명 분석)

**핵심 통찰**: 변수의 수명(정의~마지막 사용)이 길수록, 에이전트가 그 변수를 "기억하며" 코드를 읽어야 하는 범위가 넓다. 이것은 nesting depth보다 더 근본적인 복잡도 지표다.

**기존과의 차이**: `nesting`은 구조적 깊이, `waste`는 미사용 변수를 본다. 이것은 **사용되지만 수명이 과도하게 긴** 변수를 찾는다.

```
variable 'config' defined at line 5, last used at line 89. Lifetime: 84 lines.
variable 'connection' defined at line 12, last used at line 67. Lifetime: 55 lines.

Total context burden: 2 long-lived variables force the reader to hold context across 84 lines.

suggestedRefactor: Move config usage closer to definition, or pass as parameter to extracted functions.
  Each extracted function reduces the caller's variable lifetime.
```

**알고리즘**: CFG + dataflow의 def-use chain에서 각 변수의 `(first_def_line, last_use_line)` 계산. `lifetime = last_use - first_def`. 함수 내 모든 변수의 lifetime 합 = 그 함수의 "context burden".

---

#### B-II-2. Decision Surface Analysis (결정 표면 분석)

**핵심 통찰**: 함수의 인지 비용은 분기(branch) 수가 아니라 **독립 결정 축(independent decision axis)의 수**에 비례한다. 3개의 독립 조건이 있으면 2³=8개의 정신적 경로를 추적해야 한다.

```typescript
function process(user, order, config) {
  if (user.isVip) { /* axis 1 */ }
  if (order.amount > 1000) { /* axis 2 */ }
  if (config.strictMode) { /* axis 3 */ }
  // 8 possible paths — but only 3 branches
}
```

**기존과의 차이**: cyclomatic complexity는 분기 수를 센다 (3). 이 분석은 **독립 축 수**를 세고 조합 폭발(2³=8)을 보고한다.

**알고리즘**:
1. 함수 내 모든 조건 분기의 조건식에서 사용하는 변수 집합 추출
2. 변수 집합이 겹치지 않는 조건들 = 독립 축
3. 독립 축의 수 → 조합 경로 수 = 2^N

```
"Decision surface: processOrder() has 4 independent decision axes.
 Axis 1: user.role (lines 12, 34, 67) — checked 3 times
 Axis 2: order.status (lines 15, 45) — checked 2 times
 Axis 3: config.featureFlags (line 23) — checked 1 time
 Axis 4: payment.method (lines 30, 55) — checked 2 times
 
 Combinatorial paths: 2⁴ = 16. An agent editing one path may break another.
 
 suggestedRefactor: Extract each decision axis into its own function (strategy pattern or early-return guard).
 processOrder should make 0 decisions — delegate all branching to extracted functions."
```

**한계**: 정적 분석이므로 런타임에만 결정되는 축 간 상관관계(예: `user.isVip`이면 항상 `order.amount > 1000`)는 탐지하지 못한다. 보고된 조합 경로 수는 이론적 상한이다.

> **Note**: 기존 B-II-3(Modification Impact Radius)는 B-V-3과 측정 대상이 중복되어 B-V-3으로 통합되었다. → B-V-3 참조.

---

### B-III. 증상이 아니라 변환을 처방하기 (Prescribe Transformations, Not Symptoms)

#### B-III-1. Simplified Blueprint (단순화 청사진)

**핵심 통찰**: "이 함수가 복잡하다"는 증상이다. 에이전트에게 필요한 것은 **"이 함수가 어떤 형태여야 하는가"**이다.

firebat이 복잡한 함수/모듈에 대해 **목표 구조(target structure)**를 생성한다:

```json
{
  "blueprints": [
    {
      "target": "src/order/processOrder.ts",
      "currentState": {
        "lines": 185,
        "functions": 1,
        "responsibilityClusters": 3,
        "cognitiveLoad": 67
      },
      "proposedState": {
        "files": [
          {
            "path": "src/order/validate-order.ts",
            "exports": ["validateOrder"],
            "estimatedLines": 25,
            "responsibility": "validation"
          },
          {
            "path": "src/order/persist-order.ts",
            "exports": ["saveOrder", "updateOrderStatus"],
            "estimatedLines": 35,
            "responsibility": "persistence"
          },
          {
            "path": "src/order/process-order.ts",
            "exports": ["processOrder"],
            "estimatedLines": 12,
            "responsibility": "orchestration",
            "delegatesTo": ["validateOrder", "saveOrder", "notifyOrderCreated"]
          }
        ],
        "estimatedCognitiveLoad": 12
      },
      "reductionRatio": 0.82
    }
  ]
}
```

**에이전트 영향**: 에이전트는 "문제를 고쳐라"가 아니라 **"이 설계도대로 만들어라"**를 받는다. 목표가 구체적이므로 국소 패치가 불가능하다.

**제약**: Blueprint는 **구조적 메타데이터**(files, exports, responsibilities, delegatesTo)만 제공한다. 실제 코드 생성(`skeleton` 등)은 firebat의 범위가 아니라 에이전트의 역할이다. firebat은 "무엇을 분리할것인가"를 정하고, 에이전트는 "어떻게 작성할것인가"를 정한다.

**proposedState 생성 알고리즘**:
1. C-2(Responsibility Boundary)의 변수 클러스터 결과를 입력으로 받는다
2. 각 클러스터 → 하나의 파일로 매핑. 파일명은 클러스터의 대표 변수/함수명에서 파생 (예: `validate` 관련 클러스터 → `validate-order.ts`)
3. `exports`는 클러스터 내 외부 참조되는 함수명
4. `estimatedLines`는 클러스터에 포함된 소스 라인 수
5. `responsibility`는 클러스터의 대표 변수 동사에서 추출 (validate, save, notify 등)
6. 원본 함수는 orchestrator로 변환: `delegatesTo`에 추출된 함수 목록 나열
7. `estimatedCognitiveLoad`는 orchestrator의 예상 nesting depth (보통 0-1)

---

#### B-III-2. Transformation Script (변환 스크립트)

**핵심 통찰**: 에이전트에게 "suggestedRefactor: Extract validation logic"이라고 말하면, 에이전트는 자기 방식대로 추출한다 (파라미터 선택, 이름, 위치 등). 결과가 들쭉날쭉하다.

firebat이 **원자적 리팩토링 연산의 시퀀스**를 처방한다:

```json
{
  "transformations": [
    {
      "id": "T-001",
      "type": "EXTRACT",
      "from": { "file": "order.ts", "span": { "start": { "line": 10 }, "end": { "line": 25 } } },
      "newFunction": {
        "name": "validateOrder",
        "params": [{ "name": "input", "type": "OrderInput" }],
        "returnType": "ValidationResult",
        "destination": "order/validate-order.ts"
      },
      "replaceOriginalWith": "const validated = validateOrder(input);",
      "reason": "Responsibility cluster A: validation (variable overlap with remaining code: 8%)"
    },
    {
      "id": "T-002",
      "type": "INTRODUCE_TYPE",
      "targets": [
        { "file": "user-service.ts", "param": "userId", "currentType": "string" },
        { "file": "order-service.ts", "param": "userId", "currentType": "string" },
        { "file": "auth.ts", "param": "userId", "currentType": "string" }
      ],
      "newType": { "name": "UserId", "definition": "type UserId = string & { readonly __brand: unique symbol }", "file": "types/ids.ts" },
      "reason": "Primitive 'string' used for 'userId' in 11 locations. No compile-time distinction from other strings."
    },
    {
      "id": "T-003",
      "type": "DELETE",
      "target": { "file": "interfaces/IUserRepository.ts" },
      "reason": "Single implementation. Abstraction adds 1 indirection layer with 0 polymorphic benefit.",
      "prerequisite": "Inline interface methods into UserRepository class"
    }
  ]
}
```

**EXTRACT, INTRODUCE_TYPE, DELETE** — 세 가지 원자 연산으로 대부분의 구조적 리팩토링이 표현 가능하다.

> **액션 어휘 통일**: Transformation Script의 `type` 필드는 `RefactoringStep.action` union(`EXTRACT | MOVE | INLINE | INTRODUCE_TYPE | DELETE | RENAME | MERGE`)의 부분집합을 사용한다. 동일한 어휘를 공유하여 Diagnosis의 refactoringPlan과 Transformation Script 간 모호성을 방지한다.

**EXTRACT 파라미터 결정 알고리즘**:
1. C-2 클러스터의 줄 범위 → `from.span`
2. 클러스터 내 **외부에서 정의되고 내부에서 읽히는** 변수 → `params` (variable-collector의 isRead 위치가 클러스터 내, 정의가 외부)
3. 클러스터의 **마지막 할당 변수 중 클러스터 외부에서 읽히는** 것 → `returnType`
4. 함수명: 클러스터 대표 동사 + 원본 함수의 목적어 (예: validate + Order → `validateOrder`)
5. destination: 원본 파일의 디렉토리 + kebab-case 함수명 + `.ts`

---

#### B-III-3. Deletion Candidates (삭제 후보)

**핵심 통찰**: 단순성의 가장 강력한 도구는 **삭제**다. 코드를 추가하는 것은 항상 복잡도를 증가시킨다. 에이전트는 기본적으로 코드를 추가하려 한다 — 삭제를 적극적으로 제안해야 한다.

```
"Deletion candidates (removing these simplifies without changing behavior):

 1. interfaces/IUserRepository.ts — single implementation, 0 consumers use the interface type directly
    Impact: -1 file, -45 lines, -1 indirection layer. 0 behavior change.
    
 2. utils/retry.ts — imported by 1 file, wraps a 3-line try/catch. Inlining is simpler.
    Impact: -1 file, -28 lines. Caller becomes 3 lines longer but eliminates 1 import.
    
 3. types/DeepPartialReadonly.ts — used in 2 locations, both could use Partial<T> instead.
    Impact: -1 file, -15 lines. Simplifies type comprehension.
    
 4. constants/ERROR_CODES.ts (DEPRECATED_ERR, LEGACY_TIMEOUT) — 0 references in non-test code.
    Impact: -2 exported symbols, -0 behavior change."
```

**안전 규칙**:
- side-effect-only import(`import './polyfill'`, `import 'reflect-metadata'`)는 삭제 후보에서 **제외**한다.
- 정적 분석 범위 한계: `require()` 동적 인자, `eval`, `Reflect` 기반 동적 참조는 탐지 대상 외이며, 이로 인한 false-positive 가능성을 finding message에 명시한다.

---

### B-IV. 구조적 엔트로피 측정 (Structural Entropy)

전통적 메트릭(complexity, coupling, cohesion)을 넘어서, **코드의 무질서도**를 측정하는 새로운 지표들.

#### B-IV-1. Implementation Overhead Ratio (구현 오버헤드 비율)

**핵심 통찰**: 함수의 **인터페이스 복잡도**(입출력 표면)와 **구현 복잡도**(내부 로직)의 비율이 과도하면, 같은 일을 더 단순하게 할 수 있다는 신호다.

**측정** (정적 분석으로 객관적 측정 가능한 값만 사용):
- **인터페이스 복잡도**: `파라미터 수 + 파라미터 타입 필드 수(1단계) + 반환 타입 필드 수(1단계)`
- **구현 복잡도**: `AST statement 수 + 변수 선언 수 + 분기 수`
- **Overhead Ratio** = `구현 복잡도 / max(1, 인터페이스 복잡도)`

비율이 높을수록 인터페이스 대비 구현이 과도하게 복잡하다.

**임계값**: 동일 프로젝트 내 함수들의 overhead ratio 분포에서 상위 10%를 경고. 절대값 임계값은 `ratio >= 15`를 기본값으로 하되 config 노출.

```
"Implementation overhead: processPayment() — interface complexity: 4 (2 params + 2 return fields).
 Implementation complexity: 67 (42 statements + 14 variables + 11 branches).
 Overhead ratio: 16.75 — top 5% in this codebase.
 Median ratio for similar-arity functions: 6.2.
 
 suggestedRefactor: Extract internal logic into helper functions to reduce per-function implementation weight."
```

**기존 B-IV-1(Accidental Complexity Ratio)에서 변경된 이유**: "본질적 복잡도"를 정적 분석으로 근사하는 것은 객관적 정의가 불가능하다 (파라미터가 `config: AppConfig` 하나여도 내부에서 30개 필드를 사용할 수 있음). 인터페이스/구현 비율은 AST만으로 객관적으로 측정 가능하다.

---

#### B-IV-2. Concept Scatter Index (개념 산재 지수)

**핵심 통찰**: 하나의 도메인 개념이 몇 개 파일에 걸쳐 있는가. 이것은 `coupling`이나 `dependencies`와 다르다 — import 관계가 아니라 **같은 개념을 다루는 코드의 물리적 분산도**를 측정한다.

**측정**:
1. 식별자에서 도메인 개념 추출: camelCase/PascalCase 분리 후 마지막 단어(동사/접미사) 제거 → 명사 부분을 소문자 정규화 (`createUser` → `user`, `UserService` → `user`, `PaymentGateway` → `payment`)
2. 개념별로 해당 심볼이 존재하는 파일 수, 레이어 수, 디렉토리 수를 계산
3. **Scatter Index** = `파일 수 × 레이어 수` (같은 레이어 내 분산은 자연스러울 수 있으나, 레이어 간 분산은 변경 비용)

```
"Concept scatter: 'payment' — 11 files, 4 layers, scatter index 44.
 adapters/ (3 files) → application/ (2 files) → ports/ (1 file) → infrastructure/ (5 files)
 
 Adding a new payment method requires changes in all 4 layers.
 Change amplification ratio: 1 concept change → 11 file changes.
 
 suggestedRefactor: Consolidate infrastructure layer (5 files) into 2. 
 Consider if ports/payment.port.ts can absorb application/payment.service.ts logic."
```

---

#### B-IV-3. Abstraction Fitness (추상화 적합도)

**핵심 통찰**: 추상화 경계(모듈/클래스/인터페이스)는 **변경 경계와 일치**해야 한다. 함께 변경되는 코드가 다른 모듈에 있으면 추상화가 부적합하고, 독립적으로 변경되는 코드가 같은 모듈에 있어도 추상화가 부적합하다.

**측정** (git 없이 정적 분석으로 근사):
1. 모듈 A와 B 사이의 **결합 강도**: 공유 타입 수, import 수, 공유 개념 수
2. 모듈 A 내부의 **응집도**: 내부 심볼 간 참조 비율
3. **Fitness Score** = `내부 응집도 / 외부 결합 강도`
4. Fitness < 1이면 → 모듈 경계가 잘못됨 (내부보다 외부와 더 강하게 결합)

```
"Abstraction fitness: Module 'order/' — internal cohesion: 0.3, external coupling to 'payment/': 0.7.
 order/ symbols reference payment/ symbols more than they reference each other.
 
 This means the module boundary between order/ and payment/ is misplaced.
 
 suggestedRefactor: Merge tightly-coupled components or redraw the boundary.
 Specifically, order/payment-handler.ts belongs in payment/ based on its reference pattern."
```

---

### B-V. 에이전트 실패 예측 (Agent Failure Prediction)

firebat의 궁극적 차별화: **에이전트가 이 코드를 수정할 때 어디서 실수할지를 예측**한다.

#### B-V-1. Invariant Blindspot (불변 조건 사각지대)

코드에 **타입으로 표현되지 않은 불변 조건(invariant)**이 있으면, 에이전트는 이를 위반할 확률이 높다.

**감지 패턴**:
- `assert()` / `throw` + 조건 → 런타임에서만 검증되는 불변 조건
- 주석에 "must", "always", "never", "before", "after" → 자연어 제약
- 배열 인덱스가 특정 범위라는 가정 (bounds check 후 사용)
- enum exhaustiveness check (`default: throw` in switch)

```
"Invariant blindspot: calculateDiscount() assumes items.length > 0 (guarded by assert at line 12).
 This invariant is NOT in the type signature — the function accepts any array.
 
 An agent adding a new caller may pass an empty array, causing a runtime assertion failure.
 
 suggestedRefactor: Use a NonEmptyArray<T> branded type, or add a type guard at the module boundary."
```

---

#### B-V-2. Modification Trap (수정 함정)

코드의 특정 위치가 **수정하기 쉬워 보이지만 실제로는 위험한** 곳을 식별한다.

**감지 패턴**:
- switch/case에서 새 case 추가 시 다른 곳(다른 파일의 다른 switch)도 동시에 수정해야 하는 경우
- 함수 파라미터 추가 시 모든 호출자 수정이 필요하고, 호출자가 10개 이상인 경우
- 공유 타입 변경 시 downstream 영향이 5개 파일 이상인 경우

**크로스파일 enum-switch 탐지 알고리즘**:
1. AST에서 모든 `SwitchStatement`의 discriminant 수집
2. discriminant가 enum/union literal 타입이면 해당 타입의 정의 위치 기록
3. **같은 enum/union을 discriminant로 사용하는 switch 문**이 **2개 이상 파일**에 존재하면 → modification-trap finding
4. 타입 정보가 없는 경우: switch case의 문자열/숫자 리터럴 집합이 80% 이상 겹치는 switch 쌍을 탐지 (휴리스틱)

```
"Modification trap: Adding a new OrderStatus enum value requires synchronized changes in:
 1. order/types.ts (enum definition)
 2. order/handler.ts (switch at line 45)
 3. order/mapper.ts (switch at line 23)
 4. api/response.ts (switch at line 67)
 5. test/order.test.ts (mock data)
 
 An agent adding a new status will likely update 1-2 of these and miss the rest.
 
 suggestedRefactor: Use a status-to-handler map instead of distributed switch statements.
 Define the map in one place, and all consumers iterate it."
```

---

#### B-V-3. Modification Impact Radius (수정 영향 반경)

> **B-II-3과 통합**: 기존 B-II-3(Modification Impact Radius)은 scan 시점이 아니라 edit 시점의 MCP 도구로 기획되었으나, 기존 B-V-3과 측정 대상이 중복된다. 둘 다 "수정 시 에이전트가 읽어야 할 다른 코드의 범위"를 측정한다. 따라서 두 기능을 **하나의 디텍터 + MCP 도구**로 통합한다.

**이중 용도**:
1. **scan 시점 (디텍터 출력)**: 각 심볼의 impact radius를 사전 계산하여 finding으로 보고. 임계값 초과 시 경고.
2. **edit 시점 (MCP `assess-impact` 도구)**: 에이전트가 수정 전에 호출하여 영향 범위를 확인.

**측정**:
1. 특정 심볼을 수정할 때 이해해야 하는 코드 범위:
   - 심볼 자체의 코드
   - 직접 호출자/피호출자
   - 공유 타입 정의
   - 관련 테스트
2. 총 줄 수 = **Required Context Size**
3. 임계값 초과 시 경고 + 컨텍스트 축소 방법 제안

```
"Modification impact: Modifying 'UserService.updateProfile()' correctly requires reading:
 - UserService class (245 lines)
 - ProfileValidator (89 lines)
 - UserRepository interface + implementation (134 lines)
 - User type definition (45 lines)
 - 3 callers: ProfileController, BatchUpdater, MigrationScript (312 lines total)
 - 2 test files (198 lines)
 Total required context: 1,023 lines. Impact radius: 8 files, 15 symbols.
 
 This exceeds the practical context window for reliable agent modification.
 
 suggestedRefactor: Reduce coupling — updateProfile should depend on fewer abstractions.
 If ProfileValidator is only used here, inline it. If UserRepository has methods unused by this flow, the interface is too broad."
```

**MCP `assess-impact` 도구 스키마**:

```typescript
interface AssessImpactInput {
  readonly symbolName: string;
  readonly filePath: string;
}

interface AssessImpactOutput {
  readonly directCallers: ReadonlyArray<{ file: string; line: number; symbol: string }>;
  readonly sharedTypes: ReadonlyArray<{ file: string; typeName: string }>;
  readonly affectedTests: ReadonlyArray<{ file: string }>;
  readonly totalRequiredContext: number;  // 총 줄 수
  readonly impactRadius: { files: number; symbols: number };
  readonly highRiskCallers: ReadonlyArray<{ file: string; line: number; reason: string }>;
}
```

---

### 기존 디텍터 카탈로그와의 관계

위의 B-I ~ B-V는 기존 "code smell → detector" 패러다임과 근본적으로 다르다:

| 기존 접근 (PLAN.md 스타일) | 신규 접근 (Agent Failure Mode 기반) |
|---------------------------|-------------------------------------|
| data-clump 탐지 | → B-IV-2 Concept Scatter의 한 증상으로 포착됨 |
| primitive-obsession 탐지 | → B-V-1 Invariant Blindspot의 한 증상으로 포착됨 |
| god-function 탐지 | → B-III-1 Blueprint가 해결책까지 제시 |
| over-engineering 탐지 | → B-III-3 Deletion Candidates가 구체적 삭제 지시 |
| parameter-complexity 탐지 | → B-II-2 Decision Surface + B-V-3 Impact Radius로 맥락 포함 |
| module-cohesion 탐지 | → B-IV-3 Abstraction Fitness가 더 근본적 지표 |

기존 PLAN.md의 디텍터들(giant-file, export-kind-mix 등)은 여전히 유용하지만, **독립적 finding이 아니라 B-III-1 Blueprint의 입력 신호**로 활용된다.

---

## ★ 핵심 과제 C: 클린코드 위생 기능 (Clean Code Hygiene)

핵심 과제 A(구조적 수정 유도)와 B(에이전트 실패 예측)는 **고수준 진단**이다. 하지만 에이전트가 코드를 극한으로 깨끗하게 유지하려면, **기본적인 코드 위생을 직접 탐지하는 디텍터**도 필요하다. 기존 16개 디텍터가 다루지 않는 영역을 보강한다.

---

### C-1. Dead Code Detection (사용되지 않는 코드 탐지)

**현재 gap**: `waste`는 dead store(미사용 변수 할당)만 탐지. `dependencies`의 `dead-export`는 파일 간 미사용 export만 탐지. 다루지 않는 영역:

| 유형 | 설명 | 탐지 방법 |
|------|------|-----------|
| Unreachable code | early return/throw 이후 도달 불가 코드 | CFG builder의 unreachable block 탐지 |
| Unused internal functions | export되지 않고 파일 내에서도 호출되지 않는 함수 | AST: 비export 함수 선언 → 같은 파일 내 호출 참조 0 |
| Dead branch | 조건이 항상 true/false인 분기 | `noop`의 `constant-condition`을 확장하여 분기 전체를 포괄 |
| Unused type/interface | import도 안 되고 파일 내 참조도 없는 타입 | export/import 분석 + 파일 내 참조 카운트 |

**엔진 재활용**: CFG builder (unreachable block), variable-collector (참조 추적), dependencies (export 분석)

**기존 `waste`와의 관계**: waste는 CFG+dataflow 기반 **변수 수준** dead store에 집중. dead-code는 **문/블록/함수 수준** 미사용 코드에 집중. 출력은 별도 kind로 분리하되, 같은 `waste` 디텍터 내에 서브카테고리로 통합 가능.

```
"Dead code: function 'legacyParser' (line 45-89) — not exported, 0 internal callers.
 Impact: -44 lines, 0 behavior change.
 
 suggestedRefactor: Delete function. If needed in future, recover from version control."
```

---

### C-2. Function Responsibility Boundary (함수 책임 경계 분석 — 직접 SRP 탐지)

**현재 gap**: DiagnosticAggregator의 `god-function` 진단은 finding 동시 발생에서 **추론**하는 간접 방식이다. finding이 하나도 없어도 함수가 3개 책임을 가질 수 있다 — nesting이 낮고 waste가 없는 깔끔한 god-function.

**직접 탐지 방법**: 함수 내 변수들의 def-use 관계를 그래프로 만들고, **연결 컴포넌트(connected component)가 2개 이상**이면 → 독립된 책임이 한 함수에 혼재.

**알고리즘**:
1. 함수 내 모든 지역 변수의 사용 위치 추출 (`variable-collector`의 `VariableUsage` 재활용)
2. **같은 statement에서 함께 사용되는** 변수 쌍으로 공유 그래프 구성
3. 연결 컴포넌트 탐지 (Union-Find)
4. 컴포넌트 수 ≥ 2 → `responsibility-boundary` finding 생성
5. 각 컴포넌트의 변수 목록 + 줄 범위 → 추출 대상 식별

> **참고**: 여기서는 def-use chain(reaching-definitions)이 아닌 **변수 co-occurrence** 분석이다. `variable-collector`의 `{name, isRead, isWrite, location}`만으로 충분하며, reaching-definitions 추출이 전제 조건이 아니다.

**confidence 조정**: 컴포넌트 간 공유 변수 비율이 20% 이상이면 finding 억제 (실제로 결합된 로직일 수 있음).

```
"Responsibility boundary: processOrder() has 3 independent variable clusters:
 Cluster A (lines 10-25): input, validated, errors — validation concern
 Cluster B (lines 26-45): db, saved, txId — persistence concern
 Cluster C (lines 46-70): template, recipient, sent — notification concern
 Variable overlap between clusters: 8%.
 
 suggestedRefactor: Extract each cluster into a separate function.
 The orchestrator should call 3 functions, not contain 3 responsibilities."
```

**DiagnosticAggregator와의 관계**: 이 디텍터의 finding이 있으면 DiagnosticAggregator가 `god-function` 진단을 **높은 confidence**로 생성할 수 있다. finding 동시 발생 추론보다 정확하다.

---

### C-3. Parameter Object Opportunity (파라미터 객체화 기회)

**현재 gap**: DiagnosisPattern에 `data-clump`이 있지만, finding 상관관계에서 추론하는 것이다. **동일 파라미터 조합의 반복을 직접 탐지**하는 디텍터가 없다.

**탐지 방법**:
1. 모든 함수 시그니처에서 `(name, type)` 쌍의 파라미터 집합 추출
2. 2개 이상의 파라미터로 구성된 부분 집합이 **3개 이상** 함수에서 반복 → finding
3. 단일 함수의 파라미터 수가 **5개 초과** → 독립 finding (인지 비용)

**엔진**: AST에서 함수 시그니처 수집만으로 구현 가능. 추가 엔진 불필요.

```
"Parameter object opportunity: (userId: string, userName: string, userEmail: string)
 appears in 7 functions across 4 files.
 
 suggestedRefactor: Introduce 'UserInfo' interface and replace 3 params with 1.
 Reduces total parameter count by 14 across the codebase."
```

**DiagnosticAggregator와의 관계**: 이 디텍터가 `data-clump` 패턴의 직접 입력이 된다. Transformation Script의 `INTRODUCE_TYPE` 연산으로 연결.

**config**:
```jsonc
{ "features": { "parameter-object": {
  "minParams": 3,           // 부분 집합 최소 크기
  "minOccurrences": 3,      // 반복 함수 수
  "maxParamsPerFunction": 5  // 단일 함수 파라미터 상한
}}}
```

---

### C-4. Return Type Consistency (반환 타입 일관성)

**현재 gap**: `api-drift`가 동명 함수 시그니처 불일치를 보지만, **같은 모듈 내 유사 함수의 반환 패턴 불일치**는 보지 않는다.

**탐지 패턴**:

| 불일치 유형 | 예시 | 에이전트 영향 |
|------------|------|-------------|
| null/undefined 혼용 | `getUser()` → `null`, `getOrder()` → `undefined` | 에이전트가 존재 체크 패턴을 혼용 |
| 에러 처리 혼용 | `save()` → `throw`, `update()` → `Result<T>` | 에이전트가 호출자에서 잘못된 에러 처리 |
| async 불일치 | `fetch()` → `Promise<T>`, `load()` → `T` | 에이전트가 await 빠뜨림 |

**알고리즘**:
1. 모듈(디렉토리 또는 파일) 내 export 함수 그룹화
2. 각 함수의 반환 패턴을 **AST에서 직접 추출** (타입 시스템 불필요):
   - `return null` 존재 여부 → null 반환 패턴
   - `return undefined` 또는 bare `return` 존재 여부 → undefined 반환 패턴
   - `throw` 문 존재 여부 → throw 에러 패턴
   - `async` 키워드 여부 → Promise 패턴
   - `Result<T>` / `Either<L,R>` 반환 타입 어노테이션 존재 → Result 패턴
3. 다수결 패턴 결정 → 이탈자 보고

```
"Return type inconsistency: In src/services/user/:
 - getUser, getProfile, getSettings → return null on not-found
 - getPreferences → return undefined on not-found
 
 suggestedRefactor: Align getPreferences to return null for consistency.
 Or introduce a shared NotFound type for all functions."
```

**`api-drift`와의 관계**: api-drift는 **동명** 함수의 시그니처 불일치를 크로스파일로 탐지. return-consistency는 **같은 모듈의 유사 역할** 함수의 반환 **패턴** 불일치를 탐지. 상호 보완.

---

### C-5. Module Cohesion Score (모듈 응집도 점수)

**현재 gap**: `coupling`은 모듈 **간** 결합도(Martin 메트릭)를 사용한다. 모듈 **내부** 응집도를 직접 측정하는 디텍터가 없다. `Abstraction Fitness`(B-IV-3)가 응집도/결합 비율을 보지만, 응집도 자체를 독립적으로 보고하지 않는다.

**측정** (LCOM 변형):
1. 모듈 내 export 심볼 목록 추출
2. 각 심볼 쌍이 공유하는 내부 의존성(import, 호출, 타입 참조) 수 계산
3. **Cohesion Score** = `공유 내부 의존성이 있는 심볼 쌍 / 전체 심볼 쌍`
4. Score < 0.3 → 모듈이 분리 후보

**엔진**: `dependencies`의 adjacency + `symbol-extractor-oxc`로 구현 가능.

```
"Low cohesion: src/utils/index.ts — 12 exports, cohesion score 0.15.
 Only 2 of 66 possible symbol pairs share internal dependencies.
 
 suggestedRefactor: Split into focused modules (e.g., string-utils, date-utils, validation-utils).
 Each resulting module should have cohesion > 0.5."
```

---

### C-6. Naming Semantic Drift (네이밍 의미 불일치)

**현재 gap**: PLAN.md의 `naming-predictability`는 파일명 blocklist(`utils.ts`) 수준이다. 함수명이 실제 동작과 불일치하는 경우를 탐지하지 않는다.

**핵심 탐지**: `get*` prefix 함수가 부수효과(side-effect)를 실행하는 경우.

**알고리즘**:
1. `get*`, `is*`, `has*`, `check*` prefix 함수 식별 (읽기 전용 암시)
2. 함수 body에서 부수효과 호출 탐지: `delete`, `update`, `set`, `write`, `emit`, `dispatch`, `push`, `remove`, `save`, `create`, `insert`, `send` 등의 함수 호출
3. 부수효과 호출이 있으면 → finding

```
"Naming semantic drift: getUser() at src/services/user.ts:45
 Function name implies read-only operation, but body calls:
 - updateLastAccess() at line 52 (side-effect)
 - emit('user:accessed') at line 55 (side-effect)
 
 An agent will assume this is safe to call repeatedly without side effects.
 
 suggestedRefactor: Rename to 'fetchAndTrackUser()' or extract side effects into a separate function."
```

**추가 탐지** (낮은 우선순위):
- boolean 변수/함수가 `is/has/should` prefix 없이 선언
- 함수명에 목적어 없음 (`data()`, `process()`, `handle()` — 의미 불명)

---

### C-7. Error Boundary Completeness (에러 경계 완전성)

**현재 gap**: `exception-hygiene`가 catch 블록 패턴을 보지만, **에러 전파 경로의 완전성**은 보지 않는다.

**탐지 패턴**:

| 유형 | 설명 | 탐지 방법 |
|------|------|-----------|
| Swallowed error in chain | async 체인 중간에서 에러를 삼킴 | exception-hygiene의 silent-catch + 호출 그래프 확장 |
| Inconsistent error wrapping | 같은 계층의 함수들이 에러를 다르게 감싸거나 변환 | export 함수의 catch 블록 패턴 비교 |
| Missing error boundary | try-catch 없이 외부 I/O 호출 | AST: fetch/fs/net 등의 호출이 try 블록 외부에 있는지 |

**엔진**: exception-hygiene 확장. 별도 디텍터보다는 exception-hygiene에 kind 추가.

```
"Error boundary gap: fetchUserData() at src/api/user.ts:23
 Calls fetch() without try-catch. Error propagates uncaught to 4 callers,
 none of which handle network errors.
 
 suggestedRefactor: Add try-catch around fetch() call, or document that callers must handle NetworkError."
```

---

### 기존 디텍터 카탈로그와 C-시리즈의 관계

| C-시리즈 | 기존 디텍터 | 관계 |
|----------|-----------|------|
| C-1 Dead Code | `waste`, `dependencies/dead-export` | waste의 확장: 변수→문/블록/함수 수준 |
| C-2 Responsibility Boundary | 없음 (DiagnosticAggregator 추론만) | 신규, god-function 진단의 직접 입력 |
| C-3 Parameter Object | 없음 (DiagnosisPattern에만 존재) | 신규, data-clump 진단의 직접 입력 |
| C-4 Return Consistency | `api-drift` | 보완: 동명→유사역할, 시그니처→반환패턴 |
| C-5 Module Cohesion | `coupling` | 보완: 모듈간 결합도→모듈내 응집도 |
| C-6 Naming Semantic | PLAN의 `naming-predictability` | 확장: 파일명 blocklist→함수 의미 정합성 |
| C-7 Error Boundary | `exception-hygiene` | 확장: catch 패턴→에러 전파 경로 |

---

## 0. 각 Feature 역할 요약

| # | Feature | 역할 | 분석 유형 |
|---|---------|------|-----------|
| 1 | `exact-duplicates` | Type-1 클론(완전 동일 코드 블록) 감지 | AST fingerprint |
| 2 | `structural-duplicates` | Type-2(구조 동일) + Type-3(정규화 후 동일) 클론 감지 | AST fingerprint |
| 3 | `waste` | CFG + 데이터플로우로 dead store(미사용 변수 할당) 탐지 | CFG/dataflow |
| 4 | `nesting` | 함수별 중첩 깊이, cognitive complexity, accidental quadratic, callback depth | AST traversal |
| 5 | `early-return` | guard clause 도입 가능성, invertible if-else, loop guard clause | AST traversal |
| 6 | `noop` | 부수효과 없는 expression, self-assignment, constant condition, empty catch/function | AST traversal |
| 7 | `forwarding` | thin wrapper, 인트라/크로스파일 forwarding chain, circular forwarding | AST + import resolution |
| 8 | `dependencies` | 파일 의존 그래프, 순환 참조(Tarjan SCC + Johnson), fan-in/out, layer violation, dead export | import graph |
| 9 | `coupling` | Martin 메트릭(Instability, Abstractness, Distance), god-module, bidirectional coupling | dependencies 출력 소비 |
| 10 | `barrel-policy` | barrel 규칙: export *, strict index, deep import, missing index, explicit index import | AST + import resolver |
| 11 | `exception-hygiene` | 예외 위생 18개 규칙: silent-catch, useless-catch, throw-non-error, floating-promises 등 | AST traversal |
| 12 | `unknown-proof` | `unknown`/`any` 타입이 boundary 외부에서 내로잉 없이 사용되는지 검증 | AST + tsgo LSP hover |
| 13 | `api-drift` | 동명 함수/인터페이스 메서드의 시그니처 불일치 탐지 | AST + tsgo LSP hover |
| 14 | `typecheck` | tsgo LSP 기반 타입 체크 | tsgo LSP diagnostics |
| 15 | `lint` | oxlint 래퍼 | 외부 도구 |
| 16 | `format` | oxfmt 래퍼 | 외부 도구 |

---

## 1. 성능 최적화

### 1.1 `scan.usecase.ts` 실행 순서 비효율

현재 실행 흐름:

```
[Sync 순차] exact-duplicates → waste → (dependencies → coupling)
                              → structural-duplicates → nesting
                              → early-return → exception-hygiene → noop → forwarding

[Async 병렬] barrel-policy, unknown-proof, typecheck, api-drift
             → Promise.all 대기
```

**문제점**:

- **Sync 디텍터 8개가 순차 실행**: exact-duplicates, waste, structural-duplicates, nesting, early-return, exception-hygiene, noop, forwarding — 상호 의존이 없는데 직렬로 실행
- **nesting + early-return 이중 AST 순회**: 둘 다 `collectFunctionItems`로 모든 함수를 순회하지만, 각각 독립적으로 한 번씩 순회함

**개선 설계**:

```
Stage 0: Init (병렬)
  ├── initHasher()
  ├── resolveRuntimeContextFromCwd()
  └── getOrmDb()

Stage 1: Indexing + Cache Check

Stage 2: Pre-Parse (fix mode, 병렬)
  ├── analyzeFormat(fix=true)
  └── analyzeLint(fix=true)

Stage 3: Parse (createFirebatProgram)

Stage 4: Detectors (최대 병렬)
  ├── [Group A: CPU-bound, 상호 독립]
  │   ├── exact-duplicates + structural-duplicates (단일 패스)
  │   ├── waste
  │   ├── nesting + early-return (단일 패스)
  │   ├── noop
  │   ├── exception-hygiene
  │   └── forwarding
  │
  ├── [Group B: I/O-bound, 독립]
  │   ├── barrel-policy
  │   └── format/lint (check mode)
  │
  ├── [Group C: tsgo LSP 세션 공유]
  │   ├── typecheck
  │   ├── unknown-proof
  │   └── api-drift
  │
  └── [Group D: 의존 관계]
      ├── dependencies (선행)
      └── coupling (dependencies 결과 소비)

Stage 5: Aggregate + Cache
```

**핵심 절감 효과**:

| 최적화 | 절감 | 난이도 |
|--------|------|--------|
| nesting + early-return 단일 패스 병합 | AST 순회 1회 절약 (전체 함수 재순회 제거) | 낮음 |
| exception-hygiene 이중 순회 → 단일 순회 | 파일당 AST 순회 1회 절약 | 중간 |
| structural-duplicates `detectClones` 2회 → 단일 패스 | fingerprint 계산 1회 절약 | 중간 |
| tsgo LSP 세션 공유 (typecheck, unknown-proof, api-drift) | 프로세스 spawn 2회 절약 (수백 ms) | 높음 |
| 독립 sync 디텍터를 Bun Worker 분산 | CPU 멀티코어 활용 | 높음 |

### 1.2 `dependencies/analyzer.ts` dead export 탐지 복잡도

`collectImportConsumers`가 파일별로 호출되어 O(N × M) (N=파일, M=평균 import). 단일 패스로 전체 import 인덱스를 먼저 구축한 뒤 조회하면 O(N + M)으로 개선 가능.

### 1.3 `forwarding` cross-file chain 깊이

fixpoint iteration: 최악 O(N²). 위상 정렬(topological sort) 적용 시 O(N).

---

## 2. 알고리즘/로직 개선

### 2.1 `coupling`: god-module 임계값

```typescript
const godModuleThreshold = Math.max(10, Math.ceil(totalModules * 0.1));
```

100개 모듈 → 임계값 10. fan-in 10 + fan-out 10이면 god-module. **너무 낮음** — 유틸 모듈이 과도하게 플래깅됨.

**개선**: `Math.max(15, Math.ceil(totalModules * 0.15))` 또는 별도 config 제공.

### 2.2 `nesting`: switch case 미반영

`isDecisionPoint`에 `SwitchStatement`는 포함되나 개별 `SwitchCase`는 미포함. 10-case switch와 2-case switch의 cognitive complexity가 동일하게 계산됨.

**개선**: `SwitchCase`를 depth는 증가시키지 않되 `cognitiveComplexity += 1`로 반영하거나, case 수를 metrics에 추가.

### 2.3 `api-drift`: prefix family 그루핑 과도

```typescript
const extractPrefixFamily = (name: string): string | null => {
  // 첫 대문자에서 자름 → "getUser" → "get"
};
```

`getUser`, `getUserById`, `getConfig`, `getData` → 모두 prefix `"get"`. 모든 getter를 한 그룹으로 묶어 **노이즈 폭발**.

**개선 옵션**:
- 최소 2-word prefix 요구: `getUser`와 `getConfig`를 구분
- prefix 길이 하한 설정 (예: 최소 4자)
- prefix family 최소 멤버 수 상향 (현재 3 → 5)

### 2.4 `early-return`: invertible-if-else 임계값 경직

```typescript
if (shortCount <= 3 && endsWithReturnOrThrow(shortNode) && longCount >= shortCount * 2)
```

하드코딩된 `3`과 `2x`. 설정 불가.

**개선**: config로 `maxShortBranchStatements`, `longToShortRatio` 노출.

### 2.5 `exception-hygiene`: overscoped-try 임계값

```typescript
if (stmts.length >= 10) { /* overscoped-try */ }
```

숫자 10은 임의값. try 블록의 문장 수만으로 판단하면 단순 assignment 10줄도 경고.

**개선**: 문장 수 + try 내부 호출 수(실제 예외 가능 지점)의 조합. 또는 config 노출.

---

## 3. 정확도 개선

### 3.1 `unknown-proof`: hover 텍스트 파싱 취약성

tsgo LSP hover 결과에서 `unknown`/`any` 문자열을 regex로 탐지:

```typescript
const hasWordInType = (typeSnippet: string, word: string): boolean => {
  return hasWord(typePart, word);
};
```

**문제**:
- `unknownHandler`, `anyValue` 같은 식별자에 포함된 단어를 오탐 가능
- tsgo hover 형식 변경 시 전체 탐지 실패
- 타입 별칭 뒤에 숨겨진 `unknown`은 탐지하지만, 표면에 보이지 않는 제네릭 인자의 `unknown`은 누락 가능

**개선 옵션**:
- hover 대신 `textDocument/completion` 또는 semantic tokens API 활용
- 타입 문자열 파싱을 정규화된 파서로 교체 (최소한 `: ` 뒤 타입 부분만 검사)
- 식별자 이름 자체에 대한 exclusion 패턴 추가

### 3.2 `noop`: empty-function-body 오탐

confidence 0.6이지만, 의도적 no-op 패턴을 구분하지 못함:
- `() => {}` (callback placeholder)
- 함수 이름이 `noop`, `stub`, `mock`, `_` 등

**개선**: 함수/변수 이름이 no-op 의도를 나타내면 제외. 콜백 인자 위치면 confidence 추가 하향.

### 3.3 `exception-hygiene`: 이중 순회 충돌

```typescript
// walkOxcTree로 EH-01..08 검사 (tryCatchStack 없음)
walkOxcTree(program, node => { ... });
// visit()로 EH-09..14 검사 (tryCatchStack 관리)
visit(program);
```

EH-01 `useless-catch`에서 nested catch 판단 시 `tryCatchStack`을 참조하지만, 이 스택은 `visit` 순회에서만 관리됨. **walkOxcTree 실행 시점에는 스택이 비어 있어 nested 판단이 부정확**.

**개선**: 두 순회를 하나로 통합하여 `tryCatchStack`을 일관되게 유지.

### 3.4 `barrel-policy` + `dependencies`: 확장자 제한

```typescript
// barrel-policy
if (!normalized.endsWith('.ts')) continue;

// dependencies resolveImport
const candidates = [base, `${base}.ts`, path.join(base, 'index.ts')];
```

`.tsx`, `.mts`, `.cts`, `.js`, `.jsx` 파일 미지원. TSX 컴포넌트가 많은 React 프로젝트에서 barrel 규칙과 의존성 분석이 불완전.

**개선**: 지원 확장자를 `['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs']`로 확장. 설정으로 제어 가능하게.

### 3.5 `dependencies`: `readFileSync` Bun-first 위반

```typescript
const raw = readFileSync(path.join(rootAbs, 'package.json'), 'utf8');
```

AGENTS.md Bun-first 원칙 위반. `analyzeDependencies`가 sync 함수라서 발생한 제약. async 전환 또는 시작 시 미리 읽어 주입하는 방식으로 해결.

---

## 4. Feature 병합/중복 제거

### 4.1 `nesting` + `early-return` → `complexity` 단일 패스

| 현재 | 개선 |
|------|------|
| 각각 `collectFunctionItems` 호출 (2회 전체 함수 순회) | 단일 패스: nesting metrics + early-return suggestions 동시 산출 |
| 출력 타입 분리 (`NestingItem`, `EarlyReturnItem`) | `ComplexityItem { nesting, earlyReturn, suggestions }` 통합 |

`shouldIncreaseDepth`, `resolveFunctionBody` 등 공유 유틸 동일. 한 번의 함수 방문으로 모든 metrics 산출 가능.
디텍터 이름은 호환성을 위해 유지하되 내부 패스를 통합.

### 4.2 `exact-duplicates` + `structural-duplicates` → 단일 패스

둘 다 `detectClones(files, minSize, cloneType)`를 호출. 차이는 fingerprint 함수뿐. 단일 AST 순회에서 여러 fingerprint를 동시에 계산하면 순회 비용 절반.

출력은 기존 호환:
```typescript
{ 'exact-duplicates': type1Results, 'structural-duplicates': type2_3Results }
```

### 4.3 `noop` `empty-catch` → `exception-hygiene`로 완전 이관

현재 `shouldIncludeNoopEmptyCatch` 게이팅으로 조건부 억제 중. 이는 밴드에이드.

- noop에서 `empty-catch` kind 제거
- exception-hygiene `silent-catch`가 모든 빈 catch를 포괄하도록 확인
- 게이팅 로직(`noop-gating.ts`) 삭제

---

## 5. 매직 넘버 설정화

현재 하드코딩된 임계값 목록:

| 위치 | 현재 값 | 의미 |
|------|---------|------|
| nesting | `cognitiveComplexity >= 15` | 경고 임계값 |
| nesting | `maxDepth >= 3`, `>= 4` | 제안 트리거 |
| nesting | `callbackDepth >= 3` | 콜백 깊이 |
| early-return | `shortCount <= 3` | invertible-if 짧은 분기 |
| early-return | `longCount >= shortCount * 2` | invertible-if 비율 |
| exception-hygiene | `stmts.length >= 10` | overscoped-try |
| coupling | `distance > 0.7` | off-main-sequence |
| coupling | `instability > 0.8 && fanOut > 5` | unstable-module |
| coupling | `instability < 0.2 && fanIn > rigidThreshold` | rigid-module |
| api-drift prefix | `count >= 3` | prefix family 최소 멤버 |
| forwarding | `maxForwardDepth` | 이미 config ✓ |

**개선**: `.firebatrc` 또는 PLAN.md config 체계에 맞춰 각 디텍터별 config section 노출. 기본값은 현재 값 유지.

---

## 6. Finding 형식 불일치

PLAN.md §1 명세: `kind`, `message`, `filePath`, `span`, `metrics`, `why`, `suggestedRefactor`

| Feature | `metrics` | `why` | `suggestedRefactor` |
|---------|-----------|-------|---------------------|
| coupling | ✅ | ✅ | ✅ |
| nesting | ✅ (타입이 `NestingMetrics`, PLAN 명세의 `Record<string, number>`와 구조 불일치) | ❌ | `suggestions`로 대체 |
| early-return | ✅ (타입이 `EarlyReturnMetrics`, 동일 구조 불일치) | ❌ | `suggestions`로 대체 |
| noop | ❌ | ❌ | ❌ (`evidence`만) |
| exact-duplicates | ❌ | ❌ | ❌ |
| structural-duplicates | ❌ | ❌ | ❌ |
| waste | ❌ | ❌ | ❌ |
| forwarding | ❌ | ❌ | ❌ (`evidence`만) |
| exception-hygiene | ❌ | ❌ | `recipes`로 대체 |
| barrel-policy | ❌ | ❌ | ❌ (`evidence`만) |
| dependencies (dead-export) | ❌ | ❌ | ❌ |
| unknown-proof | ❌ | ❌ | ❌ |
| api-drift | ❌ | ❌ | ❌ |

**개선 계획**: coupling처럼 `metrics` + `why` + `suggestedRefactor` 3필드를 모든 디텍터에 점진 적용. 기존 `suggestions`, `evidence`, `recipes` 필드는 호환성 유지하되 표준 필드를 추가.

---

## 7. tsgo LSP 세션 활용 최적화

`tsgo-runner.ts`의 `acquireSharedTsgoSession`이 이미 `(cwd, command, args)` 키 기반 세션 풀을 구현하고 있다. `typecheck`, `unknown-proof`, `api-drift` 3개 디텍터가 동일 키로 요청하면 **1회 spawn + 1회 handshake**로 공유된다.

**현재 구조 (이미 구현됨)**:
```
typecheck     ─┐
unknown-proof  ├── acquireSharedTsgoSession(key) → 동일 프로세스 재사용
api-drift     ─┘    └── refCount 기반 생명주기 관리
```

**남은 문제**: 공유 세션 내에서 3개 디텍터가 **직렬 promise queue**로 실행된다. 각 디텍터가 파일을 독립적으로 `textDocument/didOpen`하고 닫으므로, 동일 파일을 3번 open/close한다.

**개선점**:

| 항목 | 현재 | 개선 |
|------|------|------|
| 프로세스 spawn | 1회 (이미 최적) | — |
| 파일 open/close | 디텍터별 독립 (3회 반복) | 한 번만 open, 전 디텍터 완료 후 close |
| 실행 순서 | 직렬 queue | diagnostics(typecheck)를 먼저 수집하고, hover(unknown-proof, api-drift)를 병렬 처리 |

```typescript
// scan.usecase.ts에서 tsgo 소비자를 한 번에 전달
const tsgoResults = await withSharedTsgoSession(
  { root: ctx.rootAbs, logger },
  async session => {
    // 파일 한 번만 open
    const typecheck = await collectDiagnostics(session);
    // diagnostics 완료 후 hover 기반 분석은 병렬 가능
    const [unknownProof, apiDrift] = await Promise.all([
      collectUnknownProofFindings(session),
      collectApiDriftFindings(session),
    ]);
    return { typecheck, unknownProof, apiDrift };
  },
);
```

**주의**: 이 변경은 각 디텍터의 내부 API를 `(program, options) → result`에서 `(session, program, options) → result`로 변경해야 하므로, 디텍터 인터페이스 리팩토링이 선행되어야 한다.

---

## 8. 에러 처리 & 견고성

### 8.1 Parse 에러 시 전체 분석 건너뛰기

대부분의 feature가 `file.errors.length > 0`이면 파일 전체를 skip. 파일 하나의 구문 오류로 인해 해당 파일의 **모든** 분석이 누락됨.

**개선**: skip 대신 warning finding을 생성하고, 파싱 가능한 부분까지는 분석 시도. 또는 최소한 로그로 어떤 파일이 skip되었는지 집계 보고.

### 8.2 barrel-policy resolver 실패 무시

tsconfig 읽기 실패 시 silent fallback. 어떤 설정이 적용되었는지 알 수 없음.

**개선**: resolver 실패 시 logger.warn 으로 기록.

---

## 9. 구현 인프라 (Implementation Infrastructure)

### 9.1 후방 호환성 전략

`FirebatReport`에 `diagnoses`, `health` 필드를 추가하면 기존 MCP 클라이언트와 CLI 소비자가 영향받는다.

**원칙**:
1. **신규 필드는 모두 optional**: `diagnoses?: ReadonlyArray<Diagnosis>`, `health?: CodebaseHealth`
2. **기존 `analyses` 구조 변경 금지**: EnrichedFinding의 신규 필드(`fixScope`, `localFixWarning`, `diagnosisRef`)도 optional로 추가
3. **`meta.reportVersion` 필드 도입**: 출력 스키마 버전을 명시 (`"1.0"` = 현재, `"2.0"` = 3-Layer 완료 시점)
4. **deprecated 필드 공존**: 기존 `suggestions`, `evidence`, `recipes` 필드는 최소 2 minor 버전 동안 유지. 표준 필드(`metrics`, `why`, `suggestedRefactor`)와 병존

```typescript
interface FirebatReport {
  readonly meta: FirebatMeta & { readonly reportVersion: string };
  readonly analyses: Partial<FirebatAnalyses>;
  // optional — 없으면 기존 클라이언트는 영향 없음
  readonly diagnoses?: ReadonlyArray<Diagnosis>;
  readonly health?: CodebaseHealth;
}
```

### 9.2 Config 스키마 확장 계획

신규 디텍터/기능의 config은 기존 `.firebatrc` 체계(`firebat-config.ts` + `firebatrc.schema.json`) 내에서 확장한다.

**추가 필요 항목**:

```jsonc
{
  "features": {
    // 기존 디텍터의 매직 넘버 노출 (Section 5)
    "nesting": { "cognitiveComplexityThreshold": 15, "maxDepthWarn": 4, "callbackDepthThreshold": 3 },
    "early-return": { "maxShortBranchStatements": 3, "longToShortRatio": 2 },
    "exception-hygiene": { "overscopedTryMinStatements": 10 },
    "coupling": { "godModuleThresholdRatio": 0.15, "godModuleThresholdMin": 15 },
    "api-drift": { "prefixMinLength": 4, "prefixFamilyMinMembers": 5 },
    
    // 신규 C-시리즈
    "dead-code": true,
    "responsibility-boundary": { "minClusters": 2, "maxOverlapRatio": 0.2 },
    "parameter-object": { "minParams": 3, "minOccurrences": 3, "maxParamsPerFunction": 5 },
    "return-consistency": true,
    "module-cohesion": { "minCohesionScore": 0.3 },
    "naming-semantic": { "sideEffectVerbs": ["delete", "update", "set", "write", "emit", "dispatch", "push", "remove", "save", "create", "insert", "send"] },
    "error-boundary": true,
    
    // 신규 B-시리즈
    "symmetry-breaking": { "groups": [] },
    "temporal-coupling": true,
    "implicit-state": true,
    "variable-lifetime": { "maxLifetimeLines": 50 },
    "decision-surface": { "maxAxes": 4 },
    "modification-impact": { "maxRadiusLines": 500 },
    "implementation-overhead": { "minRatio": 3.0 },
    "concept-scatter": { "maxScatterIndex": 20 },
    "abstraction-fitness": { "minFitnessScore": 1.0 },
    "invariant-blindspot": true,
    "modification-trap": true
  }
}
```

**`FirebatDetector` union type 확장**: 신규 디텍터를 추가할 때마다 `src/types.ts`의 `FirebatDetector`, `src/firebat-config.ts`의 config 인터페이스, `assets/firebatrc.schema.json`을 동시에 업데이트.

### 9.3 `report.ts` 텍스트 렌더러 확장

Layer 2/3 출력을 CLI text 포맷으로 어떻게 표현할지:

```
── Diagnoses ─────────────────────────────────────────
D-GOD-a3f1-34  structural  god-function  processOrder() handles 3 concerns       → resolves 4 findings
D-CLMP-b2c4-0  design      data-clump    (userId, userName, userEmail) × 7 fns   → resolves 7 findings

── Health ────────────────────────────────────────────
Overall: 72/100
  Simplicity: 68  Modularity: 75  Consistency: 80  TypeIntegrity: 65  Maintainability: 72

── Top Priorities ────────────────────────────────────
1. D-GOD-a3f1-34 (resolves 4)  processOrder() handles 3 concerns
2. D-CLMP-b2c4-0 (resolves 7)  (userId, userName, userEmail) × 7 functions
```

### 9.4 테스트 전략

| 대상 | 전략 | 위치 |
|------|------|------|
| DiagnosticAggregator 패턴 매칭 | 각 DiagnosisPattern에 대해 true-positive, true-negative, edge-case | `test/integration/diagnostic-aggregator/` |
| C-시리즈 신규 디텍터 | BDD 스타일: 입력 코드 fixture → expected finding | `test/integration/{detector-name}/` |
| B-시리즈 분석기 | 입력 프로그램 → expected 출력 구조 검증 | `test/integration/{analyzer-name}/` |
| EnrichedFinding 필드 | 기존 디텍터별로 `fixScope`, `localFixWarning` 생성 검증 | 각 feature의 기존 spec 확장 |
| MCP assess-impact | 심볼 쿼리 → impact radius 결과 | `test/mcp/` |

### 9.5 성능 예산

| Phase | 허용 추가 시간 | 근거 |
|-------|-------------|------|
| Phase 5 (DiagnosticAggregator) | scan 전체 시간의 **10% 이하** | finding 수 N에 대해 O(N²) 이하 보장 |
| C-시리즈 디텍터 (새 AST 패스) | 기존 디텍터 합계의 **20% 이하** | 기존 엔진 재활용으로 추가 AST 순회 최소화 |
| assess-impact MCP 툴 | 호출당 **500ms 이내** | 에이전트 응답 지연에 직접 영향 |

---

## 10. 누락 기능 (PLAN.md 기준)

| PLAN 항목 | 상태 | 우선순위 |
|-----------|------|----------|
| **giant-file** (A1) | ❌ 미구현 | **즉시** |
| **dependency-direction** (A2) | ⚠ 부분 (config 모델 불일치: 현재 `layers` + `allowedDependencies`, PLAN은 `layers[].globs` + `rules[]`) | 높음 |
| **dead-export Stage 2** (A3) | ⚠ 부분 (package.json entrypoint 읽지만 library mode 미완) | 중간 |
| **export-kind-mix** (B2) | ❌ 미구현 | 중간 |
| **scatter-of-exports** (B3) | ❌ 미구현 | 중간 |
| **shared-type-extraction** (B1) | ❌ 미구현 | 중간 |
| **public-surface-explosion** (B4) | ❌ 미구현 | 낮음 |
| **generated-mixed** (C1) | ❌ 미구현 | 낮음 |
| **naming-predictability** (C2) | ❌ 미구현 | 낮음 |

---

## 11. 기존 PLAN.md 디텍터와의 통합

PLAN.md의 Tier A-C 디텍터(giant-file, export-kind-mix, scatter-of-exports 등)는 여전히 구현할 가치가 있지만, **독립 finding이 아니라 B-III Blueprint/Transformation의 입력 신호**로 활용된다.

| PLAN 디텍터 | 통합 위치 |
|-------------|-----------|
| giant-file | → Blueprint의 분할 대상 식별 |
| export-kind-mix | → Concept Scatter + Blueprint의 모듈 분리 근거 |
| scatter-of-exports | → Abstraction Fitness의 입력 |
| dead-export | → Deletion Candidates의 입력 |
| shared-type-extraction | → Transformation Script의 EXTRACT 연산 |
| dependency-direction | → Implicit State Protocol + Temporal Coupling의 보조 |
| public-surface-explosion | → Modification Impact Radius의 입력 |

---

## 12. 실행 우선순위

> **용어 구분**: 이 섹션의 "Phase 0-6"은 **개발 로드맵 단계**를 의미한다. Section 1.1의 "Stage 0-5"는 `scan.usecase.ts`의 **런타임 실행 단계**이며 별개의 개념이다.

### MVP 릴리스 컷

**MVP = Phase 0 완료**. 이것만으로 기존 출력에 `fixScope` + `diagnosisRef` + `diagnoses` + `health`가 추가되며, 기존 finding만으로도 DiagnosticAggregator가 진단 그룹을 생성한다. 신규 디텍터(B/C) 없이도 즉시 가치를 제공한다.

| MVP 포함 | MVP 제외 |
|----------|----------|
| EnrichedFinding 필드 (id, fixScope, localFixWarning, diagnosisRef) | B-시리즈 전체 (Phase 1, 3, 4, 5) |
| DiagnosticAggregator (기존 16개 디텍터 finding 대상) | C-시리즈 전체 (Phase 2) |
| CodebaseHealth (scoreStatus: 'experimental') | Transformation Script / Blueprint |
| report.ts 렌더러 확장 | assess-impact MCP 도구 |
| reportVersion 도입 | 기존 디텍터 성능 최적화 (Phase 6) |
| reaching-definitions 엔진 추출 | |

### Phase별 완료 조건 (DoD)

**공통 조건 (모든 Phase):** 같은 소스 코드에 같은 디텍터를 실행하면 항상 같은 결과가 나와야 한다 (결정론적 재현성).

| Phase | 완료 조건 |
|-------|----------|
| **0 (기반)** | (1) 기존 16개 디텍터의 모든 finding에 id + fixScope 생성 (2) DiagnosticAggregator가 god-function, data-clump 2개 패턴 이상 매칭 (3) 기존 테스트 전량 통과 (4) 기존 MCP 소비자가 신규 필드 무시 시 동작 불변 (후방 호환) |
| **1 (가시화)** | (1) B-I-1~3, B-V-1 디텍터 각각 true-positive 5개 이상 integration test (2) precision ≥ 0.8 (OSS 2개 프로젝트 — 소/중 또는 중/대 규모) (3) scan 전체 시간 증가 ≤ 15% |
| **2 (클린코드)** | (1) C-1~7 디텍터 각각 integration test (2) 기존 디텍터 합계 대비 AST 순회 추가 시간 ≤ 20% |
| **3 (변환 처방)** | (1) Blueprint/Transformation/Deletion 각각 end-to-end 테스트 (2) 생성된 RefactoringPlan을 에이전트가 실행 시 finding 수 감소 검증 |
| **4 (컨텍스트)** | (1) B-II-1~2, B-V-3 디텍터 integration test (2) assess-impact MCP 도구 호출당 ≤ 500ms |
| **5 (엔트로피)** | (1) B-IV-1~3 디텍터 integration test |
| **6 (개선)** | (1) 변경 대상 디텍터의 기존 테스트 전량 통과 (2) 성능 회귀 없음 |

### Phase 의존 그래프

```
Phase 0 (기반)          ← 모든 후속 Phase의 전제
  │
  ├──→ Phase 1 (가시화)      ← 독립 구현 가능
  ├──→ Phase 2 (클린코드 위생) ← 독립 구현 가능, Phase 1과 병렬 가능
  ├──→ Phase 3 (변환 처방)    ← Phase 2의 결과를 입력으로 사용하므로 후행
  ├──→ Phase 4 (컨텍스트 비용) ← 독립 구현 가능, Phase 1과 병렬 가능
  ├──→ Phase 5 (구조 엔트로피) ← 독립 구현 가능
  └──→ Phase 6 (기존 개선)    ← 어느 Phase에서든 병렬 가능
```

### Phase 계획

```
Phase 0 — 기반 (출력 아키텍처 전환)
  구현 순서 (의존 관계 기반 — 반드시 번호 순서대로 진행):
  
  Step 1. NoopFinding, ForwardingFinding에 message: string 필드 추가
    └── 의존: 없음. 후속 Step의 전제 조건 (EnrichedFinding 적용 시 message 필수)
    └── 검증: 기존 noop, forwarding 테스트 전량 통과
  
  Step 2. src/types.ts에 신규 타입 정의
    └── EnrichedFindingFields, Diagnosis, DiagnosisPattern, RefactoringPlan, RefactoringStep, CodebaseHealth
    └── 의존: Step 1 (message 필드가 있어야 Enriched* 타입 정의 가능)
    └── 검증: tsc 통과 (타입만 추가, 런타임 변경 없음)
  
  Step 3. FirebatReport 확장
    └── diagnoses?: ReadonlyArray<Diagnosis>, health?: CodebaseHealth, meta.reportVersion 추가
    └── 의존: Step 2 (Diagnosis, CodebaseHealth 타입 필요)
    └── 검증: 기존 테스트 전량 통과 (optional 필드만 추가이므로 후방 호환)
  
  Step 4. 기존 finding 타입에 Enriched 확장 적용
    └── 각 finding 타입에 & Partial<EnrichedFindingFields> intersection 적용
    └── FirebatAnalyses의 디텍터 결과 타입을 Enriched* 버전으로 교체
    └── 의존: Step 2 (EnrichedFindingFields 타입 필요)
    └── 검증: tsc 통과 (Partial이므로 기존 코드 호환)
  
  Step 5. 각 디텍터에 id + fixScope 생성 로직 추가
    └── 16개 디텍터 각각의 finding 생성 코드에 id, fixScope 필드 할당
    └── id = F-{DETECTOR}-{hashString(relativePath).slice(-4)}-{line}
    └── fixScope = 디텍터별 기본값 테이블(Section 1.1) 참조
    └── 의존: Step 4 (Enriched 타입이 적용되어야 필드 할당 가능)
    └── 검증: 모든 디텍터 테스트에서 finding에 id, fixScope 존재 확인
  
  Step 6. reaching-definitions 추출
    └── waste-detector-oxc.ts의 analyzeFunctionBody에서 reaching-definitions 로직을 engine/reaching-definitions.ts로 분리
    └── 의존: 없음 (다른 Step과 독립. Step 1 이후 언제든 가능)
    └── 검증: waste 디텍터 테스트 전량 통과 (동작 불변)
  
  Step 7. DiagnosticAggregator 구현
    └── src/features/diagnostic-aggregator/aggregator.ts 생성
    └── god-function, data-clump 2개 패턴 매칭 구현
    └── scan.usecase.ts Stage 5에서 호출, enrichments 맵으로 finding 역주입
    └── 의존: Step 5 (finding에 id가 있어야 enrichments 맵 키로 사용 가능)
    └── 검증: integration test — 기존 코드베이스에서 god-function/data-clump 진단 생성 확인
  
  Step 8. report.ts 텍스트 렌더러 확장
    └── diagnoses + health 섹션 출력 추가
    └── 의존: Step 7 (DiagnosticAggregator 출력이 있어야 렌더링 가능)
    └── 검증: 리포트 출력에 diagnoses, health 섹션 포함 확인

Phase 1 — 보이지 않는 것을 가시화 (최고 우선, Phase 0 직후)
  ★ Temporal Coupling (B-I-1) — 에이전트가 절대 스스로 발견 못하는 정보
    └── 엔진: 모듈 레벨 AST 순회 + variable-collector (함수별 read/write 추적)
  ★ Implicit State Protocol (B-I-2) — import 그래프에 없는 결합
    └── 엔진: AST traversal (process.env, module-scope let, singleton, event string)
  ★ Symmetry Breaking (B-I-3) — 에이전트가 가정하고 깨지는 패턴
    └── config 기반 그룹 정의 + 자동 탐지 하이브리드
  ★ Invariant Blindspot (B-V-1) — 타입에 없는 런타임 제약
    └── 엔진: AST (assert/throw 조건, 주석 패턴)

Phase 2 — 클린코드 위생 (Phase 0 직후, Phase 1과 병렬 가능)
  ★ Dead Code Detection (C-1) — unreachable code, unused internal functions
    └── 엔진: CFG builder (unreachable block), AST (비export 함수 참조 카운트)
  ★ Responsibility Boundary (C-2) — 변수 클러스터링 기반 직접 SRP 탐지
    └── 엔진: variable-collector co-occurrence + Union-Find
  ★ Parameter Object Opportunity (C-3) — 반복 파라미터 그룹 직접 탐지
    └── 엔진: AST 함수 시그니처 수집만으로 구현
  ★ Return Type Consistency (C-4) — 같은 모듈 내 반환 패턴 불일치
  ★ Module Cohesion Score (C-5) — LCOM 변형 응집도
    └── 엔진: dependencies adjacency + symbol-extractor-oxc
  ★ Naming Semantic Drift (C-6) — get* 함수의 부수효과 탐지
  ★ Error Boundary Completeness (C-7) — exception-hygiene 확장

Phase 3 — 변환 처방 엔진 (Phase 2 결과를 입력으로 사용)
  ★ Simplified Blueprint (B-III-1) — "이렇게 생겨야 한다" 구조적 목표 제시
    └── C-2(Responsibility Boundary) finding을 주입력으로 사용
  ★ Transformation Script (B-III-2) — 원자적 리팩토링 연산 시퀀스
    └── C-3(Parameter Object) finding → INTRODUCE_TYPE 연산으로 연결
  ★ Deletion Candidates (B-III-3) — 제거로 단순화
    └── C-1(Dead Code) + dead-export + forwarding 결과를 입력으로
  □ giant-file (PLAN A1) → Blueprint 입력으로 구현

Phase 4 — 컨텍스트 비용 모델링 (Phase 0 직후, Phase 1과 병렬 가능)
  ★ Variable Lifetime (B-II-1) — 변수 수명 = 컨텍스트 유지 비용
    └── 엔진: reaching-definitions 모듈 (Phase 0에서 추출) + CFG builder
  ★ Decision Surface (B-II-2) — 독립 결정 축 → 조합 폭발
    └── 엔진: AST 조건식 변수 집합 추출
  ★ Modification Impact Radius (B-V-3, B-II-3 통합)
    └── scan 디텍터 + MCP assess-impact 도구 이중 제공

Phase 5 — 구조적 엔트로피 (Phase 0 직후, 독립 가능)
  ★ Implementation Overhead Ratio (B-IV-1) — 인터페이스/구현 복잡도 비율
  ★ Concept Scatter Index (B-IV-2) — 도메인 개념 산재도
  ★ Abstraction Fitness (B-IV-3) — 모듈 경계 적합도
  □ Modification Trap (B-V-2) — 수정 함정 예측

Phase 6 — 기존 디텍터 개선 + 성능 최적화 (모든 Phase와 병렬 가능)
  □ nesting + early-return 내부 패스 통합
  □ exception-hygiene 이중 순회 → 단일 순회
  □ finding 형식 표준화 (metrics + why + suggestedRefactor)
  □ tsgo LSP 파일 open/close 최적화
  □ 매직 넘버 config 노출
  □ 확장자 지원 (.tsx, .mts, .cts, .jsx)
  □ dependencies readFileSync → Bun-first 전환
  □ PLAN.md Tier B/C 디텍터 (Blueprint 입력으로)

[★] = known mainstream tools 기준 firebat 고유 기능
[□] = 품질/성능 개선
```
