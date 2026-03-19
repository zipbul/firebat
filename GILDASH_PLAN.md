# GILDASH_PLAN.md

gildash 0.8.0 → 0.9.3 업그레이드 및 API 정리 계획.

## 배경

### 현재 상태

- 설치 버전: `@zipbul/gildash@0.8.0` (`package.json: "^0.8.0"`)
- gildash 최신: 0.9.3
- gildash 사용 파일: 42개 (src 26개 + test 16개)

### E-07에서 발견된 문제

E-07 (`return-await-in-try` gildash semantic 타입 기반 개선) 구현 중 다음 문제 발견:

1. **`ResolvedType` 로컬 중복 정의**: `engine/semantic-types.ts`, `error-flow/analyzer.ts`, `unknown-proof/semantic-checks.ts`, `analyzer.spec.ts`에 동일 인터페이스 중복. TODO 주석에 "gildash 0.8.1+ 배포 전까지 로컬 정의"라고 되어 있으나 **0.8.0에서 이미 export 중** (`import type { ResolvedType } from '@zipbul/gildash'` 가능).
2. **`_ctx.semanticLayer` private API 직접 접근**: `error-flow/analyzer.ts`와 `unknown-proof/semantic-checks.ts`에서 `gildash._ctx.semanticLayer.collectTypeAt()` 사용. gildash는 `getResolvedType(symbolName, filePath)` public API를 제공하지만 시그니처 불일치 (symbol name vs AST position).
3. **`getSemanticLayer` 헬퍼 중복**: 두 feature에서 각각 `getSemanticLayer` 함수를 로컬 정의. 래핑 범위도 다름 (error-flow는 `collectTypeAt`만, unknown-proof는 3개 메서드).

## 작업 항목

### P0: 즉시 적용 가능 (gildash 업그레이드 불필요)

#### P0-1. `ResolvedType`/`SemanticReference` import 경로 정리

0.8.0에서 이미 export 중이므로 로컬 정의 제거 가능.

| 파일 | 액션 |
|------|------|
| `src/engine/semantic-types.ts` | `@zipbul/gildash`에서 re-export로 변경, 로컬 정의 삭제 |
| `src/features/error-flow/analyzer.ts` | `engine/semantic-types`에서 import (변경 없음) |
| `src/features/unknown-proof/semantic-checks.ts` | `engine/semantic-types`에서 import (변경 없음) |
| `src/features/error-flow/analyzer.spec.ts` | `engine/semantic-types`에서 import (변경 없음) |

또는 `engine/semantic-types.ts`를 삭제하고 모든 소비자가 `@zipbul/gildash`에서 직접 import. 단 `engine/` 레이어가 gildash에 의존하게 되므로 의존성 규칙 검토 필요.

### P1: gildash 0.8.0 → 0.9.3 업그레이드

#### P1-1. changelog 전수 확인

0.8.1 ~ 0.9.3 사이의 변경사항 확인 필요:
- breaking change 유무
- 신규 public API (특히 position 기반 타입 조회)
- `_ctx` private API 변경 여부
- `SemanticLayerLike` 인터페이스 변경 여부

#### P1-2. 전역 영향 분석

gildash API 사용 파일 42개에 대한 영향도 분석. 주요 확인 대상:

| API | 사용처 | 확인 사항 |
|-----|--------|-----------|
| `searchRelations()` | dependencies, indirection, temporal-coupling | 시그니처/반환 타입 변경 여부 |
| `searchSymbols()` | dependencies, indirection | 시그니처/반환 타입 변경 여부 |
| `getImportGraph()` | dependencies | 시그니처 변경 여부 |
| `getCyclePaths()` | dependencies | 시그니처 변경 여부 |
| `getHeritageChain()` | error-flow, trace-symbol | 시그니처 변경 여부 |
| `batchParse()` | ts-program | 시그니처 변경 여부 |
| `getFileInfo()` | inputs-digest | 시그니처 변경 여부 |
| `_ctx.semanticLayer.*` | error-flow, unknown-proof | private API 구조 변경 여부 |

