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

결정을 담은 코드 단위(선언 또는 함수 내부 연속 문장열)가 **바인딩·타입 치환만으로 정규형이 일치**(리터럴은 치환하지 않음 — 아래 판정 절차)해 두 곳 이상에 복제되어, 한 결정의 **단일 변경지점이 깨진** 구조를 보고한다.

**단일 변경지점**: 한 결정(로직·계약)이 코드에 단 하나의 표현만 가지는지. 같은 결정이 정규형으로 여러 곳에 있으면 변경 시 모두 같이 고쳐야 하고, 하나라도 빠뜨리면 불일치 버그가 된다. 토큰·포맷의 우연한 유사, 저자 의도, 변수명을 통한 가독성은 포함하지 않는다.

**구조 일치 예외 (역할로 판정, 의도와 구분)**: 정규형이 같아도 그 구문이 **결정을 담지 않는 골격**(단순 위임 — 본문이 파라미터 무변형 단일 호출 반환뿐인 것, 본문 없는 overload 시그니처, 빈 marker 타입 등 프로토콜 강제 구조)이면 K다. 드리프트할 결정이 없어 같이 바뀔 의무가 안 생기기 때문. 이는 구문의 역할을 형태로 판정하는 *닫힌 규칙*이지 "같은 의도로 복제했나"라는 주관 판단이 아니다 — 결정(제어흐름·계산·계약)을 담은 구문이면 정규형이 같은 순간 **항상 W**다.

**판정 절차**: 두 구문의 바인딩(비교 단위 내부에서 선언된 식별자·파라미터·타입파라미터)·타입 주석·타입인자를 placeholder로 치환한 정규형이 일치하고 둘 다 결정을 담으면 W, 정규형이 어긋나거나 결정 없는 골격이면 K. **바인딩 치환은 alpha-renaming이다 — 같은 placeholder가 아니라 첫 등장 순서로 번호를 매겨 동일참조(co-reference)를 보존한다**: 같은 바인딩의 재사용은 같은 번호, 서로 다른 바인딩은 다른 번호를 받는다. 그래서 `x+x`(`#0+#0`)와 `x+y`(`#0+#1`)는 다른 결정이고, `s.add(v); l.push(v)`(v 재사용)와 `s.add(k); l.push(i)`(서로 다른 바인딩)도 다른 결정이다 — 바인딩을 한 placeholder로 뭉개면 둘이 거짓병합(FP)된다. 번호는 비교 단위(노드/문장 런/계약 멤버 집합) 안에서 결정론적 순회로 매기므로 corpus 독립·이진·닫힘이다. 자유 식별자(비교 단위 밖 선언·import 참조)·프로퍼티 이름·**리터럴 값**은 치환하지 않고 그대로 비교한다 — 다른 대상을 호출하거나 다른 리터럴을 쓰면 다른 결정이다. **리터럴은 어디서든 내용=결정이므로 치환하지 않는다**(규칙 데이터의 리터럴·판별 리터럴뿐 아니라 모든 리터럴): "리터럴만 다른" 근접 중복은 *같은 결정의 상수 드리프트*(예: 세율 `0.1`/`0.2`)와 *서로 다른 결정*(예: `x.kind==='A'` vs `'B'`, `withType('Logical')` vs `('Binary')`)을 닫힌 규칙으로 구분할 수 없어 — 둘 다 "리터럴 하나만 다름" — zero-FP를 위해 **비탐지**(literal-variant 미보고, 아래 비대상). 타입 선언(interface·type)의 본문 구조도 결정이므로 치환하지 않는다.

**대상**: 결정을 담는 두 종류의 단위. ① **선언** — 함수·메서드·클래스, 계약을 담는 타입·인터페이스 정의, 규칙을 담는 데이터 선언(매핑·룩업 테이블). 계약은 선언 구문과 무관하게 구조로 비교한다 — 같은 멤버 구조가 interface와 type alias 양쪽에 있으면 같은 계약의 중복이다. **명명 선언은 크기 floor가 없다** — 작은 중복 함수도 주소 지정 가능한 변경지점이므로 잡는다(false negative 방지). ② **함수 내부 연속 문장열(statement run)** — 함수 본문에 복제된 문장 덩어리. OXC AST 정규형으로 판정한다.

