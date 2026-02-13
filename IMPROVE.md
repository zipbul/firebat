# Firebat 개선 계획

> 분석 기준일: 2026-02-13
>
> 범위: `src/features/` 전체 16개 디텍터 + `src/application/scan/scan.usecase.ts` 실행 흐름 + 출력 아키텍처
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

모든 finding에 아래 필드를 추가한다:

```typescript
interface EnrichedFinding {
  // 기존 필드
  readonly kind: string;
  readonly message: string;
  readonly filePath: string;
  readonly span: SourceSpan;
  
  // ── 신규 필드 ──
  
  /** 이 finding이 속하는 진단 그룹 ID. 없으면 독립 finding. */
  readonly diagnosisRef?: string;
  
  /** 수정 범위. 에이전트에게 "이건 줄 단위로 고칠 문제가 아니다"를 알려줌. */
  readonly fixScope: 'line' | 'function' | 'module' | 'cross-module' | 'architecture';
  
  /** 국소 패치 시 발생할 문제. 에이전트가 잘못된 방향으로 가는 것을 명시적으로 차단. */
  readonly localFixWarning?: string;
  
  /** 정량 근거 (PLAN.md §1 준수) */
  readonly metrics: Record<string, number>;
  
  /** 왜 이 코드가 문제인지 (AX 비용 근거) */
  readonly why: string;
  
  /** 구조적 수정 제안 */
  readonly suggestedRefactor: string;
}
```

**`fixScope`가 핵심이다.** 에이전트가 `fixScope: 'module'`을 보면 "이 줄만 고쳐서는 안 된다"를 즉시 인식한다.

**`localFixWarning`도 핵심이다.** 에이전트에게 "하지 말 것"을 명시적으로 전달한다:
```
localFixWarning: "Adding an early return here reduces depth to 4 but leaves the SRP violation. 
                  The function still handles validation + persistence + notification."
```

#### Layer 2: Diagnoses (진단 그룹) — 신규 출력 섹션

개별 finding들을 **근본 원인(root cause)** 기준으로 그룹화한다.

```typescript
interface Diagnosis {
  readonly id: string;                    // "D-001"
  readonly pattern: DiagnosisPattern;     // 안티패턴 유형
  readonly severity: 'structural' | 'design' | 'hygiene';
  
  /** 한 줄 요약 — 에이전트가 가장 먼저 읽는 문장 */
  readonly summary: string;
  
  /** 이 진단에 묶인 finding ID 목록 */
  readonly findingIds: ReadonlyArray<string>;
  
  /** 근거 수치 */
  readonly evidence: Record<string, number | string>;
  
  /** 단계별 리팩토링 계획 — 에이전트가 순서대로 실행 */
  readonly refactoringPlan: RefactoringPlan;
  
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
  "id": "D-001",
  "pattern": "god-function",
  "severity": "structural",
  "summary": "processOrder() in order.ts handles 3 independent concerns: validation (lines 10-25), persistence (lines 26-45), notification (lines 46-70). Each concern shares <12% of variables with others.",
  "findingIds": ["F-001", "F-003", "F-007", "F-012"],
  "evidence": {
    "responsibilityClusters": 3,
    "variableOverlapRatio": 0.12,
    "totalCognitiveComplexity": 34,
    "nestingDepth": 5
  },
  "refactoringPlan": {
    "strategy": "extract-and-delegate",
    "steps": [
      { "order": 1, "action": "EXTRACT", "description": "Extract validation logic (lines 10-25) into validateOrder(order: Order): ValidationResult", "targetSymbol": "validateOrder" },
      { "order": 2, "action": "EXTRACT", "description": "Extract persistence logic (lines 26-45) into saveOrder(order: Order): Promise<void>", "targetSymbol": "saveOrder" },
      { "order": 3, "action": "EXTRACT", "description": "Extract notification logic (lines 46-70) into notifyOrderCreated(order: Order): Promise<void>", "targetSymbol": "notifyOrderCreated" },
      { "order": 4, "action": "INLINE", "description": "Simplify processOrder to orchestrate: validate → save → notify" }
    ],
    "estimatedImpact": "Resolves 4 findings (nesting F-001, complexity F-003, waste F-007, coupling F-012). Cognitive complexity drops from 34 to ~8."
  },
  "expectedResolutions": 4
}
```

**예시: data-clump 진단**

