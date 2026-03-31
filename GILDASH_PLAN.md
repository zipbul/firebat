# GILDASH_PLAN.md

gildash 0.8.0 → 0.11.0 업그레이드, private API 제거, 미사용 API 극한 활용 계획.

## 배경

### 현재 상태

- 설치 버전: `@zipbul/gildash@0.8.0` (`package.json: "^0.8.0"`)
- gildash 최신: **0.11.0** (2026-03-21 릴리즈) — 요청한 API 전부 포함
- gildash 사용 파일: 42개 (src 27개 + test 15개)
- 0.8.0 → 0.11.0 사이 breaking change: **없음**
- GitHub 이슈/PR: 오픈 0개, Discussions 비활성화

### E-07에서 발견된 문제

E-07 (`return-await-in-try` gildash semantic 타입 기반 개선) 구현 중 다음 문제 발견:

1. **`ResolvedType` 로컬 중복 정의**: `engine/semantic-types.ts`에 로컬 정의. TODO 주석에 "gildash 0.8.1+ 배포 전까지 로컬 정의"라고 되어 있으나 **0.8.0에서 이미 export 중** (`import type { ResolvedType } from '@zipbul/gildash'` 가능).
2. **`_ctx.semanticLayer` private API 직접 접근**: `error-flow/analyzer.ts`와 `unknown-proof/semantic-checks.ts`에서 `gildash._ctx.semanticLayer.collectTypeAt()` 등 3개 private 메서드 사용.
3. **`getSemanticLayer` 헬퍼 중복**: 두 feature에서 각각 `getSemanticLayer` 함수를 로컬 정의. 래핑 범위도 다름 (error-flow는 `collectTypeAt`만, unknown-proof는 3개 메서드).

### 0.8.0 → 0.11.0 changelog 요약

| 버전 | 날짜 | 유형 | 핵심 변경 |
| ----- | ----- | ----- | --------- |
| 0.8.1 | 3/4 | fix | `ResolvedType`, `SemanticReference` 타입 dist에 정상 포함 |
| 0.8.2 | 3/4 | chore | sourcemap 제거 |
| 0.9.0 | 3/16 | **minor** | annotation 추출 (`searchAnnotations`), symbol changelog (`getSymbolChanges`, `pruneChangelog`), rename/move 감지 |
| 0.9.1 | 3/16 | fix+perf | batch INSERT, progressive regex fetch, binary search JSDoc, 닫힌 인스턴스 에러 표준화 |
| 0.9.2 | 3/16 | fix | FTS5 whitespace-only 크래시, regex 검색 결과 누락, null byte 에러 |
| 0.9.3 | 3/16 | docs | README 정리 |
| 0.9.4 | 3/18 | docs | `ResolvedType` JSDoc에 유한 트리 보장 명시, `MAX_TYPE_DEPTH` named constant 추출 |
| 0.10.0 | 3/19 | **minor** | `getResolvedTypeAt`, `getFileTypes`, `isTypeAssignableTo`/`isTypeAssignableToAt`, `changedRelations`, `renamedSymbols`/`movedSymbols`, `srcFilePathPattern`/`dstFilePathPattern` |
| 0.11.0 | 3/21 | **minor** | position 기반 semantic API 4개, `lineColumnToPosition`/`findNamePosition`/`getSymbolNode` 노출, `getSemanticDiagnostics`, `getTransitiveDependents` 파사드, relation 반환 타입 `StoredCodeRelation[]` 수정, `SymbolNode`/`SemanticDiagnostic` 타입 export |
| 0.12.0 | 3/23 | **minor** | `isTypeAssignableToType(file, pos, typeExpr)` 추가, `getResolvedTypeAtPosition` primitive keyword resolve 수정, symbol-name API 절대 경로 silent failure 버그 수정 |
| 0.12.1 | 3/23 | fix | `isTypeAssignableToType`에 `{ anyConstituent: true }` 옵션 추가 — union member 중 하나라도 assignable하면 `true` 반환 |
| 0.12.2 | 3/23 | fix | 함수 overload 시그니처 인덱싱 (메서드와 동일하게 별도 row) |

**검증**: 0.10.0 API는 `npm pack @zipbul/gildash@0.10.0`으로, 0.11.0 API는 `npm pack @zipbul/gildash@0.11.0`으로 패키지를 다운로드하여 `dist/src/gildash/index.d.ts` 등 실제 타입 정의에서 확인함. 12개 요청 API 전부 0.11.0 d.ts에서 존재 및 시그니처 일치 검증 완료.

## 작업 항목

### P0: 즉시 적용 가능 (gildash 업그레이드 불필요)

#### P0-1. `ResolvedType`/`SemanticReference` import 경로 정리

0.8.0에서 이미 export 중이므로 로컬 정의 제거 가능.

**아키텍처 결론**: `engine/semantic-types.ts`를 **re-export wrapper로 유지**한다. `import type`만 사용하므로 (`verbatimModuleSyntax` 하에서 컴파일 타임 제거) 런타임 I/O 의존성 없음 — `engine/` 순수 규칙 위반 아님.

| 파일 | 액션 |
| ---- | ---- |
| `src/engine/semantic-types.ts` | 로컬 정의 삭제, `export type { ResolvedType, SemanticReference } from '@zipbul/gildash'`로 변경 |
| `src/features/error-flow/analyzer.ts` | `engine/semantic-types`에서 import (변경 없음) |
| `src/features/unknown-proof/semantic-checks.ts` | `engine/semantic-types`에서 import (변경 없음) |
| `src/features/error-flow/analyzer.spec.ts` | `engine/semantic-types`에서 import (변경 없음) |

**참고**: 타입 전용 import (`import type`)이므로 런타임 영향 없음. firebat `DEP_LAYER_VIOLATION`으로 검증.

### P1: gildash 0.8.0 → 0.11.0 업그레이드

**P1 이후 모든 작업(P2~P5)은 0.11.0 설치가 선행되어야 실행 가능.**

#### P1-1. changelog 확인 결과

0.8.1 ~ 0.11.0 사이 **breaking change 없음**. 모든 기존 public API 시그니처 유지됨. 0.11.0에서 `searchRelations`/`searchAllRelations`/`getInternalRelations` 반환 타입이 `CodeRelation[]` → `StoredCodeRelation[]`로 narrowing됐으나 `StoredCodeRelation extends CodeRelation`이므로 breaking 아님.

| API | 시그니처 변경 | 비고 |
| --- | ------------ | ---- |
| `searchRelations()` | 없음 | `RelationSearchQuery`에 `srcFilePathPattern`/`dstFilePathPattern` 추가 (선택적) |
| `searchSymbols()` | 없음 | |
| `getImportGraph()` | 없음 | |
| `getCyclePaths()` | 없음 | |
| `getHeritageChain()` | 없음 | |
| `batchParse()` | 없음 | 0.8.0에서 이미 `BatchParseResult` 반환 |
| `getFileInfo()` | 없음 | |
| `_ctx.semanticLayer.*` | 없음 | `SemanticLayerLike`에 `isTypeAssignableTo`, `lineColumnToPosition`, `findNamePosition` 추가 |
| `searchRelations()` (0.11.0) | 반환 타입 narrowing | `CodeRelation[]` → `StoredCodeRelation[]` (breaking 아님) |

#### P1-2. 테스트 전략

- `bun test` 전체 실행 후 회귀 확인
- integration test (`test/integration/`)에서 실제 gildash 인스턴스 사용하는 테스트 집중 확인
- mock/stub 테스트는 시그니처 변경 없으므로 수정 불필요

### P2: private API 제거 (0.11.0 설치 후)

#### P2-1. `_ctx.semanticLayer.collectTypeAt` → `getResolvedTypeAtPosition`

0.11.0에서 position 기반 API 추가됨. **시그니처 동일, 직접 교체 가능.**

```typescript
// Before (private API)
const rt = _ctx.semanticLayer.collectTypeAt(filePath, offset);

// After (0.11.0 public API — 동일 시그니처)
const rt = gildash.getResolvedTypeAtPosition(filePath, offset);
```

`getLineColumn` 변환 불필요. 7곳 모두 offset을 그대로 전달.

**사용 위치 (7곳):**

