# FINAL.md — firebat 종합 감사 리포트

> 장점 없음. 문제점 · 부족한 점 · 보강 제안만 기재.

---

## 1-A: CLI text 포맷

### 문제점

1. **stdout 첫 줄 빈 줄**: text output이 빈 줄(line 1)로 시작. `sectionHeader()` 함수가 `\n` prefix를 붙이기 때문.

---

## 1-C: MCP scan

### 문제점

1. **응답 ~8MB**: full scan 결과가 8MB → LLM 컨텍스트 윈도우를 대부분 소비. 필터/요약 옵션이 없어서 "barrel-policy만 보여줘" 같은 요청에도 28개 감지기 전체 전송.

2. **MCP에 로그 채널 없음**: CLI는 stderr로 trace/debug 로그를 내보내지만 MCP는 JSON 결과만 반환. 디버깅/문제 진단에 필요한 로그(캐시 hit 여부, 파싱 실패 등)를 MCP 소비자가 받을 방법 없음.

### 부족한 점

- MCP 스키마에 **targets 필터**는 있지만 **finding-level 필터**가 없음. severity, file pattern, finding count limit 등.
- scan tool description이 있지만 각 detector의 용도/의미 설명이 없음 → LLM이 어떤 detector를 선택해야 하는지 판단 불가.
- **minSize/maxForwardDepth** 파라미터에 대한 설명/가이드가 scan tool description에 불충분.

### 보강 제안

- top-N 요약 모드 추가: finding 수 > threshold인 감지기만 상위 finding 반환.
- MCP logging notification (protocol의 `notifications/message`) 활용하여 trace 로그 전달.

---

## 1-D: 로그 품질

### 문제점

1. **error=0줄, warn=0줄**: 정상 실행시 error/warn 레벨에 아무 출력 없음. 최소 info에서 4줄만. 로그 레벨을 error로 설정한 사용자는 성공/실패 여부조차 알 수 없음.

2. **절대 경로 노출**: debug 이상에서 `dbFilePath=/home/revil/projects/zipbul/firebat/.firebat/firebat.sqlite` → 상대 경로 사용이 적절.

3. **"Analysis complete 0ms" 오해**: cache hit 경우 분석을 안 했는데 "Analysis complete 0ms" 출력 → "0ms만에 분석 완료"로 오해할 수 있음.

4. **개별 감지기 타이밍 미출력**: JSON `meta.detectorTimings`에는 28개 감지기 개별 시간이 있지만 trace 로그에는 전체 시간만.

5. **tool version이 trace에서만**: `version=2.0.0-strict+2026-02-02-tsgo-lsp-v1`이 trace에서만 보임. info 레벨에서 보여야 디버그 리포트에 유용.

### 부족한 점

- cache hit시 "cache age" 또는 "since last invalidation" 정보 없음.
- 파싱 실패 파일이 있으면 warn으로 로그해야 하는데, 이번 실행에서는 발생하지 않아 검증 불가.

### 보강 제안

- info 레벨에 최소: version, target count, detector count, cache hit/miss, blocking count.
- warn 레벨에: parse failure, config override, deprecated옵션.
- cache hit 메시지를 `[INFO] Cache hit (artifact=94b01390, age=2m30s) — skipping analysis` 형태로.

---

## 1-E: knip 비교

### 문제점

1. **knip 실행 불가**: `drizzle.config.ts`가 `import.meta.dir`(Bun 전용 API) 사용 → knip의 Node.js 기반 config loader가 crash. `Error loading drizzle.config.ts: The "paths[0]" argument must be of type string. Received undefined`.

2. **비교 불가**: knip dead exports 결과와 firebat dead exports(140건) 비교 불가 → firebat의 dead export 정확도 크로스 검증 못 함.

### 보강 제안

- knip.json에 `"ignore": ["drizzle.config.ts"]` 추가하여 knip 실행 가능하게.
- 또는 drizzle.config.ts에서 `import.meta.dir` 대신 `__dirname` 폴백 추가.

