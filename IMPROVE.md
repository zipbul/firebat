# IMPROVE.md — 기존 디텍터 품질 개선 계획

> 목적: 기존 16개 디텍터의 **버그 수정 + 누락 패턴 보완 + 설계 결함 재작업** 상세 계획.
>
> 원칙:
> - 각 항목은 **현 구현 코드 기준** 분석이다 (경로, 함수명, 라인 범위 명시).
> - 우선순위: P0(버그) → P1(설계 결함) → P2(고영향 패턴) → P3(가치 추가).
> - **구현 비용을 고려하지 않는다.** 항상 최적 알고리즘·최대 정밀도를 선택한다.
> - oxlint 중복 기능은 **보류**한다. 추후 lint 규칙을 off 하는 방향으로 해결한다.

---

## P0 — 버그 수정 (틀린 결과를 내는 코드)

### P0-1. dependencies: 사이클 탐지 누락

**파일**: `src/features/dependencies/analyzer.ts` — `walkCycles()`

**현상**: DFS에서 `visited` set이 대체 경로를 차단한다.

```
A → B → C → A  (사이클 1: 발견됨)
A → D → C → A  (사이클 2: 놓침)
```

1차 경로에서 C를 `visited`에 추가한 뒤, 2차 경로(D→C)에서 C가 `visited`에 있어 즉시 리턴.
C→A 역방향 edge가 탐색되지 않으므로 사이클 2가 누락된다.

**수정 방안**: **Tarjan SCC + Johnson's elementary circuit enumeration**.

2단계 알고리즘:

```
Step 1 — Tarjan SCC (O(V+E)):
  - 전체 모듈 dependency graph에 대해 Tarjan's strongly connected components 실행
  - 각 SCC를 식별. |SCC| = 1이면 자기 참조만 확인, |SCC| ≥ 2이면 사이클 존재

Step 2 — Johnson's algorithm (각 SCC 내부):
  - SCC 내부의 모든 elementary circuit을 열거
  - 출력 cap: SCC 당 최대 100개 사이클 경로 (무한 열거 방지)
  - 각 사이클을 정규화(최소 노드를 시작점으로 rotate)하여 dedup
```

**왜 Tarjan + Johnson인가**:
- Tarjan SCC는 O(V+E)로 최적. 모든 SCC를 한 번에 식별.
- Johnson's는 SCC 내부에서 O((V+E)(C+1)) (C=사이클 수). SCC가 작으면 매우 빠름.
- 기존 DFS + visited는 O(V+E)이지만 **불완전**. visited 제거(Option A)는 최악 O(V!)로 폭발.
- SCC 크기가 큰 경우(>50 모듈) 사이클 열거 cap으로 안전하게 제한.

**구현 상세**:

```ts
// 새 파일 또는 analyzer.ts 내부

interface SccResult {
  components: ReadonlyArray<ReadonlyArray<string>>; // 각 SCC의 모듈 목록
}

const tarjanScc = (graph: ReadonlyMap<string, ReadonlyArray<string>>): SccResult => {
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const components: string[][] = [];

  const strongconnect = (v: string): void => {
    indices.set(v, index);
    lowlinks.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    for (const w of graph.get(v) ?? []) {
      if (!indices.has(w)) {
        strongconnect(w);
        lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!));
      } else if (onStack.has(w)) {
        lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(w)!));
      }
    }

    if (lowlinks.get(v) === indices.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      components.push(component);
    }
  };

  for (const v of graph.keys()) {
    if (!indices.has(v)) strongconnect(v);
  }

  return { components };
};

const johnsonCircuits = (
  scc: ReadonlyArray<string>,
  graph: ReadonlyMap<string, ReadonlyArray<string>>,
  maxCircuits: number,
): string[][] => {
  // Johnson's algorithm implementation
  // Returns elementary circuits within the SCC, capped at maxCircuits
};
```

**성능 영향**: Tarjan SCC는 기존 DFS와 동일한 O(V+E). Johnson's는 SCC 크기에 비례하나 cap으로 제한. 전체적으로 기존 대비 동등 또는 약간 느림 (cap 내에서).

**영향 범위**: `walkCycles`, `detectCycles` 함수 교체. `DependencyAnalysis.cycles` 타입 유지.
**테스트**: `test/integration/dependencies/` 에 다중 경로 사이클 fixture 추가.
- `multi-path-cycle/`: A→B→C→A, A→D→C→A — 두 사이클 모두 보고
- `large-scc/`: 10+ 모듈 SCC — cap 내 열거 확인

---

### P0-2. api-drift: expression-body arrow의 returnKind 오분류

**파일**: `src/features/api-drift/analyzer.ts` — `buildShape()`

**현상**: `(x: number) => x * 2`의 body는 BlockStatement가 아닌 expression이다.
`collectReturnStats()`는 body를 walkOxcTree로 순회해 `ReturnStatement`를 찾는데,
expression body에는 ReturnStatement가 없으므로 `hasReturn=false`, `hasReturnValue=false`.
결과: `returnKind = 'implicit-void'`. **실제로는 값을 반환한다.**

**수정 방안**:

`buildShape()` 에서 body 분석 전에 expression body 여부를 먼저 판별한다.

```
const bodyValue = node.body;
if (isOxcNode(bodyValue) && bodyValue.type !== 'BlockStatement') {
  // expression body — always returns a value
  returnKind = 'value';
} else {
  // block body — existing collectReturnStats logic
}
```

**성능 영향**: 없음 (조건 분기 추가만).
**영향 범위**: `buildShape` 함수만. 리턴 타입 변경 없음.
**테스트**: `(x) => x`, `(x) => ({ key: x })`, `() => void 0` 케이스 추가.

---

### P0-3. unknown-proof: `as const` false positive

**파일**: `src/features/unknown-proof/candidates.ts` — type assertion 수집 로직

**현상**: `{ key: "value" } as const`가 type assertion으로 보고된다.
`as const`는 type assertion이 아니라 const assertion이며, 타입 안전성을 높인다.

**수정 방안**:

type assertion 수집 시, `TSAsExpression` 노드의 `typeAnnotation`이 `TSTypeReference`이고
그 `typeName`이 `const`인 경우를 제외한다.

```
if (node.type === 'TSAsExpression') {
  const typeAnn = node.typeAnnotation;
  if (isOxcNode(typeAnn) && typeAnn.type === 'TSTypeReference') {
    const typeName = typeAnn.typeName;
    if (isOxcNode(typeName) && typeName.type === 'Identifier' && typeName.name === 'const') {
      return; // const assertion — safe
    }
  }
  // 기존 type assertion 보고 로직
}
```

**사전 작업**: oxc-parser에서 `as const`의 정확한 AST 구조를 파싱 테스트로 확인.
**성능 영향**: 없음.
**테스트**: `const x = { a: 1 } as const` → finding 0개. `x as string` → finding 유지.

---

### P0-4. oxc-fingerprint: separator 충돌로 fingerprint 오매칭

**파일**: `src/engine/oxc-fingerprint.ts` — `createOxcFingerprintCore()`

**현상**: `diffs.join('|')`로 fingerprint 문자열을 합성한다.
AST 노드 값(문자열 리터럴, 타입 이름 등)에 `|`가 포함되면
서로 다른 코드가 동일한 fingerprint를 생성할 수 있다.

예: `f("a|b", "c")` vs `f("a", "b|c")` → `diffs = ["a|b", "c"]` vs `["a", "b|c"]`
→ 두 경우 모두 `join('|')` = `"a|b|c"` → **같은 fingerprint**.

**수정 방안**:

