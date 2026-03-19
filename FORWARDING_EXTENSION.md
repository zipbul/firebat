# indirection + barrel-policy 확장 계획

> **작성일**: 2026-03-19
>
> **상태**:
> - **Part 1 (indirection)**: ✅ **구현 완료** (2026-03-19). 실증 검증 통과.
> - **Part 2 (barrel-policy)**: 방향 결정됨, 별도 심층 논의 필요
>
> **Part 1 구현 완료 사항**:
> - `walkOxcTreeWithParent()` 유틸 구현 (`src/engine/ast/oxc-ast-utils.ts`)
> - analyzer 레벨 `.d.ts` 파일 방어 체크 추가
> - `crossFileMinDepth` 필드 Zod 스키마 및 `FirebatIndirectionConfig`에 추가, CLI `--cross-file-min-depth` 플래그 추가
> - gildash `searchSymbols` — `kind` 필터 미사용, 클라이언트 측 name 매칭으로 처리
> - class-interface declaration merging 감지 추가 (오픈소스 실증에서 FP 발견 → 수정)
>
> **Part 1 실증 검증 결과** (2026-03-19):
>
> | 프로젝트 | 파일 수 | type-remap | interface-rewrap | FP |
> |---|---|---|---|---|
> | firebat 자체 | 239 | 2 TP | 0 | 0 |
> | zod v4 | 277 | 8 TP | ~100 TP (nominal type 패턴) | 0 |
> | trpc | 683 | 3 TP | 27 TP | 0 |
> | drizzle-orm | ~400 | 8 TP | 6 TP | 0 |
>
> **FP 0%. precision 목표(< 5%) 달성.**
>
> **구현 후 검증 필요 (Part 2)**:
> - scope-aware 로컬 사용 판별: 알고리즘 sound, oxc-parser AST scope 경계 엣지케이스 구현 시 확인
> - "부모→자식" 기준 precision: 실제 프로젝트 실증 필요 (firebat 자체 + 오픈소스 3개 + 바이브코딩 샘플, FP < 5% 목표)
>
> **Part 2 미논의 사항**:
> - barrel-policy 기존 코드(`analyzer.ts`, `resolver.ts`)와의 통합 방식
> - `ImportResolver` 재활용 구체 방안
> - `collectImportLikes()`에 cross-module 체크를 추가하는 방식 vs 별도 pass
>
> **관련**: `ARBITRARY_CRITERIA_AUDIT.md` A-17, `src/features/indirection/analyzer.ts`, `src/features/barrel-policy/analyzer.ts`

---

## 배경

바이브코딩(AI 코드 생성)에서 불필요한 중간 계층이 빈번하게 발생한다:
- 함수 thin-wrapper (기존 indirection이 탐지)
- type/interface remap (미탐지)
- 모듈 밖 re-export (미탐지)

업계 도구(SonarQube, ESLint, Biome, Knip, oxlint)는 "불필요한 re-export 중간 계층"을 직접 탐지하지 않는다:
- **Knip**: 소비 여부만 봄 — 소비되면 통과
- **Biome/oxlint**: `export *` 금지 또는 barrel 파일 자체 금지
- **eslint-plugin-import**: unused export만 탐지
- **barrel-begone**: 모듈 로딩 비용 정량화
- **@typescript-eslint**: `no-type-alias` deprecated, 순수 remap만 잡는 규칙 없음
- **@typescript-eslint/oxlint**: `no-empty-interface` 존재하지만 indirection 맥락과 다름

firebat의 차별점: 기존 도구가 안 잡는, AI가 만드는 불필요한 indirection을 탐지.

---

## 기능 경계 설계

두 가지 레벨의 indirection을 **별도 디텍터**에서 탐지한다.

| 레벨 | 디텍터 | 관심사 |
|------|--------|--------|
| **코드 레벨** | indirection | 함수/타입/인터페이스의 무가치 래핑 |
| **모듈 레벨** | barrel-policy | 모듈 경계를 넘는 re-export 구조 위반 |

근거: cross-module-reexport는 barrel-policy와 AST 파싱, 경로 resolve, ignore globs, 모듈 경계 판단이 전부 겹친다. barrel-policy에 합치면 기존 tsconfig resolver를 재활용하여 alias(`@/models/user`) 문제도 즉시 해결된다.

---

## Part 1: indirection 확장

### 1-1. type-remap (추가)

**탐지 조건** (모두 만족):

```
node.type === 'TSTypeAliasDeclaration'
AND node.declare === false
AND node.typeAnnotation.type === 'TSTypeReference'
AND node.typeAnnotation.typeArguments === null
AND node.typeParameters === null
```

oxc-parser 실제 파싱으로 검증 완료 (2026-03-19). `declare type A = B`는 `declare: true`로 파싱됨.

**분류**: Fact

**탐지/제외 검증표**:

