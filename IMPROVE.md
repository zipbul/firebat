# Firebat 개선 계획

> 분석 기준일: 2026-02-13
>
> 범위: `src/features/` 전체 16개 디텍터 + `src/application/scan/scan.usecase.ts` 실행 흐름 + 출력 아키텍처 + 신규 디텍터/기능 설계
>
> 목적:
> 1. 출력 스키마 개편 — bare array + `top` + `catalog` 체계로 전환 (★ A)
> 2. 에이전트 실패 모드 기반 분석 — 보이지 않는 것을 가시화 (★ B)
> 3. 극한 클린코드 — 코드 위생 디텍터 보강 (★ C)
> 4. 기존 정확도/품질 — 오탐 감소, 알고리즘 개선 (Section 2-3)
> 5. 기능 병합 — 중복 순회/중복 탐지 제거 (Section 4)
> 6. 스캔 순서 최적화 — 병렬화, 단일 패스 (Section 1)
> 7. Finding 형식 통합 — BaseFinding 관례, 프로퍼티 정리 (Section 6)
>
> **참고**: 코드 중복(DRY 위반)은 firebat 자체 디텍터로 탐지 → 직접 수정 예정이므로 이 문서에서 제외한다.

---

## ★ 핵심 과제 A: 출력 스키마 개편 — 에이전트 구조적 수정 유도

### 문제 정의

firebat의 주 소비자는 AI 에이전트(MCP 클라이언트)다. 현재 출력의 두 가지 문제:

1. **증상 나열**: 개별 finding만 제공. 에이전트가 각 finding을 독립 해석하여 국소 패치로 끝냄. 실제로는 여러 finding이 하나의 구조적 원인에서 비롯되지만, 에이전트는 이를 알 수 없음.
2. **페이로드 비대**: 각 finding에 자연어 메시지(`message`, `why`, `suggestedRefactor`)가 포함. 대부분 동일 code의 반복. 에이전트 컨텍스트 윈도우를 불필요하게 소비.

```
현재: scan → finding "nesting depth 5 at line 34" → 에이전트: early return 추가 → 끝
필요: scan → "이 3개 finding은 processOrder()가 3개 책임을 한 함수에서 처리하기 때문"
           → 에이전트: 책임별 함수 추출 → 3개 finding 동시 해소
```

**핵심**: finding은 증상(symptom)이지 진단(diagnosis)이 아니다. 에이전트에게 증상만 보여주면 증상 치료만 한다.

### 설계: FirebatReport 출력 구조

#### 설계 원칙

1. **자연어 제로**: scan 결과에 `message`, `why`, `suggestedRefactor` 등 자연어를 넣지 않는다. 같은 code의 finding이 100개 나오면 같은 문장이 100번 반복 — 컨텍스트 낭비.
2. **catalog 인라인**: 각 code의 설명(cause/approach)은 scan 결과의 `catalog` 섹션에 **한 번만** 포함. 별도 조회 entry point 없음.
3. **구조 최소화**: 중복 제거한 최소 필드. 에이전트가 3단계(우선순위→설명→위치)로 필요한 정보에 접근.
4. **래퍼 폐기**: `*Analysis` 래퍼(각 디텍터별 `LintAnalysis`, `NestingAnalysis` 등) 불필요. status/tool/error는 `meta.errors`로 흡수. 모든 디텍터 결과는 배열.
5. **self-documenting 프로퍼티명**: 스키마 문서 없이 에이전트가 즉시 이해 가능. 도메인 약어(`cc`, `adj`, `inst` 등) 금지.

#### FirebatReport

```typescript
interface FirebatReport {
  readonly meta: FirebatMeta;
  readonly analyses: Partial<FirebatAnalyses>;   // 디텍터별 raw 결과
  readonly top: ReadonlyArray<Priority>;         // 패턴별 우선순위 (resolves DESC)
  readonly catalog: Record<string, CodeEntry>;   // 이 scan에서 등장한 code만
}
```

| 필드 | 역할 |
|------|------|
| `meta` | scan 메타정보 + 실패한 디텍터 에러 |
| `analyses` | 디텍터별 결과. 래퍼 없이 배열. 성공한 디텍터만 포함 |
| `top` | 패턴별 finding 수 내림차순. 에이전트 행동 우선순위. **lint/format/typecheck 제외** |
| `catalog` | 각 code의 cause/approach. 이 scan에서 등장한 code만 포함 |

#### FirebatMeta

```typescript
interface FirebatMeta {
  readonly engine: 'oxc';
  readonly targetCount: number;
  readonly minSize: number;
  readonly maxForwardDepth: number;
  readonly detectors: ReadonlyArray<FirebatDetector>;
  readonly detectorTimings?: Record<string, number>;
  readonly errors?: Record<string, string>;  // 실패한 디텍터명 → 에러 메시지
}
```

- 디텍터 성공 → `analyses`에 결과 존재
- 디텍터 실패 → `analyses`에 없고 `meta.errors`에 이유
- 이전의 `status`, `tool`, `error` 필드는 전부 삭제. `meta.errors`로 통합

#### Priority

```typescript
interface Priority {
  readonly pattern: string;      // catalog 참조 키 (e.g., "WASTE_DEAD_STORE")
  readonly detector: string;     // analyses 접근 키 (e.g., "waste")
  readonly resolves: number;     // 해당 패턴의 finding 수
}
```

> **top 생성 대상**: firebat 고유 분석 디텍터만 포함. lint/format/typecheck는 외부 도구 래핑이므로 top에서 **제외**한다. finding 수가 폭발하여 top을 독점하는 정렬 역전을 방지하기 위함. 에이전트가 이 결과를 필요로 하면 `analyses`에서 직접 접근한다.
```

#### CodeEntry

```typescript
interface CodeEntry {
  readonly cause: string;        // 왜 문제인가 (구조적 원인)
  readonly approach: string;     // 사고 방향 (fix 지시 아님)
}
```

> **catalog 언어**: cause/approach는 **영어**로 작성한다. 소비자가 AI 에이전트이므로 token 효율과 일관성을 위함.

#### FirebatAnalyses

`*Analysis` 래퍼 폐기. 모든 디텍터가 배열을 직접 반환.

```typescript
interface FirebatAnalyses {
  'exact-duplicates':       ReadonlyArray<DuplicateGroup>;
  waste:                    ReadonlyArray<WasteFinding>;
  'barrel-policy':          ReadonlyArray<BarrelPolicyFinding>;
  'unknown-proof':          ReadonlyArray<UnknownProofFinding>;
  'exception-hygiene':      ReadonlyArray<ExceptionHygieneFinding>;
  lint:                     ReadonlyArray<LintDiagnostic>;
  typecheck:                ReadonlyArray<TypecheckItem>;  // ⚠ TypecheckItem.code는 TS 에러 코드(e.g., 'TS2322')이며 BaseFinding.code?(catalog 키)와 다른 의미. enrichment 대상에서 제외.
  nesting:                  ReadonlyArray<NestingItem>;
  'early-return':           ReadonlyArray<EarlyReturnItem>;
  noop:                     ReadonlyArray<NoopFinding>;
  'api-drift':              ReadonlyArray<ApiDriftGroup>;
  forwarding:               ReadonlyArray<ForwardingFinding>;
  coupling:                 ReadonlyArray<CouplingHotspot>;
  'structural-duplicates':  ReadonlyArray<DuplicateGroup>;
  dependencies:             DependencyAnalysis;           // 유일한 복합 객체
  format:                   ReadonlyArray<string>;        // 포맷 필요 파일 경로
}
```

#### BaseFinding 관례

finding 성격의 모든 타입이 이 필드를 보장한다. 나머지는 디텍터별 자유 확장.

```typescript
interface BaseFinding {
  readonly kind: string;       // 디텍터 내 분류 (e.g., 'dead-store', 'export-star')
  readonly file: string;       // 파일 경로 (filePath → file)
  readonly span: SourceSpan;   // 위치
  readonly code?: string;      // catalog 참조 키 (e.g., 'WASTE_DEAD_STORE')
}
```

- `kind`: 디텍터 내부 분류. 기존 union 타입(`WasteKind`, `BarrelPolicyFindingKind` 등) 유지
- `code`: enrichment layer가 `kind` → `code` 매핑하여 추가. catalog 조회 키

#### 에이전트 소비 flow

```
1. top[0] → { pattern: "WASTE_DEAD_STORE", detector: "waste", resolves: 15 }
2. catalog["WASTE_DEAD_STORE"] → { cause: "...", approach: "..." }
3. analyses.waste.filter(f => f.code === "WASTE_DEAD_STORE") → 구체적 위치들
```

3단계. 우선순위 → 설명 → 위치. 이 정보가 본질적으로 다른 종류이므로 더 줄일 수 없는 최소 경로.

### approach 작성 원칙

> **finding 하나는 증상이지 병이 아니다. approach는 에이전트가 병을 찾도록 사고를 유도한다.**

#### 4가지 규칙

1. **질문으로 출발** — "왜 이 상태인가?"부터. 에이전트가 원인을 직접 추론하게 함
2. **직접 수정 지시 금지** — "삭제하라", "변경하라" 불가. 에이전트가 행위를 스스로 결정
3. **가능한 근본 원인 나열** — 개별 증상이 아닌 구조적 원인 후보를 제시. 에이전트가 해당 코드베이스에서 어떤 원인인지 판별
4. **scope 확장 유도** — "같은 패턴이 밀집해 있다면 개별 수정이 아니라 상위 구조를 검토하라"

| | 금지 | 지향 |
|---|---|---|
| 톤 | "이 변수를 삭제하라" | "이 할당이 왜 불필요해졌는지 파악하라" |
| 범위 | 해당 라인만 지목 | "같은 함수/모듈에서 반복되면 구조 재검토" |
| 원인 | 증상 반복 ("사용되지 않음") | 후보 나열 ("리팩터링 잔재, 로직 변경, 설계 오류") |

#### 예시

```json
{
  "WASTE_DEAD_STORE": {
    "cause": "값이 할당된 후 읽히기 전에 덮어쓰이거나 스코프를 벗어남",
    "approach": "이 할당이 왜 불필요해졌는지 경위를 파악하라. 로직 변경의 잔재, 불완전한 리팩터링, 또는 제어 흐름 설계 오류일 수 있다. 같은 함수에서 반복되면 개별 할당이 아니라 함수의 책임과 흐름을 재검토하라"
  },
  "NESTING_DEEP": {
    "cause": "함수 내 제어 구조가 깊게 중첩되어 인지 복잡도가 높음",
    "approach": "중첩이 깊어진 원인을 파악하라. 여러 관심사가 하나의 함수에 혼재되어 있거나, 예외 경로와 정상 경로가 분리되지 않았을 수 있다. 같은 함수에 다른 finding(waste, coupling 등)이 동반되면 함수 분할을 검토하라"
  }
}
```

### 프로퍼티명 최적화

#### 원칙

> self-documenting 유지. 스키마 문서 없이 에이전트가 즉시 이해 가능해야 한다.
> 도메인 약어 금지: `cc`(cognitive complexity), `adj`(adjacency), `inst`(instability), `abst`(abstractness), `dist`(distance), `ev`(evidence), `conf`(confidence), `sev`(severity) — 에이전트가 다른 단어로 오인.

허용하는 축약:
- **보편적 축약**: 개발자/에이전트가 문서 없이 아는 것 (`filePath`→`file`, `message`→`msg`)
- **상위 컨텍스트 중복 제거**: 디텍터명/타입명이 제공하는 맥락과 겹치는 접두어 제거 (`earlyReturnCount`→`returns`)
- **의미 동일 짧은 단어**: 같은 뜻의 더 짧은 단어 (`suggestedParams`→`params`, `standardCandidate`→`standard`)

#### 공통 변경

| 현재 | → | 적용 범위 |
|------|---|----------|
| `filePath` | `file` | 모든 finding |
| `message` | `msg` | **외부 도구 래핑만** (lint, typecheck). 자체 생성 message는 `code` 대체 후 삭제 |

#### 삭제 대상

| 프로퍼티 | 디텍터 | 이유 |
|---------|--------|------|
| `suggestions` | nesting, early-return | catalog `approach`로 이동 |
| `why` | coupling | catalog `cause`로 이동 |
| `suggestedRefactor` | coupling | catalog `approach`로 이동 |
| `lineText` | typecheck | `codeFrame`과 중복 |
| `status` | lint, typecheck, unknown-proof, exception-hygiene, format | `meta.errors`로 이동 |
| `tool` | 동일 | 정적 매핑 (lint=oxlint, typecheck=tsgo). 불필요 |
| `error` | 동일 | `meta.errors`로 이동 |

#### 디텍터별 축약 (상위 컨텍스트 중복 제거)

| 디텍터 | 현재 → 제안 | 근거 |
|--------|------------|------|
| exact-duplicates | `cloneType`→`kind`, `suggestedParams`→`params` | DuplicateGroup에서 clone 자명. BaseFinding 관례 적용 |
| structural-duplicates | `cloneType`→`kind`, `cloneClasses`→`groups` | clone 중복. BaseFinding 관례 적용 |
| dependencies | `fanInTop`→`fanIn`, `fanOutTop`→`fanOut`, `edgeCutHints`→`cuts`, `exportName`→`name` | Top/edge 수식어 불필요 |
| format | `fileCount`→`files` | count 불필요 (number 타입) |
| nesting | `accidentalQuadraticTargets`→`quadraticTargets` | accidental 수식어 제거 |
| early-return | `earlyReturnCount`→`returns`, `guardClauseCount`→`guards`, `hasGuardClauses`→`hasGuards` | earlyReturn/clause 상위 컨텍스트 |
| api-drift | `standardCandidate`→`standard`, `paramsCount`→`params`, `optionalCount`→`optionals` | candidate/count 수식어 불필요 |

### before/after 예시

**Before (현재)**:
```json
{
  "meta": { "engine": "oxc", "targetCount": 42, "minSize": 20, "maxForwardDepth": 5, "detectors": [...] },
  "analyses": {
    "waste": {
      "status": "ok",
      "tool": "oxc",
      "findings": [
        {
          "kind": "dead-store",
          "label": "unusedVar",
          "message": "Variable 'unusedVar' is assigned but never used after reassignment",
          "filePath": "src/foo.ts",
          "span": { "start": { "line": 42, "column": 4 }, "end": { "line": 42, "column": 20 } },
          "confidence": 0.95
        }
      ]
    }
  }
}
```

**After (개편 후)**:
```json
{
  "meta": { "engine": "oxc", "targetCount": 42, "minSize": 20, "maxForwardDepth": 5, "detectors": [...] },
  "analyses": {
    "waste": [
      {
        "kind": "dead-store",
        "label": "unusedVar",
        "file": "src/foo.ts",
        "span": { "start": { "line": 42, "column": 4 }, "end": { "line": 42, "column": 20 } },
        "confidence": 0.95,
        "code": "WASTE_DEAD_STORE"
      }
    ]
  },
  "top": [
    { "pattern": "WASTE_DEAD_STORE", "detector": "waste", "resolves": 15 },
    { "pattern": "NESTING_DEEP", "detector": "nesting", "resolves": 8 }
  ],
  "catalog": {
    "WASTE_DEAD_STORE": {
      "cause": "값이 할당된 후 읽히기 전에 덮어쓰이거나 스코프를 벗어남",
      "approach": "이 할당이 왜 불필요해졌는지 경위를 파악하라. 로직 변경의 잔재, 불완전한 리팩터링, 또는 제어 흐름 설계 오류일 수 있다. 같은 함수에서 반복되면 개별 할당이 아니라 함수의 책임과 흐름을 재검토하라"
    },
    "NESTING_DEEP": {
      "cause": "함수 내 제어 구조가 깊게 중첩되어 인지 복잡도가 높음",
      "approach": "중첩이 깊어진 원인을 파악하라. 여러 관심사가 하나의 함수에 혼재되어 있거나, 예외 경로와 정상 경로가 분리되지 않았을 수 있다. 같은 함수에 다른 finding이 동반되면 함수 분할을 검토하라"
    }
  }
}
```

자연어 `message` 제거, `filePath`→`file`, 래퍼(`status`/`tool`) 제거, `code` 추가.
catalog은 고유 code 수만큼만 (finding 100개여도 code 5종이면 entry 5개).

### 이전 3-Layer 대비 삭제 총괄

| 삭제 대상 | 이전 소속 | 대체 |
|----------|----------|------|
| message, why, suggestedRefactor, localFixWarning | EnrichedFindingFields (Layer 1) | `code` + `catalog` |
| id, fixScope, diagnosisRef, metrics | EnrichedFindingFields (Layer 1) | 삭제 (YAGNI) |
| summary, plan, conf, severity, evidence, expectedResolutions | Diagnosis (Layer 2) | `top`으로 흡수 |
| Diagnosis 인터페이스 자체 | Layer 2 | `Priority` |
| dimensions, score, status | CodebaseHealth (Layer 3) | 삭제 |
| CodebaseHealth 전체 | Layer 3 | `top`으로 대체 |
| `*Analysis` 래퍼 | 각 디텍터 | `meta.errors`로 이동 |

### 구현: Diagnostic Aggregator

`top`과 `catalog`을 생성하는 **메타 분석기**. 모든 디텍터 실행 후 런타임 Stage 5에서 동작.

**모듈 위치**: `src/features/diagnostic-aggregator/aggregator.ts` (순수 계산 — I/O 없음, Ports & Adapters `features/` 레이어). `index.ts`에서 re-export.

**함수 시그니처**:
```typescript
// src/features/diagnostic-aggregator/aggregator.ts
interface DiagnosticAggregatorInput {
  readonly analyses: Partial<FirebatAnalyses>;   // 디텍터 결과 전체
  readonly dependencyGraph?: DependencyAnalysis; // 크로스파일 상관 분석용 (optional)
}

