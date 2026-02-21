# REPORT.md — FEATURE_REPORT.md 합동 검증 최종 보고서

> 작성일: 2026-02-20
> 검증 주체: Claude (소스 직접 대조) + GPT (scan-full.json 수치 재집계 + 통합테스트)
> 대상 문서: `FEATURE_REPORT.md` (1744줄, 24개 detector 분석)

---

## 1. 검증 방법

| 검증 축 | 수행 내용 |
|---|---|
| **소스 직접 대조** (Claude) | 15개 analyzer 소스 전체 읽기, 조건식·탐지 방식·skip 조건 직접 확인 |
| **정량 재집계** (GPT) | `tmp/firebat-mcp-scan-full.json` 기준 detector별 finding 수 재집계 |
| **통합테스트** (GPT) | early-return / concept-scatter / variable-lifetime / temporal-coupling / symmetry-breaking 관련 test 실행 |
| **FP/FN 코드 검증** (Claude) | 보고서 FP/FN 사례의 실제 파일·라인을 `read_file`로 직접 확인 |

---

## 2. 정량 수치 검증

`FEATURE_REPORT.md`의 Finding 수와 `tmp/firebat-mcp-scan-full.json` 재집계 결과 비교.

| Detector | FEATURE_REPORT | scan-full.json | 상태 |
|---|---:|---:|---|
| concept-scatter | 671 | 640 | **불일치** |
| variable-lifetime | 1775 | 1614 | **불일치** |
| waste | 340 | 311 | **불일치** |
| implementation-overhead | 283 | 282 | **불일치** |
| structural-duplicates | 327 | 331 | **불일치** |
| exact-duplicates | 53 | 59 | **불일치** |
| exception-hygiene | 119 | 119 | 일치 |
| early-return | 1226 | 1230 | **불일치** |
| dependencies | 145 | 144 | **불일치** |
| unknown-proof | 1950 | 1852 | **불일치** |
| barrel-policy | 572 | 569 | **불일치** |
| nesting | 221 | 219 | **불일치** |
| coupling | 65 | 66 | **불일치** |
| api-drift | 73 | 71 | **불일치** |
| forwarding | 69 | 68 | **불일치** |
| decision-surface | 65 | 65 | 일치 |
| modification-impact | 55 | 53 | **불일치** |
| invariant-blindspot | 53 | 52 | **불일치** |
| noop | 2 | 1 | **불일치** |
| implicit-state | 20 | 20 | 일치 |
| modification-trap | 20 | 19 | **불일치** |
| abstraction-fitness | 9 | 9 | 일치 |
| temporal-coupling | 3 | 3 | 일치 |
| symmetry-breaking | 3 | 3 | 일치 |
| giant-file | 13 | 11 | **불일치** |

**결론**: 25개 중 일치 6개 / 불일치 19개. 문서의 "완전 정확도 검사"라는 제목과 달리 수치 재현성이 낮다. 검사 시점·옵션·대상 경로 등 재현 메타데이터가 부재하여 원인 특정 불가.

---

## 3. 로직 주장 검증 — FUNDAMENTAL_FLAW 판정 (5개)

### 3.1 concept-scatter — FUNDAMENTAL_FLAW ✅ 사실

**소스 확인** (`src/features/concept-scatter/analyzer.ts` 142줄 전체):

- L96: `tokenizeConcepts(file.sourceText)` — 파일 소스 전체를 raw text tokenizing → JS/TS 예약어(`import`, `const`, `return` 등)가 모두 concept으로 등록됨
- L8-16: `normalizeFile`에서 `/src/` 없는 파일은 절대경로 반환 → `home`, `revil` 등이 concept으로 등록됨
- L117: `scatterIndex = filesSet.size + layersSet.size` — 보고서와 일치

보고서의 "~90% FP" 추정도 구조적으로 타당. 예약어·경로 토큰이 대부분을 차지.