| 패턴 | typeAnnotation | typeArgs | typeParams | 판정 |
|------|---------------|----------|------------|------|
| `type A = B` | TSTypeReference | null | null | ✅ 탐지 (remap) |
| `export type A = B` | TSTypeReference | null | null | ✅ 탐지 (exported remap도 remap) |
| `type Node = ts.Node` | TSTypeReference (TSQualifiedName) | null | null | ✅ 탐지 (namespace 단축 remap) |
| `type UserId = string` | TSStringKeyword | — | — | ❌ 자동 제외 (TSTypeReference 아님) |
| `type StringArray = Array<string>` | TSTypeReference | `<string>` | null | ❌ 제외 (generic 고정 = 가치) |
| `type ReadonlyUser = Readonly<User>` | TSTypeReference | `<User>` | null | ❌ 제외 (utility type 적용) |
| `type MyArray<T> = Array<T>` | TSTypeReference | `<T>` | `<T>` | ❌ 제외 (generic 전달) |
| `type A = B \| null` | TSUnionType | — | — | ❌ 자동 제외 |
| `type A = B & { x: 1 }` | TSIntersectionType | — | — | ❌ 자동 제외 |
| `type Config = typeof x` | TSTypeQuery | — | — | ❌ 자동 제외 |
| `type Keys = keyof User` | TSTypeOperator | — | — | ❌ 자동 제외 |
| `type Name = User['name']` | TSIndexedAccessType | — | — | ❌ 자동 제외 |
| `` type E = `on${string}` `` | TSTemplateLiteralType | — | — | ❌ 자동 제외 |
| `type T = { x: number }` | TSTypeLiteral | — | — | ❌ 자동 제외 |

**primitive 제외 로직 불필요**: oxc-parser에서 `string`, `number`, `boolean` 등은 `TSStringKeyword`, `TSNumberKeyword` 등 별도 노드. `TSTypeReference` 체크만으로 자동 필터링.

**카탈로그 코드**: `FWD_TYPE_REMAP`

---

### 1-2. interface-rewrap (추가)

**탐지 조건** (모두 만족):

```
node.type === 'TSInterfaceDeclaration'
AND node.extends.length >= 1
AND node.body.body.length === 0
AND node.declare === false
AND parent가 TSModuleBlock이 아님 (module augmentation 제외)
AND 동명 interface가 같은 파일 내에 2회 이상 선언되지 않음 (same-file merging 제외)
AND 동명 interface가 다른 파일에 없음 (cross-file declaration merging 제외)
```

oxc-parser 실제 파싱으로 검증 완료 (2026-03-19):
- `declare module 'express' { interface Request extends Base {} }` → 내부 interface의 `declare`가 **`false`**로 파싱됨
- `declare === false` 체크만으로는 module augmentation 제외 불가 → parent `TSModuleBlock` 체크 필수

**parent 추적 구현**: 현재 `walkOxcTree()`는 parent를 콜백에 전달하지 않음. 구현 방안:
- (A) `walkWithParent(program, (node, parent) => ...)` 유틸 신규 추가 (~30줄)
- (B) walk 시 수동 parent stack 관리 (scopeStack과 유사 패턴)
- (C) `walkOxcTree`에 optional 2번째 인자 `parent` 추가 (기존 소비자 호환)

**분류**: Fact

**탐지/제외 검증표**:

| 패턴 | extends 수 | body | declare | 판정 |
|------|-----------|------|---------|------|
| `interface A extends B {}` | 1 | 비어있음 | false | ✅ 탐지 |
| `interface A extends B, C {}` | 2 | 비어있음 | false | ✅ 탐지 (빈 껍데기) |
| `interface A extends BaseRepo<User> {}` | 1 | 비어있음 | false | ✅ 탐지 |
| `interface A extends B { x: number }` | 1 | 멤버 있음 | false | ❌ 제외 |
| `interface A {}` (marker) | 0 | 비어있음 | false | ❌ 제외 (extends 없음) |
| `declare interface A extends B {}` | 1 | 비어있음 | true | ❌ 제외 (ambient) |
| `interface Express extends Base {}` (다른 파일에 동명 존재) | 1 | 비어있음 | false | ❌ 제외 (cross-file merge 대상) |
| `interface Foo extends Bar {}` + 같은 파일에 `interface Foo { x: number }` | 1 | 비어있음 | false | ❌ 제외 (same-file merge 대상) |

**declaration merging 판별 (2단계)**:

1. **same-file merging**: AST walk 시 파일 내 interface 이름을 `Map<name, count>`로 수집. count >= 2면 해당 이름의 빈 interface를 skip. gildash 불필요, 순수 AST 분석으로 해결.

2. **cross-file merging**: gildash `searchSymbols({ kind: 'interface', text: name, exact: true })` 조회. 현재 파일 외 다른 파일에서 동명 interface가 발견되면 skip. 파일당 1회 batch 조회 후 Set 구축하여 비용 최소화.

**gildash `kind` 필터 폴백**: gildash API가 `kind` 파라미터를 지원하지 않는 경우, `searchSymbols({ text: name, exact: true })`로 조회 후 `.filter(s => s.kind === 'interface')`로 클라이언트 측 필터링. 성능 차이 미미 (파일당 batch 1회).

