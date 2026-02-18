# FINAL.md — firebat 종합 감사 리포트

> 장점 없음. 문제점 · 부족한 점 · 보강 제안만 기재.

---

## 1-A: CLI text 포맷

### 문제점

1. **12개 감지기 body 누락**: Implicit State(20), Temporal Coupling(3), Symmetry Breaking(3), Invariant Blindspot(52), Modification Trap(19), Modification Impact(53), Variable Lifetime(1614), Decision Surface(65), Implementation Overhead(282), Concept Scatter(640), Abstraction Fitness(9), Giant File(11) — summary 테이블에만 존재하고 **상세 body 출력이 전무**. `report.ts`의 `formatText()`에 이 12개에 대한 렌더링 코드가 없어서 발생. Variable Lifetime 1614건, Concept Scatter 640건 등 대량 finding이 사용자에게 전혀 보이지 않음.

2. **이름 불일치 — Structural Duplicates**: body 섹션 heading은 `Structural Duplicates`이지만 summary 테이블에서는 `Structural Dupes`. `report.ts:345` `summaryRowFor('structural-duplicates')` case에서 `label: 'Structural Dupes'`로 하드코딩.

3. **이름 불일치 — Dependencies**: body 섹션은 `Dependencies 0 cycles · 0 cut hints · 4 layer violations · 140 dead exports`이지만 summary 테이블에서는 `Dep Cycles ✓ clean 0`. 두 가지 문제:
   - 이름 불일치: "Dependencies" vs "Dep Cycles"
   - 수치 불일치: body에 layer violations 4건 + dead exports 140건이 있지만 summary에서 `count: deps.cycles.length`만 사용 → `0`으로 표시하고 `✓ clean` 뱃지까지 붙음. **144건의 finding이 summary에서 은폐**.

4. **stdout 첫 줄 빈 줄**: text output이 빈 줄(line 1)로 시작. `sectionHeader()` 함수가 `\n` prefix를 붙이기 때문.

5. **blockingFindingCount 미노출**: stderr에 `blockingFindingCount=4115` 로그가 있지만 text stdout의 summary 테이블에는 total blocking count 행 없음. 사용자가 "이 프로젝트가 얼마나 나쁜지" 한눈에 알 수 없음.

### 부족한 점

- text 포맷에 **severity** 정보 없음. 어떤 finding이 blocking이고 어떤 것이 advisory인지 text 사용자는 구분 불가.
- text 포맷에 **code/kind** 필드가 포함되지만 해당 코드가 무엇을 의미하는지 설명 없음 (JSON의 catalog에만 있음).
- format 감지기는 `3 files need formatting`만 표시하고 **어떤 파일**인지 보여주지 않음 (파일명 출력 누락).

### 보강 제안

- 12개 감지기에 대한 body 렌더링 추가. 최소한 `defaultSummaryRow()` 패턴처럼 각 finding의 `file:span`을 출력.
- Dependencies summary에서 `cycles + layerViolations + deadExports` 합산 count 사용, 또는 sub-row 분리.
- blockingFindingCount를 summary 테이블 마지막 행에 `Total Blocking: 4,115` 형태로 추가.

---

## 1-B: CLI json 포맷

### 문제점

1. **format 감지기 스키마 이상**: `analyses.format`이 string 배열(파일 경로). 다른 모든 감지기는 object 배열인데 여기만 primitive 배열 → 소비측 코드에서 `first.kind` 접근시 TypeError.

2. **lint/typecheck 스키마 불일치**: `kind` 필드 없음, `severity`+`msg` 사용. 내부 감지기는 `{kind, code, file, span}` 스키마인데 외부 래핑 감지기는 `{code, file, span, severity, msg}` → 통합 파서 작성 불가.

3. **api-drift 완전히 다른 스키마**: `kind`, `code`, `file`, `span` 모두 없음. `{label, standard, outliers}` 구조 → 28개 감지기 중 유일하게 위치 정보(file+span)가 top-level에 없는 감지기.