---

## 1-F: dependency-cruiser 비교

### 문제점

1. **depcruise 20건 violation vs firebat 4건 layer violation**: depcruise의 `not-to-test` rule이 src/*.spec.ts → test/ 의존성 20건을 잡지만, firebat는 4건 layer violation만 보고. depcruise가 17개 oxlint-plugin rule spec 파일의 test/ 유틸 임포트를 잡는 것 → firebat의 layer violation 감지가 이 패턴을 놓침.

2. **firebat cycle=0, depcruise cycle 미검사**: depcruise는 `.dependency-cruiser.cjs` 설정에 의존. 별도 cycle 리포트 없이 `not-to-test`만 나옴. firebat도 cycle=0. 교차 검증은 일치하나 두 도구 모두 cycle이 실제 없는 건지 확인 어려움.

---

## 2-A: feature별 정확도 평가

### 문제점

1. **early-return 1230건 과다**: 프로젝트 300파일 대비 1230건은 과잉. 모든 if+return 패턴을 잡는 것처럼 보임 — guard clause가 이미 있는 경우에도 보고하는지 검증 필요.

2. **barrel-policy 569건/285파일**: 거의 모든 파일에 barrel 위반. feature detector convention상 `index.ts` barrel이 의도적인데 이것까지 잡는 것이라면 config에서 exclude 옵션이 필요.

3. **unknown-proof 1852건**: 가장 많은 finding. type assertion이 모두 위험한 게 아닌데 (e.g., `as const`, well-typed assertion) 구분 없이 전부 보고.

### 부족한 점

- finding에 **confidence/severity** 레벨이 일부 감지기(waste, noop)에만 있고 대부분 없음.
- **actionable한 suggestion**이 finding 레벨에 없음 (catalog에 일반적 설명만). "이 코드를 이렇게 바꿔라" 수준의 구체적 제안 부재.

---

## 2-B: CLI↔MCP 일관성

### 문제점

1. **수치 완전 일치**: CLI JSON과 MCP JSON의 analyses 구조/수치가 동일 (같은 cache artifact 사용). 불일치 없음.

2. **MCP에 text 포맷 옵션 없음**: CLI는 `--format text|json`이지만 MCP는 JSON only. text 요약을 원하는 MCP 소비자(LLM)에게 불편.

3. **MCP에 exit code 개념 없음**: CLI는 blockers > 0이면 non-zero exit. MCP는 항상 성공 응답. blocking 여부를 판단하려면 소비자가 직접 계산해야 함.

---

## 2-C: false negative 분석 (★ 핵심)

### 문제점

1. **firebat가 자기 자신의 코드 문제를 못 잡는 경우**:
   - 어떤 감지기도 "이 함수가 일부 case를 처리하지 않음"을 잡지 못함 (exhaustive switch/case 감지 부재).

2. **cross-feature 상관 부재**:
   - exact-duplicates 59 groups + structural-duplicates 331 classes → 겹치는 부분이 있을 수 있으나 correlation 없음.
   - nesting 219 + early-return 1230 → 같은 함수에 대해 양쪽에서 보고하지만 중복 제거/통합 뷰 없음.

3. **테스트 코드 과잉 보고**:
   - integration test 파일들이 exact-duplicates, structural-duplicates에 대량 포함. 테스트 코드의 중복은 의도적(각 test case 독립성)인 경우가 많지만 구분 없이 보고.
   - `test/` 하위 파일도 barrel-policy, unknown-proof 등 대상에 포함됨.

4. **dead export false positive 가능성**:
   - `runFirebat`, `getNodeHeader` 등이 dead-export로 보고되지만, `index.ts` 진입점에서 re-export 되거나 package.json `bin`/`exports`로 사용될 수 있음.
   - `oxlint-plugin.ts#default`, `oxlint-plugin.ts#plugin`이 dead-export로 보고되지만 `package.json "exports"` → `"./oxlint-plugin": "./oxlint-plugin.ts"` 경로로 외부 소비됨.

5. **config 불일치 감지 못 함**:
   - `.oxlintrc.jsonc`에 `packages/firebat/src/oxlint-plugin/**/*.spec.ts` override가 있지만 이 경로는 프로젝트에 존재하지 않음 → dead config. firebat의 어떤 감지기도 이걸 잡지 못함.
   - `.oxlintrc.jsonc`에 jsx-a11y, next, react settings가 있지만 프로젝트에 React/Next.js 없음 → dead config.

---

## 2-E: 누락 feature 제안 (극한의 코드 퀄리티)

### 보강 제안

1. **Dead config 감지기**: `.oxlintrc.jsonc`, `tsconfig.json`, `knip.json` 등 config 파일 내 dead 설정/경로/옵션 감지. 위 2-D에서 발견된 문제를 자동 감지.

2. **함수별 cross-finding 통합 뷰**: 같은 함수/모듈에 대해 여러 감지기가 보고하는 finding을 통합. 예: `report.ts#formatText()` → nesting + early-return + giant-file → "이 함수는 구조적 리팩토링 필요" 진단.