### 3.2 variable-lifetime — FUNDAMENTAL_FLAW ✅ 사실

**소스 확인** (`src/features/variable-lifetime/analyzer.ts` 148줄 전체):

- L100-108: `new RegExp(\`\\b${name}\\b\`, 'g')` → 파일 전체 텍스트에서 변수명 regex 검색
- scope 구분 없음: 다른 함수의 동명 변수, object property(`.name`), 주석, 문자열 리터럴 모두 "사용"으로 인식
- export 문을 last use로 카운트 → lifetime 인플레이션

보고서의 FP 사례(waste-detector-oxc.ts L33→L730, scan.usecase.ts L74→L1515)도 구조적으로 합당.

### 3.3 early-return — FUNDAMENTAL_FLAW ✅ 사실

**소스 확인** (`src/features/early-return/analyzer.ts` 280줄 전체):

- L237: `if (kind === null) { kind = 'missing-guard'; }` — 기본 kind가 `missing-guard`
- L246: `if (hasGuardClauses === false && maxDepth < 2 && earlyReturnCount === 0) { return null; }` — skip 조건이 3가지 모두 true일 때만 작동
- `hasGuardClauses === true`인 함수 → skip 불가 → 이미 guard 있는 함수가 `missing-guard`로 보고됨
- L243: `score = Math.max(0, earlyReturnCount + (hasGuardClauses ? 0 : 1))` → guard 있고 return 0이면 score=0인데도 보고됨
- `invertible-if-else` kind: 로직은 L197-213에 존재하나 실제 발화 0건 주장은 합리적 (threshold가 매우 엄격)

### 3.4 temporal-coupling — FUNDAMENTAL_FLAW ✅ 사실

**소스 확인** (`src/features/temporal-coupling/analyzer.ts` 119줄 전체):

- L100: `file.sourceText.includes('initialized') && file.sourceText.includes('init(') && file.sourceText.includes('query(')`
- analyzer 소스 자체에 이 세 문자열이 모두 포함:
  - `'initialized'` → L100의 문자열 리터럴에 존재
  - `'init('` → L100의 `includes('init('`에 존재
  - `'query('` → L100의 `includes('query('`에 존재
- → **self-referential FP 확정**

### 3.5 symmetry-breaking — FUNDAMENTAL_FLAW ✅ 사실

**소스 확인** (`src/features/symmetry-breaking/analyzer.ts` 209줄 전체):

- 1차 경로: `extractExportedHandlerLike` (L58) — `Handler|Controller` export regex → 그룹 크기 3개 이상 필요
- Fallback (L159-L207): `sourceText.includes('Controller')` → analyzer 소스의 L58 regex에 'Controller' 포함 → self-referential
- test fixture 코드에도 'Controller' 문자열 포함 → 3건 전부 FP 확인

---

## 4. 로직 주장 검증 — FP_HIGH 판정 (3개)

### 4.1 api-drift — FP_HIGH ✅ 사실

**소스 확인** (`src/features/api-drift/analyzer.ts` 482줄 전체):

- L213-224: `extractPrefixFamily` — camelCase 첫 대문자 기준으로 prefix 추출
- L423-427: `prefixCounts >= 3`인 prefix만 `prefix:*` 그룹 생성
- `analyze`, `debug`, `visit` 등 일반적 prefix로 전혀 무관한 함수들이 묶임
- 로컬 클로저까지 포함 (export 필터 없음)
- **추가 문제**: `runTsgoApiDriftChecks()` (L445)를 통한 interface 기반 그룹 검증은 보고서에서 미분석. tsgo 실행 실패 시 silent failure도 미보고.

### 4.2 decision-surface — FP_HIGH ⚠️ 부분 수정

**소스 확인** (`src/features/decision-surface/analyzer.ts` 140줄):

