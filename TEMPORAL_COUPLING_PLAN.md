# TEMPORAL_COUPLING_PLAN.md

temporal-coupling 디텍터 정밀도 개선 계획.
기존 버그 수정 + gildash call graph 통합 + caller AST 순서 검사.

---

## 1. 현재 문제

### 1-1. 정밀도 한계 (AST-only)

writer/reader 존재만 감지 → 의도적 설계 패턴(connection pool, config loader, cache)도 오탐.
호출 순서를 모르므로 "temporal coupling이 실제로 문제인지" 판단 불가.

### 1-2. 기존 구현 버그

| # | 버그 | 위치 | 영향 |
|---|------|------|------|
| B-1 | `getEnclosingExportedFunction`이 `export function` 선언만 인식 | L24-33 | `export const fn = () => {}`, `export { fn }`, `export default function` 전부 누락 → 다량 False Negative |
| B-2 | class 분석에서 `constructor`가 writer로 포함됨 | L206-213 | 객체 생성 시 정상 초기화도 finding 발생 → False Positive |
| B-3 | identifier마다 전체 AST 재순회 (O(n²)) | L102-143 | 성능 비효율. 정확도에는 영향 없음 |

---

## 2. 구현 순서 (3단계)

### Phase 1: 기존 버그 수정

gildash 통합 이전에 기반 로직부터 수정. 이것 없이는 어떤 개선도 의미 없음.

**B-1 수정: export 패턴 확장**

현재 인식하는 것:
```ts
export function query() { ... }
```

추가로 인식해야 하는 것:
```ts
export const query = () => { ... };              // VariableDeclaration + ArrowFunctionExpression
export const query = function() { ... };          // VariableDeclaration + FunctionExpression
const query = () => { ... }; export { query };    // ExportNamedDeclaration with specifiers
export default function query() { ... };          // ExportDefaultDeclaration
```

구현 — 2단계 접근:

1단계: `collectExportedFunctionNames(program)` 함수 신규 추가. Program 전체에서 export된 함수 이름 집합 수집.
- `ExportNamedDeclaration` → `declaration`이 `FunctionDeclaration`이면 이름 추가
- `ExportNamedDeclaration` → `declaration`이 `VariableDeclaration`이면 init이 ArrowFunctionExpression/FunctionExpression인 declarator의 이름 추가
- `ExportNamedDeclaration` → `specifiers` 배열이 있으면 각 `ExportSpecifier.local.name` 추가
- `ExportDefaultDeclaration` → declaration이 FunctionDeclaration이면 이름 추가

2단계: `getEnclosingExportedFunction` 로직 전환.
- 현재: "offset이 ExportNamedDeclaration 안의 FunctionDeclaration에 있는가" 체크
- 변경: "offset이 어떤 함수에 있는가" 체크 → 그 함수 이름이 export 집합에 있는가" 체크
- 함수 탐색: `FunctionDeclaration`, `VariableDeclarator`의 init이 ArrowFunctionExpression/FunctionExpression인 경우 모두 후보

**B-2 수정: constructor 제외**

`analyzeClassTemporalCoupling`의 method 순회(L206)에서 `methodName === 'constructor'`이면 skip.

**B-3 수정: O(n²) → O(n)**

`classifyExportedFunctions`에서 identifier마다 `walkOxcTree`를 호출하지 않고, 전체 AST를 1회 순회하면서 AssignmentExpression/UpdateExpression의 left 위치를 Set으로 수집. 이후 각 identifier의 offset이 Set에 있으면 write, 없으면 read.

### Phase 2: gildash caller 공존 검사

**핵심 알고리즘:**

1. 기존 AST 분석으로 writer 함수 집합 W, reader 함수 집합 R 식별
2. gildash로 각 reader의 caller 집합 수집:
   - `getInternalRelations(filePath)` → intra-file calls (파일당 1회, 캐시)
   - `searchRelations({ type: 'calls', dstSymbolName: reader, dstFilePath: filePath })` → cross-file calls