| 파일 | 라인 | 호출 패턴 |
| ---- | ---- | --------- |
| `error-flow/analyzer.ts` | 1099 | `semantic.collectTypeAt(filePath, arg.start)` |
| `unknown-proof/semantic-checks.ts` | 273 | `semantic.collectTypeAt(filePath, u.position)` |
| `unknown-proof/semantic-checks.ts` | 292 | `semantic.collectTypeAt(filePath, callArg.calleeEnd - 1)` |
| `unknown-proof/semantic-checks.ts` | 374 | `semantic.collectTypeAt(filePath, candidate.offset)` |
| `unknown-proof/semantic-checks.ts` | 420 | `semantic.collectTypeAt(filePath, candidate.initCalleeEndOffset - 1)` |
| `unknown-proof/semantic-checks.ts` | 437 | `semantic.collectTypeAt(filePath, candidate.initObjectEndOffset - 1)` |
| `unknown-proof/semantic-checks.ts` | 451 | `semantic.collectTypeAt(filePath, candidate.iterableEndOffset - 1)` |

#### P2-2. `_ctx.semanticLayer.collectFileTypes` → `getFileTypes`

0.10.0+에서 `getFileTypes` public API 추가됨. **1:1 교체 가능 (변환 불필요).**

```typescript
// 현재 (private API)
_ctx.semanticLayer.collectFileTypes(filePath: string): Map<number, ResolvedType>;

// 0.10.0+ (public API) — 동일 시그니처, Map key = byte offset
getFileTypes(filePath: string): Map<number, ResolvedType>;
```

| 파일 | 라인 | 변경 |
| ---- | ---- | ---- |
| `unknown-proof/semantic-checks.ts` | 367 | `semantic.collectFileTypes(filePath)` → `gildash.getFileTypes(filePath)` |

#### P2-3. `_ctx.semanticLayer.findReferences` → `getSemanticReferencesAtPosition`

0.11.0에서 position 기반 API 추가됨. **시그니처 동일, 직접 교체 가능.**

```typescript
// Before (private API)
const refs = _ctx.semanticLayer.findReferences(filePath, candidate.offset);

// After (0.11.0 public API — 동일 시그니처)
const refs = gildash.getSemanticReferencesAtPosition(filePath, candidate.offset);
```

| 파일 | 라인 | 현재 | 교체 |
| ---- | ---- | ---- | ---- |
| `unknown-proof/semantic-checks.ts` | 384 | `semantic.findReferences(filePath, candidate.offset)` | `gildash.getSemanticReferencesAtPosition(filePath, candidate.offset)` |
| `unknown-proof/semantic-checks.ts` | 467 | `semantic.findReferences(filePath, candidate.offset)` | `gildash.getSemanticReferencesAtPosition(filePath, candidate.offset)` |

name 기반 변환 불필요. 동명 심볼 문제도 해소됨 (position으로 정확히 식별).

#### P2-4. `getSemanticLayer` 헬퍼 통합 및 제거

P2-1 ~ P2-3 완료 후 두 feature의 `getSemanticLayer` 함수와 `SemanticLayerAccess` 인터페이스 모두 제거. public API를 직접 호출하도록 변경.

| 파일 | 라인 | 변경 |
| ---- | ---- | ---- |
| `error-flow/analyzer.ts` | 16-30 | `SemanticLayerAccess` + `getSemanticLayer()` 제거 |
| `unknown-proof/semantic-checks.ts` | 309-344 | `SemanticLayerAccess` + `getSemanticLayer()` 제거 |

**테스트 영향 범위:**

| 파일 | `_ctx` mock 위치 | 영향 |
| ---- | ---------------- | ---- |
| `error-flow/analyzer.spec.ts` | 26행 (`_ctx.semanticLayer.collectTypeAt` mock), 1325행 (`semanticLayer: null`) | `_ctx` mock → public API (`getResolvedTypeAt`) mock으로 변경. 해당 mock을 사용하는 모든 테스트 케이스에 영향. |
| `unknown-proof/semantic-checks.spec.ts` | 527-536행 (`collectTypeAt`/`collectFileTypes`/`findReferences` mock) | public API mock으로 변경 |

### P3: 방어 코드 정리 (0.9.4 트리 보장 기반, 0.11.0 설치 후)

0.9.4에서 `ResolvedType` JSDoc에 유한 트리 보장 명시됨:
- 최대 depth 8, 순환참조 없음 (acyclic)
- truncation 시 `members`/`typeArguments`는 `undefined`, `text`는 항상 존재

**`MAX_TYPE_DEPTH`는 gildash 내부 상수 (export 안 됨).** 값(8)을 참조하려면 하드코딩 필요.

| 항목 | 파일 | 라인 | 결정 | 근거 |
| ---- | ---- | ---- | ---- | ---- |
| `isPromiseLike` 재귀 | `error-flow/analyzer.ts` | 32-38 | **유지** | depth guard 없으나 depth 8 보장으로 안전. 현재 코드가 간결하며 불필요한 변경 회피 |
| `containsUnknownOrAny` visited Set | `unknown-proof/semantic-checks.ts` | 23-70 | **제거** | acyclic 보장으로 `visited` Set 불필요. 메모리 할당 + Set.has 오버헤드 제거 |

### P4: 미사용 Public API 활용 (0.11.0 설치 후)

#### P4-1. Semantic API (0.10.0~0.11.0)

| API | 시그니처 | 활용 | 선행 검증 |
| --- | ------- | ---- | --------- |
| **`isTypeAssignableToAt`** | `(opts: { source: { filePath, line, column }, target: { filePath, line, column } }) => boolean \| null` | error-flow `isPromiseLike` 패턴 매칭 → tsc 타입 호환성 검사 교체 | **미확인**: gildash가 `lib.es5.d.ts` (TypeScript 내장) 파일을 인덱싱/semantic 분석 대상에 포함하는지 확인 필요. `PromiseLike` 선언 위치는 TS 버전마다 다르므로 하드코딩 불가 — `searchSymbols({ text: 'PromiseLike', exact: true })` 등으로 런타임 탐색 필요 |
| **`isTypeAssignableTo`** | `(srcSymbol, srcFile, dstSymbol, dstFile, project?) => boolean \| null` | symbol name 기반 타입 호환성. `isTypeAssignableToAt`보다 단순할 수 있음 | 동일 — `PromiseLike`의 `dstFile` 확인 필요 |
| `searchSymbols({ resolvedType })` | `resolvedType: string` 필터 | Promise 반환 함수 일괄 검색 — error-flow 분석 대상 사전 필터링 | semantic: true 필요 |

#### P4-2. Analysis API (기존, 미활용)

| API | 활용 | 비고 |
| --- | ---- | ---- |
| **`getImplementations`** | Error 서브클래스 자동 탐색. `Implementation.isExplicit`으로 duck-typing 구분 | **미확인**: `lib.es5.d.ts`의 `Error` 인덱싱 여부. 이미 `getHeritageChain` 기반 검증이 `error-flow/analyzer.ts:1660`에 있으므로 중복 여부 확인 필요 |
| **`getFanMetrics`** | ~~coupling 디텍터 위임~~ → **부적합**. coupling은 gildash 미사용, `DependencyAnalysis.adjacency`(dependencies 결과)를 입력으로 순수 동기 계산. `getFanMetrics`는 async API이므로 파이프라인 구조 변경 필요 | 단독 활용은 가능 (coupling 디텍터 외부에서) |
| `getFullSymbol` | 디텍터 결과에 JSDoc, decorators, members 등 풍부한 컨텍스트 추가 | |
| `getFileStats` | 파일 복잡도 기반 분석 (lineCount, symbolCount, relationCount) | |
| `getModuleInterface` | public export 분석 — 과도한 export 감지 | |
| `getSemanticModuleInterface` | export + resolved type — public API 타입 안정성 분석 | semantic: true 필요 |
| `resolveSymbol` | indirection 디텍터 re-export 체인 깊이 분석. `circular` 필드로 순환 re-export 감지 | |
| `diffSymbols` | PR 단위 분석 — 변경 전후 비교 | |
| `getInternalRelations` | 파일 내부 relation 분석 | |
| `getAffected` | incremental scan: 변경 파일의 영향 범위만 재분석 | |
| `getTransitiveDependencies` | 의존성 깊이/폭 분석 | |
| `getDependencies` / `getDependents` | 직접 import/importer 조회. 그래프 불필요할 때 | |
| `hasCycle` | 순환 의존성 boolean 체크. `getCyclePaths` 전에 빠른 확인용 | |
| `getResolvedType` | symbol name 기반 타입 조회. position 기반(`getResolvedTypeAt`)과 달리 DB 조회 포함 | |
| `getSymbolsByFile` | 파일 내 모든 심볼 조회 | |
| `listIndexedFiles` | 인덱싱된 전체 파일 목록 | |
| `getStats` | 프로젝트 통계 (대시보드/리포트) | |
| `searchAllSymbols` / `searchAllRelations` | 크로스 프로젝트 검색 (모노레포) | |

