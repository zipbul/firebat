# Firebat 아키텍처 리팩토링 계획

## 1. 현재 구조 진단

### 1.1 디렉토리/파일 문제

| 문제 | 위치 | 설명 |
|---|---|---|
| `infra/` vs `infrastructure/` 중복 | `src/infra/`, `src/infrastructure/` | 같은 이름, 다른 내용. `infra/`는 logging 하나, `infrastructure/`는 실제 구현체 |
| src root 고아 파일 12개 | `src/*.ts` | `arg-parse`, `firebat-config`, `interfaces`, `node-header`, `report`, `root-resolver`, `runtime-context`, `target-discovery`, `tool-version`, `ts-program`, `types` — 소속 불명 |
| `engine/` flat dump | `src/engine/` | 26개 파일이 flat 배치. AST, CFG, dataflow, hasher, normalizer, duplicate 등 무관한 관심사 혼재 |
| `scan.usecase.ts` god function | `src/application/scan/scan.usecase.ts` | 1516줄. 28개 feature import, infrastructure 직접 생성, 캐싱/파싱/감지/집계/리포팅 전부 수행 |
| 깨진 DI | `src/application/*/` | use case가 `infrastructure/sqlite/`, `infrastructure/memory/`, `infrastructure/hybrid/`를 직접 import → ports 패턴의 이점 제로 |

### 1.2 ports/infrastructure 패턴의 실패

`symbol-index.usecases.ts`가 보여주는 전형적 패턴:

```typescript
// use case 안에서 3개 구현체를 직접 import하여 조합
import { createHybridSymbolIndexRepository } from '../../infrastructure/hybrid/symbol-index.repository';
import { createInMemorySymbolIndexRepository } from '../../infrastructure/memory/symbol-index.repository';
import { createSqliteSymbolIndexRepository } from '../../infrastructure/sqlite/symbol-index.repository';
```

- **interface** 정의 (ports) → 2파일
- **sqlite** 구현 → 2파일
- **memory** 구현 → 2파일
- **hybrid** 조합 → 2파일
- **use case**에서 전부 직접 import → 교체 불가능

→ 추상화 비용만 지불, 추상화의 이점은 없음.

### 1.3 scan.usecase.ts 의존성 폭발

```
scan.usecase.ts (1516줄)
├── 28개 feature import (analyze* + createEmpty*)
├── infrastructure/hybrid/artifact.repository
├── infrastructure/hybrid/file-index.repository
├── infrastructure/memory/artifact.repository
├── infrastructure/memory/file-index.repository
├── infrastructure/sqlite/artifact.repository
├── infrastructure/sqlite/file-index.repository
├── infrastructure/sqlite/firebat.db
├── engine/auto-min-size
├── engine/hasher
├── features/* (28개 디렉토리)
└── 자체 캐싱 로직 + 파싱 + 감지 + 집계 + 리포팅
```

---

## 2. @zipbul/gildash 통합

### 2.1 gildash 개요

Bun-native **TypeScript code intelligence engine**. oxc-parser 기반 심볼 추출, cross-file 관계 추적, SQLite FTS5 검색, 의존성 그래프, incremental indexing, `@parcel/watcher` 내장.

