# ERROR_FLOW_PLAN.md

`exception-hygiene` → **`error-flow`** 리네이밍 및 기능 재구성 계획.

에러 발생 → 전파 → 처리 흐름 전체를 커버하는 통합 디텍터.

---

## 1. 폐기 (3개)

| 룰 | 사유 |
|---|---|
| `overscoped-try` | 임의 기준(statement 10개). 정확 진단 불가 — "몇 개가 과도한지" 결정적 기준 없음 |
| `silent-catch` | catch 의도(fallback, 로깅, 무시) 판별 불가. 코드만으로 정확 진단 불가 |
| `exception-control-flow` | 어떤 함수가 "예외를 제어 흐름으로 쓰는지" 판별 불가. 허용 목록이 끝없이 늘어남 |

---

## 2. 최종 룰 구성 (8개)

### 2-1. `useless-catch` — 유지 + 합침

불필요한 catch 구조 감지. 구문적 사실 기반, 오탐 없음.

**하위 체크:**
| 체크 | 감지 패턴 | 근거 |
|------|----------|------|
| dead catch | `catch(e) { throw e; }` | dead code. AST 패턴 매칭 |
| nested try/catch | try 블록 내부에 try/catch 중첩 | SonarQube S1141 선례. 가독성 저하, 에러 흐름 복잡화 |

**합침 대상:** `redundant-nested-catch` kind → `useless-catch`에 흡수, 기존 kind 삭제.

**nested try/catch 허용 케이스:**
- try/finally 내부 (catch 없는 구조)
- 클린업 에러 독립 처리: `try { resource.use() } catch { try { resource.close() } catch { } throw e; }`
- 그 외 → 금지

**`isSilent` 판정 로직:** 제거.

---

### 2-2. `throw-non-error` — 유지

비-Error throw 감지. AST 타입 확인 기반.

- `throw "string"`, `throw 123` → 감지
- `throw new Error(...)` → 통과
- `throw createError(...)` (CallExpression) → 통과 (프레임워크 유틸)

**oxlint 중복 처리:** `typescript/only-throw-error`를 off로 변경. error-flow에서 통합 리포팅.

---

### 2-3. `unsafe-finally` — 수정

finally 블록 내 제어 흐름 탈출 감지.

**하위 체크:**
| 체크 | 감지 패턴 |
|------|----------|
| return in finally | `finally { return x; }` |
| throw in finally | `finally { throw e; }` |
| break in finally | labeled: 무조건 unsafe. unlabeled: finally 내 직계 루프 있으면 허용 |
| continue in finally | 위와 동일 기준 |
| `.finally()` return | `promise.finally(() => { return x; })` |

**break/continue 감지 구현:** 기존 `containsReturnOrThrowStatement` 헬퍼를 확장. finally 블록 AST 순회 시 BreakStatement/ContinueStatement 노드를 수집하되, 함수 경계(`FunctionExpression`, `ArrowFunctionExpression`)는 넘지 않음. unlabeled break/continue는 직계 부모 체인에 `ForStatement`/`WhileStatement`/`DoWhileStatement`/`SwitchStatement`가 finally 블록 안에 있으면 허용.

**합침 대상:** `return-in-finally` kind → `unsafe-finally`에 흡수, 기존 kind 삭제. 메시지에서 return/throw/break/continue 구분.

---

### 2-4. `missing-error-cause` — 수정

catch 내 재throw 시 cause 미보존 감지. ES2022 Error cause chaining 기반.

**하위 체크:**
| 체크 | 감지 패턴 | 비고 |
|------|----------|------|
| cause 미보존 | `catch(e) { throw new Error(msg); }` — `{ cause: e }` 없음 | ESLint `preserve-caught-error` 수준 |
| 바이브 패턴 | `catch(e) { throw new Error(String(e)); }` — catch param이 `message` 위치에만 사용 | R-06. firebat 고유 기여 |
| optional catch binding | `catch { throw new Error('fail'); }` — catch param 자체 없음 | GAP-15 |
| catch param 재할당 | `catch(e) { e = new Error(); throw e; }` — 원본 파기 | GAP-6 |
| AggregateError | `throw new AggregateError(errors, msg)` — cause 없음 | `isErrorConstructor`에 추가 |

