# Firebat 로드맵 (AX 구조 신호)

> 목표: **Agent Experience(AX) 비용을 낮추는 “구조 품질 신호”**를 firebat 디텍터로 제공한다.
>
> 원칙:
> - **관측 기반(Observation-driven)**: 정량 근거(metrics)에 기반해 판단한다.
> - **실행 가능(Actionable)**: 모든 finding에 `why` + `suggestedRefactor`를 포함한다.
> - **중복 금지(No duplication)**: oxlint/oxfmt와 역할을 분리한다.

---

## 0. Non-Goals (중복 금지 원칙)

firebat은 “범용 프로젝트”를 대상으로 한다. 따라서 아래 영역은 **기본적으로 firebat의 책임이 아니다**.

- **파일 로컬 스타일/포매팅**: oxlint/oxfmt가 담당한다.
  - 예: blank lines, padding rules, strict member ordering, test title styles
- **단일 파일 AST 금지 규칙**: 가능하면 oxlint 규칙으로 유지한다.

firebat 신규 디텍터는 아래 조건을 만족해야 한다.

- **oxlint로 동일 신호를 이미 잡고 있지 않을 것**
- **구조 분석 신호일 것**: 크로스파일/모듈 경계/심볼 fan-in/out/의존 그래프 등
  - 예외: 파일 단위라도 “AX 비용”을 정량화해 구조 신호로 제시하면 허용
- finding에 **정량 근거(metrics) + why + suggestedRefactor**를 포함할 것

---

## 1. 공통 finding 필드 (최소 요구)

각 디텍터 finding은 최소 아래 정보를 포함한다(필드명은 구현에서 일관되게 유지).

- **`kind`**: stable string identifier (예: `dead-export`, `export-kind-mix`)
- **`message`**: **영어** 1줄 요약 (기계/외부 도구 연동을 위해 고정)
- **`filePath`**, **`span`**: 위치
  - 디렉토리/모듈 레벨이면 `filePath`는 entry 또는 디렉토리, `span`은 `{1:1-1:1}`로 고정
- **`metrics`**: 판단에 사용된 숫자들 (예: `fanIn`, `exportCount`, `uniqueKinds`, `scatterSegments`, `lines`, `maxNesting`)
- **`why`**: **영어** 설명(AX 비용이 왜 증가하는지)
- **`suggestedRefactor`**: **영어** 실행 가능한 개선 제안(여러 옵션 가능)

메시지 템플릿에는 **최소 1개 metric**을 포함한다.

---

## 2. 신규 디텍터 (src/features/)

공통: 크로스파일 / 모듈 경계 / 심볼 fan-in/out / import 그래프 분석 — oxlint만으로 대체 불가한 영역.

### Tier A — 즉시 구현 (기존 인프라 재활용, 빠른 가치)

#### A1) `giant-file` (warn)

- **Signal**: 큰 파일이면서 구조적으로도 “혼잡(busy)”한 상태
- **Default scope**: `src/**`에서 테스트/생성 파일을 제외(글롭은 프로젝트별로 설정 가능)
- **금지**: 곱셈 스코어(점수 폭발) 금지. 완만한 함수 사용

권장 기본값(초기 교정 전 보수적):

```
codeLines = non-empty line count (configurable)
score = codeLines
      + 25 * maxNestingDepth
      + 10 * exportedSymbolCount
      + 20 * max(0, uniqueExportKinds - 1)

warn if (codeLines >= 500 && (maxNestingDepth >= 6 || exportedSymbolCount >= 20 || uniqueExportKinds >= 4))
   OR (score >= 900)
```

- `score >= 900`은 “어떤 내용이든 900줄 파일은 AX Read 비용이 크다”는 가드레일이다.
- 단, 순수 스키마/선언 파일처럼 예외가 필요한 경우는 “ignore/exclude 글롭”으로 배제한다(프로젝트별 설정).

Finding message (English):

```
"File is too large and structurally busy (lines=612, maxNesting=7, exports=24, kinds=4)."
```

Suggested refactor options (English):

- Extract public surface (`index.ts`) + split into feature modules.
- Extract shared contracts/types if they contribute to export kind mix.
- Break deeply nested blocks into guard clauses / helpers.

Re-use:

- Parsing pipeline
- `nesting` analysis logic for `maxNestingDepth` (or reuse AST traversal)

#### A2) `dependency-direction` (warn)

**문제**: “레이어 방향”은 프로젝트 정의다. 따라서 모델을 명시해야 한다.

설정 모델(`allowedDirections` 같은 단일 키 금지):

```jsonc
{
  "features": {
    "dependency-direction": {
      "layers": [
        { "name": "adapters", "globs": ["src/adapters/**"] },
        { "name": "application", "globs": ["src/application/**"] },
        { "name": "ports", "globs": ["src/ports/**"] },
        { "name": "infrastructure", "globs": ["src/infrastructure/**"] },
        { "name": "engine", "globs": ["src/engine/**", "src/features/**"] }
      ],
      "rules": [
        { "from": "application", "to": "infrastructure", "allow": false },
        { "from": "application", "to": "ports", "allow": true }
      ]
    }
  }
}
```