- **설치 완료**: **0.5.0** (0.4.1 → 0.5.0 업그레이드 완료. ParserOptions passthrough, getCyclePaths Johnson's 교체, getDeadExports 삭제, maxCycles 옵션 포함)
- **저자 동일** (parkrevil) — API 안정성/호환성 리스크 없음
- **공유 의존성**: oxc-parser (`>=0.114.0`), bun:sqlite, drizzle-orm — 추가 의존성 최소
- **peerDependencies**: `@zipbul/result` (firebat에 추가 완료)

#### 정체성 선언 (gildash 최종 협의)

> **gildash** = TypeScript code indexing and dependency graph engine
> 파싱 · 추출 · 인덱싱 · 그래프 구축 · **정책 없는 기계적 가공**

> **firebat** = 코드 품질 보장 툴
> 가공 데이터에 **정책을 적용**하여 판정 · 권고

경계: gildash 내부에 정책 로직이 있으면 정체성 이탈. "좋다/나쁘다/죽었다"의 판정은 firebat 영역.

### 2.2 대체 범위

#### 제거되는 파일 (~25개)

| 현재 파일 | 대체 gildash API |
|---|---|
| `ports/symbol-index.repository.ts` (+ spec) | `searchSymbols()`, `getFullSymbol()` |
| `ports/file-index.repository.ts` (+ spec) | gildash 내부 Indexer |
| `infrastructure/sqlite/symbol-index.repository.ts` (+ spec) | gildash Store |
| `infrastructure/sqlite/file-index.repository.ts` (+ spec) | gildash Store |
| `infrastructure/memory/symbol-index.repository.ts` (+ spec) | gildash 내부 캐시 |
| `infrastructure/memory/file-index.repository.ts` (+ spec) | gildash 내부 캐시 |
| `infrastructure/hybrid/symbol-index.repository.ts` (+ spec) | gildash facade |
| `infrastructure/hybrid/file-index.repository.ts` (+ spec) | gildash facade |
| `application/symbol-index/symbol-index.usecases.ts` (+ spec) | `Gildash.open()` + API |
| `application/indexing/file-indexer.ts` (+ spec) | gildash Watcher + reindex |
| `engine/symbol-extractor-oxc.ts` (+ spec) | `extractSymbols()`, `getFullSymbol()` |
| `ts-program.ts` (+ spec) | `batchParse()` |

schema.ts의 files/symbols 테이블 정의와 관련 migration도 제거.

#### 유지되는 파일

| 컴포넌트 | 이유 |
|---|---|
| `ports/artifact.repository.ts` | gildash에 범용 캐시 없음 → `store/artifact.ts`로 단순화 |
| `ports/memory.repository.ts` | AI 에이전트 메모리 — gildash 관심사 밖 → `store/memory.ts`로 단순화 |
| `ports/logger.ts` | gildash는 logger를 수용하지만 제공하지 않음 |
| `infrastructure/ast-grep/` | 패턴 매칭 — gildash `findPattern` (FR-15) 0.4.0 포함, 즉시 교체 가능 |
| `infrastructure/oxfmt/` | 포매팅 — gildash 범위 밖 |
| `infrastructure/oxlint/` | 린팅 — gildash 범위 밖 |
| `infrastructure/tsgo/` | TypeScript LSP — gildash 범위 밖 |
| `engine/` (symbol-extractor-oxc 제외) | CFG, dataflow, hasher, normalizer 등 핵심 분석 엔진 |
| `features/` 전체 | 28개 detector — firebat 고유 도메인. 단, gildash API 활용으로 내부 로직 대폭 단순화 |

### 2.3 gildash 확장 기능 (21건 FR — 전수용 확정)

gildash 측과 21건의 기능 요청을 협의 완료. 전부 수용 확정.

#### CRITICAL (3건) — 마이그레이션 차단

| FR | 기능 | API | firebat 영향 | Status |
|---|------|-----|-------------|--------|
| FR-01 | scan-only 모드 | `GildashOptions.watchMode?: boolean` | watcher/heartbeat/signal handler 생략. DB 생성+풀인덱싱은 수행. `close({ cleanup?: boolean })`으로 DB 잔존 제어 | 0.4.0 ✅ |
| FR-02 | batchParse | `batchParse(filePaths): Result<Map<string, ParsedFile>>` | `createFirebatProgram` (~160줄) 전체 대체 | 0.4.0 ✅ |
| FR-03 | getImportGraph | `getImportGraph(project?): Result<ImportGraph>` | dependencies analyzer의 수동 adjacency 구축 ~300줄 대체. coupling/barrel-policy/forwarding도 공유 | 0.4.0 ✅ |

#### HIGH (6건) — 대규모 코드 감축

| FR | 기능 | API | firebat 영향 | Status |
|---|------|-----|-------------|--------|
| FR-04 | getCycles | `getCyclePaths(options?: { maxCycles?: number }): Result<string[][]>` | dependencies cycle 탐지 ~200줄 대체 (Tarjan SCC + Johnson's circuits + maxCycles). **0.5.0에서 알고리즘 교체 예정** (DFS+globalVisited → Johnson's) | 0.4.0 ✅ (알고리즘 0.5.0) |
| FR-05 | getIndexedFiles | `getIndexedFiles(project?): Result<string[]>` | target-discovery 동기화 검증용 | 0.4.0 ✅ |
| FR-06 | relation type 확장 | `'re-exports'` \| `'type-references'` 추가 | forwarding re-export chain 대폭 단순화. `import type` 구분 (이미 `metaJson.isType` 데이터 존재, type 레벨 분리) | 0.4.0 ✅ |
| FR-07 | getDeadExports | ~~`getDeadExports(project?): Result<DeadExport[]>`~~ | **0.5.0에서 삭제 예정** — entry point 기본 정책 내장(index.ts, main.ts 제외) = 정체성 이탈. 대체: `searchSymbols({ isExported: true })` + `searchRelations({ type: 'imports'/'re-exports' })` + firebat 자체 entry point 정책 | 0.4.0 ✅ (⚠️ 0.5.0 삭제) |
| FR-08 | onIndexed changedSymbols | `IndexResult.changedSymbols` | incremental scan에서 심볼 단위 재분석. **Phase 2로 이동 확정** (심볼 diff 로직 신규 필요) | 0.4.0 ✅ |
| FR-09 | getFullSymbol | `getFullSymbol(id): Result<ExtractedSymbol \| null>` + batch | edit.usecases 재파싱 제거. `extractSymbolsOxc` (131줄) 완전 대체 | 0.4.0 ✅ |

#### MEDIUM (6건) — 의미 있는 개선

| FR | 기능 | API | firebat 영향 | Status |
|---|------|-----|-------------|--------|
| FR-10 | getFileStats | `getFileStats(filePath): Result<FileMetrics>` + `getFilesByMetric()` | giant-file pre-filter, abstraction-fitness density | 0.4.0 ✅ |
| FR-11 | getModuleInterface | `getModuleInterface(filePath): Result<ModuleInterface>` | `computeAbstractness` ~50줄 + `exportStats` ~100줄 대체 | 0.4.0 ✅ |
| FR-12 | getFanMetrics | `getFanMetrics(project?): Result<FanMetrics[]>` | coupling inDegree/outDegree + dependencies fanIn/fanOut ~110줄 대체 | 0.4.0 ✅ |
| FR-13 | getTransitiveDependencies | `getTransitiveDependencies(filePath): Promise<Result<string[]>>` | modification-impact 양방향 영향 반경 계산 | 0.4.0 ✅ |
| FR-14 | resolveSymbol | `resolveSymbol(name, fromFile): Result<ResolvedSymbol>` | forwarding re-export chain ~200줄 대체. LSP hover/definition 활용 | 0.4.0 ✅ |
| FR-19 | searchSymbols regex | `SymbolSearchQuery.namePattern?: string` | concept-scatter 이름 패턴 그루핑 | 0.4.0 ✅ |

#### LOW (6건) — 미래/니치

| FR | 기능 | API | firebat 영향 | Status |
|---|------|-----|-------------|--------|
| FR-15 | findPattern | `findPattern(pattern, { filePaths? }): Result<PatternMatch[]>` | ast-grep 호출의 gildash 통합. 하이브리드: 인덱스 필터 + ast-grep 매칭 | 0.4.0 ✅ |
| FR-16 | indexExternalPackages | `indexExternalPackages(packageNames): Promise<Result<IndexResult>>` | LSP external library indexing 대체 | 0.4.0 ✅ |
| FR-17 | Cross-project search | `searchSymbols({ project: '*' })` | monorepo cross-package 검색 | 0.4.0 ✅ |
| FR-18 | diffSymbols | `diffSymbols(filePath, oldSource, newSource): Result<SymbolDiff[]>` | 에디터 통합 실시간 변경 감지 | 0.4.0 ✅ |
| FR-20 | getInternalRelations | `getInternalRelations(filePath): Result<CodeRelation[]>` | abstraction-fitness LCOM 메트릭. **데이터 이미 존재** (API 래핑만) | 0.4.0 ✅ |
| FR-21 | getHeritageChain | `getHeritageChain(symbolName, filePath): Result<HeritageChain>` | api-drift/modification-impact 클래스 계층 분석 | 0.4.0 ✅ |

### 2.4 gildash 선행 인프라 작업 (IMP-A~D)

gildash 자체 점검에서 발견된 데이터 갭. FR 구현의 전제 조건.

| ID | 내용 | 영향 FR | 상태 |
|----|------|---------|------|
| IMP-A | import relation에 `dstSymbolName` 기록 | FR-07, FR-14 | ✅ 0.4.0 완료 |
| IMP-B | re-export에 named specifier 기록 | FR-06, FR-14 | ✅ 0.4.0 완료 |
| IMP-C | 심볼 members 전체 정보 저장 | FR-09 | ✅ 0.4.0 완료 |
| IMP-D | files 테이블에 `lineCount` 추가 | FR-10 | ✅ 0.4.0 완료 |

### 2.5 gildash 릴리즈 현황

**0.5.0 릴리즈 완료. firebat 설치 완료.**

- 0.4.0 단일 릴리즈로 21건 FR + IMP-A~D 전부 포함
- 0.5.0에서 getCyclePaths Johnson's 교체, getDeadExports 삭제, maxCycles 옵션, ParserOptions passthrough 추가
- firebat 설치: `"@zipbul/gildash": "0.5.0"` (pinned, no ^), `"@zipbul/result": "^0.0.3"`
- gildash Phase 구분은 더 이상 의미 없음

#### 0.5.0 적용 항목 (전부 완료)

| # | 항목 | 내용 | 유형 | 상태 |
|---|------|------|------|------|
| 1 | oxc-parser bump | 0.114.0 → 0.115.0 | 보강 | ✅ |
| 2 | ParserOptions passthrough | `parseSource`, `batchParse` 시그니처에 `options?: ParserOptions` 추가 | 추가 | ✅ |
| 3 | getCyclePaths 알고리즘 교체 | DFS + globalVisited → **Tarjan SCC + Johnson's circuits** | 보강 | ✅ |
| 4 | getCyclePaths maxCycles | `getCyclePaths(options?: { maxCycles?: number })` | 추가 | ✅ (firebat에서 maxCycles:100 적용 완료) |
| 5 | getDeadExports 삭제 | entry point 정책 내장 = 정체성 이탈 | **삭제** | ✅ (firebat searchSymbols+searchRelations 조합으로 전환 완료) |
| 6 | 문서화 | getCyclePaths 알고리즘 변경, getImportGraph 활용 안내, 정체성 원칙 | 문서 | ✅ |

**firebat 액션 아이템 (완료):**
- getCyclePaths Johnson's 이식을 위한 레퍼런스 코드 공유 → gildash 0.5.0에 반영 완료
- `getDeadExports()` 의존 → `searchSymbols` + `searchRelations` 조합으로 전환 완료
- `getCyclePaths(undefined, { maxCycles: 100 })` firebat에 적용 완료

#### 0.4.0에서 추가 제공된 API (FR 외 14건)

FR 요청 범위 밖에서 gildash 자체적으로 추가한 API:

| API | 용도 | firebat 활용 |
|-----|------|-------------|
| `getDependencies(filePath)` | 파일의 직접 의존 목록 | detector 단위 파일 의존성 조회 |
| `getDependents(filePath)` | 파일의 역방향 의존 목록 | modification-impact 역추적 |
| `getAffected(changedFiles)` | 변경 파일의 전이 영향 범위 | incremental scan 대상 결정 (**BFS 수동 구현 대체**) |
| `searchRelations(query)` | 관계 검색 (type 필터) | forwarding/barrel-policy re-export 탐색 |
| `searchAllRelations(query)` | 전체 관계 검색 | cross-project 분석 |
| `getSymbolsByFile(filePath)` | 파일별 심볼 목록 | detector 단위 심볼 접근 |
| `parseSource(filePath, src)` | 단일 파일 파싱 | 에디터 통합 실시간 파싱 |
| `extractSymbols(filePath, ast)` | AST에서 심볼 추출 | `extractSymbolsOxc` 완전 대체 |
| `extractRelations(filePath, ast)` | AST에서 관계 추출 | 수동 import 파싱 대체 |
| `getParsedAst(filePath)` | 캐시된 AST 반환 | engine에서 재파싱 불필요 |
| `getFileInfo(filePath)` | 파일 메타 정보 | 파일 상태 조회 |
| `getStats()` | 인덱스 통계 | 디버그/리포트용 |
| `reindex()` | 수동 재인덱싱 | 테스트/디버그용 |
| `onIndexed(callback)` | 인덱싱 완료 이벤트 | MCP/LSP watch 모드 활용 |

### 2.6 협의 결과 요약 (3차 최종 협의)

#### 합의 완료 (6건)

| 항목 | 판정 | 상세 |
|------|------|------|
| node_id 종결 | ✅ | oxc-parser의 Allocator 기반 순차 ID — DB 저장 불필요, AST 직접 접근으로 충분 |
| oxc-parser 0.115.0 bump | ✅ 0.5.0 | peerDependencies `>=0.114.0` 유지. firebat `^0.114.0`과 호환 |
| ParserOptions passthrough | ✅ 0.5.0 | `parseSource`, `batchParse`에 `options?: ParserOptions` 추가. `lang`, `sourceType`, `astType`, `range`, `preserveParens`, `showSemanticErrors` 전부 passthrough |
| getCyclePaths → Johnson's | ✅ 0.5.0 | DFS+globalVisited는 elementary circuit 누락. "dependency graph engine"으로서 데이터 정확성 품질 문제로 판단. Tarjan SCC + Johnson's circuits로 교체 |
| getCyclePaths maxCycles | ✅ 0.5.0 | `getCyclePaths(options?: { maxCycles?: number })`. firebat의 `maxCircuits = 100` → `maxCycles: 100`으로 전환 |
| getDeadExports 삭제 | ✅ 0.5.0 | entry point 기본 정책 내장(index.ts/main.ts 제외) = 정체성 이탈. 0.x semver이므로 minor에서 breaking 허용 |

#### 기술 사항 (1~2차 협의에서 확인)

| 항목 | 내용 |
|------|------|
| `watchMode: false` 동작 | DB 생성 포함, heartbeat/signal 생략, ownership 경합 건너뛰 |
| `close({ cleanup })` | `false`(기본)=DB 유지, `true`=DB 파일 삭제 |
| `type-references` | `import type` → 별도 relation type 분리. `metaJson.isType` 하위호환 유지 |
| `import`의 `isType` 데이터 | **이미 존재** (`metaJson: { isType: true }`). type 분리만 추가 |
| FR-08 난이도 | Phase 2로 이동. 심볼 단위 diff 신규 로직 필요 |
| FR-20 intra-file relation | **데이터 이미 존재**. calls/heritage 파일 내부 관계가 인덱싱됨. API 래핑만 추가 |
| fingerprint 계산식 | `hash(name\|kind\|signature)` — IMP-C 변경이 직접 영향하지 않음 |
| DB migration | drizzle `migrate()` 매 실행 자동. corruption 시 삭제→재생성 로직 내장 |
| 버전 전략 | 0.x에서 breaking 허용 (semver spec) |

#### getCyclePaths Tarjan SCC + Johnson's 채택 근거

| 기준 | Tarjan SCC + Johnson's | Johnson's alone |
|------|----------------------|----------------|
| SCC 계산 | 한 번 (O(V+E)) | 매 반복마다 재계산 |
| 탐색 공간 | SCC 내 노드만 | 전체 그래프 |
| import graph 적합성 | 대부분 acyclic → 가지치기 효과 극대 | 비효율적 |
| 완전성 | 모든 elementary circuit 보장 | 동일 |

import graph에서는 전체 노드 중 사이클에 포함된 파일이 극소수. SCC preprocessing으로 그 극소수만 추출하면 Johnson's가 최소 공간에서 작동.

#### getDeadExports 삭제 후 firebat 대체 경로

```typescript
// AS-IS: gildash 0.4.x
const deadExports = gildash.getDeadExports();

// TO-BE: gildash 0.5.0+ (getDeadExports 삭제 후)
const allExported = gildash.searchSymbols({ isExported: true });
const importRelations = gildash.searchRelations({ type: 'imports' });
const reExportRelations = gildash.searchRelations({ type: 're-exports' });

// firebat 자체 정책 적용:
// 1. entry point 판별 (firebat config 기반, package.json main/exports)
// 2. test-only-export 판별 (~60줄 기존 래퍼 재활용)
// 3. 집합 연산: exported - (imported ∪ re-exported ∪ entry point ∪ test-only)
const deadExports = computeDeadExports(allExported, importRelations, reExportRelations, entryPoints);
```

---

## 3. 목표 아키텍처

### 3.1 디렉토리 구조

```
src/
├── main.ts                              # 진입점 (CLI/MCP 분기)
│
├── adapters/
│   ├── cli/                             # CLI 어댑터
│   └── mcp/                             # MCP 어댑터
│
├── core/
│   ├── types.ts                         # 공통 타입 (FirebatReport, FindingKind 등)
│   ├── detector-registry.ts             # 플러그인 레지스트리
│   ├── pipeline.ts                      # 스캔 파이프라인 오케스트레이터 (~100줄)
│   └── result-utils.ts                  # @zipbul/result unwrap 유틸리티
│
├── detectors/                           # 자체 완결 플러그인 (1 디렉토리 = 1 detector)
│   ├── api-drift/
│   │   ├── detector.plugin.ts           # 레지스트리 등록 + analyze + createEmpty
│   │   ├── analyzer.ts                  # 분석 로직
│   │   ├── analyzer.spec.ts
│   │   └── index.ts
│   ├── structural-duplicates/
│   │   ├── detector.plugin.ts
│   │   ├── analyzer.ts
│   │   ├── analyzer.spec.ts
│   │   └── index.ts
│   ├── nesting/
│   ├── coupling/                        # gildash getFanMetrics/getModuleInterface 활용
│   ├── dependencies/                    # gildash getImportGraph/getCyclePaths(maxCycles) + searchSymbols/searchRelations(dead export) 활용
│   ├── forwarding/                      # gildash searchRelations('re-exports')/resolveSymbol 활용
│   ├── giant-file/                      # gildash getFileStats 활용
│   ├── ...                              # 28개 detector
│   └── _catalog/                        # diagnostic-aggregator (catalog 정의)
│       └── catalog.ts
│
├── engine/                              # AST 분석 엔진 (firebat 고유)
│   ├── ast/
│   │   ├── normalizer.ts
│   │   ├── utils.ts
│   │   └── size-count.ts
│   ├── cfg/
│   │   ├── builder.ts
│   │   ├── types.ts
│   │   └── utils.ts
│   ├── dataflow/
│   │   └── dataflow.ts
│   ├── hasher.ts
│   ├── function-items.ts
│   ├── function-span.ts
│   ├── duplicate-collector.ts
│   ├── duplicate-detector.ts
│   └── types.ts
│
├── store/                               # 모든 persistence (ports+infrastructure 대체)
│   ├── gildash.ts                       # Gildash 인스턴스 factory/lifecycle
│   ├── artifact.ts                      # raw bun:sqlite — 스캔 결과 캐시 (~50줄)
│   └── memory.ts                        # raw bun:sqlite — 에이전트 메모리 (~50줄)
│
├── tooling/                             # 외부 도구 러너
│   ├── ast-grep.ts                      # @ast-grep/napi wrapper
│   ├── oxfmt.ts                         # oxfmt runner
│   ├── oxlint.ts                        # oxlint runner
│   └── tsgo.ts                          # tsgo LSP session
│
├── shared/                              # 공유 유틸리티
│   ├── config.ts                        # firebat-config loader + schema
│   ├── root-resolver.ts
│   ├── runtime-context.ts
│   ├── target-discovery.ts
│   ├── tool-version.ts
│   └── logger.ts                        # logger 구현 (ports/logger 대체)
│
└── workers/
    └── parse-worker.ts
```

주요 변경 (이전 계획 대비):
- `engine/parse-source.ts` 제거 → gildash `batchParse()` 대체
- `engine/symbol-extractor-oxc.ts` 제거 → gildash `extractSymbols()` / `getFullSymbol()` 대체
- `core/result-utils.ts` 추가 → `@zipbul/result` unwrap 유틸리티
- `engine/` 서브디렉토리 주석에 gildash API 활용 detector 명시

### 3.2 핵심 설계 원칙

#### Plugin Registry 패턴

```typescript
// core/detector-registry.ts
import type { Gildash } from '@zipbul/gildash';
import type { ParsedFile } from '@zipbul/gildash/parser';

interface AnalysisContext {
  readonly gildash: Gildash;
  readonly files: Map<string, ParsedFile>;    // batchParse 결과
  readonly rootAbs: string;
  readonly options: ScanOptions;
  readonly logger: FirebatLogger;
}

interface DetectorPlugin {
  readonly id: string;
  readonly analyze: (ctx: AnalysisContext) => Promise<AnalysisResult>;
  readonly createEmpty: () => AnalysisResult;
  readonly catalog: CatalogEntry;
}

const registry = new Map<string, DetectorPlugin>();

const register = (plugin: DetectorPlugin): void => {
  registry.set(plugin.id, plugin);
};

export { register, registry };
export type { AnalysisContext, DetectorPlugin };
```

```typescript
// detectors/api-drift/detector.plugin.ts
import { register } from '../../core/detector-registry';
import { analyzeApiDrift, createEmptyApiDrift } from './analyzer';
import { catalog } from './catalog';

register({
  id: 'api-drift',
  analyze: analyzeApiDrift,
  createEmpty: createEmptyApiDrift,
  catalog,
});
```

#### Pipeline 오케스트레이터 (~100줄)

```typescript
// core/pipeline.ts
import { isErr } from '@zipbul/result';
import { Gildash } from '@zipbul/gildash';
import { registry } from './detector-registry';
import type { AnalysisContext } from './detector-registry';

const runScan = async (options: ScanOptions): Promise<FirebatReport> => {
  // 1. gildash open (scan-only: watchMode false, fullIndex 수행)
  const gildashResult = await Gildash.open({
    projectRoot: options.rootAbs,
    watchMode: false,
    extensions: ['.ts', '.mts', '.cts', '.tsx'],
  });
  if (isErr(gildashResult)) throw new Error(gildashResult.data.message);
  const gildash = gildashResult;

  try {
    // 2. batchParse — 전체 대상 파일 파싱
    const filesResult = gildash.batchParse(options.targets);
    if (isErr(filesResult)) throw new Error(filesResult.data.message);

    // 3. AnalysisContext 구성
    const ctx: AnalysisContext = {
      gildash,
      files: filesResult,
      rootAbs: options.rootAbs,
      options,
      logger: options.logger,
    };

    // 4. detector 실행
    const enabled = resolveEnabledDetectors(options, registry);
    const results = await Promise.all(
      enabled.map(plugin => plugin.analyze(ctx)),
    );

    return assembleReport(results, enabled);
  } finally {
    // 5. cleanup (DB 유지로 다음 scan에서 incremental 이점)
    await gildash.close({ cleanup: false });
  }
};
```

- 현재 `scan.usecase.ts` 1516줄 → `pipeline.ts` ~100줄
- detector는 `ctx.gildash` 를 통해 graph/search/metrics API 직접 호출 가능

#### Gildash 통합

```typescript
// store/gildash.ts — factory 패턴, 명시적 lifecycle
import { Gildash, type GildashOptions } from '@zipbul/gildash';
import { isErr } from '@zipbul/result';

interface CreateGildashOptions {
  readonly projectRoot: string;
  readonly watchMode?: boolean;       // scan: false, MCP/LSP: true
  readonly extensions?: string[];
}

const createGildash = async (opts: CreateGildashOptions): Promise<Gildash> => {
  const result = await Gildash.open({
    projectRoot: opts.projectRoot,
    watchMode: opts.watchMode ?? false,
    extensions: opts.extensions ?? ['.ts', '.mts', '.cts', '.tsx'],
  });
  if (isErr(result)) {
    throw new Error(`Gildash open failed: ${result.data.message}`);
  }
  return result;
};

export { createGildash };
export type { CreateGildashOptions };
```

- **singleton 금지**: scan은 `open → use → close`, MCP/LSP는 장수명 인스턴스
- 호출자가 lifecycle 명시적 관리

#### Artifact/Memory 단순화

```typescript
// store/artifact.ts — raw bun:sqlite, no drizzle, no ports
import { Database } from 'bun:sqlite';

const getArtifact = <T>(db: Database, key: string, digest: string): T | null => {
  const row = db.query('SELECT value FROM artifacts WHERE key = ? AND digest = ?').get(key, digest);
  return row ? JSON.parse((row as { value: string }).value) : null;
};

const setArtifact = <T>(db: Database, key: string, digest: string, value: T): void => {
  db.run(
    'INSERT OR REPLACE INTO artifacts (key, digest, value) VALUES (?, ?, ?)',
    key, digest, JSON.stringify(value),
  );
};

export { getArtifact, setArtifact };
```

#### Detector에서 gildash API 활용 예시

```typescript
// detectors/dependencies/analyzer.ts — gildash 0.5.0 활용 시
import type { AnalysisContext } from '../../core/detector-registry';
import { isErr } from '@zipbul/result';

const analyzeDependencies = async (ctx: AnalysisContext) => {
  const { gildash, rootAbs } = ctx;

  // 이전: 수동 import AST 파싱 + adjacency 구축 ~90줄
  // 이후: gildash API 1줄
  const graphResult = gildash.getImportGraph();
  if (isErr(graphResult)) return createEmptyDependencies();
  const adjacency = graphResult; // Map<string, string[]>

  // 이전: Tarjan SCC + Johnson's circuits + 정규화 ~200줄
  // 이후: gildash API 1줄 (0.5.0에서 Johnson's 보장)
  const cyclesResult = gildash.getCyclePaths({ maxCycles: 100 });
  if (isErr(cyclesResult)) return createEmptyDependencies();
  const cycles = cyclesResult;

  // 이전: dead export 수동 탐지 ~120줄
  // 이후: searchSymbols + searchRelations 조합 + firebat 자체 정책
  // (getDeadExports는 0.5.0에서 삭제됨 — entry point 정책은 firebat 영역)
  const allExported = gildash.searchSymbols({ isExported: true });
  const importRelations = gildash.searchRelations({ type: 'imports' });
  const reExportRelations = gildash.searchRelations({ type: 're-exports' });
  const deadExports = computeDeadExports(allExported, importRelations, reExportRelations, entryPoints);

  // 이전: computeAbstractness + exportStats ~150줄
  // 이후: gildash API
  // const moduleInterface = gildash.getModuleInterface(filePath);

  // 이전: fanIn/fanOut manual computation ~80줄
  // 이후: gildash API
  // const fanMetrics = gildash.getFanMetrics();

  // ... 나머지 분석 로직 (layers, allowed deps 등은 firebat 고유)
};
```

---

## 4. 마이그레이션 실행 계획

### 4.0 전제 조건

- firebat 아키텍처 선행 정리 완료 (Phase P0, 0, D, A, B, C — 전부 커밋 완료)
- gildash **0.5.0** 설치 완료 (0.4.1 → 0.5.0 업그레이드)
- M-1 ~ M-8 완료. M-9, M-10 미착수.

### 4.1 실행 순서 총괄 (M-1 ~ M-10)

| Phase | Task | 삭제 대상 | 줄 수 | 주요 gildash API | 선행 | gildash 버전 |
|-------|------|----------|-------|-----------------|------|-------------|
| **M-1** | gildash 설치 + factory | 신규 파일 | +~40 | `Gildash.open()`, `close()` | — | 0.5.0 ✅ **완료** |
| **M-2** | Parse 인프라 교체 | `ts-program.ts`, `workers/parse-worker.ts` (+spec) | **-573** | `batchParse`, `parseSource`, `getParsedAst` | M-1 | 0.5.0 ✅ **완료** |
| **M-3** | Indexing 스택 삭제 | `symbol-extractor-oxc.ts`, `symbol-index.repository.ts` (ports+3구현), `file-index.ts`, `file-indexer.ts`, `symbol-index.usecases.ts` (+specs) | **-1,049** | `searchSymbols`, `getFullSymbol`, `getStats`, `listIndexedFiles` | M-1 | 0.5.0 ✅ **완료** |
| **M-4** | dependencies analyzer 단순화 | 부분 리라이트 | **-820** | `getImportGraph`, `getCyclePaths(maxCycles:100)`, `searchSymbols`, `searchRelations` | M-1 + 0.5.0 | 0.5.0 ✅ **완료** (maxCycles 적용) |
| **M-5** | forwarding analyzer 단순화 | 계획 수정 | — | — | — | ⚠️ **계획 수정** (아래 참조) |
| **M-6** | modification-impact 단순화 | BFS→getAffected | **-20** | `getAffected` | M-4 | 0.5.0 ✅ **완료** |
| **M-7** | coupling/giant-file/abstraction-fitness | 계획 수정 | — | — | — | ⚠️ **계획 수정** (아래 참조) |
| **M-8** | ast-grep 인프라 교체 | `@ast-grep/napi` 의존 제거 | **-148** | `findPattern` | M-1 | 0.5.0 ✅ **완료** |
| **M-9** | scan.usecase.ts 오케스트레이션 정리 | M-2~M-8에서 흡수 | 0 | — | M-2~M-8 | 0.5.0 ✅ **완료** (추가 정리불필요) |
| **M-10** | 신규 API 활용 기능 | MCP tool 등록 + analyzer 활용 | +features | `getAffected`, `getDependencies/Dependents`, `getSymbolsByFile`, `getHeritageChain`, `indexExternalPackages` | M-9 | 0.5.0 ✅ **완료** (6/6 API) |

**총계**: ~3,096줄 삭제 + ~1,000 spec줄 = **~4,060줄 감축**

#### 실행 순서 다이어그램

```
0.5.0 (현재) — M-1~M-8 완료
┌──────────────────────────────────────────┐
│ M-1 ✅ gildash 0.5.0 설치 + factory           │
│ M-2 ✅ parse 인프라 교체                        │
│ M-3 ✅ indexing 스택 삭제                      │
│ M-4 ✅ dependencies maxCycles:100 적용       │
│ M-5 ⚠️ 계획 수정 (resolveSymbol 의미론 불일치) │
│ M-6 ✅ mod-impact BFS→getAffected 전환       │
│ M-7 ⚠️ 계획 수정 (의미론 불일치 3건)         │
│ M-8 ✅ @ast-grep/napi 제거 완료              │
├──────────────────────────────────────────┤
│ M-9  ✅ scan.usecase.ts 정리 (M-2~M-8 흡수)   │
│ M-10 ✅ 신규 API 활용 (6/6 구현)              │
└──────────────────────────────────────────┘
```

### 4.2 Phase 상세

#### M-1: gildash 설치 + `src/store/gildash.ts` factory ✅ 완료

```bash
bun add @zipbul/gildash@0.5.0 @zipbul/result@^0.0.3
```

- `src/store/gildash.ts`: `createGildash()` factory wrapper, 명시적 lifecycle
- `src/store/gildash.spec.ts`: 8건 테스트 (HP 5, NE 2, ED 1), 100% coverage
- oxc-parser `^0.114.0`으로 다운그레이드 (gildash peerDep `>=0.114.0` 호환)
- `@zipbul/result` devDependencies → dependencies 이동

커밋: `feat: add gildash 0.4.1 + factory wrapper` (338c449)

#### M-2: Parse 인프라 교체

- `createFirebatProgram` (shared/ts-program.ts ~160줄) → `gildash.batchParse()`
- `workers/parse-worker.ts` (~413줄) → 삭제 (gildash 내부 파싱)
- 모든 `ParsedFile` 타입을 gildash 타입으로 전환
- 관련 spec 삭제/갱신
- **0.4.1로 착수 가능** (firebat이 현재 parseSync 옵션 미사용)
- 0.5.0 릴리즈 후 ParserOptions passthrough 패치 추가 (`sourceType: 'unambiguous'` 등)

커밋: `refactor: replace parse infra with gildash batchParse`

#### M-3: Indexing 스택 삭제

삭제 대상 (~1,049줄):
- `ports/symbol-index.repository.ts` + spec
- `ports/file-index.repository.ts` + spec
- `infrastructure/sqlite/symbol-index.repository.ts` + spec
- `infrastructure/sqlite/file-index.repository.ts` + spec
- `infrastructure/memory/symbol-index.repository.ts` + spec
- `infrastructure/memory/file-index.repository.ts` + spec
- `infrastructure/hybrid/symbol-index.repository.ts` + spec
- `infrastructure/hybrid/file-index.repository.ts` + spec
- `application/symbol-index/symbol-index.usecases.ts` + spec
- `application/indexing/file-indexer.ts` + spec
- `engine/symbol-extractor-oxc.ts` + spec

대체: `gildash.searchSymbols()`, `getFullSymbol()`, `getSymbolsByFile()`, `listIndexedFiles()`, `getStats()`

커밋: `refactor: remove indexing stack, delegate to gildash`

#### M-4: dependencies analyzer 단순화 ✅ 완료 (gildash 0.5.0 적용)

현재 ~1,189줄 analyzer에서 대부분 완료. 추가 적용: `getCyclePaths(undefined, { maxCycles: 100 })`

| 대상 | 현재 | 변경 후 | 감축 | 상태 |
|------|------|---------|------|------|
| adjacency 구축 | ~90줄 | `getImportGraph()` 1줄 | -90 | ✅ |
| cycle 탐지 | ~200줄 | `getCyclePaths(undefined, { maxCycles: 100 })` | -200 | ✅ (maxCycles 적용) |
| dead export 탐지 | ~120줄 | `searchSymbols` + `searchRelations` 조합 (~40줄) | -80 | ✅ |
| fanIn/fanOut | ~80줄 | ~~`getFanMetrics()`~~ 수동 계산 유지 | 0 | ⚠️ API 의미론 불일치 (M-7 참조) |
| abstractness | ~150줄 | ~~`getModuleInterface()`~~ 유지 | 0 | ⚠️ 별도 리서치 필요 |
| 기타 graph 유틸 | ~220줄 | gildash API 조합 | -220 | ✅ |
| firebat 고유 로직 | ~369줄 | 유지 | 0 | ✅ |

**0.5.0 의존 사유:**
- `getCyclePaths()`: 0.5.0에서 Tarjan SCC + Johnson's circuits로 교체 (elementary circuit 완전성 보장). 0.4.x는 DFS+globalVisited 기반으로 공유 노드 사이클 누락 가능.
- `getDeadExports()`: 0.5.0에서 삭제됨 (entry point 정책 내장 = gildash 정체성 이탈). `searchSymbols` + `searchRelations` 조합으로 전환 필요.

**dead export 전환 설계:**
- `searchSymbols({ isExported: true })` → 모든 exported 심볼
- `searchRelations({ type: 'imports' })` + `searchRelations({ type: 're-exports' })` → import/re-export 관계
- 집합 연산: exported - (imported ∪ re-exported ∪ entry point ∪ test-only)
- firebat 자체 entry point 정책 (package.json main/exports, firebat config)
- test-only-export 판별 래퍼 ~60줄 재활용

커밋: `refactor: simplify dependencies analyzer with gildash APIs`

#### M-5: forwarding analyzer — ⚠️ 계획 수정 (API 의미론 불일치)

**원래 계획**: re-export chain ~200줄 → `resolveSymbol()` 대체
**실제 분석 결과**: `resolveSymbol`은 re-export chain 추적용 API. forwarding analyzer는 thin-wrapper 감지(함수 본체가 다른 함수를 단순 호출하는 패턴)로, re-export와 목적이 다름.
- forwarding analyzer는 이미 `searchRelations` + `searchSymbols`를 활용 중 (779줄 중 gildash 호출 다수)
- `resolveSymbol`로 대체 가능한 코드 영역이 없음
- **결론**: 추가 gildash API 전환 불필요. 현재 상태가 최적.

#### M-6: modification-impact — ✅ getAffected 전환 완료

**원래 계획**: 양방향 BFS ~152줄 → `getAffected(changedFiles)` 대체
**실제 구현**: BFS + edges Map (~35줄) → `getAffected` per-unique-file + cache (~15줄)
- 동일 파일의 export들은 BFS에서 동일한 impactRadius를 가짐 → `getAffected` (파일 단위)가 의미론적으로 동등
- `affectedCache = Map<fileIndex, string[]>`로 파일당 1회만 호출
- `highRiskCallers`: getAffected 반환값(절대경로) → `normalizeFile` → `layerOf`로 계산
- spec 5개 `it` 블록 유지, mock을 `searchRelations` → `getAffected`로 전환
- **결과**: ~20줄 순 감축

커밋: `refactor: simplify modification-impact with gildash getAffected`

#### M-7: coupling/giant-file/abstraction-fitness — ⚠️ 계획 수정 (API 의미론 불일치)

**원래 계획**: 3개 analyzer에 gildash API 직접 호출 추가
**실제 분석 결과**: 각 API의 의미론이 실제 사용 패턴과 불일치

| Analyzer | 계획 API | 불일치 사유 |
|----------|---------|------------|
| coupling | `getFanMetrics` | coupling은 dependencies 분석 결과(`DependencyAnalysis`)를 소비하는 하류 detector. gildash 직접 호출은 아키텍처 중복 |
| giant-file | `getFileStats` | `getFileStats`는 인덱스 데이터 사용(stale 가능). 현재 코드는 `sourceText` 직읽기(live, 정확). 50줄 파일에 API 전환 불필요 |
| abstraction-fitness | `getInternalRelations` | `getInternalRelations`은 파일 내부 관계(calls/heritage). 현재 코드는 cross-file import 패턴 분석. 또한 함수 시그니처에 gildash 추가 필요 → caller 6곳 수정 필요 → ~10줄 절감 대비 비용 과다 |

**결론**: 3개 모두 현재 상태 유지가 최적. 계획 자체가 API 의미론에 대한 사전 분석 부족에서 기인.

#### M-8: ast-grep 인프라 교체 ✅ 완료

- `tooling/ast-grep/find-pattern.ts` + `find-pattern.usecase.ts` → `gildash.findPattern()`
- `@ast-grep/napi` package.json에서 의존성 제거 완료
- ~148줄 감축

커밋: `refactor: replace ast-grep infra with gildash findPattern`

#### M-9: scan.usecase.ts 오케스트레이션 정리 ✅ 완료

- M-2~M-8 각 단계에서 인크리멘탈하게 정리 완료 (dead import 0건, gildash lifecycle 이미 pipeline 수준)
- 추가 정리 항목 없음 (oxlint 검증)

#### M-10: 신규 API 활용 기능 ✅ 완료 (6/6 API)

M-2~M-8 구현 과정에서 대부분 활용 완료. 마지막 `getSymbolsByFile` MCP tool 등록 완료.

| API | 사용처 | 구현 시점 |
|-----|--------|----------|
| `getAffected` | mod-impact analyzer + MCP scan | M-6 |
| `getDependencies` | MCP `query-dependencies` tool | M-4 |
| `getDependents` | MCP `query-dependencies` tool | M-4 |
| `getHeritageChain` | api-drift analyzer | M-4 |
| `indexExternalPackages` | MCP `index-external-packages` tool | M-8 |
| `getSymbolsByFile` | MCP `symbols-by-file` tool | M-10 |

### 4.3 gildash 의존성 상태

0.4.1 설치 완료. 0.5.0에서 getCyclePaths Johnson's 교체 + getDeadExports 삭제 + ParserOptions passthrough 추가.

| M-Phase | 필요한 gildash API | 최소 버전 | 상태 |
|---------|-------------------|-----------|------|
| M-1 | `Gildash.open()`, `close()` | 0.5.0 | ✅ **완료** |
| M-2 | `batchParse`, `parseSource`, `getParsedAst` | 0.5.0 | ✅ **완료** |
| M-3 | `searchSymbols`, `getFullSymbol`, `extractSymbols`, `getStats`, `listIndexedFiles` | 0.5.0 | ✅ **완료** |
| M-4 | `getImportGraph`, `getCyclePaths(maxCycles:100)`, `searchSymbols`, `searchRelations` | 0.5.0 | ✅ **완료** |
| M-5 | ~~`resolveSymbol`~~ | — | ⚠️ **계획 수정** (API 의미론 불일치, 현재 상태 최적) |
| M-6 | `getAffected` | 0.5.0 | ✅ **완료** (BFS→getAffected 전환) |
| M-7 | ~~`getFanMetrics`, `getFileStats`, `getInternalRelations`~~ | — | ⚠️ **계획 수정** (API 의미론 불일치, 현재 상태 최적) |
| M-8 | `findPattern` (+ `@ast-grep/napi` 의존 제거) | 0.5.0 | ✅ **완료** |
| M-9 | 전체 | 0.5.0 | ✅ **완료** (M-2~M-8에서 인크리멘탈 정리 흡수, 추가 작업 불필요) |
| M-10 | `getAffected`, `getDependencies/Dependents`, `getSymbolsByFile`, `getHeritageChain`, `indexExternalPackages` | 0.5.0 | ✅ **완료** (6/6 API 구현. MCP tool + analyzer 활용) |

### 4.4 마이그레이션 규칙

- **통합/E2E 불가침**: Phase P0 이후 `test/integration/`, `test/e2e/` 파일은 일체 수정 금지. 내부 구조 변경은 barrel export에서 흡수.
- **M-Phase 단위 커밋**: 각 M-Phase 완료 시 커밋. Phase 중간 상태로 커밋 금지.
- **테스트 선행**: 각 파일 이동/변경 전 관련 테스트 확인, 이동 후 즉시 재실행.
- **import 경로 일괄 갱신**: 파일 이동 시 `grep -r` 으로 모든 import 참조 갱신. 단, test/는 barrel 경유이므로 갱신 불필요.
- **기능 변경 금지**: 리팩토링 중 기능 추가/변경 없음. 동작 동일성 보장. (M-10은 예외 — 신규 기능)
- **순차 실행**: M-1~M-8 완료 → M-9 → M-10
- **M-5/M-7 계획 수정**: gildash API 의미론 분석 결과, `resolveSymbol`/`getFanMetrics`/`getFileStats`/`getInternalRelations` 전환은 목적 불일치로 취소. 현재 상태가 최적.

---

## 5. 기대 효과

### 정량적

| 지표 | 현재 | 목표 |
|---|---|---|
| scan.usecase.ts | 1516줄 | pipeline.ts (대폭 축소) |
| symbol-index 관련 파일 | ~20개 | 1개 (`store/gildash.ts`) |
| infrastructure/ 파일 | ~30개 (3층 repo × 5 entity) | 0개 (디렉토리 삭제) |
| ports/ 파일 | 10개 | 0개 (디렉토리 삭제) |
| feature 추가 시 수정 파일 | 7+ 파일 | 0 기존 파일 (1 디렉토리 생성) |
| 최대 import 깊이 | 4단계 (`../../infrastructure/hybrid/...`) | 2단계 (`../store/...`, `../engine/...`) |
| 총 코드 제거량 | — | **~4,060줄** (본체 ~3,096줄 + spec ~1,000줄) |

코드 제거 내역:

| 대상 | 제거 줄 수 | M-Phase |
|------|-----------|----------|
| `createFirebatProgram` (ts-program.ts) | ~160줄 | M-2 |
| `workers/parse-worker.ts` | ~413줄 | M-2 |
| symbol-index 인프라 3계층 (ports+sqlite+memory+hybrid) | ~400줄 | M-3 |
| file-index 인프라 3계층 | ~300줄 | M-3 |
| `extractSymbolsOxc` | ~131줄 | M-3 |
| symbol-index.usecases + file-indexer | ~218줄 | M-3 |
| dependencies adjacency/cycle/dead-export/fan/abstractness | **~820줄** | M-4 |
| forwarding re-export chain | ~254줄 | M-5 |
| modification-impact BFS | ~152줄 | M-6 |
| coupling/giant-file/abstraction-fitness metrics | ~70줄 | M-7 |
| ast-grep infra | ~148줄 | M-8 |
| scan.usecase.ts 정리 | ~30줄 | M-9 |

※ M-4 수치 변경: 기존 ~860줄 → ~820줄 (getDeadExports 삭제로 searchSymbols+searchRelations 조합 코드 ~40줄 추가)

### 정성적

- **Detector 추가 = 1 디렉토리 생성**: `detector.plugin.ts`가 registry에 자동 등록, 기존 코드 수정 불필요
- **gildash가 인프라 + 인텔리전스 부담 홉수**: 파일 감시, incremental indexing, FTS5, multi-process safety, import graph, fan metrics, cycle detection
- **정책/판정은 firebat 영역**: dead export 판별, entry point 정책, test-only-export, layer violation — gildash는 데이터만 제공
- **detector가 분석에만 집중**: `ctx.gildash.getImportGraph()` 한 줄로 adjacency 획득 — 수백 줄의 AST 수동 파싱 불필요
- **에이전트 바이브코딩 최적화**: flat 구조 + 자체 완결 플러그인 → 파일 탐색 최소화, 컨텍스트 크기 축소

---

## 6. 리스크 & 미결 사항

| 리스크 | 상태 | 대응 |
|---|---|---|
| gildash Phase 일정 불확정 | ✅ **해소** | 0.5.0 릴리즈 완료. firebat 설치 완료. |
| oxc-parser 버전 충돌 | ✅ **해소** | M-1에서 `^0.114.0`으로 다운그레이드 완료. gildash peerDep `>=0.114.0` 호환. |
| `@zipbul/result` 미보유 | ✅ **해소** | M-1에서 `^0.0.3` dependencies 추가 완료. |
| IMP-A~D DB 스키마 변경 | ✅ **해소** | 0.4.0에서 완료. drizzle 자동 migration. |
| gildash ParsedFile ↔ firebat ParsedFile 호환성 | ✅ **해소** | M-2에서 `ParsedFile` as cast 사용. 구조적 호환 확인 완료. |
| drizzle-orm 의존성 중복 | ⚠️ 경미 | gildash도 drizzle-orm 사용 (transitive). artifact/memory가 raw bun:sqlite로 전환되면 firebat 직접 의존 제거 가능. |
| 대규모 import 경로 변경 | ⚠️ 관리 필요 | M-2~M-8에서 점진적 처리 완료. |
| E2E 테스트 깨짐 | ⚠️ 리스크 낮음 | CLI output format 변경 없으므로 리스크 낮음. M-9 후 E2E 확인. |
| Worker pool 제거 영향 | ✅ **해소** | M-2에서 parse-worker 삭제 완료. 빌드 설정 확인됨. |
| `getDeadExports()` 0.5.0 삭제 | ✅ **해소** | M-4에서 `searchSymbols` + `searchRelations` 조합으로 전환 완료. |
| M-5/M-7 API 의미론 불일치 | 🟡 **발견** | `resolveSymbol`(M-5), `getFanMetrics`/`getFileStats`/`getInternalRelations`(M-7)은 실제 사용 패턴과 목적이 다름. 계획 수정 완료. |
| `@ast-grep/napi` dead dependency | ✅ **해소** | M-8에서 package.json에서 제거. gildash `findPattern`으로 대체 완료. |
| trace-symbol spec gildash mock 누락 | 🟡 **기존 결함** | `trace-symbol.usecase.spec.ts`에서 `store/gildash.ts` mock 없이 실제 gildash.open 호출 → 실패. M-3 dead mock 제거와 무관 (변경 전에도 실패). |