**다중 extends 포함 근거**: `interface A extends B, C {}`의 body가 비면 `type A = B & C`와 동일. extends가 1개든 5개든 body가 비면 새로운 가치를 추가하지 않는 빈 껍데기.

**잔여 FP**: 미래 확장 의도로 빈 interface를 미리 만들어두는 경우. 정적 분석으로 판별 불가. 업계 도구(@typescript-eslint, oxlint)도 동일 한계.

**카탈로그 코드**: `FWD_INTERFACE_REWRAP`

---

### 1-3. A-17 해결: depth < 2 configurable 전환

현재 `analyzer.ts` L761의 `if (entry.depth < 2) { continue; }` 하드코딩을
`.firebatrc.jsonc`의 `indirection.crossFileMinDepth`로 설정 가능하게 전환.

기본값 2 유지. `FirebatIndirectionConfig` 인터페이스 + Zod schema 추가.

**기존 `maxForwardDepth`와의 관계**:
- `maxForwardDepth`: 단일 파일 내 forward-chain의 최대 허용 깊이 (초과 시 보고). 기존.
- `crossFileMinDepth`: cross-file-forwarding-chain의 최소 보고 깊이 (미달 시 skip). 신규.
- 두 설정은 독립적이며 적용 대상이 다름 (단일 파일 vs 크로스파일).

**Zod 스키마 설계**:
```ts
indirection: z.object({
  maxForwardDepth: z.number().int().min(0).optional(),
  crossFileMinDepth: z.number().int().min(1).optional(),  // min(1): depth=0은 chain이 아니므로 보고 가치 없음
}).strict()
```

**CLI 옵션**: `--cross-file-min-depth <number>` 추가. 기존 `--max-forward-depth`와 병존.

**카탈로그 코드**: 기존 `FWD_CROSS_FILE_CHAIN` 유지.

---

### 1-4. indirection 전체 finding kind 목록

| kind | 분류 | 상태 | depth | evidence 패턴 |
|------|------|------|-------|---------------|
| `thin-wrapper` | code smell | 기존 유지 | 1 | `thin wrapper forwards to ${calleeName}` |
| `forward-chain` | code smell | 기존 유지 | 체인 깊이 | `forwarding chain depth ${depth} exceeds max ${max}` |
| `cross-file-forwarding-chain` | code smell | 기존 유지 + configurable | 체인 깊이 / -1 (cycle) | `cross-file forwarding chain depth ${depth}` (비-cycle) / `circular forwarding chain detected` (cycle) |
| `type-remap` | Fact | **추가** | 1 (고정) | `type alias ${name} is a direct synonym for ${targetName}` |
| `interface-rewrap` | Fact | **추가** | 1 (고정) | `interface ${name} extends ${baseName} with empty body` |

type-remap과 interface-rewrap은 chain이 아닌 standalone finding이므로 `depth: 1` 고정. `IndirectionFinding.depth`는 기존 required 필드를 유지하되, chain이 아닌 finding에서는 항상 1.

---

## Part 2: barrel-policy 확장

### 2-1. cross-module-reexport (추가)

**탐지 기준**: re-export의 source 경로가 모듈 밖(`../`)을 가리키면 탐지.

> **부모가 자식을 re-export → 허용. 동일 depth 또는 상위를 re-export → Fact.**

**구현 방법**: barrel-policy의 기존 `collectImportLikes()` + `ImportResolver`를 활용.

**두 가지 구문을 모두 탐지한다:**

#### 구문 A: `export from` (직접 re-export)

```ts
export { User } from '../models/user';
export type { OrderId } from '../order/types';
```

1. `ExportNamedDeclaration`에 `source`가 있으면 re-export
2. `ImportResolver.resolve(source)`로 절대경로 획득
3. resolved 경로가 현재 파일의 디렉토리 하위(`./`)가 아니면 cross-module

#### 구문 B: `import + export` (간접 re-export)

```ts
import type { User } from '../models/user';
export type { User };  // source 없음 — export from 으로 안 잡힘
```

바이브코딩에서 가장 흔한 패턴. AI가 import 먼저 쓰고 나중에 export를 붙인다.

1. `ExportNamedDeclaration`에 `source`가 **없으면** 로컬 export
2. export된 이름이 import된 심볼인지 확인 (import 목록과 매칭)
3. 해당 import가 모듈 밖(`../`)인지 확인 (구문 A와 동일 기준)
4. **X가 파일 내에서 export 외에 로컬 사용이 없는지 확인** — 로컬 사용이 있으면 정당한 import+export

4번이 핵심. 로컬에서도 쓰고 export도 하면 정당:

```ts
import type { User } from '../models/user';
const defaultUser: User = { name: 'test' };  // 로컬 사용 있음
export type { User };  // → 허용 (로컬 사용 + export)
```

로컬 사용 없이 export만 하면 `export from`과 동일한 무가치 indirection:

```ts
import type { User } from '../models/user';
export type { User };  // → 탐지 (로컬 사용 없음, 순수 pass-through)
```

**로컬 사용 판별 알고리즘 — scope-aware** (oxc-parser 실제 파싱으로 검증 완료):

