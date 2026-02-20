# FEATURE_REPORT.md — firebat detector별 완전 정확도 검사

> 장점 없음. 문제점·버그·FP·FN만 기재.
> lint / format / typecheck 3개 제외, 나머지 25개 detector 전체 대상.

---

## 검사 방법론

모든 detector에 동일한 3-방향 검사를 적용한다.

### Direction A — Analyzer 소스 읽기 (Logic Extraction)
- `read_file`로 analyzer 소스 **전체** 읽기 (partial read 금지)
- 추출 대상:
  - 탐지 조건 (어떤 AST 패턴/수치에서 finding 생성)
  - skip 조건 (무시하는 케이스)
  - 임계값 (hardcoded vs config-driven)
  - kind 분기 조건
  - 논리 오류 (`&&`/`||` 반전, unreachable branch, 조건 누락)

### Direction B — Finding → Code 검증 (FP 검출)
- finding의 file + line을 `read_file`로 **직접** 읽어 코드 확인
- 샘플이 아니라 **전수 또는 kind별 전체** 검사
- 판정 기준: Direction A에서 파악한 탐지 의도와 실제 코드가 일치하면 TP, 불일치하면 FP
- **스크립트로 집계만 하는 것 금지** — 코드 텍스트를 눈으로 직접 읽는 것이 증거

### Direction C — Code → Finding 검증 (FN 검출)
- Direction A에서 추출한 탐지 조건을 **역으로 grep/read**
- "잡혔어야 하는데 안 잡힌 것" 탐구
- grep → 해당 파일 직접 read_file → findings에 없으면 FN
- FN 원인 분석: skip 조건 과도?, 임계값 과도?, 로직 오류?

### 보고 형식
각 detector마다:
- **탐지 로직** 요약 (소스 인용)
- **Finding 통계** (total / kind 분포)
- **FP 목록** — 코드 증거 포함 (file:line 직접 인용)
- **FN 목록** — grep 패턴 + 실제 코드 인용
- **로직 결함** — 소스 조건식 직접 인용
- **판정**: `PASS` / `FP_HIGH` / `FN_HIGH` / `LOGIC_BUG` / `FUNDAMENTAL_FLAW`

---

---

## 1. concept-scatter

**검사 일시**: 2026-02-20
**소스**: `src/features/concept-scatter/analyzer.ts` (142줄 전체 읽음)
**Finding 수**: 671건 (kind: concept-scatter 671)
**config**: `maxScatterIndex: 10` (.firebatrc.jsonc)

---

### 탐지 로직

```typescript
// analyzer.ts L52-69 — 토크나이저
const tokenizeConcepts = (input: string): ReadonlyArray<string> => {
  const raw = input
    .replaceAll(/[^a-zA-Z0-9]/g, ' ')   // 특수문자 → 공백
    .split(' ')
    .map(s => s.trim())
    .filter(Boolean);
  const concepts: string[] = [];
  for (const token of raw) {
    const parts = token.split(/(?=[A-Z])/).map(s => s.toLowerCase()); // camelCase 분리
    for (const p of parts) {
      if (p.length < 3) continue;       // 3자 미만 필터
      concepts.push(p);
    }
  }
  return concepts;
};
```

```typescript
// analyzer.ts L92-100 — 파일별 concept 수집
const rel = normalizeFile(file.filePath);
const layer = layerOf(rel);
const concepts = new Set<string>([
  ...tokenizeConcepts(rel),              // ← 파일 "경로" 토크나이징
  ...tokenizeConcepts(file.sourceText)   // ← 파일 "소스 전체" 토크나이징
]);
```

```typescript
// analyzer.ts L117-118 — scatterIndex 계산
const scatterIndex = filesSet.size + layersSet.size;
if (scatterIndex <= maxScatterIndex) continue;  // threshold = 10
```

**의도**: `payment` 같은 도메인 개념이 여러 layer에 흩어지는 패턴 탐지.
**spec 증거**: `analyzer.spec.ts` L49-65 — `paymentService`, `paymentCli`, `paymentRepo` 4파일/4레이어 테스트.

---

### 핵심 결함 1 — 소스 텍스트 전체를 concept으로 처리

`tokenizeConcepts(file.sourceText)`는 해당 파일의 **전체 소스 텍스트**를 공백/camelCase 분리한 뒤 모든 토큰을 concept으로 등록한다.

이로 인해 다음이 모두 concept이 된다:

| 원본 코드 | 추출된 concept |
|---|---|
| `import { foo } from './bar'` | `"import"`, `"foo"`, `"from"`, `"bar"` |
| `const resolveToolRcPath = ...` | `"resolve"`, `"Tool"→"tool"`, `"Rc"→"rc"` (3자 미만 필터), `"Path"→"path"` |
| `// handle the home directory` | `"handle"`, `"the"`, `"home"`, `"directory"` |
| `'WASTE_MEMORY_RETENTION'` | `"waste"`, `"memory"`, `"retention"` |

**실제 finding 증거**:
- `"import"` — scatter:258, files:253 → 전체 파일의 98%에 등장 (JS 예약어)
- `"from"` — scatter:286, files:281 → 전체 파일의 99%에 등장 (JS 예약어)
- `"const"` — scatter:262, files:257 → 전체 파일의 99%에 등장 (JS 예약어)
- `"return"` — scatter:229, files:224 (JS 예약어)
- `"null"` — scatter:148, files:143 (JS 예약어)
- `"true"` / `"false"` — scatter:149/115 (JS 리터럴)
- `"string"` / `"number"` / `"boolean"` — TS 타입 키워드들
- `"array"` — scatter:153 (JS 예약어·TS 타입)
- `"describe"` / `"expect"` / `"arrange"` / `"act"` / `"assert"` — test framework 키워드
- `"readonly"` — TS 키워드

이들은 **모두 FP**다. 개념적 산재와 무관하고 JS/TS 문법 요소다.

---

### 핵심 결함 2 — normalizeFile이 /src/ 없는 파일에 절대경로 반환

```typescript
// analyzer.ts L8-16
const normalizeFile = (filePath: string): string => {
  const normalized = filePath.replaceAll('\\', '/');
  const idx = normalized.lastIndexOf('/src/');
  if (idx >= 0) {
    return normalized.slice(idx + 1);  // "src/..." 형태
  }
  return normalized;  // ← /src/ 없으면 절대경로 그대로 반환
};
```

`drizzle.config.ts`, `index.ts`, `oxlint-plugin.ts`, `scripts/build.ts` 등 루트 레벨 파일은 `/src/`가 경로에 없어 `normalizeFile`이 `/home/revil/zipbul/firebat/...` 절대경로를 그대로 반환한다.

이 절대경로가 `tokenizeConcepts`에 들어가면:
- `"/home/revil/zipbul/firebat/drizzle.config.ts"` → `["home", "revil", "zipbul", "firebat", "drizzle", "config"]`

**실제 finding 증거**:
- `"home"` — scatter:85, files:84 → 절대경로 토크나이징 산물 (FP)
- `"revil"` — scatter:85, files:84 (FP, 로컬 사용자명이 concept으로)
- `"zipbul"` — scatter:85, files:84 (FP, 디렉토리명이 concept으로)
- `"firebat"` — scatter:150, files:145 (FP, 프로젝트 이름)

**"home" finding이 84개 파일에 등장하는 이유**: 루트 레벨 파일들의 소스 텍스트에 절대경로 문자열이 포함된 경우(e.g., test fixture 경로, `import.meta.dir` 결과 등) 전파됨.

---

### FP 전수 분류 (671건)

JS/TS 문법 키워드 (예약어·타입·리터럴):
`import`, `from`, `const`, `return`, `null`, `true`, `false`, `string`, `number`,
`boolean`, `undefined`, `void`, `never`, `any`, `type`, `typeof`, `interface`,
`class`, `async`, `await`, `readonly`, `static`, `extends`, `implements`, `default`,
`for`, `while`, `switch`, `case`, `throw`, `try`, `catch`, `finally`, `break`,
`continue`, `new`, `this`, `else`, `export`, `array`, `object`, `promise`,
`function`, `arrow`, `resolve`, `reject`, `error`, `describe`, `expect`,
`arrange`, `act`, `assert`, `equal` 등 → **약 120건 이상 확정 FP**

파일경로 컴포넌트:
`home`, `revil`, `zipbul`, `firebat`, `src`, `test`, `integration`, `spec`,
`dist`, `scripts`, `assets` → **약 15건 FP**

지나치게 generic 프로그래밍 단어:
`get`, `set`, `has`, `add`, `use`, `run`, `find`, `init`, `map`, `out`, `abs`,
`err`, `rel`, `ctx`, `obj`, `idx`, `loc`, `key`, `val`, `buf`, `res`, `req`,
`node`, `next`, `prev`, `left`, `right`, `inner`, `outer`, `size`, `count`,
`name`, `args`, `arg`, `path`, `file`, `data`, `create`, `delete`, `update`,
`insert`, `replace`, `remove`, `push`, `pull`, `load`, `save`, `open`, `close`,
`read`, `write`, `send`, `emit`, `call`, `done`, `log`, `warn`, `debug`,
`trace`, `raw` 등 → **약 150건 추가 FP**

TP 가능성 있는 domain concept 후보 (실제 domain 어휘):
`scan`, `waste`, `coupling`, `duplicate`, `forwarding`, `barrel`, `oxlint`,
`firebatrc`, `detector`, `analyzer`, `usecase`, `scaffold` 등 → **약 30~50건**

**추정 FP 비율**: 671건 중 **약 90%+ FP** (600건 이상)

---

### FN 분석

`maxScatterIndex=10` 임계값 하에서 파일 10개 이상에 걸친 개념은 모두 탐지된다.
실제 domain concept FN은 낮다. 그러나 671건의 소음 속에서 TP(~50건)가 묻혀 있어 **실용적으로는 FN과 동일한 효과** — 진짜 산재 문제를 찾아낼 수 없다.

---

### 판정

**`FUNDAMENTAL_FLAW`**