separator를 일반 문자열에 절대 나타나지 않는 문자로 변경:

```
// 변경 전
return diffs.join('|');

// 변경 후
return diffs.join('\x00'); // NUL character — 소스 코드에 나타나지 않음
```

또는 각 diff를 length-prefix 방식으로 인코딩:

```
return diffs.map(d => `${d.length}:${d}`).join('');
// "3:a|b1:c" vs "1:a3:b|c" → 다른 fingerprint
```

**권장**: `'\x00'` separator. 간결하고 충돌 불가.

**성능 영향**: 없음 (문자 변경만).
**영향 범위**: `createOxcFingerprintCore` 내부. 캐시 무효화 필요 (fingerprint 값 변경).
**테스트**: `|` 포함 문자열 리터럴 2개가 서로 다른 fingerprint 생성 확인.

---

## P1 — 설계 결함 재작업 (현재 형태로 가치 없거나 노이즈 과다)

### P1-1. api-drift: 전역 이름 그루핑 제거

**파일**: `src/features/api-drift/analyzer.ts` — `analyzeApiDrift()`, `recordShape()`, `buildGroups()`

**현상**: 모든 파일의 모든 함수를 **bare name**으로 전역 그루핑한다.
`get`, `create`, `handle`, `process`, `validate` 등 흔한 이름은 서로 무관한 함수들이
하나의 그룹에 묶여 95% 이상 false positive를 생산한다.

**재설계 방안**:

그루핑 전략을 **스코프 기반 + 접두사 패밀리**로 일괄 변경:

```
1. per-file 그루핑:
   - recordShape()에 filePath를 key에 포함
   - 같은 파일 내 함수들끼리만 shape 비교

2. per-class 그루핑:
   - MethodDefinition은 parent class name을 key에 포함
   - "MyService.get"과 "YourService.get"은 별도 그룹

3. 접두사 패밀리 그루핑:
   - 함수명에서 접두사 추출 (camelCase split 기준 첫 단어)
   - "create" 패밀리: createUser, createOrder → 같은 param 패턴 기대
   - threshold: 같은 접두사가 ≥3개 존재할 때만 그루핑
   - 파일 경계를 넘어서도 같은 접두사면 비교 (의도적)

4. 인터페이스 구현체 비교 (tsgo 기반):
   - 같은 인터페이스를 구현하는 클래스들의 메서드 shape 비교
   - tsgo hover로 implements 관계 확인
```

**성능 영향**: 그루핑 수 증가 → 비교 횟수 감소 (그룹 크기 ↓). 전체적으로 빨라짐.
**P0-2 수정과 동시 적용** (같은 파일 수정).
**테스트**:
- `test/integration/api-drift/global-name-fp/`: `get()` 함수가 5개 파일에 있어도 finding 0개
- `test/integration/api-drift/class-method/`: 같은 클래스 내 `getUser(id)` vs `getOrder(id, options)` → finding 1개
- `test/integration/api-drift/prefix-family/`: `createUser(name)`, `createOrder(name)`, `createProduct(name, price)` → finding 1개 (price 불일치)

---

### P1-2. duplicates: exact + structural 통합 + 타겟 정비

**파일들**:
- `src/engine/duplicate-detector.ts` — `isDuplicateTarget`, `detectDuplicates`
- `src/engine/duplicate-collector.ts` — `collectDuplicateGroups`
- `src/engine/oxc-fingerprint.ts` — `createOxcFingerprint`, `createOxcFingerprintShape`
- `src/features/exact-duplicates/detector.ts`
- `src/features/structural-duplicates/analyzer.ts`

**현상 1**: "exact" 디텍터가 실제로는 Type-2 (identifier-renamed) 탐지. 진짜 Type-1 없음.
**현상 2**: exact와 structural의 유일한 차이는 리터럴 포함 여부. 코드 99% 중복.
**현상 3**: `BlockStatement`가 타겟에 포함 → 함수 body와 함수 자체가 이중 그룹 생성.
**현상 4**: `isDuplicateTarget`에 `ClassExpression` 누락.
**현상 5**: `TSInterfaceDeclaration`이 `structural-duplicates/analyzer.ts`의 타겟에 누락.

**재설계 방안**:

하나의 통합 clone detector로 재구성. **3개 모드**:

| 모드 | Identifier 처리 | Literal 처리 | 클론 유형 |
|------|-----------------|-------------|----------|
| `type-1` (exact) | **유지** | **유지** | 완전 동일 코드 |
| `type-2` (renamed) | `$ID`로 치환 | **유지** | 현재 "exact" 동작 |
| `type-2-shape` (structural) | `$ID`로 치환 | `'literal'`로 치환 | 현재 "structural" 동작 |

**타겟 목록 정비** (`isDuplicateTarget`, `auto-min-size.ts`, `structural analyzer` 공통):

```
포함:
  FunctionDeclaration, FunctionExpression, ArrowFunctionExpression,
  ClassDeclaration, ClassExpression,
  MethodDefinition,
  TSTypeAliasDeclaration, TSInterfaceDeclaration

제거:
  BlockStatement (함수 body와 이중 카운트)
```

**구현 상세**:

```
Step 1: oxc-fingerprint.ts
  - createOxcFingerprintCore에 includeIdentifierNames 옵션 추가
  - includeIdentifierNames=true → Identifier.name 유지 (Type-1)
  - 3개 export: createOxcFingerprintExact, createOxcFingerprint, createOxcFingerprintShape
  - separator를 '\x00'으로 변경 (P0-4 동시 적용)

Step 2: isDuplicateTarget 통합
  - BlockStatement 제거, ClassExpression 추가
  - 모든 사용처 동기화: duplicate-detector.ts, auto-min-size.ts, structural analyzer

Step 3: Feature 레이어
  - exact-duplicates: Type-1 모드 사용
  - structural-duplicates: Type-2-shape 모드 사용
  - DuplicateGroup에 cloneType: 'type-1' | 'type-2' | 'type-2-shape' 필드 추가

Step 4: 파라미터화 diff 보고 (P3-9 연동)
```

**성능 영향**: 모드 통합으로 코드 단순화. fingerprint 계산 횟수 변화 없음.
**테스트**:
- `test/integration/exact-duplicates/block-statement-dedup/`: BlockStatement 이중 카운트 해소 확인
- `test/integration/exact-duplicates/class-expression/`: `const A = class { ... }` 클론 감지
- `test/integration/structural-duplicates/interface/`: 동일 구조 TSInterfaceDeclaration 감지

---

### P1-3. coupling: 실제 메트릭 구현

**파일**: `src/features/coupling/analyzer.ts` (50줄)

**현상 1**: fan-in + fan-out 합산만 수행. dependencies와 분석적 차이 없음.
**현상 2**: `fanInTop` / `fanOutTop`(상위 10개)만 사용 → 11번째 이하 모듈의 결합도를 아예 모름.

**재설계 방안**: 전체 dependency graph를 입력받아 Robert C. Martin 패키지 메트릭을 계산한다.

