# REPORT.md — 종합 취합 보고서

> 작성일: 2026-02-23 (코드베이스 전수 대조 검증 — 수정 완료 항목 제거)
> 출처: REPORT.md (Claude 소스 대조), REPORT_OPUS.md (Opus 골든테스트 분석), REPORT_GPT.md (GPT 인프라 분석)
> 검증: 모든 주장을 실제 소스 코드·fixture·expected 파일과 1:1 대조 완료
>
> **구조**: Part 1 Analyzer 결함 → Part 2 골든테스트 결함 → Part 3 인프라 결함 → Part 4 FEATURE_REPORT 오류 → Part 5 조치 권고
>
> **수정 완료 항목 (본 보고서에서 제거됨)**:
> concept-scatter(AST 전환), variable-lifetime(AST 참조 추적), early-return(score=0 skip+invertible-if-else),
> symmetry-breaking(regex 기반 전환), exception-hygiene(try-finally depth 포함), abstraction-fitness(dead code 제거),
> modification-trap(일반화), normalizeFile(공유 유틸 추출+절대경로 수정), waste `_` prefix skip 추가,
> 거짓 음성 fixture 6건 전부 수정, 의미 불일치 feature 4건 수정, 골든 테스트 3feature 추가(format/lint/typecheck),
> 골든 케이스 5개 정책 적용, Autofix round-trip+멱등성 검증 추가, 순서 안정성 테스트 추가,
> normalizeValue/readExpected/writeExpected 공유 유틸 추출, virtualRoot dead parameter 제거,
> dead export 제거, buildGetDeclaredVariables VariableDeclaration 확장, createPrng seed=0 가드 추가

---

# Part 1. Analyzer 소스 코드 결함

## 1. FUNDAMENTAL_FLAW (1개)

### 1.1 temporal-coupling — self-referential FP

`src/features/temporal-coupling/analyzer.ts`:

- L93-101: `initAssignRe.test(file.sourceText)`, `initMethodRe.test(file.sourceText)`, `queryMethodRe.test(file.sourceText)` — raw text regex 매칭
- analyzer 소스 자체에 `initialized`, `init(`, `query(` 문자열 모두 포함 → **self-referential FP 확정**
- 매칭 시 결과값도 하드코딩(`writers: 1, readers: 1`)

**수정**: raw text `includes()`/`test()` → AST 기반 전환.

---

## 2. FP_HIGH (3개)

### 2.1 api-drift — prefix 전역 그루핑 FP

`src/features/api-drift/analyzer.ts`:

- L207-220: `extractPrefixFamily` — camelCase 첫 대문자 기준 prefix 추출 → `analyze`, `debug`, `visit`, `get`, `set`, `on` 등 일반 prefix로 무관한 함수 묶임
- L444: `count >= 3`인 prefix만 `qualifiedPrefixes`에 추가되나, prefix 자체의 의미 검증 없음
- L398-412: 로컬 클로저까지 포함 (export 필터 없음)
- tsgo: `logger`가 전달되나, `tsgoResult.ok === false` 시 analyzer 레벨에서 명시적 경고 로그 없음 (fallback으로 prefix 그룹만 반환)

**수정**: export 함수만 대상. prefix grouping에 의미론적 필터(최소 prefix 길이, stop-word 목록) 추가. tsgo 실패 시 명시적 경고 로그 추가.

### 2.2 decision-surface — 중첩 괄호 문제

`src/features/decision-surface/analyzer.ts`:

- L24: `/\bif\s*\(([^)]*)\)/g` — `[^)]*`는 중첩 괄호를 처리할 수 없음
- **중첩 괄호 문제**: `if (fn(x) && y)` → 첫 `)`에서 매칭 종료 → 조건이 `fn(x`로 잘림 → axes 과소 집계
- L88-130: 파일 단위 axes 집계라 함수 단위 분석 불가
- `maxAxes` 기본값: `AnalyzeDecisionSurfaceOptions`로 외부 설정 가능 (`.firebatrc.jsonc`에서 `maxAxes: 10` 설정됨). 단, 옵션 미지정 시 기본값이 코드 내에 없어 호출자 의존.