**합침 대상:** `catch-transform-hygiene` kind → `missing-error-cause`에 흡수, 기존 kind 삭제.

**gildash 활용 (커스텀 에러 클래스):**
- gildash 사용 가능 시: `getHeritageChain(className, filePath)`으로 throw 대상의 상속 체인을 확인하여 Error 상속 검증. `getHeritageChain`은 async이므로 analyzer가 async로 전환됨.
- gildash 미사용 시: `*Error` 이름 패턴 + Error 생성자 직접 상속만 감지
- **확인 완료:** `@zipbul/gildash`에 `getImplementations(symbolName, filePath, project?)` API 존재 확인됨 (`node_modules/@zipbul/gildash/dist/index.d.ts:82`). 단, 커스텀 에러 상속 검증에는 `getHeritageChain`이 더 적합.

**analyzer 시그니처 변경:**
- `analyzeExceptionHygiene(files)` → `analyzeErrorFlow(files, options?: { gildash? })`
- `getHeritageChain`이 async이므로 analyzer도 async로 전환. `scan.usecase.ts`에서 await 호출.
- `scan.usecase.ts`의 `needsSemantic` 조건에 `error-flow` 추가
- `scan.usecase.ts`의 `kindToCode` 맵에 신규 kind → 카탈로그 코드 매핑 추가
- `unknown-proof`와 동일한 `PartialResultError` 패턴 적용

---

### 2-5. `promise-constructor-hygiene` — 수정 (리네이밍)

기존 `async-promise-executor`를 확장. Promise 생성자 위생 전반 감지.

**하위 체크:**
| 체크 | 감지 패턴 | 비고 |
|------|----------|------|
| async executor | `new Promise(async (resolve) => { ... })` | 기존 구현 유지 |
| executor 내 throw | sync executor에서 `throw` 사용 (reject 미호출) | R-04 케이스 2. AST 감지 |
| executor return value | `new Promise(resolve => { return val; })` | GAP-1. resolve 미호출 |
| param 순서 반전 | `new Promise((reject, resolve) => ...)` | GAP-2. Promise 스펙상 첫 번째가 resolve |
| 불필요 new Promise | async 함수 내 `new Promise(...)` | GAP-14 |

**scope out:** executor 인자가 변수로 전달되는 경우 (`const fn = () => {}; new Promise(fn)`) — 감지 불가, 명시적 scope out.
**scope out:** resolve/reject 누락 경로 (R-04 케이스 3) — CFG 기반, 구현 비용 대비 가치 낮음.

**불필요 new Promise (GAP-14) 허용 케이스:**
- executor 내에서 이벤트 리스너/콜백 API를 래핑하는 경우 (executor body에 `addEventListener`, `on`, `once`, `subscribe` 호출 포함)
- 위 허용 케이스 외 → 감지
- **검증 필요:** 허용 케이스 완전성. 구현 후 테스트로 확인.

---

### 2-6. `return-await-in-try` — 스펙 재정의 (리네이밍)

기존 `return-await-policy` 폐기 철회. 스펙을 완전히 재정의 — **기존 로직 전면 교체**.

**기존 로직 (폐기):** `functionTryCatchDepth === 0` (try 밖)에서 불필요한 `return await` 감지 → 삭제.
**신규 로직:** try 블록 내 `return <promise>` (await 없음) 감지 — 정반대 방향.

**감지 패턴:**
```ts
try {
  return promise; // 감지 — await 없으면 catch가 rejection을 못 잡음
} catch (e) { ... }
```

**근거:** typescript-eslint `return-await` (in-try-catch 옵션). 정확성 문제 — catch가 rejection을 포착하려면 await 필수.

**scope:** try 블록 내 `return <promise>` 한정. try 밖은 scope out.
**구현 참고:** 기존 `functionTryCatchDepth` 변수는 재활용 가능하나 조건 반전 필요. 단순 수정이 아닌 로직 전면 재작성.

---

### 2-7. `prefer-dot-catch` — 신규

`.catch()` 우선 패턴 권장. 구현은 별도 kind 유지, 카탈로그 코드명으로 그룹 표현 (`EF_PREFER_DOT_CATCH_*`).

