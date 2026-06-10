# firebat

TypeScript 코드 품질 스캐너. 16개 detector.

## waste detector

변수 선언 중, **제거해도 프로그램의 관찰 가능한 동작과 TS 타입 검사 결과가 변하지 않는** 선언을 보고한다.

**관찰 가능한 동작**: side-effect의 종류·횟수·순서, 함수 반환값, 외부로 노출되는 reference identity. 디버거 inspect, stack frame 위치, 변수명을 통한 가독성은 포함하지 않는다.

**정보보존 예외 (형태로 판정, 가독성과 구분)**: RHS가 **bare literal**(매직넘버·비트마스크 등 — `0x3ffc`)인 *형태*일 때에 한해 K다. 리터럴을 치환하면 의미 없는 매직값만 남아 이름이 유일한 정보 전달자가 되기 때문(정보 소실 방지). 이는 RHS 노드 형태로 판정하는 *닫힌 규칙*이지 "의미 있는 이름인가"라는 주관적 가독성 판단이 아니다 — RHS가 표현식(member·연산·캐스트 등: `req.user.id`, `u.role === 'admin'`)이면 치환해도 표현식이 의미를 그대로 담으므로, 이름이 아무리 서술적이어도 단일 사용이면 **항상 W**다.

**판정 절차**: RHS 표현식을 사용처에 치환 (괄호·shorthand 등 의미 보존 syntactic 보정 허용) 시 위 동작이 보존되면 W, 아니면 K.

**대상**: 모든 scope (module / function / block)의 const/let/var 변수 선언과 destructuring binding.

**비대상 (다른 detector 영역)**:
- 사용처 0회 변수 (no-unused-vars 영역)
- export된 binding (cross-module 분석 필요 — dependencies detector 영역)
- 함수 파라미터 / class field / enum / namespace / import binding
- 변수가 아닌 waste (unreachable code, dead branch, unused expression statement, 미사용 import)

**K 예시 (망라 아님)**: closure capture, 타입 narrowing, mutation 시점 snapshot, 자원 핸들 lifetime, 다중 사용처에서의 평가 횟수/순서 보존, await/yield 위치 보존, reference identity 고정 (useEffect 의존성 등), context-sensitive expression (this/super/private), 불투명 bare literal의 명명 (정보보존 — 위 참조).

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

## duplicates detector

결정을 담은 코드 단위(선언 또는 함수 내부 연속 문장열)가 **바인딩·리터럴·타입 치환만으로 정규형이 일치**해 두 곳 이상에 복제되어, 한 결정의 **단일 변경지점이 깨진** 구조를 보고한다.

**단일 변경지점**: 한 결정(로직·계약)이 코드에 단 하나의 표현만 가지는지. 같은 결정이 정규형으로 여러 곳에 있으면 변경 시 모두 같이 고쳐야 하고, 하나라도 빠뜨리면 불일치 버그가 된다. 토큰·포맷의 우연한 유사, 저자 의도, 변수명을 통한 가독성은 포함하지 않는다.

**구조 일치 예외 (역할로 판정, 의도와 구분)**: 정규형이 같아도 그 구문이 **결정을 담지 않는 골격**(단순 위임 — 본문이 파라미터 무변형 단일 호출 반환뿐인 것, 본문 없는 overload 시그니처, 빈 marker 타입 등 프로토콜 강제 구조)이면 K다. 드리프트할 결정이 없어 같이 바뀔 의무가 안 생기기 때문. 이는 구문의 역할을 형태로 판정하는 *닫힌 규칙*이지 "같은 의도로 복제했나"라는 주관 판단이 아니다 — 결정(제어흐름·계산·계약)을 담은 구문이면 정규형이 같은 순간 **항상 W**다.

**판정 절차**: 두 구문의 바인딩(비교 단위 내부에서 선언된 식별자·파라미터·타입파라미터)·리터럴·타입 주석·타입인자를 placeholder로 치환한 정규형이 일치하고 둘 다 결정을 담으면 W, 정규형이 어긋나거나 결정 없는 골격이면 K. 자유 식별자(비교 단위 밖 선언·import 참조)와 프로퍼티 이름은 치환하지 않고 그대로 비교한다 — 다른 대상을 호출하면 다른 결정이다. 단, 내용이 곧 결정인 곳은 치환하지 않는다: 규칙 데이터(매핑·룩업 테이블)의 리터럴, 타입 선언(interface·type)의 본문 구조.

**대상**: 결정을 담는 두 종류의 단위. ① **선언** — 함수·메서드·클래스, 계약을 담는 타입·인터페이스 정의, 규칙을 담는 데이터 선언(매핑·룩업 테이블). 계약은 선언 구문과 무관하게 구조로 비교한다 — 같은 멤버 구조가 interface와 type alias 양쪽에 있으면 같은 계약의 중복이다. ② **함수 내부 연속 문장열(statement run)** — 함수 본문에 복제된 문장 덩어리. OXC AST 정규형으로 판정한다.

**문장열 단위의 닫힌 규칙 (statement run)**: 함수 경계와 무관하게 복제된 문장 덩어리를 잡되, 다음 규칙으로 단위를 고정한다.
- **경계**: 하나의 BlockStatement.body 안의 **연속된 형제 문장**만. 분기·반복 본문을 가로지르지 않고, 복합문 중간에서 시작·끝나지 않는다.
- **최소 크기**: 정규형 AST 노드 수가 임계(`minSize`) 이상. 미만의 사소한 문장열(단일 로깅·대입 두 줄 등)은 결정을 담기엔 너무 작아 K. 이는 유사도 임계가 아니라 결정-존재 floor이며, 매칭 자체는 정규형 완전 일치(이진·닫힘)다.
- **추출 안전성**: 문장열을 하나의 함수로 추출할 수 있어야 한다. 문장열 안에서 선언한 바인딩 중 문장열 **밖에서 쓰이는 것(live-out)이 2개 이상**이거나, return/break/continue가 문장열 경계 밖으로 제어를 넘기면 K(단일 반환으로 추출 불가). live-out이 0~1개이고 제어 이탈이 없으면 추출 가능 → W 후보.
- **중첩**: 같은 사이트 집합에서는 **최대 문장열**만 보고한다. 더 넓은 사이트 집합에 반복되는 부분 문장열은 별개 클론으로 보고한다.

**비대상 (다른 detector 영역)**:
- 단일 리터럴·상수 값의 반복 (서브트리 클론이 아닌 상수 추출 문제 — redundancy 영역)
- 부분 편집으로 정규형이 어긋나는 근접 중복(near-miss / Type-3)·의미만 같고 구조가 다른 중복(Type-4): 유사도 임계 없이 닫힌 판정 불가 — 범위 밖
- 추출 불가능한 문장열(밖에서 쓰는 바인딩·제어 이탈)·최소 크기 미만 문장열 (위 닫힌 규칙)
- export 표면의 cross-module 중복 (dependencies 영역)

**K 예시 (망라 아님)**: 외부강제 골격(단순 위임·overload 시그니처·프레임워크 등록 형태), 정규형이 어긋나는 유사 코드, 형태만 같고 결정을 담지 않는 데이터 구조.