#### P4-3. Annotation & Changelog API (0.9.0 신규)

| API | 활용 |
| --- | ---- |
| `searchAnnotations` | 주석 기반 탐지 — firebat 방침상 사용 안 함 |
| **`getSymbolChanges`** | incremental scan 최적화 — 변경된 심볼만 재분석. rename/move 감지 포함 |
| `pruneChangelog` | 오래된 변경 이력 정리, DB 크기 관리 |

#### P4-4. Search API 확장 (0.10.0)

| 필드 | 위치 | 설명 |
| ---- | ---- | ---- |
| `srcFilePathPattern` | `RelationSearchQuery` | glob 패턴으로 소스 파일 필터 (Bun.Glob 기반, **앱 레벨 필터링 — DB 인덱스 미사용**). `srcFilePath`와 상호 배타적. `limit`과 함께 사용 권장 |
| `dstFilePathPattern` | `RelationSearchQuery` | glob 패턴으로 대상 파일 필터. `dstFilePath`와 상호 배타적 |

#### P4-5. IndexResult 확장 (0.10.0)

```typescript
interface IndexResult {
    // 기존 필드: indexedFiles, removedFiles, totalSymbols, totalRelations,
    //   totalAnnotations, durationMs, changedFiles, deletedFiles, failedFiles

    changedSymbols: {
        added: Array<{ name; filePath; kind; isExported: boolean }>;   // isExported 추가 (0.10.0)
        modified: Array<{ name; filePath; kind; isExported: boolean }>; // isExported 추가 (0.10.0)
        removed: Array<{ name; filePath; kind; isExported: boolean }>; // isExported 추가 (0.10.0)
    };
    renamedSymbols: Array<{ oldName; newName; filePath; kind; isExported }>;  // 신규 (0.10.0)
    movedSymbols: Array<{ name; oldFilePath; newFilePath; kind; isExported }>; // 신규 (0.10.0, incremental only)
    changedRelations: {                                                       // 신규 (0.10.0)
        added: Array<{ type; srcFilePath; dstFilePath; srcSymbolName; dstSymbolName; dstProject; metaJson }>;
        removed: Array<{ type; srcFilePath; dstFilePath; srcSymbolName; dstSymbolName; dstProject; metaJson }>;
    };
}
```

활용: incremental scan, PR 단위 분석, 변경 추적.

#### P4-6. DependencyGraph 직접 사용

`DependencyGraph` 클래스가 패키지에서 직접 export됨. **`build()` 호출 후에만 쿼리 가능.**

Gildash 파사드에 노출되지 않은 메서드:

| 메서드 | 설명 | 활용 |
| ------ | ---- | ---- |
| **`getTransitiveDependents(filePath)`** | 역방향 transitive — 특정 파일에 transitively 의존하는 모든 파일 | incremental scan 영향 범위. `getAffected`와 유사하나 단일 파일용 |
| **`patchFiles(changed, deleted, getRelations)`** | incremental 그래프 업데이트 — 전체 rebuild 없이 변경분만 패치 | watch 모드 성능 최적화 |
| **`getAffectedByChange(changedFiles)`** | 변경 파일의 transitive dependents 합집합 | Gildash 파사드 `getAffected`의 원본 |
| **`getAdjacencyList()`** | 전체 import 그래프를 `Map<string, string[]>`로 반환 | Gildash 파사드 `getImportGraph`의 원본 |

#### P4-7. Event System (0.8.0+, 미활용)

| API | 설명 | 활용 |
| --- | ---- | ---- |
| `onIndexed(cb)` | 인덱싱 완료 이벤트 | watch 모드에서 자동 재스캔 트리거 |
| `onFileChanged(cb)` | 파일 변경 이벤트 | 실시간 분석 (IDE/MCP 통합) |
| `onError(cb)` | 에러 이벤트 | 에러 로깅/알림 |
| `onRoleChanged(cb)` | owner/reader 역할 변경 | 멀티 프로세스 모니터링 |
| `reindex()` | 강제 전체 재인덱싱 | owner 전환 후 동기화 |

#### P4-8. Low-level API (미활용)

| API | 설명 | 활용 |
| --- | ---- | ---- |
| `parseSource(filePath, sourceText, options?)` | 단일 파일 파싱 + LRU 캐시 | firebat의 oxc-parser 직접 파싱을 gildash 캐시로 전환 |
| `extractSymbols(parsed)` / `extractRelations(parsed)` | gildash 추출기 직접 사용 | 추출 로직 재사용 |
| `getParsedAst(filePath)` | 캐시된 AST 조회 (read-only) | 이중 파싱 제거 — gildash가 이미 파싱한 AST 재사용 |

#### P4-9. GildashOptions 미활용 설정

| 옵션 | 현재 | 활용 |
| ---- | ---- | ---- |
| `ignorePatterns` | 미사용 | firebat `.firebatrc.jsonc`의 `exclude` 패턴과 연동하여 gildash 인덱싱 범위 제한 |
| `parseCacheCapacity` | 미사용 (기본값 500) | 대규모 프로젝트 스캔 시 캐시 크기 튜닝 |
| `logger` | 미사용 (기본값 console) | firebat 로거 연동으로 gildash 에러를 firebat 로그 스트림에 통합 |

#### P4-10. GildashError 활용

현재 `createGildash()`에서 `e instanceof GildashError ? e.message : String(e)` 패턴만 사용. `GildashError.type` (discriminated union)을 활용한 세분화된 에러 처리 가능:

| type | 활용 |
| ---- | ---- |
| `semantic` | semantic 초기화 실패 → AST-only fallback (현재 catch-all로 처리) |
| `closed` | 닫힌 인스턴스 접근 → 재생성 로직 |
| `validation` | 잘못된 입력 → 사용자 피드백 |
| `parse` | 파싱 실패 → 개별 파일 skip |

#### P4-11. BatchParseResult.failures 활용

현재 `ts-program.ts`에서 `batchParse` 결과의 `failures` 필드를 무시하고 `parsed`만 사용. 파싱 실패 파일에 대한 경고/리포트 개선 가능.

### P6: 디텍터별 gildash 활용 강화

현재 17개 디텍터 중 5개만 gildash 사용. 나머지 12개 중 활용 가능한 디텍터 분석.

#### P6-1. barrel 디텍터 — re-export relation 활용 (High)

현재 `barrel/analyzer.ts`의 `checkCrossModuleReexport()` (431-622행)에서 커스텀 resolver로 import 경로를 수동 resolve하고 AST를 직접 파싱하여 re-export 관계 분석.

**대체**: `searchRelations({ type: 're-exports' })`로 gildash relation index에서 직접 조회.

| 현재 | 대체 | 효과 |
| ---- | ---- | ---- |
| 커스텀 resolver + AST 파싱 | `searchRelations({ type: 're-exports' })` | O(files × imports) → O(1) lookup |
| manual re-export origin 추적 | `resolveSymbol()` | re-export 체인 자동 추적 |

**수정 파일**: `BarrelOptions` 인터페이스에 `gildash?: Gildash` 추가, `analyzeBarrel` 시그니처 변경, `scan.usecase.ts`에서 barrel 호출 시 gildash 전달.

#### P6-2. coupling 디텍터 — getImportGraph 직접 사용 (Medium)

현재 `DependencyAnalysis.adjacency` (dependencies 디텍터 결과)를 입력으로 받아 순수 동기 계산. dependencies 디텍터에 강한 결합.

**대안**: `getImportGraph()` 직접 호출로 dependencies 결합도 제거. 단, `getImportGraph()`는 async이므로 coupling 분석기의 동기 구조 변경 필요. 비용 대비 효과 검토 필요.

#### P6-3. temporal-coupling — getParsedAst 공식화 (Medium)

현재 `temporal-coupling/analyzer.ts:845-863`에서 **이미 `(gildash as any).getParsedAst`로 캐시된 AST를 사용 중**. `getParsedAst`는 이전 버전부터 Gildash 클래스의 public 메서드로 존재했으나, firebat이 `as any` 캐스팅으로 접근. 0.11.0에서도 동일하게 public이므로 캐스팅 제거 가능.