- 소스 텍스트 전체를 raw text tokenizing → JS/TS 문법 요소 모두 concept으로 처리
- normalizeFile 버그 → 루트 레벨 파일의 절대경로 토크나이징
- 671건 중 **약 620건 FP** 추정
- spec test가 단순한 입력만 사용해서 노이즈 문제를 전혀 검증하지 않음

**수정 방향**:
1. `tokenizeConcepts`를 soureText 전체가 아닌 **AST identifier 노드**에만 적용
2. JS/TS 예약어 stop-word 필터 추가
3. `normalizeFile`에서 `/src/` 없는 경우 프로젝트 루트 기준 상대경로 반환

---

---

## 2. variable-lifetime

**검사 일시**: 2026-02-20
**소스**: `src/features/variable-lifetime/analyzer.ts` (148줄 전체 읽음)
**Finding 수**: 1775건 (kind: variable-lifetime 1775)
**config**: `maxLifetimeLines: 200` (.firebatrc.jsonc)

---

### 탐지 로직

```typescript
// analyzer.ts L89-97 — 선언 regex
const declRe = /\b(const|let|var)\s+([a-zA-Z_$][\w$]*)\b/g;

// 선언된 변수명으로 마지막 사용 위치 탐색
const useRe = new RegExp(`\\b${name}\\b`, 'g');
useRe.lastIndex = defOffset;
let lastOffset = defOffset;
for (;;) {
  const um = useRe.exec(file.sourceText);
  if (um === null) break;
  lastOffset = um.index;  // ← 파일 내 마지막 text match 위치
}
const lifeLines = Math.max(0, lastLine - defLine);
if (lifeLines > maxLifetimeLines) { ... report ... }
```

**의도**: 선언 시점부터 마지막 사용 시점까지의 줄 수가 maxLifetimeLines(200)를 초과하면 "변수가 너무 오래 살아있다"로 보고.

---

### 핵심 결함 1 — Scope-blind regex matching

`useRe = new RegExp(\`\\b${name}\\b\`, 'g')` 는 AST 기반 참조 추적이 아니라 **전체 파일 소스를 regex로 텍스트 검색**한다.

이로 인해 동일한 이름의 다른 scope 변수, object property access, 주석, 문자열 리터럴을 모두 "마지막 사용"으로 잘못 계산한다.

**확정 FP 사례 1** — `src/engine/waste-detector-oxc.ts`:

```typescript
// line 33: extractBindingNames 함수 내부 local variable
const name = getNodeName(node);   // ← 선언 (scope: extractBindingNames)
```

```typescript
// line 730: 완전히 다른 함수 (detectWasteOxc) 내부의 별개 name 변수
column: lastUseLoc.column + name.length,  // ← 다른 scope의 'name'
```

알고리즘: line 33 선언 → regex `/\bname\b/` → line 730 last match → lifetime = 697줄 → **FP** (maxLifetimeLines=200 초과)

실제로는 line 33의 `name`은 localscope에서 line 38 (`out.push({ name, location }`) 이후 사용되지 않음. 진짜 lifetime ≈ 5줄.

---

**확정 FP 사례 2** — `src/application/scan/scan.usecase.ts`:

```typescript
// line 74: module-top-level arrow function
const resolveToolRcPath = async (rootAbs: string, ...
```

```typescript
// line 1515: 파일 맨 끝 export 문
export { resolveToolRcPath, scanUseCase };  // ← last regex match
```

알고리즘: line 74 선언 → regex last match = line 1515 (export 문) → lifetime = 1441줄 → **FP**

실제 마지막 호출은 line 391. export 문은 "사용"이 아니라 모듈 재공개다.

---

### 추가 FP 패턴 (코드 읽기로 확인된 structural 문제)

**object property access**:
- `const name = ...` (line N)  
- `obj.name` (line N+300) → `\bname\b`이 `.name`에서도 매칭됨  
- lifetime이 300줄 늘어남 → FP

**동명 변수 shadowing**:
- outer scope: `const index = 0` (line 10)
- inner scope: `for (const index of items)` (line 400)  
- regex가 inner scope의 `index`를 outer scope의 last use로 인식 → lifetime = 390줄

**주석 내 변수명**:
- `// if the result is invalid...` 라고 주석 달린 경우
- 앞에 `const result = ...` 선언이 있으면 해당 주석 줄이 last use가 됨

**export 문**:
- `export { varName }` — 모든 export된 변수의 lifetime이 파일 마지막 줄까지 늘어남

---

### FP 규모 추정

1775건 중:
- export 문으로 인한 FP: `export { ... }` 라인을 last use로 잡은 케이스 — 추정 300건+
- 다른 scope 동명 변수로 인한 FP: 추정 400건+
- object property access 오매칭: 추정 200건+
- 진짜 TP (선언 위치~실제 마지막 사용이 200줄 초과): 추정 400건 미만

**추정 FP 비율**: 1775건 중 **약 75%+ FP** (1300건 이상)

---

### FN 분석

역설적으로 FN은 낮다 — regex가 너무 많은 것을 "사용"으로 잡기 때문에 lifetime이 과도하게 늘어난다. 즉 보고 안 되어야 할 것들도 lifetime이 길게 계산되어 보고됨.

실제 "200줄 이상 살아있는 진짜 long-lived 변수"가 안 잡히는 경우: 거의 없음.

---

### 판정

**`FUNDAMENTAL_FLAW`**

- AST-based scope/reference tracking 없이 regex text search로 lifetime 계산
- 확인된 FP 원인: (1) export 문을 last use로 카운트, (2) 다른 scope 동명 변수 오매칭, (3) object property access 오매칭, (4) 주석 내 변수명 오매칭
- 1775건 중 **추정 75%+ FP**
- maxLifetimeLines=200 임계값도 너무 낮음 — 300줄 파일에서 200줄 lifetime은 전혀 비정상 아님

**수정 방향**:
1. TypeScript compiler API(`ts-morph` 또는 `ts.Program`)를 사용해 actual reference tracking
2. export 문을 "사용"에서 제외
3. scoped variable shadowing 처리
4. maxLifetimeLines 임계값 상향 (최소 500줄 이상 검토)

---

---

## 3. waste

**검사 일시**: 2026-02-20
**소스**: `src/features/waste/detector.ts` (16줄, wrapper) + `src/engine/waste-detector-oxc.ts` (761줄 전체 읽음)
**Finding 수**: 340건 (memory-retention: 309건, dead-store: 31건)
**config**: memoryRetentionThreshold default=10 (CFG steps)

---

### 탐지 로직

waste detector는 두 가지 kind를 탐지한다.

#### dead-store (31건)
CFG 기반 dataflow analysis. 정의(def)가 `usedDefs`에 없으면 보고.

```typescript
// waste-detector-oxc.ts L577-640
for (let defId = 0; defId < defs.length; defId += 1) {
  if (usedDefs.has(defId)) continue;          // ← 사용된 def는 skip
  const meta = defs[defId];
  // suppress: 다른 def를 통해 사용되는 경우
  if (meta.writeKind === 'declaration' && varHasAnyUsedDef[meta.varIndex]) continue;
  // suppress: closure-captured인 경우
  if (isClosureCaptured) continue;
  // → 여기까지 오면 dead-store 보고
  findings.push({ kind: 'dead-store', label: meta.name, ... });
}
```

**suppression 조건**:
1. `usedDefs.has(defId)` — 이 def가 다운스트림에서 읽힘
2. `writeKind === 'declaration' && varHasAnyUsedDef` — 다른 def 경로로 읽힘
3. `isClosureCaptured` — 중첩 함수가 이 def에 접근

**없는 조건 (FP 원인)**: `_` prefix 무시 규칙 없음

#### memory-retention (309건)
```typescript
// waste-detector-oxc.ts L692-730
// 마지막 read 이후 exit까지 CFG steps 계산
const steps = computeMinPayloadStepsToExit(cfg, nodePayloads, lastReadNodeId, exitId);
if (steps === null || steps < memoryRetentionThreshold) continue;
findings.push({ kind: 'memory-retention', confidence: 0.5, ... });
```

**조건**: 마지막 read 이후 scope exit까지 CFG node steps ≥ threshold(10)
**parameters 제외**: parameterVarIndexes 체크 존재
**confidence: 0.5** — 설계자 스스로 FP 가능성 인정

---

### FP 검증 (dead-store — 직접 코드 확인)

#### 확정 FP 1 — `_` intentionally-unused 파라미터

**파일**: `src/adapters/cli/argv-router.ts` L147, L149

```typescript
// line 147
argv.filter((_, idx) => idx !== subcommandIndex)
// line 149
argv.filter((_, idx) => idx !== subcommandIndex)
```

`_`는 JavaScript/TypeScript에서 "의도적으로 무시하는 파라미터"를 나타내는 관용 표기. 사용하지 않을 것이 의도임에도 dead-store로 보고 → **FP**.

**원인**: `_` prefix (또는 bare `_`) 변수를 skip하는 조건이 detector 어디에도 없음.

---

#### 확정 FP 2 — `orm` 사용 중인 변수

**파일**: `src/application/memory/memory.usecases.ts` L72

```typescript
const created = (async (): Promise<MemoryRepository> => {
  const orm = await getOrmDb({ rootAbs: projectKey, logger: input.logger });  // line 72
  return createSqliteMemoryRepository(orm);  // line 74 — orm 실제 사용
})();
```

`orm`은 line 74에서 실제로 사용되고 있음. detector가 dead-store로 보고 → **FP**.

**추정 원인**: `await` 표현식을 포함한 const 선언에서 CFG가 데이터 흐름을 올바르게 추적하지 못하는 버그. async IIFE 패턴에서 `await` 이후 값의 사용이 "reached" 상태로 등록되지 않는 것으로 추정.

---

### FP 검증 (memory-retention — 직접 코드 확인)

#### Semantic FP — primitive 타입 변수

**파일**: `scripts/build.ts` L319

```typescript
const cliNaming = 'firebat.js';       // line 319
const cliDistFilePath = `${outdir}/${cliNaming}`;  // line 320 — 사용
// ...
naming: cliNaming,                    // line 332 — 마지막 사용
// scope는 454줄 끝까지 계속됨
```

