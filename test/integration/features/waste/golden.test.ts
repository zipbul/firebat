import { describe } from 'bun:test';

import { detectWaste } from '../../../../src/test-api';
import { runGolden } from '../../shared/golden-runner';

describe('golden/waste', () => {
  // ── Positive: 6개 케이스 (case 5는 no-unused-vars 영역이라 제외) ──────
  // case 1: 할당 후 read 전에 덮임
  runGolden(import.meta.dir, 'overwrite-chain', program => detectWaste([...program]));
  // case 2: 모든 분기에서 덮는 초기값
  runGolden(import.meta.dir, 'all-branches-overwrite', program => detectWaste([...program]));
  // case 3: 같은 값 재할당
  runGolden(import.meta.dir, 'same-value-reassign', program => detectWaste([...program]));
  // case 4: try/catch 양쪽이 덮음
  runGolden(import.meta.dir, 'try-catch-overwrite', program => detectWaste([...program]));
  // case 6: 외부로 escape 안 하는 누적 변수
  runGolden(import.meta.dir, 'no-escape-accumulator', program => detectWaste([...program]));
  // case 7: 외부로 escape 안 하는 객체 변수
  runGolden(import.meta.dir, 'no-escape-object', program => detectWaste([...program]));

  // ── Positive: case 1 흐름 변형 ────────────────────────────────────────
  // switch fallthrough overwrite (case 1)
  runGolden(import.meta.dir, 'switch-fallthrough', program => detectWaste([...program]));
  // finally의 `resource = null` 참조 해제 (FP-A) — lifetime 관리 → KEEP
  runGolden(import.meta.dir, 'finally-null-gc-hint', program => detectWaste([...program]));

  // ── Negative: boundary KEEP ───────────────────────────────────────────
  // closure가 변수를 read (case 1 반례)
  runGolden(import.meta.dir, 'closure-read', program => detectWaste([...program]));
  // return으로 escape (case 6·7 반례)
  runGolden(import.meta.dir, 'return-escape', program => detectWaste([...program]));
  // callback closure로 escape (case 6 반례)
  runGolden(import.meta.dir, 'callback-closure-escape', program => detectWaste([...program]));
  // mutation 전 snapshot — alias처럼 보여도 값이 다름 (case 1 반례)
  runGolden(import.meta.dir, 'snapshot-before-mutation', program => detectWaste([...program]));
  // using declaration — 자원 lifetime (CLAUDE.md K 명시)
  runGolden(import.meta.dir, 'using-resource', program => detectWaste([...program]));
  // 객체가 return으로 escape (case 7 반례)
  runGolden(import.meta.dir, 'dynamic-property-return', program => detectWaste([...program]));
  // JSON.stringify reflection + return escape (case 7 반례)
  runGolden(import.meta.dir, 'json-stringify-escape', program => detectWaste([...program]));
  // while-loop assignment idiom — binding-only declaration
  runGolden(import.meta.dir, 'regex-exec-iteration', program => detectWaste([...program]));
  // 분석 대상 외: class field (CLAUDE.md 비대상)
  runGolden(import.meta.dir, 'class-field-out-of-scope', program => detectWaste([...program]));
  // 분석 대상 외: top-level `export const` (CLAUDE.md 비대상)
  runGolden(import.meta.dir, 'top-level-export-const-keep', program => detectWaste([...program]));

  // ── 회귀 잠금 (closure-capture 정공법 검증) ─────────────────────────────
  // outer x는 dead-store-overwrite, inner shadow는 별개 binding (varIndex로 분리)
  runGolden(import.meta.dir, 'nested-function-inner-shadow', program => detectWaste([...program]));
  // IIFE의 outer capture가 정확히 use로 인정되는지 KEEP boundary
  runGolden(import.meta.dir, 'iife-outer-capture', program => detectWaste([...program]));

  // ── 회귀 잠금 (impure side-effect purity guard) ─────────────────────────
  // mutation argument에 call/await/new/update/assign이 있으면 KEEP
  runGolden(import.meta.dir, 'mutation-arg-side-effect-keep', program => detectWaste([...program]));
  // property-write RHS에 side-effect가 있으면 KEEP
  runGolden(import.meta.dir, 'property-write-rhs-side-effect-keep', program => detectWaste([...program]));
  // spread → iterator protocol side-effect → KEEP
  runGolden(import.meta.dir, 'mutation-arg-spread-keep', program => detectWaste([...program]));
  // optional member access (call 없음) → pure → DEAD (ChainExpression 좁힘 검증)
  runGolden(import.meta.dir, 'mutation-arg-optional-member-pure', program => detectWaste([...program]));
  // delete UnaryExpression → mutation effect → KEEP
  runGolden(import.meta.dir, 'mutation-arg-delete-keep', program => detectWaste([...program]));
  // function literal as argument → body is value-time, not push-time → DEAD
  runGolden(import.meta.dir, 'mutation-arg-function-literal-pure', program => detectWaste([...program]));
  // declaration/assignment RHS에 side-effect가 있으면 case 1~4도 KEEP (per-def purity guard)
  runGolden(import.meta.dir, 'impure-initializer-side-effect-keep', program => detectWaste([...program]));
  // destructure binding의 enclosing init이 impure → 전체 declarator KEEP
  runGolden(import.meta.dir, 'destructure-impure-init-keep', program => detectWaste([...program]));
  // destructure default expression에 side-effect → KEEP
  runGolden(import.meta.dir, 'destructure-default-side-effect-keep', program => detectWaste([...program]));
  // destructure assignment (`[a] = g()`) — assignment 경로도 purity guard 적용 → KEEP
  runGolden(import.meta.dir, 'destructure-assignment-impure-keep', program => detectWaste([...program]));
  // computed property key의 impure expression → KEEP (`obj[g()] = 1`)
  runGolden(import.meta.dir, 'computed-key-impure-keep', program => detectWaste([...program]));
  // case 6/7 fresh allocation 전제 — alias from outer reference는 case 6/7 비적용 → KEEP
  runGolden(import.meta.dir, 'alias-outer-reference-keep', program => detectWaste([...program]));
  // TS 값 wrapper (`as`, `satisfies`, `!`, `<T>`, paren)는 fresh allocation 유지 → DEAD
  runGolden(import.meta.dir, 'fresh-allocation-ts-wrapper', program => detectWaste([...program]));
  // assignment def도 fresh allocation이면 case 6/7 적용 → DEAD
  runGolden(import.meta.dir, 'assignment-def-fresh-allocation', program => detectWaste([...program]));
  // RegExp literal도 fresh allocation으로 인정 → DEAD
  runGolden(import.meta.dir, 'regexp-literal-fresh', program => detectWaste([...program]));
  // 같은 변수에 fresh def + alias def 공존 — case 6/7 비적용 → KEEP
  runGolden(import.meta.dir, 'mixed-fresh-and-alias-defs-keep', program => detectWaste([...program]));
  // Array mutator 확장 (pop 외 splice/sort/...) — push와 동등 처리 → DEAD
  runGolden(import.meta.dir, 'mutation-method-pop', program => detectWaste([...program]));
  // logical assignment (??=/||=/&&=)의 LHS read는 condition-check → case 6/7 적용 → DEAD
  runGolden(import.meta.dir, 'logical-assignment-fresh', program => detectWaste([...program]));
  // built-in target-mutation API (Object.assign 등) 첫 인자 = mutation receiver → DEAD
  runGolden(import.meta.dir, 'builtin-target-mutation-api', program => detectWaste([...program]));
  // compound assignment on an object may invoke coercion side-effects → KEEP
  runGolden(import.meta.dir, 'compound-assignment-object-keep', program => detectWaste([...program]));
  // array length property write on a non-escaping fresh array → case 7 DEAD
  // (length write only deletes own-indices; local-only mutation per CLAUDE.md)
  runGolden(import.meta.dir, 'array-length-property-write-dead', program => detectWaste([...program]));
  // user-defined method that shadows a built-in mutation name → KEEP
  runGolden(import.meta.dir, 'user-defined-mutation-method-keep', program => detectWaste([...program]));
  // user-defined setter is invoked by property write → KEEP
  runGolden(import.meta.dir, 'user-defined-setter-keep', program => detectWaste([...program]));
  // mutation method name matches but receiver init kind doesn't (`[].set`, `{}.push` throw) → KEEP
  runGolden(import.meta.dir, 'cross-receiver-mutation-method-keep', program => detectWaste([...program]));
  // `{ __proto__: parent }` installs a prototype → inherited accessors/frozen guards → KEEP
  runGolden(import.meta.dir, 'proto-key-inherited-accessor-keep', program => detectWaste([...program]));
  // `Object.assign(target, { get x(){} })` fires source getter at copy time → KEEP
  runGolden(import.meta.dir, 'object-assign-source-getter-keep', program => detectWaste([...program]));
  // computed-key with function-literal value is method-like (`[Symbol.toPrimitive]`) → KEEP
  runGolden(import.meta.dir, 'computed-symbol-method-keep', program => detectWaste([...program]));
  // direct `eval(...)` in scope = opaque dynamic-read barrier → skip scope → KEEP
  runGolden(import.meta.dir, 'direct-eval-scope-barrier-keep', program => detectWaste([...program]));
  // `delete c.p` on a fresh non-escaping object is local-only mutation → DEAD
  runGolden(import.meta.dir, 'delete-property-no-escape-dead', program => detectWaste([...program]));
  // discarded read contexts (typeof/void/sequence-non-last/instanceof-stmt) → DEAD
  runGolden(import.meta.dir, 'discard-only-reads-dead', program => detectWaste([...program]));
  // class static block references outer binding → evaluation-time mutation → KEEP
  runGolden(import.meta.dir, 'static-block-outer-mutation-keep', program => detectWaste([...program]));
  // syntactic same-value reassign for NaN is suppressed (NaN !== NaN at runtime) → KEEP
  runGolden(import.meta.dir, 'nan-reassign-keep', program => detectWaste([...program]));
  // `var` hoisting: outer reference of var declared in for-init binds same binding → KEEP
  runGolden(import.meta.dir, 'var-hoist-for-init-keep', program => detectWaste([...program]));
  // `var` hoisting: var inside if-block binds same binding as outer reference → KEEP
  runGolden(import.meta.dir, 'var-hoist-block-keep', program => detectWaste([...program]));
  // local binding shadowing an imported name is a distinct binding → dead-store DEAD
  runGolden(import.meta.dir, 'local-shadows-import-dead', program => detectWaste([...program]));
  // `const c = importedName; c.push(1)` aliases an import (not fresh) → KEEP
  runGolden(import.meta.dir, 'import-alias-receiver-keep', program => detectWaste([...program]));
  // fallback init read on the exception path of a try/catch → KEEP
  runGolden(import.meta.dir, 'try-catch-fallback-init-keep', program => detectWaste([...program]));
  // module helper called by an earlier-declared function (forward-ref capture) → KEEP
  runGolden(import.meta.dir, 'forward-ref-closure-capture-keep', program => detectWaste([...program]));
  // return-self mutator (sort) whose result is consumed → receiver escapes → KEEP
  runGolden(import.meta.dir, 'return-self-mutator-escape-keep', program => detectWaste([...program]));
  // direct members of a TS namespace are non-target (CLAUDE.md namespace 비대상) → KEEP
  runGolden(import.meta.dir, 'namespace-member-keep', program => detectWaste([...program]));
  // a function local inside a namespace is still analyzed → dead-store DEAD
  runGolden(import.meta.dir, 'namespace-function-local-dead', program => detectWaste([...program]));
  // enclosing variable written inside an IIFE → IIFE-scope write, not enclosing def → KEEP
  runGolden(import.meta.dir, 'iife-captured-write-keep', program => detectWaste([...program]));
  // genuine dead store inside an IIFE body is still reported → DEAD
  runGolden(import.meta.dir, 'iife-internal-dead', program => detectWaste([...program]));
  // sync IIFE overwrites outer var read after the call → init DEAD (FN G)
  runGolden(import.meta.dir, 'sync-iife-overwrites-outer-dead', program => detectWaste([...program]));
  // conditional write inside IIFE → init survives no-write path → KEEP
  runGolden(import.meta.dir, 'sync-iife-conditional-write-keep', program => detectWaste([...program]));
  // dead-store chain: x+=2 dead → its read eliminated → init x=1 DEAD too (FN D)
  runGolden(import.meta.dir, 'dead-store-chain-init-dead', program => detectWaste([...program]));
  // closure-captured table member: fixpoint must not eliminate the table's read → KEEP
  runGolden(import.meta.dir, 'closure-captured-table-member-keep', program => detectWaste([...program]));
  // flag captured by a closure created before a finally write → observable → KEEP
  runGolden(import.meta.dir, 'closure-captured-finally-write-keep', program => detectWaste([...program]));
  // default-less switch: init survives the no-match path → KEEP
  runGolden(import.meta.dir, 'switch-no-default-init-keep', program => detectWaste([...program]));
  // switch WITH default is total: init overwritten on every path → DEAD
  runGolden(import.meta.dir, 'switch-with-default-init-dead', program => detectWaste([...program]));

  // ── 회귀 잠금 (module/block scope 정공법) ────────────────────────────────
  // module-scope let overwrite (CLAUDE.md "모든 scope") — DEAD
  runGolden(import.meta.dir, 'module-scope-overwrite', program => detectWaste([...program]));
  // module-scope case 7 (property write only) — DEAD
  runGolden(import.meta.dir, 'module-scope-no-escape-object', program => detectWaste([...program]));
  // inline `export let value = 1; value = 2;` — export binding 비대상 → KEEP
  runGolden(import.meta.dir, 'module-scope-export-binding-keep', program => detectWaste([...program]));
  // specifier-only `let foo = 1; foo = 2; export { foo };` — name-based 면제 → KEEP
  runGolden(import.meta.dir, 'module-scope-export-specifier-keep', program => detectWaste([...program]));

  // ════════════════════════════════════════════════════════════════════════
  // RED (미구현): Phase 1 FP 차단 + Phase 2 recall 보강. 구현 전이라 실패해야 정상.
  // ════════════════════════════════════════════════════════════════════════

  // ── Phase 1: FP 차단 (현재 dead-store로 오탐 → KEEP 되어야 함) ──────────────
  // FP-A: `x = undefined` 참조 해제 (값이 escape) → lifetime 관리 → KEEP
  runGolden(import.meta.dir, 'ref-release-undefined-keep', program => detectWaste([...program]));
  // FP-A: jotai memoryleak — `unsub()` 호출 후 `unsub = undefined` 해제 → KEEP
  runGolden(import.meta.dir, 'ref-release-callee-keep', program => detectWaste([...program]));
  // FP-A: `x = null` 참조 해제 (trpc dataLoader 패턴) → KEEP
  runGolden(import.meta.dir, 'ref-release-null-keep', program => detectWaste([...program]));
  // FP-B1: `@ts-expect-error` 인접 선언 → directive load-bearing → KEEP
  runGolden(import.meta.dir, 'ts-directive-keep', program => detectWaste([...program]));

  // ── Phase 2 (증분 1): 비-member·비-closure-impure 단일사용 inline → redundant-binding DEAD ──
  // 단일사용 순수 산술 → 치환 보존 → DEAD
  runGolden(import.meta.dir, 'redundant-arith-single-use-dead', program => detectWaste([...program]));
  // 단일사용 순수 식별자 alias → DEAD
  runGolden(import.meta.dir, 'redundant-alias-single-use-dead', program => detectWaste([...program]));
  // 단일사용 `as` cast (cast가 값과 함께 이동, 타입검사 보존) → DEAD
  runGolden(import.meta.dir, 'redundant-rhs-cast-single-use-dead', program => detectWaste([...program]));
  // 단일사용 boolean을 조건식에서 1회 사용 → DEAD
  runGolden(import.meta.dir, 'redundant-condition-test-single-use-dead', program => detectWaste([...program]));
  // closure 캡처지만 RHS 순수 + source(param) 재할당 없음 → 같은 값 → DEAD
  runGolden(import.meta.dir, 'redundant-closure-captured-pure-dead', program => detectWaste([...program]));
  // module scope 단일사용 (CLAUDE.md "모든 scope") → DEAD
  runGolden(import.meta.dir, 'redundant-module-scope-single-use-dead', program => detectWaste([...program]));

  // ── Phase 2 (증분 2): member 접근 / destructuring (사이 call/write 없으면 inline) ──
  // 단일사용 member 피연산자 산술 (getter도 같은 지점 1회 평가) → DEAD
  runGolden(import.meta.dir, 'redundant-arith-member-single-use-dead', program => detectWaste([...program]));
  // 단일사용 computed 리터럴키 index read → DEAD
  runGolden(import.meta.dir, 'redundant-member-index-single-use-dead', program => detectWaste([...program]));
  // 단일사용 `.prop` (사이 call/write 없음) → DEAD
  runGolden(import.meta.dir, 'redundant-member-prop-single-use-dead', program => detectWaste([...program]));
  // 단일사용 중첩 member `a.b.c` → DEAD
  runGolden(import.meta.dir, 'redundant-nested-member-single-use-dead', program => detectWaste([...program]));
  // 단일사용 plain destructuring binding (`const { a } = obj` → `obj.a`) → DEAD
  runGolden(import.meta.dir, 'redundant-destructure-single-use-dead', program => detectWaste([...program]));

  // ── Phase 2 (증분 2): member 경로 FP 가드 (적대적 리뷰 재현 → KEEP) ───────────
  // member read의 단일 use가 루프 안 → 반복 재평가 → KEEP
  runGolden(import.meta.dir, 'redundant-member-use-in-loop-keep', program => detectWaste([...program]));
  // member read를 closure가 캡처 + 이후 receiver 변형 → 스냅샷 소실 → KEEP
  runGolden(import.meta.dir, 'redundant-member-use-in-closure-keep', program => detectWaste([...program]));
  // 루프 내 receiver 프로퍼티 write → 재평가 시 다른 값 → KEEP
  runGolden(import.meta.dir, 'redundant-member-receiver-prop-write-loop-keep', program => detectWaste([...program]));
  // array destructuring → 이터레이터 소비 → KEEP
  runGolden(import.meta.dir, 'redundant-array-destructure-keep', program => detectWaste([...program]));
  // 별칭 사용처가 source를 좁히는 분기 안 → TS narrowing 결과 변경 → KEEP
  runGolden(import.meta.dir, 'redundant-narrowed-branch-alias-keep', program => detectWaste([...program]));
  // source가 destructuring 할당(`({cur}=src)`)으로 재할당 → KEEP
  runGolden(import.meta.dir, 'redundant-alias-destructure-reassign-keep', program => detectWaste([...program]));
  // 별칭 사용처가 do-while 본문, 가드가 source 좁힘 → TS narrowing 변경 → KEEP
  runGolden(import.meta.dir, 'redundant-narrowed-do-while-keep', program => detectWaste([...program]));
  // early-exit 가드(형제 문장)가 source 좁힘 + 오버로드 → TS 결과 변경 → KEEP
  runGolden(import.meta.dir, 'redundant-early-exit-narrowing-keep', program => detectWaste([...program]));
  // assertion 함수 호출이 source 좁힘 → TS 결과 변경 → KEEP
  runGolden(import.meta.dir, 'redundant-assertion-narrowing-keep', program => detectWaste([...program]));

  // ── Phase 2: KEEP 가드 (진짜 spec-K — 구현이 절대 flag하면 안 됨) ────────────
  // source가 decl~use 사이 재할당(같은 식) → 인라인 시 새 값 → KEEP (zustand:59)
  runGolden(import.meta.dir, 'redundant-alias-intra-node-reassign-keep', program => detectWaste([...program]));
  // index read와 use 사이 call (receiver mutation 가능) → KEEP
  runGolden(import.meta.dir, 'redundant-member-index-call-between-keep', program => detectWaste([...program]));
  // prop read와 use 사이 call → KEEP
  runGolden(import.meta.dir, 'redundant-member-prop-call-between-keep', program => detectWaste([...program]));
  // prop read 후 receiver의 프로퍼티 write → snapshot-before-mutation → KEEP
  runGolden(import.meta.dir, 'redundant-member-prop-receiver-write-between-keep', program => detectWaste([...program]));
  // closure 캡처 + RHS가 call → 호출당 재평가 → side-effect 횟수 변동 → KEEP (trpc httpLink)
  runGolden(import.meta.dir, 'redundant-closure-captured-call-keep', program => detectWaste([...program]));
  // closure 캡처 + source가 이후 재할당 → 호출 시점 새 값 → KEEP
  runGolden(import.meta.dir, 'redundant-closure-captured-reassigned-source-keep', program => detectWaste([...program]));
  // closure가 member read를 캡처 + receiver 프로퍼티 monkey-patch → KEEP (freezeAtom 패턴)
  runGolden(import.meta.dir, 'redundant-closure-captured-member-keep', program => detectWaste([...program]));
  // fresh allocation을 closure가 캡처 → reference identity 고정 → KEEP
  runGolden(import.meta.dir, 'redundant-fresh-alloc-closure-identity-keep', program => detectWaste([...program]));
  // computed 변수 키가 read와 use 사이 재할당 → 다른 슬롯 → KEEP
  runGolden(import.meta.dir, 'redundant-computed-var-key-reassigned-keep', program => detectWaste([...program]));
  // RHS가 await (impure, suspension) → Phase2 제외 → KEEP
  runGolden(import.meta.dir, 'redundant-await-rhs-keep', program => detectWaste([...program]));

  // ── Phase 2: scope 한계 (spec-W이나 설계상 제외 — NOT spec-K) ─────────────────
  // call-RHS 단일사용은 spec상 W이나 흔한 idiom 폭주 방지 위해 제외 (사용자 결정) → KEEP
  runGolden(import.meta.dir, 'redundant-call-result-scope-limit-keep', program => detectWaste([...program]));
  // 다중사용 순수식은 spec상 W이나 식 중복이라 v1 제외 (multi-use=Phase2.1) → KEEP
  runGolden(import.meta.dir, 'redundant-multi-use-scope-limit-keep', program => detectWaste([...program]));
});
