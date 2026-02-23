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

- **현재 버전**: v0.3.1 → Phase 0~2 완료 시 **0.4.0** 릴리즈 예정
- **저자 동일** (parkrevil) — API 안정성/호환성 리스크 없음
- **공유 의존성**: oxc-parser (`>=0.114.0`), bun:sqlite, drizzle-orm — 추가 의존성 최소
- **peerDependencies**: `@zipbul/result` (firebat에 추가 필요)

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
| `infrastructure/ast-grep/` | 패턴 매칭 — gildash FR-15 (Phase 3) 전까지 유지 |
| `infrastructure/oxfmt/` | 포매팅 — gildash 범위 밖 |
| `infrastructure/oxlint/` | 린팅 — gildash 범위 밖 |
| `infrastructure/tsgo/` | TypeScript LSP — gildash 범위 밖 |
| `engine/` (symbol-extractor-oxc 제외) | CFG, dataflow, hasher, normalizer 등 핵심 분석 엔진 |
| `features/` 전체 | 28개 detector — firebat 고유 도메인. 단, gildash API 활용으로 내부 로직 대폭 단순화 |

### 2.3 gildash 확장 기능 (21건 FR — 전수용 확정)

gildash 측과 21건의 기능 요청을 협의 완료. 전부 수용 확정.

#### CRITICAL (3건) — 마이그레이션 차단

| FR | 기능 | API | firebat 영향 |
|---|------|-----|-------------|
| FR-01 | scan-only 모드 | `GildashOptions.watchMode?: boolean` | watcher/heartbeat/signal handler 생략. DB 생성+풀인덱싱은 수행. `close({ cleanup?: boolean })`으로 DB 잔존 제어 |
| FR-02 | batchParse | `batchParse(filePaths): Result<Map<string, ParsedFile>>` | `createFirebatProgram` (~160줄) 전체 대체 |
| FR-03 | getImportGraph | `getImportGraph(project?): Result<ImportGraph>` | dependencies analyzer의 수동 adjacency 구축 ~300줄 대체. coupling/barrel-policy/forwarding도 공유 |

#### HIGH (6건) — 대규모 코드 감축

| FR | 기능 | API | firebat 영향 |
|---|------|-----|-------------|
| FR-04 | getCycles | `getCycles(project?, maxCycles?): Promise<Result<string[][]>>` | dependencies cycle 탐지 ~100줄 대체 |
| FR-05 | getIndexedFiles | `getIndexedFiles(project?): Result<string[]>` | target-discovery 동기화 검증용 |
| FR-06 | relation type 확장 | `'re-exports'` \| `'type-references'` 추가 | forwarding re-export chain 대폭 단순화. `import type` 구분 (이미 `metaJson.isType` 데이터 존재, type 레벨 분리) |
| FR-07 | getDeadExports | `getDeadExports(project?): Result<DeadExport[]>` | dependencies dead export ~200줄 대체. SQL 1회 계산 |
| FR-08 | onIndexed changedSymbols | `IndexResult.changedSymbols` | incremental scan에서 심볼 단위 재분석. **Phase 2로 이동 확정** (심볼 diff 로직 신규 필요) |
| FR-09 | getFullSymbol | `getFullSymbol(id): Result<ExtractedSymbol \| null>` + batch | edit.usecases 재파싱 제거. `extractSymbolsOxc` (131줄) 완전 대체 |

#### MEDIUM (6건) — 의미 있는 개선