```typescript
// Before (현재)
const getParsedAst = (gildash as any).getParsedAst as ((filePath: string) => unknown) | undefined;

// After (0.11.0)
const parsed = gildash.getParsedAst(callerFilePath);
```

#### P6-4. indirection — semantic wrapper detection (Medium)

현재 파라미터 pass-through 패턴만 확인. gildash semantic이 활성화되면 function overload 감지 가능 — 동일 함수명이지만 다른 signature를 가진 경우 wrapper가 아님을 판별.

#### P6-5. 강화 불필요한 디텍터 (7개)

| 디텍터 | 이유 |
| ------ | ---- |
| collapsible-if | 순수 control flow 패턴. AST만 필요 |
| early-return | 순수 control flow 패턴. AST만 필요 |
| duplicates | 순수 AST 구조 비교. semantic 강화 시 false positive 감소 가능하나 우선순위 낮음 |
| format | 외부 도구(oxfmt) 래퍼. gildash 관계 없음 |
| giant-file | 순수 메타데이터(줄 수). gildash 관계 없음 |
| lint | 외부 도구(oxlint) 래퍼. gildash 관계 없음 |
| waste | 내부 엔진에 위임. gildash 관계 없음 |
| typecheck | TypeScript 컴파일러 API 직접 호출. gildash semantic과 tsc Program 공유 불가 (gildash가 내부 tsc Program을 public으로 노출하지 않음) |

variable-lifetime, nesting은 현재 구조로 충분하나 inter-procedural 분석 확장 시 gildash call graph 활용 여지 있음 (장기).

### P7: 파싱 파이프라인 정리

#### 현재 파싱 구조

```
scan.usecase.ts → createFirebatProgram() → gildash.batchParse(files)
                                              ↓
                                     BatchParseResult.parsed (Map<string, ParsedFile>)
                                              ↓
                                     Array.from(parsed.values()) → ParsedFile[]
                                              ↓
                                     각 디텍터에 동일한 ParsedFile[] 전달
```

**핵심 사실**: gildash가 firebat의 유일한 파서. 이중 파싱 없음. `ParsedFile` 타입이 gildash와 firebat에서 구조적으로 동일 (`filePath`, `program`, `errors`, `comments`, `sourceText`).

#### P7-1. firebat 자체 parseSource 대체 검토

firebat은 `engine/ast/parse-source.ts`에 자체 `parseSource` 함수 보유. oxc-parser를 직접 호출. 에디터 기능(`application/editor/edit.usecases.ts`)에서 단일 파일 파싱에 사용.

gildash의 `parseSource(filePath, sourceText, options?)` → 동일 입출력 타입 + LRU 캐시. 대체 시 캐싱 이점. 단, 에디터 기능은 gildash 인스턴스 없이 독립 동작해야 하므로 대체 부적합.

#### P7-2. getParsedAst 활용 확대

`getParsedAst(filePath)`는 gildash 내부 LRU 캐시에서 이미 파싱된 AST를 반환. temporal-coupling에서 이미 사용 중 (P6-3). 다른 디텍터에서 추가 파일의 AST가 필요할 때 (예: cross-file 분석) `getParsedAst`로 재파싱 없이 접근 가능.

### P5: 극한 활용 시나리오 (0.11.0 설치 후, 선행 검증 필요)

#### P5-1. `isTypeAssignableToAt`로 타입 비교 정밀화

**선행 검증**: gildash가 TypeScript 내장 `lib.d.ts` 파일을 semantic 분석 대상에 포함하는지 확인 필요. `lib.es5.d.ts`의 `PromiseLike` 선언 위치는 TS 버전마다 달라 하드코딩 불가.

가능한 접근:
1. `searchSymbols({ text: 'PromiseLike', exact: true })`로 런타임에 위치 탐색
2. symbol name 기반 `isTypeAssignableTo(srcSymbol, srcFile, 'PromiseLike', libFile)` 사용 (libFile도 런타임 탐색)
3. 불가능하면 현재 정규식 패턴 매칭 유지

#### P5-2. Incremental Scan

```typescript
const changes = gildash.getSymbolChanges(lastScanDate, { changeTypes: ['added', 'modified'] });
const affected = await gildash.getAffected(changes.map(c => c.filePath));
const targetsToRescan = [...new Set([...changes.map(c => c.filePath), ...affected])];
```

#### P5-3. PR 단위 분석

```typescript
const before = gildash.searchSymbols({ filePath: changedFile });
// ... reindex 후 ...
const after = gildash.searchSymbols({ filePath: changedFile });
const diff = gildash.diffSymbols(before, after);
```

#### P5-5. `getImplementations`로 Error 서브클래스 추적

**선행 검증**: P5-1과 동일 — `lib.es5.d.ts` 인덱싱 여부. 또한 이미 `getHeritageChain` 기반 검증이 `error-flow/analyzer.ts:1660`에 있으므로 중복 여부 확인 필요. `getImplementations`는 역방향(인터페이스 → 구현체) 탐색이라 `getHeritageChain`(구현체 → 부모)과 상호보완적.

## gildash API 사용 현황

### 사용 중인 Public API (14개)

| API | 패턴 | 반환값 | 비동기 | 사용처 |
| --- | ---- | ------ | ------ | ------ |
| `Gildash.open()` | 팩토리 | `Gildash` | O | `store/gildash.ts` |
| `searchRelations()` | 검색 | `StoredCodeRelation[]` | X | dependencies, indirection, temporal-coupling |
| `searchSymbols()` | 검색 | `SymbolSearchResult[]` | X | dependencies, indirection |
| `getImportGraph()` | 그래프 | `Map<string, string[]>` | O | dependencies |
| `getCyclePaths()` | 그래프 | `string[][]` | O | dependencies |
| `getFileInfo()` | 메타 | `FileRecord \| null` | X | inputs-digest, project-inputs-digest |
| `batchParse()` | 파싱 | `BatchParseResult` | O | ts-program |
| `getHeritageChain()` | 상속 | `HeritageNode` | O | error-flow, trace-symbol |
| `findPattern()` | 패턴 | `PatternMatch[]` | O | find-pattern |
| `getSemanticReferences()` | 참조 | `SemanticReference[]` | X | trace-symbol |
| `getDependencies()` / `getDependents()` | 그래프 | `string[]` | X | MCP server |
| `getSymbolsByFile()` | 검색 | `SymbolSearchResult[]` | X | MCP server |
| `getParsedAst()` | 캐시 | `ParsedFile \| undefined` | X | temporal-coupling (`as any` 캐스팅) |
| `close()` | 정리 | `void` | O | 모든 사용처 |

### 제거된 API 호출 (Breaking — P8-0)

| API | 사용처 | 상태 |
| --- | ------ | ---- |
| `indexExternalPackages()` | MCP server (server.ts:519) | **gildash 0.6.0에서 제거됨.** 0.11.0 업그레이드 시 런타임 에러 |

### 사용 중인 Private API (3개)

| API | 시그니처 | 사용처 | 0.11.0 대체 |
| --- | ------- | ------ | ---------- |
| `_ctx.semanticLayer.collectTypeAt` | `(filePath, position) → ResolvedType \| null` | error-flow (1곳), unknown-proof (6곳) = **총 7곳** | `getResolvedTypeAtPosition(file, offset)` — **시그니처 동일, 변환 불필요** |
| `_ctx.semanticLayer.collectFileTypes` | `(filePath) → Map<number, ResolvedType>` | unknown-proof (1곳) | `getFileTypes(file)` — 1:1 교체 |
| `_ctx.semanticLayer.findReferences` | `(filePath, position) → SemanticReference[]` | unknown-proof (2곳) | `getSemanticReferencesAtPosition(file, offset)` — **시그니처 동일, 변환 불필요** |

### 미사용 Public API 우선순위

