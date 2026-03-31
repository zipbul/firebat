# KNIP 기능 흡수 및 제거 계획

## 목표

knip 의존성을 제거하고, firebat 사용자가 knip 없이도 미사용 코드/의존성 탐지를 할 수 있게 한다.

## 배경

knip은 16가지 탐지 카테고리를 제공하지만, 핵심 가치는 3가지 축이다:

1. **미사용 코드** — unused exports, unused files, unused enum/type members
2. **의존성 위생** — unused dependencies, unlisted dependencies, unresolved imports
3. **config-aware 분석** — 141개 플러그인으로 config 파일에서 문자열로 참조되는 의존성 인식

firebat는 이미 dead-export 탐지, import 그래프 분석(gildash), re-export 체인 분석을 갖고 있다.

## 흡수 범위

### 구현한다

| 기능 | 설명 | 근거 |
|------|------|------|
| **unused files** | import 그래프에서 entrypoint으로부터 도달 불가능한 파일 | gildash BFS로 즉시 가능. 코드베이스 위생의 기본 |
| **unused exports 정밀화** | 현재 dead-export를 type export, enum member, namespace member 단위로 세분화 | 사용자가 정밀하게 죽은 API를 정리할 수 있다 |
| **nsExports / nsTypes** | `import * as NS from './mod'` 후 `NS.foo`만 사용 → `NS.bar`는 미사용 export | namespace import에서 미사용 멤버는 dead export와 같은 성격 |
| **namespaceMembers** | TS `namespace` 내 미사용 export 멤버 탐지 | namespace 내 dead export. 0.15.0에서 `SymbolKind: 'namespace'` 추가됨 |
| **duplicate exports** | 동일 심볼이 여러 경로로 중복 export됨 | 소비자 혼란 + 유지보수 이슈. error |
| **unused dependencies** | 소스 파일 import 분석으로 참조되는 패키지명 수집 → package.json `dependencies`와 비교 | 프로덕션 번들 크기에 직결 |
| **unused devDependencies** | 동일한 import 분석으로 `devDependencies`도 검사 | 코드에서 참조하는 devDep(vitest, @testing-library 등)의 미사용 탐지 가능 |
| **unlisted dependencies** | import에 있지만 package.json에 없는 패키지 | 설치 누락 조기 발견 |
| **unresolved imports** | 모듈 해석 실패한 import specifier 수집 | 깨진 import 조기 발견 |
| **모노레포 지원** | 워크스페이스 탐색, 전체 워크스페이스에 걸친 import 그래프, 워크스페이스별 리포팅 | unused exports/files가 모노레포에서 정확하게 동작하려면 필수 |

### 포기한다

| 기능 | 이유 |
|------|------|
| **141개 config 파서 플러그인** | 각 도구의 config 스키마를 개별 파싱해야 함. knip이 수년간 축적한 자산이고 재구현은 비현실적 |
| **auto-fix** | 코드 품질 스캐너는 탐지가 본업. export 삭제/파일 삭제 같은 자동 수정은 위험하고 사용자 판단 영역 |
| **strict mode** | 모노레포 워크스페이스 간 의존성 명시 강제. 모노레포 지원 이후 재검토 가능하나 초기 범위에서 제외 |
| **production mode** | firebat는 코드 품질 스캐너이지 프로덕션 번들 최적화 도구가 아님. test 파일 구분은 `DEP_TEST_ONLY_EXPORT`로 이미 처리. 별도 CLI 모드 불필요 |
| **unused binaries** | scripts에서 CLI로만 참조되는 패키지는 import 없어도 사용 중. error가 아님 |
| **optionalPeerDependencies** | optional peer dep이 코드에서 참조되는 건 정상 동작. error가 아님 |
| **unused catalog** | pnpm workspace catalog 전용. 대상 사용자 극소수 |

## 아키텍처

### unused dependencies 탐지 전략

소스 파일의 import를 분석한다. 그게 전부다.

```
1. 소스 파일(test 파일 포함)에서 모든 import specifier 수집
2. bare specifier 추출 (상대경로, 절대경로, node:*, bun:* 제외)
3. bare specifier → 패키지명 변환 (@scope/pkg/subpath → @scope/pkg, pkg/subpath → pkg)
4. package.json dependencies + devDependencies와 비교
   - deps에 있지만 import에 없음 → unused dependency
   - import에 있지만 deps에 없음 → unlisted dependency
5. 조건부 제외: @types/X는 대응 패키지 X가 사용 중일 때만 제외. 대응 패키지가 없거나 미사용이면 @types/X도 unused로 보고. peerDependencies, optionalDependencies는 무조건 제외
6. 사용자 제외: ignoreDependencies 설정 (glob 패턴 지원, e.g. "@commitlint/*")
```

**오탐 원인 3가지와 대응:**

| 오탐 원인 | 예시 | 대응 |
|-----------|------|------|
| config 도구 — config 문자열로만 참조 | eslint, prettier, commitlint | `ignoreDependencies`에 추가 |
| CLI 도구 — scripts에서 실행, import 없음 | drizzle-kit, dependency-cruiser, rimraf | `ignoreDependencies`에 추가 |
| 타입 패키지 — 대응 패키지 사용 중 | @types/lodash (lodash 사용 중) | 대응 패키지 사용 시 조건부 제외. 대응 패키지 미사용이면 unused 보고 |

config 도구와 CLI 도구는 소스에서 import하지 않으므로 import 분석으로 탐지 불가. `ignoreDependencies`로 사용자가 한번 설정하면 이후 발생 안 함.

### 기존 구조 활용

firebat의 `dependencies` 디텍터(`src/features/dependencies/`)가 이미 다음을 수행한다:

- gildash import 그래프 조회 (`getImportGraph()`)
- entrypoint 기준 BFS reachability 분석
- dead-export / test-only-export 분류
- import/re-export 관계 수집 (`searchRelations()`)
- package.json entrypoint 해석 (main, module, bin, exports, types)

새 기능은 이 디텍터를 **확장**하는 방향으로 구현한다.

### 새 finding 타입