**결정-존재 floor (익명 인라인 표현식)**: 결정-존재 floor(`minSize`)는 문장열뿐 아니라 **익명 함수 표현식**(arrow / 이름 없는 function expression)에도 적용한다. 익명 인라인 람다는 명명된 변경지점이 아니라 인라인 코드(문장열의 인라인 등가물)이므로, 정규형 노드 수가 floor 미만이면 드리프트할 결정을 담기엔 너무 작아 K다. 형태로 판정하는 닫힌 규칙(노드 유형 + 노드 수)이며 매칭 자체는 정규형 완전 일치(이진·닫힘)다 — 우연히 같은 사소한 람다(`(a,b)=>a-b` 비교자, `s=>s.length>0` 술어, `n=>f(n,k)` 투영 등 독립 결정의 동형)를 zero-FP로 거른다. **명명 선언은 이 floor 비대상**(작아도 변경지점).

**문장열 단위의 닫힌 규칙 (statement run)**: 함수 경계와 무관하게 복제된 문장 덩어리를 잡되, 다음 규칙으로 단위를 고정한다.
- **경계**: 하나의 BlockStatement.body 안의 **연속된 형제 문장**만. 분기·반복 본문을 가로지르지 않고, 복합문 중간에서 시작·끝나지 않는다.
- **최소 크기**: 정규형 AST 노드 수가 임계(`minSize`) 이상. 미만의 사소한 문장열(단일 로깅·대입 두 줄 등)은 결정을 담기엔 너무 작아 K. 이는 유사도 임계가 아니라 결정-존재 floor이며, 매칭 자체는 정규형 완전 일치(이진·닫힘)다.
- **추출 안전성**: 문장열을 하나의 함수로 추출할 수 있어야 한다. 문장열 안에서 선언한 바인딩 중 문장열 **밖에서 쓰이는 것(live-out)이 2개 이상**이거나, return/break/continue가 문장열 경계 밖으로 제어를 넘기면 K(단일 반환으로 추출 불가). live-out이 0~1개이고 제어 이탈이 없으면 추출 가능 → W 후보.
- **중첩**: 같은 사이트 집합에서는 **최대 문장열**만 보고한다. 더 넓은 사이트 집합에 반복되는 부분 문장열은 별개 클론으로 보고한다.

**비대상 (다른 detector 영역)**:
- 단일 리터럴·상수 값의 반복 (서브트리 클론이 아닌 상수 추출 문제 — redundancy 영역)
- 부분 편집으로 정규형이 어긋나는 근접 중복(near-miss / Type-3)·의미만 같고 구조가 다른 중복(Type-4): 유사도 임계 없이 닫힌 판정 불가 — 범위 밖
- **리터럴만 다른 중복(literal-variant)**: 구조 동일·리터럴만 다른 쌍은 "상수 드리프트(W)"인지 "서로 다른 결정(K)"인지 닫힌 규칙으로 구분 불가 → 비탐지 (리터럴 비치환으로 정규형이 어긋나 매칭되지 않음)
- 추출 불가능한 문장열(밖에서 쓰는 바인딩·제어 이탈)·최소 크기 미만 문장열 (위 닫힌 규칙)
- **결정-존재 floor 미만의 익명 인라인 표현식**(arrow / 이름 없는 function expression): 너무 작아 결정을 담지 못함 — 명명 선언은 비대상 floor (위 닫힌 규칙)
- export 표면의 cross-module 중복 (dependencies 영역)

**K 예시 (망라 아님)**: 외부강제 골격(단순 위임·overload 시그니처·프레임워크 등록 형태), 정규형이 어긋나는 유사 코드, 형태만 같고 결정을 담지 않는 데이터 구조, 결정-존재 floor 미만의 익명 인라인 람다(사소한 비교자·술어·투영).

