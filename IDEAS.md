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