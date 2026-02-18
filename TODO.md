# Firebat 종합 감사 및 개선 TODO

> 필드테스트 기반. AI 에이전트 입장에서 직접 실행하고 결과를 판단한다.
> 다른 에이전트가 이 문서만 보고도 동일하게 재현·리포팅 가능해야 한다.
> **장점/잘된점 기록 금지. 문제/부족/보강점만 기록한다.**

## 결과 파일 구조

| 용도 | 경로 | 설명 |
|------|------|------|
| CLI text raw | `tmp/firebat-text-stdout.txt`, `tmp/firebat-text-stderr.txt` | 1-A 리포트 + 로그 |
| CLI json raw | `tmp/firebat-json-stdout.json`, `tmp/firebat-json-stderr.txt` | 1-B 리포트 + 로그 |
| MCP raw | `tmp/firebat-mcp-scan.json` | 1-C 결과 |
| 로그 레벨별 | `tmp/firebat-log-{error,warn,info,debug,trace}.txt` | 1-D 로그 품질 검사 |
| knip raw | `tmp/knip-output.txt`, `tmp/knip-output.json` | 1-E 결과 |
| depcruise raw | `tmp/depcruise-output.txt`, `tmp/depcruise-output.json` | 1-F 결과 |
| **최종 보고서** | **`FINAL.md`** | 모든 스텝 결과 누적 + 종합 레포트 + 변경 제안 |

### FINAL.md 포맷

각 스텝 완료 시 문제/부족/보강점만 append. Phase 2 완료 후 종합 요약 + 변경 제안 추가.

```markdown
## [step-id]: [step 제목]

### 문제점
- [문제 ID] 문제 설명 | 위치: 파일:줄 | 심각도: high/medium/low

### 부족한 점
- 설명

### 보강 제안
- 제안 내용 | 예상 효과
```

---

## Phase 1: 데이터 수집 (필드테스트)

### 1-A. CLI text 실행 + 결과 수집

**실행 커맨드:**
```bash
bun dist/firebat.js --format text --no-exit --log-level trace > tmp/firebat-text-stdout.txt 2>tmp/firebat-text-stderr.txt
```

**수집할 것:**
- `tmp/firebat-text-stdout.txt` — 리포트 본문 (사람이 읽는 텍스트)
- `tmp/firebat-text-stderr.txt` — trace 로그 (디버깅/진행 정보)
- 종료 코드, stdout 줄 수, stderr 줄 수 기록

**확인 포인트:**
- 28개 detector 모두 실행되었는가 (리포트에 각 섹션 존재 확인)
- 각 detector 섹션의 finding 건수 기록
- text 출력에서 위치 정보(파일:줄:열) 파싱 가능한가

- [ ] 완료

---

### 1-B. CLI json 실행 + 결과 수집

**실행 커맨드:**
```bash
bun dist/firebat.js --format json --no-exit --log-level trace > tmp/firebat-json-stdout.json 2>tmp/firebat-json-stderr.txt
```

**수집할 것:**
- `tmp/firebat-json-stdout.json` — JSON 리포트
- `tmp/firebat-json-stderr.txt` — trace 로그
- JSON 파싱 성공 여부 (`jq . tmp/firebat-json-stdout.json > /dev/null`)
- `meta.detectors` 배열 길이, `analyses` 키 목록, `top` 배열 길이, `catalog` 키 목록

**확인 포인트:**
- JSON이 valid한가 (jq 파싱)
- `FirebatReport` 스키마 (`meta`, `analyses`, `top`, `catalog`) 준수하는가
- 각 detector별 finding 건수 (`jq '.analyses | to_entries[] | {key, count: (.value | if type=="array" then length else "object" end)}'`)
- `top`이 실제 우선순위를 합리적으로 반영하는가
- `catalog`의 cause/approach가 구체적이고 actionable한가

- [ ] 완료

---

### 1-C. MCP scan 실행 + 결과 수집

**실행 방법:** 에이전트의 `mcp_firebat_scan` 도구 직접 호출

**호출 1 — 전체 스캔:**
```
mcp_firebat_scan({})  // 기본값, 전체 detector
```

**호출 2 — 특정 detector 지정:**
```
mcp_firebat_scan({ detectors: ["waste", "nesting", "coupling"] })
```

**호출 3 — diff 기능 검증 (두 번째 호출):**
```
mcp_firebat_scan({})  // 동일 호출 → diff 필드가 나오는지 확인
```

**수집할 것:**
- 각 호출의 `report`, `timings.totalMs`, `diff` (있으면)
- MCP 응답의 JSON 구조가 CLI json과 동일한 스키마인지 비교

