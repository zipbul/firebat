# TEMPORAL_COUPLING_PLAN.md

temporal-coupling 디텍터 정밀도 개선 계획.

---

## 진행 상태

| Phase | 상태 | 커밋 |
|-------|------|------|
| 1. 기존 버그 수정 | ✅ 완료 | `0697834` |
| 2. gildash caller 공존 검사 | ✅ 완료 | `afce543` |
| 3. caller AST 순서 검사 (offset 기반) | ✅ 완료 | `be52717` |
| 3a. 코드 리뷰 이슈 수정 | ✅ 완료 | `3e2e522` |
| 4. Phase 3 → CFG dominator 교체 | 미착수 | |
| 5. guard 패턴 인식 | 미착수 | |
| 6. dead writer 제외 | 미착수 | |

---

## Phase 4: CFG dominator로 Phase 3 교체

### 4-1. 문제

현재 Phase 3은 caller AST에서 W/R 호출의 source offset을 비교한다. 이건 텍스트 위치이지 실행 순서가 아니다.

**offset 비교가 틀리는 케이스:**

```ts
// 양쪽 분기 모두 writer → 사실상 항상 실행
if (cond) { init(); } else { init(); }
query();
// offset: init < query → 억제. 하지만 보수적으로 conditional이므로 유지 (오판)

// else 안 writer → 항상 실행 아님
if (cond) { } else { init(); }
query();
// offset: init < query → 억제 가능 (오판)

// init(); if(c) { query(); } → 항상 init 먼저
// offset: 보수적으로 query가 conditional → 유지 (오판)
```

### 4-2. 해결: CFG dominator 검증

이 프로젝트의 기존 CFG 엔진 사용:
- `src/engine/cfg/cfg-builder.ts` — `OxcCFGBuilder`: 13종 statement + try/catch exception edge
- `src/engine/cfg/cfg.ts` — `IntegerCFG`: `buildAdjacency('forward'|'backward')`

### 4-3. 알고리즘

"W가 R을 dominate하는가" = "W를 제거하면 entry에서 R에 도달 불가능한가"

```
1. caller 함수 body 취득
   - findFunctionBody()로 함수 AST 노드 확보
   - ⚠ 함수 노드가 아닌 함수의 body(BlockStatement)를 추출하여 전달
   - funcNode.body를 buildFunctionBody에 전달 (waste-detector-oxc.ts L418-419 패턴)

2. CFG 빌드
   - const built = new OxcCFGBuilder().buildFunctionBody(funcNode.body)
   - built.cfg, built.nodePayloads, built.exitId 사용

3. nodePayloads에서 W/R CallExpression 포함 CFG 노드 식별
   - findCallNodeIds(nodePayloads, targetNames): number[]
   - 각 payload(CfgNodePayload = Node | ReadonlyArray<Node>)에 대해:
     - collectOxcNodes(payload, n => n.type === 'CallExpression')로 모든 CallExpression 수집
     - callee가 Identifier → name 비교
     - callee가 MemberExpression → property name 비교
   - 매칭된 payload의 인덱스(= CFG 노드 ID) 반환

4. dominator BFS
   - cfg.buildAdjacency('forward')로 successor adjacency 확보
   - ⚠ exception edge 포함됨 — 이는 올바른 동작:
     try { init(); } catch { } query();에서 init 노드에서 catch로의 exception edge가
     있으면 init을 제거해도 catch 경로로 query 도달 가능 → dominate 안 함 → 유지 (정확)
   - W 노드를 방문 금지로 마킹
   - entryId(0)에서 BFS → R 노드 도달 여부 확인
   - 도달 불가 → W가 R을 dominate → 억제 안전
   - 도달 가능 → 억제 불가

5. 여러 writer 처리
   - writerNodeIds.some(wId => dominates(adj, nodeCount, entryId, wId, rNodeId))
   - "하나라도 dominate하면 억제" — 이는 올바름:
     if(c) { w1(); } else { w2(); } r();에서 w1 제거 시 w2 경로로 R 도달 → dominate 안 함.
     w2 제거 시 w1 경로로 R 도달 → dominate 안 함. some() = false. 올바르게 유지.
     if(c) { w1(); } w1(); r();에서 두 번째 w1 제거 시 첫 번째 w1 경로 → dominate. some() = true. 억제.

6. edge case 처리
   - entryId === rNodeId: BFS 시작 시 즉시 도달 → return false (dominate 안 함). 올바름.
   - wNodeId === rNodeId: W=R 같은 노드 — 방문 금지이므로 도달 불가 → return true.
     이 경우는 같은 ExpressionStatement에 init()과 query()가 함께 있을 수 없으므로 실제로 발생 안 함.
     복합 payload(배열)인 경우: ForStatement init/update 등이지만 CallExpression 이름 매칭으로 구분 가능.
```

