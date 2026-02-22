# REPORT.md — 종합 취합 보고서

> 작성일: 2026-02-22 (3개 보고서 취합 + 코드베이스 전수 대조 검증)
> 출처: REPORT.md (Claude 소스 대조), REPORT_OPUS.md (Opus 골든테스트 분석), REPORT_GPT.md (GPT 인프라 분석)
> 검증: 모든 주장을 실제 소스 코드·fixture·expected 파일과 1:1 대조 완료
>
> **구조**: Part 1 Analyzer 결함 → Part 2 골든테스트 결함 → Part 3 인프라 결함 → Part 4 FEATURE_REPORT 오류 → Part 5 조치 권고

---

# Part 1. Analyzer 소스 코드 결함

## 1. FUNDAMENTAL_FLAW (5개)

### 1.1 concept-scatter — raw text tokenizing + normalizeFile 절대경로

`src/features/concept-scatter/analyzer.ts`:

- L98: `tokenizeConcepts(file.sourceText)` — 파일 소스 전체를 raw text tokenizing → JS/TS 예약어(`import`, `const`, `return` 등)가 모두 concept으로 등록됨
- L8-17: `normalizeFile`에서 `/src/` 없는 파일은 절대경로 반환 → `home`, `revil` 등이 concept으로 등록됨
- L117: `scatterIndex = filesSet.size + layersSet.size` — 오염된 토큰 기반 집계
- ~90% FP 추정. 예약어·경로 토큰이 대부분.

**수정**: AST identifier 기반으로 전환. sourceText 전체 토크나이징 제거.

### 1.2 variable-lifetime — scope-blind regex

`src/features/variable-lifetime/analyzer.ts`:

- L103: `new RegExp(\`\\b${name}\\b\`, 'g')` → 파일 전체 텍스트에서 변수명 regex 검색
- scope 구분 없음: 다른 함수의 동명 변수, object property(`.name`), 주석, 문자열 리터럴 모두 "사용"으로 인식
- export 문을 last use로 카운트 → lifetime 인플레이션

**수정**: AST reference tracking 기반으로 전환.

### 1.3 early-return — score=0 보고 + invertible-if-else 0건

`src/features/early-return/analyzer.ts`:

- L250: 기본 kind가 `missing-guard` — `kind === null`이면 무조건 할당
- L247: `score = Math.max(0, earlyReturnCount + (hasGuardClauses ? 0 : 1))` → guard 있고 return 0이면 score=0인데도 보고됨
- L253: skip 조건 `hasGuardClauses === false && maxDepth < 2 && earlyReturnCount === 0` (3가지 동시 충족 시에만 skip — 설계 의도 확인됨)
- `invertible-if-else` kind: 로직은 L200-215에 존재하나 threshold 너무 엄격하여 실제 발화 0건

**수정**: skip 조건에 `score === 0` 체크 추가. invertible-if-else threshold 완화 검토.

### 1.4 temporal-coupling — self-referential FP

`src/features/temporal-coupling/analyzer.ts`:

- L101: `file.sourceText.includes('initialized') && file.sourceText.includes('init(') && file.sourceText.includes('query(')`
- analyzer 소스 자체에 이 세 문자열 모두 포함 → **self-referential FP 확정**
- 매칭 시 결과값도 하드코딩(`writers: 1, readers: 1`)

**수정**: raw text `includes()` → AST 기반 전환.

### 1.5 symmetry-breaking — self-referential FP

`src/features/symmetry-breaking/analyzer.ts`:

- L53: `Handler|Controller` export regex
- Fallback L159-207: `sourceText.includes('Controller')` → analyzer 소스의 L53 regex에 'Controller' 포함 → self-referential
- 3건 전부 FP

**수정**: raw text `includes()` → AST 기반 전환.

---

## 2. FP_HIGH (3개)

### 2.1 api-drift — prefix 전역 그루핑 + tsgo 미검증

`src/features/api-drift/analyzer.ts`:

- L213-224: `extractPrefixFamily` — camelCase 첫 대문자 기준 prefix 추출 → `analyze`, `debug`, `visit` 등 일반 prefix로 무관한 함수 묶임
- L427-430: `count >= 3`인 prefix만 `qualifiedPrefixes`에 추가
- L398-412: 로컬 클로저까지 포함 (export 필터 없음)
- L446-457: `runTsgoApiDriftChecks()` — `tsgoResult.ok === false` 시 silent failure (로깅/에러 처리 없음)

**수정**: export 함수만 대상. prefix grouping에 의미론적 필터 추가. tsgo 실패 시 명시적 경고.

### 2.2 decision-surface — maxAxes=2 과소 + 중첩 괄호 문제

`src/features/decision-surface/analyzer.ts`:

- L37: `/\bif\s*\(([^)]*)\)/g` — `[^)]*`는 `\n` 포함 매칭하므로 멀티라인은 처리됨
- **중첩 괄호 문제**: `if (fn(x))` → 첫 `)`에서 매칭 종료 → 조건 잘림
- `maxAxes: 2` 기본값 과소 (`scan.usecase.ts` L765에서 `decisionSurfaceMaxAxes: 2`)
- L88-130: 파일 단위 axes 집계라 함수 단위 분석 불가

**수정**: maxAxes 기본값 상향. 중첩 괄호 대응 파서 사용. 함수 단위 집계 전환.

### 2.3 implementation-overhead — for 세미콜론 이중 카운트 + raw text regex

`src/features/implementation-overhead/analyzer.ts`:

- L139-145: `estimateImplementationComplexity` = `semicolons + ifs + fors` → for 헤더 세미콜론 이중 카운트
- L476: `fnRe` — raw text regex (단, `findMatchingParen` L147-207으로 본문 추출 시에는 정확)
- L519: `arrowRe` — `([^)]*)` 패턴으로 파라미터 캡처 → `findMatchingParen`을 사용하지 않아 중첩 괄호 FP

**수정**: for 세미콜론 제외. arrowRe에 findMatchingParen 활용. AST 기반 전환 검토.

---

## 3. FP_MEDIUM (5개)

### 3.1 waste — `_` prefix 미필터 + IIFE CFG 버그

`src/engine/waste-detector-oxc.ts` (761줄):

- `_` prefix 변수 skip 조건 없음 (L577-640에 해당 로직 부재 — 파일 전체 검색으로 확인)
- memory-retention: 변수 타입(primitive vs object) 구분 없이 모든 변수 대상
- IIFE 내부 변수 CFG 버그

**수정**: `_` prefix skip 조건 추가. primitive 타입 제외. IIFE scope 처리 수정.

### 3.2 exception-hygiene — try-finally return await FP

`src/features/exception-hygiene/analyzer.ts` (1023줄):

- L629-632: `hasCatch = isOxcNode(node.handler) && node.handler.type === 'CatchClause'` → catch 없는 try-finally는 `hasCatch=false`
- L631-643: `if (hasCatch) { functionTryCatchDepth++; }` → try-finally만 있으면 depth 증가 없음
- L651-660: `functionTryCatchDepth === 0` → try-finally 내 `return await`가 "불필요"로 보고
- **FP**: finally가 await 완료를 기다려야 하므로 제거하면 의미 변경

**수정**: `functionTryCatchDepth`를 try-finally도 포함하도록 수정.

### 3.3 implicit-state — scope-blind variable name matching + 항상 true 조건

`src/features/implicit-state/analyzer.ts` (185줄):

- L160-170: 패턴 4 (`module-scope let`): `file.sourceText.includes(name)` → 변수명이 `type`, `result` 등 일반적이면 scope 무시로 어디든 매칭
- **추가**: 변수 선언이 sourceText에서 추출되었으므로 `includes(name)`은 **항상 true** — 조건이 사실상 무의미

**수정**: AST 기반 변수 참조 추적으로 전환. 최소 2회 이상 참조를 조건으로 변경.

### 3.4 abstraction-fitness — dead code로 externalCoupling 완전 비활성