```
analyzeCoupling(dependencies: DependencyAnalysis): CouplingAnalysis {
  // 전체 모듈 목록을 순회 (top-10 아닌 전체)
  for (각 모듈 m) {
    Ca = 모듈 m을 import하는 모듈 수 (afferent coupling)
    Ce = 모듈 m이 import하는 모듈 수 (efferent coupling)
    I  = Ce / (Ca + Ce)  // Instability: 0=안정, 1=불안정

    // Abstractness: 내보낸 심볼 중 interface/abstract class 비율
    A  = (interface + abstract class 수) / (전체 export 수)
    // Distance from Main Sequence
    D  = |A + I - 1|     // 0=이상적, 1=최악

    hotspot 판정:
    - D > 0.7                       → "off-main-sequence"
    - I > 0.8 && Ce > 5             → "unstable-module"
    - I < 0.2 && Ca > threshold*    → "rigid-module"
    - Ca > threshold* && Ce > threshold* → "god-module"
    - 양방향 결합 (cycles에서 length=2) → "bidirectional-coupling"
  }

  * threshold는 프로젝트 규모에 비례하여 동적 계산:
    godModuleThreshold = Math.max(10, Math.ceil(totalModules * 0.1))
    rigidThreshold = Math.max(10, Math.ceil(totalModules * 0.15))
}
```

**CouplingHotspot 타입 확장**:

```ts
interface CouplingHotspot {
  module: string;
  score: number;
  signals: string[];
  metrics: {
    fanIn: number;          // Ca
    fanOut: number;         // Ce
    instability: number;    // I = Ce/(Ca+Ce)
    abstractness: number;   // A = abstract exports / total exports
    distance: number;       // D = |A + I - 1|
  };
  why: string;
  suggestedRefactor: string;
}
```

**입력 변경**: `analyzeCoupling`이 `fanInTop`/`fanOutTop` 대신 **전체 dependency graph** (`DependencyAnalysis.adjacency` 또는 equivalent)를 받도록 변경. `scan.usecase.ts`의 호출부도 수정.

**성능 영향**: 전체 모듈 순회이므로 O(V+E). 기존 top-10보다 약간 느리지만 무시할 수준.
**테스트**:
- `test/integration/coupling/instability/`: I=0, I=0.5, I=1.0 정확성
- `test/integration/coupling/distance/`: Zone of Pain (D>0.7, A=0, I=0.1), Zone of Uselessness (D>0.7, A=1.0, I=0.9)
- `test/integration/coupling/god-module/`: 모듈 수 대비 동적 threshold 테스트

---

### P1-4. lint/format: 경로·config 인식 + 테스트 커버리지

**파일들**:
- `src/features/lint/analyzer.ts` — `analyzeLint()`
- `src/features/format/analyzer.ts` — `analyzeFormat()`
- `src/infrastructure/oxlint/oxlint-runner.ts` — `runOxlint()`
- `src/infrastructure/oxfmt/oxfmt-runner.ts` — `runOxfmt()`
- `src/application/scan/scan.usecase.ts` — `resolveToolRcPath()`

**현상 1**: 통합 테스트가 0건. `test/integration/` 에 lint/, format/ 디렉토리 자체가 없음.
**현상 2**: `oxfmt --check` 결과에서 `fileCount`를 `rawStdout.split('\n').filter(...)` 로 파싱 — oxfmt 버전에 따라 출력 형식이 변경되면 깨짐.
**현상 3**: `tryResolveLocalBin`이 global fallback으로 다른 버전의 oxlint/oxfmt를 발견할 수 있으나, 해당 버전과 config 포맷의 호환성을 검증하지 않음.

**수정 방안**:

**config 정책**: config 파일명은 `.oxlintrc.jsonc`, `.oxfmtrc.jsonc`로 강제한다. 프로젝트 루트(`rootAbs`)에서만 탐색한다. 상위 디렉토리 탐색 없음.

```
1. 통합 테스트 추가:
   test/integration/lint/
     config-found/        — .oxlintrc.jsonc가 rootAbs에 있을 때 정상 동작
     config-missing/      — .oxlintrc.jsonc 없을 때 --config 미전달 확인
     binary-missing/      — oxlint 바이너리 없을 때 status='unavailable'
     diagnostics-parse/   — JSON 출력 정상 파싱 (다양한 형식)
     fix-mode/            — --fix 모드 동작

   test/integration/format/
     config-found/        — .oxfmtrc.jsonc가 rootAbs에 있을 때
     config-missing/      — 없을 때
     binary-missing/      — unavailable 상태
     check-mode/          — --check exit code 해석
     write-mode/          — --write 동작

2. oxfmt stdout 파싱 강건화:
   - rawStdout 라인 카운트 대신, exit code만으로 판단
   - exitCode === 0 → 'ok', exitCode !== 0 → 'needs-formatting'
   - fileCount는 보조 정보로만 사용, 파싱 실패 시 undefined

3. 바이너리 버전 로깅:
   - 최초 resolve 시 `oxlint --version` / `oxfmt --version` 실행
   - 버전 문자열을 debug 로그에 기록
   - 호환 가능 최소 버전 상수 정의 (위반 시 warning)
```

**성능 영향**: 테스트 추가만. 런타임 변경은 stdout 파싱 제거(미미)와 최초 버전 체크(1회성).
**영향 범위**: `format/analyzer.ts` (fileCount 로직), `oxlint-runner.ts`/`oxfmt-runner.ts` (버전 로깅), 신규 테스트 파일들.

---

## P2 — 고영향 누락 패턴 (가장 흔한 실제 코드 문제)

### P2-1. early-return: if/else 불균형 분기 감지

**파일**: `src/features/early-return/analyzer.ts` — `analyzeFunctionNode()`

**현상**: 가장 흔한 early-return 리팩토링 기회를 놓친다:

```ts
function process(input: Data) {
  if (input.isValid) {
    // ... 30줄 ...
    return result;
  } else {
    return null;  // ← 짧은 분기
  }
}
```

현재 가드절 감지 조건: `depth === 0 && alternate === null/undefined && consequent가 single return`.
**else가 있으면 감지 안 됨.**

**수정 방안**:

새로운 감지 규칙 — `invertible-if-else`:

```
조건:
  1. IfStatement가 함수 body 최상위(depth=0)에 있다
  2. consequent와 alternate가 모두 존재한다
  3. 한쪽 분기의 statement count ≤ 3이고 return/throw로 끝난다
  4. 다른 쪽 분기의 statement count ≥ 짧은 쪽의 2배

액션:
  - 짧은 분기를 early exit로 반전 → nesting depth -1
  - finding kind: 'invertible-if-else'
  - message에 각 분기 statement count 포함
```

**보조 함수**:
- `countStatements(node)` — BlockStatement.body.length 또는 단일 문이면 1
- `endsWithReturnOrThrow(node)` — 마지막 statement가 ReturnStatement 또는 ThrowStatement

**성능 영향**: 없음 (기존 순회에 조건 추가만).
**테스트**: `test/integration/early-return/imbalanced-if-else/` — 불균형 fixture, 양쪽 동일 길이 시 finding 없음.

---

### P2-2. early-return: throw를 guard clause로 인식

**파일**: `src/features/early-return/analyzer.ts` — `isSingleReturnBlock()`

**현상**: `if (!input) { throw new Error("..."); }` — throw는 guard clause이나 인식 안 됨.

**수정 방안**:

`isSingleReturnBlock`을 `isSingleExitBlock`으로 확장:

```
const isSingleExitBlock = (value: NodeValue): boolean => {
  if (!isOxcNode(value)) return false;
  if (value.type === 'ReturnStatement' || value.type === 'ThrowStatement') return true;
  if (value.type !== 'BlockStatement') return false;
  if (!isNodeRecord(value)) return false;
  const body = value.body;
  if (!Array.isArray(body) || body.length !== 1) return false;
  const only = body[0];
  return isOxcNode(only) && (only.type === 'ReturnStatement' || only.type === 'ThrowStatement');
};
```

**성능 영향**: 없음.
**테스트**: `if (!x) { throw new Error(); }` → hasGuardClauses = true.

---

### P2-3. early-return: depth > 0 guard clause (loop body)