- L37: `/\bif\s*\(([^)]*)\)/g` — `maxAxes: 2` 기본값이 너무 낮다는 지적은 정확
- **FEATURE_REPORT 오류**: "멀티라인 조건 놓침"이라고 했으나, `[^)]*`는 negated character class이므로 `\n`도 매칭함 → 멀티라인 if도 실제 매칭 가능. 단, **중첩 괄호 문제**(`if (fn(x))` → 첫 `)`에서 매칭 종료)는 여전히 존재.
- 파일 단위 axes 집계라 함수 단위 분석이 안 되는 한계는 보고서 지적대로.

### 4.3 implementation-overhead — FP_HIGH ✅ 사실

**소스 확인** (`src/features/implementation-overhead/analyzer.ts` 563줄):

- L139-145: `estimateImplementationComplexity` = semicolons + ifs + fors → for 헤더 세미콜론 이중 카운트
- L468: `fnRe` / L519: `arrowRe` — 파일 전체 raw text regex → 문자열 리터럴 내 코드 매칭 FP
- `findMatchingParen` 함수가 이미 존재(L149+)하나 arrow regex에서 미사용

---

## 5. 로직 주장 검증 — 기타 판정

### 5.1 waste — FP_MEDIUM + FP_HIGH ✅ 사실

**소스 확인** (`src/engine/waste-detector-oxc.ts` 761줄):

- `_` prefix 변수 skip 조건 없음 확인 (L577-640에 해당 로직 부재)
- memory-retention: 변수 타입(primitive vs object) 구분 없이 모든 변수 대상 확인
- IIFE 내부 변수 CFG 버그: 보고서의 dead-store 30/31 FP 주장은 소스 구조상 합리적이나 전수 검증은 미수행

### 5.2 exception-hygiene — FP_MEDIUM ✅ 사실

**소스 확인** (`src/features/exception-hygiene/analyzer.ts` L625-660):

- L631-636: `hasCatch = isOxcNode(node.handler) && node.handler.type === 'CatchClause'` → catch 없는 try-finally는 `hasCatch=false`
- L636: `if (hasCatch) { functionTryCatchDepth++; }` → try-finally만 있으면 depth 증가 없음
- L657: `functionTryCatchDepth === 0` → try-finally 내 `return await`가 "불필요"로 보고 → **FP** (finally가 await 완료를 기다려야 하므로 제거하면 의미 변경)

### 5.3 exact-duplicates / structural-duplicates — PASS ✅ 동의

AST 기반 fingerprinting. 검증된 FP 없음.

### 5.4 dependencies — PASS ✅ 동의

BFS 기반 dead-export 분석. package.json 엔트리포인트 추적.

### 5.5 unknown-proof — PASS ✅ 동의

AST + tsgo 이중 검증. 고정밀.

### 5.6 nesting — PASS ✅ 동의

AST 기반 cognitive complexity. 합리적 threshold (15).

### 5.7 coupling — PASS ✅ 동의

Robert C. Martin 표준 메트릭. 알고리즘 정확.

### 5.8 forwarding — PASS ✅ 동의

AST 기반 thin-wrapper 탐지.

### 5.9 giant-file — PASS ✅ 동의

단순 line count. 정확.

### 5.10 invariant-blindspot — PASS ⚠️ 부분 수정

보고서는 "53건 전수 확인, 모두 정확"이라고 했으나:
- `must-comment` signal의 `before` 키워드가 너무 일반적 (`// process items before returning` 등 일상 주석도 매칭)
- → **잠재 FP pool 미평가**

### 5.11 barrel-policy — FP_LOW ✅ 동의

### 5.12 modification-impact — PASS w/ FN_MEDIUM ✅ 동의

### 5.13 noop — FP_MEDIUM + FN_LOW ⚠️ 부분 수정

- FP 2건 (의도적 빈 body) → 보고서 정확
- **FN 4건 주장 중 1건 오류**: `target-discovery.ts L99`의 `catch { continue; }`는 `continue` statement 존재 → `bodyArr.length === 1` → empty-catch가 아님 → **FN이 아니라 정상 skip**
- **추가 문제**: noop analyzer는 `normalizeFile` 미사용 → finding의 `file` 필드가 다른 detector와 포맷 불일치