## indirection detector

함수·타입 선언이 기존 대상에 **결정을 더하지 않고**(무변형) 새 이름·층만 부여해 재노출하여, 그 층을 인라인(걷어냄)해도 **관찰 가능한 동작과 TS 타입 검사 결과가 변하지 않는** 구조(thin-wrapper·type-remap·interface-rewrap), 또는 그런 무변형 위임이 **임계를 넘는 깊이로 누적된** 구조(forward-chain·cross-file-forwarding-chain)를 보고한다.

**관찰 가능한 동작**: waste·error-flow와 동일 — side-effect의 종류·횟수·순서, 함수 반환값, 외부로 노출되는 reference identity, await/yield/throw 위치, 타입 검사 결과. 디버거 inspect·stack frame·변수명을 통한 가독성·도메인 명명은 포함하지 않는다.

**무가치성 예외 (형태로 판정, 가독성과 구분)**: 위임이 결정을 추가하거나 인라인이 동작·타입·identity·비동기 계약을 바꾸는 다음 형태는 K다 — ① 인자 변형(재배열·추가·누락·기본값·부분적용·리터럴 주입·rest↔식별자·destructuring 해체·옵셔널 체인 호출), ② 콜백·identity 자리 도달(reference·identity 경계), ③ 수신자(this/super/private/외부객체) 고정, ④ async/await·generator(→ error-flow), ⑤ 반환 narrowing(type predicate·asserts), ⑥ 가시성·프로토콜 강제(decorator·override·overload·get/set·declaration merging·module augmentation·declare·.d.ts), ⑦ 제네릭 변형(typeArg·typeParam 보유). 각 형태는 아래 판정 절차에서 OXC AST 노드 형태로 닫으며(이름·메서드명 화이트리스트나 의미 추정이 아님), 이는 RHS가 의미를 담는지를 묻는 waste의 정보보존, 결정을 담는지를 묻는 duplicates의 골격 예외와 같은 닫힌 규칙이지 "의미 있는 추상화인가"라는 주관 판단이 아니다. 본문이 이들 중 어디에도 해당하지 않는 파라미터 무변형 단일 호출 통과이거나 타입이 typeArg·typeParam 없는 순수 동의어/빈 재포장이면, 이름이 아무리 서술적이어도 **항상 W**다.

**판정 절차**: 단일 간접층(thin-wrapper·type-remap·interface-rewrap)은 인라인 치환했을 때 위 동작·타입검사 결과가 보존되면 W, 결정을 추가하거나 보존되지 않으면 K. 위임 체인(forward-chain·cross-file-forwarding-chain)은 각 hop이 무변형 위임(아래 ①)인 사슬의 깊이가 임계를 넘으면 W다(인라인 제거 가능성이 아니라 누적 깊이가 결정).

