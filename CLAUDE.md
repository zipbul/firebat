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
