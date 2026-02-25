# 임의 기준(Arbitrary Criteria) 전수 감사 보고서

> **목적**: 28개 feature + engine 핵심 모듈 전체를 코드 레벨로 읽고, "분석 데이터로부터 도출된 논리적/객관적 사실"이 **아닌** 개발자가 근거 없이 설정한 기준들을 식별한다.
>
> **작성일**: 2025-02-25
>
> **범위**: `src/features/**`, `src/engine/**`, `src/application/scan/scan.usecase.ts`

---

## 용어 정의

| 구분 | 정의 | 예시 |
|---|---|---|
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
- [참고: 객관적 사실 기반 기능 목록](#참고-객관적-사실-기반-기능-목록)
- [요약 통계](#요약-통계)

---

## A. 임의 수치 임계값 (Magic Threshold)

데이터 분석이나 학술 연구 결과 없이 선정된 숫자들.

---

### A-01. coupling — god-module threshold

- **파일**: `src/features/coupling/analyzer.ts` L40
- **코드**: `const godModuleThreshold = Math.max(10, Math.ceil(totalModules * 0.1));`
- **임의 기준**: 전체 모듈의 10%, 최소 10이라는 수치
- **영향**: fanIn과 fanOut이 모두 이 값을 초과하면 god-module로 판정
- **질문**: 10%라는 비율의 근거는? 최소 10은 왜?
- **논의 방향**: 프로젝트 규모별 벤치마크 데이터가 필요하거나, configurable로 전환

---

### A-02. coupling — rigid threshold

- **파일**: `src/features/coupling/analyzer.ts` L41
- **코드**: `const rigidThreshold = Math.max(10, Math.ceil(totalModules * 0.15));`
- **임의 기준**: 전체 모듈의 15%, 최소 10
- **영향**: `instability < 0.2 && fanIn > rigidThreshold`이면 rigid-module
- **질문**: 0.15와 0.2는 서로 어떤 관계? god-module과 rigid의 비율 차이(10% vs 15%) 근거는?

---

### A-03. coupling — off-main-sequence distance

- **파일**: `src/features/coupling/analyzer.ts` L96
- **코드**: `if (distance > 0.7) { signals.push('off-main-sequence'); }`
- **임의 기준**: Robert C. Martin의 Main Sequence 개념을 차용했지만, 0.7이라는 컷오프는 원 논문에 없음
- **질문**: 0.5나 0.6이 아닌 0.7인 이유? false positive/negative 비율 분석이 있었는가?

---

### A-04. coupling — unstable module 판단

- **파일**: `src/features/coupling/analyzer.ts` L100
- **코드**: `if (instability > 0.8 && fanOut > 5) { signals.push('unstable-module'); }`
- **임의 기준**: instability 0.8과 fanOut 5 모두 임의
- **질문**: fanOut 5는 소규모 프로젝트에서는 높지만 대규모에서는 매우 낮음. 상대적 기준이 필요한가?

---

### A-05. coupling — rigid module instability

- **파일**: `src/features/coupling/analyzer.ts` L104
- **코드**: `if (instability < 0.2 && fanIn > rigidThreshold)`
- **임의 기준**: 0.2라는 instability 컷오프
- **질문**: 0.2와 A-04의 0.8 사이가 "정상" 범위인데, 이 밴드(0.2~0.8)의 근거는?

---

### A-06. nesting — high-cognitive-complexity

- **파일**: `src/features/nesting/analyzer.ts` L395
- **코드**: `if (cognitiveComplexity >= 15) { return 'high-cognitive-complexity'; }`
- **임의 기준**: 15
- **참고**: SonarQube의 기본값도 15이지만, SonarQube의 인지 복잡도 계산 방식과 이 코드의 계산 방식이 동일한지 검증 필요
- **질문**: 이 코드의 `cognitiveComplexity` 계산 공식은 `1 + depth`를 누적하는 방식인데, SonarQube 논문의 정의와 일치하는가?

---

### A-07. nesting — callback-depth threshold

- **파일**: `src/features/nesting/analyzer.ts` L399
- **코드**: `if (callbackDepth >= 3) { return 'callback-depth'; }`
- **임의 기준**: 3
- **질문**: callback depth 2와 3의 차이가 유의미한 근거는? Node.js callback hell 논의에서 통상적인 수치인가?

---

### A-08. nesting — deep-nesting threshold

- **파일**: `src/features/nesting/analyzer.ts` L403
- **코드**: `if (maxDepth >= 3) { return 'deep-nesting'; }`
- **임의 기준**: 3
- **질문**: A-07과 동일한 3이지만 측정 대상이 다름(control flow depth vs callback depth). 같은 수치를 쓰는 것이 적절한가?

---

### A-09. early-return — invertible-if-else 기준

- **파일**: `src/features/early-return/analyzer.ts` L175
- **코드**: `if (shortCount <= 3 && endsWithReturnOrThrow(shortNode) && longCount >= shortCount * 2)`
- **임의 기준**: short branch 최대 3 statements, long branch가 short의 2배 이상
- **질문**: "3 statements 이하면 짧다"는 어떤 기준? 2배라는 ratio의 근거는?

---

### A-10. early-return — 최소 depth 필터

- **파일**: `src/features/early-return/analyzer.ts` L187
- **코드**: `if (hasGuardClauses === false && maxDepth < 2 && earlyReturnCount === 0) { return null; }`
- **임의 기준**: 2
- **질문**: depth 1인 함수를 분석에서 제외하는 것이 적절한가? 단순 함수에도 guard clause가 유의미할 수 있음

---

### A-11. exception-hygiene — overscoped-try 기준

- **파일**: `src/features/exception-hygiene/analyzer.ts` L314
- **코드**: `if (stmts.length >= 10)`
- **임의 기준**: try 블록 내 statement 10개 이상이면 "overscoped"
- **질문**: 10이라는 수치의 근거는? 파일 IO처럼 statement가 많을 수밖에 없는 경우에는?

---

### A-12. api-drift — qualified prefix 최소 출현 횟수

- **파일**: `src/features/api-drift/analyzer.ts` L395
- **코드**: `if (count >= 3) { qualifiedPrefixes.add(prefix); }`
- **임의 기준**: 동일 prefix가 3회 이상 등장해야 분석 그룹 형성
- **질문**: 2회이면 왜 안 되는가? 3이라는 minimum sample size의 통계적 근거는?

---

### A-13. concept-scatter — 토큰 최소 길이

- **파일**: `src/features/concept-scatter/analyzer.ts` L56
- **코드**: `if (p.length < 3) { continue; }`
- **임의 기준**: camelCase 분할 후 3글자 미만 제외
- **질문**: `id`, `db`, `io` 같은 2글자 약어가 중요한 concept일 수 있음. 왜 3인가?

---

### A-14. symmetry-breaking — 그룹 최소 크기

- **파일**: `src/features/symmetry-breaking/analyzer.ts` L104
- **코드**: `if (items.length < 3) { continue; }`
- **임의 기준**: handler/controller 파일이 3개 미만이면 분석 불가
- **질문**: 2개일 때도 대칭성 비교가 가능하지 않은가?

---

### A-15. modification-impact — 최소 impact radius

- **파일**: `src/features/modification-impact/analyzer.ts` L101
- **코드**: `if (impactRadius < 2) { continue; }`
- **임의 기준**: 영향 파일이 2개 미만이면 무시
- **질문**: 자기 자신만 포함되면 의미 없으므로 1 초과인 것은 이해되나, 2가 의미 있는 최소인지?

---

### A-16. implicit-state — 다중 파일 기준 (4건 통합)

- **파일**: `src/features/implicit-state/analyzer.ts` L90, L133, L297, L327
- **코드들**:
  - `if (idxs.size < 2) { continue; }` — process.env 키가 2개 파일 이상에서 사용
  - `if (getInstanceFiles.length >= 2)` — getInstance가 2+ 파일
  - `if (exportedFunctionCount < 2) { continue; }` — exported function 2개 미만이면 무시
  - `if (refCount >= 2)` — mutable var 참조 2회 이상
- **임의 기준**: 전부 "2"라는 동일 숫자
- **질문**: 모든 상황에 2가 적절한가? 각 패턴의 특성에 맞는 개별 임계값이 필요하지 않은가?

---

### A-17. forwarding — cross-file chain 최소 depth

- **파일**: `src/features/forwarding/analyzer.ts` L737
- **코드**: `if (entry.depth < 2) { continue; }`
- **임의 기준**: cross-file forwarding chain depth가 2 이상이면 보고
- **질문**: depth 1(단일 파일 간 forwarding)은 왜 무시하는가?

---

### A-18. auto-min-size — 기본값 및 clamp 범위

- **파일**: `src/engine/auto-min-size.ts` L27, L35
- **코드**: `return 60; // 기본값` / `return clamp(Math.round(selected), 10, 200);`
- **임의 기준**: 기본 60, 최소 10, 최대 200
- **질문**: AST 노드 수로 60이 "중복 판단에 적절한 최소 크기"라는 근거는?

---

### A-19. auto-min-size — 파일 수별 백분위 매핑

- **파일**: `src/engine/auto-min-size.ts` L30
- **코드**: `const percentile = fileCount >= 1000 ? 0.75 : fileCount >= 500 ? 0.6 : 0.5;`
- **임의 기준**: 1000파일→75th percentile, 500파일→60th, 기본→50th
- **질문**: 이 3단계 매핑은 어떤 실험 데이터에서 도출되었는가? 선형 보간이 더 적절하지 않은가?

---

### A-20. waste — memory retention threshold

- **파일**: `src/engine/waste-detector-oxc.ts` L556
- **코드**: `const memoryRetentionThreshold = Math.max(0, Math.round(options?.memoryRetentionThreshold ?? 10));`
- **임의 기준**: 기본값 10 (CFG payload steps)
- **질문**: "마지막 사용 후 exit까지 10 step 이상이면 memory retention 문제"라는 기준의 근거는?

---

### A-21~26. scan.usecase.ts — 6개 기본값

- **파일**: `src/application/scan/scan.usecase.ts` L742-748

| # | 옵션 | 기본값 | 질문 |
|---|---|---|---|
| A-21 | `giantFileMaxLines` | `1000` | 1000줄이 "거대"의 기준인 근거? 생성된 파일은? |
| A-22 | `decisionSurfaceMaxAxes` | `2` | if 조건에 고유 변수 2개 이상이면 경고? 거의 모든 함수가 해당될 수 있음 |
| A-23 | `variableLifetimeMaxLifetimeLines` | `30` | 변수 선언~마지막 사용이 30줄이면 "수명이 긴" 변수? |
| A-24 | `implementationOverheadMinRatio` | `1.0` | 구현 복잡도/인터페이스 복잡도 비율 1.0이면 보고? 거의 모든 함수가 해당 |
| A-25 | `conceptScatterMaxScatterIndex` | `2` | scatterIndex(파일 수 + 레이어 수) > 2이면 경고? |
| A-26 | `abstractionFitnessMinFitnessScore` | `0` | fitness score 0 미만이면 보고? 0이라는 기준의 의미는? |

---

## B. 임의 공식/가중치 (Arbitrary Formula)

수학적/통계적 근거 없이 설계된 계산식.

---

### B-01. coupling — computeSeverity 가중치

- **파일**: `src/features/coupling/analyzer.ts` L60-76
- **코드**:
  ```typescript
  if (params.signals.includes('unstable-module')) {
    candidates.push(0.7 + 0.3 * clamp01(params.instability));
  }
  if (params.signals.includes('rigid-module')) {
    candidates.push(0.7 + 0.3 * clamp01(1 - params.instability));
  }
  if (params.signals.includes('god-module')) {
    candidates.push(0.95);
  }
  if (params.signals.includes('bidirectional-coupling')) {
    candidates.push(0.85);
  }
  ```
- **임의 기준**: 0.7, 0.3, 0.95, 0.85 등 모든 가중치
- **질문**: god-module이 0.95이고 bidirectional이 0.85인 이유? 이 순서와 간격은 어떤 실증 데이터에서 비롯되었는가?
- **논의 방향**: severity 공식을 제거하고 signal 종류만 보고하는 방식(판단은 사용자에게 위임)으로 전환?

---

### B-02. abstraction-fitness — fitness 산출 공식

- **파일**: `src/features/abstraction-fitness/analyzer.ts` L78-80
- **코드**:
  ```typescript
  const penalty = totalImports > 0 ? members.length : 0;
  const fitness = internalCohesion - externalCoupling - penalty;
  ```
- **임의 기준**: `내부 응집 - 외부 결합 - 멤버 수 패널티`라는 선형 감산 공식
- **질문**:
  - 왜 단순 빼기인가? 가중 합이나 비율이 더 적절하지 않은가?
  - `penalty = members.length`는 "파일이 많으면 무조건 불이익"인데, 이것이 fitness 측정에 합리적인가?
  - internalCohesion과 externalCoupling이 동일 단위(import 횟수)이므로 빼기는 성립하지만, penalty는 파일 수이므로 단위가 다름

---

### B-03. concept-scatter — scatterIndex 공식

- **파일**: `src/features/concept-scatter/analyzer.ts` L99
- **코드**: `const scatterIndex = filesSet.size + layersSet.size;`
- **임의 기준**: 파일 수와 레이어 수를 동일 가중치(1:1)로 합산
- **질문**:
  - 1개 레이어에 10개 파일(index=11)과 5개 레이어에 6개 파일(index=11)이 같은 심각도인가?
  - 레이어 분산이 더 심각하지 않은가?

---

### B-04. decision-surface — combinatorialPaths

- **파일**: `src/features/decision-surface/analyzer.ts` L114
- **코드**: `const combinatorialPaths = Math.pow(2, axes);`
- **임의 가정**: 모든 결정 축이 boolean(2-way)이라고 가정
- **질문**: `status === 'active' | 'pending' | 'closed'`처럼 3+ way인 경우는? 실제 path 수를 과소평가할 수 있음

---

### B-05. implementation-overhead — interface complexity 추정

- **파일**: `src/features/implementation-overhead/analyzer.ts` L121
- **코드**:
  ```typescript
  const estimateInterfaceComplexity = (signature: string, paramsText: string): number => {
    const hasReturnType = signature.includes('):') || signature.includes(') :');
    const paramCount = countTopLevelParams(paramsText);
    const raw = paramCount + (hasReturnType ? 1 : 0);
    return Math.max(1, raw);
  };
  ```
- **임의 기준**: params 수 + return type 유무(0 or 1) = 인터페이스 복잡도
- **질문**:
  - generic type parameters는 복잡도를 높이지 않는가?
  - object 파라미터 `{ a, b, c }: Options`는 1로 카운트되는데, 실제로는 3개 필드

---

### B-06. implementation-overhead — implementation complexity 추정

- **파일**: `src/features/implementation-overhead/analyzer.ts` L127-134
- **코드**:
  ```typescript
  const estimateImplementationComplexity = (body: string): number => {
    const semicolons = (body.match(/;/g) ?? []).length;
    const ifs = (body.match(/\bif\b/g) ?? []).length;
    const fors = (body.match(/\bfor\b/g) ?? []).length;
    // ... C-style for 보정 ...
    return Math.max(1, adjustedSemicolons + ifs + fors);
  };
  ```
- **임의 기준**: 세미콜론 + if + for 카운트 = 구현 복잡도
- **질문**:
  - `console.log('debug');`의 세미콜론도 1 복잡도?
  - `while`, `switch`, `try/catch`는 무시되는가?
  - 문자열 내 `if`나 `for`가 카운트될 수 있음 (regex 기반이므로)

---

### B-07. abstraction-fitness — external coupling 증가 규칙

- **파일**: `src/features/abstraction-fitness/analyzer.ts` L63-70
- **코드**:
  ```typescript
  if (from.startsWith('../')) {
    externalCoupling += 1;
  } else {
    internalCohesion += 1;
  }
  // ...
  if (rel.includes('/application/') || rel.includes('/adapters/') || rel.includes('/infrastructure/')) {
    externalCoupling += 1;
  }
  ```
- **임의 기준**: `../` import = 외부 결합, 특정 경로 포함 시 추가 패널티
- **질문**:
  - 같은 패키지 내 상위 디렉토리 import도 "외부"인가?
  - application/adapters/infrastructure 경로에 있다는 것만으로 무조건 +1 패널티가 적절한가?

---

## C. 이름/패턴 기반 휴리스틱 (Name-based Heuristic)

코드 식별자 이름이나 문자열 패턴에 의존하는 감지. 이름이 바뀌면 결과가 달라짐.

---

### C-01. api-drift — PREFIX_STOP_WORDS

- **파일**: `src/features/api-drift/analyzer.ts` L210-217
- **코드**: 80개의 prefix stop words (`get`, `set`, `on`, `is`, `to`, `has`, `do`, `can`, ...)
- **임의 기준**: 이 80개가 "API prefix로서 무의미"하다고 분류
- **질문**:
  - `render`, `compile`, `visit` 같은 단어들이 왜 stop word인가? 이들은 특정 도메인에서 매우 유의미한 prefix
  - `withXxx`, `useXxx` 같은 React 패턴에서 `with`/`use`를 제거하면 핵심 정보 손실
  - 이 목록은 어떤 corpus 분석에서 도출되었는가?

---

### C-02. noop — INTENTIONAL_NOOP_NAMES

- **파일**: `src/features/noop/analyzer.ts` L11
- **코드**: `const INTENTIONAL_NOOP_NAMES = new Set(['noop', '_noop', 'noOp', 'NOOP']);`
- **임의 기준**: 4개 이름만 의도적 noop으로 인정
- **질문**:
  - `noOperation`, `emptyFn`, `identity`, `stub`, `placeholder`는?
  - test double(spy, mock)도 빈 함수일 수 있음

---

### C-03. symmetry-breaking — Handler/Controller 이름 패턴

- **파일**: `src/features/symmetry-breaking/analyzer.ts` L47
- **코드**: `const re = /\bexport\s+function\s+([a-zA-Z_$][\w$]*(?:Handler|Controller))\s*\(/g;`
- **임의 기준**: 함수 이름이 `Handler` 또는 `Controller`로 끝나는 경우만 감지
- **질문**:
  - `Service`, `Processor`, `Worker`, `Middleware`, `Resolver` 접미사는?
  - 이름 기반이 아닌 export 구조 기반 감지가 더 견고하지 않은가?

---

### C-04. symmetry-breaking — extractCallSequence

- **파일**: `src/features/symmetry-breaking/analyzer.ts` L56-59
- **코드**: 인자 없는 `foo();` 호출만 추출하여 시퀀스 비교
- **임의 기준**: 인자 있는 호출(`foo(bar)`)은 무시
- **질문**: `validate(input); process(input); save(result);`도 시퀀스인데, 인자가 있어서 무시됨

---

### C-05. implicit-state — emit/on 이름 감지

- **파일**: `src/features/implicit-state/analyzer.ts` L165
- **코드**: `if (calleeName !== 'emit' && calleeName !== 'on') { continue; }`
- **임의 기준**: 이벤트 시스템 감지가 `emit`/`on` 이름에만 의존
- **질문**: `addEventListener`, `subscribe`, `dispatch`, `trigger`, `publish`, `broadcast`는?

---

### C-06. invariant-blindspot — 5개 regex signal

- **파일**: `src/features/invariant-blindspot/analyzer.ts` L24-28
- **코드**:
  ```typescript
  const signals = [
    { name: 'console.assert', re: /console\.assert\s*\(/g },
    { name: 'throw-guard', re: /\bthrow\s+new\s+Error\s*\(/g },
    { name: 'must-comment', re: /\/\/.*\b(must|always|never)\b/gi },
    { name: 'switch-default-throw', re: /\bdefault\s*:\s*\bthrow\b/gi },
    { name: 'bounds-throw', re: /\bif\s*\([^)]*\.length\s*===\s*0\)\s*throw\b/gi },
  ];
  ```
- **임의 기준**: 이 5개 패턴이 불변 조건의 전부라는 가정
- **질문**:
  - 코멘트 내 "must/always/never"가 불변 조건을 의미한다는 것은 매우 subjective
  - `assert`, `invariant`, `precondition` 같은 함수 호출은?
  - 이 패턴 중 하나라도 매치되면 **파일당 1건만** 보고하는데, 이것으로 충분한가?

---

### C-07. waste — `_` prefix 무시

- **파일**: `src/engine/waste-detector-oxc.ts` L705
- **코드**: `if (meta.name.startsWith('_')) { continue; }`
- **임의 기준**: `_` prefix가 "의도적 미사용"이라는 컨벤션 가정
- **질문**: TypeScript 공식 컨벤션이 아님. Python에서 차용된 관습이며, 팀마다 다를 수 있음. ESLint의 `no-unused-vars`와 일관성은?

---

## D. 아키텍처 가정 (Architecture Assumption)

특정 프로젝트 구조를 전제한 판단. 해당 구조를 따르지 않는 프로젝트에서는 오탐.

---

### D-01. abstraction-fitness — Hexagonal Architecture 전제

- **파일**: `src/features/abstraction-fitness/analyzer.ts` L68-70
- **코드**: `rel.includes('/application/') || rel.includes('/adapters/') || rel.includes('/infrastructure/')`
- **임의 가정**: 경로에 이 문자열이 있으면 외부 결합으로 패널티 부여
- **질문**: Hexagonal/Clean Architecture를 따르지 않는 프로젝트에서는 아무 의미 없음. Flat structure 프로젝트는?

---

### D-02. concept-scatter / modification-impact — layerOf 함수

- **파일**: `src/features/concept-scatter/analyzer.ts` L23-39, `src/features/modification-impact/analyzer.ts` L18-35
- **코드**: `src/adapters/`, `src/application/`, `src/infrastructure/`, `src/ports/` → 레이어 분류
- **임의 가정**: 4-레이어 Clean Architecture가 전제
- **질문**: 동일 `layerOf` 함수가 2개 feature에 중복 존재. 프로젝트의 실제 구조를 설정으로 받아야 하지 않는가?

---

### D-03. modification-impact — highRiskCallers 판단

- **파일**: `src/features/modification-impact/analyzer.ts` L112-116
- **코드**:
  ```typescript
  const highRiskCallers = affected.filter(p => {
    const callerLayer = layerOf(p);
    const calleeLayer = layerOf(rel);
    return calleeLayer === 'application' && (callerLayer === 'adapters' || callerLayer === 'infrastructure');
  });
  ```
- **임의 가정**: "application 레이어 코드를 adapters/infrastructure가 호출하면 고위험"
- **질문**: 이 방향의 의존성이 왜 "고위험"인가? Dependency Inversion 원칙상 이 방향이 정상 아닌가?

---

### D-04. symmetry-breaking — groupKeyAuto 경로 패턴

- **파일**: `src/features/symmetry-breaking/analyzer.ts` L18-35
- **코드**: `/handlers/`, `/controllers/` 경로를 감지하여 그룹화
- **임의 가정**: `handlers`, `controllers` 디렉토리가 존재한다는 전제
- **질문**: MVC가 아닌 프로젝트에서는? 사용자 정의 그룹 설정이 필요

---

### D-05. barrel-policy — DEFAULT_IGNORE_GLOBS

- **파일**: `src/features/barrel-policy/analyzer.ts` L16-23
- **코드**: `node_modules/**`, `dist/**`, `test/**` 등 7개 glob
- **임의 가정**: 이 경로들이 항상 분석에서 제외되어야 함
- **질문**: monorepo에서 `test/`가 integration test이고 barrel 규칙을 적용해야 할 수 있음

---

### D-06. barrel-policy — index.ts strictness

- **파일**: `src/features/barrel-policy/analyzer.ts` L220-280
- **임의 가정**: index.ts 파일은 re-export만 허용
- **질문**: 일부 프로젝트에서는 index.ts에 factory 함수나 DI 설정을 넣는 것이 정석. 이것이 "violation"인 것이 맞는가?

---

### D-07. abstraction-fitness — `../` 시작 import = 외부

- **파일**: `src/features/abstraction-fitness/analyzer.ts` L63
- **코드**: `if (from.startsWith('../')) { externalCoupling += 1; }`
- **임의 가정**: 상위 디렉토리 import은 무조건 "외부 결합"
- **질문**: `../shared/utils`처럼 같은 도메인 내 공유 모듈도 "외부"로 취급됨

---

## E. 근사 측정 (Approximate Measurement)

정확성이 보장되지 않는 대리 지표(proxy metric) 사용.

---

### E-01. decision-surface — 결정 축(axis) 식별

- **파일**: `src/features/decision-surface/analyzer.ts` L80-95
- **방식**: if 조건 내 identifier/property access를 "결정 축"으로 추출
- **부정확성**:
  - `user.name.length > 0 && user.name !== ''` → `user.name.length`, `user.name` 2개 축으로 카운트되지만 실질 1개
  - 상수(`MAX_RETRIES`)도 축으로 카운트될 수 있음
- **질문**: AST 기반으로 실제 결정 변수만 추출하는 것이 가능한가?

---

### E-02. implementation-overhead — regex 기반 복잡도

- **파일**: `src/features/implementation-overhead/analyzer.ts` L127-134
- **부정확성**:
  - 문자열/주석 내 `if`, `for`, `;`도 카운트
  - `while`, `switch`, `try/catch`는 누락
  - 빈 줄이나 선언문도 세미콜론으로 +1
- **질문**: AST 기반 측정으로 전환해야 하는가?

---

### E-03. modification-trap — case label 일치 기반 감지

- **파일**: `src/features/modification-trap/analyzer.ts` L49-60
- **방식**: 2개 파일에서 동일한 switch case label 세트 → "함께 수정해야 하는" 코드
- **부정확성**: 같은 enum을 switch 하는 것이 반드시 "수정 트랩"은 아님. 각 switch가 다른 동작이라면 정상
- **질문**: import graph 기반으로 공유 타입을 추적하는 것이 더 정확하지 않은가?

---

### E-04. symmetry-breaking — 호출 시퀀스 비교

- **파일**: `src/features/symmetry-breaking/analyzer.ts` L56-59
- **부정확성**: `validate(); process(); respond();`처럼 인자 없는 호출만 추출하므로, 실제 로직 유사성과 무관할 수 있음
- **질문**: AST 기반으로 함수 body 구조 (call expression 순서 + branch 패턴)를 비교하는 것이 견고하지 않은가?

---

### E-05. temporal-coupling — writer/reader 존재로 판정

- **파일**: `src/features/temporal-coupling/analyzer.ts` L283-293
- **방식**: 모듈 레벨 mutable 변수에 대해 writer 1+ / reader 1+ → temporal coupling
- **부정확성**: 의도적 설계(예: connection pool, config loader)도 동일 패턴. false positive가 매우 높음
- **질문**: 실제 호출 순서 분석(call graph 기반) 없이 "coupling"을 선언하는 것이 적절한가?

---

## F. 임의 confidence 값 (Arbitrary Confidence)

통계적/실증적 근거 없이 부여된 신뢰도.

---

### F-01. noop — expression-noop / self-assignment

- **파일**: `src/features/noop/analyzer.ts` L139
- **값**: `confidence: 0.9`
- **질문**: 0.9라는 수치가 "100건 중 90건은 의미 없는 코드"라는 뜻인가? 어떤 데이터에서?

---

### F-02. noop — constant-condition / empty-catch

- **파일**: `src/features/noop/analyzer.ts` L153
- **값**: `confidence: 0.8`
- **질문**: constant condition이 의도적인 경우(feature flag)가 20%라는 의미인가?

---

### F-03. noop — empty-function-body

- **파일**: `src/features/noop/analyzer.ts` L203
- **값**: `confidence: 0.6`
- **질문**: 0.6이면 거의 동전 던지기 수준. 이 confidence라면 보고 자체를 하지 않는 것이 나은가?

---

### F-04. waste — memory-retention

- **파일**: `src/engine/waste-detector-oxc.ts` L788
- **값**: `confidence: 0.5`
- **질문**: 0.5는 "반반 확률"인데, 이 수준의 finding을 사용자에게 보여주는 것이 적절한가? noise가 너무 많지 않은가?

---

## 참고: 객관적 사실 기반 기능 목록

아래는 AST 구조, 데이터흐름 분석, 외부 도구 결과 등 **검증 가능한 사실**에만 기반한 판단들.

| 기능 | 판단 근거 | 비고 |
|---|---|---|
| **waste** (dead-store/overwrite) | CFG 기반 reaching-definition 데이터흐름 분석 | memory-retention은 제외 (A-20, F-04) |
| **exception-hygiene** (useless-catch, unsafe-finally 등) | AST 구조 패턴 매칭 — syntax적으로 확정 | overscoped-try는 제외 (A-11) |
| **typecheck** | tsgo LSP 진단 결과 | 외부 도구 위임 |
| **lint** | oxlint 규칙 적용 결과 | 외부 도구 위임 |
| **format** | oxfmt check 결과 | 외부 도구 위임 |
| **exact-duplicates** | 해시 기반 AST 동일성 | minSize threshold는 임의 (A-18) |
| **structural-duplicates** | fingerprint 기반 유사성 | minSize threshold는 임의 (A-18) |
| **barrel-policy** (export-star 감지) | AST 구조적 사실 | strictness 규칙은 D-06 |
| **forwarding** (thin-wrapper 감지) | 함수 body 단일 호출 + 인자 1:1 전달 검증 | chain depth 기준은 A-17 |
| **noop** (expression-noop, self-assignment) | AST 구문 특성 — side effect 없음 확정 | confidence 값은 F-01 |
| **dependencies** (cycles, layer-violations) | import graph 구조적 분석 | layer 설정은 사용자 정의 |

---

## 요약 통계

| 카테고리 | 건수 | 주요 영향 feature |
|---|---|---|
| A. 임의 수치 임계값 | **26건** | coupling, nesting, early-return, 기본값 6개 |
| B. 임의 공식/가중치 | **7건** | coupling, abstraction-fitness, concept-scatter, implementation-overhead |
| C. 이름/패턴 휴리스틱 | **7건** | api-drift, noop, symmetry-breaking, implicit-state, invariant-blindspot |
| D. 아키텍처 가정 | **7건** (+1건 중복) | abstraction-fitness, concept-scatter, modification-impact, barrel-policy |
| E. 근사 측정 | **5건** | decision-surface, implementation-overhead, modification-trap, temporal-coupling |
| F. 임의 confidence | **4건** | noop, waste |
| **합계** | **56건** | 28개 feature 중 22개에서 최소 1건 이상 |

---

## 다음 단계 제안

1. **우선순위 분류**: 각 항목을 "삭제/configurable 전환/근거 보강/수용" 4단계로 분류
2. **데이터 기반 검증**: 실제 오픈소스 프로젝트들에 대해 각 임계값별 false positive/negative 비율 측정
3. **아키텍처 가정 분리**: D 카테고리 전체를 config에서 주입받도록 리팩토링
4. **confidence 체계 재설계**: F 카테고리의 임의 값 제거, 또는 실제 true positive 비율로 보정