interface DiagnosticAggregatorOutput {
  readonly top: ReadonlyArray<Priority>;
  readonly catalog: Record<string, CodeEntry>;
}

function aggregateDiagnostics(input: DiagnosticAggregatorInput): DiagnosticAggregatorOutput;
```

> **SRP**: Aggregator는 "finding → pattern 집계"만 담당한다. code 매핑(`kind + detector → code`)은 scan.usecase.ts의 Stage 5 초입에서 Aggregator 호출 전에 수행한다. AST 접근이 필요한 패턴(data-clump 등)은 해당 디텍터(C-3 Parameter Object 등)가 직접 탐지하고, Aggregator는 그 결과만 소비한다.

```
scan.usecase.ts 실행 흐름:
  Stage 1-4: 기존 디텍터 실행 → findings 수집
  Stage 5 (신규):
    ├── 5-1. code 매핑 (scan.usecase.ts)
    │   └── kind + detector → code 변환 (e.g., dead-store + waste → WASTE_DEAD_STORE)
    │   └── 각 finding에 code 필드 주입
    │
    └── 5-2. DiagnosticAggregator
        ├── 1. code별 finding 수 집계 → top 배열 생성 (resolves DESC, lint/format/typecheck 제외)
        │
        ├── 2. 등장한 code의 catalog entry 수집
        │   └── 정적 catalog 테이블에서 해당 code만 추출
        │
        └── 3. 패턴 분석 (god-function, data-clump 등)
            ├── 동일 파일 + 동일 함수 범위의 findings 그룹화
            ├── 패턴 매칭 → 상위 구조 진단 code 생성
            └── catalog에 구조적 진단 approach 포함
```

#### 패턴 매칭

DiagnosticAggregator는 개별 finding을 넘어서 **구조적 패턴**을 탐지한다. 탐지된 패턴은 `top`에 독립 entry로 포함되며, catalog에 사고 유도 approach가 제공된다.

**패턴 목록**:

| 패턴 code | 탐지 조건 | Phase |
|-----------|----------|-------|
| `DIAG_GOD_FUNCTION` | 같은 함수에서 nesting + waste (또는 C-2 responsibility-boundary) 동시 발생 | 0 |
| `DIAG_DATA_CLUMP` | 동일 파라미터 조합이 3개 이상 함수에서 반복 (C-3 필요) | 2+ |
| `DIAG_SHOTGUN_SURGERY` | 동일 개념이 4개 이상 파일에 분산 | 1+ |
| `DIAG_OVER_INDIRECTION` | forwarding chain + single-impl interface (※ single-impl 탐지: dependencies의 export/import 분석으로 인터페이스 export 대비 구현 import 수를 계산. 별도 디텍터 불필요 — dependencies adjacency + symbol-extractor-oxc로 구현) | 1+ |
| `DIAG_MIXED_ABSTRACTION` | 같은 함수 내 nesting depth 차이 > 2 | 1+ |
| `DIAG_CIRCULAR_DEPENDENCY` | dependencies.cycles 직접 승격 | 0 |
| `DIAG_GOD_MODULE` | coupling.god-module 직접 승격 | 0 |

**패턴 catalog 예시**:
```json
{
  "DIAG_GOD_FUNCTION": {
    "cause": "A single function triggers multiple finding types simultaneously (nesting + waste, or responsibility-boundary), indicating it handles multiple independent concerns.",
    "approach": "Determine how many independent concerns this function handles by examining variable clusters. If variables form distinct groups that do not interact, each group likely represents a separable concern. Individual findings (nesting, waste) are symptoms — the root cause is responsibility overload."
  }
}
```

#### 정밀도 관리

DiagnosticAggregator의 패턴 매칭은 **휴리스틱 기반**이다. 오분류 위험을 관리하기 위한 원칙:

1. **보수적 매칭**: 초기 버전은 높은 확신도의 패턴만 포함하고, 애매한 경우 개별 finding code만 유지
2. **패턴별 필수 조건(hard rules)**:
   - `DIAG_GOD_FUNCTION`: nesting.cognitiveComplexity ≥ 15 AND waste finding이 동일 함수에 존재
   - `DIAG_DATA_CLUMP`: 동일 파라미터 조합이 3개 이상 함수에서 반복
   - `DIAG_CIRCULAR_DEPENDENCY`, `DIAG_GOD_MODULE`: 기존 디텍터 결과를 직접 승격 (추가 휴리스틱 없음)
3. **테스트 전략**: 각 패턴에 대해 true-positive, true-negative, edge-case 시나리오를 `test/integration/diagnostic-aggregator/`에 작성

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
3. **구조적 원인을 catalog으로 제공하여 에이전트가 스스로 해법을 설계**하게 하는 것이다.

> **설계 원칙 — 처방하지 않는다**: firebat은 Blueprint(목표 구조)나 Transformation Script(리팩토링 연산)를 직접 생성하지 않는다. 정적 분석만으로 정확한 구조적 처방을 만들기 불가능하며, 틀린 처방은 올바른 방향 제시보다 해가 크다. catalog의 `cause`가 근본 원인을, `approach`가 사고 방향을 제공하고, 구체적 설계 결정은 에이전트가 코드를 직접 분석하여 수행한다.

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

> **Note**: 기존 B-II-3(Modification Impact Radius)는 B-IV-3과 측정 대상이 중복되어 B-IV-3으로 통합되었다. → B-IV-3 참조.

---

### B-III. 구조적 엔트로피 측정 (Structural Entropy)

전통적 메트릭(complexity, coupling, cohesion)을 넘어서, **코드의 무질서도**를 측정하는 새로운 지표들.

#### B-III-1. Implementation Overhead Ratio (구현 오버헤드 비율)

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

**기존 B-III-1(Accidental Complexity Ratio)에서 변경된 이유**: "본질적 복잡도"를 정적 분석으로 근사하는 것은 객관적 정의가 불가능하다 (파라미터가 `config: AppConfig` 하나여도 내부에서 30개 필드를 사용할 수 있음). 인터페이스/구현 비율은 AST만으로 객관적으로 측정 가능하다.

---

#### B-III-2. Concept Scatter Index (개념 산재 지수)

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

#### B-III-3. Abstraction Fitness (추상화 적합도)

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

### B-IV. 에이전트 실패 예측 (Agent Failure Prediction)

firebat의 궁극적 차별화: **에이전트가 이 코드를 수정할 때 어디서 실수할지를 예측**한다.

#### B-IV-1. Invariant Blindspot (불변 조건 사각지대)

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

#### B-IV-2. Modification Trap (수정 함정)

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

#### B-IV-3. Modification Impact Radius (수정 영향 반경)

> **B-II-3과 통합**: 기존 B-II-3(Modification Impact Radius)은 scan 시점이 아니라 edit 시점의 MCP 도구로 기획되었으나, 기존 B-IV-3과 측정 대상이 중복된다. 둘 다 "수정 시 에이전트가 읽어야 할 다른 코드의 범위"를 측정한다. 따라서 두 기능을 **하나의 디텍터 + MCP 도구**로 통합한다.

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

위의 B-I ~ B-IV는 기존 "code smell → detector" 패러다임과 근본적으로 다르다:

| 기존 접근 (PLAN.md 스타일) | 신규 접근 (Agent Failure Mode 기반) |
|---------------------------|-------------------------------------|
| data-clump 탐지 | → B-III-2 Concept Scatter의 한 증상으로 포착됨 |
| primitive-obsession 탐지 | → B-IV-1 Invariant Blindspot의 한 증상으로 포착됨 |
| god-function 탐지 | → DiagnosticAggregator의 DIAG_GOD_FUNCTION 패턴이 catalog approach로 사고 유도 |
| over-engineering 탐지 | → waste 디텍터의 dead-code + forwarding 결과로 포착됨 |
| parameter-complexity 탐지 | → B-II-2 Decision Surface + B-IV-3 Impact Radius로 맥락 포함 |
| module-cohesion 탐지 | → B-III-3 Abstraction Fitness가 더 근본적 지표 |

기존 PLAN.md의 디텍터들(giant-file, export-kind-mix 등)은 여전히 유용하지만, **독립적 finding이 아니라 DiagnosticAggregator의 패턴 탐지 입력 신호**로 활용된다.

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

**DiagnosticAggregator와의 관계**: 이 디텍터가 `DIAG_DATA_CLUMP` 패턴의 직접 입력이 된다. catalog의 approach가 타입 도입 방향을 사고 유도.

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

**현재 gap**: `coupling`은 모듈 **간** 결합도(Martin 메트릭)를 사용한다. 모듈 **내부** 응집도를 직접 측정하는 디텍터가 없다. `Abstraction Fitness`(B-III-3)가 응집도/결합 비율을 보지만, 응집도 자체를 독립적으로 보고하지 않는다.

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

Stage 1: Indexing + Cache Check (Section 1.4 워처 기반 증분 캐싱 참조)
  ├── [bunner 실행 중] changeset 읽기 → 변경 파일만 re-index → digest 증분 계산
  └── [bunner 미실행] 기존 full stat() → indexTargets → computeInputsDigest

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

### 1.4 워처 기반 증분 캐싱

#### 1.4.1 문제 정의

현재 `scan.usecase.ts`의 `indexTargets`는 매 scan 호출마다 **모든 타겟 파일에 `stat()`을 호출**하여 변경 여부를 확인한다. MCP 서버는 장시간 실행되면서 에이전트가 "1파일 수정 → scan → 1파일 수정 → scan"을 반복하는 워크플로를 지원하는데, 파일 1개 변경에도 N개 전부 stat()하는 것은 낭비다.

| 시나리오 | 현재 비용 | 개선 목표 |
|---------|----------|----------|
| MCP: 변경 없이 반복 scan | N×stat() ≈ 70-400ms | **<1ms** |
| MCP: 1파일 변경 + cache hit | N×stat() + digest ≈ 70-400ms | **2-5ms** |
| CLI + bunner 실행 중 | N×stat() ≈ 250ms | **<5ms** |
| CLI 완전 독립 | N×stat() ≈ 250ms | 250ms (변경 없음) |

#### 1.4.2 워처 아키텍처: 단방향 소비 + 독립 모드

firebat은 **두 가지 모드**로 동작하며, scan 호출 시점에 자동으로 결정한다.

```
firebat은 bunner의 watcher 인프라를 소비만 한다. 역방향 의존은 없다.
bunner가 없을 때는 자체 @parcel/watcher로 독립 동작한다.
두 모드의 전환은 scan 호출마다 lazy하게 판정한다.
```

**소비자 모드 (bunner 실행 중):**
bunner가 이미 프로젝트 루트에서 `@parcel/watcher`를 구독하고, `.bunner/cache/changeset.jsonl`에 변경 이력을 기록하고 있다. firebat은 이 changeset을 **읽기만** 한다. firebat이 OwnerElection이나 ChangesetWriter를 구현할 필요가 없다 — 이 복잡한 로직(lock 파일 관리, PID 선출, JSONL rotation, event 판정)은 전부 bunner 쪽 책임이다.

**독립 모드 (bunner 미실행):**
firebat MCP 서버가 자체적으로 `@parcel/watcher.subscribe()`를 호출하여 파일 변경을 감시한다. 변경된 파일 경로를 **메모리 내 `Set<string>`에만 누적**한다. JSONL 파일 기록, rotation, lock 파일 — 전부 없다. MCP 프로세스 수명 동안 메모리에만 존재하고, 프로세스 종료 시 사라진다.

**모드별 역할:**

| 환경 | 워처 | 변경 추적 | 복잡도 |
|------|------|----------|--------|
| MCP + bunner 실행 중 | 없음 (bunner 것을 소비) | changeset.jsonl 읽기 | JSONL reader ~15줄 |
| MCP 단독 | 자체 @parcel/watcher | 메모리 `Set<string>` | subscribe ~20줄 |
| CLI + bunner 실행 중 | 없음 | changeset.jsonl 읽기 (opportunistic) | JSONL reader ~15줄 |
| CLI 완전 독립 | 없음 | 없음 → full stat() | 변경 없음 (기존 코드) |

**핵심 원칙: firebat은 changeset writer가 아니다.** bunner가 기록한 changeset을 읽거나, 자체 watcher로 메모리에 누적하거나, full stat() fallback. 이 세 가지뿐이다.

#### 1.4.3 Lazy 모드 전환 (상태 머신)

firebat MCP 서버는 프로세스 시작 시 모드를 고정하지 않는다. **매 scan 호출마다** bunner 존재 여부를 확인하고 모드를 전환한다.

**판정 기준:** `.bunner/cache/watcher.owner.lock` 파일 존재 + 기록된 PID 생존 여부.

```
[scan 호출]
  watcher.owner.lock 존재?
  ├─ NO → 독립 모드
  └─ YES → PID 읽기 → process.kill(pid, 0)
            ├─ 살아있음 → 소비자 모드
            └─ 죽어있음 → 독립 모드