`src/features/abstraction-fitness/analyzer.ts` (177줄):

- L134: `if (rel.includes('/application/') && (rel.includes('/adapters/') || rel.includes('/infrastructure/')))` → **절대 true 불가** (하나의 경로에 `/application/`과 `/adapters/`가 동시 존재 불가)
- `externalCoupling`이 `../` import 수만 반영 → cross-layer 커플링 탐지 **완전 비활성화**

**수정**: dead code 조건 수정. `||`로 변경하거나 import 대상 경로 기준으로 판단.

### 3.5 noop — FP 2건 + normalizeFile 미사용

`src/features/noop/analyzer.ts` (200줄):

- 의도적 빈 body → FP 2건
- `normalizeFile` 미사용 — `file.filePath`가 그대로 finding의 `file` 필드에 전달 → 절대경로 노출, 다른 detector와 포맷 불일치

**수정**: 의도적 빈 body 패턴 skip 조건 추가. normalizeFile 적용.

---

## 4. FP_LOW (2개)

### 4.1 modification-trap — `User` 하드코딩

`src/features/modification-trap/analyzer.ts`:

- L98: `import\s+type\s+\{\s*User\s*\}` — `User` 타입만 하드코딩 체크. 다른 공유 타입(`Order`, `Config` 등) 무시 → 범용성 부재

**수정**: 하드코딩 제거. 임의의 공유 타입 import를 추적하도록 일반화.

### 4.2 barrel-policy — test 디렉토리 missing-index

test 디렉토리에서도 missing-index 포함 가능.

**수정**: test/spec 디렉토리 제외 옵션 추가.

---

## 5. 잠재 문제

### 5.1 invariant-blindspot — `before` signal 과도 일반적

`src/features/invariant-blindspot/analyzer.ts` L36:

```typescript
{ name: 'must-comment', re: /\/\/.*\b(must|always|never|before)\b/gi },
```

`must`/`always`/`never`는 합리적이나 `before`는 과도 일반적 → `// process items before returning` 등 일상 주석도 매칭.

**수정**: `before` signal 키워드 제거 또는 더 구체적 패턴으로 제한.

---

## 6. 공통 구조적 버그

### 6.1 `normalizeFile` 절대경로 버그 (12개 파일에 동일 함수 복사)

```typescript
const normalizeFile = (filePath: string): string => {
  const normalized = filePath.replaceAll('\\', '/');
  const idx = normalized.lastIndexOf('/src/');
  if (idx >= 0) return normalized.slice(idx + 1);
  return normalized; // ← /src/ 없으면 절대경로 반환
};
```

**영향받는 12개 feature analyzer**:
concept-scatter, variable-lifetime, abstraction-fitness, symmetry-breaking, implicit-state, giant-file, invariant-blindspot, modification-trap, decision-surface, modification-impact, temporal-coupling, implementation-overhead

루트 레벨 파일(`drizzle.config.ts`, `index.ts`, `oxlint-plugin.ts`, `scripts/build.ts` 등)에서 절대경로가 토크나이징·그루핑·정규화에 사용되어 FP 발생.

**수정**: 공유 유틸로 추출. `/src/` 없는 경로도 프로젝트 루트 기준 상대경로로 정규화.

### 6.2 Self-referential 패턴 (2개 detector)

- **temporal-coupling**: `includes('initialized')` + `includes('init(')` + `includes('query(')` 문자열이 analyzer 소스 자체에 포함
- **symmetry-breaking**: `includes('Controller')` 문자열이 analyzer의 regex 패턴에 포함

**수정**: §1.4, §1.5 참조.

### 6.3 Raw text regex의 scope 무시 (5개+ detector)

variable-lifetime, temporal-coupling, decision-surface, implementation-overhead, implicit-state 등에서 파일 전체 소스를 regex로 검색. 렉시컬 스코프·문자열 리터럴·주석을 구분하지 못함.

**수정**: 장기적으로 AST 기반 분석 전환. 단기적으로 주석·문자열 리터럴 strip 전처리.

---

# Part 2. 골든 테스트 품질 결함