- **함수 단일 위임(thin-wrapper)**: ① **본문 형태 게이트** — 함수 노드가 non-async(`async` 없음)·non-generator이고, 본문(BlockStatement면 단일 ReturnStatement/ExpressionStatement, concise arrow면 식)이 단일 CallExpression이며: 인자가 파라미터를 선언 순서대로 1:1 무변형 전달(비rest 위치는 Identifier만 — SpreadElement 불가, rest는 SpreadElement `...p`로만; 추가·누락·재배열·기본값·리터럴 주입·옵셔널 체인 `f?.()` 없음; 파라미터가 ObjectPattern·ArrayPattern이면 그 해체 바인딩을 인자로 푸는 것은 객체↔위치 형태 변환이라 K — 파라미터 식별자 자체의 무변형 전달만 W); callee가 자유 함수 식별자이거나 위임 함수 파라미터를 object로 한 멤버 호출(`p.m(...)`)이고 object가 ThisExpression·Super·PrivateIdentifier·비파라미터 외부 식별자가 아님; 본문에 AwaitExpression·YieldExpression 없음; 반환 주석이 TSTypePredicate·`asserts` 아님; decorator·`override`·overload(같은 이름의 본문 없는 시그니처가 함께 선언된 함수 — 구현부 포함 K)·get/set accessor 아님. ② **reference·identity 게이트** — 위임 함수, 그리고 그 함수가 **변수 init**이면 그 바인딩을 파일 내에서 fixpoint로 따라간 모든 재바인딩 식별자의 사용처를 스캔해, CallExpression callee 위치의 직접 호출 외 도달(CallExpression·NewExpression의 argument, `===`·`!==`·`==`·`!=`·`instanceof` 피연산자, init·대입 우변·배열 원소·SpreadElement·default, return·export·JSX 속성 값)이 0회임을 확인 — 1회라도 있으면 K. 위임 함수가 **프로퍼티 init**이면 프로퍼티 aliasing이 형태로 닫히지 않으므로 보수적 K. 위임 함수가 export되어 사용처가 파일 밖에 있으면 ②를 파일 안에서 증명할 수 없으므로 thin-wrapper 비대상(아래 cross-module). ③ ①+②를 통과하면 호출처를 피호출자로 치환한다.
- **타입 위임(type-remap·interface-rewrap)**: typeArg·typeParam·heritage `typeArguments`가 없는 분에 한해 별칭을 원타입으로 치환한다.

함수 단일 위임과 타입 위임은 파일 단위 OXC AST 형태만으로 닫는다(의미층 gildash 의존 분기 없음). 위임 체인은 무변형 위임 hop(각 hop이 위 ①을 통과)의 연쇄를 import 그래프 위에서 추적하되, 고정 파일집합에서 결정론적이다.

**대상**:
1. **thin-wrapper**: 함수 단일 위임 게이트(①+②)를 통과한 동기·non-generator **named function declaration 또는 변수 init arrow/function expression**. 인라인 제거가 동작·identity를 보존하는 무가치 단일 층. (클래스 메서드는 ②가 닫히지 않아 비대상 — 아래 method 위임.)
2. **forward-chain**: 각 hop이 무변형 위임(①)인 사슬이 같은 파일 안에서 연쇄된 것. depth 임계는 판정 게이트다 — `maxForwardDepth` 초과(`depth > maxForwardDepth`) 체인만 생성하며, duplicates의 `minSize`와 같은 결정-존재 floor의 체인 등가물이다(고정 옵션값 하에서 corpus 독립·결정론적). 누적 깊이가 결정이므로 개별 hop의 reference·identity 인라인 안전성(②)은 요구하지 않는다.
3. **cross-file-forwarding-chain**: forward-chain이 import 그래프를 따라 파일 경계를 넘어 연쇄된 것. (2)와 같이 각 hop이 ①을 통과하는 무변형 위임이고 depth가 임계를 넘는 깊이 신호이며, ②(파일내 사용처 증명)나 export 표면 제거 가능성을 주장하지 않는다. 각 hop의 ① 판정은 그 hop이 정의된 파일에서 독립적으로 닫히고, 체인 연결만 import 그래프로 잇는다. cross-file 순환 위임 체인(import 그래프 사이클)은 깊이 임계와 무관하게 cross-file-forwarding-chain(depth=-1 마커)으로 보고한다. same-file 순환(같은 파일 a→b→a)은 호출 사이클=무한재귀로 타입검사·런타임에서 드러나는 버그이지 정적 무가치 층이 아니므로 미보고(범위 밖)다.
4. **type-remap**: `type A = B` 순수 별칭(typeArg·typeParam 없음). typeArg·typeParam이 하나라도 있으면 제네릭 변형으로 **항상 K**(`type A = Readonly<B>` → K — 구조 동등 여부는 의미층 판단이라 닫히지 않으므로 범위 밖).
5. **interface-rewrap**: 멤버 0개, `extends` 정확히 1개(0개는 빈 marker, 다중 `extends A, B`는 합성 결정이라 K), `typeParameters` 없음, 그 heritage 절에 `typeArguments` 없음, declaration merging(same-file 동일 이름 interface/class 2개 이상)·module augmentation·`declare` 아님, 그리고 **module 파일**(최상위 import/export 선언이 있는 파일)일 것 — script 파일(전역 스코프, 최상위 import/export 없음)은 같은 이름 interface가 파일을 넘어 병합될 수 있어 단일 파일 AST로 닫히지 않으므로 항상 K. 모두 AST 형태로 닫는다.