| API | 버전 | 우선순위 | 카테고리 |
| --- | ---- | ------- | -------- |
| `getResolvedTypeAt` | 0.10.0 | P4 | line/column 기반 타입 조회 (P2는 position 기반 `getResolvedTypeAtPosition` 사용) |
| `getFileTypes` | 0.10.0 | **P2** | private API 대체 (collectFileTypes) |
| `isTypeAssignableToAt` | 0.10.0 | **P5** | 검증 후 활용 |
| `isTypeAssignableTo` | 0.10.0 | **P5** | 검증 후 활용 |
| `getImplementations` | 0.6.0 | **P5** | 검증 후 활용 |
| `searchAnnotations` | 0.9.0 | — | 주석 기반 — 사용 안 함 |
| `getSymbolChanges` | 0.9.0 | **P5** | incremental scan |
| `getFullSymbol` | 0.4.0 | P4 | 컨텍스트 강화 |
| `resolveSymbol` | 0.4.0 | P4 | re-export 분석 |
| `diffSymbols` | 0.4.0 | P5 | PR 분석 |
| `getAffected` | 0.4.0 | P5 | incremental scan |
| `getFanMetrics` | 0.4.0 | P4 | 단독 활용 (coupling 디텍터 위임은 구조적 부적합) |
| `getResolvedType` | 0.6.0 | P4 | symbol name 기반 타입 |
| `hasCycle` | 0.4.0 | P4 | 빠른 순환 체크 |
| `getSemanticModuleInterface` | 0.6.0 | P4 | export + type 분석 |
| `getFileStats` | 0.4.0 | P4 | 파일 복잡도 |
| `getModuleInterface` | 0.4.0 | P4 | public export 분석 |
| `getInternalRelations` | 0.4.0 | P4 | 파일 내부 관계 |
| `getTransitiveDependencies` | 0.4.0 | P4 | 의존성 깊이 |
| `getSymbolsByFile` | 0.3.0 | P4 | 파일 내 심볼 |
| `listIndexedFiles` | 0.4.0 | P4 | 파일 목록 |
| `getStats` | 0.3.0 | P4 | 통계 |
| `searchAllSymbols` / `searchAllRelations` | 0.4.0 | P4 | 모노레포 |
| `pruneChangelog` | 0.9.0 | P4 | DB 관리 |
| `onIndexed` / `onFileChanged` / `onError` / `onRoleChanged` | 0.8.0 | P4 | 이벤트 |
| `reindex` | 0.4.0 | P4 | 강제 재인덱싱 |
| `parseSource` / `extractSymbols` / `extractRelations` | 0.3.0+ | P4 | low-level |
| `getParsedAst` | 0.3.0 | P4 | 캐시 재사용 |
| `getSemanticDiagnostics` | **0.11.0** | **P4** | **tsc diagnostics — typecheck 디텍터 `ts.createProgram()` 제거** |
| `getTransitiveDependents` | **0.11.0** | **P4** | **파사드 추가 — DependencyGraph 직접 사용 불필요** |
| `lineColumnToPosition` | **0.11.0** | P4 | tsc 좌표 변환 |
| `findNamePosition` | **0.11.0** | P4 | 선언 위치 → identifier position |
| `getSymbolNode` | **0.11.0** | P4 | tsc 심볼 그래프 노드 접근 |
| `getResolvedTypeAtPosition` | **0.11.0** | **P2** | **private API 대체 (collectTypeAt)** |
| `getSemanticReferencesAtPosition` | **0.11.0** | **P2** | **private API 대체 (findReferences)** |
| `getImplementationsAtPosition` | **0.11.0** | P4 | position 기반 구현체 탐색 |
| `isTypeAssignableToAtPosition` | **0.11.0** | P4 | position 기반 타입 호환성 검사 |

### exported 타입 현황

gildash 0.11.0에서 export하는 주요 타입 중 firebat이 활용할 수 있는 것:

| 타입 | 현재 사용 | 활용 가능성 |
| ---- | --------- | ---------- |
| `ResolvedType` | O (로컬 정의) | P0-1에서 직접 import로 전환 |
| `SemanticReference` | O (로컬 정의) | P0-1에서 직접 import로 전환 |
| `CodeRelation` | O (테스트) | |
| `SymbolSearchResult` | O (테스트) | |
| `PatternMatch` | O | |
| `GildashError` | O | P4-10에서 `.type` 활용 강화 |
| `Implementation` | X | P5-5 (Error 구현체 탐색) |
| `SemanticModuleInterface` | X | P4-2 (export + type 분석) |
| `SemanticExport` | X | `SemanticModuleInterface.exports`의 항목 타입. **index.d.ts에서 직접 export되지 않음** — `SemanticModuleInterface`를 통해 간접 접근만 가능 |
| `BatchParseResult` | O (암묵적) | P4-11에서 `.failures` 활용 |
| `StoredCodeRelation` | O (암묵적) | `dstProject` 필드 활용 |
| `FullSymbol` | X | P4-2 (풍부한 컨텍스트) |
| `FileStats` / `FanMetrics` | X | P4-2 |
| `ResolvedSymbol` | X | P4-2 (re-export 분석) |
| `SymbolDiff` | X | P5-4 (PR 분석) |
| `HeritageNode` | O | |
| `AnnotationSearchResult` / `AnnotationSearchQuery` | X | 주석 기반 — 사용 안 함 |
| `SymbolChange` / `SymbolChangeType` / `SymbolChangeQueryOptions` | X | P5-3 (incremental scan) |
| `AnnotationSource` / `ExtractedAnnotation` | X | 주석 기반 — 사용 안 함 |
| `SymbolStats` | X | `getStats()` 반환 타입 |
| `GildashErrorType` | X | `GildashError.type` discriminated union (P4-10) |
| `ParsedFile` (gildash) | O (암묵적) | firebat `ParsedFile`과 구조 동일 |
| `GildashInternalOptions` | O (암묵적) | `Gildash.open()` 인자 타입에 포함. `store/gildash.ts`에서 간접 사용 |
| `PatternSearchOptions` | X | `findPattern` 옵션 타입 |
| `IndexResult` | X (직접 사용 안 함) | P4-5 (changedRelations 등 활용) |
| `ProjectBoundary` | X | 모노레포 경계 분석 |
| `WatcherRole` | X | 멀티 프로세스 모니터링 |
| `SymbolKind` | X (간접 사용) | 타입 안전한 kind 필터링 |
| `FileRecord` | O (암묵적) | `getFileInfo` 반환 타입 |
| `GildashOptions` | O (테스트) | |
| `DependencyGraph` | X | P4-6 (직접 사용) |
| `SymbolNode` | X (0.11.0+) | `getSymbolNode` 반환 타입. tsc 심볼 그래프 노드 |
| `SemanticDiagnostic` | X (0.11.0+) | `getSemanticDiagnostics` 반환 타입. typecheck 디텍터 대체 |

### exported 값(함수) 현황

gildash 0.11.0에서 export하는 값(non-type) 심볼:

| 함수 | 설명 | firebat 활용 |
| ---- | ---- | ----------- |
| `Gildash` | 메인 클래스 | O (사용 중) |
| `GildashError` | 에러 클래스 | O (사용 중) |
| `DependencyGraph` | 그래프 클래스 | X (P4-6 직접 사용) |
| `symbolSearch` | Gildash 인스턴스 없이 심볼 검색 가능 | X — repo 객체 직접 주입 필요. firebat에서는 Gildash 파사드 사용이 적합 |
| `relationSearch` | Gildash 인스턴스 없이 관계 검색 가능 | X — 동일 |
| `patternSearch` | Gildash 인스턴스 없이 패턴 검색 가능 | X — 동일 |
| `gildashError` | 에러 팩토리 함수 | X — **@deprecated.** 사용 금지. `new GildashError()` 또는 `throw` 직접 사용 |

### Gildash 인스턴스 getter

| getter | 타입 | firebat 활용 |
| ------ | ---- | ----------- |
| `projectRoot` | `string` | X — 인덱싱된 프로젝트 루트 경로 |
| `role` | `'owner' \| 'reader'` | X — 멀티 프로세스 모니터링에 활용 가능 |
| `projects` | `ProjectBoundary[]` | X — P8-4 모노레포 지원 |

### `_ctx` 접근 상태 (0.11.0)

`_ctx`는 0.11.0에서도 `readonly _ctx: GildashContext`로 노출. JSDoc에 "advanced testing only". 0.11.0에서 주요 내부 메서드가 public화되어 `_ctx` 직접 접근이 불필요해짐.

`SemanticLayerLike`의 전체 메서드:

| 메서드 | public API 대응 | 비고 |
| ------ | -------------- | ---- |
| `collectTypeAt(file, pos)` | `getResolvedTypeAtPosition(file, pos)` | **0.11.0에서 1:1 대응** |
| `collectFileTypes(file)` | `getFileTypes(file)` | 1:1 대응 |
| `findReferences(file, pos)` | `getSemanticReferencesAtPosition(file, pos)` | **0.11.0에서 1:1 대응** |
| `findImplementations(file, pos)` | `getImplementationsAtPosition(file, pos)` | **0.11.0에서 1:1 대응** |
| `isTypeAssignableTo(srcFile, srcPos, dstFile, dstPos)` | `isTypeAssignableToAtPosition(srcFile, srcPos, dstFile, dstPos)` | **0.11.0에서 1:1 대응** |
| `getModuleInterface(file)` | `getSemanticModuleInterface(file)` | 대응 |
| `getSymbolNode(file, pos)` | `getSymbolNode(file, pos)` | **0.11.0에서 public 추가** |
| `lineColumnToPosition(file, line, col)` | `lineColumnToPosition(file, line, col)` | **0.11.0에서 public 추가** |
| `findNamePosition(file, declarationPos, name)` | `findNamePosition(file, declarationPos, name)` | **0.11.0에서 public 추가** |
| `notifyFileChanged(file)` / `notifyFileDeleted(file)` | — | 내부 lifecycle |
| `dispose()` / `isDisposed` | `close()` | 파사드에서 래핑 |

### P8: 미탐색 영역

#### P8-0. MCP 서버의 제거된 API 호출 (Breaking)

`src/adapters/mcp/server.ts:519`에서 `gildash.indexExternalPackages(args.packages)` 호출. **이 API는 gildash 0.6.0에서 제거됨.** 현재 0.8.0에서는 런타임에 존재할 수 있으나 (타입 정의에는 없음), 0.11.0 업그레이드 시 **확실히 런타임 에러 발생**. 해당 MCP 도구를 제거하거나, 대안 구현 필요 (gildash 0.6.0 changelog: "external package indexing is no longer supported").

#### P8-1. oxc-parser 버전 정합성

- firebat: `oxc-parser@0.114.0` (package.json)
- gildash 0.11.0: `oxc-parser@0.115.0` (dependency)

0.11.0 업그레이드 시 oxc-parser 버전 불일치. 현재는 gildash의 `batchParse()`를 통해 파싱하므로 문제 없으나, firebat이 oxc-parser를 직접 사용하는 곳(`engine/ast/parse-source.ts`)과 AST 구조 비호환 가능성. **업그레이드 시 firebat의 oxc-parser도 0.115.0으로 맞춰야 안전.**

#### P8-2. findPattern (ast-grep) 디텍터 활용

gildash의 `findPattern(pattern, opts?)` (ast-grep 기반 구조적 패턴 매칭)을 디텍터에서 활용 가능한 케이스:

| 디텍터 | 현재 | findPattern 대체 |
| ------ | ---- | --------------- |
| barrel | `checkExportStar()` — AST 수동 순회로 `ExportAllDeclaration` 탐지 | `findPattern('export * from $STR')` |
| error-flow | try-catch 블록 수동 탐지 | `findPattern('try { $$$ } catch ($E) { $$$ }')` — 후보 필터링 단계에 활용 |
| nesting | 중첩 if 수동 순회 | `findPattern('if ($$$) { if ($$$) { $$$ } }')` — 정밀도 낮을 수 있음 |

**제약**: ast-grep 패턴은 구조적 매칭만 지원. 데이터플로우/제어 흐름 분석 불가. 디텍터의 핵심 로직 대체는 어렵고, **후보 필터링 단계에서 AST 순회를 줄이는 용도**로 적합.

#### P8-3. MCP 서버 확장

현재 MCP 도구: scan, query-dependencies, symbols-by-file 등. 0.11.0 API로 추가 가능한 도구:

| 도구 | API | 설명 |
| ---- | --- | ---- |
| `find-pattern` | `findPattern()` | ast-grep 구조적 패턴 검색 |
| `search-symbols` | `searchAllSymbols()` | 크로스 프로젝트 심볼 검색 |
| `semantic-references` | `getSemanticReferences()` | 심볼의 모든 참조 추적 |
| `type-at-position` | `getResolvedTypeAt()` | 특정 위치의 타입 조회 |
| `symbol-changes` | `getSymbolChanges()` | 심볼 변경 이력 |

#### P8-4. 모노레포 지원

현재 firebat은 단일 프로젝트 전제. gildash의 모노레포 기능 미활용:

| API | 현재 사용 | 활용 가능성 |
| --- | --------- | ---------- |
| `gildash.projects` (getter) | 미사용 | 모노레포 패키지 경계 인식 → 패키지 간 의존성 분석 |
| `searchAllSymbols()` | 미사용 | 크로스 패키지 심볼 검색 |
| `searchAllRelations()` | 미사용 | 크로스 패키지 관계 검색 |
| `DependencyGraph({ additionalProjects })` | 미사용 | 크로스 프로젝트 import 그래프 |

#### P8-5. symbol-extractor-oxc.ts 제거

`src/engine/symbol-extractor-oxc.ts`는 firebat 자체 심볼 추출기. `application/editor/edit.usecases.ts`에서 사용 중 (spec.ts 외 유일한 사용처). gildash의 `extractSymbols()`와 70% 기능 중복. editor usecase가 gildash 인스턴스 없이 독립 동작해야 하므로 즉시 제거는 부적합. 장기적으로 gildash `extractSymbols(parsed)` 대체 검토.

#### P8-6. trace-symbol usecase 강화

현재 `getSemanticReferences()`, `getHeritageChain()` 사용. 추가 활용 가능:

| API | 활용 |
| --- | ---- |
| `getImplementations()` | 인터페이스의 모든 구현체 추적 |
| `resolveSymbol()` | re-export 체인 원본 심볼 추적 |
| `getFullSymbol()` | 심볼의 완전한 메타데이터 (JSDoc, decorators, members) |

### P9: 새 탐지 기능 (gildash API가 핵심 데이터 제공)

현재 firebat 17개 디텍터, ~75개 finding kind. 아래는 gildash API가 없으면 불가능하거나 비효율적인 탐지.

#### P9-1. `circular-reexport` — barrel 추가

```typescript
// 문제: 순환 re-export. 런타임 undefined, 번들러 무한루프.
// a.ts
export { Foo } from './b';
// b.ts
export { Foo } from './a';  // ← 순환
```

API: `resolveSymbol(name, file).circular === true`. 현재 **완전 미탐지**.

#### P9-2. `deep-reexport-chain` — barrel 추가

```typescript
// 문제: 4홉 re-export. tree-shaking 실패, 디버깅 어려움.
// index.ts → re-exports.ts → utils/index.ts → utils/helpers.ts → 실제 정의
export { helper } from './re-exports';
```

API: `resolveSymbol(name, file).reExportChain.length >= 3`.

#### P9-3. `orphan-file` — dependencies 추가

```typescript
// 문제: 아무 파일도 import하지 않는 파일. dead code 후보.
// src/utils/legacy-helper.ts ← getDependents() 결과 빈 배열
export const legacyHelper = () => {};  // 아무도 안 씀
```

API: `getDependents(file)` → 빈 배열 (진입점 제외).

#### P9-4. `large-transitive-footprint` — dependencies 추가

```typescript
// 문제: 하나의 import이 50개 모듈을 transitively 끌어옴.
import { tiny } from './mega-barrel';  // ← getTransitiveDependencies 결과 50+개
// 번들 크기 폭발, 빌드 시간 증가
```

API: `getTransitiveDependencies(file)` → 결과 수 > 임계값.

#### P9-5. `deep-inheritance` — error-flow 또는 신규 추가

```typescript
// 문제: 상속 깊이 > 4. 디버깅 어려움, 변경 영향 확대.
class A {}
class B extends A {}
class C extends B {}
class D extends C {}
class E extends D {}  // ← depth 5
```

API: `getHeritageChain(name, file)` → 트리 깊이 계산. 현재 error-flow가 Error 상속만 확인하고 **일반 상속 깊이는 미탐지**.

#### P9-6. `oversized-api-surface` — dependencies 또는 신규 추가

```typescript
// 문제: 한 모듈이 40개 심볼을 export. 인터페이스가 비대.
// utils.ts
export const a = ...;
export const b = ...;
// ... 40개
```

API: `getModuleInterface(file).exports.length > 임계값`.

#### P9-7. `dead-interface` — 신규 디텍터

```typescript
// 문제: 인터페이스 선언했으나 구현체 0개. dead code.
export interface IPaymentProcessor {  // ← getImplementations 결과 빈 배열
  process(amount: number): void;
}
```

