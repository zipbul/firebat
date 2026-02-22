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

Bun-native TypeScript 코드 인덱서. oxc-parser 기반 심볼 추출, cross-file 관계 추적, SQLite FTS5 검색, 의존성 그래프, incremental indexing.

- **저자 동일** (parkrevil) — API 안정성/호환성 리스크 없음
- **공유 의존성**: oxc-parser, bun:sqlite, drizzle-orm — 추가 의존성 최소

### 2.2 대체 범위

#### 제거되는 파일 (~20개)

| 현재 파일 | 대체 API |
|---|---|
| `ports/symbol-index.repository.ts` (+ spec) | `ledger.searchSymbols()` |
| `ports/file-index.repository.ts` (+ spec) | gildash 내부 Indexer |
| `infrastructure/sqlite/symbol-index.repository.ts` (+ spec) | gildash Store |
| `infrastructure/sqlite/file-index.repository.ts` (+ spec) | gildash Store |
| `infrastructure/memory/symbol-index.repository.ts` (+ spec) | gildash 내부 캐시 |
| `infrastructure/memory/file-index.repository.ts` (+ spec) | gildash 내부 캐시 |
| `infrastructure/hybrid/symbol-index.repository.ts` (+ spec) | gildash facade |
| `infrastructure/hybrid/file-index.repository.ts` (+ spec) | gildash facade |
| `application/symbol-index/symbol-index.usecases.ts` (+ spec) | `Gildash.open()` + API |
| `application/indexing/file-indexer.ts` (+ spec) | gildash Watcher + reindex |

schema.ts의 files/symbols 테이블 정의와 관련 migration도 제거.

#### 유지되는 파일

| 컴포넌트 | 이유 |
|---|---|
| `ports/artifact.repository.ts` | gildash에 범용 캐시 없음 → `store/artifact.ts`로 단순화 |
| `ports/memory.repository.ts` | AI 에이전트 메모리 — gildash 관심사 밖 → `store/memory.ts`로 단순화 |
| `ports/logger.ts` | gildash는 logger를 수용하지만 제공하지 않음 |
| `infrastructure/ast-grep/` | 패턴 매칭 — gildash 범위 밖 |
| `infrastructure/oxfmt/` | 포매팅 — gildash 범위 밖 |
| `infrastructure/oxlint/` | 린팅 — gildash 범위 밖 |
| `infrastructure/tsgo/` | TypeScript LSP — gildash 범위 밖 |
| `engine/` 전체 | CFG, dataflow, hasher, normalizer 등 핵심 분석 엔진 |
| `features/` 전체 | 28개 detector — firebat 고유 도메인 |

### 2.3 gildash로 얻는 새 기능 (코드 0줄)

| 기능 | API | firebat 활용 |
|---|---|---|
| Import 그래프 | `getDependencies()` / `getDependents()` | LSP use case 강화, MCP 도구 |
| 변경 영향 분석 | `getAffected(changedFiles)` | incremental scan 구현 기반 |
| 순환 의존성 감지 | `hasCycle()` | 새 detector 추가 가능 |
| 관계 검색 | `searchRelations(query)` | calls/extends/implements 추적 |
| Incremental indexing | `@parcel/watcher` 내장 | 매 실행 전체 스캔 → 변경분만 |
| Multi-process safety | Owner/Reader 패턴 | SQLite 자동복구 버그 해결 |

### 2.4 gildash API 확장 합의 (확정)

gildash 측과 협의 완료. 아래 5건 확정.