```json
{
  "id": "D-003",
  "pattern": "data-clump",
  "severity": "design",
  "summary": "Parameters (userId: string, userName: string, userEmail: string) appear together in 7 functions across 4 files.",
  "findingIds": ["F-015", "F-016", "F-017", "F-018", "F-019", "F-020", "F-021"],
  "evidence": {
    "clumpSize": 3,
    "occurrences": 7,
    "filesAffected": 4
  },
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
  /** 0-100 종합 점수 */
  readonly overallScore: number;
  
  readonly dimensions: {
    readonly simplicity: number;       // 함수 복잡도, 중첩, 코드 길이
    readonly modularity: number;       // 모듈 경계, 결합도, 응집도
    readonly consistency: number;      // API 일관성, 네이밍, 형식
    readonly typeIntegrity: number;    // 타입 안전성, unknown/any 탈출
    readonly maintainability: number;  // 변경 비용, 산탄총 수술 위험
  };
  
  /** 영향력 기준 정렬된 최우선 진단 목록 */
  readonly topPriorities: ReadonlyArray<{
    readonly diagnosisId: string;
    readonly summary: string;
    readonly resolveCount: number;     // 해결 시 사라지는 finding 수
  }>;
}
```

### 구현: Diagnostic Aggregator

Layer 2, 3을 생성하는 **메타 분석기**. 모든 디텍터 실행 후 Phase 5에서 동작.

```
scan.usecase.ts 실행 흐름:
  Phase 1-4: 기존 디텍터 실행 → Layer 1 findings 수집
  Phase 5 (신규): DiagnosticAggregator
    ├── 1. Finding 상관관계 분석
    │   ├── 동일 파일 + 동일 함수 범위의 findings 그룹화
    │   ├── 동일 심볼/파라미터 패턴의 findings 그룹화
    │   └── 의존성 그래프 기반 크로스파일 findings 그룹화
    │
    ├── 2. 패턴 매칭 → DiagnosisPattern 결정
    │   ├── (nesting + complexity + waste) in same function → god-function
    │   ├── same param group × N functions → data-clump
    │   ├── same concept × N files → shotgun-surgery
    │   ├── forwarding chains + single-impl interfaces → over-indirection
    │   └── (unknown-proof + api-drift) in boundary files → leaky-abstraction
    │
    ├── 3. RefactoringPlan 생성
    │   ├── 패턴별 템플릿 기반 step 생성
    │   └── AST 분석으로 추출 대상 변수/범위 특정
    │
    ├── 4. CodebaseHealth 산출
    │   ├── 차원별 가중 평균
    │   └── topPriorities = resolveCount DESC 정렬
    │
    └── 5. Finding 역참조 주입 (diagnosisRef, fixScope, localFixWarning)
```

### MCP 출력 포맷 변경

```typescript
interface FirebatReport {
  readonly meta: FirebatMeta;
  readonly analyses: Partial<FirebatAnalyses>;
  
  // ── 신규 ──
  readonly diagnoses: ReadonlyArray<Diagnosis>;      // Layer 2
  readonly health: CodebaseHealth;                     // Layer 3
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

**기존 엔진 재활용**: CFG builder + dataflow analyzer + variable collector

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
1. 유사한 역할의 함수 그룹을 식별 (파일명 접미사, 디렉토리 위치, export 패턴)
2. 그룹 내 각 함수의 "구조 시그니처" 추출 (statement 타입 시퀀스, 호출하는 함수 패턴, return 위치)
3. 다수결 패턴(majority pattern) 결정
4. 소수 이탈자(outlier) 탐지 → 두 가지 분류:
   - **비의도적 이탈**: 단순히 빠뜨린 것 → 수정 제안
   - **의도적 이탈**: 주석이나 다른 구조적 이유가 있음 → **"이 함수는 의도적으로 다른 패턴을 따름" 경고를 에이전트에 전달**

```
"Symmetry break: 9/10 handlers in controllers/ follow [validate → authorize → execute → respond].
 paymentHandler deviates: [authorize → validate → execute → retryOnFailure → respond].
 
 ⚠ Agent warning: This deviation may be intentional (payment requires auth before validation, and has retry logic).
 Do NOT normalize this to the majority pattern without understanding the domain reason.
 
 If unintentional: Reorder to match the standard pattern and remove retry logic if not needed."
