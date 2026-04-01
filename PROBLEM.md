# 디텍터 정확도 문제

firebat self-scan에서 발견된 false positive 의심 건.

## P-1. unobserved-variable — candidate 등록과 observation 판정의 불일치 (2225건)

**의도**: Promise 전용 탐지. 카탈로그 코드 `EF_UNOBSERVED_PROMISE_VARIABLE`, 메시지 "never awaited, .then()ed, or .catch()ed", cause 텍스트 "A Promise is assigned to a variable but never awaited..."

**문제**: candidate 등록이 의도와 맞지 않는다.

- **candidate 등록** (analyzer.ts:1180): `init.type === 'CallExpression'`이면 무조건 등록. Promise 여부 판별 없음. `path.join()`, `Bun.file()`, `arg.slice()` 같은 동기 함수도 전부 candidate가 된다.
- **observation 판정** (analyzer.ts:1189~1219): `await x`, `x.then/catch/finally()`, `fn(x)`, `return x` 4가지만 observed 처리. Promise 관찰 패턴에 맞게 설계됨.

**불일치**: candidate는 "모든 CallExpression 결과"를 등록하는데, observation은 "Promise 관찰 패턴"만 체크한다. 동기 함수 결과는 `.then()`이나 `await` 없이 `x.method()`로 사용하는 게 정상인데, 이걸 unobserved로 판정한다.

**해결 방향 (2가지)**:
1. candidate 등록 시 Promise 반환 함수만 필터 (gildash 타입 정보 활용)
2. observation 판정에 일반 사용 패턴 추가 (`x.prop`, `x.method()`, `y = x` 등)

**위치**: src/features/error-flow/analyzer.ts line 1175~1219

## P-2. dead-store — 외부 함수 안의 IIFE 내부 변수 false positive (14건 src/)

**현상**: `function outer() { (() => { const x = getX(); return x; })(); }` 에서 `x`가 dead-store 판정.

**재현 테스트로 확인된 사실**:
- 최상위 IIFE `const r = (() => { const x = ...; return x; })()` → 정상 (case C, D)
- 함수 안의 일반 arrow `function outer() { const fn = () => { const x = ...; return x; }; fn(); }` → 정상 (case I)
- **함수 안의 IIFE** `function outer() { (() => { const x = ...; console.log(x); })(); }` → **false positive** (case H)
- async 여부 무관. sync IIFE도 동일 문제 (case F)
- 변수 할당 여부 무관 (case H는 할당 없이도 발생)

**문제**: 외부 함수 안에서 IIFE가 있을 때, IIFE의 내부 함수가 waste-detector의 `visit` → `isFunctionNode` 체크로 잡혀 `analyzeFunctionBody`가 호출되는데, 이 분석에서 내부 변수의 use가 정상 추적되지 않음.

**근본 원인 확인됨**: `collectVariables`의 CallExpression 처리 (variable-collector.ts line 385~386).

```ts
if (unwrappedCallee !== null && isFunctionNode(unwrappedCallee)) {
  visit(unwrappedCallee, true, false);  // allowNestedFunctions = true 강제
}
```

IIFE의 callee가 function이면 `allowNestedFunctions`를 `true`로 강제해서 내부로 진입한다. IIFE를 "인라인된 코드"로 취급하려는 의도적 설계이지만, 이로 인해:

1. `collectLocalVarIndexes`가 IIFE 내부의 `const x`를 외부 함수 `outer`의 로컬 변수로 등록
2. `analyzeFunctionBody`가 `outer`의 CFG에서 `x`의 use를 찾지 못함 (CFG는 IIFE 안으로 들어가지 않음)
3. `x`가 dead-store로 판정

**불일치**: `collectVariables`는 IIFE 안으로 들어가서 변수를 수집하지만, CFG builder는 IIFE 안으로 들어가지 않아 use를 추적하지 못함. 수집과 추적의 범위가 다르다.

**위치**: src/engine/dataflow/variable-collector.ts line 385~386, src/engine/waste-detector-oxc.ts line 44~49

## P-3. variable-lifetime — 이동 불가 변수를 이동 대상으로 판정 (179건 src/)

**현상**: 179건 전부 lifetime > 100 lines. 함수 파라미터, accumulator, 클로저 캡처 변수 등 이동 불가능한 것들이 대다수.

**확인된 사실**:
- `nesting/analyzer.ts`: `functionNode`, `filePath`, `sourceText`, `parent` — 전부 함수 파라미터. 이동 불가.
- `nesting/analyzer.ts`: `cognitiveComplexity`, `maxDepth` — accumulator. 함수 시작에서 초기화, 내부 클로저에서 누적, 끝에서 사용. 이동 불가.
- `scan.usecase.ts`: `options`(파라미터), `logger`(파라미터에서 추출) — 함수 전체에서 사용. 이동 불가.
- 79건이 `scan.usecase.ts` 하나에 집중 (1252줄짜리 함수).

**전수 확인 결과 (179건)**:
- parameter (이동 불가): 23건 (12.8%)
- immovable — accumulator, 클로저 캡처, 조건부 재할당 등: 145건 (81.0%)
- movable (진짜 이동 가능): 11건 (6.1%)

**디텍터 버그다.** 94%가 이동 불가능한 것을 잡고 있다. 테스트가 파라미터를 잡도록 기대하지만 (analyzer.spec.ts line 431~447), 테스트도 잘못된 거다.

**수정 방향**: finding 생성 시 (analyzer.ts line 832~867) 다음을 필터링:
1. 파라미터 제외 — `paramBindings`로 판별 가능
2. 클로저 캡처 변수 제외 — `collectVariables(includeNestedFunctions: true/false)` 비교로 판별 가능
3. multi-def accumulator 제외 — `defCount > 1`인 varIndex의 def 제외
4. 이동해도 threshold 이하로 안 줄어드는 것 제외 — firstUseOffset 계산하여 `lastUse - firstUse > threshold`면 skip

테스트도 수정 필요: 파라미터 finding 기대 → 0건으로 변경.

**위치**: src/features/variable-lifetime/analyzer.ts line 829~866, src/features/variable-lifetime/analyzer.spec.ts

## P-4. early-return — else-if 체인 말단이 invertible-if-else로 감지 (수정 완료)

**현상**: `if (...) { } else if (...) { } else { return; }` 에서 마지막 `else if (...) { } else { return; }` 부분이 invertible-if-else로 잡힘.

**근본 원인**: else-if 체인의 sub-IfStatement를 `skipNodes`에 추가하는 로직이 cascade-guard 감지 성공 시에만 동작했음. cascade-guard가 감지 안 되면 체인 말단이 독립적인 invertible-if-else로 잡힘.

**수정**: `skipNodes`에 else-if 체인의 모든 sub-IfStatement를 cascade-guard 감지 여부와 무관하게 추가.

**위치**: src/features/early-return/analyzer.ts line 443~496