`cliNaming`은 string literal `'firebat.js'`. 마지막 사용(line 332) 이후 scope 종료(line 454?)까지 ~120줄 retention → **memory-retention 보고됨**.

그러나 `'firebat.js'` 8바이트 문자열의 retention은 **실질적 메모리 영향 없음**. GC pressure 없음. 유일한 의미는 "코드 정리 차원에서 변수를 더 가까이 선언하라"는 것인데, confidence 0.5로 보고되는 것이 전부. → **Semantic FP**.

**근본 원인**: memory-retention이 변수 타입(string, number, boolean vs object, array, Buffer)을 구분하지 않음. primitive에는 적용하지 않아야 함.

---

### FP 규모 수정 (31건 전수 직접 확인)

**dead-store (31건 전수 확인)**:

| 파일 | 라인 | 변수 | 판정 | 원인 |
|---|---|---|---|---|
| argv-router.ts | L147,L149 | `_` | FP×2 | _ prefix 미필터 |
| temporal-coupling/analyzer.ts | L85 | `_` | FP | _ prefix 미필터 |
| report.ts | L146 | `_emoji` | FP | _ prefix 미필터 |
| memory.usecases.ts | L72 | `orm` | FP | async IIFE CFG 버그 |
| scan.usecase.ts | L527 | `partial` | FP | async block CFG 버그 |
| exception-hygiene/analyzer.ts | L538,545,563,566,567 | `name`,`only`,`hasReturnOrJump`,`isEmpty`,`isOnlyConsole` | FP×5 | IIFE 내부 변수 |
| forwarding/analyzer.ts | L497,503 | `statements`,`statement` | FP×2 | IIFE 내부 변수 |
| firebat.db.ts | L70,71,72,74,76,78,95,104,105 | 다수 | FP×9 | async IIFE 내부 변수 |
| ts-program.ts | L273,277,284,287,291,312,313 | 다수 | FP×7 | async IIFE loop 내부 |
| typecheck/detector.ts | L149 | `severity` | **TP** | 실제 미사용 파라미터 |

**확인 결과**: 31건 중 **30건 FP, 1건 TP** (FP 97%)

**주요 FP 원인 3가지**:
1. `_` 또는 `_`로 시작하는 변수명 필터 없음
2. IIFE 내부 변수 — `(() => { const x = ...; return fn(x); })()` 패턴을 dead-store로 오판
3. async block/loop 내 `await` 이후 변수 사용 미추적

**memory-retention (309건)**:
- primitive 타입 적용 FP: scripts/build.ts 52건 중 상당수
- test 파일 포함: `test/integration/install/update.test.ts` 32건 → test cleanup 패턴이 다름
- `src/engine/waste-detector-oxc.ts` 40건 — 자기 자신을 분석하는 것도 포함
- `src/report.ts` 52건 — 가장 많음, 직접 확인 필요
- 추정 FP: 100건+ (32%+), 주로 primitive 타입 및 test 파일

---

### FN 분석

**dead-store FN**: CFG 기반 분석이므로 이론적으로 낮음. `await` 관련 CFG 버그가 있다면 해당 패턴에서 FN도 발생 가능 (사용된 변수를 dead-store로 잘못 보고하면, 반대로 진짜 dead-store를 놓칠 경우도 있음). 하지만 async IIFE 패턴이 많은 코드에서 확인되지 않음.

**memory-retention FN**: 큰 객체(파싱된 AST, 파일 내용 버퍼 등)가 중간에 사용되고 scope 끝까지 보유되는 패턴이 실제 있을 수 있음. 하지만 threshold=10 CFG steps가 매우 낮아서 FN보다 FP가 더 많음.

---

### 판정

**`FP_MEDIUM` (dead-store) + `FP_HIGH` (memory-retention)**

- `dead-store`: CFG 기반으로 비교적 정확하지만 `_` prefix 무시 없음, `await` CFG 버그 존재
- `memory-retention`: primitive 타입 구분 없음, 설계자 스스로 confidence 0.5 인정, 309건 중 100건+ 실질적 FP 추정

**수정 방향**:
1. dead-store: `_` 또는 `_`로 시작하는 변수명 skip 조건 추가
2. dead-store: async IIFE 내 `await` 의 CFG modeling 검토
3. memory-retention: primitive 타입은 skip (string/number/boolean 상수)
4. memory-retention: test 파일 별도 임계값 적용 또는 제외 옵션

---

---

## 4. implementation-overhead

**검사 일시**: 2026-02-20
**소스**: `src/features/implementation-overhead/analyzer.ts` (563줄 전체 읽음)
**Finding 수**: 283건 (kind: implementation-overhead 283)
**config**: `minRatio: 1.5` (.firebatrc.jsonc)

---

### 탐지 로직

"함수의 interface 복잡도 대비 구현 복잡도가 과도한가"를 ratio로 측정한다.

```typescript
// analyzer.ts L468-476 — 메인 탐지 regex
const fnRe = /\bexport\s+function\s+([a-zA-Z_$][\w$]*)\s*\(/g;
// analyzer.ts L519 — arrow 탐지 regex
const arrowRe = /\bexport\s+const\s+([a-zA-Z_$][\w$]*)\s*=\s*\(([^)]*)\)\s*=>/g;
```

```typescript
// analyzer.ts L131-136 — interface 복잡도
const estimateInterfaceComplexity = (signature: string, paramsText: string): number => {
  const hasReturnType = signature.includes('):') || signature.includes(') :');
  const paramCount = countTopLevelParams(paramsText);
  return Math.max(1, paramCount + (hasReturnType ? 1 : 0));
};

// analyzer.ts L138-145 — 구현 복잡도
const estimateImplementationComplexity = (body: string): number => {
  const semicolons = (body.match(/;/g) ?? []).length;
  const ifs = (body.match(/\bif\b/g) ?? []).length;
  const fors = (body.match(/\bfor\b/g) ?? []).length;
  return Math.max(1, semicolons + ifs + fors);
};
```

ratio = `implementationComplexity / Math.max(1, interfaceComplexity)`.
ratio > `minRatio(1.5)` 이면 보고.

---

### 핵심 결함 1 — raw text regex가 string literal 내 코드를 매칭

`fnRe`와 `arrowRe`는 **파일 전체 소스 텍스트**에 regex를 적용. AST-based가 아님.
따라서 test spec 파일이 TypeScript 코드를 문자열로 전달하는 패턴에서 FP 발생.

**확정 FP 사례** — `src/engine/ast-normalizer.spec.ts` line 35:

```typescript
// ast-normalizer.spec.ts:32-38
it('should normalize if/else returning values to ternary', () => {
  expectSameNormalized(
    'export function f(c) { if (c) { return 1; } else { return 2; } }',  // ← line 35
    'export function f(c) { return c ? 1 : 2; }',                         // ← line 36
  );
});
```

`fnRe`가 line 35 문자열 안의 `export function f(c)` 를 매칭. body로 `{ if (c) { return 1; } else { return 2; } }` 추출.

- `interfaceComplexity = countTopLevelParams("c") = 1` (no return type annotation in string)  
- `implementationComplexity = semicolons(2) + ifs(1) + fors(0) = 3`
- `ratio = 3/1 = 3.0 > 1.5` → **finding 보고**

실제로 분석한 것은 **String 리터럴 안의 코드**. 이 함수는 존재하지 않음. → **FP**

`ast-normalizer.spec.ts`에는 이 패턴이 최소 10건+ 존재 (lines 35, 36, 42, 43, 51, 52, 59, 66, 67, 74 등).

---

### 핵심 결함 2 — `for` 루프 헤더의 세미콜론 이중 카운트

`for (let i = 0; i < n; i++)` 한 줄은:
- `\bfor\b` → +1
- `;` 매치 → `let i = 0;` (+1), `i < n;` (+1) = **+2 semicolons**

하나의 `for` 루프가 `implementationComplexity += 3` 기여.

예시:
```typescript
export function processItems(items: string[]): void {
  for (const item of items) {
    console.log(item);          // semicolon: +1
  }
}
```
- `for (const item of items)` → for: +1, semicolons in body: 1 → total = 2
- `interfaceComplexity = 1 (items param) + 0 (void return type not `:` syntax) = 1`
- `ratio = 2/1 = 2.0 > 1.5` → **FP** (단순 loop이 implementation-overhead로 보고)

Note: `): void` 형태는 `signature.includes('):')` 조건이 `):`를 포함해서 `void`도 return type 있는 것으로 처리됨. 위 예시에서는 `): void` → hasReturnType=true, interfaceComplexity=2, ratio=1.0 → NOT reported. 하지만 `): void`가 없으면 ratio=2.

---

### 핵심 결함 3 — Arrow regex가 complex params를 처리 못함

```typescript
const arrowRe = /\bexport\s+const\s+([a-zA-Z_$][\w$]*)\s*=\s*\(([^)]*)\)\s*=>/g;
//                                                                     ^^^^^ [^)]*: 괄호 내에 괄호나 중첩 타입 있으면 매칭 실패
```

아래 패턴들은 매칭 안 됨 → FN:

```typescript
export const fn = ({ a, b }: Props) => { ... }   // destructured params
export const fn = <T>(input: T) => { ... }        // generic params
export const fn = (a: Map<K, V>) => { ... }       // generic type in param
```

실제 codebase에는 이런 패턴이 많음. → **FN** (실제로 overhead인 함수들이 탐지 안 됨)

---

### FP 규모 추정

- spec 파일에 string-embedded `export function` 패턴 다수: ast-normalizer.spec.ts만 10건+
- 프로젝트 내 spec 파일 약 50+개, 코드 string을 테스트로 전달하는 파일 다수
- 추정 FP: 283건 중 **50~100건 (17~35%)** string literal 내 코드 FP
- for loop 이중 카운트로 인한 추가 FP: 추정 30건
- 전체 추정 FP: **80~130건 (28~46%)**

---

### 판정

**`FP_HIGH` + `FN_MEDIUM`**