## 7. 거짓 음성 — 양성 fixture가 빈 배열 (6건)

골든 테스트 자동 생성이 "현재 출력을 정답으로 고정"하므로, 감지 실패가 테스트 통과로 위장됨.

### 7.1 Feature 거짓 음성 (5건)

| Feature | Fixture | 의도된 패턴 | Expected | 근본 원인 |
|---------|---------|------------|----------|----------|
| **api-drift** | `async-drift.ts` | sync+async 함수 혼합 | `[]` | prefix 기반 그루핑에서 3개 미만 → 그룹 미생성 |
| **temporal-coupling** | `module-state.ts` | `let` + setter/getter 모듈 상태 | `[]` | 하드코딩 `includes('initialized')` 등에 미매칭 |
| **modification-impact** | `high-impact.dir/` (4파일) | shared 모듈에 3파일 의존 | `[]` | 가상 경로 import resolve 실패 |
| **structural-duplicates** | `similar-math.ts` | 유사 구조 함수 | `[]` | fixture가 minSize 임계값 미달 |
| **exact-duplicates** | `identical-loops.ts` | 동일 루프 | `[]` | fixture가 minSize 임계값 미달 |

**수정**: fixture를 분석기의 감지 조건에 맞게 재설계. 또는 분석기의 임계값/감지 로직 수정.

### 7.2 OxLint Plugin 거짓 음성 (1건)

| Rule | Fixture | Expected | 근본 원인 |
|------|---------|----------|----------|
| **no-dynamic-import** | `dynamic-import.ts` | `{ "reports": [] }` | `ImportExpression` visitor 미등록 또는 감지 로직 누락 |

**수정**: `create()` 메서드에서 `ImportExpression` visitor 등록 확인 및 수정.

---

## 8. 의미 불일치 — "no-findings" 이름인데 findings 존재 (4건)

| 대상 | 포함된 findings | 근본 원인 |
|------|----------------|----------|
| `abstraction-fitness/no-findings.json` | fitness=0 1건 | 분석기가 0점 fitness도 리포트 |
| `coupling/no-findings.json` | `COUPLING_OFF_MAIN_SEQ`, distance=1, score=100 1건 | 단일 파일 `export const x = 1`도 off-main-sequence 감지 |
| `barrel-policy/no-findings.json` | `missing-index` 1건 | index.ts 없으면 항상 리포트 |
| `no-inline-object-type/no-findings.json` | `inlineObjectType` 1건 | `type Opts = { name: string }`의 object literal 감지 |

**수정**: fixture 이름을 `baseline`으로 변경. 또는 fixture 내용을 진정한 no-findings가 되도록 변경.

---

## 9. 골든 테스트 미존재 (3개 feature)

| Feature | 현재 테스트 | 위험도 |
|---------|-----------|--------|
| **format** | `analysis.test.ts` 5개 케이스 존재. 골든 없음 | 중간 — 외부 도구(`oxfmt`) 의존 |
| **lint** | `analysis.test.ts` 5개 케이스 존재. 골든 없음 | 중간 — 외부 도구(`oxlint`) 의존 |
| **typecheck** | `report-integration.test.ts` 1개 존재. 골든 없음 | 높음 — AST 입력으로 골든화 가능 |

**수정**: 외부 바이너리 출력을 모킹한 fixture 기반 골든 테스트 추가. 진단 파싱 로직 분리 후 골든화.

---

## 10. 골든 케이스 깊이 부족

**현황**: 40개 골든 스위트 중 35개가 2개 이하 케이스. 평균 2.1개/feature, 2.0개/rule.

### 10.1 공통 누락 패턴

| 카테고리 | 누락 패턴 | 해당 feature 수 |
|----------|----------|----------------|
| **경계값** | 빈 파일, 주석만 있는 파일 | 25개 전부 |
| **임계값 경계** | threshold ±1 값 | threshold 사용 15개+ |
| **다중 발견** | 한 파일에서 2개+ finding 동시 발생 | 25개 전부 |
| **TypeScript 고급** | 제네릭, 데코레이터, enum, namespace, declare | AST 사용 feature 전부 |
| **JSX/TSX** | React 컴포넌트 구문 내 패턴 | 전부 |

