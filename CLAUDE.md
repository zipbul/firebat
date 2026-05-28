# firebat

TypeScript 코드 품질 스캐너. 17개 detector.

## waste detector

변수 선언 중, **제거해도 프로그램의 관찰 가능한 동작과 TS 타입 검사 결과가 변하지 않는** 선언을 보고한다.

**관찰 가능한 동작**: side-effect의 종류·횟수·순서, 함수 반환값, 외부로 노출되는 reference identity. 디버거 inspect, stack frame 위치, 변수명을 통한 가독성은 포함하지 않는다.

**판정 절차**: RHS 표현식을 사용처에 치환 (괄호·shorthand 등 의미 보존 syntactic 보정 허용) 시 위 동작이 보존되면 W, 아니면 K.

**대상**: 모든 scope (module / function / block)의 const/let/var 변수 선언과 destructuring binding.

**비대상 (다른 detector 영역)**:
- 사용처 0회 변수 (no-unused-vars 영역)
- export된 binding (cross-module 분석 필요 — dependencies detector 영역)
- 함수 파라미터 / class field / enum / namespace / import binding
- 변수가 아닌 waste (unreachable code, dead branch, unused expression statement, 미사용 import)

**K 예시 (망라 아님)**: closure capture, 타입 narrowing, mutation 시점 snapshot, 자원 핸들 lifetime, 다중 사용처에서의 평가 횟수/순서 보존, await/yield 위치 보존, reference identity 고정 (useEffect 의존성 등), context-sensitive expression (this/super/private).

## error-flow detector

throw된 에러 또는 Promise 거부(rejection)가, 로컬 구문 때문에 **관찰 가능성·전파·원인 정보** 중 하나가 보존되지 못하는 구조를 보고한다.

**관찰 가능성·전파·원인 정보**: throw 값 / 거부 reason이 의도된 처리 지점(호출자·await·catch·로깅)에 도달하는지(관찰·전파), 원본 에러의 message·stack·cause가 추적 가능한지(원인). 스타일·가독성·표기 관습은 포함하지 않는다.

**판정 절차**: 현재 구문에서 throw 값 / 거부 reason이 도달 가능한 처리 지점에 닿고 원본 에러의 message·stack·cause가 보존되면 K, 하나라도 유실·삼킴·원인 단절되면 W.

**대상**: 함수 / 파일 단위의 try/catch/finally, throw, Promise 생성자·체인·await/return 흐름. OXC AST로 판정하고, "값이 Promise인가" 등 타입 판단은 gildash 의미정보로 보강한다.

**비대상 (다른 detector 영역)**:
- cross-module 거부 전파, 전역 unhandledRejection, 호출자 측 미처리 (파일 범위 밖)
- 관찰·전파·원인이 모두 보존되는 비동기 스타일·관습 (lint 영역)
- 동작에 영향 없이 제거 가능한 무의미 구문 (redundancy 영역)

**K 예시 (망라 아님)**: 명시적 fire-and-forget (`void p`, 폐기 전 `.catch` 부착), Promise를 반환해 호출자에 전파, 로깅·변환 후 원본 rethrow, 새 Error에 `cause`로 원본 보존, allSettled/race 보조 Promise의 의도적 거부 흡수, finally 내 정상 정리(throw/return 없음).
