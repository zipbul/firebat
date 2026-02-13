# Test Standards

## Layers

| Layer | Pattern | Location | SUT 경계 |
|-------|---------|----------|---------|
| Unit | `*.spec.ts` | 소스 옆 (colocated) | 단일 export (함수/클래스) |
| Integration | `*.test.ts` | `test/integration/` | 모듈 간 결합 |
| E2E | `*.e2e.ts` | `test/e2e/` | 프로세스 전체 |

```
Rule: TST-LAYER
Violation: 파일 확장자·위치가 위 테이블과 불일치
Enforcement: block
```

## Isolation (전 계층 공통 원칙)

SUT 경계 바깥의 모든 의존성은 mock/stub 대상이다.
SUT 경계 안의 모든 의존성은 실제 구현을 사용한다.
계층별로 SUT 경계만 달라지며, 격리 원칙은 동일하다.

- **Unit**: SUT = 단일 export. 그 함수/클래스가 호출하는 모든 외부 모듈·함수 = mock (DTO/Value Object 제외).
- **Integration**: SUT = 결합된 모듈 집합. 집합 내부 = real, 집합 바깥 = mock.
- **E2E**: SUT = 프로세스. 프로세스 내부 = real, 프로세스 바깥 = mock.

```
Rule: TST-ISOLATION
Violation: SUT 경계 바깥의 의존성이 mock/stub 없이 실행되거나,
          SUT 경계 안의 의존성이 mock 처리됨
Enforcement: block
```

```
Rule: TST-HERMETIC
Violation: I/O·시간·랜덤 등 비결정적 자원이 SUT 경계 안에서 mock 없이 사용됨 (E2E 제외)
Enforcement: block
```

```
Rule: TST-SIDE-EFFECT-SPY
Violation: SUT가 경계 밖 의존성에 side-effect(쓰기·삭제·전송 등)를 일으키는 호출을 하는데,
          해당 호출에 대한 spy 검증(호출 횟수·인자)이 없음
Enforcement: block
```

## Access Boundary

- **Unit**: SUT 내부 접근(white-box) 허용.
- **Integration / E2E**: 공개(exported) API만 사용.

비공개 멤버에 대한 테스트 접근이 필요할 경우, 소스 파일에서 `__testing__` 오브젝트를 통해 export한다.
테스트 코드가 unexported 멤버를 우회 접근(type assertion, dynamic property 등)하는 것은 금지한다.

```
Rule: TST-ACCESS
Violation: Integration/E2E 테스트가 unexported 멤버를 __testing__ export 없이 직접 접근
Enforcement: block
```

## Test Case Design

### 분기 커버리지 (Unit / Integration only)

SUT가 가진 모든 분기에 대응하는 it이 존재해야 한다.
분기는 if, else, switch/case, early return, throw, catch, 삼항 연산자(`? :`), 옵셔널 체이닝(`?.`), nullish coalescing(`??`)을 포함한다.
E2E에서는 적용하지 않는다. E2E는 핵심 경로(happy + 대표 error)만 검증한다.

```
Rule: TST-BRANCH
Applies to: Unit, Integration
Violation: SUT의 분기(if/else/switch/early return/throw/catch/삼항/?./??  포함)에 대응하는 it이 없음
Enforcement: block
```

### 입력 분할 (Unit / Integration only)

SUT 파라미터마다 동치 클래스(equivalence class)를 식별하고, 각 클래스에서 대표값 1개 + 경계값을 테스트한다.
E2E에서는 적용하지 않는다.

타입별 필수 케이스:

| 파라미터 타입 | 필수 it |
|-------------|--------|
| nullable (`T \| null \| undefined`) | null 입력, undefined 입력 |
| 배열 (`T[]`) | 빈 배열, 단일 요소, 복수 요소 |
| 문자열 (`string`) | 빈 문자열 |
| 숫자 (`number`) | 0, 음수 (해당되는 경우) |
| union / enum | 각 variant 최소 1개 |
| boolean | true, false |

```
Rule: TST-INPUT-PARTITION
Applies to: Unit, Integration
Violation: SUT 파라미터의 동치 클래스가 누락되어 테스트되지 않은 입력 영역이 존재하거나,
          위 타입별 필수 케이스가 해당됨에도 it이 없음
Enforcement: block
```

### 중복 금지

동일한 분기·동일한 동치 클래스를 검증하는 it이 2개 이상 존재하면 안 된다.
동치 클래스가 다르면 같은 분기를 통과하더라도 중복이 아니다.

```
Rule: TST-NO-DUPLICATE
Violation: 동일 분기·동일 동치 클래스에 대한 중복 it 존재
Enforcement: block
```

### 단일 시나리오

```
Rule: TST-SINGLE-SCENARIO
Violation: 하나의 it이 복수의 시나리오/분기를 검증
Enforcement: block
```

## E2E Constraints

```
Rule: TST-E2E-OUTPUT
Applies to: E2E
Violation: 출력 검증이 구조화된 데이터(exit code, JSON)가 아닌 로그 문자열·ANSI 파싱에 의존
Enforcement: block
```

```
Rule: TST-E2E-SCOPE
Applies to: E2E
Violation: E2E 테스트가 SUT의 모든 분기·동치 클래스를 개별 검증하려 함 (핵심 경로만 허용)
Enforcement: block
```

## Test Structure

```
Rule: TST-BDD
Violation: it 제목이 BDD 형식(should ... when ...)이 아님
Enforcement: block
```

```
Rule: TST-AAA
Violation: it 내부가 Arrange → Act → Assert 구조가 아님
Enforcement: block
```

```
Rule: TST-DESCRIBE-UNIT
Violation: Unit 테스트에서 describe 1-depth가 SUT 식별자가 아니거나,
          describe 제목이 "when "으로 시작
Enforcement: block
```

## Test Hygiene

```
Rule: TST-CLEANUP
Violation: 테스트가 생성한 리소스를 teardown에서 정리하지 않음
Enforcement: block
```

```
Rule: TST-STATE
Violation: 테스트 간 공유 mutable state 존재
Enforcement: block
```

```
Rule: TST-RUNNER
Violation: bun:test 외 러너 사용
Enforcement: block
```

```
Rule: TST-COVERAGE-MAP
Violation: 디렉토리에 *.spec.ts가 1개 이상 존재하고,
          같은 디렉토리에 대응 spec이 없는 *.ts가 존재
          (*.d.ts, *.spec.ts, *.test.ts, *.e2e.ts, index.ts, types.ts 제외)
Enforcement: block
```
