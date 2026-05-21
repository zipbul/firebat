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
  // scope-exit dead write — 변수는 use≥1이지만 마지막 write가 read 없이 종료 (case 1)
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

  // ── 회귀 잠금 (module/block scope 정공법) ────────────────────────────────
  // module-scope let overwrite (CLAUDE.md "모든 scope") — DEAD
  runGolden(import.meta.dir, 'module-scope-overwrite', program => detectWaste([...program]));
  // module-scope case 7 (property write only) — DEAD
  runGolden(import.meta.dir, 'module-scope-no-escape-object', program => detectWaste([...program]));
  // inline `export let value = 1; value = 2;` — export binding 비대상 → KEEP
  runGolden(import.meta.dir, 'module-scope-export-binding-keep', program => detectWaste([...program]));
  // specifier-only `let foo = 1; foo = 2; export { foo };` — name-based 면제 → KEEP
  runGolden(import.meta.dir, 'module-scope-export-specifier-keep', program => detectWaste([...program]));
});