```

**상태 전이:**

| 현재 모드 | 판정 결과 | 동작 |
|----------|----------|------|
| 독립 → 소비자 | bunner가 나중에 시작됨 | 자체 watcher unsubscribe, 메모리 Set 비우기, 1회 full stat()로 기준선 재설정 |
| 소비자 → 독립 | bunner가 종료됨 | 자체 watcher subscribe 시작, 1회 full stat()로 기준선 재설정 |
| 독립 → 독립 | 변화 없음 | 유지 |
| 소비자 → 소비자 | 변화 없음 | 유지 |

**전환 시 full stat() 1회는 불가피하다.** changeset 공백 기간에 발생한 변경을 놓칠 수 없으므로, 모드 전환 시 1회 전체 stat()으로 안전하게 기준선을 재설정한다. 이후부터 증분.

**판정 비용:** `stat()` 1회 + `readFileSync()` + `process.kill(pid, 0)` ≈ 0.1ms. scan마다 호출해도 무시할 수 있는 수준.

```typescript
// 의사 코드 — 실제 구현은 infrastructure 계층
type WatcherMode = 'independent' | 'consumer';

interface ModeCheckResult {
  mode: WatcherMode;
  changed: boolean;  // 이전 scan 대비 모드가 바뀌었는가
}

function checkMode(lockPath: string, prevMode: WatcherMode): ModeCheckResult {
  try {
    const pid = parseInt(readFileSync(lockPath, 'utf8').trim(), 10);
    process.kill(pid, 0);  // 신호 안 보냄, 존재 확인만
    return { mode: 'consumer', changed: prevMode !== 'consumer' };
  } catch (e: any) {
    if (e?.code === 'EPERM') {
      // 권한 없음 = 프로세스 살아있음 → 소비자 모드
      return { mode: 'consumer', changed: prevMode !== 'consumer' };
    }
    // ENOENT (파일 없음) 또는 ESRCH (프로세스 죽음) → 독립 모드
    return { mode: 'independent', changed: prevMode !== 'independent' };
  }
}
```

#### 1.4.4 bunner changeset 프로토콜 (양측 합의 확정)

bunner가 기록하는 changeset의 형식. firebat은 이 프로토콜을 **소비만** 한다. 아래 내용은 bunner 측 회신으로 **전 항목 수용 확인** 완료.

**파일 경로 (bunner 소유):**

| 파일 | 경로 | 소유자 |
|------|------|--------|
| 워처 락 | `.bunner/cache/watcher.owner.lock` | bunner |
| changeset | `.bunner/cache/changeset.jsonl` | bunner |
| rotation | `.bunner/cache/changeset.jsonl.1` | bunner |

**changeset JSONL 레코드 (bunner가 기록):**

```jsonl
{"ts":1739500000000,"event":"change","file":"src/foo.ts"}
{"ts":1739500000100,"event":"rename","file":"src/bar.ts"}
{"ts":1739500000200,"event":"delete","file":"src/baz.ts"}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `ts` | `number` | epoch ms |
| `event` | `"change" \| "rename" \| "delete"` | 변경 종류 |
| `file` | `string` | 프로젝트 루트 기준 상대 경로, `/` 구분자 |

**event 판정 (bunner 책임, firebat은 관여하지 않음):**
- `type === "update"` → `event: "change"`
- `type === "delete"` → `event: "delete"` (직접 매핑, 존재 확인 불필요)
- 그 외 (`create`, rename-ish 등) → 대상 파일 존재 확인 → 존재 시 `"rename"`, 미존재 시 `"delete"`
- firebat은 레코드의 `event` 값을 그대로 신뢰한다.

**워처 필터 (bunner `PROJECT_WATCHER_IGNORE_GLOBS` 규약):**

```
포함: *.ts (*.d.ts 제외)
무시: **/.git/**, **/.bunner/**, **/dist/**, **/node_modules/**
```

**rotation (bunner 책임):** 1000줄 도달/초과 시 append 전에 rotate 체크 → rename, 2세대 유지. firebat reader는 `.jsonl.1` → `.jsonl` 순서로 읽고 `ts >= lastSeenTs` 필터로 중복/누락 방지 (동일 ms 이벤트 누락 방지를 위해 `>` 대신 `>=` 사용, Set이라 중복 무해).