### 4-4. exception edge 처리 방침

`buildAdjacency('forward')`는 `EdgeType.Exception` edge도 포함한다. 이는 dominator 분석에서 **올바르게 동작**한다:

- `try { init(); } catch { } query();` — init 노드에서 catch entry로 exception edge 존재. init을 제거하면 catch entry에서 query로 도달 가능 → dominate 안 함 → finding 유지. **정확.**
- `try { init(); query(); } catch { }` — init에서 exception → catch, init에서 normal → query. init 제거 시 catch에서 query 도달 불가(query는 try 안에 있고 init 이후), entry에서도 query 도달 불가 → dominate → 억제. **정확.**

exception edge를 포함하는 것이 보수적이면서 정확한 결과를 낸다. 별도 필터링 불필요.

### 4-5. 수정 파일

| 파일 | 변경 |
|------|------|
| `src/features/temporal-coupling/analyzer.ts` | `verifyCallerOrder` + 보조함수 4개 삭제 → `verifyCallerOrderByCfg` + `findCallNodeIds` + `dominates` 추가. `OxcCFGBuilder` import 추가. `findFunctionBody` 반환값에서 `.body` 추출 로직 추가 |
| `src/features/temporal-coupling/analyzer.spec.ts` | Phase 3 테스트 4건 수정 (offset 기반 → CFG 기반 동작으로 기대값 변경) + 새 케이스 추가 |

### 4-6. 테스트 전략

| 테스트 | 시나리오 | 기대 |
|--------|----------|------|
| 정순 linear | `init(); query();` | 억제 유지 |
| 역순 linear | `query(); init();` | finding 유지 |
| 양쪽 분기 writer | `if(c) { init(); } else { init(); } query();` | 억제 (양쪽 모두 dominate) |
| 단측 분기 writer | `if(c) { init(); } query();` | finding 유지 (dominate 안 함) |
| try writer 성공 | `try { init(); query(); } catch {}` | 억제 |
| try writer 실패 경로 | `try { init(); } catch {} query();` | finding 유지 |
| 루프 writer | `for(x of xs) { init(); } query();` | finding 유지 (0회 가능) |
| init 후 분기 reader | `init(); if(c) { query(); }` | 억제 (init dominate) |
| getParsedAst undefined | caller 미인덱싱 | finding 유지 |
| 기존 Phase 2 테스트 | gildash mock without getParsedAst | Phase 3 skip, Phase 2만 동작 |

### 4-7. offset 비교 대비 정밀도 향상

| 케이스 | offset 비교 | CFG dominator |
|--------|------------|---------------|
| `if(c) { init(); } else { init(); } query();` | 보수적 유지 (오판) | 억제 (정확) |
| `if(c) {} else { init(); } query();` | 억제 가능 (오판) | 유지 (정확) |
| `try { init(); } catch {} query();` | 보수적 유지 | 유지 (정확, exception edge) |
| `init(); if(c) { query(); }` | 보수적 유지 (오판) | 억제 (정확) |
| `for(x of xs) { init(); } query();` | 보수적 유지 | 유지 (정확) |

---

## Phase 5: guard 패턴 인식

### 5-1. 문제

reader 함수가 스스로를 보호하는 guard 패턴이 있어도 finding이 발생한다.

```ts
export function query() {
  if (!initialized) throw new Error('not ready');
  return db.execute(sql);
}
```

### 5-2. 알고리즘

reader 함수 body를 CFG로 빌드하여 guard가 state 접근을 dominate하는지 확인.