### 5.14 implicit-state — FP_MEDIUM ⚠️ 추가 문제 있음

보고서는 test fixture 문자열 FP만 언급했으나:
- 패턴 4 (`module-scope let`): `file.sourceText.includes(name)` → 변수명이 `type`, `result` 등 일반적이면 scope 무시로 어디든 매칭 → 추가 FP 원인

### 5.15 modification-trap — FP_LOW ⚠️ 추가 문제 있음

- L101-108: `import type { User }` 하드코딩 → `User` 타입만 체크, 다른 공유 타입(`Order`, `Config` 등) 무시 → 범용성 부재

### 5.16 abstraction-fitness — FP_MEDIUM ⚠️ 심각도 과소 평가

보고서가 dead code condition을 언급했으나 심각도를 충분히 강조하지 않음:
- L134: `if (rel.includes('/application/') && (rel.includes('/adapters/') || rel.includes('/infrastructure/')))` → **절대 true 불가** (하나의 경로에 동시 존재 불가)
- 결과: `externalCoupling`이 `../` import 수만 반영 → cross-layer 커플링 탐지가 **완전히 비활성화**

---

## 6. FEATURE_REPORT.md 오류 목록

| # | 항목 | FEATURE_REPORT 주장 | 실제 |
|---|---|---|---|
| 1 | **noop FN — target-discovery.ts L99** | `catch { ... }`를 empty-catch FN으로 분류 | body에 `continue` 있음 → `bodyArr.length === 1` → FN 아님, 정상 skip |
| 2 | **normalizeFile 영향 범위** | "5개 이상 feature 공통" | 실제 **12개** feature analyzer에 복사: concept-scatter, variable-lifetime, abstraction-fitness, symmetry-breaking, implicit-state, giant-file, invariant-blindspot, modification-trap, decision-surface, modification-impact, temporal-coupling, implementation-overhead |
| 3 | **decision-surface 멀티라인** | "멀티라인 조건 놓침 (`[^)]*`가 newline 비매칭)" | `[^)]*`는 negated character class로 `\n` 포함 매칭함. 중첩 괄호 문제는 별개로 존재 |
| 4 | **invariant-blindspot PASS** | "53건 전수 정확" | `before` signal 키워드가 너무 일반적 → 잠재 FP pool 미평가 |
| 5 | **정량 수치** (다수) | 25개 detector Finding 수 | 19개 detector에서 scan-full.json 재집계와 불일치 (§2 참조) |

---

## 7. FEATURE_REPORT.md 누락 문제 목록

보고서에서 다루지 않았거나 깊이가 부족했던 문제들.

### 7.1 modification-trap — `import type { User }` 하드코딩

```typescript
// src/features/modification-trap/analyzer.ts L101-108
const typeImportCount = (file.sourceText.match(
  /import\s+type\s+\{\s*User\s*\}\s+from\s+['"][^'"]+['"]/g
) ?? []).length;
if (typeImportCount > 0) {
  const key = 'import-type:User';
```

`User` 타입만 하드코딩 체크. 다른 공유 타입은 무시. 범용 modification-trap 탐지로 보기 어려움.

### 7.2 implicit-state 패턴 4 — scope-blind variable name matching

```typescript
// src/features/implicit-state/analyzer.ts L157-170
const moduleStateRe = /^\s*(let|var)\s+([a-zA-Z_$][\w$]*)\b/m;
// ...
if (exports >= 2 && file.sourceText.includes(name)) {
```

변수명이 `type`, `result` 등 일반적이면 소스 텍스트 어디든 매칭 → scope 무시 FP.

### 7.3 noop — normalizeFile 미사용