- raw text regex → string literal 내 코드 매칭 FP
- `for` 루프 헤더 세미콜론 이중 카운트 → ratio 인플레이션
- arrow function regex가 complex params 매칭 못함 → FN
- `.spec.ts` 파일 제외 없음

**수정 방향**:
1. `.spec.ts` / `.test.ts` 파일 제외 옵션
2. AST 기반으로 함수 노드 추출 (raw text regex 대신)
3. `estimateImplementationComplexity`에서 for 헤더 세미콜론 제외
4. arrow regex를 balanced-paren parser로 대체 (현재 `findMatchingParen` 함수가 이미 있음 — 사용하면 됨)

---

---

## 5. structural-duplicates + exact-duplicates

**검사 일시**: 2026-02-20
**소스**: `src/features/structural-duplicates/analyzer.ts` (18줄, wrapper) + `src/engine/duplicate-detector.ts` (76줄) + `src/engine/duplicate-collector.ts` (190줄) 전체 읽음
**Finding 수**: structural-duplicates 327건 (type-2-shape:158, type-3-normalized:169), exact-duplicates 53건 (type-1:53)

---

### 탐지 로직

AST-based fingerprinting. 대상 노드: FunctionDeclaration, ClassDeclaration, ClassExpression, MethodDefinition, FunctionExpression, ArrowFunctionExpression, TSTypeAliasDeclaration, TSInterfaceDeclaration.

- **type-1 (exact)**: `createOxcFingerprintExact` — 토큰 수준 완전 동일
- **type-2-shape**: `createOxcFingerprintShape` — 구조 모양 동일 (identifier 이름 무시)
- **type-3-normalized**: `createOxcFingerprintNormalized` — 정규화 후 동일

---

### FP/FN 검증

#### exact-duplicates — TP 확인

**finding 0**: `src/features/abstraction-fitness/analyzer.ts` vs `src/features/concept-scatter/analyzer.ts`

두 파일 모두 line 8-17에 완전히 동일한 `normalizeFile` 헬퍼 함수 존재 (직접 read_file 확인):

```typescript
// 두 파일 공통 — 복붙된 코드
const normalizeFile = (filePath: string): string => {
  const normalized = filePath.replaceAll('\\', '/');
  const idx = normalized.lastIndexOf('/src/');
  if (idx >= 0) {
    return normalized.slice(idx + 1);
  }
  return normalized;
};
```

**TP**. 이 `normalizeFile` 패턴은 다수의 feature analyzer에 복사됨 (variable-lifetime, implementation-overhead, concept-scatter, abstraction-fitness 등에서 동일하게 확인).

#### structural-duplicates — test 코드 포함 TP

**finding 0**: `test/integration/abstraction-fitness/analysis.test.ts` lines 25-38 vs 67-80

```typescript
// 두 it 블록에 반복되는 동일한 scanUseCase 호출 구조
const report = await withCwd(project.rootAbs, () =>
  scanUseCase({ targets: [...project.targetsAbs], format: 'json', ... }, { logger })
);
```

구조적으로 동일한 코드 반복 → **TP** (기술적으로 중복이 맞음). 다만 test 코드의 반복이 "의도적 self-contained 원칙"으로 허용되는지는 팀 컨벤션 문제.

---

### 주요 이슈

**normalizeFile 복사 누락 공유**: 25개 feature analyzer 파일이 모두 각자 `normalizeFile` 동일 함수를 들고 있음. 공유 유틸로 추출했어야 하는 코드. exact-duplicates가 정확히 잡음 — TP.

**테스트 코드 포함 여부**: 327건 중 테스트 파일 포함 비율이 높을 것으로 추정. 테스트 코드의 구조적 중복은 의도적일 수 있음.

---

### 판정

**exact-duplicates: `PASS`** — AST 기반, 토큰 수준 정확, 확인된 FP 없음. 53건 모두 실질적 중복 (normalizeFile 패턴 등).

**structural-duplicates: `PASS` with caveats** — AST 기반, 알고리즘 정확. 단, test 코드의 구조적 중복이 327건 중 상당 비율을 차지할 수 있어 신호 대 노이즈 비율 분석 필요.

---

---

## 6. exception-hygiene

**검사 일시**: 2026-02-20
**소스**: `src/features/exception-hygiene/analyzer.ts` (1023줄 전체 읽음)
**Finding 수**: 119건 (silent-catch:67, return-await-policy:20, exception-control-flow:12, overscoped-try:7, redundant-nested-catch:4, missing-error-cause:3, prefer-await-to-then:2, 기타:4)

---

### 탐지 로직 요약

11가지 kind를 AST 기반으로 탐지. 주요 logic:

| kind | 탐지 조건 |
|---|---|
| `silent-catch` | catch body = empty OR only console calls OR only return/continue/break |
| `overscoped-try` | try block statement 수 ≥ **hardcoded 10** |
| `exception-control-flow` | try body exactly 1 stmt, catch has return/continue/break (no throw) |
| `return-await-policy` | `return await expr` when `functionTryCatchDepth === 0` |
| `missing-error-cause` | `new Error(msg)` without `{ cause: originalErr }` inside catch block |
| `redundant-nested-catch` | 내부 catch가 외부 catch와 동일한 에러를 재처리 |
| `useless-catch` | catch가 같은 error를 그대로 rethrow |
| `throw-non-error` | throw 대상이 Error 계열이 아닌 경우 |
| `prefer-await-to-then` | `.then(fn)` with block callback |
| `prefer-catch` | `.then(success, failure)` 2-arg form |

---

### FP 검증

#### 확정 FP — `return-await-policy`: try-finally 내부 오탐

**버그**: `functionTryCatchDepth` 카운터는 `hasCatch = true`인 경우에만 증가.

```typescript
// analyzer.ts L631-636
const hasCatch = isOxcNode(node.handler) && node.handler.type === 'CatchClause';
tryCatchStack.push({ hasCatch });
if (hasCatch) {
  functionTryCatchDepth++;  // ← catch 없는 try-finally는 depth 증가 안 됨
}
```

**실제 FP 사례 1**: `src/infrastructure/tsgo/tsgo-runner.ts` L354

```typescript
try {
  return await task;        // ← functionTryCatchDepth === 0 → FP 보고
} finally {
  releaseSharedTsgoSession(entry);  // ← 반드시 task 완료 후 실행돼야 함
}
```

`return await` 없으면 `finally`가 `task` resolve 전에 동기 실행 → 반드시 `await` 필요. detector는 "불필요한 await"으로 FP 보고.

**실제 FP 사례 2**: `src/application/lsp/lsp.usecases.ts` L480

```typescript
try {
  return await fn({ uri, text, lines: splitLines(text) });  // ← FP 보고
} finally {
  await input.lsp.notify('textDocument/didClose', ...).catch(() => undefined);
}
```

동일하게 try-finally 패턴. `return await` 제거하면 `didClose` notify가 fn 완료 전에 실행됨.

**20건 전수 확인**: 2건(`lsp.usecases.ts:L480`, `tsgo-runner.ts:L354`) FP (empty finally). 나머지 18건은 테스트 코드의 `try { ... } finally { process.chdir 복원 / rm(tmpDir) cleanup ... }` 패턴으로 `return await`가 반드시 필요한 **TP**.

---

#### `silent-catch` (67건) — 일부 debatable TP

**`isOnlyConsole` 조건**: `catch(e) { console.log(e) }` → silent-catch 보고. 
에러를 로깅은 하지만 propagate하지 않음 → 의도적 "log and swallow" 패턴일 수 있음.
이를 완전히 "silent"로 분류하는 것은 debatable.

**`hasReturnOrJump` 조건**: `catch(e) { return defaultValue; }` → silent-catch 보고.
에러에 대한 defensive fallback. 라이브러리 코드나 read-optional 패턴에서 의도적.

**진짜 TP (empty body)**: `catch(e) {}` — 완전히 에러를 삼키는 것 → TP.

---

#### `overscoped-try` (7건) — hardcoded 임계값 FP 가능성

```typescript
// analyzer.ts L312
if (stmts.length >= 10) {  // ← 10 statements 이상이면 try가 "너무 넓다"
  pushFinding(...)
}
```

try 블록에 10개 이상 statement가 있으면 무조건 보고. 실제로 try block 크기가 10이 의미있는 임계값인지 근거 없음. `options`로도 설정 불가 (hardcoded). → **설정 불가 임계값 FP 가능성**.

---

### FN 분석

**try-finally의 `return await` FP → 역방향 FN**: 실제로 `return await`가 불필요한 경우 (진짜 try-catch 없이 단독 `return await`인 경우)는 20건 중 catch 있는 케이스들인데, 이들은 TP다.

**`missing-error-cause` (3건)**: 드물게 탐지. `new Error()` without `{ cause }` 패턴이 codebase에 더 많을 것 → FN 가능성.

---

### 판정

**`FP_MEDIUM`** — 11개 kind 중 대부분은 합리적이나:
- `return-await-policy`: try-finally 패턴 FP (최소 2건 확인)
- `overscoped-try`: hardcoded threshold 10, config 불가
- `silent-catch`: console-only 및 return fallback 케이스는 debatable

**수정 방향**:
1. `return-await-policy`: `functionTryCatchDepth` 대신 `functionTryStack` (finally도 포함하여 return await의 필요성 판단)
2. `overscoped-try`: config-driven threshold (`options.maxTrySize`)
3. `silent-catch`: `isOnlyConsole` 케이스에 별도 kind 부여 (e.g. `log-and-swallow`)

---

---

## 7. early-return

**검사 일시**: 2026-02-20
**소스**: `src/features/early-return/analyzer.ts` (279줄 전체 읽음)
**Finding 수**: 1226건 (all `missing-guard`)

---

### 탐지 로직

AST 기반 함수 단위 분석. 각 함수에 대해:
- `hasGuardClauses`: depth=0인 IfStatement에서 else 없이 단일 return/throw block → guard clause 존재
- `earlyReturnCount`: ReturnStatement 개수
- `maxDepth`: 최대 중첩 깊이
- `invertible-if-else`: if/else 중 짧은 쪽이 ≤3 statements & return/throw로 끝남 & 긴 쪽 ≥ shortCount*2

