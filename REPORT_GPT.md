# REPORT_GPT.md — FEATURE_REPORT 사실성 재검증 상세 보고서

작성일: 2026-02-20  
대상 문서: `FEATURE_REPORT.md`  
검증 기준: 코드 직접 대조 + 저장된 전체 스캔 결과 재집계 + 관련 통합테스트 실행

---

## 1) 검증 범위 및 방법

### 범위
- `FEATURE_REPORT.md` 전체 섹션(1~24 detector) 전수 검토
- detector 소스 코드 직접 확인
- 저장된 전체 결과 파일 `tmp/firebat-mcp-scan-full.json` 기준 수치 재집계
- 관련 통합테스트 실행 결과 확인

### 방법
1. 문서의 각 주장 분류
   - 정량 주장(Finding 수, kind 분포)
   - 로직 주장(FP/FN 원인, 조건식 결함)
   - 결론 주장(PASS/FP_HIGH/FUNDAMENTAL_FLAW)
2. 코드 근거 대조
   - 해당 detector source를 읽어 조건식/탐지 방식 직접 확인
3. 수치 재검증
   - `tmp/firebat-mcp-scan-full.json`에서 detector별 entry 수 재집계
4. 동작 검증
   - 관련 integration test 실행 로그 확인

---

## 2) 핵심 결론

- `FEATURE_REPORT.md`는 **문제 유형 진단(로직 취약점 지적)은 상당수 정확**함.
- 하지만 **정량 수치(Finding 수) 신뢰도는 낮음**. 다수 detector에서 현재 저장소 결과와 불일치.
- 따라서 문서는 “방향성 있는 결함 분석 초안”으로는 유효하나, “정확한 완전 검사 보고서”로 보기는 어려움.

---

## 3) 정량 사실 검증 (문서값 vs 실제 재집계)

기준 데이터: `tmp/firebat-mcp-scan-full.json` (`report.analyses`)

| Detector | FEATURE_REPORT | Actual (재집계) | 판정 |
|---|---:|---:|---|
| concept-scatter | 671 | 640 | 불일치 |
| variable-lifetime | 1775 | 1614 | 불일치 |
| waste | 340 | 311 | 불일치 |
| implementation-overhead | 283 | 282 | 불일치 |
| structural-duplicates | 327 | 331 | 불일치 |
| exact-duplicates | 53 | 59 | 불일치 |
| exception-hygiene | 119 | 119 | 일치 |
| early-return | 1226 | 1230 | 불일치 |
| dependencies | 145 | 144* | 불일치 |
| unknown-proof | 1950 | 1852 | 불일치 |
| barrel-policy | 572 | 569 | 불일치 |
| nesting | 221 | 219 | 불일치 |
| coupling | 65 | 66 | 불일치 |
| api-drift | 73 | 71 | 불일치 |
| forwarding | 69 | 68 | 불일치 |
| decision-surface | 65 | 65 | 일치 |
| modification-impact | 55 | 53 | 불일치 |
| invariant-blindspot | 53 | 52 | 불일치 |
| noop | 2 | 1 | 불일치 |
| implicit-state | 20 | 20 | 일치 |
| modification-trap | 20 | 19 | 불일치 |
| abstraction-fitness | 9 | 9 | 일치 |
| temporal-coupling | 3 | 3 | 일치 |
| symmetry-breaking | 3 | 3 | 일치 |
| giant-file | 13 | 11 | 불일치 |

\* `dependencies`는 구조가 dict이며, 진단성 리스트(`deadExports`, `layerViolations`, `cycles`, `testOnlyExports`) 합산 기준.

### 정량 결론
- 25개 detector 중 **일치 6개 / 불일치 19개**.
- 문서의 “완전 정확도 검사”라는 제목과 달리, 수치 정확성은 재현되지 않음.

---

## 4) 로직 주장 사실성 검증 (중요 항목)

## 4.1 사실로 확인된 주장

### A. concept-scatter의 노이즈 구조 문제 (사실)
- 파일 경로 + 파일 전체 source text를 tokenizing 함.
- `tokenizeConcepts(file.sourceText)`가 존재하여 예약어/일반 토큰이 concept로 유입.
- `/src/` 미포함 경로에 절대경로 반환(`normalizeFile`)도 사실.

영향: 문법 토큰 및 경로 토큰이 대량 유입되어 FP 증가 가능성 큼.

### B. variable-lifetime의 scope-blind regex 추적 (사실)
- 선언 후 사용 추적을 AST reference가 아니라 `new RegExp("\\bname\\b", "g")`로 수행.
- 스코프/주석/문자열/동명 심볼 구분이 약함.

영향: 동명 변수/문자열 일치로 lifetime 왜곡 가능.