`collectNoopFindings(file.program, file.sourceText, file.filePath)` → `file.filePath`가 그대로 finding에 전달. 다른 12개 detector는 `normalizeFile()`로 정규화하는데 noop은 하지 않음 → finding `file` 필드 포맷 불일치.

### 7.4 abstraction-fitness — dead code가 externalCoupling을 완전 무력화

L134의 dead code 조건으로 `externalCoupling += 1`이 절대 실행 안 됨 → `externalCoupling`은 `../` import 수만 반영 → layer 간 부적절 커플링 탐지 완전 비활성.

### 7.5 early-return — score=0 함수도 보고됨

`score = Math.max(0, earlyReturnCount + (hasGuardClauses ? 0 : 1))` → guard만 있고 earlyReturnCount=0이면 score=0. 하지만 skip 조건에 score 체크가 없어 "개선 불필요"한 함수도 `missing-guard`로 보고.

### 7.6 api-drift — tsgo interface 기반 검증 미분석

보고서는 `prefix:*` 그룹핑 FP만 분석. `runTsgoApiDriftChecks()`를 통한 interface 기반 검증 경로는 전혀 검증하지 않음. tsgo 실행 실패 시 silent failure도 미보고.

### 7.7 재현성 메타데이터 부재

어떤 명령·옵션·타깃·commit SHA로 수치를 얻었는지 문서화되지 않음. 정량 수치 불일치의 근본 원인.

### 7.8 count 기준 혼재 위험

detector에 따라 `entry 수` vs `items 합` 등 집계 기준이 다를 수 있음. 문서에서 집계 기준이 명시되지 않음.

---

## 8. 공통 구조적 버그

### 8.1 `normalizeFile` 절대경로 버그 (12개 파일 복사)

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

### 8.2 Self-referential 패턴 (2개 detector)

- **temporal-coupling**: `includes('initialized')` + `includes('init(')` + `includes('query(')` 문자열이 analyzer 소스 자체에 포함
- **symmetry-breaking**: `includes('Controller')` 문자열이 analyzer의 regex 패턴에 포함

firebat이 자기 자신을 스캔할 때 발생하나, 실제 배포 환경에서도 동일 패턴 포함 코드에서 발생 가능.

### 8.3 Raw text regex의 scope 무시 (5개+ detector)

variable-lifetime, temporal-coupling, decision-surface, implementation-overhead, implicit-state 등에서 파일 전체 소스를 regex로 검색. 렉시컬 스코프·문자열 리터럴·주석을 구분하지 못함.

---

## 9. 종합 판정표