```
1. reader 함수 body의 AST에서 guard 패턴 식별
   - IfStatement를 순회하며:
     - test에 state 변수 참조 포함 (Identifier name === stateName, 또는 this.stateName)
     - consequent에 ThrowStatement 또는 ReturnStatement (early exit)

2. reader 함수 body → OxcCFGBuilder.buildFunctionBody(readerBody)
   ⚠ readerBody는 함수의 body(BlockStatement). findFunctionBody 반환값의 .body 추출 필요.

3. guard의 CFG 노드 식별
   - OxcCFGBuilder는 IfStatement를 condition 노드 + true entry + false entry + merge로 분해
   - guard의 "early exit" 분기(throw/return)는 exitId로 연결됨
   - guard의 "통과" 분기는 merge 노드로 계속
   - dominator 관점에서 필요한 것: "guard condition 노드" 자체가 아니라
     "guard를 통과한 후의 merge 노드"가 state 접근을 dominate하는가
   - 실제로는 더 단순: guard의 throw/return 분기가 exitId로 가므로,
     guard 이후의 코드는 "guard 조건이 false인 경우"에만 도달
   - 즉 guard condition 노드가 state 접근 노드를 dominate하면 충분

4. dominator 검증 (Phase 4와 동일 BFS)
   - guard condition 노드를 제거한 그래프에서 entry → state 접근 노드 BFS
   - 도달 불가 → guard가 dominate → self-protecting reader

5. 중첩 guard 처리
   - if (!a) throw; if (!b) throw; use(a, b);
   - 각 guard condition이 use 노드를 dominate하는지 개별 확인
   - 모든 state 변수에 대해 guard가 있으면 self-protecting
```

### 5-3. guard 패턴 종류

| 패턴 | AST 구조 | 인식 방법 |
|------|---------|----------|
| throw guard | `if (!x) throw new Error()` | IfStatement + consequent.type === ThrowStatement |
| return guard | `if (!x) return null` | IfStatement + consequent.type === ReturnStatement |
| assert guard | `assert(x !== null)` | ExpressionStatement + CallExpression callee name === 'assert' |
| nullish guard | `if (x == null) throw` | IfStatement + BinaryExpression(==, null) + ThrowStatement |

### 5-4. 조건부 init 흡수

`if (!initialized) init(); query();` 패턴:
- reader에 `if (!initialized) throw` guard가 있으면 self-protecting
- caller가 `if (!initialized) init()` 호출 → init이 initialized를 설정 → guard 통과 보장
- guard 패턴 인식으로 자연스럽게 커버 (별도 변수값 추적 불필요)

### 5-5. stateName 접근 패턴 매칭

- module-scope 변수: `stateName` → Identifier name === stateName
- class 속성: `this.stateName` → MemberExpression(ThisExpression, Identifier name === stateName)
- `isReaderSelfProtecting(readerBody, stateName, isClassProp)` — isClassProp 플래그로 구분

### 5-6. 수정 파일

| 파일 | 변경 |
|------|------|
| `src/features/temporal-coupling/analyzer.ts` | `isReaderSelfProtecting` 함수 추가. Pattern 1/2 finding 생성 전에 호출. OxcCFGBuilder 재사용 |
| `src/features/temporal-coupling/analyzer.spec.ts` | guard 패턴 테스트 추가 |

### 5-7. 테스트 전략

| 테스트 | 시나리오 | 기대 |
|--------|----------|------|
| throw guard | `if (!x) throw; return x.exec();` | self-protecting → finding 억제 |
| return guard | `if (!x) return null; return x.exec();` | self-protecting → finding 억제 |
| guard 없음 | `return x.exec();` | finding 유지 |
| guard 후 분기 접근 | `if (!x) throw; if (c) { x.exec(); }` | guard dominate → 억제 |
| 중첩 guard | `if (!a) throw; if (!b) throw; use(a,b);` | 모든 state guarded → 억제 |
| class this guard | `if (!this.x) throw; return this.x;` | self-protecting → 억제 |
| assert guard | `assert(x !== null); x.exec();` | self-protecting → 억제 |

---

## Phase 6: dead writer 제외

### 6-1. 문제

unreachable writer가 writer로 카운트되면 잘못된 finding 발생.

```ts
export function setup() {
  return;
  db = createConnection();  // unreachable → writer가 아님
}
```

### 6-2. 알고리즘

```
1. writer 함수 body → OxcCFGBuilder.buildFunctionBody(writerBody)
   ⚠ writerBody는 함수의 body(BlockStatement)
2. cfg.buildAdjacency('forward')
3. write statement가 포함된 CFG 노드 식별 (findCallNodeIds 변형 — write 패턴 매칭)
4. entryId에서 해당 노드까지 BFS
5. 도달 불가 → dead writer → writer 집합에서 제외
```

### 6-3. waste 디텍터와의 관계

waste 디텍터는 dead-store(write 후 read 없이 덮어쓰기)를 감지하지만, unreachable code 자체를 감지하지는 않는다. temporal-coupling의 dead writer 제외는 **writer 분류 정확도 개선**이지 dead code 감지가 아니므로 중복이 아니다.