```
기존:
  DEP_DEAD_EXPORT          — 미참조 export
  DEP_TEST_ONLY_EXPORT     — 테스트에서만 참조되는 export
  DEP_LAYER_VIOLATION      — 레이어 규칙 위반
  DIAG_CIRCULAR_DEPENDENCY — 순환 의존성

추가:
  DEP_UNUSED_FILE          — import 그래프에서 도달 불가능한 파일
  DEP_UNUSED_TYPE_EXPORT   — 미참조 type export
  DEP_UNUSED_ENUM_MEMBER   — 미사용 enum 멤버
  DEP_UNUSED_NS_EXPORT     — namespace import에서 미사용 멤버 (import * as NS → NS.bar 미사용)
  DEP_UNUSED_NS_TYPE       — 위와 동일, type 버전
  DEP_UNUSED_NS_MEMBER     — TS namespace 내 미사용 export 멤버
  DEP_DUPLICATE_EXPORT     — 동일 심볼이 여러 경로로 중복 export
  DEP_UNUSED_DEPENDENCY    — package.json에 있지만 import되지 않는 패키지 (deps + devDeps)
  DEP_UNLISTED_DEPENDENCY  — import되지만 package.json에 없는 패키지
  DEP_UNRESOLVED_IMPORT    — 해석 불가능한 import specifier
```

**DEP_UNUSED_FILE vs DEP_DEAD_EXPORT 중복 정책:**
- unreachable 파일은 `DEP_UNUSED_FILE` finding만 생성한다
- 해당 파일의 개별 export를 `DEP_DEAD_EXPORT`로 중복 보고하지 않는다
- 이유: 파일 자체가 죽었으면 개별 export 보고는 노이즈. 사용자가 파일을 삭제하거나 import를 추가하면 해결됨

**새 finding 타입 추가 시 수정 파일:**
- `src/types.ts` — `FirebatCatalogCode` union, `DependencyAnalysis` 인터페이스, `DependencyFinding` union, enriched finding 타입 (post-enrich 형태)
- `src/features/dependencies/analyzer.ts` — finding 생성 로직
- `src/application/scan/diagnostic-aggregator.ts` — `FIREBAT_CODE_CATALOG` 객체에 새 코드 등록
- `assets/firebatrc.schema.json` — JSON 출력 스키마

### 모노레포 지원

firebat는 **프로젝트 루트에 설치**하고 전체 워크스페이스를 스캔한다.

**워크스페이스 탐색:**
- `package.json`의 `workspaces` 필드 (npm/yarn)
- `pnpm-workspace.yaml` (pnpm)

**스캔 범위:**
- 전체 워크스페이스에 걸친 단일 import 그래프 구성
- gildash를 루트에서 초기화, 모든 워크스페이스 소스를 인덱싱
- unused export 판정 시 다른 워크스페이스의 소비자도 고려
- unused dependency는 각 워크스페이스 자체 package.json 기준으로 판단

**리포팅:**
- finding은 워크스페이스 단위로 그룹핑

**기존 코드 활용:**
- `barrel/resolver.ts`의 `createWorkspacePackageMap()`이 이미 워크스페이스 탐색을 구현 (npm/yarn `workspaces` 필드만 지원)
- `shared/`로 추출하여 dependencies 디텍터에서도 사용. 추출 시 `barrel/resolver.ts`의 import 경로도 변경 필요
- pnpm-workspace.yaml 파싱 로직 추가 필요

### ignoreDependencies 설정

`.firebatrc.jsonc`에 추가:

```jsonc
{
  "ignoreDependencies": [
    "@commitlint/*",
    "eslint",
    "prettier",
    "husky",
    "lint-staged",
    "dependency-cruiser",
    "drizzle-kit"
  ]
}
```

- glob 패턴 지원 (`@commitlint/*`, `eslint-*` 등)
- config 최상위 레벨에 위치 (feature 하위가 아님)

**수정 대상:**
- `src/shared/firebat-config.ts` — `FirebatConfigSchema` (Zod, `.strict()`) + `FirebatConfig` 인터페이스
- `assets/firebatrc.schema.json` — JSON 스키마 갱신

## 구현 순서

### Phase 0: gildash 0.15.1 Breaking Change 대응 + 즉시 적용 항목 ✅ 완료

**Phase 1 시작 전에 완료해야 한다.** gildash 0.15.1 업그레이드로 인한 컴파일 오류/런타임 오류 해소.

**Breaking Change 대응:**
1. `dstFilePath: string | null` null 체크 — `dependencies/analyzer.ts`, `barrel/analyzer.ts`, `indirection/analyzer.ts`에서 `rel.dstFilePath`를 `path.resolve()`에 전달하는 곳에 null guard 추가
2. `dstProject: string | null` null 체크 — 동일 파일들
3. `FullSymbol` 필드 타입 변경 — `indirection/analyzer.ts`에서 `getFullSymbol()` 결과의 jsDoc, parameters, heritage, typeParameters, decorators 접근 코드 타입 맞춤
4. `ParsedFile.module` required — firebat 자체 ParsedFile을 gildash ParsedFile로 교체
5. `SymbolKind 'namespace'` — kind exhaustive 처리 코드에 namespace 케이스 추가
6. `isNode`/`isNodeArray`/`visit`/`collectNodes` 삭제 — gildash parser에서 import하는 곳이 있으면 교체

**즉시 적용 항목:**
7. `limit: 100_000` 3곳 삭제 (barrel, indirection, dependencies analyzer)
8. `SymbolDetail` 강타입 활용 — detail 접근 시 캐스팅 제거
9. `BatchParseResult` 사용 — `ts-program.ts`의 `as unknown as ParsedFile[]` 캐스팅 제거
10. `@oxc-project/types` 강타입 전면 적용 — oxc-parser가 `export * from "@oxc-project/types"`로 re-export하므로 `from 'oxc-parser'`에서 discriminated union 구체 타입(`IfStatement`, `BinaryExpression` 등)을 직접 import. `as unknown as` 92개 + `as any` 40개(소스 전용, 테스트 제외) 제거, 타입 가드 ~50줄 삭제, 자체 타입 (`NodeRecord`, `NodeWithBody`, `NodeWithParams`) 삭제
11. `normalizePath` import + 12개 파일 경로 정규화 보일러플레이트 삭제 (gildash 0.16.0 forward slash 보장). 대상: `typecheck/detector.ts`, `barrel/analyzer.ts`, `barrel/resolver.ts`, `indirection/analyzer.ts`, `dependencies/analyzer.ts`, `root-resolver.ts`, `ts-program.ts`, `cache-keys.ts`, `cache-namespace.ts`, `project-inputs-digest.ts`, `inputs-digest.ts`, `target-discovery.ts`
12. `source-position.ts` (16줄) 삭제 가능 — gildash `buildLineOffsets`/`getLineColumn` re-export 사용