**파일**: `src/features/early-return/analyzer.ts` — `analyzeFunctionNode()`

**현상**: guard clause 감지가 `depth === 0`에서만 동작. loop body 내부 패턴을 놓친다:

```ts
for (const item of items) {
  if (item.skip) {        // ← guard clause (continue)
    continue;
  }
  // ... 20줄 처리 ...
}
```

**수정 방안**:

depth > 0에서 `ContinueStatement`와 `BreakStatement`도 guard clause로 인식:

```
if (depth > 0 && node.type === 'IfStatement' && alternate === null) {
  if (isSingleContinueOrBreakBlock(consequent)) {
    hasGuardClauses = true;
    guardClauseCount++;
  }
}
```

`isSingleContinueOrBreakBlock`:
```
const isSingleContinueOrBreakBlock = (value: NodeValue): boolean => {
  if (!isOxcNode(value)) return false;
  if (value.type === 'ContinueStatement' || value.type === 'BreakStatement') return true;
  if (value.type !== 'BlockStatement') return false;
  // ... BlockStatement 내 단일 continue/break 확인
};
```

**finding kind**: `'loop-guard-clause'` — 기존 `'guard-clause'`와 구분.

**성능 영향**: 없음.
**테스트**: `for` loop 내 `if (cond) continue;` + 긴 후속 코드 → finding 감지.

---

### P2-4. waste: 클로저 캡처 인지 (false positive 방지)

**파일**: `src/engine/waste-detector-oxc.ts` — `collectLocalVarIndexes()`, `analyzeFunctionBody()`

**현상**: `includeNestedFunctions: false`로 변수 수집 → nested function에서만 읽히는 변수가 "미사용"으로 오보.

```ts
function setup() {
  let count = 0;                    // ← dead-store로 오보
  const increment = () => count++;  // ← 이 read가 무시됨
  return increment;
}
```

**수정 방안**: 2단계 정밀 분석.

```
Step 1: 기존 분석 (includeNestedFunctions: false) — 정확한 CFG dataflow

Step 2: dead-store 후보에 대해 정밀 도달성 분석
  - dead-store로 판정된 각 def에 대해:
    a) 해당 def의 CFG 노드에서 nested function 진입점까지 도달 가능한지 확인
    b) nested function 내부에서 해당 변수를 read하는지 확인
    c) 둘 다 충족하면 dead-store 판정 철회

구현:
  const closureReads = collectVariables(bodyNode, { includeNestedFunctions: true })
    .filter(u => u.isRead);

  // nested function 경계의 CFG 노드 식별
  const nestedFunctionEntries = identifyNestedFunctionEntries(cfg);

  for (const deadDef of candidateDeadStores) {
    // CFG에서 deadDef → nestedFunctionEntry 경로 존재 여부 (BFS/DFS)
    const reachable = isReachableInCfg(cfg, deadDef.cfgNode, nestedFunctionEntries);
    if (reachable) {
      const readInClosure = closureReads.some(r => r.name === deadDef.name);
      if (readInClosure) {
        // 클로저 캡처 — suppress
        continue;
      }
    }
    findings.push(deadDef);
  }
```

**왜 "보수적 접근"이 아닌 정밀 분석인가**:
보수적 접근(클로저 read가 있으면 모든 def suppress)은 false negative를 만든다:
```ts
function example() {
  let x = 1;         // ← def A: 진짜 dead-store
  x = 2;             // ← def B: 클로저에서 사용
  return () => x;
}
```
보수적 접근은 def A도 suppress하지만, 정밀 분석은 def A가 def B에 의해 kill되므로 클로저 도달 불가 → 정확히 dead-store로 보고.

**성능 영향**: dead-store 후보 수 × CFG 도달성 검사 (BFS). 후보 수가 적으므로 경미.
**테스트**:
- `test/integration/waste/closure-capture/`: `setup()` 패턴 → finding 0개
- `test/integration/waste/closure-overwritten/`: def A → def B → closure read B → def A는 dead-store

---

### P2-5. waste: 구조분해 파라미터 추적

**파일**: `src/engine/waste-detector-oxc.ts` — `collectLocalVarIndexes()`

**현상**: 파라미터 수집에서 Identifier만 처리. ObjectPattern/ArrayPattern 미처리.

```ts
function render({ title, description, unused }: Props) {
  return `<h1>${title}</h1><p>${description}</p>`;
}
// `unused`가 dead-store이나 감지되지 않음
```

**수정 방안**:

재귀적 패턴 분해 함수 추가:

```
const extractBindingNames = (node: Node, names: Set<string>): void => {
  if (node.type === 'Identifier') {
    const name = getNodeName(node);
    if (name !== null) names.add(name);
    return;
  }
  if (node.type === 'ObjectPattern') {
    for (const prop of properties) {
      if (prop.type === 'Property') extractBindingNames(prop.value, names);
      if (prop.type === 'RestElement') extractBindingNames(prop.argument, names);
    }
    return;
  }
  if (node.type === 'ArrayPattern') {
    for (const el of elements) {
      if (el !== null) extractBindingNames(el, names);
    }
    return;
  }
  if (node.type === 'AssignmentPattern') {
    extractBindingNames(node.left, names);
    return;
  }
  if (node.type === 'RestElement') {
    extractBindingNames(node.argument, names);
  }
};
```

`collectLocalVarIndexes()`의 params loop를 `extractBindingNames` 호출로 교체.

**성능 영향**: 없음 (AST 깊이에 비례, 실제 depth 1-2).
**테스트**:
- `function f({ a, b }) { return a; }` → `b` dead-store
- `function f([x, , z]) { return x; }` → `z` dead-store
- `function f({ a: { b, c } }) { return b; }` → `c` dead-store (중첩 구조분해)

---

### P2-6. waste: 메모리 참조 유지 패턴

**파일**: `src/engine/waste-detector-oxc.ts` — 신규 분석 로직

**현상**: 변수가 "사용"은 되지만, 실질적으로 불필요한 참조를 유지하여 GC를 방해하는 패턴을 감지하지 못한다.

```ts
function process() {
  const hugeData = loadEntireDataset();  // 1GB 데이터
  const summary = summarize(hugeData);    // hugeData "사용"됨
  // hugeData는 이후 안 쓰이지만, 함수 스코프에 남아 GC 불가
  doLongRunningWork(summary);             // 이 동안 hugeData가 메모리에 잔류
  return summary;
}
```

**수정 방안**:

last-use-to-scope-end 분석:

```
Step 1: 각 변수의 마지막 사용 위치를 CFG에서 식별
Step 2: 마지막 사용 이후 ~ 함수 종료까지의 거리(statement 수) 계산
Step 3: 거리가 threshold(설정 가능, 기본 10) 이상이면 "memory-retention" finding

finding kind: 'memory-retention'
message: "Variable 'hugeData' is last used at line 3 but scope ends at line 10.
          Consider nullifying or restructuring to allow GC."
confidence: 0.5 (낮은 confidence — 의도적일 수 있음)
```

**주의**: 이 패턴은 false positive가 많으므로 confidence를 낮게 설정하고, configurable threshold를 제공한다.

**성능 영향**: CFG의 last-use 분석은 기존 dataflow의 부산물. 추가 비용 경미.
**테스트**:
- 대형 변수 사용 후 긴 후속 코드 → finding
- 마지막 사용이 함수 끝에 있으면 → no finding

---

### P2-7. noop: self-assignment을 MemberExpression까지 확장

**파일**: `src/features/noop/analyzer.ts` — `collectNoopFindings()` 내 self-assignment 분기