### 6-4. 수정 파일

| 파일 | 변경 |
|------|------|
| `src/features/temporal-coupling/analyzer.ts` | `isWriterReachable` 함수 추가. `classifyExportedFunctions` 결과에서 dead writer 필터링 |
| `src/features/temporal-coupling/analyzer.spec.ts` | dead writer 테스트 추가 |

### 6-5. 테스트 전략

| 테스트 | 시나리오 | 기대 |
|--------|----------|------|
| reachable writer | `export function init() { db = 1; }` | writer 유지 |
| dead writer (return 후) | `export function init() { return; db = 1; }` | writer 제외 → finding 없음 |
| dead writer (throw 후) | `export function init() { throw e; db = 1; }` | writer 제외 |
| conditional writer | `export function init() { if(c) { db = 1; } }` | writer 유지 (도달 가능) |

---

## 정밀도 분석 (전체)

### Phase별 개선

| Phase | 유형 | 개선 내용 |
|-------|------|----------|
| 1 ✅ | FN 감소 | arrow/re-export 누락 해소 |
| 1 ✅ | FP 감소 | constructor 오탐 제거 |
| 2 ✅ | FP 감소 | 의도적 설계 패턴 억제 |
| 3 ✅ | FP 감소 | R→W 역순 오억제 방지 |
| 4 | 정확도 | offset 근사 → CFG dominator (분기/try/루프 정확 처리) |
| 5 | FP 감소 | self-protecting reader 인식 |
| 6 | FP 감소 | dead writer 제외 |

### 잔존 한계 (Phase 6 이후에도)

| 한계 | 설명 | 해결 필요 도구 |
|------|------|---------------|
| 간접 write | `reset() → cleanup() → x = null` | transitive call graph |
| cross-file state | 파일 A state, B writer, C reader | scope 재정의 |
| async 순서 | `await init(); await query();` | async-aware CFG |
| 이벤트 기반 | `emitter.on('ready', query)` | event flow analysis |
| class 상속 | 부모 `init()` → 자식 reader | heritage chain analysis |

이 5개는 현재 도구(oxc-parser + gildash + IntegerCFG)의 구조적 한계.

---

## 실현 가능성

| Phase | 실현 | 근거 |
|-------|------|------|
| 4 | ✅ | `OxcCFGBuilder` + `IntegerCFG.buildAdjacency` 이미 존재. waste-detector에서 사용 중 |
| 5 | ✅ | Phase 4와 동일 CFG + dominator BFS 재사용 |
| 6 | ✅ | CFG reachability BFS만으로 충분 |

추가 라이브러리/API 불필요. 모든 도구가 `src/engine/` 내에 이미 존재.

---

## Scope Out

| 항목 | 제외 이유 |
|------|----------|
| cross-file temporal coupling | scope 재정의 필요 |
| async/Promise 순서 의존 | async-aware CFG 필요 |
| 이벤트 기반 temporal coupling | event flow analysis 필요 |
| class 상속 체인 | heritage chain + cross-class analysis 필요 |
| 간접 write | transitive call graph 비용 대비 효과 낮음 |
| `needsSemantic` 조건 변경 | calls는 AST-level, semantic 불필요 |

---

## 아키텍처 규칙 준수

| 규칙 | 준수 | 설명 |
|------|------|------|
| `features/` → 순수, I/O 없음 | ✅ | gildash DI, CFG는 `engine/` import (허용) |
| `features/` → `engine/` 참조 | ✅ | 기존 패턴 (`waste-detector-oxc.ts`가 동일 경로 사용) |
| `application/` → `ports/`만 의존 | ✅ | 기존 경로 유지 |

---

## 재사용 패턴

| 코드 | Phase | 용도 |
|------|-------|------|
| `engine/cfg/cfg-builder.ts` — `OxcCFGBuilder` | 4, 5, 6 | CFG 빌드 |
| `engine/cfg/cfg.ts` — `IntegerCFG.buildAdjacency` | 4, 5, 6 | adjacency list |
| `engine/ast/oxc-ast-utils.ts` — `collectOxcNodes` | 4, 5 | nodePayloads에서 CallExpression 검색 |
| `waste-detector-oxc.ts` L418-419 | 4, 5, 6 | body 추출 패턴 (`node.body`) |
| `dominates` BFS | 4, 5 | 공유 함수 |