| FR | 기능 | API | firebat 영향 |
|---|------|-----|-------------|
| FR-10 | getFileStats | `getFileStats(filePath): Result<FileMetrics>` + `getFilesByMetric()` | giant-file pre-filter, abstraction-fitness density |
| FR-11 | getModuleInterface | `getModuleInterface(filePath): Result<ModuleInterface>` | `computeAbstractness` ~50줄 + `exportStats` ~100줄 대체 |
| FR-12 | getFanMetrics | `getFanMetrics(project?): Result<FanMetrics[]>` | coupling inDegree/outDegree + dependencies fanIn/fanOut ~110줄 대체 |
| FR-13 | getTransitiveDependencies | `getTransitiveDependencies(filePath): Promise<Result<string[]>>` | modification-impact 양방향 영향 반경 계산 |
| FR-14 | resolveSymbol | `resolveSymbol(name, fromFile): Result<ResolvedSymbol>` | forwarding re-export chain ~200줄 대체. LSP hover/definition 활용 |
| FR-19 | searchSymbols regex | `SymbolSearchQuery.namePattern?: string` | concept-scatter 이름 패턴 그루핑 |

#### LOW (6건) — 미래/니치

| FR | 기능 | API | firebat 영향 |
|---|------|-----|-------------|
| FR-15 | findPattern | `findPattern(pattern, { filePaths? }): Result<PatternMatch[]>` | ast-grep 호출의 gildash 통합. 하이브리드: 인덱스 필터 + ast-grep 매칭 |
| FR-16 | indexExternalPackages | `indexExternalPackages(packageNames): Promise<Result<IndexResult>>` | LSP external library indexing 대체 |
| FR-17 | Cross-project search | `searchSymbols({ project: '*' })` | monorepo cross-package 검색 |
| FR-18 | diffSymbols | `diffSymbols(filePath, oldSource, newSource): Result<SymbolDiff[]>` | 에디터 통합 실시간 변경 감지 |
| FR-20 | getInternalRelations | `getInternalRelations(filePath): Result<CodeRelation[]>` | abstraction-fitness LCOM 메트릭. **데이터 이미 존재** (API 래핑만) |
| FR-21 | getHeritageChain | `getHeritageChain(symbolName, filePath): Result<HeritageChain>` | api-drift/modification-impact 클래스 계층 분석 |

### 2.4 gildash 선행 인프라 작업 (IMP-A~D)

gildash 자체 점검에서 발견된 데이터 갭. FR 구현의 전제 조건.

| ID | 내용 | 영향 FR | 비고 |
|----|------|---------|------|
| IMP-A | import relation에 `dstSymbolName` 기록 | FR-07, FR-14 | 현재 모든 import의 `dstSymbolName`이 `null` |
| IMP-B | re-export에 named specifier 기록 | FR-06, FR-14 | `export { A, B as C } from './foo'` 추적 |
| IMP-C | 심볼 members 전체 정보 저장 | FR-09 | 현재 이름만 저장, 타입/visibility 누락 |
| IMP-D | files 테이블에 `lineCount` 추가 | FR-10 | 스키마 변경 (drizzle 자동 migration 지원) |

### 2.5 gildash 구현 Phase (gildash 측 계획)

```
gildash Phase 0 (인프라)   → IMP-A, IMP-B, IMP-C, IMP-D + type-references 분리
gildash Phase 1 (독립 FR)  → FR-01~05, 11, 13, 17~21
gildash Phase 2 (의존 FR)  → FR-06, 07, 08, 09, 10, 12, 14
gildash Phase 3 (외부 도입) → FR-15, 16
gildash Phase 4 (최적화)   → DependencyGraph 캐싱
```

- Phase 0~2 변경은 **0.4.x** patch 릴리즈로 순차 배포
- Phase 3 이후는 **0.5.0** 이후 별도 판단
- 일정: 각 Phase 완료 시 어나운스 방식. firebat은 FR 선행 배포 순서 조정 요청 가능.
- firebat peerDep: `"@zipbul/gildash": "^0.4.0"`

### 2.6 합의 결과 요약 (기술 사항)

gildash 2차 답변에서 확인된 기술 사항:

| 항목 | 내용 |
|------|------|
| `watchMode: false` 동작 | DB 생성 포함, heartbeat/signal 생략, ownership 경합 건너뜀 |
| `close({ cleanup })` | `false`(기본)=DB 유지, `true`=DB 파일 삭제 |
| `type-references` | `import type` → 별도 relation type 분리. `metaJson.isType` 하위호환 유지 |
| `import`의 `isType` 데이터 | **이미 존재** (`metaJson: { isType: true }`). type 분리만 추가 |
| FR-08 난이도 | gildash 인정. Phase 1 → **Phase 2로 이동**. 심볼 단위 diff 신규 로직 필요 |
| FR-20 intra-file relation | **데이터 이미 존재**. calls/heritage 파일 내부 관계가 인덱싱됨. API 래핑만 추가 |
| fingerprint 계산식 | `hash(name\|kind\|signature)` — IMP-C 변경이 직접 영향하지 않음 |
| DB migration | drizzle `migrate()` 매 실행 자동. corruption 시 삭제→재생성 로직 내장 |
| 버전 전략 | 0.x에서 breaking 허용 (semver spec). 0.4.0 릴리즈 |

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
│   ├── dependencies/                    # gildash getImportGraph/getCycles/getDeadExports 활용
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
// detectors/dependencies/analyzer.ts — gildash 활용 시
import type { AnalysisContext } from '../../core/detector-registry';
import { isErr } from '@zipbul/result';