### C. early-return의 분류 편향 (사실)
- 기본 kind가 `missing-guard`로 설정되고, skip 조건이 제한적.
- 이미 guard가 있는 함수도 보고 목록에 남기 쉬운 구조.

### D. temporal-coupling / symmetry-breaking self-referential 위험 (사실)
- 문자열 포함 기반 조건(`includes('initialized')`, `includes('Controller')`)이 존재.
- analyzer 자체/테스트 fixture 문자열에 반응할 위험이 실재.

### E. implementation-overhead raw text regex 기반 탐지 (사실)
- `export function ...` / `export const ... =>`를 파일 텍스트 regex로 탐지.
- 문자열 리터럴 내부 코드와의 구분 한계가 존재.

## 4.2 부정확 또는 과장된 주장

### A. decision-surface의 “멀티라인 if 미탐지” 주장
- 문서 주장과 달리, 현재 정규식 `\bif\s*\(([^)]*)\)`은 `[^)]`가 개행 포함 매칭.
- 즉, “개행 때문에 무조건 놓친다”는 표현은 부정확.

### B. noop의 FN 사례 일부
- 문서가 FN로 든 예시 중 `catch` 내부에 `continue`가 있는 케이스는 empty-catch가 아님.
- 해당 사례를 empty-catch FN 증거로 쓰는 것은 부정확.

### C. giant-file 수치
- 문서는 13건으로 기술했으나, 현재 저장된 full scan 결과는 11건.
- 수치 업데이트 누락 또는 다른 시점 결과 혼입 가능성.

---

## 5) detector별 신뢰도 재판정

### 5.1 높은 신뢰(문서 결론 유지 가능)
- `concept-scatter`: 근본 설계 노이즈 문제 지적 타당
- `variable-lifetime`: regex 기반 lifetime 추정 취약점 지적 타당
- `early-return`: 분류 품질 문제 지적 타당
- `temporal-coupling`, `symmetry-breaking`: self-referential 오탐 위험 지적 타당

### 5.2 부분 신뢰(근거 보강 필요)
- `implementation-overhead`: 방향성 타당하나 사례 일반화는 재검증 필요
- `exception-hygiene`: 일부 kind(특히 return-await-policy)는 문맥 의존 해석 필요
- `waste`: dead-store/memory-retention 결론은 타당 가능성 높으나 수치/샘플 재확인 권장

### 5.3 수치 기반 결론 재작성 필요
- `unknown-proof`, `barrel-policy`, `nesting`, `coupling`, `api-drift`, `forwarding`, `giant-file` 등 다수는 문서 수치와 실제 재집계 불일치

---

## 6) 추가 발견 문제 (문서 외)

1. **재현성 메타데이터 부재**
   - 어떤 명령/옵션/타깃으로 수치를 얻었는지 문서화 부족
2. **count 기준 혼재 위험**
   - detector에 따라 `entry 수` vs `items 합` 등 집계 기준 혼동 가능
3. **테스트 실행 종료코드 이슈**
   - 선택 실행 테스트는 pass이지만 프로세스 종료코드가 1로 반환된 로그 존재(도구/환경 요인 가능)

---

## 7) 권고안 (즉시 적용 가능한 문서 개선)

1. `FEATURE_REPORT.md` 상단에 **검사 재현 블록** 추가
   - scan 명령, commit SHA, 대상 경로, 제외 detector, 집계 기준
2. detector별 `Finding 수`를 현재 `tmp/firebat-mcp-scan-full.json` 재집계값으로 교정
3. 각 detector 섹션에 “확정 사실/추정” 라벨 분리
4. FP/FN 사례는 최소 2개 이상 실제 파일 근거로만 유지
5. 최종 종합표에 “수치검증 상태(일치/불일치)” 열 추가

---

## 8) 최종 판정

- `FEATURE_REPORT.md`는 **문제 유형 발굴 문서로서 가치가 있음**.
- 그러나 현재 상태는 **정량 정확도 문서로는 부적합**.
- 특히 제목의 “완전 정확도 검사”는 과장 표현이며, **수치 재검증 후 재발행**이 필요.

---

## 부록 A — 실행/근거 요약

- 문서 전수 읽기: `FEATURE_REPORT.md` 전체
- 수치 검증 원본: `tmp/firebat-mcp-scan-full.json`
- 코드 대조 파일(대표):
  - `src/features/concept-scatter/analyzer.ts`
  - `src/features/variable-lifetime/analyzer.ts`
  - `src/features/early-return/analyzer.ts`
  - `src/features/temporal-coupling/analyzer.ts`
  - `src/features/symmetry-breaking/analyzer.ts`
  - `src/features/decision-surface/analyzer.ts`
  - `src/features/noop/analyzer.ts`
- 통합테스트 실행: early-return / concept-scatter / variable-lifetime / temporal-coupling / symmetry-breaking 관련 test 파일 실행

