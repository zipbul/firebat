# PLAN v2 — ambient-type 패키지 unused-dependency 정공법 (3자 적대리뷰 반영)

## 문제
`unused-dependency`는 "import 그래프에 없음 = 미사용"으로 본다. **ambient 타입 패키지**(`bun-types`, `@types/*`)는 import 없이 소비된다. 현재 코드는 `@types/*` 접두만 담요-보류(analyzer.ts:1164)해 `bun-types`를 놓쳐 → false-W. 이름 매칭은 추측값 위반이라, tsc의 ambient 해석을 **선언된 사실**로 재현해 닫는다.

## 3자 적대리뷰 판정 (codex·grok·claude subagent)
**공통 결론**: widen-only 설계는 **단조(monotonic)** — 오늘보다 보류가 줄지 않아 **새 false-W를 구조적으로 못 만든다**(회귀 안전). **그러나 plan v1은 그대로 구현 불가.** 이유:
- **[치명·실증] plain `JSON.parse`면 fix가 무효.** firebat 자기 tsconfig가 주석(line 16)이라 `JSON.parse`가 던진다 → 빈 set → `@types`만 보류 → **bun-types false-W 그대로**. 실제 readFn은 `readFileSync utf8`(scan.usecase.ts:1007)라 주석·BOM·trailing comma가 파서에 도달.
- **[오분류] v1이 "잔존 FN"이라 부른 것들이 실은 잔존 false-W.** triple-slash 전용 소비, 커스텀 typeRoots 자동포함, 못 읽는 extends, monorepo 루트 배치 — 패키지가 실제 로드되는데 안 보류하면 **false-W이지 FN이 아니다**(닫힘 가능한데 미룬 것). zero-FP 주장엔 닫거나 보수적 HOLD 필요.
- **[실증] gildash는 triple-slash를 노출 안 함**(dist grep 0건) → 닫으려면 raw 소스 스캔.
- **[실증] Bun 최신 스택 참조체인**: 이 레포 `@types/bun/index.d.ts` 첫 줄이 `/// <reference types="bun-types" />`, `bun-types` 설치됨. `@types/bun`+`bun-types` 동시 선언 레포는 `bun-types`가 참조체인으로 로드되나 import 없음 → Phase 1(tsconfig types)만으론 놓침.
- **[codex 실증] subpath `types:["foo/sub"]`**가 `node_modules/foo/sub.d.ts` 로드. 선언 dep은 `foo`라 정확문자열 `foo/sub`만 보류하면 `foo` false-W → 패키지 루트도 보류해야.

## 채택 설계 v2: TS 컴파일러 API + 무조건 @types 담요 + 참조 스캔 + 미닫힘 보수 HOLD

### 보류 술어 — dep P를 root R에서 unused 보고 **제외**한다 ⇔ 아무거나 참:
- **(a) `@types/` 접두 — 무조건**(default typeRoot 상위집합). **[가드 G1] `types` 유무에 절대 게이팅 금지** — tsc는 `types` 지정 시 @types 자동포함을 좁히지만, 그걸 흉내내면 미나열 @types마다 새 false-W. `@types/` disjunct는 독립 상수.
- **(b) P ∈ ambientTypes(R)** (아래 계산 — 해석된 tsconfig `types` + 패키지 루트).
- **(c) 참조**: `/// <reference types="X" />` 로 X→P가 (c1) 프로젝트 소스, 또는 (c2) 이미 보류된 ambient 패키지의 자기 진입 `.d.ts`(참조체인, 예 `@types/bun`→`bun-types`)에서 발견.
- **(d) bin/unknown** (기존 유지).
- **(e) 미닫힘 보수 HOLD**: R의 ambient 집합이 **닫히지 않으면**(못 읽는 extends 만남, 또는 커스텀 `typeRoots` 설정 + `types` 미정의) R의 non-import·non-bin dep 전부 HOLD. (bin `unknown`→hold 선례와 동형.)