**수정**: 중첩 괄호 대응 파서 사용 (`findMatchingParen` 등). 함수 단위 집계 전환. 기본 `maxAxes` 값을 코드 내에 명시.

### 2.3 implementation-overhead — for 세미콜론 이중 카운트 + arrowRe 중첩 괄호

`src/features/implementation-overhead/analyzer.ts`:

- L129-133: `estimateImplementationComplexity` = `semicolons + ifs + fors` → `for(let i=0; i<n; i++)` 헤더 세미콜론이 `semicolons`에 포함 + `fors`에서 한번 더 카운트
- L524: `arrowRe` = `/\bexport\s+const\s+([a-zA-Z_$][\w$]*)\s*=\s*\(([^)]*)\)\s*=>/g` — 같은 파일에 `findMatchingParen` 함수가 존재하지만 arrow function 매칭에 미사용 → 중첩 괄호 FP

**수정**: for 헤더 세미콜론 제외. arrowRe에 findMatchingParen 활용. 장기적으로 AST 기반 전환 검토.

---

## 3. FP_MEDIUM (3개)

### 3.1 waste — primitive 타입 미구분

`src/engine/waste-detector-oxc.ts`:

- memory-retention: 변수 타입(primitive vs object) 구분 없이 모든 변수 대상 → `number`, `string`, `boolean` 등 primitive 바인딩에서도 memory-retention 보고
- ~~`_` prefix 미필터~~ → **수정됨** (L567, L603에 `startsWith('_')` skip 조건 추가)

**수정**: primitive 타입 바인딩 제외 로직 추가.

### 3.2 implicit-state — scope-blind variable name matching

`src/features/implicit-state/analyzer.ts`:

- L148: `(file.sourceText.match(new RegExp(\`\\b${name}\\b\`, 'g')) ?? []).length >= 2` — 단순 `includes()` 대신 단어경계 regex + 2회 이상 등장 조건으로 **일부 개선됨**
- 그러나 여전히 **scope-blind**: 주석·문자열 리터럴 내부 매칭, 다른 함수의 동명 변수, object property 등 구분 불가
- AST 기반 참조 추적 아님

**수정**: AST 기반 변수 참조 추적으로 전환.

### 3.3 noop — 의도적 빈 body FP + normalizeFile 미사용

`src/features/noop/analyzer.ts`:

- L153-165: 모든 empty function body를 `confidence: 0.6`으로 보고 — `noop`, `_noop`, `// intentional` 주석 등 의도적 패턴 체크 없음
- L193: `file.filePath` 직접 전달 — `normalizeFile` import 없음 → 절대경로 노출, 다른 detector와 포맷 불일치

**수정**: 의도적 빈 body 패턴(`noop` 이름, `// intentional` 주석 등) skip 조건 추가. normalizeFile 적용.

---

## 4. FP_LOW (1개)

### 4.1 barrel-policy — test 디렉토리 missing-index

`src/features/barrel-policy/analyzer.ts`:

- `isIgnored` 함수로 ignore glob 패턴 기반 제외 가능하나, 기본값에 test/spec 디렉토리 미포함
- 기본 ignore: `node_modules/**`, `dist/**` 만 — `test/**`, `*.spec.ts` 등 미포함
- 사용자가 `.firebatrc.jsonc`에서 별도 설정 가능하나, 기본 동작에서 test 디렉토리 FP 발생

**수정**: 기본 ignore 패턴에 `test/**`, `__test__/**`, `*.spec.*`, `*.test.*` 추가.

---

## 5. 잠재 문제

### 5.1 invariant-blindspot — `before` signal 과도 일반적

`src/features/invariant-blindspot/analyzer.ts` L29:

```typescript
{ name: 'must-comment', re: /\/\/.*\b(must|always|never|before)\b/gi },
```

`must`/`always`/`never`는 합리적이나 `before`는 과도 일반적 → `// process items before returning` 등 일상 주석도 매칭.

**수정**: `before` signal 키워드 제거 또는 `before \\w+ing` 등 더 구체적 패턴으로 제한.