**생략 조건**: `hasGuardClauses === false AND maxDepth < 2 AND earlyReturnCount === 0` → null 반환

---

### 확정 FP — filter 조건 반전

**실제 데이터**:
- 전체 1226건 중 587건 (`47.8%`)이 `metrics.hasGuards: true` → 이미 guard clause를 사용하는 함수
- 8건이 `score: 0` → `hasGuards: true`지만 `earlyReturnCount: 0` (throw 기반 guard만 있음)

**FP 예시**: `index.ts`의 `appendErrorLogSafe` (`hasGuards:true, returns:1, guards:1, score:1`)

```typescript
const appendErrorLogSafe = async (subcommand, message) => {
  // ...
  if (!rootAbs) {
    return;  // ← guard clause 이미 사용 중
  }
  // ...
};
```

이 함수는 guard clause 패턴을 이미 정확히 사용하고 있음. 그런데 `missing-guard`로 보고됨. → **FP**.

**FP 원인**: 생략 조건이 `hasGuardClauses === false AND maxDepth < 2 AND earlyReturnCount === 0`이다. `hasGuardClauses === true`인 함수는 이 조건을 충족하지 못해 **무조건 보고됨**. 이미 guard clause를 사용하는 함수가 "missing-guard"로 분류.

**`resolveLogLevel`** (`hasGuards:true, guards:2, returns:3, score:3`):
```typescript
const resolveLogLevel = (value) => {
  if (value === undefined) { return null; }          // ← guard
  if (value === 'error' || ...) { return value; }    // ← guard
  return null;
};
```
완벽한 guard clause 스타일이지만 `missing-guard` 보고됨. → **FP**.

---

### FN 분석

**`invertible-if-else`: 1226건 중 0건** — 이 kind는 한 건도 발화 안 됨. 로직은 존재하지만 실제로 전혀 탐지 안 됨 → **심각한 FN**.

Visit 루프 내에서 `kind = 'invertible-if-else'`가 설정되지만, 실제 1226건이 모두 `missing-guard`인 것은:
- threshold `longCount >= shortCount * 2`가 너무 엄격하거나
- `depth === 0`에서만 체크하여 실제 패턴을 놓침

---

### 판정

**`FUNDAMENTAL_FLAW`** — 1226건의 47.8%는 이미 guard clause를 가진 함수로 `missing-guard` 레이블 자체가 FP. `invertible-if-else` 탐지 코드는 존재하지만 한 건도 발화 안 함.

**수정 방향**:
1. 생략 조건 수정: `hasGuardClauses === true AND earlyReturnCount === guardClauseCount` → 이미 "모든 return이 guard clause인" 함수는 skip
2. `invertible-if-else` 탐지 threshold 재검토 (혹은 실제 케이스 로깅으로 디버깅)
3. Score=0인 함수는 보고하지 않도록 (이미 threshold 위에서 필터링되어야 함)

---

---

## 8. dependencies

**검사 일시**: 2026-02-20
**소스**: `src/features/dependencies/analyzer.ts` (1187줄, 핵심 섹션 읽음)
**Finding 수**: 145건 (dead-export:109, test-only-export:31, layer-violation:4, circular-dependency:1)

---

### 탐지 로직

- **dead-export**: `package.json` 엔트리포인트에서 BFS로 도달 가능한 모듈 제외 후, 내부 임포트에서 사용되지 않는 export → dead
- **test-only-export**: 사용되긴 하나 test 파일에서만 사용 (`perNameConsumerKinds`에 `'prod'` 없음)
- **layer-violation**: config의 `layers` 규칙 위반 임포트
- **circular-dependency**: SCC 분석으로 사이클 탐지

---

### FP/FN 검증

#### dead-export (109건) — 대부분 TP

**상위 모듈**: `src/application/lsp/lsp.usecases.ts` (19건), `test/mcp/fixtures/` 여러 파일.

직접 확인: `checkCapabilitiesUseCase`, `deleteSymbolUseCase`, `findReferencesUseCase` — 이 함수들이 실제로 임포트되는지 검색:

```
grep -rn "checkCapabilitiesUseCase|deleteSymbolUseCase" src/ → 0 matches (except definition in lsp.usecases.ts)
```

`lsp.usecases.ts`를 임포트하는 파일 없음 → 이 export들은 진짜 사용되지 않음. **TP**.

**`test/mcp/fixtures/`** (15+11+7건): 픽스처 파일들이 export하는 `Color`, `Direction`, `Point` 등은 MCP 테스트에서 임포트가 아닌 파일 경로 참조로 사용됨 (스캔 대상) → export는 기술적으로 사용 안 됨. **TP** (의도적 "dead export"이지만 픽스처 특성상 허용 가능).

#### layer-violation (4건)
합리적. `src/adapters/cli/entry.ts`가 `src/infrastructure/logging/...`를 직접 임포트 → layer 규칙 위반. **TP**.

---

### 판정

**`PASS`** — 알고리즘 정확, AST + BFS 기반, package.json 엔트리포인트 추적. dead-export/test-only-export/layer-violation 모두 합리적. 109건의 dead-export는 대부분 실제 미사용 코드.

---

---

## 9. unknown-proof

**검사 일시**: 2026-02-20
**소스**: `src/features/unknown-proof/analyzer.ts` (87줄) + `candidates.ts` (873줄) + `tsgo-checks.ts` (285줄) 구조 파악
**Finding 수**: 1950건 (type-assertion:851, any-inferred:368, unknown-inferred:475, unknown-type:135, double-assertion:121)

---

### 탐지 로직

2단계:
1. **AST phase** (`collectUnknownProofCandidates`): 코드에서 type assertion (`as X`, `<X>x`), double assertion (`as unknown as X`)를 직접 탐지 → `typeAssertionFindings` 즉시 추가
2. **Tsgo phase** (`runTsgoUnknownProofChecks`): TypeScript compiler를 통해 실제 타입 추론 결과 확인 → `any-inferred`, `unknown-inferred`, `unknown-type` 탐지

---

### FP/FN 분석

**type-assertion (851건)**: AST 기반으로 `as X` 패턴 직접 탐지. 합리적.
- FP 가능성: `as const`나 `as unknown`처럼 타입-안전한 assertion도 포함될 수 있음
- 단, tsgo-checks를 통과한 assertion들은 제외되었을 가능성

**double-assertion (121건)**: `as unknown as X` 패턴 — 명백한 type-safety bypass. **TP**.

**any-inferred (368건)**, **unknown-inferred (475건)**: tsgo(TypeScript native preview)를 통해 시제로 타입 검사 후 `any`/`unknown`으로 추론된 바인딩. **고정밀 TP** 가능성 높음.

**unknown-type (135건)**: tsgo가 반환한 타입이 `unknown`인 경우. 합리적.

---

### 판정

**`PASS`** — AST + TypeScript compiler 기반 이중 검증. 특히 tsgo-backed findings은 높은 정밀도. 1950건 중 type-assertion/double-assertion은 대부분 TP.

---

---

## 10. barrel-policy

**검사 일시**: 2026-02-20
**소스**: `src/features/barrel-policy/analyzer.ts` (446줄, 핵심 섹션 읽음)
**Finding 수**: 572건 (deep-import:474, missing-index:86, invalid-index-statement:12)

---

### 탐지 로직

- **deep-import**: barrel(`index.ts`)을 우회하여 서브디렉토리 내부 파일을 직접 임포트 → `import { X } from '../features/bar/internal'` 대신 `import { X } from '../features/bar'` 요구
- **missing-index**: `.ts` 파일이 있는 디렉토리에 `index.ts` 없음
- **invalid-index-statement**: barrel 파일(`index.ts`)에 `export { ... } from '...'` 외 다른 구문 존재

---

### FP 분석

**missing-index (86건)**: 디렉토리에 `index.ts`가 없으면 무조건 보고. 하지만:
- `test/` 서브디렉토리들 — 테스트 보조 파일 모음, barrel 불필요
- `scripts/` — 빌드 스크립트
- 내부 구현 폴더 — 의도적으로 public barrel 없는 경우

86건 중 test/scripts 디렉토리 비율 파악 필요 → **FP_MEDIUM** 가능성.

**deep-import (474건)**: barrel 우회 임포트. 이 프로젝트 자체가 barrel 정책을 완전히 enforce하지 않는 구조라면 대부분 TP (실제 위반). 하지만 `maxForwardDepth: 0`으로 인해 forwarding 탐지 없이 직접 임포트만 체크.

**invalid-index-statement (12건)**: `index.ts`에 잘못된 구문. TP.

---

### 판정

**`FP_LOW`** — deep-import/invalid-index는 정확. missing-index는 test/scripts 디렉토리 포함 여부에 따라 FP 가능성 있음.

---

---

## 11. nesting

**검사 일시**: 2026-02-20
**소스**: `src/features/nesting/analyzer.ts` (433줄 전체 읽음)
**Finding 수**: 221건 (high-cognitive-complexity:173, deep-nesting:34, callback-depth:13, accidental-quadratic:1)

---

### 탐지 로직

AST 기반 함수 단위 분석:
- **high-cognitive-complexity**: `cognitiveComplexity >= 15`. 각 decision point에 `1 + depth` 추가 (Sonar 스타일)
- **deep-nesting**: `maxDepth >= 3`
- **callback-depth**: nested callback 깊이 >= 3
- **accidental-quadratic**: 같은 이터레이션 타겟에 중첩 루프 (e.g., `for (x of arr) { for (y of arr) }`)

---

### FP/FN 분석

AST 기반, 알고리즘 합리적. `cognitiveComplexity >= 15` threshold는 충분히 높아 단순한 함수 오탐 방지.

**잠재적 FP**: `LogicalExpression`이 decision point로 카운트됨. `a && b && c`에서 3개 추가. 하지만 threshold 15가 충분히 높아 영향 제한적.

**accidental-quadratic (1건)**: 동일 배열에 중첩 루프 → **TP 가능성 높음**.