### ambientTypes(R) 계산
1. 후보 tsconfig 수집: R 하위 `tsconfig*.json`(기존 `listRootTsconfigs` 패턴 재사용) **∪ 저장소 루트 rootAbs tsconfig**(monorepo union).
2. 각 파일: **`ts.readConfigFile(path, readFn)` → `ts.parseJsonConfigFileContent(config, host, dir)`** 로 해석된 `options.types` 획득 — **jsonc·BOM 안전, extends 병합(패키지 extends 포함), subpath 해석까지 명세충실**. `typescript@5.9.3`은 이미 설치된 직접 dep(typecheck detector가 씀). host는 readFn 위 최소 `ParseConfigHost`(readFile/fileExists=try-readFn, readDirectory=∅ — `types`엔 globbing 불요).
3. 해석 엔트리 E마다 set에 추가: `E`, 패키지루트(E)(비스코프=첫 세그먼트, 스코프=`@scope/name`), `@types/${mangle(루트)}`(스코프 `@s/p`→`@types/s__p`). @types는 (a)가 이미 덮어 dead-weight지만 명세 대칭.
4. **미닫힘 감지**: parseJsonConfigFileContent가 못 읽은 extends를 만났거나(host.fileExists=false on referenced base), `options.typeRoots` 설정 + `options.types` 미정의 → R을 unclosable 표시 → (e).
- **[가드 G2] 절대 throw 금지**: 전 과정 try/catch. 예기치 못한 throw는 `analyzeDependencies` 전체를 중단시켜 모든 finding 유실. throw→빈 set + R을 unclosable 표시(→(e), zero-FP 방향).

### (c) 참조 스캔 (widen-only, 단조)
- (c1) 프로젝트 소스: 각 파일 선두 N줄 raw 정규식 `^\s*///\s*<reference\s+types\s*=\s*["']([^"']+)["']` → X, `@types/${X}` 추가.
- (c2) 참조체인: 보류된 ambient 패키지의 진입 `.d.ts`를 readFn으로 읽어 같은 정규식 → 추가(1-hop; 깊이 cap, seen-set).
둘 다 명세정의 구문 + 정확 패키지명 → 추측값 아님. 실패는 미수집(FN 방향).

## TDD 테스트 행렬 (전용 readFn로 tsconfig 제공; `Bun.JSONC`/`ts` 경로 실측)
- **RED→GREEN 핵심**: dep `bun-types`·미import·tsconfig `types:["bun-types"]`(**주석 포함 jsonc**) → 보류. *지금 RED*.
- **참조체인**: dep `@types/bun`+`bun-types`·미import·`types` 없음·`@types/bun/index.d.ts`가 `/// <reference types="bun-types"/>` → 둘 다 보류 (c2).
- **subpath**: dep `foo`·`types:["foo/sub"]` → `foo` 보류(패키지 루트).
- **normalize**: dep `@types/node`·`types:["node"]` → 보류.
- **extends**: base `types:["bun-types"]`, 자식 extends → 보류(TS API 병합).
- **미닫힘 HOLD**: 못 읽는 extends → 그 root의 dead-lib도 보고 안 함(HOLD). / 커스텀 `typeRoots`+`types` 미정의 → HOLD.
- **project triple-slash**: 소스 `.d.ts`에 `/// <reference types="X"/>`, dep `X` 미import → 보류(c1).
- **TP 유지(negative, false-W 금지)**: dep **`dead-lib`**(ambient 아님)·미import·tsconfig `types` 없음·참조 없음 → 정상 보고. *v1의 `bun-types`를 TP 예시로 쓰던 테스트 폐기* — 참조체인/triple-slash로 false-W가 될 수 있어 오라클 오염.
- **jsonc 주석/BOM**: 주석 있는 tsconfig에서 `types` 정상 수집(핵심 실증 케이스).
- **G1 가드**: `types:["node"]`만 있어도 `@types/lodash` 여전히 보류(담요 무조건).
- **G2 가드**: 깨진 tsconfig → 크래시 없이 그 root HOLD, 다른 finding 보존.
- 기존 가드 GREEN 유지: `@types/*` 전량 보류, non-@types dead-lib 보고, bin-hold.

## 건드리는 파일
- `src/features/dependencies/analyzer.ts` — `resolveAmbientTypeHolds(R, readFn)`(TS API + 참조 스캔 + unclosable) 추가, checkDeps 보류 조건 확장(a∨b∨c∨d∨e), root별 캐시.
- `src/features/dependencies/analyzer.spec.ts` — 위 행렬.

## 정책 결정 — 확정: **A. 엄격 HOLD** (사용자 승인 2026-07-11)
tsconfig 파싱 throw 또는 ambient 집합 미닫힘(못 읽는 extends, 커스텀 `typeRoots`+`types` 미정의) → 그 root의 **non-import·non-bin dep 전량 HOLD**. false-W 0을 절대 기준으로, 깨진/이색 tsconfig가 그 root unused-dep 보고를 침묵시키는 FN을 수용. bin `unknown`→hold 선례와 동일 철학. 이 분기로 (e) 및 골든 expected를 확정한다.

## 잔존 FN (진짜 FN, over-hold 방향 — 위반 아님)
- `types:[]`로 @types 끈 프로젝트의 진짜 dead @types (담요 무조건 보류).
- extends union이 tsc replace보다 넓게 보류(설계 A에선 TS API가 정확병합이라 해당 없음, 담요만 초과).