3. **억제 조건: 모든 reader의 모든 caller가 W 중 하나를 호출 → 억제**
4. **유지 조건: R의 caller 중 W를 전혀 호출하지 않는 caller가 1개라도 있음 → finding 유지**
5. **보수적 처리: caller가 0명인 reader → finding 유지**
6. gildash 에러 시 try-catch → fallback (AST-only)

**`dstFilePath` 필수 포함** — 동명 함수 충돌 방지. 경로 형식은 `dependencies/analyzer.ts`의 `resolveAbs` 패턴 적용 (gildash가 프로젝트 상대경로를 반환할 수 있음). **구현 전 bun 스크립트로 실측 필수.**

**class method:** `${className}.${methodName}` 형태로 gildash 검색.
- class name 추출: `getNodeName(classNode.id)` 사용
- anonymous class (`const MyClass = class { ... }`): parent VariableDeclarator의 `id.name` 사용. parent 추적 순회 필요.
- 이름 확정 불가 시 (진짜 anonymous): Phase 2 대상에서 제외, AST-only 결과 유지

### Phase 3: caller AST 순서 검사

Phase 2에서 "모든 caller가 W도 호출"하여 억제 후보가 된 finding에 대해, caller AST에서 호출 순서 확인.

**caller AST 취득: `gildash.getParsedAst(srcFilePath)`**
- LRU cache 조회, I/O 없음, features/ 순수 규칙 준수
- undefined 반환 시 (gildash 미인덱싱 파일): 보수적으로 finding 유지

**순서 검사 알고리즘:**
1. caller 함수 body에서 W 호출의 `start` offset과 R 호출의 `start` offset 수집
2. W offset < R offset → 올바른 순서 (억제 유지)
3. R offset < W offset → **역순 호출, 억제 취소 → finding 유지**
4. 분기/반복문 내부 → 순서 불명확, **보수적으로 finding 유지**

**분기 내 호출 판정 방법:**
- conditional ancestor 타입 집합: `IfStatement`, `ConditionalExpression`, `SwitchStatement`, `LogicalExpression`, `WhileStatement`, `ForStatement`, `ForInStatement`, `ForOfStatement`
- 모든 conditional 노드를 수집하고 offset 범위 체크: W 또는 R 호출이 conditional 노드의 자식 범위 안에 있으면 "분기 내 호출"
- `walkOxcTree`는 parent 참조를 제공하지 않으므로, 별도 재귀 순회 함수로 conditional depth를 추적

---

## 3. gildash API (실측 확인 완료)

| API | 용도 | 동기/비동기 |
|-----|------|-------------|
| `searchRelations({ type: 'calls', dstSymbolName, dstFilePath })` | cross-file caller 조회 | 동기 |
| `getInternalRelations(filePath)` | intra-file caller 조회 | 동기 |
| `getParsedAst(filePath)` | caller AST 취득 (Phase 3) | 동기, LRU cache |

### 실측 결과

| 항목 | 결과 |
|------|------|
| `meta` 필드 | `scope`, `isNew`만 존재. position/offset **없음** (17,069건 전수) |
| `getInternalRelations` intra-file calls | **포함** (scan.usecase.ts에서 350건 반환) |
| class method `srcSymbolName` 형태 | **`ClassName.methodName`** (e.g. `Scanner.next`) |
| `searchRelations` 반환 타입 | `StoredCodeRelation` (타입 선언과 불일치) |
| semantic 필요 여부 | **불필요** — calls는 AST-level 추출 |
| `dstFilePath` 경로 형식 | **미확인** — 구현 전 실측 필수. `resolveAbs` 패턴 임시 적용 |

---

## 4. 수정 파일

### Phase 1

| 파일 | 변경 |
|------|------|
| `src/features/temporal-coupling/analyzer.ts` | B-1: `collectExportedFunctionNames` 추가 + `getEnclosingExportedFunction` 로직 전환, B-2: constructor 제외, B-3: O(n) 리팩토링 |
| `src/features/temporal-coupling/analyzer.spec.ts` | 누락 패턴 테스트 추가 (arrow export, re-export, default export, constructor 제외) |

