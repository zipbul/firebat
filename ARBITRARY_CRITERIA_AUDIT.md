# 임의 기준(Arbitrary Criteria) 전수 감사 보고서

> [!IMPORTANT]
> ## 대전제: 모든 기능은 에이전트를 위한 것이다
>
> firebat의 모든 기능은 **인간 사용자가 직접 읽고 판단하는 것이 아니라, 인간의 에이전트(AI)가 소비하는 것**을 전제로 설계되어야 한다.
>
> - 에이전트는 raw metric을 해석할 수 있다 — 인간처럼 "한눈에 파악"이 필요하지 않다
> - 에이전트는 false positive를 필터링할 수 있다 — 다만 **근거 없는 임의 기준**은 에이전트의 판단도 오염시킨다
> - "주의 환기"보다 **정확한 사실 전달**이 우선이다 — 에이전트에게 감으로 정한 severity를 주면 감으로 정한 우선순위로 수정한다
>
> 이 문서의 모든 항목은 위 관점에서 논의한다: **"이 기준이 에이전트에게 정확한 판단 근거를 제공하는가?"**


> **목적**: 26개 feature + engine 핵심 모듈 전체를 코드 레벨로 읽고, "분석 데이터로부터 도출된 논리적/객관적 사실"이 **아닌** 개발자가 근거 없이 설정한 기준들을 식별한다.
> *(원래 28개 모듈에서 api-drift, noop feature 제외)*
>
> **작성일**: 2025-02-25
>
> **범위**: `src/features/**`, `src/engine/**`, `src/application/scan/scan.usecase.ts`

---

## 용어 정의

| 구분 | 정의 | 예시 |
| --- | --- | --- |
| **객관적 판단** | AST 구조, 데이터흐름 분석, 외부 도구(tsgo/oxlint) 결과 등 검증 가능한 사실 | dead-store (reaching-definition), useless-catch (AST 패턴) |
| **임의 판단** | 데이터 분석 없이 감으로 정한 수치, 공식, 패턴, 가정 | `cognitiveComplexity >= 15` 를 "높음"으로 판단 |

---

## 목차