full type checker가 아닌 **name binding만 추적하는 간소화된 scope resolver**.

```
1. 파일의 모든 import 바인딩을 수집 → importedNames: Map<name, source>

2. scope-aware AST walk:
   - scopeStack: Array<Set<name>> 관리
   - module level → scopeStack = [∅]
   - function/block 진입 → push(해당 scope의 local declarations)
     · VariableDeclarator.id, FunctionDeclaration.id, ClassDeclaration.id,
       TSTypeAliasDeclaration.id, TSInterfaceDeclaration.id, Parameter 등
   - function/block 퇴장 → pop
   - ExportNamedDeclaration.specifiers → SKIP (export specifier 자체가 Identifier)
   - ExportDefaultDeclaration.declaration이 Identifier → SKIP
   - 그 외 Identifier('X') 만났을 때:
     · scopeStack을 top→bottom으로 탐색
     · 현재~최근접 scope에 X 선언이 있으면 → shadow, skip (import X와 무관)
     · scope stack에 X 선언이 없으면 → module-level import X 사용으로 카운트
   → importUsedLocally: Set<name>

3. 각 export specifier name에 대해:
   - importedNames에 있고 (import된 심볼)
   - importedNames.get(name)의 source가 모듈 밖이고 (../ 또는 resolver로 판별)
   - importUsedLocally에 없으면 (export 외 로컬 사용 없음)
   → 탐지
```

**scope analysis가 필요한 근거**:

```ts
import { X } from '../other';
function foo() { const X = 1; use(X); }  // shadow — import X와 무관
export { X };
```

- scope-aware 없이: `use(X)`가 import X 사용으로 오판 → FN (탐지 누락)
- scope-aware 있으면: `const X = 1`이 function scope에서 shadow → `use(X)`는 로컬 X → import X는 미사용 → 정확히 탐지

**검증된 엣지케이스**:

| 케이스 | 처리 | 근거 |
|--------|------|------|
| `export { X }` specifier의 Identifier | **SKIP** | oxc-parser가 specifier.local에 Identifier를 넣음. 수집하면 모든 export가 "사용됨"으로 오판 |
| `function foo() { const X = 1; use(X); }` (shadow) | **scope로 정확 판별** | function scope에 X 선언 → `use(X)`는 로컬 X, import X 미사용 |
| `const x: User = ...` (타입 annotation) | 로컬 사용으로 카운트 | Identifier가 AST에 존재. 타입으로든 값으로든 사용하면 정당한 import |
| `{ const X = 1; } use(X);` (블록 밖 사용) | import X 사용으로 카운트 | 블록 scope pop 후 X 선언 없음 → module import |

#### 구문 C: `import + export default` (default 간접 re-export)

```ts
import Foo from '../other';
export default Foo;  // ExportDefaultDeclaration — ExportNamedDeclaration과 다른 노드 타입
```

`export default X`는 `ExportDefaultDeclaration`이므로 구문 A, B와 별도 처리 필요.

1. `ExportDefaultDeclaration`의 `declaration`이 `Identifier`인지 확인
2. 해당 Identifier가 import된 심볼인지 확인 (import 목록과 매칭)
3. 해당 import가 모듈 밖(`../`)인지 확인 (동일 기준)
4. **파일 내에서 export 외 로컬 사용이 없는지 확인** (구문 B와 동일)

`export default <expression>`이 Identifier가 아니면 변환이 있으므로 탐지 대상 아님:

```ts
import Foo from '../other';
export default new Foo();      // → 허용 (생성자 호출 = 변환)
export default Foo.create();   // → 허용 (메서드 호출 = 변환)
export default { ...Foo };     // → 허용 (spread = 변환)
```

**barrel-policy resolver 재활용의 이점**:
- tsconfig paths alias (`@/models/user`) → resolver가 절대경로로 변환 → 정확 판별
- bare specifier (`'express'`) → resolver가 null 반환 → 자동 제외 (npm 패키지 facade 정당)
- workspace 패키지 → resolver가 workspace 경로로 변환 → 정확 판별

**분류**: Fact

**적용 대상**:

| 구문 | 적용 | 근거 |
|------|------|------|
| `export { X } from '../...'` | ✅ | 구문 A: 값 re-export |
| `export type { X } from '../...'` | ✅ | 구문 A: 타입 re-export |
| `export * from '../...'` | ✅ | 구문 A: 기존 `export-star` 규칙과 별개 (경로 기준) |
| `export * as Ns from '../...'` | ✅ | 구문 A: 동일 |
| `export { X as Y } from '../...'` | ✅ | 구문 A: rename이어도 밖에서 끌어오는 것 자체가 문제 |
| `import { X } from '../...'; export { X }` | ✅ | 구문 B: X 로컬 미사용 시 탐지 |
| `import type { X } from '../...'; export type { X }` | ✅ | 구문 B: 동일 |
| `export { X } from './child'` | ❌ 허용 | 부모→자식 = barrel |
| `import { X } from './child'; export { X }` | ❌ 허용 | 부모→자식 (구문 B도 동일 기준) |
| `export { X } from 'lodash'` | ❌ 허용 | npm 패키지 facade |
| `import { X } from 'lodash'; export { X }` | ❌ 허용 | npm 패키지 facade |
| `export { X } from '@/models/user'` | resolver로 판별 | alias가 `../`이면 탐지, `./`이면 허용 |
| `import { X } from '../...'; export { X }` (X 로컬 사용 있음) | ❌ 허용 | 로컬에서도 쓰는 정당한 import+export |
| `import X from '../...'; export default X` | ✅ | 구문 C: X 로컬 미사용 시 탐지 |
| `import X from '../...'; export default X` (X 로컬 사용 있음) | ❌ 허용 | 로컬에서도 쓰는 정당한 import+export default |
| `import X from '../...'; export default new X()` | ❌ 허용 | 변환 있음 (Identifier가 아님) |
| `import X from './child'; export default X` | ❌ 허용 | 부모→자식 |

