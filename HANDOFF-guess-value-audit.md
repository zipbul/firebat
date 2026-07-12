# 핸드오프 — 추측값(guess-based) 로직 전수조사 및 제거

전 detector 대상 **추측값 위반 전수조사 후 하나씩 제거**하는 작업. 사용자가 항목별로 결정하며 진행.

## 추측값 정의 (CLAUDE.md)
소비자가 임의로 짓는 이름·파일명·경로에서 역할/의미를 짐작한 값 → 검증 불가 → 틀리면 거짓 W(노이즈) 또는 부당 K. 명세 정의 이름(Promise/Error/Object 등)은 **별개 계열**: identity(바인딩 해석·타입 증명) 확인 전에는 K방향(finding 안 만드는 쪽)으로만 사용 가능. identity 미확인 상태의 이름 매칭으로 W(finding 생성)를 만들면 위반.

## 핵심 교훈 (사용자가 강하게 지적)
- 이름 기반 검사를 지울 때 **그 이름을 negative 테스트 케이스로 박아넣지 마라.** K 계약은 로직(구조·동작)으로 정의해야지 "이 이름은 무시해"로 정의하면 추측값 신호를 테스트에 고정하는 꼴이다. 아예 버릴 케이스면 케이스 자체를 삭제한다(다른 케이스로 전환 금지).
- 모든 주장은 실측·재현으로 검증하고, 작업물은 3자 적대리뷰를 통과시킨다. 이번 감사에서 적대리뷰가 잡은 실제 false-W: dead-export leak, `usesNodeBuiltin` ambient 미관측, script 토큰 경로호출 누락, bin-manifest 미읽힘(unknown→보고).

## 완료 (전부 커밋됨, branch: chore/guess-value-audit-dependencies)
- **error-flow reject-param** (`6c8c678`): executor 첫 파라미터명 `reject` 매칭 삭제 — 명세상 첫 파라미터는 위치로 resolve, 이름만이 신호라 비탐지. fixture 통째 삭제.
- **dependencies 전면** (`5c9a9d7`): `test-only-export` kind 삭제(파일명으로 test/prod 추측), `isTestLikePath`/`isConfigLikePath` 삭제, `unused-file`은 사용자 `entry` glob opt-in(미선언 시 보류), dead-export leak 수정, `@types/*` 전량 보류(tsconfig 병합 없이 안 닫힘 + ambient 미관측), script-binary는 쉘파싱 대신 dep의 `bin` 필드(사실) tri-state(`unknown`→보류).
- **duplicates forEach/map 정규화** (`e4564db`): 프로퍼티명으로 배열 의미 추정 후 재작성 → 거짓 병합. 5개 대형 레포 실측으로 가치 0 확인 후 삭제. 순수 구문 정규화(DeMorgan 등)는 유지.
- **duplicates cross-bundle 경로필터** (`c0d6b4f`): `/src/oxlint-plugin/` 경로·`.spec.ts` 매칭 필터 삭제 → **계약 타입선언(interface/type alias) 결정-존재 floor**로 대체. `{line;column}`(11노드<12)는 보편 어휘의 우연 동형이라 K, floor 이상 계약 중복은 위치 무관 W. 근거는 문헌+3자 토론으로 확정(size=정보량 근사, 참조범위 게이트 기각) — memory `project-duplicates-contract-floor-decision` 참조. self-scan duplicates 0 정당 복원.
- **error-flow `no-callback-in-promise` kind 삭제**: `readFile`/`exec`/`spawn` 등 메서드명 13개 목록 매칭(수신자 미검증·유일하게 오라클 K-gate 없던 규칙). 적대검증 확정 근거 3개 — ① 이름만이 신호(자기 골든 fixture조차 `declare const fs` 로컬 객체로 W = false-W 박제), ② 콜백 본문을 안 봐 유실/처리(`if(err) log(err)`→K)를 못 가름, ③ `.then` 안에서만 발화 = 스타일 혼용 단속 = eslint-plugin-promise 포팅(lint 영역). kind·catalog code(`EF_UNOBSERVED_PROMISE_CALLBACK_IN_PROMISE`)·골든·coverage/regression 케이스·레퍼런스 문서 전부 삭제(negative 케이스 전환 없이 통삭제 — 핵심 교훈 준수). 카탈로그 74→73.
- **error-flow 명세이름 identity 게이트**: Promise/Error류/String류/globalThis·window·self를 근거로 W를 만드는 6개 사이트(missing-error-cause·throw-non-error·floating-promises·promise-constructor-hygiene·reject-non-error)에 섀도잉 게이트 추가 — 파일이 같은 이름의 **런타임 바인딩**(변수·함수·클래스·import·파라미터·catch)을 선언하면 그 이름의 전역 identity가 안 닫히므로 보류(스코프체인의 보수적 폐포, K방향 오차만). **ambient `declare`는 섀도잉 아님**(런타임 바인딩 없음 — 전역 존재 선언 = 명세 사실) — coverage 테스트의 `declare const globalThis`가 이 경계를 실증. 이름은 추측값이 아니라 명세이름이며, 위반은 "identity 미확인 시 K방향만" 조항이었음.
- **error-flow 게이트 tri-model 적대리뷰 + any-hole 수정** (`be9b344`): codex+grok+claude 3모델 독립 리뷰가 공통 발견한 HIGH false-W — `isProvenArray`가 순수 assignability라 **any-타입 수신자가 배열로 "증명"**되어 misused-promises 발화(실증 재현). any/unknown/never 가드 추가(thenable 프로브의 내장 any-가드와 대칭). + 섀도 게이트 갭 2개 수집(`import X = require()` TSImportEquals, `X = fake` 대입). dead 오라클 메서드(isProvenNonThenable/isProvenNonArray) 제거. 가드는 mutation-검증(제거 시 테스트 fail 확인). **기각한 리뷰 주장**: 2-인자 then 미처리(chainHasCatch가 이미 처리), ambient declare 섀도 취급(emit 없음 — 런타임 값은 여전히 전역; 거짓 주석은 폴리필=환경 문제로 정적 범위 밖). **수용한 잔여 한계(문서화)**: 구조적 타이핑상 ReadonlyArray 전체를 손수 구현한 타입/PromiseLike+커스텀 finally는 구분 불가 — 계약을 구현한 타입은 그 계약대로 취급.
- **error-flow thenable identity 게이트** (`a61e0c0`): catch-or-return·unsafe-finally·misused-promises가 임의 수신자의 명세이름 프로퍼티 매칭만으로 W 발화(미증명→발화)하던 것을 뒤집음. W 조건 = [구문 spec-fact 체인: 루트가 Promise 팩토리(new Promise/Promise.*/import(), 섀도잉 게이트)이고 모든 hop이 then/catch/finally(반환도 명세상 Promise)] OR [gildash 증명(isThenable/신규 isProvenArray)]. misused의 구문 사실은 ArrayExpression 리터럴 수신자. **hono+zod 실측**: 88→86 findings — 잃은 2건은 테스트파일 semantic 제외로 oracle이 못 증명한 변수-경유 `.then`(커버리지 한계), `Promise.resolve().then` 류는 구문 게이트가 회수, misused/finally는 무손실. 파서 콤비네이터류 `.then` false-W 클래스 소멸. 골든/coverage는 수신자를 닫히는 사실(배열 리터럴·spec-fact 루트)로 이전, 타입주석 수신자 계약은 semantic mock unit으로 표현.