#### P1-3. 테스트 전략

- `bun test` 전체 실행 후 회귀 확인
- integration test (`test/integration/`)에서 실제 gildash 인스턴스 사용하는 테스트 집중 확인
- mock/stub 테스트는 API 시그니처 변경 시에만 수정

### P2: private API 제거 (gildash 협의 필요)

#### P2-1. `_ctx.semanticLayer.collectTypeAt` → public API 전환

현재 firebat은 AST position 기반으로 타입을 조회해야 하지만, gildash public API `getResolvedType()`은 symbol name 기반.

| 방법 | 설명 | gildash 작업 |
|------|------|-------------|
| A. gildash가 position 기반 public API 추가 | `gildash.getTypeAtPosition(filePath, position)` | 신규 API 필요 |
| B. firebat이 position → symbol name 변환 | AST에서 position의 identifier name 추출 후 `getResolvedType()` 호출 | 없음, firebat 측 변환 로직 |
| C. 현상 유지 | `_ctx` 접근 계속 사용 | 없음, 하지만 private API 의존 위험 |

**권장: A.** gildash에 `getTypeAtPosition(filePath: string, position: number): ResolvedType | null` 추가 요청.

#### P2-2. `getSemanticLayer` 헬퍼 통합

두 feature의 `getSemanticLayer` 중복 제거. P2-1 해결 후 public API 기반으로 통합.

### P3: gildash 답변에서 확인된 후속 작업

gildash 팀이 다음 패치에서 처리 예정:
- `ResolvedType` JSDoc에 유한 트리 보장 명시 (max depth 8, no circular references)
- `MAX_TYPE_DEPTH` named constant 추출

firebat 측 후속:
- gildash 패치 적용 후 `isPromiseLike` depth guard 불필요 확인 (API 계약 기반)
- `containsUnknownOrAny`의 `visited` Set도 동일 근거로 제거 검토

## gildash API 사용 현황

### Public API

| API | 패턴 | 반환값 | 비동기 | 사용처 |
|-----|------|--------|--------|--------|
| `Gildash.open()` | 팩토리 | `Gildash` | O | `store/gildash.ts` |
| `searchRelations()` | 검색 | `CodeRelation[]` | X | dependencies, indirection, temporal-coupling |
| `searchSymbols()` | 검색 | `SymbolSearchResult[]` | X | dependencies, indirection |
| `getImportGraph()` | 그래프 | `Map<string, string[]>` | O | dependencies |
| `getCyclePaths()` | 그래프 | `string[][]` | O | dependencies |
| `getFileInfo()` | 메타 | `{ contentHash }` | X | inputs-digest |
| `batchParse()` | 파싱 | `{ parsed: Map }` | O | ts-program |
| `getResolvedType()` | 타입 | `ResolvedType \| null` | X | (미사용 — position 기반 필요) |
| `getSemanticReferences()` | 참조 | `SemanticReference[]` | X | trace-symbol |
| `getHeritageChain()` | 상속 | `HeritageNode` | O | error-flow, trace-symbol |
| `close()` | 정리 | `void` | O | 모든 사용처 |

### Private API (`_ctx` 접근)

| API | 사용처 | 대체 가능 여부 |
|-----|--------|---------------|
| `_ctx.semanticLayer.collectTypeAt(filePath, position)` | error-flow, unknown-proof | P2-1 참조 |
| `_ctx.semanticLayer.collectFileTypes(filePath)` | unknown-proof | 배치 조회 — public API 없음 |
| `_ctx.semanticLayer.findReferences(filePath, position)` | unknown-proof | `getSemanticReferences()`는 symbol name 기반 |

## 주의사항

- gildash `ResolvedType.members`/`typeArguments`는 mutable `ResolvedType[]`. ReadonlyArray 변환은 breaking change라 하지 않음. firebat에서 immutable하게 사용하려면 소비 시점에서 `as readonly` 처리.
- depth=8에서 truncation 시 `members`/`typeArguments`가 `undefined`. `text` 필드는 모든 depth에서 항상 채워지므로 표시용 fallback으로 사용 가능.