**13개 시나리오 검증** (resolver 적용 후):

| # | 시나리오 | resolved 경로 방향 | 판정 | noise |
|---|---------|-------------------|------|-------|
| 1 | 단순 barrel (`./service`) | 자식 | 허용 | 없음 |
| 2 | AI 타입 허브 (`../models/user`) | 상위 | 탐지 | 없음 |
| 3 | rename (`../../internal/...`) | 상위 | 탐지 | 없음 |
| 4 | 다중 소비자 통합 (`./connection`) | 자식 | 허용 | 없음 |
| 5 | cross-module (`../order/types`) | 상위 | 탐지 | 없음 |
| 6 | package entry (`./scanner`) | 자식 | 허용 | 없음 |
| 7 | 자체 선언 + re-export (`./local`) | 자식 | 허용 | 없음 |
| 8 | 깊은 chain | 방향에 따라 | 혼합 | — |
| 9 | 자체 코드 + re-export (`./service`) | 자식 | 허용 | 없음 |
| 10 | monorepo (`@app/core`) | resolver로 판별 | 탐지 | 없음 |
| 11 | test barrel (`../fixtures/user`) | 상위 | glob 제외 | 없음 |
| 12 | default→named (`./Button`) | 자식 | 허용 | 없음 |
| 13 | namespace (`./user`) | 자식 | 허용 | 없음 |

**영구 noise: 0개.**

**기존 barrel-policy 규칙과의 관계**:

| 기존 규칙 | 관심사 | 겹침 |
|-----------|--------|------|
| `export-star` | `export *` 구문 자체 금지 | 별개 — 구문 vs 경로 |
| `deep-import` | barrel 우회 import | 별개 — import vs export |
| `missing-index` | barrel 파일 부재 | 없음 |
| `invalid-index-statement` | barrel에 비-re-export 코드 | 없음 |
| `barrel-side-effect-import` | barrel 내 side-effect | 없음 |

**카탈로그 코드**: `BARREL_CROSS_MODULE_REEXPORT`

---

### 2-2. barrel-policy 전체 finding kind 목록

| kind | 상태 |
|------|------|
| `export-star` | 기존 유지 |
| `deep-import` | 기존 유지 |
| `index-deep-import` | 기존 유지 |
| `missing-index` | 기존 유지 |
| `invalid-index-statement` | 기존 유지 |
| `barrel-side-effect-import` | 기존 유지 |
| `cross-module-reexport` | **추가** |

---

## 설계 결정 사항

### 의도적 제외

| 항목 | 제외 사유 |
|------|-----------|
| **class empty extends** (`class A extends B {}`) | 런타임 의미 있음 (instanceof, DI 등록, 데코레이터 타겟). interface와 달리 빈 body에도 가치 존재 |
| **`.d.ts` 파일 전체** | declaration 파일은 API surface 정의 목적, 자동 생성 가능. remap이 아닌 타입 선언 계약. analyzer 레벨에서 `file.filePath.endsWith('.d.ts')` 방어 체크 추가 (상위 레이어 의존 방지) |
| **`declare type` / `declare interface`** | ambient declaration은 외부 타입 보강 목적. AST에서 `declare === true` 체크로 제외 |
| **`./sibling` re-export (비-index 파일)** | `./` 경로는 허용. 비-index 파일의 `./` re-export는 빈도 낮고 FN 허용 가능. index 제한을 추가하면 barrel-policy `invalid-index-statement`과 역할 겹침 |
| **순환 remap** (`type A = B` + `type B = A`) | 각각 type-remap으로 잡히면 충분. 순환 자체는 TypeScript 컴파일러가 에러로 잡음 |
| **type-assertion wrapper** (`return f(x) as Type`) | 컴파일 타임 타입 판단을 명시적으로 표현. 런타임 동일하지만 제거 시 호출부 타입 에러 유발 가능. 모듈 경계 타입 안전성 목적 사용이 지배적. FP 높음 |
| **factory function** (`return new Foo(x)`) | `new` 호출을 래핑. 호출 규약 변경(new 추가), DI/테스트 mock/함수형 API 등 의도적 사용 지배적. FP 높음 |

### 두 디텍터 동시 hit 정책