4. **abstraction-fitness에 code 필드 누락**: 다른 감지기는 대부분 `code` 필드를 가지지만 abstraction-fitness는 `{kind, file, span, module, internalCohesion, externalCoupling, fitness}` → `code` 없음.

5. **dependencies가 유일한 비-배열**: `analyses.dependencies`만 단일 object `{cycles, adjacency, exportStats, fanIn, fanOut, cuts, layerViolations, deadExports}`. 나머지 27개는 모두 배열.

6. **JSON 5MB 단일 줄**: `JSON.stringify(report)`만 호출. `--pretty` 옵션 없음 → 디버깅시 jq 필수.

7. **catalog이 object(key-value)**: `catalog` 필드가 `Record<string, {...}>` 형태. 배열 형태가 API 소비에 더 자연스러움. MCP/CLI 양쪽 동일 구조.

### 부족한 점

- JSON에 **blockingFindingCount** 미포함. text stderr에만 있고 JSON report에는 없음.
- **format 감지기가 파일 경로만 반환** — diff/span 정보 없어서 어느 부분이 포맷 위반인지 알 수 없음.

### 보강 제안

- 최소 통합 스키마: 모든 감지기 finding에 `{kind, code, file, span}` 필수 필드 보장. format/lint/typecheck/api-drift 포함.
- `meta`에 `blockingFindingCount` 추가.
- ~~`--pretty` / `--indent` 옵션~~ → **불필요**. 주 소비자가 에이전트(JSON.parse)이므로 pretty는 용량 3배 부풀리기만. 사람은 `jq .`로 충분.

---

## 1-C: MCP scan

### 문제점

1. **응답 ~8MB**: full scan 결과가 8MB → LLM 컨텍스트 윈도우를 대부분 소비. 필터/요약 옵션이 없어서 "barrel-policy만 보여줘" 같은 요청에도 28개 감지기 전체 전송.

2. **diff "resolvedFindings" 오해**: partial scan(3개 감지기)→full scan diff에서 `resolvedFindings: 7752`. 실제로 resolve된 게 아니라 "이번 scan에서 안 돌린 감지기의 이전 finding" → "resolved"란 용어가 부정확.

3. **MCP에 로그 채널 없음**: CLI는 stderr로 trace/debug 로그를 내보내지만 MCP는 JSON 결과만 반환. 디버깅/문제 진단에 필요한 로그(캐시 hit 여부, 파싱 실패 등)를 MCP 소비자가 받을 방법 없음.

### 부족한 점

- MCP 스키마에 **targets 필터**는 있지만 **finding-level 필터**가 없음. severity, file pattern, finding count limit 등.
- scan tool description이 있지만 각 detector의 용도/의미 설명이 없음 → LLM이 어떤 detector를 선택해야 하는지 판단 불가.
- **minSize/maxForwardDepth** 파라미터에 대한 설명/가이드가 scan tool description에 불충분.

### 보강 제안

- top-N 요약 모드 추가: finding 수 > threshold인 감지기만 상위 finding 반환.
- diff의 "resolvedFindings"를 "droppedFindings" 또는 "outOfScopeFindings"로 rename.
- MCP logging notification (protocol의 `notifications/message`) 활용하여 trace 로그 전달.

---

## 1-D: 로그 품질

### 문제점

1. **error=0줄, warn=0줄**: 정상 실행시 error/warn 레벨에 아무 출력 없음. 최소 info에서 4줄만. 로그 레벨을 error로 설정한 사용자는 성공/실패 여부조차 알 수 없음.

2. **레벨 라벨 없음**: `●`, `◆`, `·` 아이콘으로만 구분. `[INFO]`, `[DEBUG]`, `[TRACE]` 같은 명시적 라벨 없음 → 로그 파서/필터가 레벨 식별 불가.