API: `getImplementations(name, file)` → 결과 비어있음. false positive 주의 (외부 패키지 구현 가능).

#### P9-8. `missing-implements` — 신규 디텍터

```typescript
// 문제: 인터페이스 구조를 만족하지만 implements 미선언. 인터페이스 변경 시 조용히 깨짐.
interface Logger {
  info(msg: string): void;
  error(msg: string): void;
}

class ConsoleLogger {  // ← Logger와 구조 일치하지만 implements 없음
  info(msg: string) { console.log(msg); }
  error(msg: string) { console.error(msg); }
}
// Logger에 warn() 추가하면 ConsoleLogger는 컴파일 에러 없이 런타임에 깨짐
```

API: `getImplementations(name, file)` → `isExplicit: false` + `kind === 'class'` 필터. 프로젝트 내부 class만 대상 (객체 리터럴, 외부 라이브러리 제외).

#### P9-9. `low-export-ratio` — giant-file 추가

```typescript
// 문제: 심볼 50개인데 export 2개. 나머지 48개는 사문화 가능성.
// big-module.ts (500줄, 내부 헬퍼 48개, export 2개)
const helper1 = ...;  // 안 쓰일 수도
const helper2 = ...;
// ...
export const publicA = ...;
export const publicB = ...;
```

API: `getFileStats(file)` → `exportedSymbolCount / symbolCount < 0.1`.

#### 우선순위

| 순위 | Kind | 이유 |
| ---- | ---- | ---- |
| **1** | `circular-reexport` | 런타임 버그 직결. 현재 완전 미탐지 |
| **2** | `orphan-file` | dead code 식별. 구현 단순 |
| **3** | `deep-reexport-chain` | tree-shaking 직결 |
| **4** | `deep-inheritance` | 설계 품질. 구현 단순 |
| **5** | `oversized-api-surface` | 모듈 설계 품질 |
| **6** | `large-transitive-footprint` | 번들 크기 직결 |
| **7** | `low-export-ratio` | 사문화 코드 |
| **8** | `dead-interface` | false positive 관리 필요 |
| **9** | `missing-implements` | 프로젝트 내부 class만 대상, 인터페이스 변경 시 조용한 breakage 방지 |

#### P9-10. `high-churn-symbol` — 신규 디텍터

```typescript
// 문제: 자주 수정되는 심볼 = 유지보수 핫스팟. 설계 불안정 신호.
// getSymbolChanges 결과: processOrder가 최근 30일간 12회 modified
export const processOrder = () => { /* 계속 바뀜 */ };
```

API: `getSymbolChanges(since, { changeTypes: ['modified'] })` → 심볼별 변경 빈도 집계. 임계값 초과 시 finding. **단일 API로는 불가능 — changelog 데이터 기반 시계열 분석.**

#### P9-11. API 조합 복합 분석

단일 API로 불가능하지만, 조합하면 가능한 탐지:

**`type-unsafe-import`** — 타입에 `any`가 포함된 심볼을 import하는 경우:

```typescript
// lib.ts
export const parse = (input: any): any => {};  // ← any 반환

// consumer.ts
import { parse } from './lib';  // ← any가 전파됨
const result = parse(data);     // result: any — 타입 안전성 소실
```

API: `searchSymbols({ resolvedType: 'any' })` → any 타입 심볼 목록 + `searchRelations({ dstSymbolName, type: 'imports' })` → 사용처. semantic: true 필요.

**`override-without-call`** — 부모 메서드를 override하지만 super 호출 없음:

```typescript
class Base {
  init() { /* 중요 초기화 */ }
}
class Child extends Base {
  init() { /* super.init() 빠짐 — 부모 초기화 누락 */ }
}
```

API: `getHeritageChain(name, file)` → 부모 확인 + `getFullSymbol(name, file).members` → 메서드 목록 비교 + AST에서 super 호출 확인. 구현 난이도 높음.

## 주의사항

- gildash `ResolvedType.members`/`typeArguments`는 mutable `ResolvedType[]`. firebat에서 immutable하게 사용하려면 소비 시점에서 `as readonly` 처리.
- depth=8에서 truncation 시 `members`/`typeArguments`가 `undefined`. `text` 필드는 모든 depth에서 항상 채워짐.
- `MAX_TYPE_DEPTH`는 gildash 내부 상수 (export 안 됨). firebat에서 참조하려면 하드코딩(8) 필요.
- `RelationSearchQuery`의 `srcFilePathPattern`/`dstFilePathPattern`는 앱 레벨(Bun.Glob) 필터링. DB 인덱스를 타지 않으므로 `limit`과 함께 사용 권장.
- 0.11.0 position 기반 API (`getResolvedTypeAtPosition`, `getSemanticReferencesAtPosition` 등)는 byte offset 직접 사용. 0.10.0의 line/column 기반 API (`getResolvedTypeAt`, `isTypeAssignableToAt`)도 여전히 사용 가능하며 1-based line, 0-based column 기반.
- `CodeRelation.type`에 `'type-references'` 관계 타입 존재. `import type` 관계를 별도 추적 가능 — 현재 firebat에서 미활용.
- `searchRelations()` 반환 타입은 `Gildash` 클래스에서 `CodeRelation[]`로 선언되어 있으나, 실제 런타임 반환값은 `StoredCodeRelation` (`dstProject` 포함). `dstProject` 사용 시 명시적 타입 단언 또는 `StoredCodeRelation`으로 캐스팅 필요.
- `gildashError()` 팩토리 함수는 **@deprecated**. 사용하지 말 것. `new GildashError()` 또는 throw 직접 사용.
- `indexExternalPackages()` API는 gildash 0.6.0에서 제거됨. MCP 서버(server.ts:519)에서 호출 중 — 0.11.0 업그레이드 전 반드시 제거 (P8-0).

## 실행 로드맵

### Phase 1: 업그레이드 + 안전한 교체

1. P0-1: `ResolvedType`/`SemanticReference` 로컬 정의 제거 → `@zipbul/gildash` re-export (업그레이드 불필요)
2. 코드 리뷰로 `import type` 확인 (firebat `DEP_LAYER_VIOLATION`으로 검증)
3. P8-0: MCP 서버의 `indexExternalPackages()` 호출 제거 또는 대안 구현
4. P8-1: firebat의 oxc-parser를 0.115.0으로 업데이트 (gildash 0.11.0과 정합성)
5. `bun update @zipbul/gildash` → 0.11.0
6. `bun test` 전체 실행 → 회귀 확인
7. P2-2: `collectFileTypes` → `getFileTypes` 교체 (1:1, 즉시 가능)
8. P3: `containsUnknownOrAny`의 `visited` Set 제거 — **단, gildash가 ResolvedType 트리에서 동일 객체 공유(shared node)를 하지 않는 것을 확인한 후에만 제거. 확인 불가 시 유지.**

### Phase 2: private API 제거 (gildash 0.11.0 배포 완료 — 즉시 실행 가능)

0.11.0의 position 기반 API로 **변환 로직 없이 직접 교체**:

1. P2-1: `collectTypeAt` 7곳 → `getResolvedTypeAtPosition(file, offset)` (시그니처 동일)
2. P2-2: `collectFileTypes` 1곳 → `getFileTypes(file)` (시그니처 동일)
3. P2-3: `findReferences` 2곳 → `getSemanticReferencesAtPosition(file, offset)` (시그니처 동일)
4. P2-4: `getSemanticLayer` 헬퍼 + `SemanticLayerAccess` 인터페이스 제거
5. 테스트 mock 구조 업데이트 (`_ctx` mock → public API mock)
6. `bun test` 전체 실행 → 회귀 확인

### Phase 3: 선행 검증 ✅ 완료 (2026-03-23)

#### 검증 항목

gildash semantic API가 lib.d.ts 타입(PromiseLike, Error 등)을 활용할 수 있는지 확인.

#### 검증 결과

1. **position 기반 semantic API는 lib.d.ts 타입을 정상 인식** — tsc LanguageService가 직접 처리
2. **`isTypeAssignableToType(file, pos, typeExpr)`** (0.12.0): position의 타입이 global 타입 표현식에 assignable한지 구조적 검사
3. **`{ anyConstituent: true }`** (0.12.1): union member 중 하나라도 assignable하면 `true` — `Promise<T> | null` 케이스 해결
4. **`getImplementationsAtPosition`**: 프로젝트 내 서브클래스 역방향 탐색 동작 (AppError → NetworkError)
5. **symbol-name API**: 상대 경로 필수 (0.12.0에서 절대 경로 silent failure 버그 수정)