`import type { B } from '../other'; export type A = B;` — indirection이 type-remap으로 탐지.
`export type { B } from '../other';` — barrel-policy가 cross-module-reexport로 탐지.

같은 심볼이 양쪽에 잡히면 **둘 다 보고**. 관심사가 다르다 (코드 레벨 remap vs 모듈 레벨 구조 위반). 에이전트가 둘 중 하나로 해결하면 나머지도 자연 소멸.

### path comparison 알고리즘

```
currentDir = path.dirname(currentFilePath)  // 정규화된 절대경로
isChild = resolvedPath.startsWith(currentDir + '/')

isChild → 허용 (부모→자식)
!isChild → 탐지 (cross-module)
resolver 반환 null → 제외 (bare specifier, npm 패키지)
```

Windows path: `normalizePath()` (backslash → forward slash)로 정규화 후 비교. barrel-policy resolver에 동일 처리가 되는지 확인 필요, 누락 시 추가.

### declaration merging 체크 전략 (2단계)

**Step 1: same-file merging (순수 AST, gildash 불필요)**

1. 파일 진입 시 AST walk로 모든 `TSInterfaceDeclaration`의 이름을 `Map<name, count>`로 수집
2. count >= 2인 이름을 `sameFileMergeNames: Set<string>`에 추가
3. 빈 interface 검사 시 `sameFileMergeNames.has(name)` → true면 skip

**Step 2: cross-file merging (gildash batch query)**

1. Step 1에서 skip되지 않은 빈 interface 이름만 수집
2. 이름별 `searchSymbols({ kind: 'interface', text: name, exact: true })` 1회 호출 (kind 미지원 시 클라이언트 필터)
3. 현재 파일 외 다른 파일에서 동명 interface 발견 시 `crossFileMergeNames: Set<string>`에 추가
4. 개별 interface 검사 시 Set lookup — O(1)

### diagnostic-aggregator 메시지

```ts
FWD_TYPE_REMAP: {
  cause: "A type alias is a direct synonym for another named type, adding no type-level transformation.",
  think: [
    "Check whether the alias was introduced for a future extension that never happened.",
    "If the alias is exported, verify that removing it does not break downstream consumers who import this type.",
    "Check whether the alias provides a shorter name for a deeply qualified namespace path (e.g., `type Node = ts.Node`) — if so, consider whether the project convention favors named imports over namespace access.",
    "Replace all usages of the alias with the original type and remove the alias.",
  ],
},

FWD_INTERFACE_REWRAP: {
  cause: "An interface extends another type but declares no additional members, making it a pure synonym.",
  think: [
    "Check whether declaration merging is intended — another file may add members to this interface.",
    "If this interface is part of a plugin or extension API where consumers are expected to augment it via declaration merging, keep it.",
    "If no merging exists, replace all usages with the base type and remove the interface.",
  ],
},

BARREL_CROSS_MODULE_REEXPORT: {
  cause: "A file re-exports a symbol from outside its own module boundary, creating an unnecessary indirection layer.",
  think: [
    "Identify all consumers of this re-export and redirect them to import from the original source.",
    "Verify that removing the re-export does not break the module public API contract.",
  ],
},
```

---

## 테스트 전략

### 기존 로직 보강 (구현 전 필수)

현재 `analyzer.spec.ts`에 4개 테스트만 존재. 확장 전 기존 로직의 regression 감지를 위해 보강:

**cross-file-forwarding-chain** (gildash mock으로 import/export index 시뮬레이션):
- 2-hop chain (A→B→C across files) — depth=2 → 보고
- 1-hop chain — depth=1 → skip (depth < 2)
- circular chain (A→B→A) — depth=-1 → 보고
- non-cycle entry pointing to cycle (D→A, A in cycle) — D skip
- exported function만 cross-file 추적, non-exported는 무시

**AST 계약 테스트** (oxc-parser 업그레이드 시 regression 감지):
```ts
it('oxc-parser — TSTypeAliasDeclaration field names', () => {
  const ast = parseSource('test.ts', 'type A = B;');
  // typeAnnotation, typeParameters, declare 필드 존재 및 값 검증
});

it('oxc-parser — TSInterfaceDeclaration field names', () => {
  const ast = parseSource('test.ts', 'interface A extends B {}');
  // extends, body.body, declare 필드 존재 및 값 검증
});
```

### Unit (`*.spec.ts`, 소스와 같은 디렉토리)

**type-remap** (`indirection/analyzer.spec.ts`):
- 14개 패턴 검증표 전수 (탐지 3 — 포함: exported remap, 제외 11)
- `.d.ts` 파일 제외
- `declare type` 제외

**interface-rewrap** (`indirection/analyzer.spec.ts`):
- 8개 패턴 검증표 전수 (탐지 3, 제외 5 — 포함: same-file merging)
- same-file declaration merging 제외 (순수 AST, gildash 불필요)
- cross-file declaration merging 제외 (gildash mock)
- module augmentation 내부 interface 제외 (parent 체크)
- `declare interface` 제외
- 다중 extends + 빈 body 탐지