3. **테스트 코드 경계 인식**: --production 모드에서 test/**/*.spec.ts를 분석 대상에서 제외. 또는 test 코드에 대한 finding을 별도 섹션으로 분리.

4. **config schema validation**: `.firebatrc.jsonc` 자체의 오류/타이포/deprecated 옵션 검증.

5. **exhaustive switch/case 감지**: `report.ts`의 `summaryRowFor()` switch가 12개 case를 누락한 것처럼, switch문에서 모든 가능한 case를 처리하는지 검증. TypeScript compiler가 잡아야 하지만 `default:` case가 있으면 놓침.

### 바이브코딩 컨텍스트 축소

1. **MCP 요약 모드**: scan 결과를 "top-N worst findings" only로 반환하는 옵션. 현재 8MB → 목표 50KB 이하.
2. **per-file scan**: 특정 파일 1개만 scan하여 해당 파일의 finding만 반환. 코드 리뷰 시 유용.
3. **finding diff by file**: "이 파일을 수정하면 어떤 finding이 resolve되는가" 예측.

---

## 2-F: 외부 도구 내재화 판단

### knip

- **현재 사용 불가** (drizzle.config.ts crash). 내재화 불필요 — firebat의 `dependencies` 감지기가 dead exports 140건을 이미 감지.
- 다만 knip은 **unused files**, **unused dependencies** (package.json), **duplicate exports** 도 감지. firebat에서 unused dependencies 감지 추가 고려.

### dependency-cruiser