| # | API | 형태 | 담당 | 우선순위 |
|---|---|---|---|---|
| 1 | `getParsedAst(filePath)` | `ParsedFile \| undefined` 반환. LRU 캐시 래핑 1-liner. `ParsedFile` type re-export + `oxc-parser` peerDep 추가. | gildash | 높음 |
| 2 | `getFileInfo(filePath, project?)` | `FileRecord \| null` 반환. `Gildash`에 `fileRepo` 멤버 추가 + wrapper. `FileRecord` type re-export. | gildash | 높음 |
| 3 | `searchSymbols` exact 옵션 | `SymbolSearchQuery`에 `exact?: boolean` 추가. `searchByQuery`에 exact name WHERE 분기. | gildash | 중간 |
| 4 | `onIndexed` + `getAffected()` 조합 | 변경 없음 — 기존 API 조합 유지. firebat MCP 서버에서 패턴 적용. | firebat | — |
| 5 | `getSymbolsByFile(filePath)` | sugar API. 3번과 같이 구현. | gildash | 낮음 |

#### 주의사항

- **oxc-parser peer dep**: firebat는 이미 직접 의존 (`oxc-parser: ^0.112.0`). 문제 없음.
- **LRU eviction**: `getParsedAst()` 반환 시 캐시에서 evict됐을 수 있음 → `undefined` 반환. firebat는 `getParsedAst(fp) ?? parseSource(fp, src)` fallback 패턴 사용.
- **AST 읽기 전용**: gildash 캐시 AST를 소비자가 mutate하면 캐시 오염. firebat engine은 AST를 읽기 전용으로 사용 (새 구조체 생성).
- **signature 정밀도**: gildash의 `signature` 필드는 extractor가 AST에서 추출한 raw text. firebat API drift의 normalized form과 다를 수 있음. 3번(exact match) 구현 시 양쪽에서 검증. 필요 시 `detailJson`에 structured signature 추가 고려.

#### gildash 구현 순서

1. `getParsedAst` — 1-liner wrapper + type re-export + peerDep
2. `getFileInfo` — fileRepo 멤버 추가 + wrapper + type re-export
3. `searchSymbols` exact 옵션 — SymbolSearchQuery 확장 + WHERE 분기
4. `getSymbolsByFile` — 3번과 같이 넣으면 됨

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
│   └── pipeline.ts                      # 스캔 파이프라인 오케스트레이터 (~100줄)
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
│   ├── coupling/
│   ├── giant-file/
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
│   ├── parse-source.ts                  # gildash AST 캐시 공유 전까지 유지
│   ├── duplicate-collector.ts
│   ├── duplicate-detector.ts
│   └── types.ts
│
├── store/                               # 모든 persistence (ports+infrastructure 대체)
│   ├── gildash.ts                       # Gildash 인스턴스 생성/lifecycle/설정
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

### 3.2 핵심 설계 원칙

#### Plugin Registry 패턴

```typescript
// core/detector-registry.ts
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
import { registry } from './detector-registry';

const runScan = async (ctx: ScanContext): Promise<FirebatReport> => {
  const enabled = resolveEnabledDetectors(ctx.options, registry);
  const results = await Promise.all(
    enabled.map(plugin => plugin.analyze(ctx)),
  );
  return assembleReport(results, enabled);
};
```

- 현재 `scan.usecase.ts` 1516줄 → `pipeline.ts` ~100줄
- feature 추가: `detectors/new-feature/detector.plugin.ts` 1개 디렉토리 생성, 기존 파일 수정 0

#### Gildash 통합

```typescript
// store/gildash.ts
import { Gildash } from '@zipbul/gildash';

let instance: Gildash | null = null;

const getGildash = async (projectRoot: string): Promise<Gildash> => {
  if (instance) return instance;
  instance = await Gildash.open({ projectRoot });
  return instance;
};

const closeGildash = async (): Promise<void> => {
  if (instance) {
    await instance.close();
    instance = null;
  }
};

export { getGildash, closeGildash };
```

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

---

## 4. 마이그레이션 전략

### 4.1 단계별 실행 계획

#### Phase 1: store/ 도입 + gildash 통합