**cross-module-reexport** (`barrel-policy/analyzer.spec.ts`):

구문 A (`export from`):
- 13개 시나리오 (허용 7, 탐지 4, glob 제외 1, 혼합 1)
- tsconfig alias resolve (`@/models/user` → 절대경로 → 판별)
- bare specifier 제외 (`'express'` → null → 제외)
- `export type { X } from '../...'` 탐지
- `export * from '../...'` 탐지
- `export { X as Y } from '../...'` rename 탐지

구문 B (`import + export`):
- `import { X } from '../...'; export { X }` — X 로컬 미사용 → 탐지
- `import { X } from '../...'; export { X }` — X 로컬 사용 있음 → 허용
- `import type { X } from '../...'; export type { X }` — 로컬 미사용 → 탐지
- `import { X } from './child'; export { X }` — 자식 경로 → 허용
- `import { X } from 'lodash'; export { X }` — bare specifier → 허용
- `import { X, Y } from '../...'; export { X }` — X 미사용 + Y 사용 → X만 탐지

scope-aware 엣지케이스:
- `import { X } from '../...'; function foo() { const X = 1; use(X); } export { X }` — shadow → import X 미사용 → 탐지
- `import { X } from '../...'; { const X = 1; } use(X); export { X }` — 블록 밖 use → import X 사용 → 허용

구문 C (`import + export default`):
- `import X from '../...'; export default X` — X 로컬 미사용 → 탐지
- `import X from '../...'; export default X` — X 로컬 사용 있음 → 허용
- `import X from '../...'; export default new X()` — 변환 있음 → 허용
- `import X from './child'; export default X` — 자식 경로 → 허용

**A-17 configurable** (`indirection/analyzer.spec.ts`):
- depth 1, 2, 3 각각 config 변경 후 검증

### Integration (`test/`)

- 실제 프로젝트 구조에서 두 디텍터 동시 scan → 중복 보고 없음 검증
- type-remap + cross-module-reexport 동일 심볼 → 각각 별도 finding 검증
- `.firebatrc.jsonc` config 적용 → `crossFileMinDepth` 변경 반영 검증

### 실증 검증 (구현 후)

"부모→자식" 기준은 firebat 고유 기준이며 학술적으로 정립된 기준이 아니다. 구현 후 실제 프로젝트에서 precision/recall을 측정해야 한다.

**대상 finding kind**: type-remap, interface-rewrap, cross-module-reexport (3개 모두 실증 대상).

| 대상 | 목적 |
|------|------|
| firebat 자체 코드베이스 | self-hosting 검증 — 자기 자신에 대해 FP/FN 확인 |
| 오픈소스 TypeScript 프로젝트 3개 이상 | 다양한 아키텍처에서 precision 측정 |
| 바이브코딩 생성 코드 샘플 | 핵심 타겟에서 recall 측정 |

precision 목표: FP < 5%. 미달 시 기준 재조정 또는 configurable 전환.

**type-remap 주요 FP 관찰 포인트**: namespace 단축 remap (`type Node = ts.Node`), exported remap (공개 API surface).
**interface-rewrap 주요 FP 관찰 포인트**: 미래 확장 의도 빈 interface, plugin/extension API augmentation 대상.

---

## 폐기 확정 항목

| 항목 | 폐기 사유 |
|------|-----------|
| `const x = y` remap 탐지 | temp var 구분 불가. waste/variable-lifetime이 이미 커버 |
| `enum` remap 탐지 | 실질적으로 미발생, 패턴 복잡 |
| re-export 전체 Signal | 85% 영구 noise. 3원칙 #2 위반 |
| re-export를 indirection에 구현 | barrel-policy와 인프라 중복 (resolver, globs). barrel-policy 확장이 적절 |

---

## 알려진 한계

### gildash query limit

`buildImportIndex`와 `buildExportIndex`에서 `limit: 100_000` 하드코딩 (analyzer.ts L492, L524). 대규모 monorepo에서 import 관계 또는 exported symbol이 100,000을 초과하면 일부 누락 가능. interface-rewrap의 declaration merging 체크가 추가되면 gildash 의존도가 증가하여 영향 확대.

현 단계에서는 한계로 명시. 향후 필요 시 pagination 또는 configurable limit으로 전환.

### 정적 분석 고유 한계

| 한계 | 설명 | 대응 |
|------|------|------|
| 미래 의도 판별 불가 | 빈 interface가 미래 확장을 위해 의도적으로 작성된 경우 | think guidance에서 사용자에게 위임 |
| namespace remap DX 가치 판단 | `type Node = ts.Node`이 prefix 반복 회피 목적인 경우 | think guidance에서 프로젝트 관례 확인 권고 |
| exported remap breaking change | 공개 API의 type alias 제거 시 소비자 영향 | think guidance에서 소비자 확인 권고 |

이 한계는 업계 모든 정적 분석 도구가 공유하는 본질적 한계이며, think guidance를 통해 사용자에게 판단을 위임하는 것이 표준 접근.

---

## 논의 과정에서 확인된 사항

### re-export Signal 폐기 → Fact 승격 과정