#### gildash 팀 요청 → 반영

| 요청 | 분류 | 반영 |
| ---- | ---- | ---- |
| `isTypeAssignableToType(file, pos, typeExpr)` | 신규 API | 0.12.0 ✅ |
| `getResolvedTypeAtPosition` primitive keyword resolve | 의도된 제한 → 수정 | 0.12.0 ✅ |
| symbol-name API 절대 경로 silent failure | 버그 | 0.12.0 ✅ |
| `{ anyConstituent: true }` 옵션 | 신규 옵션 | 0.12.1 ✅ |

#### P5-1 / P5-5 결정

| 항목 | 결정 | 근거 |
| ---- | ---- | ---- |
| **P5-1**: `isTypeAssignableToType`로 `isPromiseLike` 교체 | ✅ **완료** | 0.12.0 `isTypeAssignableToType` + 0.12.1 `anyConstituent`. regex 제거, 구조적 타입 검사로 전환. CallExpression은 `(...args: any[]) => PromiseLike<any>` 타겟, Identifier는 `PromiseLike<any>` + `anyConstituent: true`. |
| **P5-5**: `getImplementations`로 Error 서브클래스 추적 | **실행 가능** | `getImplementationsAtPosition(AppError pos)` → NetworkError 발견 확인. 프로젝트 내 Error 서브클래스 역방향 탐색 동작. 현재 `getHeritageChain`(구현체 → 부모)과 상호보완적. |

### Phase 4: 디텍터 gildash 활용 강화

<<<<<<< Updated upstream
1. P6-1: barrel 디텍터 — `searchRelations({ type: 're-exports' })` + `resolveSymbol()` 활용
2. P6-3: temporal-coupling — `getParsedAst` `as any` 캐스팅 제거 (0.11.0 기준 공식 API)
=======
1. ~~P6-1: barrel 디텍터 — `searchRelations({ type: 're-exports' })` 활용~~ → ✅ **완료** (gildash re-export relation으로 cross-module 파일 사전 필터링, pattern A 최적화)
2. ~~P6-3: temporal-coupling — `getParsedAst` `as any` 캐스팅 제거~~ → ✅ **완료** (직접 `gildash.getParsedAst()` 호출, `as Node` 캐스트도 제거)
>>>>>>> Stashed changes
3. ~~P4-1: `isTypeAssignableToType`로 `isPromiseLike` 교체~~ → ✅ **완료** (gildash 0.12.0 `isTypeAssignableToType` 사용)
4. ~~P4-2: `getImplementations`로 Error 서브클래스 자동 탐색~~ → 검토 완료, **불필요** (getHeritageChain이 symbol-name 기반으로 충분, isTypeAssignableToType은 position 확보 비용 추가)
5. ~~P6-4: indirection — semantic wrapper detection 강화~~ → ✅ **완료** (gildash 0.12.2 함수 overload 인덱싱 + overload 감지 시 thin-wrapper 제외)
6. ~~P4-2: `resolveSymbol`로 indirection re-export 체인 분석 강화~~ → ✅ **완료** (resolveCrossFileTarget에서 resolveSymbol로 multi-hop 추적)

### Phase 5: 인프라 및 품질

1. P4-8: `getParsedAst` 캐시 재활용 확대 (P7-2)
2. P4-9: `ignorePatterns` + `logger` 연동
3. P4-10: `GildashError.type` 세분화된 에러 처리
4. P4-11: `BatchParseResult.failures` 활용

### Phase 6: 새 탐지 기능

1. P9-1: barrel에 `circular-reexport` 추가 (`resolveSymbol`)
2. P9-2: barrel에 `deep-reexport-chain` 추가 (`resolveSymbol`)
3. P9-3: dependencies에 `orphan-file` 추가 (`getDependents`)
4. P9-5: `deep-inheritance` 추가 (`getHeritageChain`)
5. P9-6: `oversized-api-surface` 추가 (`getModuleInterface`)
6. P9-4: dependencies에 `large-transitive-footprint` 추가
7. P9-9: giant-file에 `low-export-ratio` 추가 (`getFileStats`)
8. P9-7: `dead-interface` 디텍터 (`getImplementations`)
9. P9-8: `missing-implements` 디텍터 (`getImplementations`, `isExplicit: false`, `kind === 'class'`)
10. P9-10: `high-churn-symbol` (`getSymbolChanges`)

### Phase 7: 인프라 새 기능

1. P5-2: `getSymbolChanges` + `changedRelations` + `getAffected`로 incremental scan 모드
2. P5-3: `diffSymbols`로 PR 단위 분석
3. P4-4: `srcFilePathPattern`/`dstFilePathPattern`으로 대규모 프로젝트 성능 최적화

### Phase 8: 고급 인프라

1. P4-7: watch 모드 + `onIndexed` 이벤트로 실시간 분석 (IDE/MCP 통합)
2. P4-6: `DependencyGraph` 직접 사용 (`patchFiles`, `getTransitiveDependents`)
3. P4-2: `getStats` + `getFileStats`로 프로젝트 건강도 대시보드
4. P6-2: coupling — `getImportGraph()` 직접 사용 검토 (async 구조 변경 필요)
5. P8-3: MCP 서버에 새 도구 추가 (`find-pattern`, `search-symbols`, `semantic-references`, `type-at-position`)
6. P8-4: 모노레포 지원 (`projects`, `searchAllSymbols`, `searchAllRelations`, `additionalProjects`)
7. P8-6: trace-symbol usecase 강화 (`getImplementations`, `resolveSymbol`, `getFullSymbol`)

### gildash 팀 요청 결과 (P10)

#### 승인됨 (0.11.0에 포함 완료)

| API | 설명 |
| --- | ---- |
| `getResolvedTypeAtPosition(file, position)` | position 기반 타입 조회 |
| `getSemanticReferencesAtPosition(file, position)` | position 기반 참조 탐색 |
| `getImplementationsAtPosition(file, position)` | position 기반 구현체 탐색 |
| `isTypeAssignableToAtPosition(srcFile, srcPos, dstFile, dstPos)` | position 기반 타입 호환성 검사 |
| `lineColumnToPosition(file, line, col)` | tsc SourceFile 기반 좌표 변환 |
| `getSymbolNode(file, position)` | tsc 심볼 그래프 노드 접근 |
| `searchRelations` → `StoredCodeRelation[]` | 반환 타입 수정 (breaking 아님) |
| `searchAllRelations` → `StoredCodeRelation[]` | 동일 |
| `getInternalRelations` → `StoredCodeRelation[]` | 동일 |
| `getTransitiveDependents(file, project?)` | 파사드 추가 (DependencyGraph 직접 사용 불필요) |
| `findNamePosition(file, declarationPos, name)` | 선언 위치에서 실제 identifier offset 찾기 |
| `getSemanticDiagnostics(filePath)` | tsc diagnostics 노출. 파일 단위만. `getAllDiagnostics` 제외 |

**firebat 영향**: position 기반 API 4개가 추가되면 P2 전체가 **대폭 단순화**됨:
- P2-1: `getLineColumn` 변환 불필요 → `getResolvedTypeAtPosition(file, offset)` 직접 호출
- P2-3: `candidate.name` 추출 불필요 → `getSemanticReferencesAtPosition(file, offset)` 직접 호출
- P2-4: `SemanticLayerAccess` 인터페이스 불필요 → public API 직접 호출

#### 거절됨

| API | 이유 | firebat 대응 |
| --- | ---- | ----------- |
| ~~`findNamePosition`~~ | ~~시그니처 불일치~~ → 3파라미터로 재요청 **승인** | 승인 목록으로 이동 |
| Call Graph, Symbol Usage, Module Metrics, Heritage Depth, Batch Query | 기존 API 조합으로 소비자 측 구현 가능. 편의 래퍼를 엔진에 넣지 않는 방침 | firebat에서 gildash API 조합으로 자체 구현 |
| ~~tsc Diagnostics~~ | ~~동등성 문제~~ → 파일 단위 `getSemanticDiagnostics` **승인** | 승인 목록으로 이동. typecheck 디텍터 자체 `ts.createProgram()` 제거 가능 |

### 코드 정리

1. P8-5: `engine/symbol-extractor-oxc.ts` — editor usecase 사용 중이므로 즉시 제거 불가. gildash `extractSymbols` 대체 장기 검토