**확인 포인트:**
- CLI json 결과와 MCP 결과의 `analyses` 내용이 동일한가
- `diff` 필드가 두 번째 호출부터 정상 반환되는가
- `targets` 파라미터 동작 확인 (특정 파일만 지정)
- 에러 시 `isError: true` + 스택트레이스 반환되는가

- [ ] 완료

---

### 1-D. 전체 로그 품질 검사 (모든 레벨)

**실행 커맨드 (각 레벨별):**
```bash
bun dist/firebat.js --format json --no-exit --log-level error 2>tmp/firebat-log-error.txt
bun dist/firebat.js --format json --no-exit --log-level warn  2>tmp/firebat-log-warn.txt
bun dist/firebat.js --format json --no-exit --log-level info  2>tmp/firebat-log-info.txt
bun dist/firebat.js --format json --no-exit --log-level debug 2>tmp/firebat-log-debug.txt
bun dist/firebat.js --format json --no-exit --log-level trace 2>tmp/firebat-log-trace.txt
```

**검사 기준:**

| 기준 | 설명 |
|------|------|
| 포맷 일관성 | 모든 로그 줄이 동일한 포맷인가 (타임스탬프, 레벨, 메시지 구조) |
| 레벨 격리 | `--log-level info`일 때 debug/trace가 출력되지 않는가 |
| 유용성 | 각 레벨에서 출력되는 정보가 해당 레벨에 적합한가 |
| 노이즈 | 불필요하게 반복되거나, 의미 없는 로그가 있는가 |
| 구조화 | 로그에 context 정보(detector명, 파일명, 소요시간 등)가 포함되는가 |
| 에이전트 파싱 | stderr 로그를 프로그래밍적으로 파싱 가능한가 (구조화된 포맷) |

**확인할 소스코드:**
- `src/infrastructure/logging/pretty-console-logger.ts` — 로그 구현체
- 각 detector/usecase에서 logger 호출 패턴

- [ ] 완료

---

### 1-E. knip 실행 + 결과 수집

**실행 커맨드:**
```bash
bunx knip 2>&1 | tee tmp/knip-output.txt
bunx knip --reporter json 2>/dev/null > tmp/knip-output.json
```

**수집할 것:**
- unused files, unused exports, unused dependencies, unlisted dependencies
- 각 카테고리별 건수

- [ ] 완료

---

### 1-F. dependency-cruiser 실행 + 결과 수집

**실행 커맨드:**
```bash
bun run deps 2>&1 | tee tmp/depcruise-output.txt
bunx depcruise -c ./.dependency-cruiser.cjs src index.ts oxlint-plugin.ts --output-type json > tmp/depcruise-output.json 2>/dev/null
```

**수집할 것:**
- 순환 참조(circular), 위반(violation) 목록
- 모듈 그래프 통계

- [ ] 완료

---

## Phase 2: 분석 및 판단

### 2-A. CLI text/json 에이전트 가치 판단 (원본 항목 1)

**입력:** 1-A, 1-B 결과물

**판단 기준 체크리스트:**

| # | 질문 | 답변 기준 |
|---|------|----------|
| 1 | text 리포트만 보고 "가장 심각한 문제 3개"를 즉시 식별 가능한가? | `top` 섹션이 있고, 심각도 순 정렬 |
| 2 | json에서 "이 파일의 모든 문제"를 추출할 수 있는가? | filePath 기준 필터링 가능 |
| 3 | json에서 "이 detector의 결과만" 추출 가능한가? | `analyses[detector]` 접근 |
| 4 | finding → 수정 코드 생성에 필요한 정보가 충분한가? | 파일, 줄, 열, 코드 스니펫, 원인 설명 |
| 5 | `catalog`의 cause/approach가 코드 수정 지시로 직접 사용 가능한가? | 구체적 리팩토링 방법 기술 |
| 6 | text와 json의 정보량 차이가 있는가? | json ⊇ text 이어야 정상 |
| 7 | 대규모 프로젝트에서 리포트 크기가 관리 가능한가? | finding 수 대비 바이트 크기 |

**산출물:** 각 항목별 PASS/FAIL + 구체적 근거

- [ ] 완료

---

### 2-B. MCP scan 에이전트 가치 판단 (원본 항목 2)

**입력:** 1-C 결과물

**판단 기준 체크리스트:**

| # | 질문 | 답변 기준 |
|---|------|----------|
| 1 | scan 1회 호출로 전체 코드 상태 파악 가능한가? | analyses 28개 detector 결과 + top 우선순위 |
| 2 | 코드 수정 후 재스캔 → diff로 개선 확인 가능한가? | `diff.resolvedFindings > 0` |
| 3 | targets 파라미터로 특정 파일만 스캔 가능한가? | 기능 동작 여부 |
| 4 | detectors 파라미터로 필요한 분석만 선택 가능한가? | 기능 동작 여부 |
| 5 | scan 외에 에이전트에게 필요한 도구가 빠져있는가? | fix, explain, suggest 도구 부재 여부 |
| 6 | MCP outputSchema가 정확한가? | Zod 스키마 vs 실제 반환값 일치 |
| 7 | 응답 시간이 에이전트 워크플로우에 적합한가? | `timings.totalMs` 평가 |