**현상**: `x = x`만 감지. `this.x = this.x`, `obj.a = obj.a` 감지 안 됨.

**수정 방안**:

재귀적 표현식 동등성 비교 함수:

```
const isSameExpression = (left: Node, right: Node): boolean => {
  if (left.type !== right.type) return false;

  if (left.type === 'Identifier' && right.type === 'Identifier')
    return left.name === right.name;

  if (left.type === 'MemberExpression' && right.type === 'MemberExpression') {
    if (left.computed !== right.computed) return false;
    return isSameExpression(left.object, right.object)
        && isSameExpression(left.property, right.property);
  }

  if (left.type === 'ThisExpression' && right.type === 'ThisExpression')
    return true;

  return false;
};
```

기존 self-assignment 조건을 `isSameExpression(left, right)`로 교체.

**성능 영향**: 없음.
**테스트**:
- `this.x = this.x` → finding
- `obj.a.b = obj.a.b` → finding
- `obj.a = obj.b` → no finding

---

### P2-8. noop: 상수 조건을 모든 정적 truthy/falsy로 확장

**파일**: `src/features/noop/analyzer.ts` — `isBooleanLiteral()`, constant-condition 분기

**현상**: `if (true)` / `if (false)`만 감지. `if (0)`, `if ("")`, `if (null)` 미감지.

**수정 방안**:

`isBooleanLiteral` 대신 engine의 `evalStaticTruthiness`를 재활용:

```
import { evalStaticTruthiness } from '../../engine/oxc-expression-utils';

if (node.type === 'IfStatement') {
  const truthiness = evalStaticTruthiness(test);
  if (truthiness !== null) {
    findings.push({
      kind: 'constant-condition',
      confidence: 0.8,
      evidence: `if condition is always ${truthiness ? 'truthy' : 'falsy'}`,
    });
  }
}
```

**주의**: `while (true)`는 의도적 무한 루프 → WhileStatement는 감지 대상에서 제외한다.

**성능 영향**: 없음 (`evalStaticTruthiness`는 순수 함수, O(1)).
**테스트**: `if (0)`, `if ("")`, `if (null)`, `if (void 0)` → finding. `while (true)` → no finding.

---

### P2-9. duplicates: 알고리즘 수준 AST 정규화 레이어

**파일**: `src/engine/oxc-fingerprint.ts` — 새로운 정규화 패스 추가

**현상**: `for` loop과 `forEach`, `if/else`와 `ternary`가 같은 로직이라도 다른 fingerprint.

**수정 방안**:

fingerprint 입력 AST를 정규화하는 전처리기. P1-2 통합 clone detector의 4번째 모드로 추가.

**정규화 규칙 (전수 구현)**:

```
구문 수준 정규화:
  1. if/else → canonical form 정규화
     양 분기가 단일 expression이면 ternary로 통일
     if (c) { x = a; } else { x = b; }  →  x = c ? a : b
  2. for → while 정규화
     for (init; cond; update) { body }  →  init; while (cond) { body; update; }
  3. template literal → concatenation 정규화
     `${a} world` → a + " world"
  4. optional chaining → 조건 정규화
     a?.b → (a != null ? a.b : undefined) [fingerprint 수준에서만]

패턴 수준 정규화:
  5. De Morgan 정규화: !(a && b) → !a || !b
  6. arr.forEach(fn) → for (const x of arr) fn(x)
  7. arr.map(x => expr).filter(Boolean) → for loop with conditional push
  8. 삼항 조건 정렬: condition ? A : B 에서 condition이 !expr이면 반전
     !x ? A : B → x ? B : A
```

**구현 방식**:

```ts
// 새 파일: src/engine/ast-normalizer.ts
export const normalizeForFingerprint = (node: Node): NormalizedNode => {
  // shallow clone + transform 규칙 적용
  // 원본 AST를 변경하지 않음
};

// oxc-fingerprint.ts에서:
export const createOxcFingerprintNormalized = (node: NodeValue): string => {
  const normalized = normalizeForFingerprint(node);
  return createOxcFingerprintCore(normalized, { includeIdentifierNames: false, includeLiterals: false });
};
```

**통합 clone detector 모드 확장**:

| 모드 | Identifier | Literal | Normalization | 클론 유형 |
|------|-----------|---------|---------------|----------|
| `type-1` | 유지 | 유지 | 없음 | 완전 동일 |
| `type-2` | `$ID` | 유지 | 없음 | 이름 무관 |
| `type-2-shape` | `$ID` | `literal` | 없음 | 구조 |
| `type-3-normalized` | `$ID` | `literal` | **적용** | 알고리즘 |

**false positive 방지**: 정규화는 **semantically equivalent** 변환만 수행. `for` → `while` 은 100% 동등.
`forEach` → `for...of` 는 `break` 유무 차이 → `forEach` body에 early return 없을 때만 정규화.

**성능 영향**: 정규화 패스 추가로 fingerprint 계산 시간 ~2x. 그러나 전체 scan에서 fingerprint 비중은 <5%.
**테스트**:
- `for (let i=0; i<n; i++) arr.push(items[i])` vs `items.forEach(x => arr.push(x))` → 같은 그룹
- `if/else` vs `ternary` → 같은 그룹
- `!x ? A : B` vs `x ? B : A` → 같은 그룹

---

### P2-10. forwarding: 구조분해 파라미터 포워딩 감지

**파일**: `src/features/forwarding/analyzer.ts` — `getParams()`, `isForwardingArgs()`

**현상**: `function f({ a, b }: Props) { return g(a, b); }` — params가 ObjectPattern이면 `getParams()`가 `null` 반환.

**수정 방안**:

`getParams()`에 ObjectPattern 처리 추가:

```
if (paramNode.type === 'ObjectPattern') {
  const properties = paramNode.properties;
  for (const prop of properties) {
    if (prop.type === 'Property') {
      const value = prop.value ?? prop.key;
      if (value.type === 'Identifier') {
        params.push(value.name);
        continue;
      }
    }
    return null; // complex pattern → give up
  }
}
```

**성능 영향**: 없음.
**테스트**:
- `({ a, b }) => target(a, b)` → thin-wrapper finding
- `({ a, ...rest }) => target(a, ...rest)` → thin-wrapper finding

---

### P2-11. forwarding: cross-file 체인 분석

**파일**: `src/features/forwarding/analyzer.ts` — `computeChainDepth()`, `calleeByName`

**현상**: `calleeByName`이 per-file로 구성되어, 파일 경계를 넘는 포워딩 체인이 보이지 않는다.

```
// a.ts: export const f = (x) => b.g(x);
// b.ts: export const g = (x) => c.h(x);
// c.ts: export const h = (x) => realWork(x);
// a.f → b.g → c.h 체인이 per-file에서는 각각 depth=1로만 보임
```

**수정 방안**:

2-pass 분석:

```
Pass 1 (기존): per-file 분석 — 각 파일 내 thin-wrapper 식별
  결과: Map<exportedName, { targetModule, targetName }> per file

Pass 2 (신규): cross-file chain resolution
  - Pass 1 결과에서 thin-wrapper의 target이 다른 파일의 thin-wrapper인지 확인
  - dependency graph의 import 관계를 따라 chain depth 계산
  - finding kind: 'cross-file-forwarding-chain'
  - depth ≥ 2인 chain만 보고

구현:
  const crossFileMap = new Map<string, { file: string; target: string; depth: number }>();

  // 모든 파일의 thin-wrapper export를 수집
  for (const [file, wrappers] of perFileResults) {
    for (const w of wrappers) {
      crossFileMap.set(`${file}:${w.exportedName}`, {
        file, target: w.targetCallee, depth: 1
      });
    }
  }

  // chain 해소 (fixpoint iteration, 최대 maxForwardDepth 까지)
  let changed = true;
  while (changed) {
    changed = false;
    for (const [key, entry] of crossFileMap) {
      const targetKey = resolveImportTarget(entry.file, entry.target, importGraph);
      if (targetKey && crossFileMap.has(targetKey)) {
        const next = crossFileMap.get(targetKey)!;
        if (entry.depth < next.depth + 1) {
          entry.depth = next.depth + 1;
          changed = true;
        }
      }
    }
  }
```