### 10.2 Feature별 구체적 누락 케이스 (주요)

| Feature | 현재 | 누락 케이스 |
|---------|------|------------|
| noop | 2 | void 함수 반환, 조건부 noop, 삼항 noop |
| decision-surface | 2 | switch/case, 삼항 중첩, optional chaining 분기, 정확히 maxAxes개 축 |
| coupling | 2 | 순환 의존, 깊은 fan-out, 양방향 의존 |
| dependencies | 3 | self-import, type-only import, dynamic import, barrel chain |
| forwarding | 2 | async 래퍼, 제네릭 전달, rest parameter 전달 |
| nesting | 2 | while 중첩, try/catch 중첩, 정확히 threshold 깊이 |
| waste | 2 | unused 타입 export, 조건부 export, `_` prefix 변수 |
| early-return | 3 | 화살표 함수 가드, switch + early return |
| exception-hygiene | 2 | finally 블록 패턴, 중첩 try/catch, try-finally return await |
| variable-lifetime | 2 | 함수 매개변수 수명, 구조분해 변수, 정확히 maxLifetimeLines |
| exact-duplicates | 2 | 3개 이상 중복 블록, 다른 파일 간 중복 |
| structural-duplicates | 2 | 3개 이상 유사 함수, 파라미터 수만 다른 함수 |
| giant-file | 2 | 정확히 maxLines 줄, maxLines+1 줄 |
| abstraction-fitness | 2 | 3개 이상 모듈 상호 의존, 완전 독립 모듈 |

### 10.3 OxLint Rule별 구체적 누락 케이스 (주요)

| Rule | 현재 | 누락 케이스 |
|------|------|------------|
| no-tombstone | 2 | 여러 tombstone 연속, JSDoc 내 tombstone |
| no-double-assertion | 2 | `as unknown as X` + 제네릭, 중첩 3중 단언 |
| member-ordering | 2 | static vs instance, getter/setter 순서, abstract 멤버 |
| unused-imports | 2 | type-only import, 부분 사용 `{ used, unused }`, side-effect import |
| no-bracket-notation | 2 | Symbol 키, 숫자 리터럴 키, template literal 키, `?.[]` |
| no-umbrella-types | 2 | `any`/`object`/`{}` 파라미터, 반환 타입 위치, 제네릭 제약 |
| no-dynamic-import | 2 | 조건부 dynamic import, top-level await import |
| no-inline-object-type | 2 | 반환 타입 inline, 제네릭 인자 inline, intersection inline |

**수정**: 각 골든 스위트 최소 5케이스 정책 도입 (positive, negative, edge, corner, threshold boundary).

---

## 11. Branch coverage 미수집

`coverage/lcov.info`에 BRF/BRH 행이 **존재하지 않음** — 브랜치 커버리지 자체가 수집되지 않고 있음.

- 라인 커버리지: 84.66% (LF=19390/LH=16415)
- 브랜치 커버리지: **미수집**

**수정**: coverage 파이프라인에서 branch 수집 옵션 활성화. CI에 line + branch 임계치 게이팅 추가.

---

## 12. Autofix 검증 부족

OxLint 골든 러너가 `fixedSource`를 캡처하지만:
1. **Round-trip 미검증**: fix 적용 후 재분석 → finding=0 확인을 하지 않음
2. **멱등성 미검증**: fix 2회 적용 시 동일 결과 확인을 하지 않음

**해당 rule** (fix 있는 3개): blank-lines-between-statement-groups, padding-line-between-statements, unused-imports

**수정**: `oxlint-golden-runner.ts`에서 fixedSource 재파싱→재실행→reports=0 검증 추가. `applyFixes` 2회 실행 동일성 테스트 추가.

---

## 13. 순서 안정성 미검증