**산출물:** 각 항목별 PASS/FAIL + 개선 제안

- [ ] 완료

---

### 2-C. 기능 자체 문제점/정확도 (원본 항목 3)

**방법:**
1. 1-B의 JSON 리포트에서 각 detector별 finding 목록 추출
2. 각 finding이 가리키는 실제 소스코드를 `read_file`로 확인
3. 해당 코드가 정말 문제인지 판단 (true positive / false positive)
4. 샘플링: detector별 최대 5개 finding 검증

**28개 detector 정확도 검증 대상:**

| detector | 검증 방법 |
|----------|----------|
| exact-duplicates | finding의 두 코드 조각이 실제로 동일한가 |
| structural-duplicates | 구조적으로 동일하되 이름만 다른가 |
| waste | dead-store/memory-retention이 실제로 미사용인가 |
| nesting | depth/complexity 계산이 정확한가 |
| early-return | invertible-if-else가 실제로 뒤집기 가능한가 |
| noop | 실제로 아무 효과 없는 코드인가 |
| barrel-policy | missing-index/deep-import 판정이 합리적인가 |
| unknown-proof | 타입 안전성 문제가 실제 존재하는가 |
| exception-hygiene | catch 블록 문제가 실제인가 |
| coupling | hotspot 판정의 근거가 합리적인가 |
| dependencies | 순환 참조, dead export 검출이 정확한가 |
| forwarding | thin-wrapper 판정이 실제인가 |
| api-drift | 시그니처 불일치가 실제인가 |
| lint/format/typecheck | 외부 도구(oxlint/oxfmt/tsgo) 결과 전달이 정확한가 |
| implicit-state ~ giant-file | Phase 1 detector 각각 finding 검증 |

**산출물:** detector별 정확도 테이블 (검증 건수, TP, FP, FN)

- [ ] 완료

---

### 2-D. CLI ↔ MCP 일관성 검토 (원본 항목 4)

**방법:**
1. CLI json (`tmp/firebat-json-stdout.json`)과 MCP scan 결과를 비교
2. `jq` 또는 코드로 diff

**비교 항목:**
- `meta` 필드 동일성
- `analyses` 각 detector 결과 건수 동일성
- `top` 순위 동일성
- `catalog` 동일성
- 차이가 있다면 원인 분석 (config 차이? mcp.features 오버라이드?)

**산출물:** 일치/불일치 테이블

- [ ] 완료

---

### 2-E. 미탐지 분석 (원본 항목 5) ★최우선

**방법 — 수동 코드 리뷰 기반:**

1. firebat 자체 코드베이스에서 알려진 문제 패턴을 직접 검색
2. firebat 결과에 해당 패턴이 잡혔는지 대조

**검색할 문제 패턴:**

| 패턴 | grep/검색 방법 | 예상 detector |
|------|--------------|--------------|
| `as any` | `grep -rn 'as any' src/` | unknown-proof |
| `as unknown as` | `grep -rn 'as unknown as' src/` | unknown-proof |
| `// @ts-ignore` | `grep -rn '@ts-ignore\|@ts-expect-error' src/` | lint (커스텀) |
| `catch (e) {}` / 빈 catch | `grep -rn 'catch.*{' src/` + 빈 블록 | exception-hygiene |
| `console.log` | `grep -rn 'console\.\(log\|warn\|error\)' src/` | lint |
| 미사용 import | oxlint unused-imports vs firebat waste | waste 또는 lint |
| 미사용 변수 | `no-unused-vars` 결과 vs waste | waste |
| 순환 참조 | depcruise 결과 vs dependencies | dependencies |
| 중복 코드 | 실제 비슷한 함수가 있는데 안 잡힌 것 | exact/structural-duplicates |
| 깊은 중첩 (4+) | 실제 4 depth 이상 코드 vs nesting | nesting |
| 긴 함수 (100+줄) | `wc -l` 기반 vs giant-file | giant-file |
| 매직 넘버 | `grep -rn '[^0-9][0-9][0-9][0-9]' src/` | (없음 — 미탐지 후보) |
| TODO/FIXME/HACK 코멘트 | `grep -rn 'TODO\|FIXME\|HACK\|XXX' src/` | (없음 — 미탐지 후보) |

**산출물:** 미탐지 항목 리스트 (패턴, 위치, 예상 detector, 실제 결과)

- [ ] 완료

---

### 2-F. knip/dependency-cruiser vs firebat 비교 (원본 항목 6)