3. **타임스탬프 없음**: 모든 로그 줄에 시간 정보 없음 → 성능 디버깅시 각 단계 소요 시간 추적 불가.

4. **절대 경로 노출**: debug 이상에서 `dbFilePath=/home/revil/projects/zipbul/firebat/.firebat/firebat.sqlite` → 상대 경로 사용이 적절.

5. **"Analysis complete 0ms" 오해**: cache hit 경우 분석을 안 했는데 "Analysis complete 0ms" 출력 → "0ms만에 분석 완료"로 오해할 수 있음.

6. **개별 감지기 타이밍 미출력**: JSON `meta.detectorTimings`에는 28개 감지기 개별 시간이 있지만 trace 로그에는 전체 시간만.

7. **tool version이 trace에서만**: `version=2.0.0-strict+2026-02-02-tsgo-lsp-v1`이 trace에서만 보임. info 레벨에서 보여야 디버그 리포트에 유용.

### 부족한 점

- 로그 아이콘 규약(`●`=info, `◆`=debug, `·`=trace) 문서화 없음.
- cache hit시 "cache age" 또는 "since last invalidation" 정보 없음.
- 파싱 실패 파일이 있으면 warn으로 로그해야 하는데, 이번 실행에서는 발생하지 않아 검증 불가.

### 보강 제안

- 모든 로그에 `[LEVEL] timestamp message` 형식 적용.
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

4. **variable-lifetime 1614건**: body 출력이 없어서 어떤 패턴을 잡는지 확인 불가.

5. **concept-scatter 640건**: 역시 body 없음. scatterIndex 분포, 실제 유용성 확인 불가.

### 부족한 점

- finding에 **confidence/severity** 레벨이 일부 감지기(waste, noop)에만 있고 대부분 없음.
- **actionable한 suggestion**이 finding 레벨에 없음 (catalog에 일반적 설명만). "이 코드를 이렇게 바꿔라" 수준의 구체적 제안 부재.

---

## 2-B: CLI↔MCP 일관성

### 문제점

1. **수치 완전 일치**: CLI JSON과 MCP JSON의 analyses 구조/수치가 동일 (같은 cache artifact 사용). 불일치 없음.

2. **MCP에 text 포맷 옵션 없음**: CLI는 `--format text|json`이지만 MCP는 JSON only. text 요약을 원하는 MCP 소비자(LLM)에게 불편.

3. **MCP에 exit code 개념 없음**: CLI는 blockingFindingCount > 0이면 non-zero exit. MCP는 항상 성공 응답. blocking 여부를 판단하려면 소비자가 직접 계산해야 함.

---

## 2-C: false negative 분석 (★ 핵심)

### 문제점

1. **firebat가 자기 자신의 코드 문제를 못 잡는 경우**:
   - `report.ts` 695줄 — giant-file 감지기가 11파일만 보고. report.ts가 여기 포함되는지 불명 (body 없어서 확인 불가).
   - `report.ts`의 `formatText()` 함수: 12개 감지기 body가 누락된 건 noop/waste가 아닌 **구현 누락** — 어떤 감지기도 "이 함수가 일부 case를 처리하지 않음"을 잡지 못함.
   - Dependencies summary에서 `count: deps.cycles.length`만 사용하여 144건을 누락하는 버그를 firebat 자체가 감지 못 함.

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

## 2-D: oxlintrc 최적화

### 문제점