**비대상 (다른 detector 영역)**:
- **async·await·generator 위임** → error-flow. `async`·`await` 통과(`return await f()`·`await f?.()` 포함)·`function*`/`async function*`·`yield`/`yield*` 통과·`void f(x)` fire-and-forget·미await 통과는 비동기 계약·거부 흐름 보존 문제로 귀속.
- **변수 값 별칭** → waste(비export `const a = b`). **export된 함수/값 재바인딩**(`export const g = f`)·`export *`·default/named 재노출 표면 → barrel/dependencies. enum·namespace 런타임 객체 별칭 → waste/dependencies.
- **cross-module thin-wrapper** — 단일 위임(thin-wrapper) 후보가 export되어 사용처가 파일 밖에 있어 reference·identity 게이트(②)를 파일 안에서 증명할 수 없는 경우. (단 위임 체인 #2·#3은 ②를 요구하지 않으므로 여기 해당하지 않는다.)
- **빈 클래스 재포장(`class A extends B {}`)** — class는 런타임 생성자 값·`instanceof`·prototype identity를 새로 만들어 `A`→`B` 인라인이 reference identity를 깨므로 **항상 K**. 타입만 지워지는 interface-rewrap과 구분되는 닫힌 규칙(`IndirectionFindingKind`에도 class 종류 없음).
- **get/set accessor 위임** — call site가 호출이 아니라 프로퍼티 접근이라 "호출처를 피호출자로" 인라인 절차가 형태로 닫히지 않음 — indirection 영구 비대상(K).
- **클래스 메서드 위임** — 메서드는 변수 바인딩이 아니라 인스턴스·프로토타입을 통해 접근(`c.m`·`C.prototype.m`)되므로, reference·identity 게이트(②)의 사용처 도달 추적이 인스턴스 aliasing으로 파일 내에서 닫히지 않는다 → 보수적 K(프로퍼티 init과 동형). 단일 위임 thin-wrapper는 named function declaration·변수 init arrow/function expression만 대상.

**K 예시 (망라 아님)**: 콜백·identity 자리 도달 위임(`xs.map(handle)`·`userHof(xs, inc)`·`el.addEventListener('click', handle)` 짝·`a === wrapper`·`new Worker(handle)`·`set.add(handle)`·`const cb = x=>f(x); xs.map(cb)`), 기본값·부분적용·재배열·리터럴 주입 래퍼, 옵셔널 체인 호출 래퍼(`f?.(x)`), rest를 식별자로 넘기거나 비rest를 SpreadElement로 전개하는 래퍼, destructuring 파라미터 해체 래퍼(`({a,b})=>f(a,b)`), this/super/private·외부 객체·import namespace 수신자 멤버 위임, 클래스 메서드 위임(인스턴스 aliasing으로 ② 미닫힘), 프로퍼티 init에 들어간 위임 함수(aliasing 미닫힘), `async`·`return await`·generator·`yield*` 위임, type predicate·`asserts` 반환 래퍼, decorator/override/overload/get·set/declaration-merging/`declare`/.d.ts 강제 구조, 제네릭 변형 별칭·재포장(`interface Wrap<T> extends Base`·`type A = Readonly<B>`·`interface NumberSet extends Set<number>`), 다중 extends 합성·extends 0개 빈 marker, script 파일의 빈 extends interface(cross-file 병합 가능), 빈 클래스 재포장(`class A extends B {}` — 런타임 identity), 단일 위임 thin-wrapper의 cross-module(export로 파일내 사용처 증명 불가), 결정을 추가하는 모든 정상 추상화.
