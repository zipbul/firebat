# STYLEGUIDE

## 목적

- 네이밍/타입/코드 스타일/함수 설계/파일 분해 기준을 일관되게 적용한다.
- 리뷰 기준을 객관화해서 “취향” 논쟁을 차단한다.

## 적용 범위

- TypeScript 코드 및 문서화된 예시 코드 전반

## 정본/우선순위

- 최상위 정본은 [SPEC.md](SPEC.md)다.
- 아키텍처 경계/Facade 규칙은 [ARCHITECTURE.md](ARCHITECTURE.md)가 우선한다.

## 에이전트 체크리스트 (Agent Checklist)

에이전트는 코드 작업 전/후 아래 항목을 **반드시** 확인한다(MUST).

### 작업 전

- [ ] 대상 파일의 현재 구조 확인
- [ ] 적용해야 할 STYLE-XXX 규칙 나열
- [ ] TypeScript 공식 문서 참조 (<https://www.typescriptlang.org/docs/>)

### 작업 후

- [ ] 모든 type/interface가 예약 파일로 분리되었는가? (STYLE-005)
- [ ] 데드코드가 없는가?
- [ ] 인라인 타입이 없는가? (STYLE-004)
- [ ] Enum 항목이 `PascalCase`인가? (STYLE-021)
- [ ] 함수 파라미터가 4개 이하인가? (STYLE-015)
- [ ] 반복 리터럴이 결정 트리에 따라 처리되었는가? (STYLE-022)
- [ ] 스프레드 연산자가 허용 조건을 충족하는가? (STYLE-023)
- [ ] null/undefined가 의미에 맞게 사용되었는가? (STYLE-020)
- [ ] unknown이 경계 레이어에서만 사용되었는가? (STYLE-006)

### TypeScript 공식 문서 참조

- 문서: <https://www.typescriptlang.org/docs/>
- 패키지: `node_modules/typescript/lib/*.d.ts`
- 버전 확인: `bun info typescript`

## 에이전트 강제 검증 (Agent Enforcement)

에이전트는 코드 작성 **완료 후** 아래 검증을 **반드시** 수행한다(MUST).

### 검증 1: 타입 분리

구현 파일에서 type/interface 선언이 0개인지 확인:

```bash
grep -E "^(type|interface) " <구현파일> | wc -l  # 0이어야 함
```

### 검증 2: 반복 리터럴

동일 문자열 2회 이상 사용 확인 → 결정 트리(STYLE-022) 적용:

```bash
grep -oE "'[^']+'" <파일> | sort | uniq -c | sort -rn  # 2회+ 확인
```

### 검증 3: 스프레드 연산자

모든 `{ ...` 사용에 대해 허용 조건 충족 여부 확인:

```bash
grep -n "{ \.\.\." <파일>  # 각각 정당한 이유 있어야 함
```

### 검증 4: null vs undefined

null 반환이 "의도적 비어있음"을 의미하는지 확인. 불확실하면 undefined 사용.

### 검증 5: unknown

unknown 사용이 경계 레이어(외부 입력)인지 확인. 아니면 구체 타입으로 대체.

## 예제 코드 규칙

- 예제 코드는 해당 규칙을 **100% 준수**해야 한다(MUST).
- 예제 코드에서 규칙을 위반하면 STYLEGUIDE 자체가 위반이다(MUST).
- 예제 코드는 `types.ts`, `interfaces.ts` 분리를 반영해야 한다(MUST).
- 예제 내 주석은 규칙 설명 목적으로만 허용한다(MAY).

## 구현 우선순위 (Implementation Priority)

1. 1순위: Bun Native 기능
2. 2순위: Node.js Native 기능 (Bun 호환)
3. 3순위: 검증된 npm 패키지
4. 4순위: 직접 구현 (Custom)

## 핵심 규칙 요약 (Quick Reference)

| ID        | 규칙                                                 | 위반 예                   |
| --------- | ---------------------------------------------------- | ------------------------- |
| STYLE-001 | 파일명 `kebab-case` (예약 파일 제외)                 | `UserService.ts` ❌       |
| STYLE-002 | 한 글자 식별자 금지 (`i/j/k`, `_`, 제네릭 `T` 제외)  | `p`, `v`, `x` ❌          |
| STYLE-003 | 약어는 "승인+사전등록" 없이는 도입 금지              | 새 약어를 임의 도입 ❌    |
| STYLE-004 | 인라인 오브젝트 타입 **절대 금지** (익명 타입 포함)  | `{ a: number }` ❌        |
| STYLE-005 | type/interface **무조건 분리** (동일 파일 혼재 금지) | 구현 파일에 타입 선언 ❌  |
| STYLE-006 | `any`/`unknown` 경계 레이어 외 금지                  | 내부 레이어에 남겨둠 ❌   |
| STYLE-007 | Public 함수는 반환 타입 명시                         | 반환 타입 누락 ❌         |
| STYLE-008 | 선언/제어문 사이 빈 줄                               | `const x=1; if(...)` ❌   |
| STYLE-009 | Early return은 블록 형태                             | `if(x) return;` ❌        |
| STYLE-010 | 클래스는 `this` 필요 시만                            | Standalone Function 우선  |
| STYLE-011 | 로컬 상수 **금지** → 클래스 사용 권장                | `const LIMIT = 100;` ❌   |
| STYLE-012 | 제네릭: `T` 외 **무조건 의미 기반**                  | `T, K, V` (범용 외 금지)  |
| STYLE-013 | 테스트 파일도 **동일 규칙 적용**                     | 테스트 내 인라인 타입 ❌  |
| STYLE-014 | Shorthand Property **선호**                          | `{ local: localName }` ❌ |
| STYLE-015 | 함수 파라미터 **4개 초과** 시 interface화            | 5개+ 파라미터 함수 ❌     |
| STYLE-016 | 동일 리터럴 **2회+** 사용 시 상수/enum화             | `'module'` 반복 ❌        |
| STYLE-017 | 콜백 타입은 **type으로 별도 정의**                   | 인라인 `(x) => void` ❌   |
| STYLE-018 | 브래킷 표기법 금지 (`a['b']` → `a.b`)                | `node['type']` ❌         |
| STYLE-019 | `??`/`\|\|`/`? :` **엄격 구분**                      | 용도 혼동 ❌              |
| STYLE-020 | `null` vs `undefined` **엄격 구분**                  | 의미 혼동 ❌              |
| STYLE-021 | Enum 항목 `PascalCase`                               | `MODULE` ❌ → `Module` ✅ |
| STYLE-022 | 상수/enum/헬퍼 **결정 트리** 준수                    | 무분별한 상수화 ❌        |
| STYLE-023 | 스프레드 연산자 **엄격 제한**                        | 불필요한 `{...}` ❌       |

상세 규칙은 아래 각 섹션 참조.

## 6. 네이밍 규칙 (Naming Conventions, STYLE-001~003)

이 규칙은 "권장"이 아니다. 위반은 즉시 수정 대상이다.

|    대상    | 규칙                   | 예시                       | 비고                   |
| :--------: | :--------------------- | :------------------------- | :--------------------- |
|  디렉토리  | `kebab-case`           | `http-server`, `user-auth` |                        |
|  패키지명  | `kebab-case` (Scoped)  | `@bunner/http-server`      |                        |
|   파일명   | `kebab-case`           | `user-controller.ts`       |                        |
|   클래스   | `PascalCase`           | `UserController`           |                        |
| 인터페이스 | `PascalCase`           | `HttpRequest`              | `I` 접두사 금지        |
| 타입(Type) | `PascalCase`           | `UserResponse`             |                        |
| 함수/변수  | `camelCase`            | `getUser`, `isValid`       |                        |
|    상수    | `SCREAMING_SNAKE_CASE` | `MAX_CONNECTIONS`          | `const` assertion 권장 |
| Enum 이름  | `PascalCase`           | `UserRole`                 |                        |
| Enum 항목  | `PascalCase`           | `Admin`, `Guest`           | `ADMIN` ❌ (STYLE-021) |

### 6.1 예약 파일명 (Reserved Filenames)

이 프로젝트에는 “예외”가 아니라 **예약 파일명**이 존재한다.
예약 파일명은 역할(Contract/Facade/Meta)을 나타내는 표준 이름이며, 파일명 `kebab-case` 규칙의 적용 대상이 아니다.

예약 파일명(대표):

- `index.ts`: Barrel/Facade 파일
  - 패키지 루트 `index.ts`: Public Facade
  - `src/index.ts`: Internal Facade
  - `src/<feature>/index.ts`: Feature Barrel
- `constants.ts`: 상수 선언 파일
- `enums.ts`: enum 선언 파일
- `interfaces.ts`: interface(계약) 선언 파일
- `types.ts`: type(조합/alias) 선언 파일
- `*.spec.ts`: 테스트 파일
- `*.error.ts`: 에러 클래스 파일

위 예약 파일명이 아닌 “구현 파일”은 `kebab-case`를 강제한다.

### 6.2 식별자 명확성 규칙 (Identifier Clarity Rules)

이 섹션은 “취향”이 아니다. 애매한 네이밍은 코드 리뷰와 에이전트 집행에서
동일한 판정을 불가능하게 만들므로, 다음 규칙을 강제한다.

#### 6.2.1 한 글자 식별자 금지 (Single-letter Identifier Ban)

- 기본 규칙: 한 글자 식별자(`p`, `v`, `x`, `t`, `n` 등)는 금지한다(MUST NOT).
- 예외(허용): 아래 경우에만 허용한다(MAY).
  - 단순 인덱스 루프의 인덱스: `i`, `j`, `k`
    - 조건: 숫자 인덱스가 핵심이고 스코프가 루프 블록에 국한되며, 본문이 짧다.
  - 의도적으로 사용하지 않는 값: `_`, `_e`, `_err`, `_unused` 형태
    - 조건: "정말로 사용하지 않음"을 표현하는 경우에만 사용한다.
  - 제네릭 타입 파라미터: `T` (어떤 타입이든 허용할 때만)
    - 조건: 범용 타입을 받는 경우에만 허용. 그 외는 **무조건** 의미 기반 네이밍(MUST).
    - 예: `TInput`, `TOutput`, `TError` (에러 타입 명확할 때)
- 금지(예외 남용): 콜백 파라미터를 한 글자로 두는 행위는 금지한다(MUST NOT).
  - 예: `forEach((p) => ...)`, `map((v) => ...)`

#### 6.2.2 콜백 파라미터 네이밍 (Callback Parameter Naming)

- 콜백 파라미터는 데이터 의미를 드러내는 이름을 사용해야 한다(MUST).
  - 예: `provider`, `providerDef`, `moduleNode`, `entry`, `token`, `importItem`
- 컬렉션/반복 네이밍은 자연어 규칙을 따른다(MUST).
  - 배열/리스트는 기본값으로 **복수 명사**를 사용한다(MUST).
    - 예: `products`, `users`, `routes`
  - 순회 변수는 기본값으로 **단수 명사**를 사용한다(MUST).
    - 예: `product`, `user`, `route`
  - `*List`, `*Map` 같은 접미사는 “자료구조 의미”가 실제로 중요할 때만 허용한다(MAY).
    - 단순 나열/집합 의미라면 `products`처럼 자연어 복수형을 우선한다(MUST).
  - Map은 키 의미를 드러내는 이름을 사용한다(MUST).
    - 예: `productsById`, `userByEmail`
- 아래 중 하나라도 해당하면, 콜백 파라미터는 반드시 의미 기반 이름이어야 한다(MUST).
  - 콜백 바디가 1줄을 초과한다.
  - 파라미터에서 프로퍼티 접근이 발생한다(예: `provider.name`).
  - 콜백 스코프에서 파라미터가 2회 이상 사용된다.

#### 6.2.3 약어 도입 통제 (Abbreviation Introduction Control)

- 기본 원칙: 약어는 “승인 + 약어사전 등록” 없이는 도입할 수 없다(MUST NOT).
- 약어를 새로 도입하려면 아래 절차를 **반드시** 따른다(MUST).
  1. 사용자(프로젝트 오너)에게 명시 승인을 요청한다(MUST).
  2. 승인된 약어를 약어사전에 추가한다(MUST).
- 약어사전에 등록된 약어를 사용하는 것은 승인 없이 허용한다(MAY).
- 금지: “관습/상식/업계 표준”을 근거로 승인/등록 없이 약어를 도입하는 행위(MUST NOT).
- 프로젝트 기본 허용: `id`, `req`, `res`, `ctx`는 약어사전에 이미 등록된 것으로 간주한다(MAY).

## 7. Type / Interface / Enum 선택 기준 (Selection Criteria, STYLE-004~005)

### 7.1 Type vs Interface

- Interface: 아래 목적 중 하나라도 해당하면 Interface를 사용한다.
  - `implements`/`extends`가 설계의 일부인 “계약(Contract)” 타입(가장 우선). 구현 클래스가 계약을 **강제**해야 한다.
  - 데이터 스키마(요청/응답/저장/직렬화)처럼 “객체 형태”가 시스템 경계에 걸려 있고, 팀/도메인에서 **규격으로 유지**되어야 하는 구조.
    - 강제(MUST): 위와 같은 데이터 스키마/경계 계약(Object shape)은 `type X = { ... }`가 아니라 **반드시** `interface X { ... }`로 선언한다.
    - 예외: 유니온(`|`), 교차(`&`), 튜플, Alias 등 “조합/제약”이 핵심인 경우는 `type`을 사용한다.
  - (부수적) 확장 가능성이 핵심인 객체 구조.
- Type: 유니온(`|`), 교차(`&`), 튜플, Alias 등 “조합/제약”이 핵심이면 Type을 사용한다. 런타임 오브젝트를 남기지 않는 제로 오버헤드를 기본값으로 둔다.
- 금지: 기준 없이 Interface/Type을 혼용하지 마라. 애매하면 기본은 **Type**로 시작하고, “`implements` 강제” 또는 “스키마 규격화” 요구가 생길 때만 Interface로 승격한다.

### 7.2 Enum / Union Type / as const / const enum

- Enum(문서/규격): 시스템의 핵심 규격이거나 외부 표준 프로토콜을 따를 때만 사용한다. 기본은 문자열 Enum을 사용한다.
- Union Type(제로 오버헤드): 단순 값 범위 제약이면 Union Type을 사용한다(컴파일 후 런타임 객체를 남기지 않는 것을 우선한다).
- `as const`(룩업/순회): 런타임에서 값 목록을 순회하거나 룩업 테이블로 쓸 필요가 있을 때만 사용한다.
- `const enum`(최적화): 런타임 오브젝트를 없애면서도 이름을 남겨야 할 때만 예외적으로 사용한다.

## 8. 타입 정의 및 안전성 원칙 (STYLE-006~007)

1. 타입 정의 우선순위: TypeScript 자체 문법을 최우선으로 사용한다. 복잡한 유틸리티 타입은 “필요할 때만” 허용한다.
2. 타입 중복 최대 지양(강제):
   - 동일하거나 사실상 동일한 오브젝트 shape/type을 중복 선언하는 행위는 금지한다(MUST NOT).
   - 타입은 SSOT(단일 출처)로 정의하고, 변형/확장/축소가 필요하면 TypeScript 문법을 활용하여 **파생**한다(MUST).
   - 파생 타입 최대 깊이: 3단계를 초과할 수 없다(MUST NOT).
   - 파생 타입은 반드시 목적이 드러나는 의미 있는 이름을 가져야 한다(MUST).

3. Loose Type 사용 극단적 제한(강제):

- `any`: TypeScript로 **절대 표현할 수 없는 타입**인 경우에만 사용한다(MAY). 그 외 사용은 금지한다(MUST NOT).
- `unknown`: 아래 조건을 모두 만족할 때에만 예외적으로 허용한다(MAY). 그 외 사용은 금지한다(MUST NOT).
  - 허용 위치: 외부 IO 경계(HTTP/raw JSON/env/file/network) 또는 그와 동급의 “경계 레이어”에 한정한다(MUST).
  - 전파 금지: `unknown` 값을 다른 함수/메서드로 넘기거나, 구조 분해하거나, 프로퍼티 접근을 시도하는 행위는 금지한다(MUST NOT).
  - 잔존 금지: `unknown`은 **동일 함수(또는 동일 모듈)** 내에서 즉시 좁혀져야 한다(MUST). 파싱/검증/가드/Assertion Function을 통해 구체 타입으로 전환된 결과만 내부 레이어로 전달한다(MUST).
  - 저장 금지: `unknown`을 객체 필드/클래스 상태/캐시에 보관하는 행위는 금지한다(MUST NOT).
- `Record<string, any>`: 금지한다(MUST NOT). 필요한 경우 목적에 맞는 타입/인터페이스를 정의한다(MUST).

1. 명시적 반환 타입(강제): export 되는 모든 Public 함수/메서드는 반환 타입을 반드시 명시해야 한다.

2. TypeScript 문법 적극 활용(강제):

- TypeScript는 방대하고 강력한 문법을 제공한다.
- 구현은 TypeScript 공식 문서 및 프로젝트에 설치된 `typescript` 패키지(현재 버전)의 정의를 최우선 기준으로 삼아, 목적에 맞는 문법을 **적재적소에 적극 활용**해야 한다(MUST).
- 특정 문법/유틸리티 목록을 정답처럼 고정해 반복 사용하지 않는다(MUST NOT).
- 타입 단언, 인라인 오브젝트 타입, loose type로 문제를 덮는 행위는 금지한다(MUST NOT).

## 9. 코딩 품질 및 스타일 (Code Quality & Style, STYLE-008~013)

### 9.1 중복 코드 제거

- 중복은 허용하지 않는다(MUST NOT).
- 재사용이 필요하면 즉시 함수/모듈로 끌어올려 단일화한다(MUST).

### 9.2 단일 책임 파일 (STYLE-005)

- 한 파일에 Type/Class/Interface를 뒤섞는 것을 금지한다(MUST NOT).
- 구현 파일이 클래스(또는 함수) 구현을 담는 경우, 그 파일은 해당 책임의 구현만 담는다(MUST).
- 보조 타입(alias/interface)이 필요하면, 같은 feature의 `types.ts`/`interfaces.ts`에 둔다(MUST).
- 타입/인터페이스를 구현 파일에 남겨 두는 예외는 존재하지 않는다(MUST NOT).
- 판단이 애매하면, 임의로 섞지 말고 중단 후 확인한다(MUST).

### 9.3 예약 파일 강제 분리

- feature 단위 폴더는 아래 예약 파일로 책임을 분리한다(MUST):
  - `types.ts`, `interfaces.ts`, `enums.ts`, `constants.ts`
- 구현 파일은 예약 파일에 해당하는 선언을 포함할 수 없다(MUST NOT).
- 스코프/순환/가시성 문제는 Feature Barrel(`index.ts`) 또는 Facade 규칙으로 해결한다(MUST).

### 9.4 로컬 상수 금지 (STYLE-011)

- 구현 파일 내 로컬 스코프 상수(`const LIMIT = 100;` 등)는 금지한다(MUST NOT).
- 상수가 필요한 로직은 클래스 프로퍼티를 사용한다(SHOULD).
- 전역적으로 사용되는 상수만 `constants.ts`에 배치한다(MUST).

### 9.5 테스트 파일 규칙 (STYLE-013)

- 테스트 파일(`*.spec.ts`)도 동일 규칙을 적용한다(MUST).
- 테스트 파일 내 타입 인라인 선언은 금지한다(MUST NOT).
- 테스트용 타입은 테스트 폴더 내 `types.ts`/`interfaces.ts`에 배치한다(MUST).

### 9.6 인라인 오브젝트 타입 금지 (STYLE-004)

- 코드에 `{ a: number; b: number }` 같은 오브젝트 타입 리터럴을 직접 작성하는 것은 금지한다(MUST NOT).
- 오브젝트 shape는 항상 목적에 맞는 `type` 또는 `interface`로 정의해서 사용한다(MUST).

### 9.7 불변성 (Immutability)

- 인자로 받은 객체/배열은 변형하지 않는다(MUST NOT).
- `readonly`를 사용해 의도를 고정한다(SHOULD).

### 9.8 비동기 안전성 (Async Safety)

- Floating Promise(`await` 누락)는 금지한다(MUST NOT).
- 병렬 처리는 의도적으로 `Promise.all`을 사용한다(MUST).

### 9.9 문서화 (TSDoc)

- Public API는 예외 없이 TSDoc(`@param`, `@returns`)을 작성한다(MUST).

### 9.10 주석 (Comments)

- 다음을 제외한 모든 코멘트/주석은 금지한다(MUST NOT):
  - 허용: Public API TSDoc(외부 사용자에게 계약을 설명하는 목적)(MUST).
  - 허용: 안전/보안/정합성 위협을 직접 방지하기 위한 경고 주석(MAY).
- 금지: `// TODO`, `// FIXME`, 설명용 인라인 주석, 임시 디버그 주석.

### 9.11 파일 분해 (Granularity)

- "작게 쪼개는 것" 자체는 품질이 아니다.
- 파일 분해는 섹션 11의 기준을 만족해야 한다(MUST).

### 9.12 Deprecated 금지

- deprecated된 코드/파일을 남기지 않는다(MUST NOT).
- deprecated가 발생했다면, 그 작업 범위 내에서 완전 삭제(코드/파일 제거)까지 끝내야 한다(MUST).

### 9.13 코드 스타일 규칙 (STYLE-008~009)

이 규칙은 "취향"이 아니다. 예외는 없다.

- **선언 블록 분리 (STYLE-008)**: `const`/`let` 선언 라인과 `if`/`for`/`while`/`try` 같은 제어문 라인은 붙여 쓰지 않는다(MUST NOT). 사이에 빈 줄 1줄을 강제한다(MUST).
- **Early return 블록 (STYLE-009)**: 유효성/가드 조건은 가능한 한 빨리 실패로 종료한다(MUST).
  - 금지: one-line early return (예: `if (invalid) return ...;`)(MUST NOT)
  - 강제: 블록 형태로 작성한다(MUST).
- **호출 라인 그룹 규칙**: "값을 받는 호출"과 "단순 호출"은 붙여 쓰지 않는다(MUST NOT). 사이에 빈 줄 1줄을 강제한다(MUST).
- **로깅 라인 격리**: 로깅 블록의 앞/뒤에 빈 줄 1줄을 강제한다(MUST).
- **else 금지**: early return을 사용한 분기에는 `else`를 붙이지 않는다(MUST NOT).

예시(규칙 준수):

```ts
if (invalid) {
  return result;
}

const value = compute();

doSideEffect();

logger.info('a');
logger.info('b');

if (otherInvalid) {
  return other;
}
```

복잡 예시(규칙 준수 결과):

- 목표: 검증(가드) / 값-받는 호출 / 단순 호출 / 로깅 블록 / 외부 의존(목킹 대상) / 에러 처리까지 한 함수에 들어간 “현실적인” 서비스 함수.
- 관찰 포인트:
  - early return은 블록 형태로만 사용한다.
  - 선언 라인과 제어문 라인을 붙여 쓰지 않는다.
  - 값-받는 호출과 단순 호출을 붙여 쓰지 않는다.
  - 로깅 라인은 로깅끼리만 붙여 쓰고, 로깅 블록 전/후는 빈 줄로 분리한다.

프로덕션 코드 예시(규칙 준수 결과):

> 아래 예시는 파일 분리 구조(STYLE-005)를 반영합니다.

**types.ts** (type만 포함)

```ts
export type CurrencyCode = 'KRW' | 'USD';

export type LogMetadataValue = string | number | boolean;

export type LogMetadata = Readonly<Record<string, LogMetadataValue>>;
```

**interfaces.ts** (interface만 포함)

```ts
import type { CurrencyCode, LogMetadata } from './types';

export interface PaymentRequest {
  readonly userId: string;
  readonly amount: number;
  readonly currency: CurrencyCode;
}

export interface PaymentResult {
  readonly receiptId: string;
  readonly chargedAmount: number;
  readonly currency: CurrencyCode;
}

export interface ProcessPaymentParams {
  readonly req: PaymentRequest;
  readonly userRepo: UserRepository;
  readonly gateway: PaymentGateway;
  readonly logger: AuditLogger;
}

export interface PaymentGateway {
  charge(input: PaymentChargeInput): Promise<PaymentChargeResult>;
}

export interface PaymentChargeInput {
  readonly userId: string;
  readonly amount: number;
  readonly currency: CurrencyCode;
}

export interface PaymentChargeResult {
  readonly receiptId: string;
}

export interface AuditLogger {
  info(message: string, meta?: LogMetadata): void;
  warn(message: string, meta?: LogMetadata): void;
}

export interface UserRepository {
  exists(userId: string): Promise<boolean>;
}
```

**process-payment.ts** (구현만 포함, 타입 없음)

```ts
import { BunnerError } from '@bunner/common';
import type { PaymentRequest, PaymentResult, ProcessPaymentParams } from './interfaces';

export async function processPayment(params: ProcessPaymentParams): Promise<PaymentResult> {
  const { req, userRepo, gateway, logger } = params;

  ensurePaymentRequestIsValid(req);

  const userExists = await userRepo.exists(req.userId);

  if (!userExists) {
    throw new BunnerError('User not found');
  }

  logger.info('payment:charge:requested', { userId: req.userId, amount: req.amount, currency: req.currency });

  const receipt = await gateway.charge({
    userId: req.userId,
    amount: req.amount,
    currency: req.currency,
  });

  logger.info('payment:charge:succeeded', { userId: req.userId, receiptId: receipt.receiptId });

  return {
    receiptId: receipt.receiptId,
    chargedAmount: req.amount,
    currency: req.currency,
  };
}

function ensurePaymentRequestIsValid(req: PaymentRequest): void {
  if (req.userId.length === 0) {
    throw new BunnerError('Invalid userId');
  }

  if (!Number.isFinite(req.amount) || req.amount <= 0) {
    throw new BunnerError('Invalid amount');
  }
}
```

유닛 테스트 예시(규칙 준수 결과):

> 아래 예시는 테스트 파일도 파일 분리 규칙(STYLE-013)을 따릅니다.

**process-payment.spec.ts** (타입은 import)

```ts
import { describe, expect, it, mock } from 'bun:test';
import { BunnerError } from '@bunner/common';
import type { LogMetadata, PaymentChargeInput, PaymentChargeResult } from './interfaces';
import { processPayment } from './process-payment';

describe('processPayment', () => {
  it('should return receipt when valid payment request is provided', async () => {
    const exists = mock(async (_userId: string) => true);
    const charge = mock(async (_input: PaymentChargeInput): Promise<PaymentChargeResult> => ({ receiptId: 'r_123' }));
    const info = mock((_message: string, _meta?: LogMetadata) => {});
    const warn = mock((_message: string, _meta?: LogMetadata) => {});

    const result = await processPayment({
      req: { userId: 'u1', amount: 1000, currency: 'KRW' },
      userRepo: { exists },
      gateway: { charge },
      logger: { info, warn },
    });

    expect(exists).toHaveBeenCalledTimes(1);
    expect(charge).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ receiptId: 'r_123', chargedAmount: 1000, currency: 'KRW' });
  });

  it('should throw BunnerError when userId is empty string', async () => {
    const exists = mock(async (_userId: string) => true);
    const charge = mock(async (_input: PaymentChargeInput): Promise<PaymentChargeResult> => ({ receiptId: 'r_123' }));
    const info = mock((_message: string, _meta?: LogMetadata) => {});
    const warn = mock((_message: string, _meta?: LogMetadata) => {});

    await expect(
      processPayment({
        req: { userId: '', amount: 1000, currency: 'KRW' },
        userRepo: { exists },
        gateway: { charge },
        logger: { info, warn },
      }),
    ).rejects.toBeInstanceOf(BunnerError);

    expect(charge).toHaveBeenCalledTimes(0);
  });

  it('should throw BunnerError when amount is zero', async () => {
    const exists = mock(async (_userId: string) => true);
    const charge = mock(async (_input: PaymentChargeInput): Promise<PaymentChargeResult> => ({ receiptId: 'r_123' }));
    const info = mock((_message: string, _meta?: LogMetadata) => {});
    const warn = mock((_message: string, _meta?: LogMetadata) => {});

    await expect(
      processPayment({
        req: { userId: 'u1', amount: 0, currency: 'KRW' },
        userRepo: { exists },
        gateway: { charge },
        logger: { info, warn },
      }),
    ).rejects.toBeInstanceOf(BunnerError);

    expect(charge).toHaveBeenCalledTimes(0);
  });

  it('should throw BunnerError when user does not exist', async () => {
    const exists = mock(async (_userId: string) => false);
    const charge = mock(async (_input: PaymentChargeInput): Promise<PaymentChargeResult> => ({ receiptId: 'r_123' }));
    const info = mock((_message: string, _meta?: LogMetadata) => {});
    const warn = mock((_message: string, _meta?: LogMetadata) => {});

    await expect(
      processPayment({
        req: { userId: 'u1', amount: 1000, currency: 'KRW' },
        userRepo: { exists },
        gateway: { charge },
        logger: { info, warn },
      }),
    ).rejects.toBeInstanceOf(BunnerError);

    expect(charge).toHaveBeenCalledTimes(0);
    expect(info).toHaveBeenCalledTimes(0);
  });
});
```

## 10. 함수 및 메서드 설계 원칙 (Func/Method Design Principles, STYLE-010)

이 섹션은 “권장사항”이 아니다. 기준을 어기면 설계 결함이다.

### 10.1 원자성 (Atomicity)

1. 모든 함수/메서드는 단일 오퍼레이션만 수행한다.
2. 분기/예외/케이스가 늘어날수록 더 작은 단위로 쪼개라.
3. 공개 메서드(public)는 오케스트레이션만 하고, 세부 로직은 하위 단위로 내려보낸다.

### 10.2 Standalone Function vs Private Method 선택 기준 (절대 기준)

다음 중 **하나라도 YES**면, 기본값(Standalone Function)에서 벗어날 수 있다.

1. `this`(인스턴스 상태)를 읽거나 변경하는가?
2. DI로 주입된 의존성(예: logger, adapter, container)을 직접 사용해야 하는가?
3. 클래스의 불변식(invariant) 유지/검증이 핵심 책임인가?

위 3개가 전부 NO면, 기본값은 **Standalone Function**이다.

추가 규칙(강제):

- “나중에 확장될 수 있다”는 이유로 클래스를 선택하지 않는다(MUST NOT).
- 클래스를 도입/유지하는 변경은, 아래 체크리스트 중 최소 1개를 YES로 만들 수 있어야 한다(MUST).
  - `this`(인스턴스 상태)를 읽거나 변경한다.
  - DI로 주입된 의존성(예: logger, fs, resolver)을 직접 사용한다.
  - 클래스의 불변식(invariant) 유지/검증이 핵심 책임이다.
- 위 3개가 전부 NO인데도 클래스가 필요하다고 주장하려면, 중단 후 명시 승인을 받아야 한다(MUST).

#### A. Standalone Function (기본값)

- 조건: 상태/DI 의존이 없다. 입력을 받아 결과를 낸다.
- 배치: 해당 기능 모듈 내부 파일(또는 `utils.ts`)에 둔다.
- 규칙:
  - 테스트 가능한 순수 로직은 절대 클래스에 가두지 마라.
  - 같은 로직이 2곳에서 필요해지면 즉시 함수로 끌어올려 중복을 제거한다.

#### B. Private Class Method (필요할 때만)

- 조건: `this` 접근이 필요하거나, 공개 메서드의 원자성을 유지하기 위해 클래스 내부로 쪼개야 한다.
- 규칙:
  - `private` 메서드는 “공개 메서드 1개”를 보조하도록 좁게 유지한다.
  - 재사용되는 상황이면 즉시 Standalone Function으로 승격한다.

#### C. Public Instance Method

- 조건: 외부에서 호출되는 API(서비스/핸들러/오케스트레이터)다.
- 규칙:
  - 반환 타입을 반드시 명시한다.
  - TSDoc(`@param`, `@returns`)을 반드시 작성한다.
  - 내부 구현은 Standalone Function 또는 private method로 분해해 짧게 유지한다.

#### D. Static Method (최후의 수단)

- 기본 금지. 아래 경우에만 예외 허용:
  - Factory(생성) 패턴
  - 클래스 네임스페이스에 귀속된 순수 유틸리티(단, 재사용 가능하면 standalone function 우선)
  - 런타임 캐시 등 “정적 공유 상태”가 설계적으로 필요한 경우

## 11. 파일 분해/응집도 표준 (File Granularity Standard)

이 섹션은 “권장사항”이 아니다. **과도한 마이크로 파일 분해는 금지**이며, 아래 기준으로만 분해를 허용한다.

1. **기본 원칙: 파일은 ‘책임의 단위’다**
   - 파일 1개는 1문장으로 책임을 설명할 수 있어야 한다.
   - 그 1문장이 “그리고(and)”로 늘어나기 시작하면 분해 신호다. 반대로, 1문장이 지나치게 빈약하면(단순 위임/래핑) 합침 신호다.

2. **분해 허용 조건(아래 중 하나라도 충족해야 한다)**
   - **공개 API 경계**: 외부에 노출되는 안정적인 심볼(예: 데코레이터/어댑터/퍼블릭 팩토리)을 1파일 1심볼로 제공해야 한다.
   - **독립적 변경 이유**: 해당 파일이 다른 책임과 “변경 이유”가 분리되어 있고, 실제로 독립적으로 변경/리뷰/테스트될 수 있어야 한다.
   - **테스트 격리**: 테스트가 해당 파일의 동작을 직접 검증하며, 타 파일과 분리됨으로써 테스트가 더 결정적/명확해진다.
   - **순환 참조 차단**: 분해가 순환 의존을 방지하거나 import 방향을 단방향으로 고정하는 데 실질적으로 기여한다.
   - **재사용 경계**: 최소 2개 이상의 소비자가 있고(다른 파일/기능), 재사용 경계가 명확하다.

3. **분해 금지 패턴(발견 즉시 병합/정리)**
   - **무의미한 래핑**: 단순히 다른 함수를 호출만 하는 thin wrapper(로직 없음/분기 없음/변환 없음)는 분해 금지.
   - **LOC 절감 목적 분해**: “파일이 길어 보여서” 쪼개는 행위 금지. 분해는 책임/변경 이유/테스트 격리로만 정당화된다.
   - **과도한 공용화**: 재사용 근거 없이 `utils.ts`/`helpers.ts`로 던져 넣는 행위 금지.

4. **마이크로 파일(극소 단위) 가드레일**
   - 비테스트 코드가 **매우 작은 파일**(대략 20 LOC 미만)이고, **단일 함수/단일 상수 수준**이라면 기본값은 **병합**이다.
   - 예외는 아래 중 하나라도 명확히 충족할 때만 허용한다.
     - **Public Facade/Feature Barrel**: `index.ts`처럼 “관문 역할” 자체가 책임인 파일
     - **공개 API 경계**: 외부에 노출되는 안정적인 심볼을 1파일 1심볼로 고정해야 할 때
     - **테스트 격리**: 해당 파일 단위로 테스트가 직접 붙고, 분리로 인해 테스트가 더 결정적/명확해질 때
     - **재사용 경계**: 최소 2개 이상의 소비자가 있고, 이 파일이 재사용 단위로 유지되는 것이 자연스러울 때
   - 위 예외 근거가 약하면, “작아 보이니 쪼갠다”가 아니라 **기존 책임 파일로 합쳐서 관리한다.**

5. **스칼라 패키지 기준 해석(적용 예)**
   - 스칼라처럼 “퍼블릭 API(데코레이터 등)”를 **명시 export로 엄격히 통제**해야 하는 경우, 1파일 1심볼 분해는 허용된다.
   - 단, 새 파일을 추가할 때마다 11-2의 정당화 조건을 만족하지 못하면 분해는 금지다.

### 11.1 단일-심볼 파일(마이크로 파일) 추가 규칙 (Enforced)

- “단일 함수/상수 1개만 export”하는 신규 파일을 추가하려면, 11-2의 정당화 조건 중
  최소 1개를 **구체적 근거**로 충족해야 한다(MUST).
- 정당화가 없다면 기본값은 병합이다(MUST).
- 금지: 근거 없는 `utils.ts`/`helpers.ts`로의 덤핑(레거시 유지와 신규 확장은 구분되며,
  신규 확장은 금지다)(MUST NOT).

---

## 12. 추가 코드 품질 규칙 (STYLE-014~023)

### 12.1 Shorthand Property 선호 (STYLE-014)

- 변수명과 프로퍼티명이 일치하면 **shorthand 형태**를 사용한다(MUST).
- 일치하지 않으면 변수명을 프로퍼티명에 맞게 조정한다(SHOULD).

```typescript
// ❌ 금지
return { local: localName, exported: exportedName };

// ✅ 권장
const local = getString(localNode, 'name');
const exported = getString(exportedNode, 'name');
return { local, exported };
```

### 12.2 함수 파라미터 개수 제한 (STYLE-015)

- 함수 파라미터가 **4개를 초과**하면 interface로 묶는다(MUST).

```typescript
// ❌ 금지 (5개 파라미터)
function process(a: A, b: B, c: C, d: D, e: E): void {}

// ✅ 권장
interface ProcessParams {
  readonly a: A;
  readonly b: B;
  readonly c: C;
  readonly d: D;
  readonly e: E;
}
function process(params: ProcessParams): void {}
```

### 12.3 매직 스트링/넘버 상수화 (STYLE-016)

- 동일 리터럴이 **2회 이상** 사용되면 상수 또는 enum으로 추출한다(MUST).
- **분류 의미**가 있으면 `enum`, **단순 값**이면 `const`를 사용한다(MUST).

```typescript
// ❌ 금지
if (name === 'module') {
}
if (type === 'module') {
}

// ✅ 권장 (enum: 분류 의미 있을 때, 항목 PascalCase)
enum NodeName {
  Module = 'module',
  Provider = 'provider',
}

// ✅ 권장 (const: 단순 값)
const MODULE_NAME = 'module' as const;
```

### 12.4 콜백 타입 분리 (STYLE-017)

- 콜백/함수 타입은 **type으로 별도 정의**한다(MUST).
- 인라인 함수 시그니처는 금지한다(MUST NOT).

```typescript
// ❌ 금지
function process(callback: (value: number) => void): void {}

// ✅ 권장
type NumberCallback = (value: number) => void;
function process(callback: NumberCallback): void {}
```

### 12.5 브래킷 표기법 금지 (STYLE-018)

- 동적 키가 아닌 한 **점 표기법**을 사용한다(MUST).
- `a['b']` 형식은 금지한다(MUST NOT).

```typescript
// ❌ 금지
node['type'];
obj['property'];

// ✅ 권장
node.type;
obj.property;

// ✅ 예외: 동적 키
const key = 'dynamicKey';
obj[key];
```

### 12.6 Nullish 연산자 엄격 구분 (STYLE-019)

- `??`: `null`/`undefined`만 폴백
- `||`: falsy 전체(`false`, `0`, `''`, `null`, `undefined`) 폴백
- `? :`: 명시적 조건 분기

```typescript
// ✅ null/undefined만 처리
const value = input ?? defaultValue;

// ✅ falsy 전체 처리 (0, '' 포함)
const display = input || 'N/A';

// ✅ 명시적 분기
const result = isValid ? success : failure;
```

### 12.7 null vs undefined 엄격 구분 (STYLE-020)

- `undefined`: 값이 **없음** (기본값, 초기화 전)
- `null`: **의도적으로 비어있음** (명시적 할당)

```typescript
// ✅ undefined: 선택적 파라미터
function foo(value?: string): void {}

// ✅ null: 의도적으로 비어있음
const user: User | null = findUser(id); // 찾지 못함

// ❌ 혼용 금지
function bar(): string | null | undefined {} // 의미 불명확
```

### 12.8 Enum 항목 PascalCase (STYLE-021)

- Enum 항목은 `PascalCase`를 사용한다(MUST).
- `SCREAMING_SNAKE_CASE`는 금지한다(MUST NOT).

```typescript
// ❌ 금지
enum UserRole {
  ADMIN = 'admin',
  GUEST = 'guest',
}

// ✅ 권장
enum UserRole {
  Admin = 'admin',
  Guest = 'guest',
}
```

### 12.9 상수 vs Enum vs 헬퍼 결정 기준 (STYLE-022)

동일 리터럴이 2회 이상 사용될 때 아래 **결정 트리**를 따른다(MUST).

#### 결정 트리

1. **비교 조건**에서 사용되는가? (`===`, `!==`, `switch`)
   - NO → `const` 상수
   - YES → 2번으로

2. **비교 대상이 여러 개**인가? (같은 속성에 A, B, C 등)
   - YES → `enum`으로 그룹화
   - NO → 3번으로

3. **비교 로직이 복잡**한가? (여러 속성 조합, 조건 체인)
   - YES → 헬퍼 함수 (`isXxx()`)
   - NO → `const` 상수

#### 선택 기준표

| 조건                         | 선택                  |
| ---------------------------- | --------------------- |
| 비교 대상 1개, 단순 비교     | `const`               |
| 비교 대상 여러 개, 같은 범주 | `enum`                |
| 비교 로직 복잡, 재사용 필요  | 헬퍼 함수             |
| 타입 가드 필요               | 헬퍼 함수 (타입 가드) |

```typescript
// 상황: importKind === 'type' 반복

// ✅ enum (비교 대상 여러 개: type, value)
enum ImportKind {
  Type = 'type',
  Value = 'value',
}
if (importKind === ImportKind.Type) {
}

// ✅ 헬퍼 함수 (재사용, 가독성)
function isTypeImport(kind: string | undefined): boolean {
  return kind === ImportKind.Type;
}
if (isTypeImport(importKind)) {
}

// ❌ 단순 상수 (비교 대상 여러 개면 enum 우선)
const IMPORT_KIND_TYPE = 'type';
```

### 12.10 스프레드 연산자 엄격 제한 (STYLE-023)

스프레드 연산자(`{...}`, `[...]`)는 **메모리 할당**이 발생하므로 엄격히 제한한다(MUST).

#### 허용 조건 (하나 이상 충족 필수)

1. **반환값 보호**: 내부 상태를 반환할 때 외부 수정 방지
2. **불변성 필수**: 원본이 이후 **확실히** 수정됨
3. **스냅샷**: 특정 시점의 상태 캡처

#### 금지 조건

1. **원본 수정 없음**: 참조로 충분
2. **readonly 가능**: 타입 레벨 보호 가능
3. **즉시 버려짐**: 복사본이 바로 사용 후 버려짐

#### 판정 체크리스트

```text
스프레드 사용 전 확인:
[ ] 원본이 이후 수정되는가?
    NO → 스프레드 금지, 참조 사용
[ ] 반환값이 외부에서 수정될 수 있는가?
    NO → 스프레드 금지, readonly 사용
[ ] 스냅샷이 필요한가?
    NO → 스프레드 금지
```

```typescript
// ❌ 금지: 원본 수정 없음, 참조로 충분
classMeta.imports = { ...imports };

// ✅ 권장: 참조 사용
classMeta.imports = imports;

// ✅ 권장: readonly로 보호
classMeta.imports = imports as Readonly<typeof imports>;

// ✅ 허용: 반환값 보호 (this.currentImports가 이후 수정될 수 있음)
return { ...this.currentImports };

// ✅ 허용: 스냅샷 (원본이 이후 초기화됨)
const snapshot = { ...this.state };
this.state = {};
```