**성능 영향**: Pass 2는 thin-wrapper 수에 비례. 일반 프로젝트에서 수십 개 → 무시할 수준.
**테스트**:
- `test/integration/forwarding/cross-file/`: a.ts → b.ts → c.ts chain → depth=2 finding on a.ts

---

## P3 — 가치 추가 (품질 차별화)

### P3-1. exception-hygiene: throw-non-error

**파일**: `src/features/exception-hygiene/analyzer.ts` — `collectFindings()` 내 walkOxcTree

**현상**: `throw "message"`, `throw 42` — Error 인스턴스가 아닌 값 throw. 스택 트레이스 손실.

**수정 방안**:

```
if (node.type === 'ThrowStatement') {
  const argument = node.argument;
  if (isOxcNode(argument)) {
    const isLikelyError =
      argument.type === 'NewExpression' ||
      argument.type === 'Identifier' ||
      argument.type === 'CallExpression' ||
      argument.type === 'AwaitExpression';

    if (!isLikelyError) {
      pushFinding(findings, {
        kind: 'throw-non-error',
        message: 'throw argument is not an Error instance (loses stack trace)',
      });
    }
  }
}
```

**성능 영향**: 없음.
**테스트**: `throw "error"` → finding. `throw new Error("x")` → no finding. `throw err` → no finding.

---

### P3-2. exception-hygiene: async-promise-executor

**파일**: `src/features/exception-hygiene/analyzer.ts` — `isPromiseFactoryCall()` 근처

**현상**: `new Promise(async (resolve, reject) => { ... })` — async executor 내부에서
throw된 에러가 Promise rejection으로 안 감.

**수정 방안**:

```
if (node.type === 'NewExpression') {
  const callee = node.callee;
  if (callee.type === 'Identifier' && callee.name === 'Promise') {
    const executor = node.arguments?.[0];
    if (executor &&
        (executor.type === 'ArrowFunctionExpression' || executor.type === 'FunctionExpression') &&
        executor.async === true) {
      pushFinding(findings, {
        kind: 'async-promise-executor',
        message: 'Promise executor is async; thrown errors will not reject',
      });
    }
  }
}
```

**성능 영향**: 없음.
**테스트**: `new Promise(async (res) => { ... })` → finding. `new Promise((res) => { ... })` → no finding.

---

### P3-3. exception-hygiene: error-cause 미사용

**파일**: `src/features/exception-hygiene/analyzer.ts` — `collectFindings()` 내 catch 블록 분석

**현상**: catch 블록에서 새 Error를 throw하면서 `{ cause }` 옵션을 누락 → 원인 체인 유실.

```ts
catch (err) {
  throw new Error("Processing failed");  // ← cause: err 누락
}
```

ES2022 `Error(message, { cause })` 표준.

**수정 방안**:

catch 블록 내 `ThrowStatement` > `NewExpression(Error/TypeError/...)` 탐지:

```
// catch 블록 순회 중:
if (node.type === 'ThrowStatement') {
  const arg = node.argument;
  if (arg.type === 'NewExpression' && isErrorConstructor(arg.callee)) {
    const args = arg.arguments ?? [];
    const hasOptions = args.length >= 2;
    const hasCauseProperty = hasOptions && isCauseOptions(args[1]);

    if (!hasCauseProperty && catchParam !== undefined) {
      pushFinding(findings, {
        kind: 'missing-error-cause',
        message: `new Error() in catch block without { cause: ${catchParam} }`,
      });
    }
  }
}

const isErrorConstructor = (callee: Node): boolean => {
  if (callee.type !== 'Identifier') return false;
  return ['Error', 'TypeError', 'RangeError', 'ReferenceError',
          'SyntaxError', 'URIError', 'EvalError'].includes(callee.name);
};

const isCauseOptions = (node: Node): boolean => {
  if (node.type !== 'ObjectExpression') return false;
  return node.properties?.some(p =>
    p.type === 'Property' && p.key?.type === 'Identifier' && p.key.name === 'cause'
  ) ?? false;
};
```

**성능 영향**: 없음.
**테스트**:
- `catch (e) { throw new Error("x") }` → finding
- `catch (e) { throw new Error("x", { cause: e }) }` → no finding
- `catch (e) { throw e }` → no finding (re-throw)

---

### P3-4. nesting: 인지 복잡도 (Cognitive Complexity)

**파일**: `src/features/nesting/analyzer.ts` — `analyzeFunctionNode()` 확장

**현상**: 현재 `maxDepth * 3 + decisionPoints`는 단순 선형 공식.
인지 복잡도(SonarQube 모델)는 중첩 레벨에 비례하는 가중치를 적용한다.

**수정 방안**:

```
// Cognitive Complexity 규칙 (SonarQube 사양):
// 1. 제어 흐름 중단(if, for, while, switch, catch, &&, ||, ?:) → +1
// 2. 중첩 보너스: 중단이 중첩 안에 있으면 현재 nesting level만큼 추가 +N
// 3. 중첩 증가: if, for, while, switch, catch, nested function → nesting level +1

let cognitiveComplexity = 0;

const visitCognitive = (value: NodeValue, nestingLevel: number): void => {
  if (isBreakInLinearFlow(nodeType)) {
    cognitiveComplexity += 1 + nestingLevel;  // base + nesting bonus
  }
  if (increasesNesting(nodeType)) {
    visitChildren(value, nestingLevel + 1);
  } else {
    visitChildren(value, nestingLevel);
  }
};
```

**NestingMetrics 타입 확장**:
```ts
interface NestingMetrics {
  depth: number;              // 기존
  cognitiveComplexity: number; // NEW
}
```

**suggestion 규칙**: `cognitiveComplexity >= 15` → "consider simplifying".
threshold 15는 SonarQube 기본값. `.firebatrc.jsonc`에서 설정 가능하게.

**성능 영향**: 기존 순회에 카운터 추가만. O(1) per node.
**테스트**:
- `if (a) { if (b) { if (c) {} } }` → CC = 1 + (1+1) + (1+2) = 6
- 선형 `if (a) {} if (b) {} if (c) {}` → CC = 1 + 1 + 1 = 3

---

### P3-5. nesting: 우발적 이차 시간복잡도 감지

**파일**: `src/features/nesting/analyzer.ts` — 신규 분석 규칙

**현상**: 같은 컬렉션에 대한 중첩 iteration은 성능 버그의 가장 흔한 원인이나 감지 안 됨.

```ts
users.forEach(u => {
  const match = users.find(other => other.id === u.managerId);
  //            ^^^^^ 같은 배열에 중첩 iteration → O(n²)
});
```

**수정 방안**:

```
finding kind: 'accidental-quadratic'

감지 조건:
  1. 외부 iteration: for/for...of/for...in/forEach/map/filter/reduce/find/some/every
  2. 내부 iteration: 같은 AST 하위 트리에 위 메서드 중 하나가 있음
  3. 두 iteration의 대상(collection 변수)이 같은 Identifier

구현:
  const getIterationTarget = (node: Node): string | null => {
    // for...of → node.right의 Identifier name
    // arr.forEach() → arr의 Identifier name
    // etc.
  };

  // 중첩 순회 시 스택 유지:
  iterationStack: Array<{ target: string; node: Node }>;

  // 새 iteration 진입 시:
  const target = getIterationTarget(node);
  if (target && iterationStack.some(s => s.target === target)) {
    findings.push({ kind: 'accidental-quadratic', ... });
  }
  iterationStack.push({ target, node });
  visitChildren(node);
  iterationStack.pop();
```

**성능 영향**: 기존 nesting 순회에 스택 관리 추가. O(depth) per node, 실질적으로 O(1).
**테스트**:
- `arr.forEach(x => arr.filter(...))` → finding
- `arr.forEach(x => otherArr.filter(...))` → no finding
- `for (x of arr) for (y of arr)` → finding

---

### P3-6. dependencies: dead export 감지

**파일**: `src/features/dependencies/analyzer.ts` — 신규 분석 로직

**현상**: export 했으나 프로젝트 어디에서도 import 안 하는 심볼. 사용되지 않는 코드가 번들 크기를 증가시킨다.

**수정 방안**:

기존 dependency graph에 export 수집을 추가:

```
Step 1: 각 파일에서 named export 수집
  - ExportNamedDeclaration → 각 specifier name
  - ExportDefaultDeclaration → 'default'
  - export { x } from './other' → re-export도 포함

Step 2: import graph에서 각 export의 소비자 수 카운트
  - ImportDeclaration의 specifier가 해당 export를 참조하는지 확인
  - import * as ns → 해당 모듈의 모든 export가 "사용됨"으로 간주

Step 3: 소비자 수 = 0인 export를 보고
  - finding kind: 'dead-export'
  - entry point (package.json main/exports)에서 도달 가능한 export는 제외
  - test 파일에서만 import되는 export는 별도 표시 (test-only-export)
```

**성능 영향**: export 수집은 기존 import 파싱 루프에 추가. 교차 대조는 O(exports × imports).
**테스트**:
- `export const unused = 1;` (아무 데서도 import 안 함) → finding
- `export const used = 1;` + 다른 파일에서 `import { used }` → no finding

---

### P3-7. dependencies: dynamic import() 감지

**파일**: `src/features/dependencies/analyzer.ts` — `collectImportSources()`

**현상**: `import()` 표현식 미파싱. 정적 `import` 선언만 수집.

**수정 방안**:

```
if (node.type === 'ImportExpression') {
  const source = node.source;
  if (isStringLiteral(source) && typeof source.value === 'string') {
    sources.push(source.value);
  }
  // 변수인 경우 (import(modulePath)) → 정적 분석 불가, 무시
}
```

**성능 영향**: 없음.
**테스트**: `const m = await import('./heavy')` → './heavy'가 dependency edge에 포함.

---

### P3-8. dependencies: 레이어 위반 감지

**파일**: `src/features/dependencies/analyzer.ts` — 신규 분석 규칙

**현상**: 아키텍처 레이어를 건너뛰는 import (예: adapter가 engine을 직접 import)를 감지하지 않음.

**수정 방안**:

`.firebatrc.jsonc`에 레이어 규칙 설정 추가:

```jsonc
{
  "features": {
    "dependencies": {
      "layers": [
        { "name": "adapters", "glob": "src/adapters/**" },
        { "name": "application", "glob": "src/application/**" },
        { "name": "engine", "glob": "src/engine/**" },
        { "name": "infrastructure", "glob": "src/infrastructure/**" }
      ],
      "allowedDependencies": {
        "adapters": ["application"],
        "application": ["engine", "infrastructure"],
        "engine": [],
        "infrastructure": []
      }
    }
  }
}
```

```
분석:
  for (각 import edge: source → target) {
    sourceLayer = matchLayer(source, layers);
    targetLayer = matchLayer(target, layers);
    if (sourceLayer && targetLayer) {
      const allowed = allowedDependencies[sourceLayer.name] ?? [];
      if (!allowed.includes(targetLayer.name) && sourceLayer.name !== targetLayer.name) {
        finding kind: 'layer-violation'
        message: `${sourceLayer.name} → ${targetLayer.name} is not allowed`
      }
    }
  }
```

**성능 영향**: O(edges). 기존 순회에 추가 조건만.
**테스트**:
- `src/adapters/cli/foo.ts` → `import from '../../engine/...'` → finding
- `src/application/scan/...` → `import from '../../engine/...'` → no finding (allowed)

---

### P3-9. duplicates: 파라미터화 diff 보고

**파일**: `src/engine/duplicate-collector.ts` 또는 신규 유틸

**현상**: 클론 그룹에서 "이 두 함수는 클론이다"만 보고하고, 정확히 무엇이 다른지 알려주지 않음.
리팩토링 시 어떤 부분을 파라미터로 추출해야 하는지 정보가 없다.

**수정 방안**:

fingerprint 매칭된 두 함수의 원본 AST를 diff하여 차이점 추출:

```ts
interface CloneDiff {
  kind: 'identifier' | 'literal' | 'type';
  pairs: Array<{ left: string; right: string; location: string }>;
}

const computeCloneDiff = (nodeA: Node, nodeB: Node): CloneDiff => {
  const diffs: CloneDiff['pairs'] = [];

  // 두 AST를 동시 순회 (같은 구조이므로 가능)
  const walk = (a: Node, b: Node, path: string): void => {
    if (a.type !== b.type) return; // 구조 불일치 → bail

    if (a.type === 'Identifier' && b.type === 'Identifier') {
      if (a.name !== b.name) {
        diffs.push({ left: a.name, right: b.name, location: path });
      }
    }
    if (a.type === 'StringLiteral' && b.type === 'StringLiteral') {
      if (a.value !== b.value) {
        diffs.push({ left: a.value, right: b.value, location: path });
      }
    }
    // ... 재귀 순회
  };

  walk(nodeA, nodeB, '');
  return { kind: inferDiffKind(diffs), pairs: diffs };
};
```

**DuplicateGroup 확장**:
```ts
interface DuplicateGroup {
  // ... 기존 필드
  suggestedParams?: CloneDiff; // NEW
}
```

**MCP/CLI 출력 예시**:
```json
{
  "suggestedParams": {
    "kind": "identifier",
    "pairs": [
      { "left": "User", "right": "Order", "location": ".body.declarations[0]" },
      { "left": "userId", "right": "orderId", "location": ".params[0]" }
    ]
  }
}
```

**성능 영향**: 클론 그룹 수에 비례. 일반 프로젝트에서 수십 그룹 → 경미.
**테스트**: `createUser(name)` vs `createOrder(name)` → suggestedParams에 `User↔Order` 포함.

---

### P3-10. typecheck: severity 구분

**파일**: `src/features/typecheck/detector.ts` — `toSeverity()`

**현상**: LSP DiagnosticSeverity는 1=Error, 2=Warning, 3=Information, 4=Hint로 구분되지만,
본 프로젝트는 검증 게이트 용도로 사용하므로 결과 출력은 **error-only**로 유지한다.

**정책(현재 기준)**:
- Warning(2)도 `error`로 **승격**하여 출력
- Information/Hint(3/4)는 결과에서 **제외(drop)**
- `TypecheckItem.severity`는 `error`만 사용

**성능 영향**: 없음.
**테스트**:
- severity=2 → `error`로 출력
- severity=3/4 → 결과에서 제외

---

### P3-11. unknown-proof: satisfies 연산자 처리