**테스트:** `bun test` 전체 통과 확인. 현재 7개 실패 중 gildash Breaking Change 관련 실패가 해소되는지 검증.

**Phase 0 완료 상태 (2026-03-31):**
- ✅ 1~6: Breaking Change 대응 완료
- ✅ 7: `limit: 100_000` 3곳 삭제
- ✅ 8: `SymbolDetail` 강타입 적용
- ✅ 9: `BatchParseResult` 캐스팅 제거
- ✅ 10: `@oxc-project/types` 강타입 대부분 적용 (src에서 `as unknown as` 7개, `as any` 4개 잔존 — 전부 동적 AST 순회/finding 타입 관련으로 구조적 필요)
- ✅ 11: `normalizePath` import + 12개 파일 정규화 삭제
- ✅ 12: `source-position.ts` 삭제, `function-span.ts` 삭제 (사용처 4곳 인라인 교체)
- ✅ `getNodeType` 삭제 (1줄 래퍼, 사용처 1곳 `initNode.type` 직접 접근으로 교체)
- ✅ Visitor API 교체: `walkOxcTree`를 oxc-parser `Visitor`로 교체 (semantic-checks, barrel, indirection, temporal-coupling, candidates — 총 11곳). early-return/서브트리/parent 필요 곳은 `walkOxcTree` 유지.
- 잔존 자체 유틸 (`isOxcNode`, `isNodeRecord`, `NodeRecord`, `NodeValue`, `forEachChildNode`, `getNodeName`, `isFunctionNode`): visitorKeys 동적 순회에 구조적 필요. Visitor API의 early-return 미지원으로 전면 교체 불가.
- `symbol-extractor-oxc.ts`: gildash 인스턴스 주입 필요로 단순 삭제 불가. Phase 1에서 처리.

### Phase 1: unused files + unused exports 정밀화

기존 dependencies 디텍터에 가장 자연스럽게 추가되는 기능. gildash 인프라 그대로 활용.
gildash 현재 버전으로 구현 가능.

**선행 작업:**
- `isTestLikePath()` (`features/dependencies/analyzer.ts` 내부 unexported 함수)를 `shared/`로 추출. unused file 판정에서 test 파일 구분에 필요하며, 다른 디텍터에서도 재사용 가능.

**구현:**
1. unused files — BFS reachability에서 unreachable 파일 수집. 현재 코드는 unreachable 파일의 export만 dead-export로 보고하는데, unreachable 파일 자체를 `DEP_UNUSED_FILE` finding으로 보고하는 별도 루프 추가. 해당 파일의 export는 `DEP_DEAD_EXPORT`로 중복 보고하지 않음.
2. unused type export — `searchSymbols()`에서 type/enum 구분하여 세분화
3. unused enum member — gildash `searchSymbols()`에서 `memberName` 필드로 enum 멤버 개별 조회 가능. 참조 추적은 `getSemanticReferencesAtPosition()` (semantic: true 필요). **검증 필요: enum 멤버가 gildash 인덱스에 개별 행으로 저장되는지 실제 테스트로 확인**
4. nsExports / nsTypes — `import * as NS from './mod'` 패턴에서 `NS.foo`는 사용되지만 `NS.bar`는 미사용인 경우 탐지. 구현: `searchRelations({ type: 'imports' })`에서 namespace import 식별 → 해당 모듈의 exported symbols 조회 → import 측 소스에서 `NS.xxx` 멤버 접근을 AST에서 수집 → 미사용 멤버를 `DEP_UNUSED_NS_EXPORT` / `DEP_UNUSED_NS_TYPE`으로 보고
5. namespaceMembers — TS `namespace Foo { export function bar() {} }` 에서 `bar`가 미사용인 경우. gildash `SymbolKind: 'namespace'` + `memberName`으로 멤버 조회 → 참조 추적. `DEP_UNUSED_NS_MEMBER`로 보고
6. duplicate exports — 동일 심볼이 여러 파일/경로에서 중복 export되는 경우. `searchAllSymbols({ text: name, isExported: true })`로 전체 프로젝트에서 같은 이름의 export 수집 → `resolveSymbol()`로 원본 추적 → 서로 다른 파일에서 같은 원본을 가리키면 `DEP_DUPLICATE_EXPORT`로 보고

**gildash 연동 (현재 버전에서 가능):**
- `symbol-extractor-oxc.ts` (130줄) 삭제 → gildash `extractSymbols()` 사용. **선행: `src/application/editor/edit.usecases.ts`의 `extractSymbolsOxc` 의존성을 gildash `extractSymbols()`로 교체**
- `function-span.ts` (14줄) 삭제 → `getSymbolsByFile()[].span` 사용. **선행: `src/features/early-return/analyzer.ts` 등 사용처 교체**
- unused file 탐지에서 수동 BFS 대신 `getTransitiveDependencies(entrypoint)` 활용 가능 (entrypoint마다 호출 → union = reachable files, `listIndexedFiles()` - reachable = unused)

**테스트:** finding 타입별 fixture 프로젝트 생성. unreachable 파일, 미참조 type export, 미사용 enum member, namespace import 미사용 멤버, TS namespace 미사용 멤버, 중복 export 각각 검증. unreachable 파일의 export가 DEP_DEAD_EXPORT로 중복 보고되지 않는지 검증. namespace import에서 spread(`...NS`) 사용 시 전체 사용으로 처리하는지 검증. known edge case(dynamic import template literal) 문서화.

### Phase 2: unused/unlisted dependencies + unresolved imports

**gildash 0.15.1에서 인프라 완비.** bare specifier 보존(`specifier` 필드 + `isExternal` 필터), unresolved import(`dstFilePath: null`)이 반영됨. fallback(oxc-parser AST 직접 순회) 불필요.

**구현:**

gildash 0.16.0에서 `StoredCodeRelation`에 `isExternal: boolean` + `specifier: string | null`이 추가됨. **1회 쿼리로 전체 조회 후 분류 가능.**

```
1. searchRelations({ type: 'imports' }) → 전체 import relation 조회
2. rel.isExternal === true → 외부 패키지 import. rel.specifier에서 패키지명 추출
3. rel.isExternal === false && rel.dstFilePath === null → unresolved 내부 import
```