1. re-export를 Signal로 보고하면 에이전트가 "정당하다"고 판단한 항목이 매 scan마다 재등장
2. 13개 시나리오 중 11개(85%)가 영구 noise → 3원칙 #2 위반
3. "부모→자식" 기준 도입으로 정당한 barrel이 자동 허용됨 → noise 0%
4. Fact로 승격 가능

### 업계 도구 조사 결과

| 도구 | re-export 접근 | "불필요한 re-export" 판별 |
|------|---------------|------------------------|
| SonarQube | 없음 | 없음 |
| ESLint (import plugin) | unused export만 | 소비 여부만 |
| eslint-plugin-barrel-files | barrel 자체 금지 | 구분 없이 전면 금지 |
| Knip | 프로젝트 그래프 | 소비 여부만 |
| oxlint | `export *` 모듈 수 threshold | 양적 기준만 |
| Biome | barrel 파일 금지 / `export *` 금지 | 구분 없음 |
| barrel-begone | 로딩 비용 정량화 | 구분 없음 |

"부모→자식" 경로 방향으로 불필요한 re-export를 판별하는 접근은 **firebat 고유**.

### type remap 업계 비교

| 도구 | 규칙 | 순수 remap 탐지 |
|------|------|-----------------|
| @typescript-eslint | `no-type-alias` (deprecated) | 전면 금지 방식, 실용적이지 않음 |
| SonarQube | 없음 | 없음 |
| Biome | 없음 | 없음 |
| oxlint | 없음 | 없음 |

`typeArguments === null` 조건으로 generic 고정/적용을 제외하는 정밀 탐지는 **firebat 고유**.

### interface rewrap 업계 비교

| 도구 | 규칙 | 동작 |
|------|------|------|
| @typescript-eslint | `no-empty-interface` → `no-empty-object-type` | 단일 extends 탐지, `allowSingleExtends` 옵션 |
| oxlint | `typescript/no-empty-interface` | 동일 |
| Biome | `noEmptyInterface` | extends 있으면 제외 |

firebat는 단일/다중 extends 모두 탐지 + declaration merging 제외 (gildash 활용)로 차별화.

### `type A = B`와 `const x = y`의 차이

- `type A = B` — 런타임 효과 없음, 100% 구조적 판단 가능
- `const x = y` — temp var일 수 있음, waste/variable-lifetime이 이미 커버
- 따라서 type remap만 indirection에서 탐지, 변수는 기존 디텍터에 위임

---

## 학술적 근거 수준

각 탐지 항목의 근거를 정확히 명시한다. 학술 논문이 없는 것을 있다고 주장하지 않는다.

### type-remap

- **직접 논문**: 없음
- **이론적 근거**: 타입 이론에서 structural identity — `type A = B`는 A와 B가 수학적으로 동일한 타입. GHC Core에서 type synonym은 변환 시 완전 제거(expansion)됨
- **업계 도구**: `@typescript-eslint/no-type-alias` (deprecated, 전면 금지 방식)
- **firebat 차별점**: `typeArguments === null` 조건으로 generic 적용을 제외하는 정밀 탐지. 업계에 동등한 규칙 없음

### interface-rewrap

- **직접 논문**: 없음
- **간접 논문**: "Unnecessary Hierarchy" 설계 냄새 (Suryanarayana et al., 2014 — 교재), "Refused Bequest" 코드 냄새 (Fowler)
- **업계 도구**: Microsoft CA1040 "Avoid empty interfaces", `@typescript-eslint/no-empty-interface` → `no-empty-object-type`
- **firebat 차별점**: 다중 extends 포함 + declaration merging 제외 (gildash 활용). 업계 도구에 없는 안전장치

### cross-module-reexport

- **직접 논문**: 없음
- **간접 논문**:
  - Paltoglou et al. (2021) "Automated Refactoring of Legacy JavaScript Code to ES6 Modules" — named import로 전환 시 모듈 결합도 감소 실증 (arXiv:2107.10164)
  - Liu et al. (2024) "Detecting and removing bloated dependencies in CommonJS packages" — 50.6% 의존성이 불필요함을 실증 (arXiv:2405.17939)
  - Malavolta et al. (2023) "JavaScript Dead Code Identification, Elimination, and Empirical Assessment" — 정적+동적 분석 결합 F-score 87.9% (IEEE TSE)
- **"부모→자식" 기준**: 학술적으로 정립된 기준이 아닌 firebat 고유 기준. layered architecture 원칙에서 유도. 13개 시나리오 시뮬레이션으로 noise 0% 검증

### 로컬 사용 판별 알고리즘

- **직접 이론**: Live Variable Analysis (Dragon Book, Aho et al.), Scope Graph (Konat et al. 2012 Springer, Zwaan & van Antwerpen 2023 OASIcs)
- **알고리즘 soundness**: conservative approximation — shadow 변수를 "사용됨"으로 간주하여 FN 방향 보수적. FP 없음
- **export specifier SKIP**: oxc-parser 실제 파싱으로 필요성 검증 완료 (2026-03-19)