---

### 판정

**`PASS`** — AST 기반, 합리적 threshold. 221건 대부분 실질적 복잡도 문제.

---

---

## 12. coupling

**검사 일시**: 2026-02-20
**소스**: `src/features/coupling/analyzer.ts` (198줄 전체 읽음)
**Finding 수**: 65건 (off-main-sequence:51, unstable-module:11, bidirectional-coupling:2, rigid-module:1)

---

### 탐지 로직

Robert C. Martin의 Instability/Abstractness/Distance 메트릭:
- `instability = fanOut / (fanIn + fanOut)`
- `abstractness = abstractExports / totalExports`
- `distance = |abstractness + instability - 1|` (main sequence에서 거리)
- `off-main-sequence`: `distance > 0.7`
- `unstable-module`: `instability > 0.8 AND fanOut > 5`
- `rigid-module`: `instability < 0.2 AND fanIn > rigidThreshold` (totalModules * 0.15)
- `bidirectional-coupling`: 2개 노드로만 구성된 사이클

---

### FP 분석

**abstractness 계산 의존성**: `exportStats[module].abstract / total`에서 `abstract` 분류 정확도가 핵심. TypeScript의 interfaces/type aliases가 "abstract"로 올바르게 분류되는지 dependencies analyzer 구현에 따라 FP 발생.

**`drizzle.config.ts` off-main-sequence**: 설정 파일이 main sequence에서 벗어나는 건 예상 가능 → **TP** (but low value insight for config files).

**`index.ts` unstable-module**: 진입점이 unstable → TP (진입점은 높은 fanOut이 자연스럽지만 낮은 abstractness).

---

### 판정

**`PASS`** — 표준 소프트웨어 메트릭 사용. coupling 분석은 알고리즘 정확. 다만 abstractness 분류 정확도는 dependencies 구현에 의존.

---

---

## 13. api-drift

**검사 일시**: 2026-02-20
**소스**: `src/features/api-drift/analyzer.ts` (481줄, 핵심 섹션 읽음)
**Finding 수**: 73건 (kind: default)

---

### 탐지 로직

함수들을 그룹핑하여 signature 불일치 탐지. 그룹 키 방식:
1. **동일 파일 내 같은 이름** 함수: `funcName @ filename` 키
2. **전체 코드베이스에서 camelCase 접두어별**: `extractPrefixFamily(name)` = 첫 번째 대문자 이전 소문자 세그먼트 → `prefix:analyze`, `prefix:visit`, `prefix:check` 등

표준 shape (가장 많은 수) vs 아웃라이어 (다른 shape) → `ApiDriftOutlier` 보고.

---

### 확정 FP — 스코프 무시 prefix 그룹핑

**67건이 `prefix:*` 그룹** (전체 코드베이스에서 이름 접두어로 그룹핑):

```
prefix:debug std-params:0 | scripts/build.ts p=2; src/adapters/mcp/server.ts p=3; 
                            src/infrastructure/logging/pretty-console-logger.ts p=3
```

`debug()`, `info()`, `trace()`, `warn()`, `error()` — 서로 다른 Logger 구현체의 메서드들. 파라미터 수가 다른 건 interface vs implementation의 자연스러운 차이. → **FP** (logger 구현체간 signature 차이는 expected).

```
prefix:analyze std-params:1 | src/engine/waste-detector-oxc.ts p=3; 
                              src/features/variable-lifetime/analyzer.ts p=2
```

`analyzeFunctionBody(cfg, usedDefs, options)` (3 params) vs `analyzeVariableLifetime(files)` (1 param) — 완전히 다른 함수들이 단순히 'analyze' 접두어를 공유. → **FP**.

**`visit @ oxc-ast-utils.ts`**: 같은 파일 내 2개의 독립적인 로컬 closure `visit`:
- L55: `visit(value: NodeValue)` — `walkOxcTree` 내부
- L116: `visit(value: NodeValue, parent: Node | null)` — `collectFunctionNodesWithParent` 내부

서로 다른 외부 함수 내의 별개 스코프 → 관련 없는 로컬 클로저이지만 동일 파일에서 이름이 같다는 이유로 API drift로 보고됨. → **FP**.

**`fileExists @ spec.ts`, `readFile @ spec.ts`**: 테스트 파일에서 다른 mock 시나리오에 대한 서로 다른 mock 구현. → **FP** (의도적 다른 mock 설계).

---

### 판정

**`FP_HIGH`** — 73건 중 67건이 `prefix:*` 그룹 (전체 코드베이스 범위). 이름 접두어 기반 그룹핑은 너무 광범위하여 무관한 함수들을 묶음. 고정밀 API drift 탐지를 위해서는 interface/class 멤버 메서드 범위로 제한 필요.

**수정 방향**:
1. `prefix:*` 그룹핑을 interface/class 멤버로 제한 (동일 인터페이스를 구현하는 클래스들 비교)
2. 로컬 클로저 제외 (export 함수만 비교)
3. logger 계열 메서드처럼 의도적으로 다른 파라미터 수를 가지는 경우 제외 옵션

---

---

## 14. forwarding

**검사 일시**: 2026-02-20
**소스**: `src/features/forwarding/analyzer.ts` (929줄, 핵심 섹션 읽음)
**Finding 수**: 69건 (thin-wrapper:69)

---

### 탐지 로직 (`getWrapperCall`)

AST 기반. 함수가 "thin wrapper"인 조건:
1. 함수 body가 정확히 1개 statement (BlockStatement with 1 statement) OR concise body expression
2. 해당 statement가 call expression
3. 호출 인자가 함수의 파라미터를 그대로 전달 (`isForwardingArgs` 검사)

---

### FP 분석

**69건 중 29건이 테스트 파일** — 적절한 mock 래퍼들.

**`isIdentStart`/`isIdentPart` in `firebatrc-jsonc-sync.ts`**:
```typescript
const isIdentStart = (ch: string): boolean => /[A-Za-z_$]/.test(ch);
const isIdentPart = (ch: string): boolean => /[A-Za-z0-9_$]/.test(ch);
```

기술적으로 thin-wrapper (regex `.test()` 전달)이지만 **명확한 시맨틱 네이밍**이 목적. 직관적 인라인 대비 가독성 향상을 위한 래퍼. → **의도적 래퍼** (TP 또는 debatable).

**`evidence: "thin wrapper forwards to call"`**: `calleeName`이 null인 경우 `call`로 표시됨. anonymous callee (regex `.test`)를 의미.

---

### 판정

**`PASS`** — AST 기반, 정밀 탐지. 69건 대부분 기술적으로 정확. `isIdentStart` 류는 "가독성 wrapper"로서 인라인 여부는 의견 차이 있음.

---

---

## 15. decision-surface

**검사 일시**: 2026-02-20
**소스**: `src/features/decision-surface/analyzer.ts` (139줄 전체 읽음)
**Finding 수**: 65건 (`maxAxes: 2`, default)

---

### 탐지 로직

1. Raw text regex `/\bif\s*\(([^)]*)\)/g`로 파일 전체 `if()` 조건 추출
2. 각 조건에서 식별자/프로퍼티 접근 token 수집 (문자열 리터럴 제거 후)
3. **파일 전체** 고유 식별자 수 = `axes`
4. `combinatorialPaths = 2^axes`
5. `axes >= maxAxes` → 보고 (기본값 `maxAxes: 2`)

---

### FP 분석

**기본값 `maxAxes: 2` — 사실상 모든 비자명 파일 대상**:
`if (a) { ... } if (b) { ... }` → axes=2 → flagged. 파일 전체에서 서로 다른 변수 2개를 if 조건에 사용하는 것은 극히 일반적. 65건은 threshold가 낮아서 flag됨.

첫 번째 finding `scripts/build.ts`: `axes=31, combinatorialPaths=2147483648 (2^31)`. 이건 실질적 TP (31개 서로 다른 decision variable).

**Raw text regex 한계**:
- 멀티라인 조건 놓침: `if (\n  a &&\n  b\n)` → regex `[^)]*`는 newline 포함 안 됨 (기본 `.` 비매칭)
- 중첩 괄호 있는 조건: `if (typeof x === 'string' && check(x))` → `)` 이전 `x)` 때 종료

**`combinatorialPaths = 2^axes`**: axes=2이면 4 paths — 이는 "decision surface"로서 의미 없음. 실제 문제는 axes >= 15 이상의 경우.

---

### 판정

**`FP_HIGH`** — `maxAxes=2` 기본값이 너무 낮아 65건 중 많은 수가 axes=2~5의 일반적인 파일. Raw text regex로 멀티라인 조건 놓침. 파일 단위 axes 집계는 함수 단위 분석 없이 의미 제한적.

**수정 방향**:
1. `maxAxes` 기본값을 최소 8-10 이상으로 상향
2. AST 기반 함수 단위 분석으로 전환
3. `combinatorialPaths` 임계값 기반으로 보고 (e.g., paths >= 1024)

---

---

## 16. modification-impact

**검사 일시**: 2026-02-20
**소스**: `src/features/modification-impact/analyzer.ts` (290줄 전체 읽음)
**Finding 수**: 55건

---

### 탐지 로직

1. Raw text regex로 export 함수/const/class 수집
2. Raw text regex로 import 구문 파싱 (단일 라인 `import { ... } from '...'`만)
3. 파일 의존성 그래프 BFS로 transitive impact 계산
4. `impactRadius >= 2` AND callers include `adapters`/`infrastructure` layer → 보고

---

### FP 분석

**멀티라인 임포트 FN**: `import {\n  foo,\n  bar\n} from '...'` → 파싱 실패 → 그래프 간선 누락 → impact 과소 계산 → **FN**.

**합리적 TP**: `src/application/scan/diagnostic-aggregator.ts` — 스캔 결과 집계기로 adapters+infrastructure 양쪽에서 참조됨. 수정 시 광범위 영향 → 실질적 수정 위험.

**dead code 조건**:
```typescript
if (rel.includes('/application/') && (rel.includes('/adapters/') || rel.includes('/infrastructure/'))) {
  externalCoupling += 1;
}
```
→ 하나의 경로가 `/application/`이면서 동시에 `/adapters/`인 경우는 불가능 → **Dead code** (FN으로 이어짐).