1. **oxlint 기본값 중복 규칙 (~40개)**: 다음 규칙들은 oxlint correctness 카테고리에서 **기본 활성화(✅)**됨. `.oxlintrc.jsonc`에 `"error"`로 명시할 필요 없음:
   - `constructor-super`, `for-direction`, `no-async-promise-executor`, `no-caller`, `no-class-assign`, `no-compare-neg-zero`, `no-cond-assign`, `no-const-assign`, `no-constant-binary-expression`, `no-constant-condition`, `no-control-regex`, `no-debugger`, `no-delete-var`, `no-dupe-class-members`, `no-dupe-else-if`, `no-dupe-keys`, `no-duplicate-case`, `no-empty-pattern`, `no-ex-assign`, `no-extra-boolean-cast`, `no-func-assign`, `no-global-assign`, `no-import-assign`, `no-invalid-regexp`, `no-irregular-whitespace`, `no-loss-of-precision`, `no-new-native-nonconstructor`, `no-obj-calls`, `no-self-assign`, `no-setter-return`, `no-sparse-arrays`, `no-this-before-super`, `no-unsafe-negation`, `no-unsafe-optional-chaining`, `no-useless-backreference`, `no-useless-escape`, `no-useless-rename`, `no-with`, `no-eval`
   - TypeScript: `typescript/await-thenable`, `typescript/no-array-delete`, `typescript/no-base-to-string`, `typescript/no-duplicate-type-constituents`, `typescript/no-for-in-array`, `typescript/no-meaningless-void-operator`, `typescript/no-misused-spread`, `typescript/no-redundant-type-constituents`, `typescript/no-unsafe-unary-minus`, `typescript/require-array-sort-compare`, `typescript/restrict-template-expressions`, `typescript/unbound-method`
   - oxc: `oxc/missing-throw`, `oxc/number-arg-out-of-range`, `oxc/uninvoked-array-callback`
   - unicorn: `unicorn/no-unnecessary-await`, `unicorn/no-useless-spread`, `unicorn/prefer-set-size`

2. **dead override**: `packages/firebat/src/oxlint-plugin/**/*.spec.ts` 패턴이 3번째 override에 있지만 프로젝트에 `packages/` 디렉토리 없음. 또한 규칙 접두사가 `typescript-eslint/`인데 oxlint에서는 `typescript/` 접두사 사용 → **이 override는 완전히 무효**.

3. **dead settings**: `jsx-a11y`, `next`, `react` settings가 있지만 프로젝트에 React/Next.js/JSX 없음. 15줄의 dead config.

4. **vitest settings 부적절**: `"vitest": { "typecheck": false }` — 프로젝트는 `bun:test`를 사용하고 vitest가 아님.

5. **firebat/no-dynamic-import vs import/no-dynamic-require 중복 가능성**: 둘 다 활성화됨. dynamic import를 두 규칙이 각각 잡을 수 있음.

6. **`no-unused-vars` 이중 설정**: oxlint에서 기본 활성화(✅)이지만, config에서 custom options(`argsIgnorePattern: "^_"` 등)를 위해 명시적으로 설정. 이 경우는 **의도적** — 유지하되 주석으로 이유 명기 필요.

### 보강 제안

- ~40개 기본값 중복 규칙 제거 → config 100줄 이상 감소.
- dead override 삭제, dead settings 삭제.
- 의도적 override(no-unused-vars, no-empty)에 주석 추가: `// override default options`.

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
| P0 | 12개 감지기 text body 렌더링 추가 | Variable Lifetime 1614건 등 보이지 않음 |
| P0 | Dependencies summary count에 layerViolations+deadExports 포함 | 144건 finding 은폐 |
| P1 | oxlintrc 기본값 중복 ~40개 규칙 제거 | config 100줄 감소, 유지보수 부담 감소 |
| P1 | dead override/settings 삭제 | dead config 제거 |
| P1 | JSON/MCP blockingFindingCount 추가 | CI 파이프라인 등에서 필수 |
| P2 | format 감지기 스키마 정규화 | API 일관성 |
| P2 | MCP 요약 모드 | LLM 컨텍스트 효율 |
| P2 | 로그 레벨 라벨 + 타임스탬프 | 디버그 편의 |
| P3 | firebat 커스텀 규칙 3개 빌트인 통합 | 플러그인 복잡도 감소 |
| P3 | test 코드 경계 인식 | false positive 감소 |