---

## 6. 공통 구조적 버그

### 6.1 Self-referential 패턴 (1개 detector 잔존)

- **temporal-coupling**: regex 패턴의 키워드(`initialized`, `init(`, `query(`)가 analyzer 소스 자체에 포함 → self-referential FP
- ~~symmetry-breaking~~ → **수정됨** (regex 기반으로 전환, 단순 `includes()` 제거)

**수정**: §1.1 참조.

### 6.2 Raw text regex의 scope 무시 (4개 detector)

temporal-coupling, decision-surface, implementation-overhead, implicit-state에서 파일 전체 소스를 regex로 검색. 렉시컬 스코프·문자열 리터럴·주석을 구분하지 못함.

- ~~variable-lifetime~~ → **수정됨** (AST 기반 참조 추적)
- 잔존 4개 detector에서 여전히 scope-blind raw text 검색 사용

**수정**: 장기적으로 AST 기반 분석 전환. 단기적으로 주석·문자열 리터럴 strip 전처리.

---

# Part 2. 골든 테스트 품질 결함

## 7. Branch coverage 미수집

`coverage/lcov.info`에 BRF/BRH 행이 **존재하지 않음** — 브랜치 커버리지 자체가 수집되지 않고 있음.

- 라인 커버리지: 84.66% (LF=19390/LH=16415)
- 브랜치 커버리지: **미수집**

**수정**: coverage 파이프라인에서 branch 수집 옵션 활성화. CI에 line + branch 임계치 게이팅 추가.

---

## 8. 단위 spec 매핑 결손

`*.ts` 파일 중 colocated `*.spec.ts`가 없는 파일이 여전히 **약 28개** 존재 (167개 소스 중 83% 매핑률). TST-COVERAGE-MAP 규칙이 존재하지만 실제 적용이 불완전.

**수정**: "spec 제외 허용 목록" (types.ts, index.ts, barrel 등) 명시. 제외 외 파일은 spec 추가. 주기적 lint 감시.

---

# Part 3. 골든 테스트 인프라 사소한 문제 (4건)

| # | 문제 | 파일 | 심각도 |
|---|------|------|--------|
| 1 | `buildCommaTokens`가 콤마만 처리 — 세미콜론·괄호 등 다른 토큰 미지원 | `token-utils.ts` | 낮음 — `getTokenBefore`/`getTokenAfter` 정확도에 영향 |
| 2 | fuzz seed가 `return 1`로 고정 — deterministic이지만 seed 다양성 없음 | `test-kit.ts` `getFuzzSeed` | 낮음 |
| 3 | `applyFixes` overlapping fix throw 경로를 커버하는 테스트 없음 | `rule-test-kit.ts` | 낮음 |
| 4 | `test-unit-file-mapping` 골든의 `fileExists` 콜백이 항상 `true`/`false` 상수 — 파일별 조건 분기 미테스트 | `golden.test.ts` | 낮음 |

---

# Part 4. FEATURE_REPORT.md 갱신 필요

## 9. FEATURE_REPORT.md 미갱신 — 수정 완료 항목이 여전히 "Known issues"로 기록됨

FEATURE_REPORT.md가 이전 상태 기준으로 작성되어 있으며, 이미 수정 완료된 이슈가 여전히 문제로 기록되어 있음.

### 9.1 수정 완료인데 아직 기록된 항목