1. `bun add @zipbul/gildash`
2. `store/gildash.ts` 생성 — Gildash 인스턴스 관리
3. `store/artifact.ts` 생성 — raw bun:sqlite로 ArtifactRepository 재구현
4. `store/memory.ts` 생성 — raw bun:sqlite로 MemoryRepository 재구현
5. 기존 `application/symbol-index/`, `application/indexing/`를 gildash API로 교체
6. 테스트 통과 확인

#### Phase 2: Plugin Registry 도입

1. `core/detector-registry.ts` 생성
2. `core/pipeline.ts` 생성 — scan.usecase.ts에서 오케스트레이션 로직 추출
3. 28개 detector를 `detectors/*/detector.plugin.ts` 형태로 마이그레이션
4. `detectors/_catalog/catalog.ts`로 diagnostic-aggregator 이동
5. `scan.usecase.ts` 제거
6. 테스트 통과 확인

#### Phase 3: 디렉토리 정리

1. `src/` root 고아 파일 → `shared/`로 이동
2. `engine/` flat → `engine/ast/`, `engine/cfg/`, `engine/dataflow/` 서브디렉토리화
3. `tooling/` 생성 — `infrastructure/{ast-grep,oxfmt,oxlint,tsgo}` 이동 + flatten
4. `shared/logger.ts` — `ports/logger.ts` + `infra/logging.ts` + `infrastructure/logging/` 통합
5. `ports/`, `infrastructure/`, `infra/` 디렉토리 전체 삭제
6. 테스트 통과 확인

#### Phase 4: 어댑터 정리

1. `adapters/cli/`, `adapters/mcp/` — 현재 코드 유지하되 import 경로 갱신
2. `main.ts` — CLI/MCP 분기 진입점
3. 전체 테스트 + E2E 통과 확인

### 4.2 마이그레이션 규칙

- **Phase 단위 커밋**: 각 Phase 완료 시 커밋. Phase 중간 상태로 커밋 금지.
- **테스트 선행**: 각 파일 이동/변경 전 관련 테스트 확인, 이동 후 즉시 재실행.
- **import 경로 일괄 갱신**: 파일 이동 시 `grep -r` 으로 모든 import 참조 갱신.
- **기능 변경 금지**: 리팩토링 중 기능 추가/변경 없음. 동작 동일성 보장.

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

### 정성적

- **Detector 추가 = 1 디렉토리 생성**: `detector.plugin.ts`가 registry에 자동 등록, 기존 코드 수정 불필요
- **gildash가 인프라 부담 흡수**: 파일 감시, incremental indexing, FTS5, multi-process safety를 외부 패키지가 관리
- **의존성 그래프 활용**: `getAffected()`, `hasCycle()`, `searchRelations()` — 새 detector/MCP 도구 기반
- **에이전트 바이브코딩 최적화**: flat 구조 + 자체 완결 플러그인 → 파일 탐색 최소화, 컨텍스트 크기 축소

---

## 6. 리스크 & 미결 사항

| 리스크 | 대응 |
|---|---|
| gildash v0.0.2 안정성 | 같은 저자 — 필요 시 즉시 패치 가능. 핀 버전 사용. |
| gildash ParsedFile ↔ firebat ParsedFile 호환성 | 둘 다 oxc-parser 기반. engine은 자체 parseSource 유지, 향후 gildash AST 캐시 공유로 통합. |
| drizzle-orm 의존성 중복 | gildash도 drizzle-orm 사용. artifact/memory가 raw bun:sqlite로 전환되면 firebat에서 drizzle-orm 제거 가능. |
| 대규모 import 경로 변경 | Phase 3에서 일괄 처리. sed/grep 기반 자동화 스크립트 준비. |
| E2E 테스트 깨짐 | Phase 4에서 최종 확인. CLI output format 변경 없으므로 리스크 낮음. |
| gildash signature 정밀도 | gildash `signature` = raw AST text, firebat API drift = normalized form. 3번(exact match) 구현 시 검증. 불충분하면 `detailJson`에 structured signature 추가. |