const analyzeDependencies = async (ctx: AnalysisContext) => {
  const { gildash, rootAbs } = ctx;

  // 이전: 수동 import AST 파싱 + adjacency 구축 ~300줄
  // 이후: gildash API 1줄
  const graphResult = gildash.getImportGraph();
  if (isErr(graphResult)) return createEmptyDependencies();
  const { adjacency, reverseAdjacency } = graphResult;

  // 이전: normalizeCycle + recordCyclePath + findCycles ~100줄
  // 이후: gildash API 1줄
  const cyclesResult = await gildash.getCycles(undefined, 100);
  if (isErr(cyclesResult)) return createEmptyDependencies();
  const cycles = cyclesResult;

  // 이전: dead export 수동 탐지 ~200줄
  // 이후: gildash API 1줄
  const deadExportsResult = gildash.getDeadExports();

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

## 4. 마이그레이션 전략

### 4.0 전제 조건

- gildash 0.4.0 릴리즈 (Phase 0 + Phase 1 독립 FR 포함)
- firebat 자체 선행 작업 (Phase 0) 완료

### 4.1 단계별 실행 계획

#### firebat Phase 0: 선행 준비 (gildash 대기 중 병행)

gildash Phase 0~1 완료를 기다리는 동안 firebat 자체 준비 작업.

1. **oxc-parser `>=0.114.0` 업그레이드** — gildash peerDep 충족
2. **`@zipbul/result` 의존성 추가** + `core/result-utils.ts` unwrap 유틸리티
3. **`store/artifact.ts` 생성** — raw bun:sqlite로 ArtifactRepository 재구현
4. **`store/memory.ts` 생성** — raw bun:sqlite로 MemoryRepository 재구현
5. 테스트 통과 확인

이 단계에서 gildash는 아직 도입하지 않음. 기존 코드 동작 유지.

#### firebat Phase 1: gildash 도입 + scan pipeline (gildash 0.4.0 필요)

1. `bun add @zipbul/gildash@^0.4.0`
2. `store/gildash.ts` 생성 — factory 패턴, 명시적 lifecycle
3. `core/pipeline.ts` 생성 — gildash 기반 scan 오케스트레이터
   - `Gildash.open({ watchMode: false })` → `batchParse()` → detector 실행 → `close()`
4. `createFirebatProgram` (`ts-program.ts`) → `gildash.batchParse()` 전환
5. `extractSymbolsOxc` (`engine/symbol-extractor-oxc.ts`) → `gildash.extractSymbols()` / `getFullSymbol()` 전환
6. 기존 `application/symbol-index/`, `application/indexing/`를 gildash API로 교체
7. 교체 대상 ~25개 파일 제거
8. 테스트 통과 확인

#### firebat Phase 2: Plugin Registry 도입

1. `core/detector-registry.ts` 생성 — `AnalysisContext`에 gildash 인스턴스 포함
2. 28개 detector를 `detectors/*/detector.plugin.ts` 형태로 마이그레이션
3. gildash API 활용 detector 전환:
   - **dependencies**: `getImportGraph()`, `getCycles()`, `getDeadExports()`, `getFanMetrics()`
   - **coupling**: `getFanMetrics()`, `getModuleInterface()`
   - **forwarding**: `searchRelations({ type: 're-exports' })`, `resolveSymbol()`
   - **barrel-policy**: `searchRelations({ type: 're-exports' })`
   - **giant-file**: `getFileStats()`
4. `detectors/_catalog/catalog.ts`로 diagnostic-aggregator 분산
5. `scan.usecase.ts` 제거
6. 테스트 통과 확인

#### firebat Phase 3: 디렉토리 정리

1. `src/` root 고아 파일 → `shared/`로 이동
2. `engine/` flat → `engine/ast/`, `engine/cfg/`, `engine/dataflow/` 서브디렉토리화
3. `tooling/` 생성 — `infrastructure/{ast-grep,oxfmt,oxlint,tsgo}` 이동 + flatten
4. `shared/logger.ts` — `ports/logger.ts` + `infra/logging.ts` + `infrastructure/logging/` 통합
5. `ports/`, `infrastructure/`, `infra/` 디렉토리 전체 삭제
6. 테스트 통과 확인

#### firebat Phase 4: 어댑터 + 고급 FR 활용

1. `adapters/cli/`, `adapters/mcp/` — import 경로 갱신
2. MCP 서버에 gildash 기반 도구 추가:
   - symbol search (`searchSymbols`, regex 포함)
   - dependency graph (`getImportGraph`, `getCycles`)
   - dead export report (`getDeadExports`)
3. LSP 강화 — `resolveSymbol()`, `getHeritageChain()` 활용
4. incremental scan 설계 — `onIndexed` + `changedSymbols` (gildash FR-08)
5. `main.ts` — CLI/MCP 분기 진입점
6. 전체 테스트 + E2E 통과 확인

### 4.2 gildash 의존성 매트릭스

| firebat Phase | 필요한 gildash FR | gildash Phase |
|---|---|---|
| Phase 1 | FR-01, FR-02, FR-05 | gildash Phase 1 |
| Phase 2 (dependencies) | FR-03, FR-04, FR-06, FR-07, FR-12 | gildash Phase 1~2 |
| Phase 2 (forwarding) | FR-06, FR-14 | gildash Phase 2 |
| Phase 2 (coupling) | FR-11, FR-12 | gildash Phase 1~2 |
| Phase 2 (giant-file) | FR-10 | gildash Phase 2 |
| Phase 4 (MCP) | FR-19 | gildash Phase 1 |
| Phase 4 (incremental) | FR-08 | gildash Phase 2 |
| Phase 4 (LSP) | FR-14, FR-21 | gildash Phase 2 |

**firebat Phase 1은 gildash Phase 1 완료만으로 착수 가능.** Phase 2 중 일부 detector는 gildash Phase 2까지 대기 필요 — 해당 detector는 기존 로직 유지 후 점진 전환.

### 4.3 마이그레이션 규칙

- **Phase 단위 커밋**: 각 Phase 완료 시 커밋. Phase 중간 상태로 커밋 금지.
- **테스트 선행**: 각 파일 이동/변경 전 관련 테스트 확인, 이동 후 즉시 재실행.
- **import 경로 일괄 갱신**: 파일 이동 시 `grep -r` 으로 모든 import 참조 갱신.
- **기능 변경 금지**: 리팩토링 중 기능 추가/변경 없음. 동작 동일성 보장.
- **점진적 gildash 전환**: gildash Phase 2 대기가 필요한 detector는 기존 로직 유지 → gildash FR 배포 시 교체.

---

## 5. 기대 효과

### 정량적

| 지표 | 현재 | 목표 |
|---|---|---|
| scan.usecase.ts | 1516줄 | pipeline.ts ~100줄 |
| symbol-index 관련 파일 | ~20개 | 1개 (`store/gildash.ts`) |
| infrastructure/ 파일 | ~30개 (3층 repo × 5 entity) | 0개 (디렉토리 삭제) |
| ports/ 파일 | 10개 | 0개 (디렉토리 삭제) |
| feature 추가 시 수정 파일 | 7+ 파일 | 0 기존 파일 (1 디렉토리 생성) |
| 최대 import 깊이 | 4단계 (`../../infrastructure/hybrid/...`) | 2단계 (`../store/...`, `../engine/...`) |
| 총 코드 제거량 | — | **~2,200줄+** |

코드 제거 내역:

| 대상 | 제거 줄 수 |
|------|-----------|
| `createFirebatProgram` (ts-program.ts) | ~160줄 |
| scan.usecase.ts 파싱/인프라 구축 | ~200줄 |
| dependencies cycle/graph 구축 | ~400줄 |
| dependencies dead export 탐지 | ~200줄 |
| forwarding re-export chain | ~300줄 |
| coupling metric 계산 | ~110줄 |
| `extractSymbolsOxc` | ~131줄 |
| symbol-index 인프라 3계층 | ~400줄 |
| file-index 인프라 3계층 | ~300줄 |

### 정성적

- **Detector 추가 = 1 디렉토리 생성**: `detector.plugin.ts`가 registry에 자동 등록, 기존 코드 수정 불필요
- **gildash가 인프라 + 인텔리전스 부담 흡수**: 파일 감시, incremental indexing, FTS5, multi-process safety, import graph, dead export, fan metrics, cycle detection
- **detector가 분석에만 집중**: `ctx.gildash.getImportGraph()` 한 줄로 adjacency 획득 — 수백 줄의 AST 수동 파싱 불필요
- **에이전트 바이브코딩 최적화**: flat 구조 + 자체 완결 플러그인 → 파일 탐색 최소화, 컨텍스트 크기 축소

---

## 6. 리스크 & 미결 사항

| 리스크 | 대응 |
|---|---|
| gildash Phase 일정 불확정 | 각 Phase 완료 시 어나운스 방식. firebat Phase 0을 선행하여 대기 시간 활용. FR 선행 배포 순서 조정 요청 가능. |
| oxc-parser 버전 충돌 | firebat `^0.112.0` → `>=0.114.0`으로 업그레이드 필요 (firebat Phase 0). gildash peerDep `>=0.114.0`. |
| `@zipbul/result` 미보유 | firebat Phase 0에서 의존성 추가. `isErr()` + unwrap 유틸리티 `core/result-utils.ts` 생성. |
| IMP-A~D DB 스키마 변경 | gildash 0.4.0에서 drizzle 자동 migration. 최악 시 DB 삭제→재생성 (gildash DB는 소스 파일의 캐시). |
| gildash ParsedFile ↔ firebat ParsedFile 호환성 | 둘 다 oxc-parser 기반. gildash `batchParse()`가 반환하는 ParsedFile을 직접 사용. engine은 gildash 타입 의존. |
| drizzle-orm 의존성 중복 | gildash도 drizzle-orm 사용 (transitive). artifact/memory가 raw bun:sqlite로 전환되면 firebat 직접 의존 제거 가능. |
| 대규모 import 경로 변경 | firebat Phase 3에서 일괄 처리. sed/grep 기반 자동화 스크립트 준비. |
| E2E 테스트 깨짐 | firebat Phase 4에서 최종 확인. CLI output format 변경 없으므로 리스크 낮음. |
| gildash FR-08 changedSymbols 구현 복잡도 | gildash 측 인정. Phase 2로 이동 확정. firebat incremental scan은 Phase 4에서 gildash FR-08 배포 후 적용. |