**경로 정규화:** bunner가 Windows 경로(`\`)를 `/`로 정규화하여 기록. firebat은 `/` 기준으로 처리.

**설정 파일:** `package.json`, `tsconfig*.json`, lockfile은 워처 범위 밖(`*.ts`만). firebat이 scan마다 직접 stat() (5개 미만, <1ms). bunner에 추가 요구 없음.

#### 1.4.5 3-tier 캐시 구조

```
Tier 1 — 변경 감지 (워처가 최적화하는 유일한 계층)
  ↓
Tier 2 — 리포트 캐시 (기존 SQLite artifact, 변경 없음)
  ↓
Tier 3 — 분석 실행 (16 디텍터 전체, 변경 없음)
```

**워처는 Tier 1만 최적화한다.** Tier 2, Tier 3은 기존과 100% 동일.

**Tier 1: 변경 감지 — 모드별 동작**

CLI 모드 (one-shot):
```
watcher.owner.lock 존재 + PID 생존?
├─ YES (bunner가 watcher owner)
│   └─ changeset.jsonl 읽기
│       → 변경 파일만 stat+hash → fileIndex 갱신
│       → 나머지 파일은 SQLite fileIndex 신뢰
│       → 설정파일 stat() (<1ms)
│       → digest 계산 → Tier 2로
│       → 비용: O(K)
│
└─ NO (bunner 미실행)
    → 기존 full stat() flow (indexTargets → computeInputsDigest)
    → 비용: O(N) — 현재 코드와 동일
```

MCP 소비자 모드 (bunner 실행 중):
```
[scan 호출 — zero-change path]
  changeset.jsonl 읽기 → lastSeenTs 이후 이벤트 없음
  + 설정파일 stat() → 변경 없음
  → lastReport 즉시 반환
  → 비용: <1ms

[scan 호출 — K파일 변경 path]
  changeset.jsonl 읽기 → K개 변경 파일 추출
  → K개만 stat+hash → fileIndex 갱신
  + 설정파일 stat()
  → digestParts 맵에서 K개만 교체 → digest 재계산
  → Tier 2 cache check
  → 비용: O(K)
```

MCP 독립 모드 (bunner 미실행):
```
[프로세스 내부]
  @parcel/watcher.subscribe(projectRoot, callback)
  callback: (err, events) => events.forEach(e => changedFiles.add(e.path))

[scan 호출 — zero-change path]
  changedFiles.size === 0
  + 설정파일 stat() → 변경 없음
  → lastReport 즉시 반환
  → 비용: <1ms

[scan 호출 — K파일 변경 path]
  changedFiles에서 K개 추출 → Set 비우기
  → K개만 stat+hash → fileIndex 갱신
  + 설정파일 stat()
  → digestParts 맵에서 K개만 교체 → digest 재계산
  → Tier 2 cache check
  → 비용: O(K)
```

**모드 전환 시 (양방향):** 1회 full stat()로 기준선 재설정 → 이후 증분.

**Tier 2: 리포트 캐시 (기존 유지, 변경 없음)**

| 항목 | 값 |
|------|-----|
| 저장소 | SQLite `artifactRepository` + in-memory hybrid |
| 캐시 키 | `projectKey` + `artifactKey` + `inputsDigest` |
| `projectKey` | `toolVersion + cwd + Bun.version + schemaVersion` |
| `artifactKey` | `detectors + minSize + maxForwardDepth + 디텍터별 옵션` |
| `inputsDigest` | 모든 타겟 파일 contentHash + cacheNamespace + projectInputsDigest |
| 캐시 단위 | **전체 `FirebatReport`** (all-or-nothing) |
| Fix 모드 | 캐시 비활성 (`allowCache = options.fix === false`) |

digest가 일치하면 저장된 리포트 반환, 불일치하면 Tier 3.

**Tier 3: 분석 실행 (기존 유지, 변경 없음)**

cache miss → 16개 디텍터 ALL 파일에 전체 실행 → 결과 저장. 파일 1개 변경이든 100개 변경이든, miss면 전체 재분석. 워처는 이 계층에 영향을 주지 않는다.

#### 1.4.6 MCP 프로세스 내 상태

```typescript
// MCP 서버 어댑터가 프로세스 수명 동안 메모리에 유지하는 상태
interface McpWatcherState {
  mode: 'independent' | 'consumer';  // 현재 모드 (scan마다 재판정)
  subscription: AsyncSubscription | null;  // 독립 모드일 때만 non-null
  changedFiles: Set<string>;         // 독립 모드: watcher 이벤트 누적 (절대 경로)
  lastSeenTs: number;                // 소비자 모드: changeset cursor
  lastDigest: string | null;         // 마지막 inputsDigest
  lastReport: FirebatReport | null;  // zero-change 반환 + diff용
  digestParts: Map<string, string>;  // filePath → "file:{path}:{hash}" (증분 digest)
}
```

**`lastSeenTs` 생명주기:**
- **초기값:** `0` (프로세스 시작 시). 첫 scan은 어차피 full stat()이므로 changeset 전체를 읽어도 무해.
- **모드 전환 시 (independent → consumer):** full stat() 완료 직후 `Date.now()`로 리셋. 이전 이벤트는 full stat()이 모두 반영했으므로 이후 이벤트만 소비.
- **이벤트 소비 후:** 소비한 레코드 중 최대 `ts` 값으로 갱신. 이벤트가 없으면 유지.

**독립 모드 watcher 코드 (전체):**

```typescript
import { subscribe, type AsyncSubscription } from '@parcel/watcher';

// 구독 시작 (~20줄)
const changedFiles = new Set<string>();
const subscription = await subscribe(projectRoot, (err, events) => {
  if (err) return;
  for (const event of events) {
    // *.ts만, *.d.ts 제외
    if (event.path.endsWith('.ts') && !event.path.endsWith('.d.ts')) {
      changedFiles.add(event.path);
    }
  }
}, {
  ignore: ['.git', '.bunner', 'dist', 'node_modules'],
});

// scan 시점에 소비
const changed = [...changedFiles];
changedFiles.clear();
// → changed 파일만 stat+hash → fileIndex 갱신
```

JSONL 파일 기록, rotation, lock 파일 관리 — 전부 없다. 메모리 `Set`에 누적하고, scan 시점에 비우는 것이 전부.

**소비자 모드 changeset reader (전체):**

```typescript
// JSONL 읽기 (~15줄, 크래시 내성 + 경로 변환 포함)
function readChangeset(jsonlPath: string, since: number, projectRoot: string): { files: string[]; maxTs: number } {
  const files = new Set<string>();
  let maxTs = since;
  try {
    const lines = readFileSync(jsonlPath, 'utf8').split('\n');
    for (const line of lines) {
      if (!line) continue;
      try {
        const record = JSON.parse(line);
        if (record.ts >= since) {
          files.add(join(projectRoot, record.file));  // 상대 → 절대 변환
          if (record.ts > maxTs) maxTs = record.ts;
        }
      } catch { /* 깨진 줄(프로세스 크래시 등) 무시 — 관용 파싱 */ }
    }
  } catch { /* ENOENT → 빈 Set */ }
  return { files: [...files], maxTs };
}

// rotation 대응: .jsonl.1 먼저 읽고 .jsonl 읽기
const r1 = readChangeset(jsonlPath + '.1', lastSeenTs, projectRoot);
const r2 = readChangeset(jsonlPath, lastSeenTs, projectRoot);
const changed = [...new Set([...r1.files, ...r2.files])];  // 중복 제거
state.lastSeenTs = Math.max(r1.maxTs, r2.maxTs);  // cursor 갱신
```

**`digestParts` 증분 계산:**
- 현재 `computeInputsDigest`는 매번 N개 파일의 hash를 fileIndex에서 읽어 `parts.join('|')` → `hashString()`.
- 워처 도입 후: `digestParts` 맵을 메모리에 유지. 변경 파일 K개의 hash만 교체 → parts 재조합 → `hashString(sorted.join('|'))`.
- 결과: 동일한 digest 값. 계산 비용만 O(N) → O(K) + O(N log N) sort.
- 프로세스 재시작 시 `digestParts` 소실 → 첫 scan에서 full stat()로 재구성.

#### 1.4.7 엣지 케이스

| 상황 | 처리 |
|------|------|
| MCP 서버 재시작 | `digestParts`/`changedFiles` 소실 → 첫 scan에서 full stat() 1회 → 재구성 → 이후 증분 |
| bunner 나중에 시작 (독립→소비자 전환) | lock 감지 → 자체 watcher unsubscribe → full stat() 1회 → changeset reader 모드로 전환 |
| bunner 종료 (소비자→독립 전환) | lock의 PID 죽음 감지 → 자체 watcher subscribe → full stat() 1회 → Set 추적 모드로 전환 |
| changeset rotation 중 이벤트 누락 (소비자 모드) | `.jsonl.1` + `.jsonl` 둘 다 읽기, `ts >= lastSeenTs` 필터 (Set이라 중복 무해) |
| firebat CLI + bunner 실행 중 | lock 파일 존재 + PID 생존 → changeset 읽기 → O(K) |
| firebat CLI 완전 독립 (bunner 없음) | lock 파일 없음 → full stat() fallback → **현재 코드와 100% 동일** |
| Fix 모드 | 캐시 비활성 (기존 `allowCache = options.fix === false`), 워처 상태와 무관하게 항상 전체 분석 |
| 설정 파일 변경 (tsconfig, package.json, lockfile) | 워처 범위 밖 → scan마다 직접 stat() (5개 미만, <1ms) |
| changeset 공백 기간 (bunner 재시작 등) | 모드 전환 감지 시 full stat() 1회로 안전하게 기준선 재설정 |
| inotify 중복 문제 | bunner 실행 중이면 firebat은 자체 watcher 끔 → 동일 디렉토리에 최대 1개 구독 |
| 동일 ms에 복수 이벤트 (ts 충돌) | `ts >= lastSeenTs` 필터 사용 → 중복 재처리는 발생하나 Set + stat()이므로 무해. 관측 빈도가 높아지면 프로토콜 v2에서 `seq` 필드 추가 검토 |
| JSONL 마지막 줄 깨짐 (프로세스 크래시) | reader가 줄 단위 `JSON.parse` 실패 시 해당 줄 무시 (관용 파싱) |

#### 1.4.8 구현 위치 (Ports & Adapters 기준)

| 컴포넌트 | 위치 | 설명 |
|---------|------|------|
| `SimpleWatcher` | `src/infrastructure/watcher/simple-watcher.ts` | @parcel/watcher subscribe → Set 누적 (독립 모드) |
| `ChangesetReader` | `src/infrastructure/watcher/changeset-reader.ts` | JSONL 파일 읽기 + 파싱 (소비자 모드) |
| `LockChecker` | `src/infrastructure/watcher/lock-checker.ts` | lock 파일 PID 생존 확인 (모드 판정) |
| `WatcherPort` (인터페이스) | `src/ports/watcher.ts` | 아래 인터페이스 참조 |
| `McpWatcherState` 관리 | `src/adapters/mcp/server.ts` | 프로세스 수명 상태 + 모드 전환 로직 |
| CLI opportunistic reader 분기 | `src/application/scan/scan.usecase.ts` | `indexTargets` 호출 전 changeset 분기 |

**firebat이 구현하지 않는 것:**
- `OwnerElection` — bunner 전용. firebat은 lock 파일을 읽기만 한다.
- `ChangesetWriter` — bunner 전용. firebat은 changeset을 기록하지 않는다.
- `ProjectWatcher` (bunner의 것) — firebat의 `SimpleWatcher`는 Set 누적만 하는 최소 구현.
- JSONL rotation — bunner 전용. firebat은 rotation 결과물을 읽기만 한다.

**의존성 추가:** `package.json`에 `@parcel/watcher` 추가 (dependencies). bunner와 npm 의존성 없음. firebat이 구현하는 것은 `SimpleWatcher` (~20줄), `ChangesetReader` (~15줄), `LockChecker` (~10줄) — 합계 약 50줄의 인프라 코드.

**`WatcherPort` 인터페이스:**

```typescript
interface WatcherPort {
  /** 지난 scan 이후 변경된 파일 경로 반환 (절대 경로). 빈 배열 = 변경 없음. */
  getChangedFiles(): string[];
  /** 현재 모드 반환 */
  getMode(): 'independent' | 'consumer';
  /** 모드 전환이 필요한지 판정 (매 scan 호출 전 호출) */
  checkAndSwitch(): { modeChanged: boolean; requiresFullStat: boolean };
  /** 독립 모드 watcher 정리 (프로세스 종료 시) */
  dispose(): Promise<void>;
}
```

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

★ 핵심 과제 A에서 정의한 BaseFinding 관례 + 프로퍼티명 최적화의 디텍터별 적용 현황.

### 현재 상태

BaseFinding 관례 (`kind`, `file`, `span`, `code?`) 대비 각 디텍터의 gap:

| 디텍터 | `kind` 현황 | `filePath`→`file` | `code?` 추가 | 삭제 대상 프로퍼티 | 축약 대상 |
|--------|------------|-------------------|-------------|-------------------|----------|
| waste | ✓ 있음 (`WasteKind`) | 필요 | 필요 | — | — |
| nesting | ✗ **신규 부여** (`NestingKind`) | 필요 | 필요 | `suggestions` (→ catalog) | `accidentalQuadraticTargets`→`quadraticTargets` |
| early-return | ✗ **신규 부여** (`EarlyReturnKind`) | 필요 | 필요 | `suggestions` (→ catalog) | `earlyReturnCount`→`returns`, `guardClauseCount`→`guards`, `hasGuardClauses`→`hasGuards` |
| noop | ✓ 있음 (`string`) | 필요 | 필요 | — | — |
| forwarding | ✓ 있음 (`ForwardingFindingKind`) | 필요 | 필요 | — | — |
| exact-duplicates | ✓ `cloneType`→`kind` rename | 필요 | 필요 | — | `cloneType`→`kind`, `suggestedParams`→`params` |
| structural-duplicates | ✓ `cloneType`→`kind` rename | 필요 | 필요 | — | `cloneClasses`→`groups` |
| coupling | ✗ **signals 승격** (`CouplingKind`) | 필요 | 필요 | `why`, `suggestedRefactor` (→ catalog) | — |
| dependencies | ✓ 있음 (sub-types) | 필요 | 필요 | — | `fanInTop`→`fanIn`, `fanOutTop`→`fanOut`, `edgeCutHints`→`cuts`, `exportName`→`name` |
| barrel-policy | ✓ 있음 (`BarrelPolicyFindingKind`) | 필요 | 필요 | — | — |
| exception-hygiene | ✓ 있음 (`ExceptionHygieneFindingKind`) | 필요 | 필요 | `recipes` (→ catalog) | — |
| unknown-proof | ✓ 있음 (`UnknownProofFindingKind`) | 필요 | 필요 | `status` (→ meta.errors) | — |
| api-drift | ✗ **신규 부여** (`ApiDriftKind`) | 필요 | 필요 | `status` (→ meta.errors) | `standardCandidate`→`standard`, `paramsCount`→`params`, `optionalCount`→`optionals` |
| typecheck | — (외부 도구, code 불필요) | 필요 | — (외부 도구 메시지 유지) | `status`, `lineText` (→ codeFrame 중복) | — |
| lint | — (외부 도구, code 불필요) | 필요 | — (외부 도구 메시지 유지) | `status` (→ meta.errors) | — |
| format | — (외부 도구) | — | — (외부 도구 메시지 유지) | `status` (→ meta.errors) | `fileCount`→`files` |

### `*Analysis` 래퍼 폐기

기존: 각 디텍터가 개별 `*Analysis` 인터페이스를 반환. 래퍼 형태는 3가지:
- **배열 추출만**: `{ items }` 또는 `{ findings }` 또는 `{ groups }` 또는 `{ hotspots }` 또는 `{ cloneClasses }`
  - NestingAnalysis, EarlyReturnAnalysis, NoopAnalysis, BarrelPolicyAnalysis, ForwardingAnalysis, ApiDriftAnalysis, CouplingAnalysis, StructuralDuplicatesAnalysis
- **status/tool + 배열**: `{ status, tool, error?, findings/items/diagnostics }`
  - ExceptionHygieneAnalysis, UnknownProofAnalysis, LintAnalysis, TypecheckAnalysis, FormatAnalysis
- **이미 bare array**: exact-duplicates, waste
- **복합 객체 유지**: DependencyAnalysis (유일한 예외)

개편: **bare array** 반환. `status`/`tool`/`error`는 `meta.errors`로 이동.

### 적용 순서

1. **`filePath`→`file`**: 모든 finding 타입에 일괄 적용 (breaking change → 한 번에)
2. **`code?` 추가**: enrichment layer가 `kind` → `code` 매핑으로 생성. 디텍터 코드 수정 없음
3. **삭제 대상 프로퍼티**: `suggestions`, `why`, `suggestedRefactor`, `recipes` → catalog `cause`/`approach`로 대체 후 제거
4. **`*Analysis` 래퍼 제거**: 각 디텍터의 반환 타입을 bare array로 변경, `status`/`tool`/`error`는 `scan.usecase.ts`에서 `meta.errors`로 집계
5. **프로퍼티명 축약**: 디텍터별 상위 컨텍스트 중복 제거 (위 표 참조)

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

### 9.1 마이그레이션 전략

★ A Phase 0은 **breaking change**다. `*Analysis` 래퍼 제거, `filePath`→`file`, 프로퍼티 삭제/축약이 동시에 일어난다.

**원칙**:
1. **한 번에 전환**: 점진적 deprecated 공존은 코드 복잡성만 증가. Phase 0에서 일괄 전환
2. **MCP 도구 설명 업데이트**: 스키마 변경 사항을 도구 설명에 반영하여 에이전트가 새 구조를 즉시 인식
3. **테스트 전량 수정**: 기존 테스트의 `filePath`, `status`, `tool` 참조를 새 스키마에 맞춰 일괄 변경

```typescript
interface FirebatReport {
  readonly meta: FirebatMeta;          // errors?: Record<string, string> 포함
  readonly analyses: FirebatAnalyses;  // 각 디텍터가 bare array 반환
  readonly top: ReadonlyArray<Priority>;
  readonly catalog: Record<string, CodeEntry>;
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

`top` + `catalog` 출력을 CLI text 포맷으로 어떻게 표현할지:

```
── Top Priorities ────────────────────────────────────
1. WASTE_DEAD_STORE  (waste, resolves 15)
2. NESTING_DEEP      (nesting, resolves 8)
3. COUPLING_GOD_MOD  (coupling, resolves 5)

── Catalog ───────────────────────────────────────────
WASTE_DEAD_STORE
  cause:    값이 할당된 후 읽히기 전에 덮어쓰이거나 스코프를 벗어남
  approach: 이 할당이 왜 불필요해졌는지 경위를 파악하라...
NESTING_DEEP
  cause:    함수 내 제어 구조가 깊게 중첩되어 인지 복잡도가 높음
  approach: 중첩이 깊어진 원인을 파악하라...
```

### 9.4 테스트 전략

| 대상 | 전략 | 위치 |
|------|------|------|
| DiagnosticAggregator 패턴 매칭 | 각 DiagnosisPattern에 대해 true-positive, true-negative, edge-case | `test/integration/diagnostic-aggregator/` |
| C-시리즈 신규 디텍터 | BDD 스타일: 입력 코드 fixture → expected finding | `test/integration/{detector-name}/` |
| B-시리즈 분석기 | 입력 프로그램 → expected 출력 구조 검증 | `test/integration/{analyzer-name}/` |
| BaseFinding 프로퍼티 변경 | `filePath`→`file`, `code?` 추가, 삭제/축약 반영 검증 | 각 feature의 기존 spec 확장 |
| MCP assess-impact | 심볼 쿼리 → impact radius 결과 | `test/mcp/` |

### 9.5 성능 예산

| Phase | 허용 추가 시간 | 근거 |
|-------|-------------|------|
| Phase 0 Step 6 (DiagnosticAggregator) | scan 전체 시간의 **10% 이하** | finding 수 N에 대해 O(N²) 이하 보장 |
| C-시리즈 디텍터 (새 AST 패스) | 기존 디텍터 합계의 **20% 이하** | 기존 엔진 재활용으로 추가 AST 순회 최소화 |
| assess-impact MCP 툴 | 호출당 **500ms 이내** | 에이전트 응답 지연에 직접 영향 |

---

## 10. 누락 기능 (PLAN.md 기준)

| PLAN 항목 | 상태 | 우선순위 |
|-----------|------|----------|
| **giant-file** (A1) | ❌ 미구현 | **즉시** |
| **dependency-direction** (A2) | ⚠ 부분 (config 모델 불일치: 현재 코드는 `layers` + `allowedDependencies`, PLAN.md는 `layers[].globs` + `rules[]` 모델. **PLAN.md 모델로 전환 필요** — 현재 코드의 flat `layers` 배열은 glob 패턴 매칭을 지원하지 않으며, `allowedDependencies`는 `rules[]`의 from/to/allow 구조로 대체해야 한다) | 높음 |
| **dead-export Stage 2** (A3) | ⚠ 부분 (package.json entrypoint 읽지만 library mode 미완) | 중간 |
| **export-kind-mix** (B2) | ❌ 미구현 | 중간 |
| **scatter-of-exports** (B3) | ❌ 미구현 | 중간 |
| **shared-type-extraction** (B1) | ❌ 미구현 | 중간 |
| **public-surface-explosion** (B4) | ❌ 미구현 | 낮음 |
| **generated-mixed** (C1) | ❌ 미구현 | 낮음 |
| **naming-predictability** (C2) | ❌ 미구현 | 낮음 |

---

## 11. 기존 PLAN.md 디텍터와의 통합

PLAN.md의 Tier A-C 디텍터(giant-file, export-kind-mix, scatter-of-exports 등)는 여전히 구현할 가치가 있지만, **독립 finding이 아니라 DiagnosticAggregator의 패턴 탐지 입력 신호**로 활용된다.

| PLAN 디텍터 | 통합 위치 |
|-------------|-----------|
| giant-file | → DIAG_GOD_FUNCTION / DIAG_GOD_MODULE 패턴의 입력 신호 |
| export-kind-mix | → Concept Scatter(B-III-2) + DIAG_GOD_MODULE 패턴의 입력 |
| scatter-of-exports | → Abstraction Fitness(B-III-3)의 입력 |
| dead-export | → waste 디텍터의 확장 |
| shared-type-extraction | → DIAG_DATA_CLUMP 패턴의 입력 |
| dependency-direction | → Implicit State Protocol + Temporal Coupling의 보조 |
| public-surface-explosion | → Modification Impact Radius(B-IV-3)의 입력 |

---

## 12. 실행 우선순위

> **용어 구분**: 이 섹션의 "Phase 0-3"은 **개발 로드맵 단계**를 의미한다. Section 1.1의 "Stage 0-5"는 `scan.usecase.ts`의 **런타임 실행 단계**이며 별개의 개념이다.

### Phase별 완료 조건 (DoD)

**공통 조건 (모든 Phase):** 같은 소스 코드에 같은 디텍터를 실행하면 항상 같은 결과가 나와야 한다 (결정론적 재현성).

| Phase | 완료 조건 |
|-------|----------|
| **0 (기반)** | (1) `*Analysis` 래퍼 제거, 모든 디텍터가 bare array 반환 (2) `filePath`→`file` 일괄 적용 (3) kind 미존재 디텍터에 kind 부여 완료 (4) 삭제/축약 대상 프로퍼티 정리 완료 (5) kind→code 매핑 로직 동작, 모든 finding에 code 필드 존재 (6) DiagnosticAggregator가 `top` + `catalog` 생성, 3개 패턴(DIAG_GOD_FUNCTION, DIAG_CIRCULAR_DEPENDENCY, DIAG_GOD_MODULE) 매칭 (7) **Phase 0 필수 catalog 완료**: Phase 0 가용 디텍터(기존 16개)의 code에 대한 catalog entry 전수 작성. Phase 1+ 신규 디텍터(B/C 시리즈)의 catalog entry는 해당 Phase에서 디텍터와 함께 추가 (8) 기존 테스트 전량 통과 (9) breaking change이므로 MCP 도구 설명 업데이트 |
| **1 (에이전트 실패 모드)** | (1) B 시리즈 디텍터(B-I-1~3, B-II-1~2, B-III-1~3, B-IV-1~3) 각각 true-positive 5개 이상 integration test (2) precision ≥ 0.8 (OSS 2개 프로젝트 — 소/중 또는 중/대 규모) (3) scan 전체 시간 증가 ≤ 15% (4) assess-impact MCP 도구 호출당 ≤ 500ms |
| **2 (클린코드)** | (1) C-1~7 디텍터 각각 integration test (2) 기존 디텍터 합계 대비 AST 순회 추가 시간 ≤ 20% |
| **3 (기존 개선)** | (1) 변경 대상 디텍터의 기존 테스트 전량 통과 (2) 성능 회귀 없음 (3) 워처 통합 시: MCP zero-change scan <1ms, CLI+bunner scan <5ms |

### Phase 의존 그래프

```
Phase 0 (기반)          ← 모든 후속 Phase의 전제
  │
  ├──→ Phase 1 (에이전트 실패 모드) ← B 시리즈 전체. Phase 0 직후
  ├──→ Phase 2 (클린코드 위생)      ← C 시리즈 전체. Phase 1과 병렬 가능
  └──→ Phase 3 (기존 개선 + 성능)   ← 어느 Phase에서든 병렬 가능
```

### Phase 계획

```
Phase 0 — 기반 (출력 스키마 전환)
  구현 순서 (의존 관계 기반 — 반드시 번호 순서대로 진행):

  현재 래퍼 유형별 디텍터 분류 (Step 1 작업 범위):
  ┌─────────────────────────────────────────────────────────────────┐
  │ bare array (변환 불필요):                                       │
  │   exact-duplicates, waste                                      │
  │                                                                │
  │ { items/findings/groups/hotspots/cloneClasses } 래퍼           │
  │ (배열 추출만):                                                  │
  │   nesting, early-return, noop, barrel-policy, forwarding,      │
  │   api-drift, coupling, structural-duplicates                   │
  │                                                                │
  │ { status, tool, error?, findings/items/diagnostics } 래퍼     │
  │ (배열 추출 + status/tool/error → meta.errors 이동):            │
  │   exception-hygiene, unknown-proof, lint, typecheck, format    │
  │                                                                │
  │ 복합 객체 유지:                                                 │
  │   dependencies (유일한 예외)                                    │
  └─────────────────────────────────────────────────────────────────┘

  Step 1. `*Analysis` 래퍼 제거
    └── 모든 디텍터의 반환 타입을 bare array로 변경
    └── 대상 래퍼 인터페이스: NestingAnalysis, EarlyReturnAnalysis, NoopAnalysis,
        BarrelPolicyAnalysis, ForwardingAnalysis, ApiDriftAnalysis,
        ExceptionHygieneAnalysis, UnknownProofAnalysis, LintAnalysis,
        TypecheckAnalysis, FormatAnalysis, CouplingAnalysis,
        StructuralDuplicatesAnalysis (13개)
    └── 이미 bare array인 디텍터: exact-duplicates, waste (2개, 변환 불필요)
    └── 복합 객체 유지: dependencies (DependencyAnalysis — 유일한 예외)
    └── scan.usecase.ts에서 status/tool/error를 meta.errors로 집계
    └── 의존: 없음 (모든 후속 Step의 전제)
    └── 검증: 기존 테스트 전량 통과, MCP 출력에서 status/tool 필드 소멸 확인
  
  Step 2. BaseFinding 프로퍼티 정리
    └── filePath → file 일괄 변경 (모든 finding 타입)
    └── 삭제: suggestions, why, suggestedRefactor, recipes, lineText (Section 6 참조)
    └── 축약: 디텍터별 프로퍼티명 변경 (Section 6 참조)
    └── kind 필드 부여 (현재 kind가 없는 디텍터 — 아래 E. kind 부여 명세 참조)
    └── 의존: Step 1 (래퍼 제거 후 타입이 안정되어야 프로퍼티 수정 가능)
    └── 검증: tsc 통과 + 모든 디텍터 테스트 통과
  
  Step 3. src/types.ts에 신규 타입 정의
    └── Priority, CodeEntry, FirebatReport 확장 (top, catalog)
    └── 의존: Step 2 (finding 타입이 확정되어야 Priority 설계 확정)
    └── 검증: tsc 통과 (타입만 추가, 런타임 변경 없음)
  
  Step 4. code 매핑 로직 구현
    └── kind → code 매핑 테이블 작성 (아래 B. kind → code 완전 매핑 테이블 참조)
    └── scan.usecase.ts에서 finding에 code? 필드 주입
    └── 의존: Step 3 (code 필드가 한정된 패턴 집합이어야 catalog 정합)
    └── 검증: 모든 디텍터의 finding에 code 필드 존재 확인

#### E. kind 부여 명세 (kind 필드가 없는 디텍터)

현재 코드베이스에서 `kind` 필드가 없는 디텍터에 BaseFinding 관례 적용을 위해 kind를 신규 부여한다.

**NestingItem → kind 추가**:
```typescript
type NestingKind = 'deep-nesting' | 'high-cognitive-complexity' | 'accidental-quadratic' | 'callback-depth';
```
판정 규칙:
- `metrics.accidentalQuadraticTargets.length > 0` → `'accidental-quadratic'`
- `metrics.cognitiveComplexity >= 15` → `'high-cognitive-complexity'`
- `metrics.callbackDepth >= 3` → `'callback-depth'`
- 그 외 (depth 기반) → `'deep-nesting'`
- 우선순위: accidental-quadratic > high-cognitive-complexity > callback-depth > deep-nesting (첫 매칭)
- **참고**: 현재 `NestingMetrics`에 `callbackDepth` 필드가 없다. Step 2에서 `suggestions` 삭제 시 callback-depth 정보가 소실되므로, `NestingMetrics`에 `readonly callbackDepth: number` 필드를 추가하고 analyzer에서 `measureMaxCallbackDepth` 결과를 저장해야 한다.

**EarlyReturnItem → kind 추가**:
```typescript
type EarlyReturnKind = 'invertible-if-else' | 'missing-guard';
```
판정 규칙:
- `suggestions`에 invertible-if-else 관련 제안이 있으면 → `'invertible-if-else'`
- 그 외 → `'missing-guard'`
- **참고**: suggestions 필드는 Step 2에서 삭제되므로, kind 판정 로직은 analyzer 내부에서 suggestions 생성 시점에 kind도 함께 결정해야 한다. 즉, analyzer 코드에서 suggestions 조건 분기와 kind 결정을 동일 위치에서 수행 후 suggestions를 제거한다.

**CouplingHotspot → kind 추가**:
```typescript
type CouplingKind = 'off-main-sequence' | 'unstable-module' | 'rigid-module' | 'god-module' | 'bidirectional-coupling';
```
판정 규칙:
- `signals` 배열의 첫 번째 요소를 kind로 승격
- signals가 복수인 경우: 우선순위 god-module > bidirectional-coupling > off-main-sequence > unstable-module > rigid-module
- **참고**: CouplingHotspot은 현재 하나의 hotspot에 복수 signals를 가질 수 있다. kind는 최우선 1개만 대표하고, 나머지는 signals 배열에 유지한다.

**ApiDriftGroup → kind 추가**:
```typescript
type ApiDriftKind = 'signature-drift';
```
- 현재 유일한 분류이므로 단일 값. 향후 확장을 위해 union type으로 선언.

**exact-duplicates / structural-duplicates**:
- `cloneType` 필드가 kind 역할을 한다. `cloneType`을 `kind`로 rename한다.
- 실제 code 매핑에서는 `kind` 값을 그대로 사용: `type-1` → `EXACT_DUP_TYPE_1`, `type-2-shape` → `STRUCT_DUP_TYPE_2_SHAPE`, `type-3-normalized` → `STRUCT_DUP_TYPE_3_NORMALIZED`.
- **`type-2` 정리**: 현재 `DuplicateCloneType` union에 `'type-2'`가 포함되어 있으나, 어떤 디텍터도 이 값으로 `detectClones`를 호출하지 않는다 (exact-duplicates는 `type-1`, structural-duplicates는 `type-2-shape` + `type-3-normalized` 사용). `cloneType`→`kind` rename 시 `type-2`를 union에서 제거한다.

#### B. kind → code 완전 매핑 테이블

code 명명 규칙: `{DETECTOR}_{KIND}` (대문자, 하이픈→언더스코어). 약어는 보편적인 것만 허용 (DUP=duplicate, EH=exception-hygiene).

> **lint/format/typecheck는 code를 부여하지 않는다**. 외부 도구 래핑이므로 top에서 제외되며, catalog에 포함되지 않는다. 에이전트가 필요하면 `analyses`에서 직접 접근한다.

##### waste (3개)

| kind | code |
|------|------|
| `dead-store` | `WASTE_DEAD_STORE` |
| `dead-store-overwrite` | `WASTE_DEAD_STORE_OVERWRITE` |
| `memory-retention` | `WASTE_MEMORY_RETENTION` |

##### noop (5개)

| kind | code |
|------|------|
| `expression-noop` | `NOOP_EXPRESSION` |
| `self-assignment` | `NOOP_SELF_ASSIGNMENT` |
| `constant-condition` | `NOOP_CONSTANT_CONDITION` |
| `empty-catch` | `NOOP_EMPTY_CATCH` |
| `empty-function-body` | `NOOP_EMPTY_FUNCTION_BODY` |

##### forwarding (3개)

| kind | code |
|------|------|
| `thin-wrapper` | `FWD_THIN_WRAPPER` |
| `forward-chain` | `FWD_FORWARD_CHAIN` |
| `cross-file-forwarding-chain` | `FWD_CROSS_FILE_CHAIN` |

##### barrel-policy (6개)

| kind | code |
|------|------|
| `export-star` | `BARREL_EXPORT_STAR` |
| `deep-import` | `BARREL_DEEP_IMPORT` |
| `index-deep-import` | `BARREL_INDEX_DEEP_IMPORT` |
| `missing-index` | `BARREL_MISSING_INDEX` |
| `invalid-index-statement` | `BARREL_INVALID_INDEX_STMT` |
| `barrel-side-effect-import` | `BARREL_SIDE_EFFECT_IMPORT` |

##### exception-hygiene (17개, tool-unavailable 제외)

| kind | code |
|------|------|
| `throw-non-error` | `EH_THROW_NON_ERROR` |
| `async-promise-executor` | `EH_ASYNC_PROMISE_EXECUTOR` |
| `missing-error-cause` | `EH_MISSING_ERROR_CAUSE` |
| `useless-catch` | `EH_USELESS_CATCH` |
| `unsafe-finally` | `EH_UNSAFE_FINALLY` |
| `return-in-finally` | `EH_RETURN_IN_FINALLY` |
| `catch-or-return` | `EH_CATCH_OR_RETURN` |
| `prefer-catch` | `EH_PREFER_CATCH` |
| `prefer-await-to-then` | `EH_PREFER_AWAIT_TO_THEN` |
| `floating-promises` | `EH_FLOATING_PROMISES` |
| `misused-promises` | `EH_MISUSED_PROMISES` |
| `return-await-policy` | `EH_RETURN_AWAIT_POLICY` |
| `silent-catch` | `EH_SILENT_CATCH` |
| `catch-transform-hygiene` | `EH_CATCH_TRANSFORM` |
| `redundant-nested-catch` | `EH_REDUNDANT_NESTED_CATCH` |
| `overscoped-try` | `EH_OVERSCOPED_TRY` |
| `exception-control-flow` | `EH_EXCEPTION_CONTROL_FLOW` |

> `tool-unavailable` kind는 디텍터 가용성 이슈(tsgo/oxc 미설치)이므로 code를 부여하지 않고, `meta.errors`로 흡수된다.

##### unknown-proof (6개, tool-unavailable 제외)

| kind | code |
|------|------|
| `type-assertion` | `UNKNOWN_TYPE_ASSERTION` |
| `double-assertion` | `UNKNOWN_DOUBLE_ASSERTION` |
| `unknown-type` | `UNKNOWN_UNNARROWED` |
| `unvalidated-unknown` | `UNKNOWN_UNVALIDATED` |
| `unknown-inferred` | `UNKNOWN_INFERRED` |
| `any-inferred` | `UNKNOWN_ANY_INFERRED` |

##### dependencies (3개)

| kind | code |
|------|------|
| `layer-violation` | `DEP_LAYER_VIOLATION` |
| `dead-export` | `DEP_DEAD_EXPORT` |
| `test-only-export` | `DEP_TEST_ONLY_EXPORT` |

> dependencies의 `cycles`, `fanInTop`, `fanOutTop`, `edgeCutHints`는 finding이 아닌 분석 데이터이므로 code 매핑 대상이 아니다. 단, DiagnosticAggregator가 `cycles`를 `DIAG_CIRCULAR_DEPENDENCY`로 승격한다.

##### nesting (4개, 신규 kind)

| kind | code |
|------|------|
| `deep-nesting` | `NESTING_DEEP` |
| `high-cognitive-complexity` | `NESTING_HIGH_CC` |
| `accidental-quadratic` | `NESTING_ACCIDENTAL_QUADRATIC` |
| `callback-depth` | `NESTING_CALLBACK_DEPTH` |

##### early-return (2개, 신규 kind)

| kind | code |
|------|------|
| `invertible-if-else` | `EARLY_RETURN_INVERTIBLE` |
| `missing-guard` | `EARLY_RETURN_MISSING_GUARD` |

##### coupling (5개, signals 승격)

| kind (= signal) | code |
|------|------|
| `god-module` | `COUPLING_GOD_MODULE` |
| `bidirectional-coupling` | `COUPLING_BIDIRECTIONAL` |
| `off-main-sequence` | `COUPLING_OFF_MAIN_SEQ` |
| `unstable-module` | `COUPLING_UNSTABLE` |
| `rigid-module` | `COUPLING_RIGID` |

##### api-drift (1개, 신규 kind)

| kind | code |
|------|------|
| `signature-drift` | `API_DRIFT_SIGNATURE` |

##### exact-duplicates (1개)

| kind (= cloneType) | code |
|------|------|
| `type-1` | `EXACT_DUP_TYPE_1` |

##### structural-duplicates (2개)

| kind (= cloneType) | code |
|------|------|
| `type-2-shape` | `STRUCT_DUP_TYPE_2_SHAPE` |
| `type-3-normalized` | `STRUCT_DUP_TYPE_3_NORMALIZED` |

##### DiagnosticAggregator 패턴 (별도 — 디텍터 결과 조합에서 생성)

| pattern code | 생성 조건 |
|------|------|
| `DIAG_GOD_FUNCTION` | 같은 함수에서 nesting(CC≥15) + waste 동시 발생 |
| `DIAG_DATA_CLUMP` | C-3(Parameter Object) finding 존재 시 승격 (Phase 2+) |
| `DIAG_SHOTGUN_SURGERY` | 동일 개념이 4개 이상 파일에 분산 (Phase 1+) |
| `DIAG_OVER_INDIRECTION` | forwarding chain + single-impl interface (Phase 1+). single-impl 탐지: dependencies adjacency + symbol-extractor-oxc로 인터페이스당 구현 수 계산 |
| `DIAG_MIXED_ABSTRACTION` | 같은 함수 내 nesting depth 차이 > 2 (Phase 1+) |
| `DIAG_CIRCULAR_DEPENDENCY` | `dependencies.cycles` 직접 승격 |
| `DIAG_GOD_MODULE` | `coupling` god-module signal 직접 승격 |

> **Phase 0 가용 패턴**: `DIAG_GOD_FUNCTION`, `DIAG_CIRCULAR_DEPENDENCY`, `DIAG_GOD_MODULE` — 이 3개는 기존 디텍터 결과만으로 Phase 0에서 즉시 구현 가능하다. `DIAG_DATA_CLUMP`, `DIAG_SHOTGUN_SURGERY` 등은 신규 디텍터(C/B 시리즈) 결과가 필요하므로 해당 Phase에서 추가한다.

#### C. catalog 전수 (CodeEntry: cause + approach)

> **작성 원칙 재확인** (4가지 규칙):
> 1. 질문으로 출발
> 2. 직접 수정 지시 금지
> 3. 가능한 근본 원인 나열
> 4. scope 확장 유도

##### waste

```json
{
  "WASTE_DEAD_STORE": {
    "cause": "A value is assigned to a variable but is overwritten or goes out of scope before being read.",
    "approach": "Determine why this assignment became unnecessary. Possible root causes: leftover from a refactor, logic change that bypassed this path, or a control-flow design error. If multiple dead stores appear in the same function, examine the function's responsibilities and flow rather than individual assignments."
  },
  "WASTE_DEAD_STORE_OVERWRITE": {
    "cause": "A variable is assigned, then unconditionally reassigned before the first value is ever read.",
    "approach": "Identify whether the first assignment once had a purpose. It may be a remnant of removed branching, a copy-paste artifact, or a misunderstanding of the variable's lifecycle. If this pattern repeats across a function, the function may be accumulating unrelated setup steps that should be separated."
  },
  "WASTE_MEMORY_RETENTION": {
    "cause": "A large object or collection is captured in a closure or long-lived scope and remains reachable after its logical use ends.",
    "approach": "Investigate why the reference persists. The closure may capture more than it needs, or the variable's scope may be unnecessarily broad. Consider whether the value can be passed as a parameter instead of captured, or whether the lifetime can be shortened by restructuring the enclosing scope."
  }
}
```

##### noop

```json
{
  "NOOP_EXPRESSION": {
    "cause": "An expression is evaluated but its result is discarded and it produces no side effects.",
    "approach": "Determine the original intent of this expression. It may be a debugging artifact, incomplete code, or a misunderstanding of an API's return behavior. If it was meant to have a side effect, the API contract should be verified."
  },
  "NOOP_SELF_ASSIGNMENT": {
    "cause": "A variable is assigned to itself, producing no state change.",
    "approach": "This is usually a typo or copy-paste error. Check whether a different target variable was intended, or whether this was meant to trigger a setter or reactivity system that requires explicit assignment."
  },
  "NOOP_CONSTANT_CONDITION": {
    "cause": "A conditional expression always evaluates to the same boolean value, making one branch unreachable.",
    "approach": "Determine whether the condition was once dynamic and became constant after a refactor, or whether it guards code that is not yet implemented. If the constant branch is intentional (feature flag, debug mode), make it explicit via a named constant or config."
  },
  "NOOP_EMPTY_CATCH": {
    "cause": "A catch block is empty, silently swallowing errors.",
    "approach": "Determine whether the error is intentionally ignored or accidentally suppressed. If intentional, add a comment explaining why. If accidental, the missing error handling may mask failures in production. Check whether the same pattern exists in related catch blocks — systematic silent catches suggest a missing error-handling strategy."
  },
  "NOOP_EMPTY_FUNCTION_BODY": {
    "cause": "A function or method has an empty body, performing no operation.",
    "approach": "Determine whether this is a placeholder, a no-op callback, or unfinished implementation. If it serves as a default no-op (e.g., event handler stub), the intent should be explicit via naming (e.g., 'noop') or a comment. If it appears in a class, it may indicate an interface method that should be abstract instead."
  }
}
```

##### forwarding

```json
{
  "FWD_THIN_WRAPPER": {
    "cause": "A function's entire body delegates to another function with identical or trivially transformed arguments, adding no logic.",
    "approach": "Determine whether this wrapper serves an intentional purpose: dependency inversion, future extension point, or API stability boundary. If none apply, the indirection increases navigation cost for agents without adding value. Consider whether callers can reference the target directly."
  },
  "FWD_FORWARD_CHAIN": {
    "cause": "Multiple functions form a chain where each forwards to the next with no added logic, creating unnecessary depth.",
    "approach": "Trace the chain to find where real logic begins. The intermediate links may be remnants of refactoring or over-abstracted layers. If the chain crosses module boundaries, evaluate whether the abstraction layers are justified by actual variation or just ceremony."
  },
  "FWD_CROSS_FILE_CHAIN": {
    "cause": "A forwarding chain spans multiple files, creating cross-file indirection without logic at each hop.",
    "approach": "Cross-file forwarding amplifies navigation cost — an agent must open multiple files to find the real implementation. Determine whether each file boundary represents a genuine architectural concern. If the chain follows a re-export pattern, consolidating the public surface may eliminate intermediate hops."
  }
}
```

##### barrel-policy

```json
{
  "BARREL_EXPORT_STAR": {
    "cause": "An index file uses 'export *' which re-exports everything from a module, making the public surface implicit and unbounded.",
    "approach": "Determine whether all re-exported symbols are intentionally public. 'export *' prevents controlling the public API surface and can inadvertently expose internal implementation details. If only a subset should be public, switch to named re-exports."
  },
  "BARREL_DEEP_IMPORT": {
    "cause": "A consumer imports directly from a module's internal file, bypassing its barrel (index) entry point.",
    "approach": "Check whether the barrel file exists and exposes the needed symbol. If it does, the deep import may be a convenience shortcut that undermines encapsulation. If the barrel does not expose the symbol, determine whether it should be added to the public surface or if the consumer's need indicates a missing abstraction."
  },
  "BARREL_INDEX_DEEP_IMPORT": {
    "cause": "An index file itself imports from a deep path in another module instead of using that module's barrel.",
    "approach": "This creates a transitive deep-import dependency at the barrel level. Determine whether the target module's barrel is incomplete or whether this index file is taking a shortcut. The fix direction depends on whether the target module should expose the symbol publicly."
  },
  "BARREL_MISSING_INDEX": {
    "cause": "A directory with multiple source files has no index.ts barrel file, leaving no single entry point for the module.",
    "approach": "Evaluate whether the directory represents a cohesive module that should have a public surface. If it does, a barrel file defines and controls what is exported. If files are independent utilities, a barrel may not be needed — but the directory structure should then reflect that they are not a module."
  },
  "BARREL_INVALID_INDEX_STMT": {
    "cause": "An index.ts contains statements other than export declarations (e.g., logic, variable declarations, side effects).",
    "approach": "Barrel files should be pure re-export surfaces. Logic in an index file is invisible to consumers who expect it to be a passthrough. Determine whether the logic belongs in a dedicated module file that the barrel re-exports."
  },
  "BARREL_SIDE_EFFECT_IMPORT": {
    "cause": "A barrel file contains a side-effect import (import without specifiers), which executes code when the barrel is imported.",
    "approach": "Side-effect imports in barrels make the import graph impure — importing the barrel triggers hidden execution. Determine whether the side effect is intentional (e.g., polyfill registration) and if so, whether it should be isolated into an explicit setup module rather than hiding in a barrel."
  }
}
```

##### exception-hygiene

```json
{
  "EH_THROW_NON_ERROR": {
    "cause": "A throw statement throws a value that is not an Error instance, losing stack trace and error chain capabilities.",
    "approach": "Determine what type is being thrown and why. Throwing strings or plain objects is often a shortcut that breaks error handling patterns downstream. If the thrown value carries domain information, wrap it in a custom Error subclass."
  },
  "EH_ASYNC_PROMISE_EXECUTOR": {
    "cause": "A Promise constructor receives an async executor function, which can silently swallow rejections from awaited expressions.",
    "approach": "Identify why the Promise constructor is used with async. Usually the code can be refactored to an async function directly. If the Promise wraps a callback API, the async keyword in the executor is likely accidental."
  },
  "EH_MISSING_ERROR_CAUSE": {
    "cause": "A caught error is re-thrown or wrapped without preserving the original error via the 'cause' option, breaking the error chain.",
    "approach": "Determine whether the original error's context is needed for debugging. If wrapping in a new error, pass { cause: originalError } to preserve the chain. If re-throwing directly, 'cause' is not needed."
  },
  "EH_USELESS_CATCH": {
    "cause": "A catch block catches an error and immediately re-throws it without transformation, making the try-catch pointless.",
    "approach": "Determine whether the catch was intended to add logging, transformation, or handling that was never implemented. If the try-catch serves no purpose, removing it reduces indentation and noise. If it once had purpose, investigate what changed."
  },
  "EH_UNSAFE_FINALLY": {
    "cause": "A finally block contains a throw or return statement that can override the try/catch result, silently discarding errors.",
    "approach": "Determine whether the throw/return in finally is intentional. In most cases it masks the original error. The finally block should contain only cleanup logic (close connections, release resources) that cannot fail or affect control flow."
  },
  "EH_RETURN_IN_FINALLY": {
    "cause": "A finally block contains a return statement that will override any return or throw from the try/catch blocks.",
    "approach": "This is almost always a bug — the finally return silently replaces whatever the try or catch produced. Move the return to the try block and ensure finally only performs cleanup."
  },
  "EH_CATCH_OR_RETURN": {
    "cause": "A Promise chain has .then() without a .catch() or the result is not returned/awaited, leaving rejections unhandled.",
    "approach": "Determine whether the Promise rejection is intentionally ignored or accidentally unhandled. If the code is in an async function, 'await' captures rejections naturally. If using .then(), add .catch() or return the chain for the caller to handle."
  },
  "EH_PREFER_CATCH": {
    "cause": "Error handling uses .then(onFulfilled, onRejected) instead of .catch(), which is less readable and can miss errors thrown in onFulfilled.",
    "approach": "The two-argument .then() form does not catch errors thrown inside the onFulfilled callback. Determine whether this is intentional. In most cases, replacing with .then().catch() provides more predictable error coverage."
  },
  "EH_PREFER_AWAIT_TO_THEN": {
    "cause": "Promise chains use .then()/.catch() inside an async function instead of await, reducing readability and error flow clarity.",
    "approach": "In async functions, await provides clearer control flow and automatic error propagation via try-catch. Determine whether the .then() chain has a specific reason (parallel execution, chaining) or is just a style inconsistency."
  },
  "EH_FLOATING_PROMISES": {
    "cause": "A Promise is created but not awaited, returned, or stored, so its rejection will be silently lost.",
    "approach": "Determine whether the fire-and-forget is intentional. If the Promise's result or error matters, await or return it. If truly fire-and-forget, add void prefix and ensure errors are handled inside the called function."
  },
  "EH_MISUSED_PROMISES": {
    "cause": "A Promise is used in a context that expects a synchronous value (e.g., array.forEach callback, conditional expression), leading to always-truthy checks or ignored results.",
    "approach": "Determine what the code expected to happen. forEach does not await returned Promises. Boolean checks on Promises are always true. Replace with for-of + await, or restructure the logic to properly handle asynchronous values."
  },
  "EH_RETURN_AWAIT_POLICY": {
    "cause": "An async function returns await expression unnecessarily (or vice versa: should use return-await inside try blocks to catch errors properly).",
    "approach": "In a try block, 'return await' is needed to catch rejections. Outside try blocks, 'return await' adds an unnecessary microtask tick. Determine the context: inside try → keep await, outside try → remove await."
  },
  "EH_SILENT_CATCH": {
    "cause": "A catch block suppresses the error without logging, rethrowing, or handling it in any visible way.",
    "approach": "Determine whether the error suppression is intentional. If so, document why. If not, the silent catch may mask failures. Check whether the same pattern exists in related error handlers — systematic silent catches suggest a missing error-handling strategy across the module."
  },
  "EH_CATCH_TRANSFORM": {
    "cause": "A catch block modifies the error object or its message before rethrowing, potentially losing original error information.",
    "approach": "Determine whether the transformation preserves the error chain (cause property). If the message is altered, the original stack trace should still be accessible. If the error type is changed, downstream handlers may not recognize it."
  },
  "EH_REDUNDANT_NESTED_CATCH": {
    "cause": "A try-catch is nested inside another try-catch that already handles the same error types, creating redundant handling.",
    "approach": "Determine whether the inner catch handles a specific error differently from the outer catch. If not, the nesting adds complexity without value. If the inner catch does transform errors, verify that the outer catch expects transformed errors."
  },
  "EH_OVERSCOPED_TRY": {
    "cause": "A try block wraps significantly more code than the statements that can actually throw, obscuring which operation the catch is protecting.",
    "approach": "Identify which statements within the try block can actually throw. Narrowing the try block makes the error source explicit. If multiple throwing statements are wrapped, determine whether they share error handling logic or whether each needs distinct handling."
  },
  "EH_EXCEPTION_CONTROL_FLOW": {
    "cause": "Exceptions are used for normal control flow (e.g., throwing to break out of a loop or signal a condition), not for error signaling.",
    "approach": "Determine whether the thrown value represents an actual error condition. Using exceptions for control flow is expensive, obscures intent, and confuses downstream error handlers. Replace with return values, result types, or explicit control flow constructs."
  }
}
```

##### unknown-proof

```json
{
  "UNKNOWN_TYPE_ASSERTION": {
    "cause": "A type assertion (as T) bypasses the type checker, asserting a type without runtime validation.",
    "approach": "Determine whether the assertion is backed by a runtime check earlier in the code path. If no check exists, the assertion is a lie to the compiler that will surface as a runtime error. Consider using a type guard function or schema validation instead."
  },
  "UNKNOWN_DOUBLE_ASSERTION": {
    "cause": "A double type assertion (as unknown as T) forces an unsafe type cast through the unknown escape hatch.",
    "approach": "Double assertions are almost always a sign that the type system is being fought. Determine why the direct assertion fails — it usually means the types are fundamentally incompatible. This indicates either a design mismatch or missing intermediate transformation."
  },
  "UNKNOWN_UNNARROWED": {
    "cause": "A value of type 'unknown' is used without narrowing, meaning no runtime type check guards the access.",
    "approach": "Determine where the unknown value originates (external input, catch clause, generic parameter). Add appropriate narrowing: typeof guard, instanceof check, or schema validation. If the value crosses a trust boundary, validation should be at the boundary, not at each usage."
  },
  "UNKNOWN_UNVALIDATED": {
    "cause": "An 'unknown' value from a trust boundary (API input, file read, deserialization) is used without schema validation.",
    "approach": "Boundary values should be validated once at entry. Determine whether a validation layer exists and this usage bypasses it, or whether no validation layer exists yet. If the pattern repeats across multiple boundaries, a shared validation strategy is needed rather than ad-hoc checks."
  },
  "UNKNOWN_INFERRED": {
    "cause": "TypeScript infers 'unknown' for a value where a more specific type was likely intended.",
    "approach": "Determine what type the value should have. The inference may result from a missing return type annotation, an untyped dependency, or a generic function with insufficient type constraints. Adding an explicit type annotation makes the intent clear and catches mismatches earlier."
  },
  "UNKNOWN_ANY_INFERRED": {
    "cause": "TypeScript infers 'any' for a value, disabling type checking for all downstream usage.",
    "approach": "Determine the source of the 'any' inference: untyped import, missing type parameter, JSON.parse result, or catch clause. Each source has a different fix. If 'any' propagates widely, trace it to the root and add a type there — fixing downstream usage is ineffective while the source remains untyped."
  }
}
```

##### dependencies

```json
{
  "DEP_LAYER_VIOLATION": {
    "cause": "A module imports from a layer that the architecture rules prohibit, breaking the intended dependency direction.",
    "approach": "Determine whether the import represents a genuine architectural violation or an inaccurate layer definition. If the import is needed, it may indicate that the layer boundary is drawn incorrectly, or that the imported symbol should be exposed through an allowed layer (e.g., via a port interface)."
  },
  "DEP_DEAD_EXPORT": {
    "cause": "An exported symbol is not imported by any other module in the project, making the export unnecessary.",
    "approach": "Determine whether the export is unused because it is obsolete, or because it serves an external consumer not visible to static analysis (CLI entry, test helper, library public API). If truly unused, removing it reduces the module's public surface. If externally consumed, mark it explicitly."
  },
  "DEP_TEST_ONLY_EXPORT": {
    "cause": "An exported symbol is imported only by test files, meaning production code does not use it but the export exists for testability.",
    "approach": "Determine whether the symbol should be internal (unexported, tested via public API) or whether it represents a testing concern that should live in a test utility module. Exporting symbols solely for tests increases the production public surface and can mislead consumers."
  }
}
```

##### nesting

```json
{
  "NESTING_DEEP": {
    "cause": "A function has deeply nested control structures, increasing indentation and making the execution path hard to follow.",
    "approach": "Determine why nesting accumulated. Possible causes: multiple concerns interleaved in one function, missing early-return guards, or error paths mixed with happy paths. If other findings (waste, coupling) co-occur in the same function, the nesting is likely a symptom of the function doing too much."
  },
  "NESTING_HIGH_CC": {
    "cause": "A function has high cognitive complexity, meaning it contains many interacting control-flow decisions.",
    "approach": "High cognitive complexity means the function requires significant mental effort to trace. Determine which decision axes are independent — independent axes can be extracted into separate functions. If the complexity stems from validation logic, consider a declarative validation approach rather than nested conditionals."
  },
  "NESTING_ACCIDENTAL_QUADRATIC": {
    "cause": "A nested loop or iteration pattern creates O(n²) complexity that may not be intentional.",
    "approach": "Determine whether the quadratic behavior is inherent to the problem or accidental. Common accidental patterns: array.includes() inside a loop (use a Set), nested find/filter, repeated linear scans. If quadratic is inherent, document the expected input size and why it is acceptable."
  },
  "NESTING_CALLBACK_DEPTH": {
    "cause": "A function contains deeply nested callback chains (depth ≥ 3), making control flow hard to follow and error handling fragile.",
    "approach": "Determine whether the nesting reflects genuine sequential async steps or structural accumulation. If callbacks are chained for sequencing, async/await flattens the structure. If callbacks are nested for event handling, consider extracting each level into a named function to make the flow explicit."
  }
}
```

##### early-return

```json
{
  "EARLY_RETURN_INVERTIBLE": {
    "cause": "An if-else structure has a short branch (≤3 statements) ending in return/throw and a long branch, which can be inverted to reduce nesting.",
    "approach": "Determine whether inverting the condition and returning early would improve readability. The short branch typically handles an edge case or error condition. If the pattern repeats across the function, the function may be processing multiple concerns sequentially — each concern's guard becomes a natural early return."
  },
  "EARLY_RETURN_MISSING_GUARD": {
    "cause": "A function lacks guard clauses at the top, pushing the main logic into nested conditionals.",
    "approach": "Identify which conditions at the start of the function check preconditions or special cases. Moving these to guard clauses (return/throw early) flattens the main logic. If preconditions are complex, they may warrant extraction into a validation function."
  }
}
```

##### coupling

```json
{
  "COUPLING_GOD_MODULE": {
    "cause": "A module has both high fan-in and high fan-out, meaning many modules depend on it and it depends on many modules.",
    "approach": "Determine which responsibilities this module holds that attract so many dependents. A god module often accumulates shared utilities, configuration, and domain logic. Identify clusters of related imports/exports — each cluster may form a cohesive module if extracted."
  },
  "COUPLING_BIDIRECTIONAL": {
    "cause": "Two modules import from each other, creating a circular dependency that prevents independent reasoning about either.",
    "approach": "Determine which direction is primary and which is incidental. Often one direction represents a callback or event registration that can be inverted via dependency injection or an event bus. If both directions are essential, the two modules may logically be one module split incorrectly."
  },
  "COUPLING_OFF_MAIN_SEQ": {
    "cause": "A module's instability-abstractness balance places it far from the main sequence, indicating it is either too abstract for its stability or too concrete for how many depend on it.",
    "approach": "Determine whether the module should be more abstract (add interfaces/contracts) or less depended-upon (reduce fan-in by splitting). High-distance modules are the hardest to change correctly because their position creates conflicting forces."
  },
  "COUPLING_UNSTABLE": {
    "cause": "A module has high instability (many outgoing dependencies, few incoming) and high fan-out, making it sensitive to changes in its dependencies.",
    "approach": "Determine whether the high fan-out is essential or whether the module can depend on fewer abstractions. If it consumes many concrete implementations, introducing port interfaces can isolate it from change. If the module is a thin orchestrator, instability may be acceptable by design."
  },
  "COUPLING_RIGID": {
    "cause": "A module has very low instability (many dependents, few dependencies) and high fan-in, making it extremely costly to change.",
    "approach": "Determine whether the module's interface is stable by design (it should be) or frozen by accident (too many dependents accumulated). If the interface needs to evolve, consider versioning, adapter layers, or extracting the stable subset into a separate module."
  }
}
```

##### api-drift

```json
{
  "API_DRIFT_SIGNATURE": {
    "cause": "Functions with the same name pattern have inconsistent signatures (different parameter counts, optional parameter usage, return types, or async modifiers).",
    "approach": "Determine whether the signature differences are intentional variations or drift from a common pattern. If the functions serve the same role in different contexts, their signatures should align. If they serve different roles, their names should differentiate them instead of sharing a misleading prefix."
  }
}
```

##### exact-duplicates / structural-duplicates

```json
{
  "EXACT_DUP_TYPE_1": {
    "cause": "Two or more code blocks are character-for-character identical (Type-1 clone), indicating copy-paste duplication.",
    "approach": "Determine whether the duplication was intentional (e.g., generated code, test fixtures with identical structure) or accidental. If the blocks should stay in sync, extract a shared function. If they are expected to diverge, document why they are separate despite current identity."
  },
  "STRUCT_DUP_TYPE_2_SHAPE": {
    "cause": "Two or more code blocks have identical structure but differ only in identifier names (Type-2 clone), suggesting parameterizable logic.",
    "approach": "Examine the differences between clones — the differing identifiers are candidate parameters for a shared function. If the differences represent domain concepts (e.g., 'user' vs 'order'), the shared function should accept the concept as a parameter or generic type."
  },
  "STRUCT_DUP_TYPE_3_NORMALIZED": {
    "cause": "Two or more code blocks have the same normalized structure after removing cosmetic differences (Type-3 clone), indicating similar but not identical logic.",
    "approach": "The normalization reveals that these blocks solve the same structural problem with minor variations. Determine what the variations represent: different data types, different error handling, or different business rules. The appropriate abstraction depends on the nature of the variation."
  }
}
```

##### DiagnosticAggregator 패턴

```json
{
  "DIAG_GOD_FUNCTION": {
    "cause": "A single function triggers multiple finding types simultaneously (nesting + waste, or responsibility-boundary), indicating it handles multiple independent concerns.",
    "approach": "Determine how many independent concerns this function handles by examining variable clusters. If variables form distinct groups that do not interact, each group likely represents a separable concern. Individual findings (nesting, waste) are symptoms — the root cause is responsibility overload."
  },
  "DIAG_CIRCULAR_DEPENDENCY": {
    "cause": "A group of modules form a dependency cycle, making it impossible to understand or modify any one module in isolation.",
    "approach": "Identify the weakest link in the cycle — the import that contributes least to the module's core purpose. Breaking cycles often requires introducing an interface at the boundary or moving shared types to a neutral location. If the cycle involves only two modules, they may need to merge."
  },
  "DIAG_GOD_MODULE": {
    "cause": "A module acts as a hub with excessive fan-in and fan-out, coupling a large portion of the codebase through one point.",
    "approach": "Analyze what responsibilities attract dependencies to this module. Common culprits: shared configuration, utility mixtures, domain model + logic in one place. Group the module's exports by their consumers — each consumer cluster may indicate a natural split boundary."
  },
  "DIAG_DATA_CLUMP": {
    "cause": "The same group of parameters appears together across multiple function signatures, indicating a missing abstraction.",
    "approach": "Determine whether the parameter group represents a coherent domain concept. If so, introduce a type/interface to bundle them. This reduces parameter counts across all affected functions and makes the concept explicit. If the parameters are coincidentally grouped, no action is needed."
  },
  "DIAG_SHOTGUN_SURGERY": {
    "cause": "A single conceptual change requires modifications across many files, indicating the concept is scattered across the codebase.",
    "approach": "Determine whether the scatter reflects an architectural choice (e.g., layered architecture naturally touches multiple layers) or accidental distribution. If the same change type repeatedly touches the same file set, those files should be colocated or the shared aspect should be centralized."
  },
  "DIAG_OVER_INDIRECTION": {
    "cause": "Multiple forwarding layers exist with single-implementation interfaces, adding navigation cost without runtime variation.",
    "approach": "Determine whether each abstraction layer serves a genuine purpose: dependency inversion for testing, plugin points for actual extensions, or architectural boundaries. If an interface has only one implementation and no test double, the abstraction may not earn its cost."
  },
  "DIAG_MIXED_ABSTRACTION": {
    "cause": "A single function mixes high-level orchestration with low-level implementation detail, visible as large nesting depth variation within the function.",
    "approach": "Identify which parts are orchestration (calling other functions, deciding what to do) and which are implementation (manipulating data, performing computations). Extract the implementation detail into named helper functions so the orchestrator reads as a sequence of high-level steps."
  }
}
```
  
  Step 5. reaching-definitions 추출
    └── waste-detector-oxc.ts의 analyzeFunctionBody에서 reaching-definitions 로직을 engine/reaching-definitions.ts로 분리
    └── 의존: 없음 (다른 Step과 독립. 언제든 가능)
    └── 검증: waste 디텍터 테스트 전량 통과 (동작 불변)
  
  Step 6. DiagnosticAggregator 구현
    └── src/features/diagnostic-aggregator/aggregator.ts 생성
    └── 입력: Partial<FirebatAnalyses> (bare arrays)
    └── 출력: { top: Priority[], catalog: Record<string, CodeEntry> }
    └── Phase 0 패턴 3개 구현: DIAG_GOD_FUNCTION, DIAG_CIRCULAR_DEPENDENCY, DIAG_GOD_MODULE
    └── 의존: Step 4 (code 필드가 있어야 패턴 그룹화 가능)
    └── 검증: integration test — 기존 코드베이스에서 top/catalog 생성 확인
  
  Step 7. report.ts 텍스트 렌더러 확장
    └── top + catalog 섹션 출력 추가
    └── 의존: Step 6 (DiagnosticAggregator 출력이 있어야 렌더링 가능)
    └── 검증: 리포트 출력에 top, catalog 섹션 포함 확인

Phase 1 — 에이전트 실패 모드 (B 시리즈 전체, Phase 0 직후)
  내부 우선순위: 서브그룹 A → B → C 순 (단, 독립 구현 가능하므로 순서 강제 아님)

  서브그룹 A — 가시화 + 불변 조건 (에이전트가 절대 못 발견하는 것):
    ★ Temporal Coupling (B-I-1)
      └── 엔진: 모듈 레벨 AST 순회 + variable-collector (함수별 read/write 추적)
    ★ Implicit State Protocol (B-I-2)
      └── 엔진: AST traversal (process.env, module-scope let, singleton, event string)
    ★ Symmetry Breaking (B-I-3)
      └── config 기반 그룹 정의 + 자동 탐지 하이브리드
    ★ Invariant Blindspot (B-IV-1)
      └── 엔진: AST (assert/throw 조건, 주석 패턴)

  서브그룹 B — 실패 예측:
    ★ Modification Trap (B-IV-2) — 수정 함정 예측
    ★ Modification Impact Radius (B-IV-3) — 수정 영향 반경
      └── scan 디텍터 + MCP assess-impact 도구 이중 제공
    □ giant-file (PLAN A1) → DIAG_GOD_FUNCTION 패턴 입력으로 구현

  서브그룹 C — 정량 측정:
    ★ Variable Lifetime (B-II-1) — 변수 수명 = 컨텍스트 유지 비용
      └── 엔진: reaching-definitions 모듈 (Phase 0에서 추출) + CFG builder
    ★ Decision Surface (B-II-2) — 독립 결정 축 → 조합 폭발
      └── 엔진: AST 조건식 변수 집합 추출
    ★ Implementation Overhead Ratio (B-III-1) — 인터페이스/구현 복잡도 비율
    ★ Concept Scatter Index (B-III-2) — 도메인 개념 산재도
    ★ Abstraction Fitness (B-III-3) — 모듈 경계 적합도

Phase 2 — 클린코드 위생 (C 시리즈 전체, Phase 0 직후, Phase 1과 병렬 가능)
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

Phase 3 — 기존 디텍터 개선 + 성능 최적화 (모든 Phase와 병렬 가능)
  성능:
    ★ 워처 기반 증분 캐싱 (Section 1.4)
      └── bunner changeset 단방향 소비 + 독립 모드(@parcel/watcher → Set) → Tier 1 최적화
      └── lazy 모드 전환 상태 머신 (scan마다 bunner 존재 여부 판정)
    □ scan 실행 순서 재설계 — Stage 구조 전환 (Section 1.1)
    □ dependencies dead export 복잡도 O(N²)→O(N+M) (Section 1.2)
    □ forwarding fixpoint O(N²)→O(N) 위상 정렬 (Section 1.3)
    □ tsgo LSP 파일 open/close 최적화 (Section 7)
  디텍터 병합:
    □ nesting + early-return 내부 패스 통합 (Section 4.1)
    □ exact-duplicates + structural-duplicates 단일 패스 (Section 4.2)
    □ noop empty-catch → exception-hygiene 완전 이관 (Section 4.3)
    □ exception-hygiene 이중 순회 → 단일 순회 (Section 3.3)
  정확도:
    □ nesting switch case 개선 (Section 2.2)
    □ unknown-proof hover 파싱 취약성 (Section 3.1)
    □ noop empty-function-body 오탐 (Section 3.2)
  견고성:
    □ Parse 에러 시 건너뛰기 → warning finding 생성 (Section 8.1)
    □ barrel-policy resolver 실패 로깅 (Section 8.2)
  설정/호환:
    □ finding 형식 표준화 (metrics 구조 정규화, 잔존 자유형 프로퍼티 정리)
    □ 매직 넘버 config 노출 (Section 5)
    □ 확장자 지원 (.tsx, .mts, .cts, .jsx) (Section 3.4)
    □ dependencies readFileSync → Bun-first 전환 (Section 3.5)
    □ PLAN.md Tier B/C 디텍터 (DiagnosticAggregator 패턴 입력으로) (Section 10-11)

[★] = known mainstream tools 기준 firebat 고유 기능
[□] = 품질/성능 개선
```