**하위 체크:**
| 체크 | 감지 패턴 |
|------|----------|
| prefer-catch | `.then(success, failure)` — 2번째 인자 사용 |
| prefer-await-to-then | 긴 `.then()` 체인 → async/await 권장 |
| no-return-wrap | `.then(() => Promise.resolve(x))` — 불필요한 래핑 |

---

### 2-8. `unobserved-promise` — 신규

미관찰 Promise 감지. 통합 설계 (Biome `noFloatingPromises` 방향).

**하위 체크:**
| 체크 | 감지 패턴 | 비고 |
|------|----------|------|
| floating promise | `asyncFn();` (ExpressionStatement) | 기존 `floating-promises` |
| 변수 할당 미관찰 | `const p = asyncFn();` 후 await/catch 없음 | R-10. AST 근사 감지 |
| catch-or-return | `.then()` without `.catch()` | 기존 `catch-or-return` |
| forEach async | `arr.forEach(async cb)` | 기존 `misused-promises` |
| filter/sort 등 | `arr.filter(async cb)`, `arr.sort(async cb)` 등 | R-13. 현재 구현 유지 |
| always-return | then 콜백에서 return 누락 | D-1. firebat 구현 |
| no-callback-in-promise | Promise 체인 내 callback 혼용 | D-2. firebat 구현 |

**이벤트 핸들러 예외 허용 (R-09):**
- `addEventListener`, `on`, `once`, `addListener` → fire-and-forget 의도적, 예외 허용
- React JSX 이벤트 prop (`onClick` 등) → 예외 허용
- **검증 필요:** 화이트리스트 완전성. 구현 후 테스트로 확인.

**변수 할당 미관찰 (R-10) 감지 방식:**
- gildash 있으면: `collectTypeAt`으로 Promise 타입 확인
- gildash 없으면: `VariableDeclarator` init이 call expression + 같은 스코프 내 해당 변수의 await/.then/.catch 사용 여부 AST 탐색
- **한계:** 다른 함수로 전달된 경우 미감지 — 플랜에 명시

---

## 3. 경계 위임

| 패턴 | 위임 대상 | 비고 |
|------|----------|------|
| catch 파라미터 타입 narrowing (`catch(e) { e.message }`) | `unknown-proof` 디텍터 | R-14 |
| `reject("string")` 패턴 | oxlint `typescript/prefer-promise-reject-errors` (활성 중) | R-11 |
| nested Promise | oxlint `promise/no-nesting` (활성 중) | |
| 다중 resolve/reject | oxlint `promise/no-multiple-resolved` (활성 중) | |

---

## 4. oxlint 중복 룰 현황

| error-flow 룰 | oxlint 대응 | oxlint 현재 상태 | 방침 |
|---|---|---|---|
| `useless-catch` | `no-useless-catch` | off | error-flow 유지 |
| `unsafe-finally` | `no-unsafe-finally` | off | error-flow 유지 (break/continue 추가로 lint보다 강력) |
| `throw-non-error` | `typescript/only-throw-error` | error | **off로 변경** — error-flow 유지 |
| `promise-constructor-hygiene` | `no-async-promise-executor` | off | error-flow 유지 (확장 범위가 lint보다 넓음) |
| `unobserved-promise` | `typescript/no-floating-promises` | off | error-flow 유지 |
| `unobserved-promise` | `typescript/no-misused-promises` | off | error-flow 유지 |
| `unobserved-promise` | `promise/catch-or-return` | off | error-flow 유지 |
| `prefer-dot-catch` | `promise/prefer-catch` | off | error-flow 유지 |
| `prefer-dot-catch` | `promise/prefer-await-to-then` | off | error-flow 유지 |
| `unsafe-finally` | `promise/no-return-in-finally` | off | error-flow 유지 |
| — | `typescript/prefer-promise-reject-errors` | error | lint 유지 (경계 위임) |
| — | `promise/no-multiple-resolved` | error | lint 유지 (경계 위임) |
| — | `promise/no-nesting` | error | lint 유지 (경계 위임) |
| — | `promise/always-return` | error | **off로 변경** — error-flow `unobserved-promise`에서 감지 |
| — | `promise/no-callback-in-promise` | error | **off로 변경** — error-flow `unobserved-promise`에서 감지 |
| — | `typescript/require-await` | error | lint 유지 (error-flow scope 밖) |

