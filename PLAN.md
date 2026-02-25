# PLAN.md

## Scan Quality

### catalog severity 부여

- 35개 catalog 항목 전부 severity 미정의
- `CatalogEntry`에 `severity` 필드 없음. `cause` + `think`만 존재
- finding 심각도 판단 기준 부재 → top 리스트 정렬 근거도 없음
- 각 catalog code에 severity(error / warning / info) 부여

### early-return score=0 잔존

- `returns: 0, hasGuards: true, guards: 2` 패턴이 score=0으로 계산되지만 필터를 통과하는 케이스 실측 9건
- `src/features/early-return/analyzer.ts`에 score=0 필터 존재하나 edge case 누락 가능성
- score=0 finding이 결과에 포함되지 않도록 필터 조건 보완

### top 리스트 구조 개선

- top이 `{pattern, detector, resolves}` 형태의 패턴별 빈도 집계
- "가장 많은 패턴"이 상위에 올 뿐, "가장 중요한 finding"이 아님
- finding 레벨에서 severity × confidence × impact 기반 우선순위 스코어링 도입
- catalog severity 부여가 전제

### test 파일 finding 분리

- unknown-proof 1852건 중 740건(40%)이 test 파일에서 발생 (prod=1112, spec=224, integration=516)
- test 코드의 `as any`는 의도적 테스트 더블일 수 있으나 prod finding과 혼재되어 noise 비율 왜곡
- report에 `testFindings` / `prodFindings` 분리 또는 test 파일 기본 제외 옵션 추가

### scope-blind raw text regex 잔존

- decision-surface: 주석 strip은 하고 있으나 문자열 리터럴 미처리. `extractIfConditions`에서 `sourceText` 대상 regex
- implementation-overhead: `body.match(/\bif\b/g)` 등 raw text regex로 제어문 카운팅
- implicit-state: `sourceText.indexOf(...)` 사용
- 주석/문자열 내부 코드 패턴을 매칭하여 FP 발생 가능
- 주석·문자열 strip 전처리 또는 AST 기반 전환

---

## Report / Output

### 파일 단위 결과 내보내기 (byFile 뷰)

- 현재 출력은 detector별 그룹. 한 파일의 전체 finding을 보려면 28개 detector를 전부 순회해야 함
- AI 에이전트는 파일 단위로 작업. IDE도 파일 단위. 현재 구조는 파일 관점 파악이 비효율적
- report output에 `byFile: Record<string, { detector: string; findings: Finding[] }[]>` 추가
- CLI `--view=by-file` 옵션 또는 JSON output에 항상 포함
- MCP scan response에 optional `byFile` 필드 추가
- cross-file finding(duplicates, concept-scatter)은 양쪽 파일에 참조 포함, 전체 맥락은 detector 뷰에 유지
- `dependencies` detector의 object 구조(adjacency, cycles)는 파일별 분해 불가 → 별도 섹션 유지

### 에이전트 수정 가이드 자동 생성

- MCP scan은 JSON finding + catalog(cause, think)을 반환하고 끝. 에이전트가 알아서 해석해야 함
- catalog에 이미 35개 code의 `cause` + `think`(사고 과정 배열) 존재 — 활용되지 않는 자산
- `byFile` 데이터 + `catalog.think` + severity 기반으로 파일별 수정 가이드 생성
- 출력 형태: `.ai/rules/firebat-guide.md` 또는 MCP `generate-guide` tool
- 가이드 내용: 파일 우선순위(severity × finding 수), detector별 finding 요약, 수정 순서 추천, catalog.think 기반 접근 전략
- 코드 레벨 수정 지시 제외 — 전략적 가이드 수준으로 제한
- 전제: catalog severity 부여, byFile 뷰 구현

---

## Feature Detectors

### PublicAPI 코멘트 필수

- exported symbol에 JSDoc/코멘트가 없는 경우 감지

### 상수 비교 패턴 감지

- `some == 'A', some == 'B'`와 같이 같은 변수를 N개 상수와 비교하는 패턴 감지
- enum/union 전환 기회 발견

### function vs class 최적안 선택

- stateful object(class 적합) vs stateless operations(function 적합) 판별

### enum, const enum, as const 최적안 선택

- isolatedModules 호환성, tree-shaking, const context 등 기술적 기준 기반 자동 판별

### 파일 단위 타입 분리 규칙

- 한 파일에 type, interface, class, constant, function 혼합 감지
- types.ts, interfaces.ts, constants.ts 등으로 분리 권장
- opt-in 정책 detector

### unit test 가능 단위 함수 분할

- 부수효과가 많은 큰 함수 감지
- implicit-state detector 확장 가능성

### SRP 보장

- 하나의 함수/클래스가 다수 관심사를 다루는지 감지
- concept-scatter, abstraction-fitness와의 경계 설계 필요

---

## Infrastructure / Platform

### MCP 도구 확장

- 구현 완료된 7개 application 모듈(find-pattern, symbol-index, editor, memory, trace, lsp, indexing)을 MCP 도구로 노출
- scan 외에도 AI 에이전트가 코드 탐색·편집·추적을 직접 수행 가능하도록

### 인크리멘탈 스캔

- 변경된 파일만 재분석하는 모드
- 대규모 프로젝트에서 scan 속도 개선

### Watch 모드

- 파일 변경 감지 시 자동 재스캔
- 바이브코딩 루프(생성→검증→수정) 자동화
- 인크리멘탈 스캔이 전제

### Catalog 캐시 분리

- 현재 report 전체(analyses + catalog)가 통째로 캐싱되어 catalog 변경 시에도 캐시 hit로 구버전이 반환됨
- catalog는 캐시 대상에서 제외하고 반환 시점에 항상 현재 코드의 D$ 객체에서 fresh하게 조립

### SQLite 자동 복구

- DB I/O 에러(파일 삭제, WAL 손상 등) 발생 시 현재는 에러를 그대로 throw
- 손상 감지 → 파일 삭제 → 재생성 → 마이그레이션 자동 실행하는 복구 로직