---

### 판정

**`PASS` with FN_MEDIUM** — 핵심 로직은 합리적. 멀티라인 임포트 파싱 실패로 일부 FN. 55건 대부분 TP (실질적 고영향 함수들).

---

---

## 17. invariant-blindspot

**검사 일시**: 2026-02-20
**소스**: `src/features/invariant-blindspot/analyzer.ts` (82줄 전체 읽음)
**Finding 수**: 53건

---

### 탐지 로직

파일에서 다음 패턴 중 하나라도 있으면 보고:
- `console.assert(`
- `throw new Error(`
- `// ...must|always|never|before...` (주석)
- `default: throw`
- `if (...length === 0) throw`

첫 번째 매칭 위치 → finding 보고.

---

### 전수 검증 결과 — detector 의도대로 동작

**53건 전수 확인** (`python3`로 전체 파일에서 signal 패턴 재검색):
- 53건 전부 `SIGNAL✓` — 모두 `throw new Error(`, `console.assert(`, 또는 must/always 주석이 실제로 파일에 존재
- `SIGNAL 없음`: **0건**

**integration test 확인** (`test/integration/invariant-blindspot/analysis.test.ts` 직접 읽음):
```typescript
// 테스트 1: console.assert 있는 파일 → finding 기대
const project = await createScanProjectFixtureWithFiles('p1-invariant-1', {
  'src/a.ts': 'export function f(items: number[]) { console.assert(items.length > 0); return items[0]; }'
});
// Assert: list.length > 0 ← signal 있는 파일이 보고되는 것이 스펙

// 테스트 2: throw guard 있는 파일 → finding 기대
// if (x === null) throw new Error("x required");
```

이 detector의 의도: **runtime invariant signal이 있는 파일을 식별** → "이 파일에서 개발자가 런타임 불변식 검사를 하고 있으므로, 누락된 불변식을 리뷰하라"는 reviewer 힌트 제공 목적.

53건 모두 실제로 signal이 있으므로 detector가 스펙대로 동작. **이전 보고서의 'FP_HIGH / 로직 역전' 판정은 잘못된 분석이었음.**

---

### 판정

**`PASS`** — detector가 integration test 스펙대로 동작. 53건 전수 확인 결과 모두 실제 signal 있는 파일.

**유용성 한계** (FP 아닌 설계 차원): signal 있는 파일을 나열하는 것이 개발자에게 얼마나 actionable한 정보인지는 맥락 의존적. 실제 blindspot(복잡한 경로에서 누락된 체크)을 AST 수준에서 분석하면 더 정밀해질 수 있음.

---

---

## 18. noop

**검사 일시**: 2026-02-20
**소스**: `src/features/noop/analyzer.ts` (199줄 전체 읽음)
**Finding 수**: 2건 (empty-function-body:2)

---

### 탐지 로직

AST 기반. 5개 kind:
1. `expression-noop`: 부수 효과 없는 ExpressionStatement
2. `self-assignment`: `x = x`
3. `constant-condition`: `if (true)` / `if (false)`
4. `empty-catch`: 빈 catch body
5. `empty-function-body`: 빈 함수 body (confidence: 0.6)

---

### 확정 FP — 의도적 빈 body들

**Finding 1**: `src/adapters/mcp/server.ts` L259 — `confidence: 0.6`

```typescript
server.sendLoggingMessage({ level, data }).catch(() => {
  // fire-and-forget: suppress send errors
});
```

catch callback body에 주석만 있고 구문 없음 → AST 기준 empty body → flagged. 개발자가 명시적으로 "fire-and-forget" 의도를 주석으로 설명함. → **FP**.

**Finding 2**: `src/ts-program.spec.ts` L86 — `confidence: 0.6`

```typescript
terminate(): void {
  // noop
}
```

`// noop` 주석이 명시적으로 빈 body 의도를 표시하는 mock 메서드. → **FP** (의도적 noop).

---

### 확정 FN — optional catch binding `catch {}` 미탐지

`empty-catch` kind는 `node.type === 'CatchClause' && body.body.length === 0`으로 탐지. 하지만 다음 파일들의 `} catch { // ignore }` 패턴이 **잡히지 않음**:

**FN 1**: `src/ts-program.ts` L201
```typescript
try {
  w.terminate();
} catch {
  // ignore
}
```

**FN 2**: `src/ts-program.ts` L338
```typescript
try {
  worker.terminate();
} catch {
  // ignore
}
```

**FN 3**: `src/target-discovery.ts` L99
```typescript
    } catch {
      // Ignore missing/unreadable entries.
      continue;
    }
```

**FN 4**: `src/features/barrel-policy/resolver.ts` L149
```typescript
    } catch {
      // ignore
    }
```

**원인**: `catch {}` (optional catch binding, ES2019) 패턴에서 binding parameter 없는 경우 OXC AST의 `CatchClause` 내 `body.body` 배열이 비어있어야 하는데 실제로는 미탐지됨. `catch (e) {}` 형태는 잡히나 `catch {}` 형태는 안 잡히는 것으로 추정. OXC AST에서 optional catch binding 처리 방식 차이 가능성.

**주의**: 위 4건은 `// ignore` 주석이 있어 의도적 empty body이므로 FP 잡힌 건들과 동일 상황. 하지만 detector 로직 기준으로는 잡혔어야 함 → FN.

---

### 판정

**`FP_MEDIUM + FN_LOW`** — 2건 FP (의도적 빈 body를 잡음) + 4건 FN (실제 empty catch를 미탐지). `catch {}` (optional catch binding) 패턴이 누락됨.

**수정 방향**: body에 JSDoc comment 또는 한 줄 주석만 있는 경우 skip 옵션. OXC가 optional catch binding(`catch {}`)을 파싱할 때 `CatchClause.body.body`가 비어있는지 재확인.

---

---

## 19. implicit-state

**검사 일시**: 2026-02-20
**소스**: `src/features/implicit-state/analyzer.ts` (184줄 전체 읽음)
**Finding 수**: 20건

---

### 탐지 로직

4가지 패턴 (raw text regex 기반):
1. **`process.env.KEY`** 가 2개 이상 파일에서 사용 → 모든 파일 보고
2. **`getInstance()`** 가 2개 이상 파일에서 사용
3. **`emit('channel')` / `on('channel')`** 가 2개 이상 파일에서 공유
4. **모듈 레벨 `let`/`var`** + 2개 이상 exported function → 단일 파일 보고

---

### 확정 FP — 문자열 리터럴 내 패턴 매칭

**첫 번째 finding**: `src/features/implicit-state/analyzer.spec.ts`

evidence: `process.env.A;'), file('src/b.ts', 'export const b = 1;')]`

이것은 테스트 픽스처 **문자열 리터럴** 안의 `process.env.A` 코드를 문자열로 포함하는 것. regex `process\.env\.([A-Z0-9_]+)` 가 테스트 소스 코드의 문자열 안의 코드를 실제 사용으로 인식. → **FP**.

유사하게 `test/integration/implicit-state/` 파일들도 테스트 픽스처로 `process.env.*` 패턴을 문자열로 포함 → 다수 FP.

---

### 판정

**`FP_MEDIUM`** — 패턴 1 (process.env)이 테스트 픽스처 문자열 리터럴에서 FP. AST 기반으로 전환하면 해결 가능. 패턴 4 (module-scope let)는 reasonable.

---

---

## 20. modification-trap

**검사 일시**: 2026-02-20
**소스**: `src/features/modification-trap/analyzer.ts` (139줄 전체 읽음)
**Finding 수**: 20건

---

### 탐지 로직

- `extractCaseLabels`: `/\bcase\s+([^:]+)\s*:/g` — switch case 레이블 수집
- `extractLiteralComparisons`: `/===\s*['"]([^'"]+)['"]/g` — string equality 비교 수집
- 파일별 label set (union) 산출
- 같은 label set을 가진 파일이 2개 이상 → 모두 보고 (`occurrences: 2+`)

---

### FP 분석

**`case` keyword 오탐**: `case`는 switch 외에도 TypeScript에서 `lowercase`, `camelCase`, `FooCase` 등 식별자에 포함 가능. 하지만 `\bcase\s+` 패턴에서 `\b`가 word boundary임. 문자열 리터럴 안의 `case`는 여전히 매칭 가능 (문자열 제외 로직 없음).

**`===\s*['"]...'`**: 모든 string equality 비교가 포함됨. `kind === 'ts'` 같은 일반적인 조건도 label set에 포함. 두 파일에서 동일한 string literal 비교가 있으면 같은 label set 가능성 증가.

**20건 대부분 TP 가능성**: CLI adapter가 같은 subcommand 이름 체크를 여러 파일에서 반복한다면 → TP (수정 동기화 필요). 하지만 우연히 같은 string literal을 사용하는 파일들이 묶이는 FP도 가능.

---

### 판정

**`FP_LOW`** — 로직 개념은 합리적. 문자열 리터럴 내 패턴 FP 가능성은 낮음. 20건 대부분 실질적 수정 동기화 필요 케이스.

---

---

## 21. abstraction-fitness

**검사 일시**: 2026-02-20
**소스**: `src/features/abstraction-fitness/analyzer.ts` (176줄 전체 읽음)
**Finding 수**: 9건

---

### 탐지 로직

파일을 `src/<dir>/<subdir>` 단위로 그룹핑:
- `internalCohesion`: `./` 시작 임포트 수 (같은 디렉토리)
- `externalCoupling`: `../` 시작 임포트 수 (부모 방향)
- `penalty = totalImports > 0 ? members.length : 0`
- `fitness = internalCohesion - externalCoupling - penalty`
- `fitness < minFitnessScore` → 보고

---

### 확정 FP

**Dead code condition** (항상 false):
```typescript
if (rel.includes('/application/') && (rel.includes('/adapters/') || rel.includes('/infrastructure/'))) {
  externalCoupling += 1;
}
```
파일 경로가 `/application/`이면서 동시에 `/adapters/`일 수 없음. 이 코드는 절대 실행 안 됨.