| Detector | FEATURE_REPORT 기술 | 현재 상태 |
|----------|---------------------|----------|
| exact-duplicates | "거짓 음성 (fixture 임계값 미달)" | **수정됨** — fixture + expected 수정 완료 |
| waste | "`_` prefix 미필터, IIFE CFG 버그" | **부분 수정** — `_` prefix 수정됨, primitive 미구분만 잔존 |
| exception-hygiene | "try-finally return await FP" | **수정됨** — try-finally depth 포함 |
| early-return | "score=0 함수도 보고됨" | **수정됨** — score=0 skip 추가 |
| variable-lifetime | "scope-blind regex FP" | **수정됨** — AST 기반 참조 추적 |
| symmetry-breaking | "self-referential FP (3건 전부 FP)" | **수정됨** — regex 기반 전환 |
| modification-trap | "`User` 타입 하드코딩" | **수정됨** — 일반화 |
| concept-scatter | "raw text tokenizing → 예약어 오염" | **수정됨** — AST identifier 기반 |
| abstraction-fitness | "dead code L134 → externalCoupling 비활성" | **수정됨** — 불가능 조건 제거 |
| structural-duplicates | "거짓 음성 (fixture 임계값 미달)" | **수정됨** — fixture + expected 수정 완료 |
| modification-impact | "거짓 음성 (가상 경로 import resolve 실패)" | **수정됨** — fixture + expected 수정 완료 |
| coupling | "no-findings.json 의미 불일치" | **수정됨** — fixture 이름 변경 |

### 9.2 FEATURE_REPORT.md 잔존 오류

| # | 항목 | FEATURE_REPORT 주장 | 실제 |
|---|------|---------------------|------|
| 1 | noop FN — target-discovery.ts L99 | `catch { ... }`를 empty-catch FN으로 분류 | body에 `continue` 있음 → 정상 skip |
| 2 | decision-surface 멀티라인 | "`[^)]*`가 newline 비매칭" | `[^)]*`는 negated char class로 `\n` 포함 매칭. 중첩 괄호 문제는 별개 |
| 3 | invariant-blindspot | "53건 전수 정확" | `before` signal 잠재 FP 미평가 |

### 9.3 FEATURE_REPORT.md 여전히 누락인 문제

| # | 대상 | 누락된 문제 |
|---|------|-----------|
| 1 | implicit-state | scope-blind variable name matching (regex 2+ 조건이지만 AST 미사용) |
| 2 | noop | normalizeFile 미사용 → file 필드 포맷 불일치 |
| 3 | api-drift | tsgo silent failure (명시적 경고 로그 없음) |

**수정**: FEATURE_REPORT.md의 Summary Table 및 Per-Feature Analysis를 현재 코드 상태에 맞게 갱신.

---

# Part 5. 우선순위 조치 권고

## P0 — 즉시 수정

| # | 조치 |
|---|------|
| 1 | temporal-coupling self-referential 버그 수정 — raw text regex → AST 기반 전환 |
| 2 | FEATURE_REPORT.md 갱신 — 수정 완료 항목 반영, 잔존 오류 정정 |

## P1 — 단기 (1~2주)

| # | 조치 |
|---|------|
| 3 | decision-surface 중첩 괄호 파서 도입 (`findMatchingParen` 활용) |
| 4 | implementation-overhead for 세미콜론 이중 카운트 수정 + arrowRe 개선 |
| 5 | noop normalizeFile 적용 + 의도적 빈 body skip 조건 추가 |
| 6 | api-drift prefix grouping에 stop-word 필터 + tsgo 실패 시 명시적 경고 |
| 7 | branch coverage 수집 활성화 + CI 임계치 게이팅 |

## P2 — 중기

| # | 조치 |
|---|------|
| 8 | implicit-state AST 참조 추적 전환 |
| 9 | waste primitive 타입 바인딩 제외 |
| 10 | barrel-policy 기본 ignore에 test 디렉토리 추가 |
| 11 | invariant-blindspot `before` 키워드 제거/제한 |
| 12 | spec 매핑 결손 정리 (28개 미매핑 파일 — TST-COVERAGE-MAP 강제) |
| 13 | fuzz seed 다양성 도입 (getFuzzSeed 개선) |

## P3 — 장기

| # | 조치 |
|---|------|
| 14 | TypeScript 고급 구문 fixture 추가 (제네릭, 데코레이터, enum, namespace) |
| 15 | Cross-feature 통합 테스트 (하나의 파일에서 여러 feature 동시 분석) |
| 16 | Mutation testing 도입 (분석기 코드 변이 시 골든 테스트가 잡아내는지 확인) |
| 17 | buildCommaTokens 확장 (세미콜론·괄호 등 토큰 지원) |
| 18 | applyFixes overlapping fix throw 경로 테스트 추가 |
