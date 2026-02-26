# CLAUDE.md

Claude Code (claude.ai/code) 가 이 저장소에서 작업할 때 참고하는 문서.

## 프로젝트 개요

코드 품질 스캐너. 중복, 데드 스토어, 깊은 중첩, 의존성 순환 등 유지보수성 이슈를 탐지한다. Bun + oxc 기반, 28개 디텍터, MCP 서버 지원.

## 명령어

```bash
bun install               # 의존성 설치
bun run build             # 빌드 (dist/firebat.js)
bun test                  # 전체 테스트
bun test <path>           # 단일 테스트 파일 실행
bun test --coverage       # 커버리지 (임계값은 bunfig.toml 참조)
bun run lint              # oxlint 린트
bun run format            # oxfmt 포맷 검사
bun run deps              # 아키텍처 의존성 규칙 검증
bun run knip              # 미사용 export 탐지
bun run db:generate       # Drizzle 마이그레이션 생성
bun run db:migrate        # Drizzle 마이그레이션 실행
```

## 아키텍처

```
src/
  adapters/        진입점 (CLI, MCP 서버)
  application/     유스케이스 오케스트레이션 — I/O 직접 참조 금지
  ports/           외부 I/O 인터페이스
  infrastructure/  I/O 구현체 (SQLite + Drizzle ORM, in-memory, hybrid)
  engine/          순수 연산 (oxc-parser AST, CFG, dataflow)
  features/        디텍터별 분석 로직
  tooling/         외부 도구 래퍼 (oxlint, oxfmt, tsgo)
  shared/          로거, 설정, 인자 파서
  oxlint-plugin/   커스텀 oxlint 룰
```

의존성 규칙 (`bun run deps`로 검증):
- `application/` → `ports/`만 의존 (`infrastructure/` 직접 참조 금지)
- `infrastructure/` → `ports/` 구현
- `adapters/` → 조합 루트 (composition root)
- `engine/` + `features/` → 순수, I/O 의존성 없음

진입 흐름: `index.ts` → `adapters/cli/entry.ts` → `application/scan/scan.usecase.ts` → features + engine

## 커밋

commitlint으로 conventional commits 강제. `type(scope): subject`

- **type**: build, chore, ci, docs, feat, fix, perf, refactor, revert, style, test
- **scope**: cli, mcp, lint, repo, config, scripts, agents, duplicates
- scope는 kebab-case, subject 끝에 마침표 금지

## 컨벤션

- TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`)
- oxfmt: printWidth 130, trailing commas, import 그룹별 정렬
- oxlint: `.oxlintrc.jsonc` 설정 + 커스텀 firebat 플러그인 룰
- pre-commit hook (husky + lint-staged): staged 파일에 oxlint --fix, oxfmt --write 자동 실행
- 빌드 산출물: `dist/firebat.js` (CLI), `dist/oxlint-plugin.js`

## 규칙

### Bun-first

Bun 내장 API > Node.js API > npm 패키지 > 직접 구현. Node.js나 npm을 선택하기 전에 반드시 Bun 대안을 검색하고 확인하라.

### 테스트

| 구분 | 패턴 | 위치 | SUT 범위 |
|------|------|------|----------|
| Unit | `*.spec.ts` | 소스와 같은 디렉토리 | 단일 export |
| Integration | `*.test.ts` (e.g. `test/scan/scan.test.ts`) | `test/` | 모듈 간 조합 |

- `bun:test` 전용. `mock()`, `spyOn()`, `mock.module()` 사용.
- 테스트명: 3파트 — SUT, 시나리오, 기대결과 (e.g. `"cancelReservation - valid id - deletes and returns 200"`)
- AAA 구조 (Arrange → Act → Assert). 하나의 행위를 테스트하되 assertion은 여러 개 가능.
- 테스트는 단순하고 평탄하게 작성하라. 테스트 안에 조건문/반복문/추상화 금지.
- 테스트별 독립 데이터. 글로벌 fixture / 테스트 간 공유 상태 금지.

**Unit 격리:**
- 모든 외부 의존성을 테스트 더블로 교체 — 실제 I/O 금지 (임시 디렉토리 포함)
- 가능하면 stub(고정값 반환)으로 격리하고 SUT 출력을 검증하라. 호출 횟수/인자 같은 상호작용 검증은 부수효과 확인에만 사용.
- Mock 우선순위: DI 주입 → `mock.module()` → DI 리팩토링 제안

**Integration 격리:**
- SUT 내부는 실제 구현, 경계 밖만 mock
- unexported 멤버 접근 시 `__testing__` export 사용

**공통:**
- 수동 카운터/플래그 금지. 반드시 `spyOn()` / `mock()` 사용.
- Monkey-patch (`obj.method = fake`) 금지 → `spyOn(obj, 'method')` 사용.

## 에이전트 행동강령

- 항상 한국어로 응답. 코드, 커밋 메시지, 변수명은 영어.
- 읽지 않은 파일을 수정하지 마라. 사용처를 먼저 검색하라.
- 확실하지 않으면 질문하라. 추측 기반 판단 금지.
- 코드 변경 후 반드시 관련 테스트 실행. 검증 없이 완료 간주 금지.
- 요청된 범위만 변경. 요청하지 않은 개선 금지.
- 같은 접근 2회 실패 시 멈추고 대안 제시 또는 질문.
- 작업 전환 시 `/clear` 제안. 대규모 탐색은 서브에이전트에 위임.
- 사용자 교정 시 CLAUDE.md 업데이트 제안.
- 모든 단계의 산출물은 전문 리뷰어 검증 필수. Critical/High 이슈는 해결 후 재리뷰.

## 워크플로우

7단계 라이프사이클. 자연어로 진입. 각 단계에 전문가 + 리뷰어 내장.
작업 규모에 따라 적절한 단계에서 시작.

탐색 → 기획 → 계획 → 구현 → 검증 → 출시 → 회고

| 단계 | Skill | 전문가 | 리뷰어 |
|------|-------|--------|--------|
| 탐색 | explore | researcher | explore-reviewer |
| 기획 | design | designer | design-reviewer |
| 계획 | plan | architect | plan-reviewer |
| 구현 | build | developer | code-reviewer |
| 검증 | verify | qa-engineer | verify-reviewer |
| 출시 | ship | release-engineer | ship-reviewer |
| 회고 | retro | retrospector | retro-reviewer |

상세: `.claude/skills/`, `.claude/agents/`