객체 키 정렬(`normalizeValue`의 `Object.keys().sort()`)은 있으나, 멀티파일 fixture traversal 순서(OS/파일시스템 의존)에 대한 명시 테스트 없음.

**수정**: 입력 순서 순열(permutation) 테스트 추가. 결과 출력 전 전역 안정 정렬(파일→라인→kind) 강제.

---

## 14. 단위 spec 매핑 결손

`*.ts` 파일 중 colocated `*.spec.ts`가 없는 파일이 다수 존재 (약 40개). TST-COVERAGE-MAP 규칙이 존재하지만 실제 적용이 불완전.

**수정**: "spec 제외 허용 목록" (types.ts, index.ts, barrel 등) 명시. 제외 외 파일은 spec 추가. 주기적 lint 감시.

---

# Part 3. 골든 테스트 인프라 사소한 문제 (14건)

| # | 문제 | 파일 | 심각도 |
|---|------|------|--------|
| 1 | `normalizeValue` 함수가 양쪽 러너에 **완전 동일하게 중복** | `golden-runner.ts` L57-76, `oxlint-golden-runner.ts` L359-379 | 낮음 |
| 2 | `readExpected`/`writeExpected` 함수도 양쪽 러너에 중복 | 두 러너 파일 | 낮음 |
| 3 | `GoldenRunOptions.virtualRoot` 파라미터 선언 후 `void opts`로 무시 | `golden-runner.ts` L39-43, L159 | 낮음 — dead parameter |
| 4 | `buildCommaTokens`가 콤마만 처리 — 세미콜론·괄호 등 다른 토큰 미지원 | `token-utils.ts` | 낮음 — `getTokenBefore`/`getTokenAfter` 정확도에 영향 |
| 5 | `ensureRangesDeep`에서 `parent` 키만 스킵 | `oxlint-golden-runner.ts` L93-131 | 낮음 — WeakSet으로 방어 중 |
| 6 | `readDirFixture`가 재귀 지원하지만 2단계+ 중첩 fixture 테스트 없음 | `golden-runner.ts` L97-113 | 매우 낮음 |
| 7 | `goldenSuite`/`goldenRuleSuite` export 되었으나 미사용 (dead export) | 두 러너 파일 | 매우 낮음 |
| 8 | Expected 파일에 trailing newline 포함 (`json + '\n'`) | 두 러너 | 매우 낮음 |
| 9 | `toGoldenJson`이 `undefined` 필드 자동 제거 — 의도적이나 문서화 없음 | 두 러너 | 매우 낮음 |
| 10 | fuzz seed가 `return 1`로 고정 — deterministic이지만 seed 다양성 없음 | `test-kit.ts` `getFuzzSeed` | 낮음 |
| 11 | `createPrng` xorshift32에서 seed=0 → 항상 0 반환 (무한 0 시퀀스) | `test-kit.ts` | 낮음 |
| 12 | `applyFixes` overlapping fix throw 경로를 커버하는 테스트 없음 | `rule-test-kit.ts` L157-162 | 낮음 |
| 13 | `buildGetDeclaredVariables`가 `ImportDeclaration`만 처리 — `VariableDeclaration` 등은 빈 배열 | `oxlint-golden-runner.ts` L241-243 | 중간 — 다른 rule에서 사용 시 문제 |
| 14 | `test-unit-file-mapping` 골든의 `fileExists` 콜백이 항상 `true`/`false` 상수 — 파일별 조건 분기 미테스트 | `golden.test.ts` | 낮음 |

---

# Part 4. FEATURE_REPORT.md 오류 및 누락

## 15. FEATURE_REPORT.md 오류 (5건)

| # | 항목 | FEATURE_REPORT 주장 | 실제 |
|---|------|---------------------|------|
| 1 | noop FN — target-discovery.ts L99 | `catch { ... }`를 empty-catch FN으로 분류 | body에 `continue` 있음 → 정상 skip |
| 2 | normalizeFile 영향 범위 | "5개 이상 feature 공통" | 실제 **12개** feature analyzer에 복사 |
| 3 | decision-surface 멀티라인 | "`[^)]*`가 newline 비매칭" | `[^)]*`는 negated char class로 `\n` 포함 매칭. 중첩 괄호 문제는 별개 |
| 4 | invariant-blindspot | "53건 전수 정확" | `before` signal 잠재 FP 미평가 |
| 5 | 정량 수치 | 25개 detector Finding 수 | 19개 detector에서 scan-full.json 재집계와 불일치. 재현 메타데이터 부재 |

