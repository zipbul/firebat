PublicAPI 에 코멘트 필수

some == 'A', some == 'B' 와 같이 일정한 패턴의 상수 비교가 있을 경우 감지

function vs class 최적안 선택

enum, const enum, as const 최적안 선택

한 파일에 type, interface, class, constant, function 섞지 않기
types.ts, enums.ts, interfaces.ts, constants.ts, some-class.ts, some-functions.ts
xxx.types.ts, xxx.enums.ts, xxx.interfaces.ts, xxx.constants.ts

unit test 가 가능한 단위로 함수 나누기

SRP 보장

---

## Infrastructure / Platform

MCP 도구 확장 — 구현 완료된 7개 application 모듈(find-pattern, symbol-index, editor, memory, trace, lsp, indexing)을 MCP 도구로 노출. scan 외에도 AI 에이전트가 코드 탐색·편집·추적을 직접 수행 가능하도록.

인크리멘탈 스캔 — 변경된 파일만 재분석하는 모드. 대규모 프로젝트에서 scan 속도 개선.

Watch 모드 — 파일 변경 감지 시 자동 재스캔. 바이브코딩 루프(생성→검증→수정) 자동화.

Catalog 캐시 분리 — 현재 report 전체(analyses + catalog)가 통째로 캐싱되어 catalog 변경 시에도 캐시 hit로 구버전이 반환됨. catalog는 캐시 대상에서 제외하고 반환 시점에 항상 현재 코드의 D$ 객체에서 fresh하게 조립해야 함.

SQLite 자동 복구 — DB I/O 에러(파일 삭제, WAL 손상 등) 발생 시 현재는 에러를 그대로 throw. 손상 감지 → 파일 삭제 → 재생성 → 마이그레이션 자동 실행하는 복구 로직 필요.