외부 패키지 import → unused dependency 탐지:
4. specifier에서 패키지명 추출 (`lodash/merge` → `lodash`, `@scope/pkg/sub` → `@scope/pkg`)
5. `node:*`, `bun:*` 내장 모듈 필터링
6. self-referencing import 필터링 (package.json `name` 비교)
7. package.json 파싱 (dependencies, devDependencies, peerDependencies, optionalDependencies)
8. 비교 로직 + finding 생성
9. `@types/*` 조건부 제외 — `@types/X`의 대응 패키지 `X`가 사용 중이면 제외, 미사용이면 unused 보고
10. `ignoreDependencies` glob 매칭

unresolved import → `DEP_UNRESOLVED_IMPORT` finding 생성.

**테스트:** unused dep, unlisted dep, unresolved import 각각 fixture. subpath import, scoped package, self-referencing, @types/*, peer dep 제외 등 엣지 케이스별 테스트.

### Phase 3: 모노레포 지원

Phase 1-2와 독립적으로 진행 가능. 단 Phase 3 완료 전까지 모노레포에서 unused exports/deps 정확도 저하 가능.

1. 워크스페이스 탐색 공통화 (`barrel/resolver.ts`의 `createWorkspacePackageMap()` → `shared/` 추출). 추출 후 `barrel/resolver.ts`의 import 경로 변경.
2. `pnpm-workspace.yaml` 파싱 추가 (기존 `package.json` workspaces 외)
3. gildash 멀티 워크스페이스 인덱싱 (루트에서 `Gildash.open()` 1회)
4. 워크스페이스별 package.json 파싱 (각 워크스페이스 자체 deps 기준)
5. 워크스페이스별 리포팅

**테스트:** 멀티 워크스페이스 fixture. cross-workspace import가 있을 때 unused export 오탐 안 나는지, 워크스페이스별 unused dep이 정확한지 검증.

### Phase 4: knip 제거 ⏸ 보류

**보류 사유:** knip은 firebat의 unused file/export/dep 탐지 결과를 대조 검증하는 oracle로 유지. Phase 1~3 구현이 knip과 동등한 정확도를 달성했다는 검증이 끝난 후 제거.

1. `knip` devDependency 삭제
2. `knip.json` 설정 파일 삭제
3. `package.json`에서 `knip` 스크립트 삭제
4. `.husky/pre-push`에서 knip 관련 주석 제거
5. CLAUDE.md, README.md에서 knip 참조 정리

## gildash 0.16.0 + oxc-parser 0.121.0 업그레이드 적용

gildash 0.14.0 → 0.16.0, oxc-parser 0.115.0 → 0.121.0 업그레이드 완료.
GILDASH_REQUEST.md + GILDASH_REQUEST_3.md의 모든 수용 항목이 0.16.0에 반영됐다.

### 반영된 요청과 firebat 적용

| 반영 항목 | firebat 작업 | 적용 시점 |
|-----------|-------------|----------|
| **C-1: bare specifier** — `CodeRelation.specifier` 필드, `RelationSearchQuery.isExternal` 필터 | Phase 2에서 `searchRelations({ isExternal: true })`로 unused dep 구현. fallback 불필요 | Phase 2 |
| **C-2: unresolved import** — `dstFilePath: string | null`. null + !isExternal = 미해석 | Phase 2에서 unresolved import finding 구현 | Phase 2 |
| **B-3: re-export 패턴 B/C** — `EcmaScriptModule` 기반 감지 | barrel 디텍터의 `checkCrossModuleReexport()` 패턴 B/C AST 순회 삭제. 단 `collectImportLikes()`는 span(line/column) 필요하므로 유지 | 별도 PR |
| **Visitor API** — `Visitor`, `visitorKeys`, `VisitorObject` re-export. 기존 `visit`/`collectNodes` 삭제 | ✅ 완료. semantic-checks, barrel, indirection, temporal-coupling, candidates에서 Program+always-true인 walkOxcTree 11곳을 Visitor로 교체. early-return/서브트리/parent 필요 곳은 `walkOxcTree` 유지. | ✅ 완료 |
| **limit optional** — 미지정 시 무제한 | `limit: 100_000` 3곳 삭제 | 즉시 |
| **oxc-parser 타입** — `@oxc-project/types` discriminated union 제공 | AST 타입은 `from 'oxc-parser'` 유지 (oxc-parser가 `export * from "@oxc-project/types"` 수행). gildash 고유 타입만 `from '@zipbul/gildash'`. 31개 소스 파일의 `import type { Node }` → 필요 시 구체 타입(`IfStatement` 등) 추가 import | 즉시 |
| **SymbolDetail 강타입** — `detail: Record<string, unknown>` → `SymbolDetail` | detail 접근 시 캐스팅 제거 | 즉시 |
| **BatchParseResult re-export** | `ts-program.ts`의 `as unknown as ParsedFile[]` 캐스팅 제거 | 즉시 |
| **ExtractedSymbol re-export** | `symbol-extractor-oxc.ts` 삭제, gildash `extractSymbols()` 사용 | Phase 1 |
| **buildLineOffsets/getLineColumn re-export** | ✅ `source-position.ts` 삭제 완료, `function-span.ts` 삭제 완료 (사용처 인라인 교체) | ✅ 완료 |
| **normalizePath top-level re-export** — 0.16.0에서 반영 | `import { normalizePath } from '@zipbul/gildash'`. 12개 파일 정규화 삭제 | Phase 0 |
| **forward slash 경로 보장 JSDoc** — 0.16.0에서 반영 | Gildash 클래스 JSDoc에 "All file paths use forward slash" 명시. 경로 정규화 삭제 근거 확보 | Phase 0 |
| **StoredCodeRelation에 isExternal + specifier** — 0.16.0에서 반영 | `isExternal: boolean` + `specifier: string | null`. 1회 쿼리로 external/unresolved 분류 가능 | Phase 2 |

### @oxc-project/types 강타입 전면 교체

oxc-parser 0.121.0이 `@oxc-project/types` 0.121.0에 의존하며 `export * from "@oxc-project/types"`로 전체 re-export한다. AST 타입은 `from 'oxc-parser'`에서 직접 import하는 것이 정석이다. gildash는 편의상 `Program`, `Node`만 re-export하지만, firebat은 oxc-parser를 직접 사용한다.

**186개 인터페이스 + 64개 타입 alias**. `Node`가 모든 AST 노드의 discriminated union. `node.type`으로 분기하면 TypeScript가 자동 narrowing.

```ts
// 현재 (캐스팅 필요)
const test = (node as unknown as { test?: unknown }).test;

// 변경 후 (타입 안전)
if (node.type === 'IfStatement') {
  node.test;        // Expression (자동 추론)
  node.consequent;  // Statement
  node.alternate;   // Statement | null
}
```

#### 파일별 교체 계획

**Tier 1: 캐스팅 집중 파일 (최우선)**

| 파일 | 캐스팅 수 | 주요 교체 대상 |
|------|----------|---------------|
| `ast-normalizer.ts` | `as unknown as` 73개 | `{name?: unknown}` → `IdentifierName.name`, `{operator?: unknown}` → `BinaryExpression.operator`, `{left/right}` → `BinaryExpression.left/right`, `{body}` → `BlockStatement.body`, `{expressions/quasis}` → `TemplateLiteral.expressions/quasis`, `{argument}` → `UnaryExpression.argument`, `{computed/property/object}` → `StaticMemberExpression`/`ComputedMemberExpression` |
| `scan.usecase.ts` | `as any` 19개 | enriched finding 타입 정리. finding 생성 시 `as any` 캐스팅 → 정확한 union 타입 사용 |
| `unknown-proof/candidates.ts` | `as any` 6개 + `as unknown as` 3개 | AST 프로퍼티 접근 → discriminated union narrowing |
| `temporal-coupling/analyzer.ts` | `as any` 7개 | `(decl as any).declarations` → `VariableDeclaration.declarations`, `(node as any).specifiers` → `ImportDeclaration.specifiers` |
| `variable-collector.ts` | `as unknown as` 5개 | `{argument}` → `BindingRestElement.argument`, `{right}` → `AssignmentPattern.right`, `{typeAnnotation}` → `BindingIdentifier.typeAnnotation`, `{name}` → `BindingIdentifier.name`, `{properties}` → `ObjectPattern.properties`, `{elements}` → `ArrayPattern.elements` |
| `report.ts` | `as any` 4개 | finding 직렬화 타입 정리 |
| `duplicates/anti-unifier.ts` | `as unknown as` 4개 | AST 비교 로직 → discriminated union narrowing |
| `diagnostic-aggregator.ts` | `as any` 3개 + `as unknown as` 1개 | 카탈로그 조회 타입 정리 |

**Tier 2: type 체크 + 타입 가드 사용 파일 (캐스팅 적음, narrowing + 타입 가드 교체)**

| 파일 | 패턴 | 교체 방법 |
|------|------|----------|
| `collect-locally-used-import-names.ts` | 타입 가드 20회 사용, 캐스팅 0개 | `isOxcNode`/`isNodeRecord` → `node.type` discriminated union narrowing으로 교체 |
| `cfg-builder.ts` | 타입 가드 19회 + `as unknown as` 1개 | `node.type` 분기 → discriminated union 자동 narrowing |
| `nesting/analyzer.ts` | `as unknown as` 3개 + `node.type` 48+ 체크 | discriminated union narrowing 적용 |
| `early-return/analyzer.ts` | `node.type === 'ReturnStatement'` 등 30+ 체크 | 동일 |
| `collapsible-if/analyzer.ts` | `node.type === 'IfStatement'` 등 10+ 체크 | 동일 |
| `error-flow/analyzer.ts` | `as unknown as` 1개 + `node.type` 체크 | 동일 |
| `waste-detector-oxc.ts` | `as unknown as` 2개 + `node.type` 체크 | 동일 |
| `oxc-fingerprint.ts` | `as unknown as` 1개 + 타입 가드 16회 | `{name}` → `IdentifierName.name`. 타입 가드 삭제 |

**Tier 3: 타입 정의/유틸 파일**

| 파일 | 교체 내용 |
|------|----------|
| `oxc-ast-utils.ts` | `isOxcNode`, `isNodeRecord`, `isOxcNodeArray` 타입 가드 삭제 (~50줄). `getNodeType`, `getNodeName` 삭제 (~20줄). `Node` discriminated union은 `from 'oxc-parser'`에서 직접 사용. `walkOxcTree`의 `predicate: (node: Node) => boolean` 시그니처는 유지 (Visitor로 교체 불가한 곳에서 사용) |
| `engine/types.ts` | `NodeRecord`, `NodeValue`, `NodeWithBody`, `NodeWithParams` 자체 타입 삭제. `ParsedFile` 자체 타입 삭제 → gildash `ParsedFile` import |
| `oxc-expression-utils.ts` | `unwrapExpression`의 `(expr as unknown as {expression}).expression` → `ParenthesizedExpression.expression` |
| `oxc-size-count.ts` | 타입 변경 불필요 (노드 카운팅만, 프로퍼티 접근 없음) |
| `function-items.ts` | `isFunctionNode` 체크 → `node.type === 'FunctionDeclaration' || ...` 이미 사용 중. 타입 변경 불필요 |

**Tier 4: `EcmaScriptModule` 활용 (barrel 디텍터)**

| 파일 | 교체 내용 |
|------|----------|
| `barrel/analyzer.ts` | `ParsedFile.module.staticImports` → deep-import 검사에서 import specifier 목록을 AST 순회 없이 접근. 단 finding 생성에 span(line/column) 필요하므로 `buildLineOffsets`/`getLineColumn` 병용 |

#### 주요 oxc 타입 매핑

| 현재 firebat 캐스팅 | @oxc-project/types 타입 |
|---------------------|------------------------|
| `{name?: unknown}` | `IdentifierName.name: string`, `IdentifierReference.name: string`, `BindingIdentifier.name: string` |
| `{body?: unknown}` | `BlockStatement.body: Statement[]`, `FunctionBody.statements: Statement[]` |
| `{test?: unknown}` | `IfStatement.test: Expression`, `WhileStatement.test: Expression`, `ConditionalExpression.test: Expression` |
| `{consequent/alternate}` | `IfStatement.consequent: Statement`, `IfStatement.alternate: Statement | null` |
| `{operator?: unknown}` | `BinaryExpression.operator: string`, `LogicalExpression.operator: string`, `UnaryExpression.operator: string` |
| `{left/right}` | `BinaryExpression.left/right: Expression`, `AssignmentExpression.left/right` |
| `{argument}` | `UnaryExpression.argument: Expression`, `BindingRestElement.argument: BindingPattern`, `ReturnStatement.argument: Expression | null` |
| `{object/property/computed}` | `StaticMemberExpression.object/property`, `ComputedMemberExpression.object/expression` |
| `{expressions/quasis}` | `TemplateLiteral.expressions: Expression[]`, `TemplateLiteral.quasis: TemplateElement[]` |
| `{properties}` | `ObjectPattern.properties: (BindingProperty | BindingRestElement)[]`, `ObjectExpression.properties` |
| `{elements}` | `ArrayPattern.elements: (BindingPattern | null)[]` |
| `{declarations}` | `VariableDeclaration.declarations: VariableDeclarator[]` |
| `{specifiers}` | `ImportDeclaration.specifiers: (ImportSpecifier | ImportDefaultSpecifier | ImportNamespaceSpecifier)[]` |
| `{handler/finalizer}` | `TryStatement.handler: CatchClause | null`, `TryStatement.finalizer: BlockStatement | null` |
| `{cases}` | `SwitchStatement.cases: SwitchCase[]` |
| `{label}` | `BreakStatement.label: LabelIdentifier | null`, `ContinueStatement.label: LabelIdentifier | null` |
| `{init/update}` | `ForStatement.init/update` |
| `{source}` | `ImportDeclaration.source: StringLiteral`, `ExportNamedDeclaration.source: StringLiteral | null` |
| `{value}` | `StringLiteral.value: string`, `NumericLiteral.value: number`, `BooleanLiteral.value: boolean` |

#### 삭제 총량

| 카테고리 | 삭제량 |
|----------|--------|
| `as unknown as` 캐스팅 (src, 14개 파일) | 92개 |
| `as any` 캐스팅 (src, 비테스트 6개 파일) | 40개 |
| 자체 타입 가드 (`isOxcNode` 등) 정의 + 사용처 | ~50줄 정의 + 28개 파일 사용처 교체 |
| 자체 타입 (`NodeRecord`, `NodeWithBody`, `NodeWithParams`, `NodeValue`, `NodeWithValue`) | ~15줄 |
| `ParsedFile` 중복 타입 | ~7줄 |
| `getNodeType`, `getNodeName` 래퍼 + 사용처 | ~20줄 정의 + 9개 파일 사용처 교체. `getNodeType` ✅ 삭제 완료. `getNodeName`은 24곳 사용으로 유지 |
| **합계** | **132개 캐스팅 + ~92줄 코드 + 37개 파일 사용처 교체** |

### Breaking Change 대응 (0.15.1)

Phase 0의 items 1-6 참조. 추가 비파괴적 변경:

| 변경 | 영향 지점 | 대응 |
|------|----------|------|
| `Gildash.open()`: `GildashInternalOptions` → `Partial<GildashInternalOptions>` | store/gildash.ts | 비파괴적 (더 관대) |
| `searchAllSymbols` 파라미터 단순화 | 사용처 있으면 | 비파괴적 |
| DB 스키마 변경 | .gildash/ 디렉토리 | 마이그레이션 또는 재인덱싱 |

### 신규 gildash API 활용

| API | firebat 활용 | 시점 |
|-----|-------------|------|
| `getBaseTypes(filePath, position)` | 커플링/상속 분석 강화 | 추후 |
| `ResolvedType.properties` | unknown-proof 타입 프로퍼티 검사 정밀화 | 추후 |
| `getAffected(changedFiles)` | 증분 스캔 | 추후 |
| `getFanMetrics(filePath)` | fan-in/out 수동 계산 대체 (39줄) | 별도 PR |
| `getTransitiveDependencies(entrypoint)` | unused file 탐지 — entrypoint에서 순방향 BFS 대체. entrypoint마다 호출 → union = reachable | Phase 1 |
| `searchAnnotations()` | JSDoc 태그 기반 finding 필터링 | 추후 |

### 미반영 요청

| 요청 | 상태 |
|------|------|
| B-2: 에러 처리 (Result 패턴) | 미반영. throw 유지. 현행 try-catch 유지 |
| CFG 빌더 | 거부됨. firebat에 유지 |
| Dataflow 분석 | 거부됨. firebat에 유지 |
| Visitor early-return | 거부됨. oxc-walker upstream 문제. firebat이 oxc-project에 직접 feature request 예정 |

### 반영 확인 (이전 보고에서 미확인이었던 것)

| 요청 | 상태 |
|------|------|
| C-3: require() 추적 | **반영 확인.** 번들에서 직접 확인. `require('pkg')`, `require.resolve('pkg')` → `type: "imports"` relation + `meta: { isRequire: true }` |

### gildash 0.16.0에서 추가 반영된 것 (GILDASH_REQUEST_3.md 요청)

| 요청 | 반영 | firebat 적용 |
|------|------|-------------|
| normalizePath top-level re-export | `export { normalizePath } from './common/path-utils'` 추가 | Phase 0에서 12개 파일 정규화 삭제 |
| StoredCodeRelation에 isExternal + specifier | `isExternal: boolean` + `specifier: string | null` 추가. `extends Omit<CodeRelation, 'specifier'>`로 specifier를 non-optional로 재정의 | Phase 2에서 1회 쿼리로 external/unresolved 분류 |
| forward slash 경로 보장 JSDoc | Gildash 클래스 JSDoc에 "All file paths use forward slash (`/`) as separator, regardless of platform" 명시 | Phase 0에서 경로 정규화 삭제 근거 |

**대기 항목 없음.** 모든 요청이 gildash 0.16.0에서 해소됨.

**원칙:** gildash 0.16.0에서 제공하는 것은 Phase 0에서 즉시 적용한다.

## 제거 후 비교

| 항목 | knip | firebat (흡수 후) |
|------|------|-------------------|
| unused exports | O | O (+ type/enum member 세분화) |
| unused files | O | O |
| nsExports / nsTypes | O | O (namespace import 미사용 멤버) |
| namespaceMembers | O | O (TS namespace 미사용 멤버) |
| duplicate exports | O | O (중복 export 탐지) |
| unused `dependencies` | O (141개 플러그인) | O (import 기반) |
| unused `devDependencies` | O (141개 플러그인) | O (import 기반. config/CLI 도구는 ignoreDependencies) |
| unlisted dependencies | O | O |
| unresolved imports | O | O |
| unused binaries | O | X — 포기. error가 아님 |
| optionalPeerDependencies | O | X — 포기. error가 아님 |
| unused catalog | O | X — 포기. pnpm 전용, 대상 극소수 |
| production mode | O | X — 포기. 코드 품질 스캐너에 불필요 |
| 모노레포 | O | O (Phase 3) |
| auto-fix | O | X — 포기 |
| strict mode | O | 재검토 가능 |
| **코드 품질 분석** | X | O (17개 디텍터) |

knip 16가지 탐지 중 9가지를 흡수하고, 4가지를 포기한다 (error가 아니거나 대상 극소수). 포기 항목 중 사용자에게 실질적 영향이 있는 것은 없다. config/CLI 도구의 자동 탐지는 `ignoreDependencies`로 대체.

## gildash 협의 결과

### gildash가 수용한 것

| 항목 | 내용 | firebat 영향 |
|------|------|-------------|
| **bare specifier 보존** | resolve 실패해도 relation 생성. `isExternal: true` + raw specifier 보존 | unused/unlisted dependency 탐지 가능. 별도 AST 순회 불필요 |
| **unresolved import 기록** | resolve 실패를 별도로 기록 | unresolved import finding 생성 가능 |
| **require() 추적** | `require()`, `require.resolve()` CallExpression도 relation 생성 | CJS 코드 커버리지 |
| **re-export 패턴 B/C** | `import { X } from './other'; export { X }` 패턴도 re-export relation으로 인식 | barrel 디텍터 `checkCrossModuleReexport()` 패턴 B/C AST 순회 삭제 가능. `collectImportLikes()`는 span 필요하므로 유지 |
| **경로 정규화** | 반환 경로 항상 forward slash | 12개 파일 정규화 보일러플레이트 삭제 |
| **에러 처리 검토** | 조회 API throw 보장 or Result 패턴 검토 예정 | try-catch 10+곳 제거 가능 |
| **oxc-parser 타입 활용** | oxc-parser가 `export * from "@oxc-project/types"` 수행. 186개 인터페이스 + 64개 타입 alias 제공 | AST 타입은 `from 'oxc-parser'`에서 직접 import. gildash 경유 불필요. 캐스팅 132개 제거 |
| **ParsedFile 타입 호환** | gildash ParsedFile 직접 사용 가능 | firebat 자체 ParsedFile 삭제 |
| **limit API 개선** | limit 생략 시 전체 반환 | `limit: 100_000` 3곳 삭제 |
| **Visitor API** | AST Visitor 제공 예정 | `walkOxcTree` 등 교체 가능 |

### gildash가 거부한 것

| 항목 | 거부 사유 | firebat 대응 |
|------|----------|-------------|
| **dead export API** | entrypoint 개념이 gildash에 없음. 분석은 소비자 영역 | firebat에 유지 (134줄) |
| **reachability API** | 정방향 entrypoint→reachable은 빌드 설정 의존 | firebat에 유지 (31줄) |
| **edge-cut hint** | 분석 기능. cycle 데이터 제공은 하지만 절단 전략은 소비자 영역 | firebat에 유지 (44줄) |
| **인덱스 빌더** | searchRelations/searchSymbols 결과를 Map으로 변환하는 건 소비자 코드 | firebat에 유지 (108줄) |
| **export stats 그룹핑** | 데이터 후처리. getSymbolsByFile + 필터로 가능 | firebat에 유지 (32줄) |
| **fan-in/out 배치** | getFanMetrics 이미 존재. firebat이 안 쓰고 있을 뿐 | 현재 gildash 버전에서 `getFanMetrics` 존재 확인 필요. 확인 후 수동 fan 계산(`listFanStats` 등)을 전환 |
| **oxc-expression-utils** | 정적 리터럴 평가는 분석 도구 영역 | firebat에 유지 (164줄) |
| **oxc-size-count** | AST 노드 카운팅은 분석 도구 영역 | firebat에 유지 (42줄) |
| **scope-aware 분석** | firebat 도메인 로직 | firebat에 유지 (531줄) |
| **CFG 빌더** | CFG는 저장/쿼리/추적 대상이 아님. raw AST 계산은 gildash 범위 밖 | firebat에 유지 (816줄). oxc 결합은 @oxc-project/types re-export로 해결 |
| **Dataflow 분석** | CFG 거부에 따라 자동 거부. "교과서적 = 인프라"는 성립하지 않음 | firebat에 유지 (986줄) |

### firebat가 자체 해결할 것

| 항목 | 방법 | 적용 시점 |
|------|------|----------|
| `symbol-extractor-oxc.ts` (130줄) | 삭제. gildash `extractSymbols()` 사용 | Phase 1 |
| `function-span.ts` (14줄) | ✅ 삭제 완료. 사용처 4곳 `buildLineOffsets`+`getLineColumn` 인라인 교체 | ✅ 완료 |
| fan-in/out 수동 계산 (39줄) | 현재 구현 유지. `getFanMetrics()`는 async + 파일별 개별 호출이라 현재 동기 그래프 순회(O(E))보다 비효율적. `outDegree` Map이 `buildEdgeCutHints`에서도 사용되어 분리 불가 | 대체 불가 |
| barrel `checkCrossModuleReexport()` 패턴 B/C | `collectImportBindings()`는 import binding local name 매핑에 필요 — gildash re-export relation으로는 local name 매핑 불가. `collectImportLikes()`는 Visitor로 교체 완료 | 부분 완료 |

## 피저빌리티 체크

### gildash 능력과 한계 (리팩토링 후 기준)

| 필요 기능 | 지원 | 비고 |
|-----------|------|------|
| import 그래프 (내부 모듈 간) | **O** | `getImportGraph()`, `searchRelations({ type: 'imports' })` |
| 외부 패키지 import specifier | **O (신규)** | bare specifier 보존 수용. `isExternal: true` |
| unresolved import 목록 | **O (신규)** | unresolved import 기록 수용 |
| require() / require.resolve() | **O (신규)** | require() 추적 수용 |
| enum member 단위 심볼 | **O** | `MyEnum.Value1` 형태 qualified name |
| enum member 참조 추적 | **부분** | `getSemanticReferencesAtPosition()` (`semantic: true` 필요) |
| type/interface vs value 구분 | **O** | `kind` 필드 |
| type-only import 구분 | **O** | `metaJson: { isType: true }` |
| dynamic import (literal) | **O** | `metaJson: { isDynamic: true }` |
| dynamic import (template literal) | **X** | 구조적 한계. 허용 범위 |
| 멀티 워크스페이스 인덱싱 | **O** | 단일 `projectRoot`로 서브패키지 자동 발견 |
| re-export 관계 (패턴 B/C 포함) | **O (신규)** | 패턴 B/C 수용 |

### 엣지 케이스 처리 가능성

| 케이스 | 기존 인프라 처리 | 신규 작업 |
|--------|-----------------|-----------|
| subpath import (`lodash/merge` → `lodash`) | 없음 | 단순 문자열 파싱. 첫 `/` 이전 또는 `@scope/pkg` 2세그먼트 추출 |
| scoped package (`@scope/pkg/sub` → `@scope/pkg`) | 없음 | `@`로 시작하면 첫 두 세그먼트 추출 |
| self-referencing (`import from 'my-own-package'`) | 없음 | `package.json` name 필드로 필터 |
| `node:*`, `bun:*` 내장 모듈 | 없음 | prefix 체크로 제외 |
| `@types/*` 조건부 제외 | 없음 | `@types/X` → 대응 패키지 `X`가 사용 중이면 제외, 미사용이면 unused 보고 |
| peer/optional dependencies 제외 | `root-resolver.ts`가 파싱 | 필터 로직 추가. `optionalDependencies` 파싱 추가 |
| bin entries (entrypoint) | `readPackageEntrypoints()`가 이미 처리 | 불필요 |
| package.json exports (conditional) | `collectStrings()`가 재귀 수집 | 불필요 |
| TS path aliases (`@/utils`) | barrel resolver + gildash 모두 처리 | 불필요 |
| require() / require.resolve() | gildash가 제공 (수용됨) | 불필요 |
| dynamic import (template literal) | 구조적 한계 | 불가. known edge case로 문서화 |

### 확장성 검증

| 확장 지점 | 패턴 | 호환성 |
|-----------|------|--------|
| 새 finding 타입 추가 | `FirebatAnalyses`에 readonly array 추가 | `Partial<>` 이므로 backward-compatible |
| 새 catalog code 추가 | `FirebatCatalogCode` union + `FIREBAT_CODE_CATALOG` entry | 기존 소비자 영향 없음 |
| `ignoreDependencies` config | Zod 스키마 확장 + `assets/firebatrc.schema.json` 갱신 | `.strict()` 이므로 스키마 추가 필수 |
| JSON 출력 스키마 | `analyses`에 새 키 추가 | 기존 소비자는 unknown 키 무시 |

### 모노레포 지원 피저빌리티

gildash는 단일 `projectRoot`에서 `Gildash.open()` 1회 호출로 모노레포 서브패키지를 자동 발견한다. firebat가 모노레포 루트를 `projectRoot`로 전달하면 전체 워크스페이스의 import 그래프가 단일 gildash 인스턴스에 구축된다.

**검증 완료된 gildash 모노레포 동작:**

| 시나리오 | gildash API | 동작 |
|----------|-------------|------|
| cross-workspace import | `searchRelations` | `project`='@myapp/api', `dstProject`='@myapp/shared', `isExternal`=0. npm과 명확 구분 |
| cross-workspace 소비자 탐색 | `searchAllRelations({ dstProject: 'target-pkg' })` | 모든 프로젝트에서 target-pkg로 가는 import 반환 |
| unused export (cross-workspace) | `searchAllRelations({ dstSymbolName: 'X' })` | 전체 프로젝트에서 X를 참조하는 relation 반환 |
| unused file (cross-workspace) | `getTransitiveDependencies(file)` (project 생략) | cross-workspace 파일 포함. `dstFilePath: null`(외부 npm)은 그래프에서 제외 |
| 워크스페이스별 unused dep | `searchRelations({ project: 'pkg-name', isExternal: true })` | 해당 워크스페이스의 외부 패키지 import만 반환 |
| 전체 파일 목록 | `listIndexedFiles()` | extensions 기준 모든 파일 (import/export 무관) |
| 워크스페이스 목록 | `gildash.projects` | `ProjectBoundary[]` = `{ dir: string, project: string }` |
| `project` + `isExternal` 동시 필터 | `searchRelations({ project: 'x', isExternal: true })` | AND 결합. 동시 사용 가능 |

기존 `barrel/resolver.ts`의 `createWorkspacePackageMap()`은 `package.json` workspaces 필드를 파싱하고 Bun.Glob으로 서브패키지를 탐색한다. 이 로직을 `shared/`로 추출하면 dependencies 디텍터에서도 재사용 가능. 또는 `gildash.projects`(ProjectBoundary[])를 직접 사용할 수 있다.

**리스크:** gildash가 대형 모노레포 (수백 워크스페이스, 수만 파일)에서 메모리/성능 문제를 일으킬 수 있다. 이건 실제 테스트로만 확인 가능.

### 구현 비용

| Phase | 예상 비용 | 근거 |
|-------|----------|------|
| Phase 1: unused files + exports 정밀화 | **낮음** | gildash API로 BFS reachability 이미 있음. 필터링 로직 추가 수준 |
| Phase 2: unused/unlisted deps | **낮음~중간** | gildash 0.15.1에서 인프라 완비. `searchRelations({ isExternal: true/false })` + 패키지명 추출 + package.json 비교 |
| Phase 3: 모노레포 지원 | **중간~높음** | gildash 자동 발견에 의존. 워크스페이스별 package.json 파싱, 리포팅 그룹핑, pnpm 지원 |
| Phase 4: knip 제거 | **낮음** | 파일 삭제 + 참조 정리 |

### Phase 간 의존성

- **Phase 0 → Phase 1~4:** Phase 0(Breaking Change 대응 + 즉시 적용)이 모든 Phase의 전제조건.
- Phase 1 → Phase 2: 순차. Phase 2가 Phase 1의 reachability 재사용.
- Phase 3: 독립. Phase 1-2와 병렬 진행 가능. 단 Phase 3 완료 전까지 모노레포에서 정확도 저하 가능.
- Phase 4: Phase 1~3 완료 후.
- Phase 0, 1, 2 모두 gildash 0.16.0으로 즉시 구현 가능. fallback 불필요.

### 수용 기준

각 Phase의 finding이 fixture 테스트에서 **known edge case 외 오탐/미탐 0**으로 통과.

Known edge case (허용되는 미탐):
- `import(\`./\${variable}\`)` — dynamic import template literal. 구조적 한계.
- config/CLI 도구 — import 없이 사용. `ignoreDependencies`로 위임.

### 블로커

없음. gildash 0.16.0에서 모든 요청이 반영됨. bare specifier, unresolved import, isExternal 필드, normalizePath, forward slash 보장 전부 사용 가능. fallback 불필요.