```

**이것이 왜 중요한가**: 기존 어떤 도구도 이걸 하지 않는다. lint는 파일 단독으로 본다. 코드 리뷰 도구는 diff만 본다. **그룹 내 패턴 일관성을 분석하고, 이탈의 의도성을 판단하는 도구는 존재하지 않는다.**

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

---

#### B-II-3. Modification Impact Radius (수정 영향 반경)

**핵심 통찰**: 에이전트가 한 줄을 수정할 때, 그 수정이 영향을 미치는 범위(impact radius)가 넓을수록 에이전트가 실수할 확률이 높다. 에이전트에게 "이 줄을 수정하면 어디까지 영향이 갈 수 있다"를 미리 알려줘야 한다.

**이것은 scan 시점이 아니라 edit 시점의 도구다.** MCP에서 `assess-impact` 같은 별도 도구로 노출:

```
Agent: "I want to change the return type of getUserById"
firebat assess-impact getUserById → 
  "Changing getUserById affects:
   - 12 direct callers across 8 files
   - 3 of those callers pass the result to functions that depend on the return type
   - 2 tests mock this function
   - Impact radius: 15 files, 23 symbols
   
   High-risk callers (type-unsafe consumption):
   - dashboard.ts:45 — result cast to 'any' before use
   - export.ts:23 — result spread into object literal (shape-dependent)"