**입력:** 1-E, 1-F 결과물 + firebat 28개 detector 기능 목록

**비교 매트릭스:**

| 기능 | firebat | knip | dep-cruiser | 비고 |
|------|---------|------|-------------|------|
| unused exports | dependencies(deadExports) | ✅ 핵심 | ❌ | |
| unused files | ❌ | ✅ 핵심 | ✅ orphan | |
| unused dependencies | ❌ | ✅ 핵심 | ❌ | |
| circular dependency | dependencies(cycles) | ❌ | ✅ 핵심 | |
| import 제한 규칙 | dependencies(layerViolations) | ❌ | ✅ 핵심 | |
| dead code (변수) | waste | ❌ | ❌ | |
| 중복 코드 | exact/structural-dup | ❌ | ❌ | |
| 타입 안전성 | unknown-proof/typecheck | ❌ | ❌ | |
| 코드 복잡도 | nesting/decision-surface | ❌ | ❌ | |
| 예외 처리 품질 | exception-hygiene | ❌ | ❌ | |
| API 일관성 | api-drift/symmetry | ❌ | ❌ | |
| unlisted deps | ❌ | ✅ | ❌ | |

**판단 기준:**
- firebat에 없는 knip/depcruise 기능 → 내재화 vs 같이 사용 판단
- 비용/시간 제한 없음 → 기능적 우위만 판단
- knip/depcruise에 없는 firebat 고유 기능 식별

**산출물:** 기능 매트릭스 + "내재화 vs 병용" 추천 + knip/depcruise에 없는 기능 목록

- [ ] 완료

---

### 2-G. oxlint 규칙 최적화 (원본 항목 8)

**방법:**
1. oxlint 공식 문서에서 전체 규칙 목록 + 기본값(default severity) 조회
2. `.oxlintrc.jsonc`의 현재 설정과 대조
3. 아래 4가지 분류 수행

**분류:**

| 분류 | 조건 | 액션 |
|------|------|------|
| 기본값 중복 | 규칙의 기본값과 `.oxlintrc.jsonc` 설정이 동일 | 해당 줄 삭제 |
| firebat 중복 | firebat detector가 동일 기능 수행 | off 또는 삭제 |
| 누락된 유용 규칙 | firebat이 커버하지 않는 유용한 규칙 | on 추가 |
| 커스텀 플러그인 불필요 | oxlint 내장 규칙이 같은 기능 제공 | 커스텀 규칙 폐기 |

**커스텀 플러그인 17개 규칙 검토 대상:**
`unused-imports`, `blank-lines-between-statement-groups`, `member-ordering`,
`padding-line-between-statements`, `no-unmodified-loop-condition`,
`no-double-assertion`, `no-non-null-assertion`, `no-ts-ignore`,
`no-inline-object-type`, `no-bracket-notation`, `no-dynamic-import`,
`no-globalthis-mutation`, `no-umbrella-types`, `no-tombstone`,
`single-exported-class`, `test-describe-sut-name`, `test-unit-file-mapping`

**산출물:** `.oxlintrc.jsonc` 변경안 (삭제/추가/off 목록)

- [ ] 완료

---

### 2-H. 추가 기능 제안 (원본 항목 7)

**관점:** 바이브코딩 시 에이전트 컨텍스트 축소, 극한 코드 퀄리티 + 단순성

**검토할 영역:**
- 현재 28개 detector가 커버하지 못하는 코드 품질 차원
- knip/depcruise 분석에서 도출된 gap
- 미탐지 분석(2-E)에서 나온 패턴 중 detector화 가능한 것

**산출물:** 추가 기능 후보 리스트 (기능명, 목적, 감지 대상, 구현 난이도)

- [ ] 완료

---

## Phase 3: 변경 반영

### 3-A. 종합 보고서

`FINAL.md` 에 누적된 결과 기반으로 종합 요약 섹션 추가:
- 문제/부족/보강점 전체 요약 (심각도 순 정렬)
- 변경 제안:
  - **Targets**: 변경할 파일 경로 + 구체적 변경 내용
  - **Risks**: 각 변경의 부작용/호환성 영향
  - **Alternatives**: 다른 접근법
- `ㅇㅇ` 승인 대기

- [ ] 완료

---

### 3-B. 변경 적용

승인된 항목만 순차 적용:
1. `.oxlintrc.jsonc` 변경
2. MCP 서버 개선 (추가 도구, 스키마 수정)
3. detector 수정/추가
4. 로그 포맷 개선
5. 각 변경 후 `bun test` 실행하여 regression 확인

- [ ] 완료

---

### 3-C. install 고도화

변경된 설정/기능이 `firebat install` 커맨드에 반영되도록:
- install-assets.ts 템플릿 업데이트
- 새 oxlint 설정이 install로 배포 가능한지 확인

- [ ] 완료