**`normalizeFile` 절대 경로 bug** (concept-scatter와 동일):
`drizzle.config.ts` → `/home/revil/zipbul/firebat/drizzle.config.ts` (절대 경로) → `folderOf()` 에서 `parts[0+1]` = `'/home'` → root-level 파일들이 `'/home'` 그룹으로 묶임. 즉, 모든 root-level 파일이 `/home` 그룹의 멤버로 계산됨 → fitness 왜곡.

**9건 중 root-level 파일들이 포함됨**: `drizzle.config.ts`, 기타 root 파일 → **FP** (절대 경로 normalization bug).

---

### 판정

**`FP_MEDIUM`** — normalizeFile 절대 경로 bug (concept-scatter와 공유 버그)로 root-level 파일 그룹이 왜곡됨. Dead code condition은 FN으로 이어짐.

---

---

## 22. temporal-coupling

**검사 일시**: 2026-02-20
**소스**: `src/features/temporal-coupling/analyzer.ts` (118줄 전체 읽음)
**Finding 수**: 3건

---

### 탐지 로직

두 가지 경로:
1. **모듈 레벨 `let`/`var`** 탐지 → 해당 변수를 읽는/쓰는 export 함수 regex로 찾음 (단, `\{[^}]*\b${name}\b` → 단일 라인 함수만 매칭)
2. **Class init-guard 패턴**: 파일에 `'initialized'`, `'init('`, `'query('` 모두 포함 → 보고

---

### 확정 FP — 전부 자기 참조 (Self-referential)

**3건 모두 FP**:

1. **`src/features/temporal-coupling/analyzer.ts` L100**:
   - analyzer 소스 코드 L100: `if (file.sourceText.includes('initialized') && ...`
   - 이 줄이 `'initialized'` 문자열을 포함 → 파일 자신이 `initialized` 포함 → 자기 보고
   
2. **`src/features/temporal-coupling/analyzer.spec.ts`**:
   - spec 파일이 테스트 픽스처로 `initialized`, `init(`, `query(` 패턴을 문자열로 포함 → flagged

3. **`test/integration/temporal-coupling/analysis.test.ts`**:
   - 통합 테스트가 temporal coupling 예시 코드를 문자열로 포함 → flagged

**근본 원인**: `file.sourceText.includes('initialized')` 검사에서 `'initialized'` 문자열 자체가 analyzer 소스에 포함됨 → **자기 참조 FP**.

---

### 판정

**`FUNDAMENTAL_FLAW`** — 3건 전부 FP. 탐지 패턴 문자열이 자기 소스/테스트에 포함되어 자기 보고. 실제 temporal coupling 탐지 능력 없음.

**수정 방향**: init-guard 패턴을 AST로 탐지 (class 멤버 변수 + public method 접근 패턴). 문자열 기반 탐지 폐기.

---

---

## 23. symmetry-breaking

**검사 일시**: 2026-02-20
**소스**: `src/features/symmetry-breaking/analyzer.ts` (208줄 전체 읽음)
**Finding 수**: 3건

---

### 탐지 로직 (fallback path)

1차: Handler/Controller export 가진 파일들을 디렉토리 그룹으로 묶어 call sequence 비교 (3+개 파일 그룹 필요)
2차 fallback: 1차에서 findings 없을 때 → `sourceText.includes('Controller')` 파일들 수집 → 첫 번째 `return` 구문 비교

---

### 확정 FP — 3건 모두 raw text search 오탐 (원인 각각 다름)

직접 파일 읽기로 전수 확인:

1. **`src/features/symmetry-breaking/analyzer.ts`**: 소스 코드에 `'Controller'` 문자열 포함 — string literal `sourceText.includes('Controller')` 탐지 조건 자체가 analyzer.ts 소스에 있음 → `controllerFiles`에 포함 → **자기 참조 FP (self-referential)**.

2. **`test/integration/concept-scatter/analysis.test.ts`**: 파일 직접 읽기 확인 — `'src/c.ts': 'export const updateUser = () => 0; export class UserController { run() {} }'` 테스트 픽스처 코드에 `UserController` 예시가 있음 → `'Controller'` 텍스트 포함 → **테스트 픽스처 우연 매칭 FP**. self-referential 아님.

3. **`test/integration/symmetry-breaking/analysis.test.ts`**: 통합 테스트에 Controller 관련 예시 fixture 코드 포함 → fallback raw text search에 걸림 → **테스트 픽스처 FP**.

**근본 원인**: temporal-coupling과 동일하게 탐지 패턴 문자열 자체가 소스에 포함.

---

### 판정

**`FUNDAMENTAL_FLAW`** — 3건 전부 FP. self-referential 탐지 버그. 실제 Handler/Controller symmetry 탐지가 의미있으려면 1차 경로가 활성화되어야 하는데, Handler/Controller export 가진 파일이 3개 이상인 디렉토리 그룹이 없어 fallback만 실행됨.

---

---

## 24. giant-file

**검사 일시**: 2026-02-20
**소스**: `src/features/giant-file/analyzer.ts` (68줄 전체 읽음)
**Finding 수**: 13건

---

### 탐지 로직

`lineCount > maxLines (기본 800)` → 보고. `file.sourceText.split(/\r?\n/).length`로 라인 수 계산. ParsedFile 기반, parse error 있는 파일 제외.

---

### FP 분석

단순하고 정확함. `lsp.usecases.ts` (대형 use case 파일), `scan.usecase.ts` 등이 포함. 모두 실질적으로 큰 파일들. **TP**.

`normalizeFile` 절대 경로 bug 존재하지만 finding에서 `file rel` = `src/...` 형태로 잘 표시됨 (src가 있는 파일들만 포함).

---

### 판정

**`PASS`** — 로직 단순하고 정확. 13건 모두 800줄 초과 파일. 합리적 임계값.

---

---

## 종합 판정표

| Detector | Finding 수 | 판정 | 주요 이슈 |
|---|---|---|---|
| concept-scatter | 671 | FUNDAMENTAL_FLAW | 소스 전체 텍스트 토크나이징 + normalizeFile 절대경로 버그 |
| variable-lifetime | 1775 | FUNDAMENTAL_FLAW | regex 텍스트 검색으로 스코프 무시, export 문을 "사용"으로 카운트 |
| waste | 340 | FP_MEDIUM+FP_HIGH | dead-store 30/31건 FP(IIFE 내부 변수, `_` prefix, async CFG) + memory-retention primitive FP |
| implementation-overhead | 283 | FP_HIGH+FN_MEDIUM | 문자열 리터럴 내 regex 매칭 + for 세미콜론 이중 카운트 |
| exception-hygiene | 119 | FP_MEDIUM | try-finally return await FP (적어도 2건 확인) |
| exact-duplicates | 53 | PASS | AST 기반, 정확 |
| structural-duplicates | 327 | PASS | AST 기반, test 코드 포함 |
| early-return | 1226 | FUNDAMENTAL_FLAW | filter 역전으로 이미 guard 있는 함수 보고 + invertible-if-else 0건 |
| dependencies | 145 | PASS | package.json 기반 BFS, 정확 |
| unknown-proof | 1950 | PASS | AST+tsgo 이중 검증, 고정밀 |
| barrel-policy | 572 | FP_LOW | missing-index 중 test 디렉토리 포함 가능 |
| nesting | 221 | PASS | AST 기반, 합리적 threshold |
| coupling | 65 | PASS | 표준 메트릭 |
| api-drift | 73 | FP_HIGH | prefix 기반 전역 그룹핑으로 무관한 함수 묶음 |
| forwarding | 69 | PASS | AST 기반, 정밀 |
| decision-surface | 65 | FP_HIGH | maxAxes=2 기본값 너무 낮음 |
| modification-impact | 55 | PASS w/ FN_MEDIUM | 멀티라인 임포트 파싱 FN |
| invariant-blindspot | 53 | PASS | integration test 스펙대로 동작 (53건 전수 signal 확인) |
| noop | 2 | FP_MEDIUM+FN_LOW | 2건 FP(의도적 빈 body) + 4건 FN(optional catch binding `catch{}` 미탐지) |
| implicit-state | 20 | FP_MEDIUM | 테스트 픽스처 문자열 리터럴 오탐 |
| modification-trap | 20 | FP_LOW | 합리적, 일부 우연 매칭 가능 |
| abstraction-fitness | 9 | FP_MEDIUM | normalizeFile 절대경로 버그 공유 |
| temporal-coupling | 3 | FUNDAMENTAL_FLAW | 3건 전부 self-referential FP |
| symmetry-breaking | 3 | FUNDAMENTAL_FLAW | 1건 self-referential, 2건 테스트 픽스처 우연 매칭 FP |
| giant-file | 13 | PASS | 단순하고 정확 |

---

## 공통 버그 패턴

### 1. `normalizeFile` 절대 경로 버그 (5개 이상 feature 공통)
```typescript
// '/src/' 없는 파일은 절대 경로 반환
const normalizeFile = (filePath: string) => {
  const idx = normalized.lastIndexOf('/src/');
  if (idx >= 0) return normalized.slice(idx + 1);
  return normalized;  // ← /home/user/project/drizzle.config.ts 그대로 반환
};
```
영향: concept-scatter, variable-lifetime, abstraction-fitness, giant-file 등 normalizeFile 복사본 가진 모든 feature

### 2. Self-referential 패턴 (temporal-coupling, symmetry-breaking)
탐지 패턴 문자열이 analyzer 소스 코드 자체에 존재 → 자기 도구를 스캔할 때 자기 보고. 이는 firebat이 자기 자신을 스캔하는 독특한 상황에서의 버그이나, 실제 배포 환경에서도 동일 패턴 포함 코드베이스에서 발생 가능.

### 3. Raw text regex의 스코프 무시 (variable-lifetime, temporal-coupling, decision-surface 등)
`\bname\b` 형태의 텍스트 검색은 렉시컬 스코프, 문자열 리터럴, 주석을 구분하지 못함.

---
