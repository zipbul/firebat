# IMPROVE.md — 실증 분석 기반 수정 항목

> 작성일: 2026-02-25
> 근거: self-scan JSON 실측 분석 (`tmp/firebat-json-stdout.json`)
> 대상: 300파일 스캔, 28개 detector 전수 결과

---

## P0 — 즉시 수정

### 1. catalog severity 미구현

- **현상**: 35개 catalog 항목 전부 `severity: ?`
- **근거**: `jq '.catalog | to_entries[] | .value.severity' tmp/firebat-json-stdout.json` → 전부 null/미정의
- **영향**: 사용자가 finding의 심각도를 판단할 기준 없음. top 리스트의 정렬 근거도 부재.
- **수정**: 각 catalog code에 severity 등급(error / warning / info) 부여

### 2. early-return score=0 잔존

- **현상**: FEATURE_REPORT.md에서 "수정됨 — score=0 skip" 보고했으나, 실측 9건 잔존
- **근거**: `returns: 0, hasGuards: true, guards: 2` 같은 패턴이 score=0으로 계산되지만 필터를 통과
- **위치**: `src/features/early-return/analyzer.ts`
- **수정**: score=0 finding을 결과에서 제외하는 필터 조건 보완

---

## P1 — 단기

### 3. top 리스트 구조 개선

- **현상**: `top`이 2581건의 `{pattern, detector, resolves}` — 패턴별 빈도 집계일 뿐
- **근거**: `top[0] = {pattern: "EARLY_RETURN_MISSING_GUARD", detector: "early-return", resolves: 1230}`
- **영향**: "가장 중요한 finding"이 아니라 "가장 많은 패턴"이 상위에 옴. finding 레벨 우선순위 부재.
- **수정**: finding 레벨에서 severity × confidence × impact를 곱한 우선순위 스코어링 도입

### 4. test 파일 finding 분리

- **현상**: unknown-proof 1852건 중 740건(40%)이 test 파일(`.spec.ts`, `.test.ts`, `test/`)에서 발생
- **근거**: prod=1112, test(spec)=224, test(integration)=516
- **영향**: test 코드의 `as any`는 의도적 테스트 더블(dummy)일 수 있으나, prod finding과 혼재되어 noise 비율 왜곡
- **수정**: report에 `testFindings` / `prodFindings` 분리. 또는 test 파일 기본 제외 옵션 추가.

### 5. api-drift tsgo silent failure

- **현상**: tsgo 실패 시 analyzer 레벨에서 명시적 경고 로그 없음
- **위치**: `src/features/api-drift/analyzer.ts`
- **영향**: tsgo가 조용히 실패하면 prefix grouping만 반환 → 사용자가 불완전한 결과를 인지 못함
- **수정**: tsgo 실패 시 `logger.warn()` 추가

### 6. invariant-blindspot `before` 키워드 제거

- **현상**: signal 패턴에 `before`가 포함 → `// process items before returning` 같은 일반 주석도 매칭
- **위치**: `src/features/invariant-blindspot/analyzer.ts` L29
- **근거**: `{ name: 'must-comment', re: /\/\/.*\b(must|always|never|before)\b/gi }`
- **수정**: `before` 제거. 또는 `before \w+ing` 등 더 구체적 패턴으로 제한.

---

### 10. 파일 단위 결과 내보내기 (byFile 뷰)

- **현상**: 현재 출력은 detector별 그룹(`analyses["early-return"][0..N]`). 한 파일의 전체 finding을 보려면 28개 detector를 전부 순회해야 함.
- **근거**: `group_by(.file)` 시뮬레이션 → 414개 고유 파일. Top: `ast-normalizer.ts`(497건, 9개 detector), `scan.usecase.ts`(425건, 12개 detector)
- **영향**: AI 에이전트는 파일 단위로 작업. IDE(VS Code Problems 등)도 파일 단위. 현재 구조는 파일 관점 파악이 비효율적.
- **수정**:
  - report output에 `byFile: Record<string, { detector: string; findings: Finding[] }[]>` 추가 (detector별 뷰 유지 + 보강)
  - CLI `--view=by-file` 옵션 또는 JSON output에 항상 포함
  - MCP scan response에 optional `byFile` 필드 추가
  - cross-file finding(duplicates, concept-scatter)은 양쪽 파일에 참조 포함, 전체 맥락은 detector 뷰에 유지
  - `dependencies` detector의 object 구조(adjacency, cycles)는 파일별 분해 불가 → 별도 섹션 유지

### 11. 에이전트 수정 가이드 자동 생성

- **현상**: MCP scan은 JSON finding + catalog(cause, think)을 반환하고 끝. 에이전트가 알아서 해석해야 함.
- **근거**: catalog에 이미 35개 code의 `cause`(64~319자) + `think`(사고 과정 배열) 존재 — 활용되지 않는 자산
- **영향**: 에이전트가 finding을 보고 "어떤 파일부터, 어떤 순서로, 어떻게" 수정할지 스스로 판단해야 함. 비효율적이고 일관성 없음.
- **수정**:
  - `byFile` 데이터(#10) + `catalog.think` + severity(#1) 기반으로 파일별 수정 가이드 생성
  - 출력 형태: `.ai/rules/firebat-guide.md` 또는 MCP `generate-guide` tool
  - 가이드 내용: 파일 우선순위(severity × finding 수), detector별 finding 요약, 수정 순서 추천(barrel → type → logic), catalog.think 기반 접근 전략
  - 코드 레벨 수정 지시는 제외 — 전략적 가이드 수준으로 제한
- **전제**: #1(catalog severity), #10(byFile 뷰) 구현 필요
- **의의**: "왜 이게 문제고, 어떤 순서로, 어떻게 접근하세요"를 제공하는 AI-native 코드 품질 도구로서의 핵심 차별화

---

## P2 — 중기

### 7. scope-blind raw text regex 잔존 (4개 detector)

- **현상**: temporal-coupling, decision-surface, implementation-overhead, implicit-state의 일부 경로에서 파일 전체 소스를 regex로 검색. 주석·문자열 리터럴·렉시컬 스코프를 구분하지 못함.
- **영향**: 주석/문자열 내부 코드 패턴을 매칭하여 FP 발생 가능
- **수정**: 단기 — 주석·문자열 strip 전처리. 장기 — AST 기반 전환.

### 8. branch coverage 미수집

- **현상**: `coverage/lcov.info`에 BRF/BRH 행 없음. 라인 커버리지(84.66%)만 수집.
- **영향**: branch coverage 미측정 → 조건 분기 테스트 누락을 감지할 수 없음
- **수정**: bun test coverage 옵션에서 branch 수집 활성화. CI에 line + branch 임계치 게이팅 추가.

### 9. spec 매핑 결손

- **현상**: `*.ts` 소스 파일 중 colocated `*.spec.ts`가 없는 파일이 ~28개
- **영향**: TST-COVERAGE-MAP 규칙 위반
- **수정**: 제외 허용 목록(types.ts, index.ts, barrel 등) 명시. 제외 외 파일은 spec 추가.