---

## 5. 리네이밍 영향 파일

### 5-1. 코드 리네이밍 (`exception-hygiene` → `error-flow`)

| 파일 | 변경 내용 |
|------|----------|
| `src/features/exception-hygiene/` | 디렉토리명 → `src/features/error-flow/` |
| `src/features/exception-hygiene/analyzer.ts` | 함수명: `analyzeExceptionHygiene` → `analyzeErrorFlow`, `createEmptyExceptionHygiene` → `createEmptyErrorFlow` |
| `src/features/exception-hygiene/types.ts` | 타입명: `ExceptionHygieneFinding` → `ErrorFlowFinding`, `ExceptionHygieneFindingKind` → `ErrorFlowFindingKind` |
| `src/features/exception-hygiene/index.ts` | export 경로 변경 |
| `src/types.ts` | `'exception-hygiene'` → `'error-flow'`, import 경로, `FirebatCatalogCode` `EH_*` → `EF_*` |
| `src/application/scan/scan.usecase.ts` | import, 변수명, detector key, 결과 매핑, `kindToCode` 맵 확장 |
| `src/report.ts` | switch case, label, emoji, 변수명 |
| `src/test-api.ts` | export 경로 |
| `src/shared/arg-parse.ts` | `DETECTOR_NAMES` 배열, 에러 메시지 |
| `src/shared/firebat-config.ts` | interface 속성, Zod schema |
| `src/adapters/cli/entry.ts` | 도움말 텍스트, `DEFAULT_DETECTORS` |
| `src/adapters/mcp/server.ts` | 도움말 텍스트, `DEFAULT_DETECTORS` |
| `.firebatrc.jsonc` | `"exception-hygiene"` → `"error-flow"` |
| `assets/.firebatrc.jsonc` | `"exception-hygiene"` → `"error-flow"` |
| `assets/firebatrc.schema.json` | JSON Schema 속성명 |

### 5-2. 하위호환

- `src/shared/arg-parse.ts`의 `DETECTOR_ALIASES`에 `'exception-hygiene'` → `'error-flow'` 매핑 추가
- `.firebatrc.jsonc` 파서에서 `exception-hygiene` 키를 `error-flow`로 매핑
- 캐시 무효화: `computeScanArtifactKey`에 `detectors` 배열이 포함되므로 `'exception-hygiene'` → `'error-flow'` 변경 시 캐시 키가 자동으로 달라져 기존 캐시 무효화됨

### 5-3. 카탈로그 코드

`EH_*` 17개 → `EF_*`로 리네이밍. 폐기/합침 대상 제거 후 최종:

| 기존 코드 | 신규 코드 | 비고 |
|----------|----------|------|
| `EH_USELESS_CATCH` | `EF_USELESS_CATCH` | |
| `EH_REDUNDANT_NESTED_CATCH` | — | `EF_USELESS_CATCH`에 흡수 |
| `EH_UNSAFE_FINALLY` | `EF_UNSAFE_FINALLY` | |
| `EH_RETURN_IN_FINALLY` | — | `EF_UNSAFE_FINALLY`에 흡수 |
| `EH_THROW_NON_ERROR` | `EF_THROW_NON_ERROR` | |
| `EH_MISSING_ERROR_CAUSE` | `EF_MISSING_ERROR_CAUSE` | |
| `EH_CATCH_TRANSFORM` | — | `EF_MISSING_ERROR_CAUSE`에 흡수 |
| `EH_ASYNC_PROMISE_EXECUTOR` | `EF_PROMISE_CONSTRUCTOR_HYGIENE` | 리네이밍 |
| `EH_RETURN_AWAIT_POLICY` | `EF_RETURN_AWAIT_IN_TRY` | 스펙 재정의 |
| `EH_PREFER_CATCH` | `EF_PREFER_DOT_CATCH_CATCH` | 그룹 코드명 |
| `EH_PREFER_AWAIT_TO_THEN` | `EF_PREFER_DOT_CATCH_AWAIT` | 그룹 코드명 |
| — | `EF_PREFER_DOT_CATCH_NO_WRAP` | 신규 (GAP-3) |
| `EH_FLOATING_PROMISES` | `EF_UNOBSERVED_PROMISE_FLOATING` | 그룹 코드명 |
| `EH_CATCH_OR_RETURN` | `EF_UNOBSERVED_PROMISE_CATCH_OR_RETURN` | 그룹 코드명 |
| `EH_MISUSED_PROMISES` | `EF_UNOBSERVED_PROMISE_MISUSED` | 그룹 코드명 |
| — | `EF_UNOBSERVED_PROMISE_VARIABLE` | 신규 (R-10) |
| — | `EF_UNOBSERVED_PROMISE_ALWAYS_RETURN` | 신규 (D-1) |
| — | `EF_UNOBSERVED_PROMISE_CALLBACK_IN_PROMISE` | 신규 (D-2) |
| `EH_OVERSCOPED_TRY` | — | 폐기 |
| `EH_SILENT_CATCH` | — | 폐기 |
| `EH_EXCEPTION_CONTROL_FLOW` | — | 폐기 |

