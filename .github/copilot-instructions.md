# Copilot Instructions (firebat)

정본(E0): `AGENTS.md` 를 최우선으로 따른다.

## Hard Rules (Strict Policy)
- 사용 가능한 MCP가 있으면 반드시 MCP를 사용한다. 추론/시뮬레이션으로 대체하지 않는다.
- 파일 생성/수정/삭제는 승인 토큰 `ㅇㅇ` 없이는 금지.
  - 승인 요청 전 반드시: (1) 변경 대상 (2) 리스크 (3) 대안을 먼저 제시한다.
- 파일 읽기/디렉토리 탐색은 `filesystem` MCP로만 수행한다. `filesystem` MCP가 불가/실패하면 STOP.

## Repo Basics
- 런타임: Bun + TypeScript (ESM). `package.json`의 `bun run build`, `bun test`를 사용한다.
- CLI 엔트리: `src/adapters/cli/entry.ts` (`firebat ...`). help 텍스트/옵션을 기준으로 UX를 유지한다.
- MCP 서버: `src/adapters/mcp/server.ts` (stdout 로그 금지, `process.exit()` 금지).

## Architecture (Ports & Adapters)
- `src/application/**`: 유스케이스 오케스트레이션(규칙). `src/infrastructure/**` 직접 import 금지.
- `src/ports/**`: 외부 I/O에 대한 인터페이스(Port).
- `src/infrastructure/**`: 외부 I/O 구현(Adapter/Driver). 예: SQLite(`.firebat/firebat.sqlite`).
- `src/engine/**`, `src/features/**`: 순수 분석/계산 로직(외부 I/O 의존 금지).
- `src/adapters/**`: 엔트리포인트/조립(Composition Root).

## Scan Flow (Fact-based)
- `src/application/scan/scan.usecase.ts`:
  - runtime context + tool version으로 프로젝트 키/캐시 키/입력 digest를 계산한다.
  - SQLite ORM(`getOrmDb`) + hybrid repositories로 아티팩트를 캐시한다.
  - targets 인덱싱 후 선택된 detectors를 실행하고 `FirebatReport`를 생성/저장한다.

## Tests
- 테스트 작성 규칙(AAA/BDD/자산 관리)은 `AGENTS.md`를 따른다.