- depcruise의 20건 `not-to-test` violation 중 firebat의 layer violation(4건)과 부분 겹침.
- depcruise가 잡는 패턴(src/*.spec.ts → test/ 유틸 임포트)을 firebat이 못 잡는 것은 **firebat의 layer violation 규칙이 oxlint-plugin spec 파일을 인식하지 못하는 것** → layer boundary 설정 보강.
- 내재화보다는 firebat의 layer violation 규칙 개선이 적절.

---

## 2-G: lint 분포 분석

### 보고된 oxlint 규칙 (firebat lint 감지기 경유)

| 건수 | 규칙 |
|------|------|
| 433 | typescript-eslint(no-explicit-any) |
| 179 | firebat(no-inline-object-type) |
| 115 | eslint-plugin-jest(no-conditional-in-test) |
| 114 | firebat(no-double-assertion) |
| 101 | firebat(no-bracket-notation) |
| 18 | firebat(test-describe-sut-name) |
| 13 | eslint-plugin-import(exports-last) |
| 10 | eslint(no-unused-vars) |
| 8 | firebat(padding-line-between-statements) |
| 6 | firebat(blank-lines-between-statement-groups) |
| 5 | firebat(member-ordering) |
| 1 | firebat(no-non-null-assertion) |
| 1 | eslint(no-control-regex) |
| 1 | eslint-plugin-promise(no-multiple-resolved) |
| 1 | firebat(no-unmodified-loop-condition) |
| 1 | oxc(no-map-spread) |

### 문제점

- **firebat 커스텀 규칙이 lint 결과의 43%**: no-inline-object-type(179) + no-double-assertion(114) + no-bracket-notation(101) = 394건. 이 규칙들이 실제 코드 퀄리티에 기여하는지 재검토 필요.
- **no-explicit-any 433건**: 프로젝트에서 가장 많은 lint violation. `report.ts`에서만 다수 발생 (`finding as any` 패턴). firebat 자체 코드의 타입 안전성 이슈.
- **활성화된 17개 firebat 규칙 중 4개만 실제 finding**: unused-imports(0), no-ts-ignore(0), no-dynamic-import(0), no-globalthis-mutation(0), no-umbrella-types(0), no-tombstone(0), single-exported-class(0), test-unit-file-mapping(0) — lint에서 0건인 firebat 규칙이 9개. 이 규칙들이 동작하는지 의심. (물론 위반이 없을 수도 있지만.)

---

## 2-H: firebat 커스텀 oxlint 규칙 vs oxlint 빌트인 규칙

| firebat 규칙 | oxlint 빌트인 대응 | 중복 여부 |
|---|---|---|
| firebat/unused-imports | no-unused-vars (✅ default) | 부분 중복. firebat은 import 전용 + auto-fix. 유지 가치 있음 |
| firebat/no-non-null-assertion | typescript/no-non-null-assertion | 완전 대응 존재하지만 config에서 빌트인 미활성화. 하나로 통합 가능 |
| firebat/no-ts-ignore | typescript/ban-ts-comment (pedantic) | 유사. ban-ts-comment이 더 범용 |
| firebat/no-dynamic-import | import/no-dynamic-require | 부분 중복. 둘 다 활성화됨 |
| firebat/no-unmodified-loop-condition | eslint/no-unmodified-loop-condition (suspicious) | 완전 대응. eslint 빌트인 미활성화. 하나로 통합 가능 |
| firebat/no-double-assertion | (없음) | **고유**. 유지 |
| firebat/no-inline-object-type | (없음) | **고유**. 유지 |
| firebat/no-bracket-notation | (없음) | **고유**. 유지 |
| firebat/no-globalthis-mutation | (없음) | **고유**. 유지 |
| firebat/no-umbrella-types | typescript/no-empty-object-type | 부분 겹침이나 범위 다름. 유지 |
| firebat/no-tombstone | (없음) | **고유**. 유지 |
| firebat/single-exported-class | (없음) | **고유**. 유지 |
| firebat/member-ordering | typescript/adjacent-overload-signatures | 부분. firebat 버전이 더 세밀 |
| firebat/blank-lines-between-statement-groups | (없음) | **고유**. 유지 |
| firebat/padding-line-between-statements | (없음, eslint에 있었으나 oxlint 미구현) | **고유**. 유지 |
| firebat/test-describe-sut-name | (없음) | **고유**. 유지 |
| firebat/test-unit-file-mapping | (없음) | **고유**. 유지 |

### 삭제/통합 후보

- `firebat/no-non-null-assertion` → `typescript/no-non-null-assertion` 빌트인으로 교체 가능.
- `firebat/no-ts-ignore` → `typescript/ban-ts-comment` 빌트인으로 교체 가능 (config에 추가).
- `firebat/no-unmodified-loop-condition` → `eslint/no-unmodified-loop-condition` 빌트인으로 교체 가능.
- `firebat/no-dynamic-import` + `import/no-dynamic-require` → 하나로 통합 검토.

---

## 종합 우선순위

| 우선순위 | 항목 | 영향도 |
|----------|------|--------|
| P2 | MCP 요약 모드 | LLM 컨텍스트 효율 |
| P3 | firebat 커스텀 규칙 3개 빌트인 통합 | 플러그인 복잡도 감소 |
| P3 | test 코드 경계 인식 | false positive 감소 |