```

**기존과의 차이**: `dependencies`는 파일 수준 그래프다. 이것은 **심볼 수준 영향 그래프**이며, scan이 아니라 **수정 전 평가(pre-edit assessment)** 도구다.

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
            "skeleton": "export const processOrder = async (input: OrderInput): Promise<OrderResult> => {\n  const validated = validateOrder(input);\n  const saved = await saveOrder(validated);\n  await notifyOrderCreated(saved);\n  return saved;\n};"
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

---

#### B-III-2. Transformation Script (변환 스크립트)

**핵심 통찰**: 에이전트에게 "suggestedRefactor: Extract validation logic"이라고 말하면, 에이전트는 자기 방식대로 추출한다 (파라미터 선택, 이름, 위치 등). 결과가 들쭉날쭉하다.

firebat이 **원자적 리팩토링 연산의 시퀀스**를 처방한다:

```json
{
  "transformations": [
    {
      "id": "T-001",
      "type": "EXTRACT_FUNCTION",
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
      "type": "REPLACE_PRIMITIVE",
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

**EXTRACT, REPLACE, DELETE** — 세 가지 원자 연산으로 대부분의 구조적 리팩토링이 표현 가능하다.

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

---

### B-IV. 구조적 엔트로피 측정 (Structural Entropy)

전통적 메트릭(complexity, coupling, cohesion)을 넘어서, **코드의 무질서도**를 측정하는 새로운 지표들.

#### B-IV-1. Accidental Complexity Ratio (우발적 복잡도 비율)

**핵심 통찰**: 모든 코드에는 **본질적 복잡도**(문제 자체의 복잡도)와 **우발적 복잡도**(구현 선택에 의한 복잡도)가 있다. 본질적 복잡도는 줄일 수 없다. 우발적 복잡도만 줄일 수 있다.

**측정**:
- **본질적 복잡도 근사**: 함수 내 고유 도메인 개념 수 (파라미터 이름, 호출하는 외부 함수 수, 반환 타입의 복잡도)
- **총 복잡도**: AST 노드 수, 변수 수, 분기 수
- **우발적 비율** = `(총 복잡도 - 본질적 근사) / 총 복잡도`

높은 우발적 비율 = 같은 일을 더 단순하게 할 수 있다는 신호.

```
"Accidental complexity: processPayment() — essential concepts: 4 (payment, user, gateway, result).
 Total complexity: 67 AST nodes, 14 variables, 8 branches.
 Accidental ratio: 0.78 — 78% of complexity is implementation artifact.
 
 Comparable functions with same essential concepts average 22 AST nodes.
 This function is 3x more complex than necessary."
```

---

#### B-IV-2. Concept Scatter Index (개념 산재 지수)

**핵심 통찰**: 하나의 도메인 개념이 몇 개 파일에 걸쳐 있는가. 이것은 `coupling`이나 `dependencies`와 다르다 — import 관계가 아니라 **같은 개념을 다루는 코드의 물리적 분산도**를 측정한다.

**측정**:
1. 식별자에서 도메인 개념 추출 (`createUser`, `updateUser`, `deleteUser`, `UserService`, `UserRepository`, `UserValidator` → 개념 "user")
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

#### B-V-3. Context Window Overflow (컨텍스트 창 초과)

에이전트가 하나의 수정을 올바르게 하기 위해 읽어야 하는 총 코드량을 계산한다. 이 양이 에이전트의 실질적 컨텍스트 창을 초과하면, 에이전트는 불완전한 정보로 수정하게 된다.

**측정**:
1. 특정 심볼을 수정할 때 이해해야 하는 코드 범위:
   - 심볼 자체의 코드
   - 직접 호출자/피호출자
   - 공유 타입 정의
   - 관련 테스트
2. 총 줄 수 = **Required Context Size**
3. 임계값 초과 시 경고 + 컨텍스트 축소 방법 제안

```
"Context window overflow: Modifying 'UserService.updateProfile()' correctly requires reading:
 - UserService class (245 lines)
 - ProfileValidator (89 lines)
 - UserRepository interface + implementation (134 lines)
 - User type definition (45 lines)
 - 3 callers: ProfileController, BatchUpdater, MigrationScript (312 lines total)
 - 2 test files (198 lines)
 Total required context: 1,023 lines.
 
 This exceeds the practical context window for reliable agent modification.
 
 suggestedRefactor: Reduce coupling — updateProfile should depend on fewer abstractions.
 If ProfileValidator is only used here, inline it. If UserRepository has methods unused by this flow, the interface is too broad."
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
| parameter-complexity 탐지 | → B-II-2 Decision Surface + B-II-3 Impact Radius로 맥락 포함 |
| module-cohesion 탐지 | → B-IV-3 Abstraction Fitness가 더 근본적 지표 |

기존 PLAN.md의 디텍터들(giant-file, export-kind-mix 등)은 여전히 유용하지만, **독립적 finding이 아니라 B-III-1 Blueprint의 입력 신호**로 활용된다.

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
- **api-drift Promise가 forwarding 완료 후에야 생성**: forwarding은 sync → api-drift 시작이 불필요하게 지연
- **nesting + early-return 이중 AST 순회**: 둘 다 `collectFunctionItems`로 모든 함수를 순회하지만, 각각 독립적으로 한 번씩 순회함

**개선 설계**:

```
Phase 0: Init (병렬)
  ├── initHasher()
  ├── resolveRuntimeContextFromCwd()
  └── getOrmDb()

Phase 1: Indexing + Cache Check

Phase 2: Pre-Parse (fix mode, 병렬)
  ├── analyzeFormat(fix=true)
  └── analyzeLint(fix=true)

Phase 3: Parse (createFirebatProgram)

Phase 4: Detectors (최대 병렬)
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

Phase 5: Aggregate + Cache
```

**핵심 절감 효과**:

| 최적화 | 절감 | 난이도 |
|--------|------|--------|
| nesting + early-return 단일 패스 병합 | AST 순회 1회 절약 (전체 함수 재순회 제거) | 낮음 |
| exception-hygiene 이중 순회 → 단일 순회 | 파일당 AST 순회 1회 절약 | 중간 |
| structural-duplicates `detectClones` 2회 → 단일 패스 | fingerprint 계산 1회 절약 | 중간 |
| tsgo LSP 세션 공유 (typecheck, unknown-proof, api-drift) | 프로세스 spawn 2회 절약 (수백 ms) | 높음 |
| 독립 sync 디텍터를 Bun Worker 분산 | CPU 멀티코어 활용 | 높음 |
| api-drift Promise 생성을 forwarding 전으로 이동 | api-drift 시작 시점 앞당김 | 낮음 |

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
| nesting | ⚠ 다른 필드명 | ❌ | `suggestions`로 대체 |
| early-return | ⚠ 다른 필드명 | ❌ | `suggestions`로 대체 |
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

## 7. tsgo LSP 세션 공유

현재 `typecheck`, `unknown-proof`, `api-drift` 3개 디텍터가 **각각 독립된 tsgo LSP 세션**을 생성.

```
typecheck   → spawn tsgo → init → open files → diagnostics → close
unknown-proof → spawn tsgo → init → open files → hover checks → close
api-drift   → spawn tsgo → init → open files → hover checks → close
```

**문제**: tsgo 프로세스 3번 spawn + LSP handshake 3회. 대규모 프로젝트에서 수백 ms ~ 수 초.

**개선 설계**:

```typescript
// src/infrastructure/tsgo/shared-session.ts
const withSharedTsgoSession = async (
  opts: { root: string; tsconfigPath?: string; logger: FirebatLogger },
  consumers: Array<(session: TsgoSession) => Promise<void>>,
): Promise<void> => {
  await withTsgoLspSession(opts, async session => {
    // 파일 한 번만 open
    for (const consumer of consumers) {
      await consumer(session);
    }
  });
};
```

세션 1개로 typecheck → unknown-proof → api-drift 순차 실행. 파일 open/close도 한 번만.

---

## 8. 에러 처리 & 견고성

### 8.1 Parse 에러 시 전체 분석 건너뛰기

대부분의 feature가 `file.errors.length > 0`이면 파일 전체를 skip. 파일 하나의 구문 오류로 인해 해당 파일의 **모든** 분석이 누락됨.

**개선**: skip 대신 warning finding을 생성하고, 파싱 가능한 부분까지는 분석 시도. 또는 최소한 로그로 어떤 파일이 skip되었는지 집계 보고.

### 8.2 barrel-policy resolver 실패 무시

tsconfig 읽기 실패 시 silent fallback. 어떤 설정이 적용되었는지 알 수 없음.

**개선**: resolver 실패 시 logger.warn 으로 기록.

---

## 9. 누락 기능 (PLAN.md 기준)

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

## 10. 기존 PLAN.md 디텍터와의 통합

PLAN.md의 Tier A-C 디텍터(giant-file, export-kind-mix, scatter-of-exports 등)는 여전히 구현할 가치가 있지만, **독립 finding이 아니라 B-III Blueprint/Transformation의 입력 신호**로 활용된다.

| PLAN 디텍터 | 통합 위치 |
|-------------|-----------|
| giant-file | → Blueprint의 분할 대상 식별 |
| export-kind-mix | → Concept Scatter + Blueprint의 모듈 분리 근거 |
| scatter-of-exports | → Abstraction Fitness의 입력 |
| dead-export | → Deletion Candidates의 입력 |
| shared-type-extraction | → Transformation Script의 EXTRACT 연산 |
| dependency-direction | → Implicit State Protocol + Temporal Coupling의 보조 |
| public-surface-explosion | → Context Window Overflow의 입력 |

---

## 11. 실행 우선순위

```
Phase 0 — 기반 (출력 아키텍처 전환)
  ★ 3-Layer 출력 모델 타입 정의 (EnrichedFinding, Diagnosis, CodebaseHealth)
  ★ FirebatReport에 diagnoses + health + blueprints + transformations 필드 추가
  ★ 기존 finding에 fixScope + localFixWarning + diagnosisRef 필드 추가
  ★ DiagnosticAggregator 프레임워크 (finding 상관 분석 → 진단 그룹 → 리팩토링 계획)

Phase 1 — 보이지 않는 것을 가시화 (최고 우선)
  ★ Temporal Coupling (B-I-1) — 에이전트가 절대 스스로 발견 못하는 정보
  ★ Implicit State Protocol (B-I-2) — import 그래프에 없는 결합
  ★ Symmetry Breaking (B-I-3) — 에이전트가 가정하고 깨지는 패턴
  ★ Invariant Blindspot (B-V-1) — 타입에 없는 런타임 제약

Phase 2 — 변환 처방 엔진
  ★ Simplified Blueprint (B-III-1) — "이렇게 생겨야 한다" 목표 제시
  ★ Transformation Script (B-III-2) — 원자적 리팩토링 연산 시퀀스
  ★ Deletion Candidates (B-III-3) — 제거로 단순화
  □ giant-file (PLAN A1) → Blueprint 입력으로 구현

Phase 3 — 컨텍스트 비용 모델링
  ★ Variable Lifetime (B-II-1) — 변수 수명 = 컨텍스트 유지 비용
  ★ Decision Surface (B-II-2) — 독립 결정 축 → 조합 폭발
  ★ Modification Impact Radius (B-II-3) — 수정 전 영향 범위 평가 (MCP assess-impact)
  ★ Context Window Overflow (B-V-3) — 수정에 필요한 총 컨텍스트 측정

Phase 4 — 구조적 엔트로피
  ★ Accidental Complexity Ratio (B-IV-1) — 본질 vs 우발적 복잡도
  ★ Concept Scatter Index (B-IV-2) — 도메인 개념 산재도
  ★ Abstraction Fitness (B-IV-3) — 모듈 경계 적합도
  □ Modification Trap (B-V-2) — 수정 함정 예측

Phase 5 — 기존 디텍터 개선 + 성능 최적화
  □ nesting + early-return 내부 패스 통합
  □ exception-hygiene 이중 순회 → 단일 순회
  □ finding 형식 표준화 (metrics + why + suggestedRefactor)
  □ tsgo LSP 세션 공유
  □ 매직 넘버 config 노출
  □ PLAN.md Tier B/C 디텍터 (Blueprint 입력으로)

[★] = 기존 어떤 코드 분석 도구에도 없는 firebat 고유 기능
```