### 5-4. 테스트 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/features/exception-hygiene/analyzer.spec.ts` | 경로 이동, describe 수정, 폐기 룰 테스트 삭제, 신규/수정 룰 테스트 추가 |
| `src/features/exception-hygiene/types.spec.ts` | 경로 이동, describe 수정, 폐기 kind 테스트 삭제 |
| `test/integration/features/exception-hygiene/` | 디렉토리명 → `test/integration/features/error-flow/` |
| `test/integration/pipeline/scan/report-contract.test.ts` | `'exception-hygiene'` → `'error-flow'` |
| `src/report.spec.ts` | import, 타입명, 문자열 리터럴 |
| `src/shared/arg-parse.spec.ts` | 배열 항목 |

---

## 6. 구현 순서

| 순서 | 작업 | 의존성 |
|------|------|--------|
| 1 | 폐기 3개 삭제 (코드, 타입, 카탈로그, 테스트) | 없음 |
| 2 | 리네이밍 `exception-hygiene` → `error-flow` + `EH_*` → `EF_*` | 1 완료 후 (삭제 먼저여야 충돌 없음) |
| 3 | kind 합침 (`redundant-nested-catch`, `return-in-finally`, `catch-transform-hygiene` 삭제) | 2 완료 후 |
| 4 | 기존 룰 수정 (`useless-catch` nested 확장, `unsafe-finally` break/continue, `missing-error-cause` 바이브 패턴 등) | 3 완료 후 |
| 5 | `async-promise-executor` → `promise-constructor-hygiene` 리네이밍 + 확장 | 3 완료 후 |
| 6 | `return-await-policy` → `return-await-in-try` 스펙 재정의 | 3 완료 후 |
| 7 | 신규 룰 (`prefer-dot-catch`, `unobserved-promise`) 구현 | 3 완료 후 (기존 kind 흡수가 선행되어야 중복 방지) |
| 8 | gildash 통합 (analyzer 시그니처 변경, needsSemantic 확장) | 4, 7 완료 후 |
| 9 | oxlint 설정 변경 (`typescript/only-throw-error` off, `promise/always-return` off, `promise/no-callback-in-promise` off) | 7 완료 후 |

---

## 7. 검증 필요 항목

구현 단계에서 테스트로 확인 후 재검토할 항목.

| # | 항목 | 불확실한 이유 |
|---|------|-------------|
| V-1 | `promise-constructor-hygiene` 하위 체크 5개 합침 | 단일 룰에 책임 과다 가능성. 구현 후 코드 비대 여부 확인 |
| V-2 | `prefer-dot-catch`에 no-return-wrap 합침 | 룰 이름과 책임 정합성. 구현 후 확인 |
| V-3 | R-10 AST 근사 감지 한계 | 다른 함수 전달, 조건부 await 등 미감지 빈도 실측 필요 |
| V-4 | R-09 이벤트 핸들러 화이트리스트 완전성 | 누락된 메서드 패턴 존재 가능 |
| V-5 | GAP-14 불필요 new Promise 허용 케이스 완전성 | stream 래핑 외 의도적 사용 패턴 존재 가능 |
| V-6 | `unobserved-promise`에 `always-return`/`no-callback-in-promise` 합침 | "미관찰 Promise"와 개념적 정합성 의문. 구현 후 분리 여부 재검토 |