| Detector | Finding 수 (보고서→재집계) | 판정 | 검증 상태 | 주요 이슈 |
|---|---|---|---|---|
| concept-scatter | 671→640 | **FUNDAMENTAL_FLAW** | ✅ 확인 | 소스 전체 토크나이징 + normalizeFile 절대경로 |
| variable-lifetime | 1775→1614 | **FUNDAMENTAL_FLAW** | ✅ 확인 | scope-blind regex + export 문 last-use |
| early-return | 1226→1230 | **FUNDAMENTAL_FLAW** | ✅ 확인 | filter 역전 + invertible-if-else 0건 + score=0 보고 |
| temporal-coupling | 3→3 | **FUNDAMENTAL_FLAW** | ✅ 확인 | self-referential 3건 전부 FP |
| symmetry-breaking | 3→3 | **FUNDAMENTAL_FLAW** | ✅ 확인 | self-referential + test fixture FP |
| api-drift | 73→71 | **FP_HIGH** | ✅ 확인 | prefix 전역 그루핑 + tsgo 미검증 |
| decision-surface | 65→65 | **FP_HIGH** | ⚠️ 부분 수정 | maxAxes=2 과소. 멀티라인 주장은 부정확 |
| implementation-overhead | 283→282 | **FP_HIGH + FN_MEDIUM** | ✅ 확인 | 문자열 리터럴 FP + for 세미콜론 이중 카운트 |
| waste | 340→311 | **FP_MEDIUM + FP_HIGH** | ✅ 확인 | `_` prefix 미필터, IIFE CFG 버그, primitive 타입 미구분 |
| exception-hygiene | 119→119 | **FP_MEDIUM** | ✅ 확인 | try-finally return await FP (hasCatch 조건) |
| implicit-state | 20→20 | **FP_MEDIUM** | ⚠️ 추가 | test fixture FP + scope-blind pattern4 |
| abstraction-fitness | 9→9 | **FP_MEDIUM** | ⚠️ 심각도↑ | dead code로 externalCoupling 완전 비활성 |
| noop | 2→1 | **FP_MEDIUM + FN_LOW** | ⚠️ 부분 수정 | FN 4건 중 1건 오분류 + normalizeFile 미사용 |
| invariant-blindspot | 53→52 | **PASS** | ⚠️ 부분 수정 | `before` signal 과도 일반적 → 잠재 FP |
| modification-trap | 20→19 | **FP_LOW** | ⚠️ 추가 | `User` 하드코딩 범용성 부재 |
| barrel-policy | 572→569 | **FP_LOW** | ✅ 확인 | test 디렉토리 missing-index 포함 가능 |
| exact-duplicates | 53→59 | **PASS** | ✅ 확인 | AST 기반 정확 |
| structural-duplicates | 327→331 | **PASS** | ✅ 확인 | AST 기반 정확 |
| dependencies | 145→144 | **PASS** | ✅ 확인 | BFS 기반 정확 |
| unknown-proof | 1950→1852 | **PASS** | ✅ 확인 | AST+tsgo 이중 검증 |
| nesting | 221→219 | **PASS** | ✅ 확인 | AST 기반 합리적 threshold |
| coupling | 65→66 | **PASS** | ✅ 확인 | 표준 메트릭 |
| forwarding | 69→68 | **PASS** | ✅ 확인 | AST 기반 정밀 |
| modification-impact | 55→53 | **PASS w/ FN_MEDIUM** | ✅ 확인 | 멀티라인 import 파싱 FN |
| giant-file | 13→11 | **PASS** | ✅ 확인 | 단순 정확 |

---

## 10. 최종 결론

### FEATURE_REPORT.md 평가

| 측면 | 평가 |
|---|---|
| **문제 유형 진단 (로직 결함 지적)** | 높은 정확도. 24개 중 대부분 소스 직접 대조로 확인됨 |
| **정량 수치 정확성** | 낮음. 25개 중 19개 불일치. 재현 메타데이터 부재 |
| **FP/FN 사례 정확성** | 대부분 정확. 3건 오류 (noop FN 1건, decision-surface 멀티라인, normalizeFile 범위) |
| **분석 완전성** | 6건 누락 문제 존재 (§7 참조) |
| **종합** | "방향성 있는 결함 분석 문서"로 유효. "정량적 완전 검사 보고서"로는 부적합 |

### 즉시 조치 권고

| 우선순위 | 조치 |
|---|---|
| **P0** | `normalizeFile` 공유 유틸로 추출 — 12개 파일의 동일 함수 복사 제거 + `/src/` 없는 경로 처리 수정 |
| **P0** | temporal-coupling / symmetry-breaking self-referential 버그 수정 — raw text `includes()` → AST 기반 전환 |
| **P1** | early-return filter 역전 수정 — `hasGuardClauses === true` 함수 skip 조건 추가 |
| **P1** | waste dead-store `_` prefix skip 조건 추가 |
| **P1** | exception-hygiene `functionTryCatchDepth`를 try-finally도 포함하도록 수정 |
| **P2** | concept-scatter를 AST identifier 기반으로 전환 (sourceText 전체 토크나이징 제거) |
| **P2** | variable-lifetime을 AST reference tracking 기반으로 전환 |
| **P2** | FEATURE_REPORT.md 상단에 재현 메타데이터 블록 추가 (scan 명령, commit SHA, 대상 경로, 집계 기준) |