## 남은 항목
**없음 — 전 detector W방향 추측값/identity 위반 감사 완결** (2026-07-09, 커밋 `1f04b36`까지).

(라인 번호는 감사 시점 기준 — 착수 전 재확인 필요.)

**waste** (`04afbea`): 원 감사의 "위반 0건" 판정은 **오판**이었다 — `Object.assign`/`Reflect.set` 이름 매칭이 W방향(mutation-only dead-store 생성)인데 방향 검증을 안 했고, 그 브랜치는 테스트도 0건이었다. 섀도잉 시 false-W 실증 후 수정: 섀도 수집기를 공유 유틸(`src/engine/ast/collect-shadowed-names.ts`)로 추출(멤버-대입 `globalThis.X=`·computed 문자열·type-only import 제외 포함), error-flow 마이그레이션, waste 게이트(필수 파라미터). tri-model 리뷰 통과. **교훈: 이름 매칭 감사는 존재가 아니라 방향(W/K)을 검증해야 하고, 같은 동치류(섀도잉)는 전 detector에 수평 전개해야 한다.**

## 완료 (계속)
- **indirection 체인 identity** (`1f04b36`): 이름 문자열 Map(마지막-승자 clobber → 선언 순서 의존 ghost cycle/depth)을 노드-키 + "최상위 유일 바인딩" 해석으로 교체. hop 연결 = callee가 Identifier이고 그 이름의 최상위 바인딩이 정확히 1개(함수·변수·클래스·enum·import 전체 집계 — tri-model 리뷰가 함수만 세면 `function w`+`var w=5` 리디클레어 소스에서 승자를 고르는 구멍을 잡음)이며 그 1개가 함수일 때만. 파라미터-callee는 콜백 슬롯으로 K. 중첩 wrapper는 체인 불참(보류). 재현 실증 + mutation 검증 + **커밋 전** tri-model 리뷰.

## 잔존 FN-hold (위반 아님, 기록)
- dependencies `nestedPkgDirs`: package.json 있는 dir 하위 전부 unused-file 보류 — sound하나 거침(모노레포 per-package 도달성은 별도 기능 트랙, 최대 knip-parity 델타)
- dependencies `readPackageEntrypoints`: exports 맵 전 조건 무차별 root 수집(FN-safe)
- dead-@types 비탐지(전량 보류) — 잡으려면 별도 opt-in 신호로만
- error-flow: oracle 미증명 변수-경유 `.then`(semantic 제외 파일) 보류; 구조적 타이핑 잔여(ReadonlyArray 전체 구현체·PromiseLike+커스텀 finally)는 계약대로 취급
- indirection: 같은 파일 사이클로 흘러드는 feeder 체인은 사이클과 함께 미보고(pre-cycle depth 미보고 — 정책); ② identity 게이트는 이름-스캔이라 동명 wrapper 간 과억제 가능(K방향만); 중첩 wrapper는 체인 불참