Algorithm:

- 파일 의존 edge 구성(`dependencies` analyzer 재사용)
- 각 파일을 **정확히 한 레이어**로 매핑(첫 매치 우선, 설정 가능)
- 내부 edge마다 `(fromLayer → toLayer)`를 rules로 검증

Finding message (English):

```
"Layer direction violation: application → infrastructure (importer=..., imported=...)."
```

#### A3) `dead-export` (warn) — **심볼 그래프 필요**

**중요**: `dependencies`는 파일 그래프다. `dead-export`는 **심볼 그래프**가 필요하다.

오탐 방지를 위한 2단계 설계:

##### Stage 1: internal-only mode (기본, 안전)

- 스캔 대상(workspace targets) 안에서만 “미사용 export”를 보고한다.
- 프로젝트가 정의한 “entry(모듈 진입점)”에서 **re-export되는 것**은 제외한다.

##### Stage 2: library mode (public entry 정의 필요)

Public API는 아래 중 하나로 정의한다.

- 프로젝트가 정의한 entry 글롭, and/or
- `package.json` export map (`exports` / `types` / `main`) when available

이 모드에선:

- 내부에서 안 쓰이고
- public entry에서 도달 불가능(reachableFromEntry=false)

한 export만 dead로 보고한다.

Implementation outline:

- 파일별 export map 생성( named exports, export declarations, re-exports )
- 파일별 import usage map 생성(import specifiers)
- specifier resolve (가능하면 `barrel-policy`의 resolver 패턴 재사용)
- 심볼 fan-in + entry 도달성 closure 계산

Finding message (English):

```
"Exported symbol is unused (symbol=Foo, fanIn=0, reachableFromEntry=false)."
```

---

### Tier B — 심볼/모듈 분석 (AX 핵심 가치)

#### B1) `shared-type-extraction` (warn)

Signal:

- `type`/`interface` 심볼의 **fan-in ≥ K**
- 그리고 심볼이 `contractPatterns`에 해당하는 위치에 있지 않음

Config:

```jsonc
{
  "features": {
    "shared-type-extraction": {
      "fanInThreshold": 5,
      "contractPatterns": ["**/*.types.ts", "**/contracts/**", "**/shared/types/**"]
    }
  }
}
```

Notes:

- `*.types.ts`를 강제하지 않는다. `contractPatterns`를 사용한다.
- destination이 2개 이상 가능하면 suggested refactor에 복수 옵션을 제공한다.

Finding message (English):

```
"Shared type should be extracted (symbol=UserProfile, fanIn=12)."
```

Suggested refactor (English):

- Move `UserProfile` to a contract location (e.g., `shared/types/` or `*.types.ts`).
- Re-export via a single module entry to improve discoverability.

Re-use:

- Symbol index (preferred) or export/import specifier analysis (fallback)

#### B2) `export-kind-mix` (warn)

Signal:

- 한 파일이 **≥ 3 kinds** export
- 그리고 exported symbols 총합 **≥ N**

Kinds:

- `type`, `interface`, `const`, `function`, `class`, `enum`, `re-export`

Config:

```jsonc
{
  "features": {
    "export-kind-mix": {
      "minKinds": 3,
      "minExportedSymbols": 12
    }
  }
}
```

Finding message (English):

```
"Export kind mix is high (exports=18, kinds=4: type=6, function=8, const=3, interface=1)."
```

Suggested refactor (English):

- Extract shared contracts/types (if many type/interface exports).
- Split implementation exports into submodules and re-export selectively from entry.

#### B3) `scatter-of-exports` (warn) — **클러스터링 신호**

Signal:

- 같은 kind export가 파일 내에서 **여러 개의 비연속 구간(segments)**으로 나타남

Metrics:

- kind별 `segments`
- `scatterKinds` (#kinds where segments ≥ 2)

Finding message (English):

```
"Exports are scattered (typeSegments=3, functionSegments=2). Cluster exports to reduce partial-read cost."
```

Suggested refactor:

- exports를 kind별로 클러스터링한다.
- recommended preset은 “보편 순서(ordering)”를 강제하지 않는다.

#### B4) `public-surface-explosion` (warn)

Signal:

- 모듈 entry가 과도한 심볼을 외부로 노출한다.
- entry는 프로젝트가 정의한 entry 글롭 및/또는 package export map으로 정의한다.

Metrics:

- `reExportCount`, `directExportCount`, `totalPublicSymbols`

Finding message (English):

```
"Public surface is too large (entry=src/foo/index.ts, publicSymbols=27)."
```

Suggested refactor:

- submodule 분리
- entry export를 줄이거나 그룹 API로 재구성

---

### Tier C — 설정/신호 결합 (범용성 강화)

#### C1) `generated-mixed` (warn)

Signal:

- generated 코드가 hand-written 코드와 섞여 AX 비용을 올리는 상태
  - generated 파일은 프로젝트가 정의한 generated 글롭으로 판별
  - “혼재(mixed)”는 최소 한 가지를 만족:
    - 동일 모듈 디렉토리에 generated + handwritten이 공존하고, 그 디렉토리가 public entry 경로에 포함됨
    - handwritten 코드가 모듈 경계를 넘어 generated 코드를 import함

Finding message (English):

```
"Generated code is mixed into a high-traffic module (dir=..., generatedFiles=12, importedByHandwritten=true)."
```

Suggested refactor:

- generated outputs를 전용 디렉토리로 이동하고 public entry에서 제외
- generated globs를 config에 등록하고 경계를 정리

#### C2) `naming-predictability` (info → warn 승격)

Signal:

- 기본: `utils.ts`, `helpers.ts`, `misc.ts`, `common.ts`, `lib.ts` 같은 blocklist → **info**
- 아래 비용 신호와 결합될 때만 **warn**으로 승격:
  - high fan-in, export-kind-mix, scatter-of-exports, public entry exposure

Finding message (English):

```
"Low-predictability filename (file=utils.ts, severity=info)."
```

Escalation message (English):

```
"Low-predictability filename with high traffic (file=utils.ts, fanIn=18, exports=22)."
```

---

## 4. opt-in profiles (별도 디텍터 아님)

Profiles는 임계치를 조정하거나 strict 규칙을 추가로 켠다.

```jsonc
{
  "preset": "recommended",
  "profiles": ["strict-structure"]
}
```

Profile rules:

- `strict-kind-per-file`: `export-kind-mix`를 강화 (`minKinds=2`, `minExportedSymbols=1`)
- `strict-export-clustering`: `scatter-of-exports`를 강화 (`segmentsPerKindMax=1`)
- `strict-symbol-ordering`: **별도 규칙(ordering)**
  - `scatter=0`은 클러스터링일 뿐 “순서”가 아니다
  - ordering은 config로 명시적 order list를 받아야 한다
- `naming-convention`: 접미사 패턴 강제(프로젝트별)

---

## 5. 제거/정리 (중복 확정 / 범용성 정합)

### 5.1 opt-in 이동 (조직/프로젝트 선호)

- `member-ordering`
- `single-exported-class`

### 5.2 기존 디텍터 중복 정책 (noop / early-return)

원칙:

- firebat은 oxlint가 이미 높은 신뢰도로 잡는 “단순 file-local 케이스”를 **중복 리포트하지 않는다**.
- firebat의 가치는 **CFG/dataflow/점수화/리치 컨텍스트**처럼 “구조 분석으로만 가능한 신호”에 있다.

적용 방침(초안, 교정 전):

- `noop`: oxlint 기본 규칙이 잡는 단순 케이스는 축소하고, **구조적으로 의미 있는 케이스(예: 더 강한 컨텍스트/연쇄 영향)**만 남긴다.
- `early-return`: 단순 `no-else-return` 수준은 중복이므로 제외하고, **guard clause/리팩터링 점수화** 중심으로 유지한다.

최종 축소 범위는 OSS 샘플 스캔으로 중복 케이스를 정량화한 뒤 확정한다.

### 5.3 조건부 검토 — `no-inline-object-type`

- `no-inline-object-type`은 “shared-type-extraction의 과도한 버전”일 수 있다.
- `shared-type-extraction` 구현/적용 후:
  - 범용 recommended에 남길 가치가 있는지 재평가
  - 필요 시 opt-in으로 이동하거나 제거한다

---

## 6. 실행 순서

```
Phase 1 — 정리 (신규 기능 없이, 노이즈 감소)
  □ 중복 규칙 삭제 (no-any, no-create-require, no-unknown)
  □ unknown-proof 정책 정합성 수정 (boundary overrides)
  □ strict 스타일 규칙 opt-in 이동 (member-ordering, single-exported-class)
  □ 포맷/스타일 전략 확정 (opt-in 유지 vs 구조 신호 대체)

Phase 2 — Tier A (즉시 구현)
  □ giant-file
  □ dependency-direction
  □ dead-export (Stage 1 internal-only) + entry 도달성 기반 마련

Phase 3 — Tier B (AX 핵심 가치)
  □ export-kind-mix + scatter-of-exports (shared AST pass)
  □ shared-type-extraction (symbol index preferred)
  □ public-surface-explosion
  □ dead-export Stage 2 (library mode; entry/export map 필요)

Phase 4 — Tier C + 정리
  □ generated-mixed (configurable generatedGlobs)
  □ naming-predictability (info→warn 승격)
  □ noop / early-return 중복 축소 (샘플 스캔 기반)
  □ no-inline-object-type 처리 결정 (shared-type-extraction 이후)
  □ 레포 전용 테스트 규칙 분리 (외부 recommended 제외)
  □ strict-structure profile 제공 + OSS 스캔으로 임계치 교정
```