- [A. 임의 수치 임계값 (Magic Threshold)](#a-임의-수치-임계값-magic-threshold)
- [B. 임의 공식/가중치 (Arbitrary Formula)](#b-임의-공식가중치-arbitrary-formula)
- [C. 이름/패턴 기반 휴리스틱 (Name-based Heuristic)](#c-이름패턴-기반-휴리스틱-name-based-heuristic)
- [D. 아키텍처 가정 (Architecture Assumption)](#d-아키텍처-가정-architecture-assumption)
- [E. 근사 측정 (Approximate Measurement)](#e-근사-측정-approximate-measurement)
- [F. 임의 confidence 값 (Arbitrary Confidence)](#f-임의-confidence-값-arbitrary-confidence)
- [G. 신규 디텍터/메트릭 후보 (Detector Candidates)](#g-신규-디텍터메트릭-후보-detector-candidates)
- [참고: 객관적 사실 기반 기능 목록](#참고-객관적-사실-기반-기능-목록)
- [요약 통계](#요약-통계)
- [검증 이슈](#검증-이슈-2026-03-21)

---

## A. 임의 수치 임계값 (Magic Threshold)

데이터 분석이나 학술 연구 결과 없이 선정된 숫자들.

### 기능 폐기로 무효화된 항목 (A 카테고리)

| 항목 | 삭제된 기능 | 결론 |
| --- | --- | --- |
| A-10 | early-return 최소 depth 필터 | 코드 삭제로 무효. 현재는 score 기반 필터링(`totalScore < 2`)만 적용 |
| A-11 | exception-hygiene overscoped-try | 기능 폐기. "몇 개가 과도한지" 결정적 기준 없음 |
| A-12 | api-drift qualified prefix 출현 횟수 | 기능 폐기. C-01에 따라 api-drift 전체 삭제 |
| A-13 | concept-scatter 토큰 최소 길이 | 기능 폐기. concept-scatter 전체 삭제 |
| A-14 | symmetry-breaking 그룹 최소 크기 | 기능 폐기. symmetry-breaking 전체 삭제 |
| A-15 | modification-impact 최소 impact radius | 기능 폐기. modification-impact 전체 삭제 |
| A-16 | implicit-state 다중 파일 기준 (4건 통합) | 기능 폐기. implicit-state 전체 삭제 |
| A-20 | waste memory-retention threshold | 기능 폐기. 정밀도 ~50%, 학술/업계 선례 없음, GC 언어에서 정적 분석으로 판단 구조적 불가 |
| A-22 | decisionSurfaceMaxAxes | 기능 폐기. decision-surface 전체 삭제 |
| A-24 | implementationOverheadMinRatio | 기능 폐기. implementation-overhead 전체 삭제 |
| A-25 | conceptScatterMaxScatterIndex | 기능 폐기. concept-scatter 전체 삭제 |
| A-26 | abstractionFitnessMinFitnessScore | 기능 폐기. abstraction-fitness 전체 삭제 |

---

### A-01. coupling — god-module threshold

- **결론**: ✅ Signal — threshold configurable 전환 완료. `.firebatrc.jsonc`의 `coupling.godModulePercent` / `coupling.godModuleMin`으로 설정 가능. 기본값 0.1 / 10 유지.

---

### A-02. coupling — rigid threshold

- **결론**: ✅ Signal — threshold configurable 전환 완료. `coupling.rigidPercent` / `coupling.rigidMin`으로 설정 가능. 기본값 0.15 / 10 유지.

---

### A-03. coupling — off-main-sequence distance

- **결론**: ✅ Signal — threshold configurable 전환 완료. `coupling.distanceThreshold`로 설정 가능. 기본값 0.7 유지.

---

### A-04. coupling — unstable module 판단

- **결론**: ✅ Signal — threshold configurable 전환 완료. `coupling.unstableInstability` / `coupling.unstableFanOut`으로 설정 가능. 기본값 0.8 / 5 유지.

---

### A-05. coupling — rigid module instability

- **결론**: ✅ Signal — threshold configurable 전환 완료. `coupling.rigidInstability`로 설정 가능. 기본값 0.2 유지.

---

### A-06. nesting — high-cognitive-complexity

- **결론**: ✅ Signal — SonarQube Cognitive Complexity whitepaper 정합성 검증 완료. SonarQube, PMD, detekt 모두 기본 임계값 15. configurable 전환 완료 (`maxCognitiveComplexity`). Halstead Volume/Difficulty 보충 메트릭, multi-signal 수집, complexity-density(CC/LOC) kind 구현.

---

### A-07. nesting — callback-depth threshold

- **결론**: ✅ Signal — configurable 전환 완료 (`maxCallbackDepth`). 테스트 러너 콜백 제외는 업계 관행에 부합. Promise chain depth도 별도 kind(`promise-chain-depth`)로 추가.

---

### A-08. nesting — deep-nesting threshold

- **결론**: ✅ Signal — configurable 전환 완료 (`maxNestingDepth`). SonarQube, ESLint `max-depth` 모두 유사 메트릭 제공. 기본값 3은 conservative하며 프로젝트별 조정 가능.

---

### A-09. early-return — invertible-if-else 기준

- **파일**: `src/features/early-return/analyzer.ts` L589
- **코드**: `if (shortCount <= 3 && shortExits && longCount >= shortCount * 2)`
- **결론**: ✅ Signal — 75개 엣지케이스 검증 완료. `shortCount <= 3`은 guard clause가 1~3줄인 실무 관행에 부합. `2x ratio`는 반전 시 가독성 이득이 유의미한 최소 비율. RuboCop `MinBodyLength`와 유사한 접근.

---

### A-10a. early-return — wrapping-if 최소 statement 수

- **파일**: `src/features/early-return/analyzer.ts` L278
- **코드**: `if (stmtCount < 2) { return null; }`
- **결론**: ✅ Signal — 1개 statement wrapping-if는 반전 시 가독성 이득이 거의 없음. score=1로 `totalScore < 2` 필터에 의해 자연 제거됨. 합리적 기준.

---

### A-10b. early-return — implicit-else remaining 최대 수

- **파일**: `src/features/early-return/analyzer.ts` L352
- **코드**: `if (remainingCount > 3) { continue; }`
- **결론**: ✅ Signal — remaining이 길면 반전 후에도 else 블록이 길어져 가독성 이득 감소. 3은 guard clause 1~3줄 실무 관행에 부합.

---

### A-10c. early-return — implicit-else ratio

- **파일**: `src/features/early-return/analyzer.ts` L348
- **코드**: `if (consequentCount < remainingCount * 2) { continue; }`
- **결론**: ✅ Signal — 2x ratio는 A-09의 invertible-if-else ratio와 동일한 2x로 일관성 유지. 합리적 기준.

---

### A-10d. early-return — 최소 score 필터

- **파일**: `src/features/early-return/analyzer.ts` L665
- **코드**: `if (totalScore < 2) { return null; }`
- **결론**: ✅ Signal — score=1은 depth 1감소 × 1 statement → 극소 영향. 노이즈 감소 효과가 큼.

---

### A-10e. early-return — consecutive trailing-ifs dispatch 임계값

- **파일**: `src/features/early-return/analyzer.ts` L618
- **코드**: `countConsecutiveTrailingIfs(bodyStmts) < 2`
- **결론**: ✅ Signal — RuboCop `AllowConsecutiveConditionals`와 동일 원리. 임계값 2는 실제 FP 4건(score 12~22) 제거로 검증됨.

---

### A-10f. early-return — single-exit dispatch 필터

- **파일**: `src/features/early-return/analyzer.ts` L484
- **코드**: `if (singleExitCount === chainLength && finalCount <= 1) { return null; }`
- **결론**: ✅ Signal — Clippy `single_inner_if_else`에서 차용. 이미 maximally flat한 dispatch는 추가 flatten 불필요.

---

### A-10g. collapsible-if — MIN_INNER_STMTS

- **파일**: `src/features/collapsible-if/analyzer.ts` L51
- **코드**: `const MIN_INNER_STMTS = 3;`
- **결론**: ✅ Signal — PMD/SonarJS/Clippy 모두 임계값 없이 감지하지만, firebat는 score 기반 우선순위. 3은 "collapse 시 시각적 이득이 유의미한" 경험적 하한.

---

### A-10h. collapsible-if — 최소 score 필터

- **파일**: `src/features/collapsible-if/analyzer.ts` L261
- **코드**: `if (totalScore < MIN_INNER_STMTS) { return null; }`
- **결론**: ✅ Signal — QA 검증에서 dead code에 가깝다고 확인됨. 방어적 코드로서 유지. 값 자체는 A-10g와 동일 근거.

---

### A-17. indirection — cross-file chain 최소 depth

- **파일**: `src/features/indirection/analyzer.ts`
- **코드**: `if (entry.depth < options.crossFileMinDepth) { continue; }`
- **결론**: ✅ **configurable 전환 완료** — `.firebatrc.jsonc`의 `indirection.crossFileMinDepth`로 설정 가능. CLI `--cross-file-min-depth`. 기본값 2 유지, 최소값 1. Zod 스키마 `z.number().int().min(1).optional()`.

---

### A-18. auto-min-size — 기본값 및 clamp 범위

- **파일**: `src/engine/auto-min-size.ts` L27, L35
- **코드**: `return 60; // 기본값` / `return clamp(Math.round(selected), 10, 200);`
- **결론**: ✅ **유지** — PMD CPD 기본 100 tokens, SourcererCC 50 tokens. 60 노드는 업계 범위 내. `--min-size` CLI로 override 가능.

---

### A-19. auto-min-size — 파일 수별 백분위 매핑

- **파일**: `src/engine/auto-min-size.ts` L30
- **코드**: `const percentile = fileCount >= 1000 ? 0.75 : fileCount >= 500 ? 0.6 : 0.5;`
- **결론**: ✅ **유지** — 다중 임계값 필요성은 학술적으로 지지됨 (arXiv:2002.05204). `--min-size`로 override 가능하므로 내부 알고리즘의 configurable화 불필요.

---

### A-21~23. scan.usecase.ts — 현존 기본값

| # | 옵션 | 기본값 | 결론 |
| --- | --- | --- | --- |
| A-21 | `giantFileMaxLines` | `1000` | ✅ SonarQube S104 기본값 1000 일치. configurable (`giant-file.maxLines`) |
| A-23 | `variableLifetimeMaxLifetimeLines` | `30` | ✅ McConnell Code Complete "minimize live time" 원칙. configurable (`variable-lifetime.maxLifetimeLines`) |

---

## B. 임의 공식/가중치 (Arbitrary Formula)

수학적/통계적 근거 없이 설계된 계산식.

### 기능 폐기로 무효화된 항목 (B 카테고리)

| 항목 | 삭제된 기능 | 결론 |
| --- | --- | --- |
| B-02 | abstraction-fitness fitness 산출 공식 | 기능 폐기. abstraction-fitness 전체 삭제 |
| B-03 | concept-scatter scatterIndex 공식 | 기능 폐기. concept-scatter 전체 삭제 |
| B-04 | decision-surface combinatorialPaths | 기능 폐기. decision-surface 전체 삭제 |
| B-05 | implementation-overhead interface complexity | 기능 폐기. implementation-overhead 전체 삭제. complexity-density kind를 nesting 디텍터에 구현 |
| B-06 | implementation-overhead implementation complexity | 기능 폐기. B-05와 동일 |
| B-07 | abstraction-fitness external coupling 규칙 | 기능 폐기. abstraction-fitness 전체 삭제 (D-07과 동일 코드 중복 집계) |

---

### B-01. coupling — computeSeverity 가중치

- **결론**: ✅ **삭제 완료** — `computeSeverity` 함수 제거 (3원칙 #2 severity 미도입). score는 이제 `Math.round(distance * 100)`으로 순수 Martin metric 기반.

---

## C. 이름/패턴 기반 휴리스틱 (Name-based Heuristic)

코드 식별자 이름이나 문자열 패턴에 의존하는 감지. 이름이 바뀌면 결과가 달라짐.

### 기능 폐기로 무효화된 항목 (C 카테고리)

| 항목 | 삭제된 기능 | 결론 |
| --- | --- | --- |
| C-01 | api-drift PREFIX_STOP_WORDS | 기능 폐기. prefix 기반 패밀리 그룹핑은 구조적으로 판단 불가. api-drift 전체 삭제 |
| C-02 | noop INTENTIONAL_NOOP_NAMES | 기능 폐기. 5개 finding kind 모두 lint 규칙으로 100% 대체. noop 전체 삭제 |
| C-03 | symmetry-breaking Handler/Controller 이름 패턴 | 기능 폐기. symmetry-breaking 전체 삭제 |
| C-04 | symmetry-breaking extractCallSequence | 기능 폐기. symmetry-breaking 전체 삭제 |
| C-05 | implicit-state emit/on 이름 감지 | 기능 폐기. implicit-state 전체 삭제 |
| C-06 | invariant-blindspot 5개 regex signal | 기능 폐기. Rice's Theorem에 의해 정적 분석으로 결정불가능. invariant-blindspot 전체 삭제 |

---

### C-07. waste — `_` prefix 무시

- **파일**: `src/engine/waste-detector-oxc.ts` L170
- **코드**: `if (meta.name.startsWith('_')) { continue; }`
- **결론**: ✅ **채용 (유지)** — 구조분해/콜백 파라미터에서 언어 구조상 수정 불가능한 dead-store가 존재. Precision-first 원칙에 부합. ESLint `no-unused-vars`도 동일하게 `argsIgnorePattern: "^_"` 옵션 제공.

---

## D. 아키텍처 가정 (Architecture Assumption)

특정 프로젝트 구조를 전제한 판단. 해당 구조를 따르지 않는 프로젝트에서는 오탐.

### 기능 폐기로 무효화된 항목 (D 카테고리)

| 항목 | 삭제된 기능 | 결론 |
| --- | --- | --- |
| D-01 | abstraction-fitness Hexagonal Architecture 전제 | 기능 폐기. abstraction-fitness 전체 삭제 |
| D-02 | concept-scatter / modification-impact layerOf 함수 | 기능 폐기. 양쪽 모두 삭제 |
| D-03 | modification-impact highRiskCallers 판단 | 기능 폐기. modification-impact 전체 삭제 |
| D-04 | symmetry-breaking groupKeyAuto 경로 패턴 | 기능 폐기. symmetry-breaking 전체 삭제 |
| D-07 | abstraction-fitness `../` import = 외부 | 기능 폐기. abstraction-fitness 전체 삭제 (B-07과 동일 코드 중복 집계) |

---

### D-05. barrel — DEFAULT_IGNORE_GLOBS

- **파일**: `src/features/barrel/analyzer.ts` L18-25
- **코드**: `node_modules/**`, `dist/**`, `test/**`, `__test__/**`, `__tests__/**`, `**/*.spec.*`, `**/*.test.*` (7개 glob)
- **결론**: ✅ **configurable (replace 시맨틱)** — `BarrelOptions.ignoreGlobs` 지정 시 기본값 7개를 완전 교체. 미지정 시 기본값 적용. 빈 배열 허용 (전체 스캔). 3원칙 #3 Signal threshold = configurable 준수.

---

### D-06. barrel — index.ts strictness

- **파일**: `src/features/barrel/analyzer.ts` L223-296
- **결론**: ✅ **Fact (유지)** — barrel file = re-export only는 업계 표준. eslint-plugin-barrel-files, Biome `noBarrelFile`, Angular/Nx 공식 문서 모두 동일 전제. finding kind `invalid-index-statement`는 barrel 규칙을 활성화한 프로젝트에서만 적용.

---

## E. 근사 측정 (Approximate Measurement)

정확성이 보장되지 않는 대리 지표(proxy metric) 사용.

### 기능 폐기로 무효화된 항목 (E 카테고리)

| 항목 | 삭제된 기능 | 결론 |
| --- | --- | --- |
| E-01 | decision-surface 결정 축(axis) 식별 | 기능 폐기. decision-surface 전체 삭제 |
| E-02 | implementation-overhead regex 기반 복잡도 | 기능 폐기. B-05와 동일 |
| E-03 | modification-trap case label 일치 기반 감지 | 기능 폐기. duplicates 통합 리팩토링으로 삭제 |
| E-04 | symmetry-breaking 호출 시퀀스 비교 | 기능 폐기. symmetry-breaking 전체 삭제 |

---

### E-05. temporal-coupling — writer/reader 존재로 판정

- **파일**: `src/features/temporal-coupling/analyzer.ts` — 모듈 레벨 판정: L1102, 클래스 레벨 판정: L391
- **결론**: ✅ **6단계 정밀도 개선 완료** — (1) 기존 버그 3건 수정, (2) gildash call graph로 caller 공존 검사, (3→4) CFG dominator 분석으로 writer→reader 실행 순서 정밀 검증, (5) guard 패턴 인식, (6) dead writer 제외. 업계 도구 중 temporal coupling을 정적으로 직접 탐지하는 도구 없음 — firebat 고유 기능.

### E-06. variable-lifetime — CFG + reaching-definition 기반 수명 측정

- **파일**: `src/features/variable-lifetime/analyzer.ts`, `src/engine/dataflow/reaching-defs.ts`
- **현재 방식**: `collectFunctionNodes`로 함수별 독립 분석. CFG + reaching-definition 기반 per-def 수명 계산
- **해결된 부정확성**: ✅ 스코프 무시 → 함수별 격리 / ✅ 제어 흐름 무시 → reaching-definition / ✅ regex 오매칭 → AST 기반
- **잔여 설계 제약** (reaching-defs 공유 인프라의 아키텍처 특성):
  - **E-06a. payloadOffset 근사**: multi-line 문장에서 ±1-2줄 과소 평가 가능
  - **E-06b. name-based 변수 추적**: 블록 스코프 섀도잉 시 수명 과대 평가 가능
- **결론**: ✅ **완료** — 3대 부정확성 해소. 잔여 설계 제약 2건은 reaching-defs 인프라 수준 변경 필요.

---

### E-07. error-flow — gildash semantic 타입 기반 return-await-in-try

- **파일**: `src/features/error-flow/analyzer.ts` L1090-1123
- **현재 방식**: `inAsyncFunction` 가드 + gildash `collectTypeAt`으로 반환 표현식 타입 조회 → `isPromiseLike` 판별. semantic 없으면 AST 휴리스틱 fallback
- **해결된 부정확성**: ✅ 비-async 함수 오탐 / ✅ 동기 함수 호출 오탐 / ✅ 변수 Promise 미탐지
- **잔여 설계 제약**: `_ctx.semanticLayer` private API 사용, exception 경로 근사(try depth 카운터)
- **결론**: ✅ **완료** — FP/FN 핵심 원인(타입 정보 부재) 해결.

---

## F. 임의 confidence 값 (Arbitrary Confidence)

전 항목 기능 폐기로 무효화됨.

| 항목 | 삭제된 기능 | 결론 |
| --- | --- | --- |
| F-01 | noop expression-noop (confidence: 0.9) | noop 전체 삭제. lint 규칙으로 대체 |
| F-02 | noop constant-condition (confidence: 0.8) | noop 전체 삭제. lint 규칙으로 대체 |
| F-03 | noop empty-function-body (confidence: 0.6) | noop 전체 삭제. lint 규칙으로 대체 |
| F-04 | waste memory-retention (confidence: 0.5) | memory-retention 전체 폐기. A-20과 동일 근거 |

---

## 참고: 객관적 사실 기반 기능 목록

아래는 AST 구조, 데이터흐름 분석, 외부 도구 결과 등 **검증 가능한 사실**에만 기반한 판단들.

| 기능 | 판단 근거 | 비고 |
| --- | --- | --- |
| **waste** (dead-store/overwrite) | CFG 기반 reaching-definition 데이터흐름 분석 | |
| **error-flow** (useless-catch, unsafe-finally 등) | AST 구조 패턴 매칭 — syntax적으로 확정 | |
| **typecheck** | tsgo LSP 진단 결과 | 외부 도구 위임 |
| **lint** | oxlint 규칙 적용 결과 | 외부 도구 위임 |
| **format** | oxfmt check 결과 | 외부 도구 위임 |
| **exact-duplicates** | 해시 기반 AST 동일성 | minSize threshold는 임의 (A-18) |
| **structural-duplicates** | fingerprint 기반 유사성 | minSize threshold는 임의 (A-18) |
| **barrel** | AST 구조적 사실 | 7개 kind: export-star, cross-module-reexport, barrel-side-effect-import, invalid-index-statement, missing-index, index-deep-import, deep-import |
| **indirection** (thin-wrapper 감지) | 함수 body 단일 호출 + 인자 1:1 전달 검증 | chain depth 기준은 A-17 |
| **dependencies** (cycles, layer-violations) | import graph 구조적 분석 | layer 설정은 사용자 정의 |

---

## 요약 통계

| 카테고리 | 건수 | 해결 | 주요 영향 feature |
| --- | --- | --- | --- |
| A. 임의 수치 임계값 | **34건** (+8 신규) | ✅ **34건 전체 해결** | coupling, nesting, early-return, collapsible-if, auto-min-size, giant-file, variable-lifetime |
| B. 임의 공식/가중치 | **7건** | ✅ **7건 전체 해결** | coupling |
| C. 이름/패턴 휴리스틱 | **7건** | ✅ **7건 전체 해결** | waste |
| D. 아키텍처 가정 | **7건** (+1건 중복: D-07=B-07) | ✅ **7건 전체 해결** | barrel |
| E. 근사 측정 | **7건** (+2 신규) | ✅ **7건 전체 해결** | temporal-coupling, variable-lifetime, error-flow |
| F. 임의 confidence | **4건** | ✅ **4건 전체 해결** | |
| G. 신규 디텍터/메트릭 후보 | **4건** | ✅ **4건 전체 채택** | liveness pressure, usage gap, 스코프 축소, 변이 밀도 |
| **합계** | **70건** (+6 신규: 중복 제거 후) | ✅ **70건 전체 해결** | 17개 feature 중 14개에서 최소 1건 이상 |

---

## G. 신규 디텍터/메트릭 후보 (Detector Candidates)

CFG 기반 variable-lifetime 개선 논의에서 도출된 항목들. G-03은 구현 완료(scope-narrowing). 나머지는 채택됨, 미구현.

---

### G-01. 동시 활성 변수 압력 (liveness pressure)

- **관심사**: 함수 내 특정 지점에서 동시에 살아있는 변수 수
- **결론**: ✅ **구현 완료** — variable-lifetime 디텍터에 `liveness-pressure` finding kind로 구현. backward dataflow liveness 분석으로 함수 내 동시 활성 변수 수 측정. 발화 조건: `functionLineCount >= minFunctionLines` AND `maxLiveCount >= maxLiveVariables` (configurable, 기본 40/7).

---

### G-02. 사용 간격 (usage gap)

- **관심사**: 변수가 사용되는 구간들 사이에 긴 미사용 구간이 존재하면 함수 분해 시그널
- **결론**: ✅ **채택** — finding 메시지에 "gap 사이 구간에서 변수 불필요 여부" 명시 필수.

---

### G-03. 조건부 전용 사용 / 스코프 축소 기회

- **관심사**: 함수 상단에서 선언했지만 특정 블록 안에서만 사용 → 선언을 좁은 스코프로 이동 가능
- **결론**: ✅ **구현 완료** — variable-lifetime 디텍터에 `scope-narrowing` finding kind로 구현. JS/TS 생태계 최초. 실증: firebat 10건, cal.com 160건, trpc 15건 TP. FP 0%.

---

### G-04. 변이 밀도 (mutation density)

- **관심사**: 수명 구간 내 재할당 횟수
- **결론**: ✅ **채택** — loop accumulator 패턴 감지 후 억제 필수.

---

## 잔여 항목

A~F 66건 전체 해결. G 4건 중 2건 구현 완료.

| 항목 | 상태 | 내용 |
| --- | --- | --- |
| G-01 liveness pressure | ✅ **구현 완료** | variable-lifetime 디텍터에 `liveness-pressure` kind. backward dataflow liveness 분석. configurable threshold (기본 40/7) |
| G-02 usage gap | 채택, 미구현 | 변수 사용 간격. finding 메시지에 리소스 패턴 확인 안내 필수 |
| G-03 scope-narrowing | ✅ **구현 완료** | variable-lifetime 디텍터 확장. 실증 FP 0% |
| G-04 mutation density | 채택, 미구현 | 변이 밀도. loop accumulator 패턴 억제 필수 |

---

## 검증 이슈 (2026-03-21)

코드베이스 대조 검증에서 발견된 문서 불일치. 3회 반복 검증 + 독립 반박으로 확정.

### ~~HIGH — D-05 구현/문서 불일치~~ → ✅ 해결 (2026-03-21)

replace 시맨틱으로 코드 수정 완료:
1. `analyzer.ts`: `[...DEFAULT_IGNORE_GLOBS, ...(options.ignoreGlobs ?? [])]` → `options.ignoreGlobs ?? [...DEFAULT_IGNORE_GLOBS]`
2. Zod 스키마: `.nonempty()` 제거 (CLI + MCP 양쪽). 빈 배열 허용.
3. D-05 결론을 replace 시맨틱으로 갱신.

### ~~코드 스멜 — scan.usecase.ts `(config as any)` (1건)~~ → ✅ 해결 (2026-03-21)

`(config as any)` 3곳 제거. `config?.features?.nesting` 등 type-safe 접근으로 전환. `FeatureToggle<T>` 타입에 대해 `typeof === 'object'` 가드 적용. 부수적으로 `errorFlowStatus` dead store 삭제, barrelPromise/typecheckPromise IIFE를 async/await로 전환.