## 16. FEATURE_REPORT.md 누락 문제 (8건)

| # | 대상 | 누락된 문제 |
|---|------|-----------|
| 1 | modification-trap | `import type { User }` 하드코딩 — 범용성 부재 |
| 2 | implicit-state | scope-blind variable name matching (패턴 4, `includes(name)` 항상 true) |
| 3 | noop | normalizeFile 미사용 → file 필드 포맷 불일치 |
| 4 | abstraction-fitness | dead code(L134)가 externalCoupling 완전 무력화 |
| 5 | early-return | score=0 함수도 보고됨 |
| 6 | api-drift | tsgo interface 기반 검증 경로 미분석, silent failure |
| 7 | 전체 | 재현성 메타데이터 부재 (scan 명령, 옵션, commit SHA, 대상 경로) |
| 8 | 전체 | count 기준 혼재 위험 (entry 수 vs items 합, 집계 기준 미명시) |

---

# Part 5. 우선순위 조치 권고

## P0 — 즉시 수정

| # | 조치 |
|---|------|
| 1 | `normalizeFile` 공유 유틸로 추출 — 12개 파일의 동일 함수 복사 제거 + `/src/` 없는 경로 상대경로 정규화 |
| 2 | temporal-coupling / symmetry-breaking self-referential 버그 수정 — `includes()` → AST 기반 전환 |
| 3 | 거짓 음성 5개 feature fixture 재설계 (api-drift, temporal-coupling, modification-impact, structural-duplicates, exact-duplicates) |
| 4 | no-dynamic-import 규칙 수정 또는 fixture 수정 |

## P1 — 단기 (1~2주)

| # | 조치 |
|---|------|
| 5 | waste `_` prefix skip 조건 추가 |
| 6 | exception-hygiene `functionTryCatchDepth`를 try-finally도 포함 |
| 7 | abstraction-fitness L134 dead code 조건 수정 |
| 8 | early-return score=0 skip 조건 추가 |
| 9 | format/lint/typecheck 골든 테스트 추가 (골든 커버리지 89% → 100%) |
| 10 | 의미 불일치 4개 fixture 이름/내용 수정 |
| 11 | branch coverage 수집 활성화 + CI 임계치 게이팅 |

## P2 — 중기

| # | 조치 |
|---|------|
| 12 | concept-scatter를 AST identifier 기반으로 전환 |
| 13 | variable-lifetime을 AST reference tracking 기반으로 전환 |
| 14 | modification-trap `User` 하드코딩 일반화 |
| 15 | implicit-state `includes(name)` → AST 참조 추적 전환 |
| 16 | 각 골든 스위트 최소 5케이스 정책 도입 |
| 17 | 임계값 경계 테스트 체계화 (threshold ±1) |
| 18 | Autofix round-trip + 멱등성 검증 추가 |
| 19 | 순서 안정성 테스트 추가 |
| 20 | spec 매핑 결손 정리 (TST-COVERAGE-MAP 강제) |

## P3 — 장기

| # | 조치 |
|---|------|
| 21 | TypeScript 고급 구문 fixture 추가 (제네릭, 데코레이터, enum, namespace) |
| 22 | Cross-feature 통합 테스트 (하나의 파일에서 여러 feature 동시 분석) |
| 23 | Mutation testing 도입 (분석기 코드 변이 시 골든 테스트가 잡아내는지 확인) |
| 24 | 골든 테스트 러너 유틸 중복 제거 (normalizeValue, readExpected, writeExpected 공유) |
| 25 | FEATURE_REPORT.md 상단에 재현 메타데이터 블록 추가 |