### Phase 2

| 파일 | 변경 |
|------|------|
| `src/features/temporal-coupling/analyzer.ts` | `AnalyzeTemporalCouplingInput` 추가, `shouldSuppressByCallGraph` 추가, 시그니처 변경, anonymous class 처리 |
| `src/application/scan/scan.usecase.ts` | `analyzeTemporalCoupling(program, { gildash })` 전달. `needsSemantic` 변경 없음 |
| `src/features/temporal-coupling/analyzer.spec.ts` | gildash mock 주입 테스트 6건 추가 |

### Phase 3

| 파일 | 변경 |
|------|------|
| `src/features/temporal-coupling/analyzer.ts` | caller AST 순서 검사: `gildash.getParsedAst` 사용, 분기 판정 함수 추가 |
| `src/features/temporal-coupling/analyzer.spec.ts` | 순서 검사 테스트 추가 (정순/역순/분기) |

### 변경 불필요 (검증 완료)

| 파일 | 이유 |
|------|------|
| `src/types.ts` | `TemporalCouplingFinding` 구조 변경 없음. finding 억제는 배열에서 제거하는 방식 |
| `src/report.ts` | 출력 형식 변경 없음 |
| `.firebatrc.jsonc` / `assets/firebatrc.schema.json` | 설정 옵션 추가 없음 |
| `src/types.ts` `FirebatCatalogCode` | 코드 추가 없음 |
| 기존 테스트 | Phase 1은 내부 로직만 변경, Phase 2는 optional param → 기존 호출 호환 |
| 기존 golden fixture | `export function` 패턴만 사용하므로 영향 없음 |

### 새로 추가 필요

| 파일 | 내용 |
|------|------|
| golden fixture (Phase 1) | arrow export, re-export 패턴 fixture + expected JSON |
| integration test (Phase 2) | gildash 억제 동작 검증 테스트 |

---

## 5. 테스트 전략

### Phase 1 테스트

| 테스트 | 시나리오 | 기대 |
|--------|----------|------|
| arrow export writer | `export const init = () => { x = 1; }` | writer로 인식 |
| arrow export reader | `export const query = () => x;` | reader로 인식 |
| function expression export | `export const init = function() { x = 1; }` | writer로 인식 |
| re-export | `const init = () => { x = 1; }; export { init };` | writer로 인식 |
| default export | `export default function init() { x = 1; }` | writer로 인식 |
| constructor 제외 | `constructor() { this.x = 1; }` | writer에서 제외, finding 없음 |
| 기존 테스트 회귀 | 전부 통과 확인 | 깨지지 않음 |

### Phase 2 테스트

| 테스트 | 시나리오 | 기대 |
|--------|----------|------|
| 억제 성공 | mock: 모든 caller가 W+R 호출 | finding 0건 |
| 억제 실패 | mock: R만 호출하는 caller 존재 | finding 유지 |
| caller 0명 | mock: reader의 caller 없음 | finding 유지 |
| gildash 에러 | mock: searchRelations throw | fallback → AST-only |
| class method | mock: `ClassName.method` 억제 | 동작 확인 |
| 동명 함수 | mock: 다른 파일의 동명 함수 | `dstFilePath` 필터링 확인 |
| anonymous class | mock: 이름 없는 class | Phase 2 대상 제외, AST-only 유지 |

### Phase 3 테스트

| 테스트 | 시나리오 | 기대 |
|--------|----------|------|
| 정순 | caller: `init(); query();` | 억제 유지 |
| 역순 | caller: `query(); init();` | 억제 취소 → finding 유지 |
| 분기 내 W | caller: `if(x) { init(); } query();` | 보수적 → finding 유지 |
| 분기 내 R | caller: `init(); if(x) { query(); }` | 보수적 → finding 유지 |
| getParsedAst undefined | mock: caller 파일 미인덱싱 | 보수적 → finding 유지 |

---

## 6. 아키텍처 규칙 준수