**파일**: `src/features/unknown-proof/candidates.ts`

**현상**: `satisfies`는 타입 검증만 하고 narrowing하지 않으므로 안전. type assertion으로 보고 가능.

**사전 작업**: oxc-parser에서 `TSSatisfiesExpression`이 candidates.ts의 수집 로직에 실제로 잡히는지 확인.
- 잡힌다면: `TSSatisfiesExpression`을 제외 처리 추가
- 안 잡힌다면: 이 항목은 non-issue로 종료

```
if (node.type === 'TSSatisfiesExpression') {
  return; // satisfies is safe — skip
}
```

**성능 영향**: 없음.
**테스트**: `const config = {} satisfies Config` → finding 0.

---

### P3-12. unknown-proof: 이중 단언 (double assertion) 감지

**파일**: `src/features/unknown-proof/candidates.ts` — type assertion 수집 로직

**현상**: `x as unknown as T`는 타입 시스템을 완전히 우회하는 패턴. 단순 assertion보다 위험.
현재는 각 `TSAsExpression`을 개별 finding으로 보고하지만, double assertion 패턴을 특별히 표시하지 않음.

**수정 방안**:

```
if (node.type === 'TSAsExpression') {
  const inner = node.expression;
  if (inner.type === 'TSAsExpression') {
    // double assertion: x as A as B
    pushFinding({
      kind: 'double-assertion',
      confidence: 0.95,
      message: 'Double type assertion bypasses type safety entirely',
    });
    return; // 내부 assertion을 중복 보고하지 않음
  }
  // 기존 single assertion 처리
}
```

**성능 영향**: 없음.
**테스트**:
- `x as unknown as string` → finding (kind: 'double-assertion')
- `x as string` → finding (kind: 기존 type-assertion)
- `x as const` → no finding (P0-3에서 제외)

---

### P3-13. unknown-proof: hover regex 강건화

**파일**: `src/features/unknown-proof/tsgo-checks.ts` — `pickTypeSnippetFromHoverText()`, `hasWord()`

**현상 1**: `pickTypeSnippetFromHoverText`의 regex `/```(?:typescript|ts)?\s*([\s\S]*?)```/m`는
hover 결과에 markdown code block이 여러 개 있으면 첫 번째만 캡처.

**현상 2**: `hasWord`의 `\bword\b` regex는 `unknown[]` 같은 타입에서 `unknown`을 매칭하지만,
identifier 이름에 `unknown`이 포함된 경우(예: `isUnknownType`)도 매칭.

**수정 방안**:

```
// pickTypeSnippetFromHoverText 개선:
// 모든 code block을 추출하고, 타입 정보가 포함된 것을 선택
const pickTypeSnippetFromHoverText = (text: string): string | null => {
  const blocks: string[] = [];
  const regex = /```(?:typescript|ts)?\s*([\s\S]*?)```/gm;
  let match;
  while ((match = regex.exec(text)) !== null) {
    blocks.push(match[1].trim());
  }
  // 타입 선언 패턴을 포함하는 블록 우선 선택
  const typeBlock = blocks.find(b => /^(const|let|var|type|interface|function|class)\b/.test(b));
  return typeBlock ?? blocks[0] ?? null;
};

// hasWord 개선:
// hover text에서 추출된 타입 정보 내에서만 검사 (변수 이름 부분 제외)
const hasWordInType = (typeSnippet: string, word: string): boolean => {
  // "const varName: TYPE" 형식에서 TYPE 부분만 추출
  const colonIndex = typeSnippet.indexOf(':');
  const typePart = colonIndex >= 0 ? typeSnippet.slice(colonIndex + 1) : typeSnippet;
  return new RegExp(`\\b${word}\\b`).test(typePart);
};
```

**성능 영향**: regex 실행 1-2회 추가. 무시할 수준.
**테스트**:
- hover text에 code block 2개 → 타입 선언 포함된 블록 선택
- `const isUnknownType: boolean` → `unknown` 매칭 안 됨 (변수 이름 부분)
- `const x: unknown` → `unknown` 매칭됨 (타입 부분)

---

### P3-14. barrel-policy: side-effect import 감지

**파일**: `src/features/barrel-policy/analyzer.ts` — `checkIndexStrictness()`

**현상**: barrel 파일(index.ts)에 `import './polyfill'` 같은 side-effect import가 있으면
해당 barrel을 import하는 모든 소비자가 예기치 않게 side-effect를 실행한다.

**수정 방안**:

`checkIndexStrictness()`에 side-effect import 감지 추가:

```
// 기존 invalid-index-statement 감지 루프에서:
if (stmt.type === 'ImportDeclaration') {
  const specifiers = stmt.specifiers;
  if (!specifiers || specifiers.length === 0) {
    // side-effect import: import './something'
    findings.push({
      kind: 'barrel-side-effect-import',
      message: `Side-effect import in barrel file may cause unexpected behavior for consumers`,
      evidence: stmt.source?.value,
    });
  }
}
```

**성능 영향**: 없음 (기존 순회에 조건 추가).
**테스트**:
- `index.ts` 내 `import './polyfill'` → finding
- `index.ts` 내 `import { x } from './module'` → no finding (re-export 목적)

---

## 실행 순서

```
Phase 0 — 버그 수정 (결과 정확성)
  □ P0-1  dependencies Tarjan SCC + Johnson's 사이클 탐지
  □ P0-2  api-drift expression-body returnKind 수정
  □ P0-3  unknown-proof `as const` false positive 수정
  □ P0-4  oxc-fingerprint separator 충돌 수정

Phase 1 — 설계 재작업 (노이즈 제거 + 기반 구축)
  □ P1-1  api-drift 전역 그루핑 → per-file/per-class/접두사 패밀리
  □ P1-2  duplicates 통합 (Type-1/2/2-shape) + 타겟 정비
  □ P1-3  coupling 실제 메트릭 (Instability, Abstractness, Distance, god-module)
  □ P1-4  lint/format 경로·config 강건화 + 통합 테스트

Phase 2 — 고영향 패턴 (실용 가치)
  □ P2-1  early-return if/else 불균형 감지
  □ P2-2  early-return throw를 guard clause로 인식
  □ P2-3  early-return depth > 0 guard clause (loop body)
  □ P2-4  waste 클로저 캡처 정밀 분석
  □ P2-5  waste 구조분해 파라미터 추적
  □ P2-6  waste 메모리 참조 유지 패턴
  □ P2-7  noop MemberExpression self-assignment
  □ P2-8  noop 상수 조건 확장 (evalStaticTruthiness)
  □ P2-9  duplicates AST 정규화 레이어 (Type-3-normalized)
  □ P2-10 forwarding 구조분해 파라미터 포워딩
  □ P2-11 forwarding cross-file 체인 분석

Phase 3 — 가치 추가 (차별화)
  □ P3-1  exception-hygiene throw-non-error
  □ P3-2  exception-hygiene async-promise-executor
  □ P3-3  exception-hygiene error-cause 미사용
  □ P3-4  nesting 인지 복잡도 (Cognitive Complexity)
  □ P3-5  nesting 우발적 이차 시간복잡도
  □ P3-6  dependencies dead export 감지
  □ P3-7  dependencies dynamic import() 감지
  □ P3-8  dependencies 레이어 위반 감지
  □ P3-9  duplicates 파라미터화 diff 보고
  □ P3-10 typecheck severity 구분
  □ P3-11 unknown-proof satisfies 처리
  □ P3-12 unknown-proof 이중 단언 감지
  □ P3-13 unknown-proof hover regex 강건화
  □ P3-14 barrel-policy side-effect import 감지
```