| 규칙 | 준수 | 설명 |
|------|------|------|
| `features/` → 순수, I/O 없음 | ✅ | gildash DI 주입. SQLite in-memory 조회, getParsedAst는 LRU cache |
| `application/` → `ports/`만 의존 | ✅ | 기존 gildash import 경로 유지 |
| `engine/` + `features/` → import 제한 | ✅ | `@zipbul/gildash` type import만 |

---

## 7. 성능

- `searchRelations`: 동기 SQLite, finding당 reader 수 × 1회
- `getInternalRelations`: 파일당 1회, 캐시 재사용
- Phase 3 `getParsedAst`: LRU cache hit, 재파싱 없음

---

## 8. 정밀도 분석

### Phase별 정밀도 개선

| Phase | False Positive 감소 | False Negative 감소 | 비용 |
|-------|-------------------|-------------------|------|
| 1 (버그 수정) | B-2 constructor 오탐 제거 | B-1 arrow/re-export 누락 해소 | 낮음 |
| 2 (caller 공존) | 의도적 설계 패턴 억제 | - | 중간 |
| 3 (순서 검사) | R→W 역순 오억제 방지 | - | 높음 |

### 잔존 한계 (Phase 3 이후에도)

| 한계 | 설명 | 해결 필요 도구 |
|------|------|---------------|
| 간접 write | `reset() { cleanup(); }` + `cleanup() { x = null; }` | transitive call graph |
| 조건부 init | `if (!x) init(); query();` | dominator analysis (CFG 필요) |
| cross-file state | 파일 A에 state, B에 writer, C에 reader | scope 재정의 |
| async 순서 | `await init(); await query();` | async-aware analysis |
| 이벤트 기반 | `emitter.on('ready', query)` | event flow analysis |
| class 상속 | 부모 `init()` → 자식 reader | heritage chain analysis |

---

## 9. 학술적 배경

- **Typestate Analysis** (Strom 1983): 변수를 FSM으로 모델링. "초기화 전 사용" 탐지의 이론적 기반. 완전한 구현에는 data-flow 엔진 필요 → 현재 scope 밖.
- **업계 도구**: SonarQube, NDepend, Structure101 중 temporal coupling을 정적으로 직접 탐지하는 도구 없음. firebat의 차별화 포인트.
- **Mark Seemann (2011)**: "Design Smell: Temporal Coupling" — Sequencing, Waiting, Circumstance. 현재 구현은 Sequencing만 대상.

---

## 10. 재사용 패턴

| 코드 | 용도 |
|------|------|
| `error-flow/analyzer.ts` — `AnalyzeErrorFlowInput` | optional gildash 주입 패턴 |
| `dependencies/analyzer.ts` — `searchRelations` 호출 + `resolveAbs` | 호출 방법, 경로 정규화, 에러 처리 |
| `dependencies/analyzer.spec.ts` — mock gildash | unit test mock 패턴 |
| `engine/ast/oxc-ast-utils.ts` — `collectFunctionNodesWithParent` | parent 추적 순회 패턴 (anonymous class name 추출) |

---

## 11. Scope Out (명시적 제외)

| 항목 | 제외 이유 |
|------|----------|
| cross-file temporal coupling | scope 재정의 필요, 별도 작업 |
| async/Promise 순서 의존 | async-aware analysis 필요 |
| 이벤트 기반 temporal coupling | event flow analysis 필요 |
| class 상속 체인 | heritage chain + cross-class analysis 필요 |
| 간접 write (`reset() → cleanup() → x = null`) | transitive call graph 필요. False Negative만 발생, precision 영향 없음 |
| dominator analysis / typestate analysis | CFG 필요, oxc-parser 미제공 |
| `needsSemantic` 조건 변경 | calls는 AST-level 추출, semantic 불필요 |

---

## 12. 구현 전 선행 확인 (Phase 2 착수 전)

| 항목 | 방법 |
|------|------|
| `dstFilePath` 경로 형식 | bun 스크립트로 `searchRelations({ type: 'calls' })` 결과의 `dstFilePath` 샘플 출력 |
