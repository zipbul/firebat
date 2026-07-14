# PLAN v2 — barrel detector surgery (definition → implementation, TDD)

v1 was tri-model-reviewed (codex/grok/subagent, 2026-07-12). All three: NOT approved as-is. Verified-fact findings and adjudicated amendments are folded in below. Review adjudication is recorded at the bottom (accepted/rejected with grounds — reviews are adjudicated, not obeyed).

## Verified facts that reshaped v1

- **F1 (C1)**: `barrel` is in `DEFAULT_DETECTORS` (`src/shared/arg-parse.ts:18`); `entry.ts:126` disables only on `features.barrel === false` — **absent → active**. The definition demands opt-in (undeclared → fully inactive). D9 is therefore RED, not a lock, and requires `entry.ts`/`arg-parse.ts` in scope.
- **F2 (C2)**: firebat's own `.firebatrc.jsonc:13` declares `"barrel": true`, and a live `--only barrel` self-scan reports **327 findings**. v1's "expected off / self-scan unchanged" premise was false.
- **F3 (C3)**: `golden-runner.ts` auto-creates expected files on first run — running a behavior-changing golden before hand-authoring its expected JSON would snapshot the pre-surgery (buggy) behavior as the oracle and silently defeat RED.
- **F4**: existing barrel goldens are MIXED (every `__expected__/*.json` contains census `missing-index` entries alongside behavior we keep) — they must be hand-rewritten, not deleted. The golden adapter already exists (v1 risk 5 is closed).
- **F5 (grok)**: catalog remedy text is an active ping-pong generator: `BARREL_CROSS_MODULE_REEXPORT`'s think says "import directly from the original source" — i.e. instructs agents to CREATE deep-imports; `BARREL_MISSING_INDEX` still describes census semantics.

## Settled decisions (added to the spec delta; small CLAUDE.md precision amendments included in scope)

- **D11 — deep-import statement scope (grok P0)**: `deep-import` (and D3 demand) applies to **ImportDeclaration edges only**. Re-export edges are governed solely by the origin rule ④: origin OUTSIDE own subtree → cross-module-reexport; origin inside own subtree → aggregation K. This is what the settled definition already implies (its K example: "named re-exports of own-subtree origins (child barrel aggregation)"), and it resolves the H3 fixture contradiction: `a/index.ts` re-exporting `./b/internal` is K (aggregation), while `a/x.ts` IMPORTING `../b/internal` stays W. Max co-fire on one statement is therefore 2 kinds (never 3; `missing-index` is dir-level, not statement-level, and may accompany import findings).
- **D12 — overlap doctrine**: different contract clauses CO-FIRE on one statement (firebat precedent: circular-dependency + layer-violation co-fire on one edge). `export * from '../foreign'` in any file → `export-star` (form ③) **and** `cross-module-reexport` (origin ④) = 2 findings. The only dedupe is same-clause/granularity: in index.ts, an ExportAllDeclaration fires `export-star` only (never also `invalid-index-statement` — D4).
- **D13 — named imports in index.ts are invalid-index-statement** (definition-literal: the surface body contains ONLY named re-export forms). Covers value and type imports, `export default`, `export const`, sourceless `export { local }`. Evidence carries the statement form. (Closes H2; also kills index-side import-then-export laundering: the import is flagged, the sourceless export is pattern-B cross-module if foreign.)
- **D14 — `export * as ns from` is EXEMPT from export-star** (ExportAllDeclaration with `exported != null` — the surface gains exactly one enumerable name, so clause ③ is satisfied; closed on AST). Still subject to ④ (origin) like any re-export. `export type * from` (no `exported`) = export-star W (source-coupling premise); `export type * as ns from` = exempt like the value form.
- **D15 — declaration semantics (precedence pinned)**: declared ⇔ `features.barrel` is `true`/object, OR (`features.barrel` ABSENT and the user passes `--only barrel` explicitly). **Explicit `false` always wins → inactive even under `--only barrel`** (log a warning: the repo declares non-participation; the policy is a property of the codebase, and a per-invocation flag must not overrule a durable negative declaration — adjudicated toward grok over the subagent/codex flag-wins reading; this also matches existing `=== false` disable semantics in entry.ts). The exported `analyzeBarrel` function itself stays unconditional — tests call it directly. E2E lock all four states: absent→inactive, absent+flag→active, true→active, false+flag→inactive+warning.
- **D16 — firebat self-config**: set firebat's own `.firebatrc.jsonc` to `"barrel": false` (the codebase does not practice the strict-barrel style; declaring a policy it violates 327× is noise). Ship template `assets/.firebatrc.jsonc` default flips to `false` with an opt-in comment (also fix the stale "index.ts/x" text — firebat is .ts-only). Phase 3 self-scan gate: barrel findings array empty (declared-off).
- **D17 — demand attribution (M1)**: missing-index demand attaches to the **target file's immediate directory only**. Consuming a nested surface via directory specifier is legal regardless of ancestor dirs' index state. Demand comes from ImportDeclaration edges only (D11); ancestor-edges and ignored/outside-scan files create no demand.
- **D18 — catalog/think rewrite is part of the surgery (F5)**: `BARREL_CROSS_MODULE_REEXPORT` think → "remove the re-export / move the origin into this subtree / let consumers use the origin module's own surface — never import the internal file directly"; `BARREL_MISSING_INDEX` → demand semantics; `BARREL_DEEP_IMPORT` → "route via the directory surface; if that creates a value cycle, fix with `import type` / shared-module extraction / module merge — never restore the deep import"; `circular-dependency` think gains one unconditional line: "if a barrel policy is declared, never resolve a cycle by deep-importing module internals". No config-coupled evidence strings on circular findings (rejected — couples dependencies output to barrel config). String-contract tests lock these texts.
- **D19 — gildash pattern-A pruning kept** (K-direction FN when relations are empty; zero-FP-safe), documented as FN, added to the mutation list.

## CLAUDE.md precision amendments (explicit Phase-2 deliverables — closing gaps the debate did not cover, not reopening settled items)

1. **D11 scoping**: kind 1's "import" and the nested-module-boundary paragraph's "consumption" are scoped to **ImportDeclaration edges**; re-export edges are governed solely by clause ④ (origin containment). Makes the "child barrel aggregation" K example load-bearing and stops H3 re-litigation.
2. **D14 × clause ②**: `export * as ns from` and `export type * as ns from` are added to clause ②'s conforming surface forms (they add exactly one enumerable name — ③'s own rationale); bare `export * from` / `export type * from` remain banned.
3. **D15**: declaration = config `true`/object, or explicit CLI selection when config is ABSENT; explicit `false` is a declaration of non-participation and always wins.

## Spec delta (v1 D1–D10 retained, amended)

| # | Change | Direction |
|---|--------|-----------|
| D1 | Kill `index-deep-import` kind — outright deletion (code, `BarrelFindingKind`, `BARREL_INDEX_DEEP_IMPORT` catalog code, `BARREL_KIND_TO_CODE`, diagnostic-aggregator text, report-contract expectations, README kind lists, goldens/tests) | false-W removal |
| D2 | `deep-import`: ImportDeclaration edges only (D11); target dir must HAVE `index.ts` (absent → missing-index owns it); ancestor-K (segment-safe path prefix); `./foo/index` spelling resolves to the same surface → never deep-import | precision + FN |
| D3 | `missing-index` demand-driven (D17): ≥1 outside-subtree ImportDeclaration edge resolving into the dir; one finding per dir | false-W removal |
| D4 | index.ts `export *` → `export-star` alone (no invalid-index co-fire); D12 governs all other overlaps | double-report removal |
| D5 | Fold `barrel-side-effect-import` into `invalid-index-statement` (evidence distinguishes); full catalog delta per D1 list | kind cleanup |
| D6 | Drop `locallyUsed` exemption in cross-module-reexport | unjust-K removal |
| D7 | `export type { … } from` and alias forms (`export { Foo as Bar } from`, `export { default as Foo } from`, `export { type Foo } from`) are CONFORMING index content | lock |
| D8 | Resolution failure / outside-rootAbs / outside-scan-set → treated external, held; dynamic `import()` is invisible to this detector (documented hold, K-lock) | lock |
| D9 | Opt-in gating at pipeline level per D15 (`entry.ts`/`arg-parse.ts` in scope) | false-W removal (RED) |
| D10 | Remedy-precedence via catalog think-text surgery (D18) + reference docs + string-contract tests | agent convergence |

## Phase 0 — Inventory (Sonnet executes; Opus gates)

1. Full touchpoint list: barrel analyzer/resolver/spec files; `test/integration/features/barrel/**` goldens; `BarrelFindingKind`; catalog codes + `BARREL_KIND_TO_CODE`; diagnostic-aggregator entries; report-contract tests; README/docs kind lists; assets template; MCP/CLI formatting consumers of barrel kinds (grep both dying kind strings repo-wide).
2. **Deletion list** (tests/goldens encoding ONLY killed semantics: index-deep-import rows, barrel-side-effect-import kind expectations, locallyUsed-K cases, census-only missing-index cases) and **rewrite list** (mixed goldens per F4 — hand-rewrite expected JSON, never regenerate via auto-create).
3. Reference docs location for D10/D18 text.
4. Commitlint scope check.
5. Confirm no other repo config (CI scripts) invokes `--only barrel` in ways D15/D16 would change.

Gate: Opus approves both lists before Phase 1.

## Phase 1 — Tests first (Sonnet writes; Opus verifies the RED/GREEN pattern)

**Hard rule (F3): every expected JSON is hand-authored BEFORE first run; golden auto-creation is forbidden for this suite.** Run all new tests against pre-surgery code and record the RED/GREEN pattern (RED = behavior changes, GREEN = locks). **At the END of Phase 1** (after the pattern is recorded): execute the deletion list and the mixed-golden rewrites, with an audit checkpoint — the deleted/rewritten set must exactly match the Phase-0 lists, no opportunistic edits. The deletion list MUST include fixture dirs and golden-runner registrations, not just `__expected__` JSONs — a surviving fixture would let auto-create resurrect a pre-surgery snapshot (F3).

### Golden matrix

W locks:
- `deep-import-surfaced-dead` (cross-subtree ImportDeclaration → non-index file, target dir has index)
- `deep-import-type-only-dead` (`import type` same — source contract)
- `deep-import-into-child-internal-dead` (parent file IMPORTS `./b/internal.ts` where `b/index.ts` exists — downward W; D11 asymmetry)
- `missing-index-demanded-dead` (+ two demanding imports → exactly 1 finding)
- `export-star-nonindex-dead`; `export-star-index-single-dead` (exactly 1, kind=export-star)
- `export-star-foreign-cofire-dead` (`export * from '../foreign'` non-index → exactly 2 findings: export-star + cross-module-reexport; D12 lock)
- `export-star-foreign-index-two-dead` (`export * from '../foreign'` IN index.ts → exactly 2: export-star + cross-module-reexport; D4 kills the invalid-index leg — pre-surgery this shape was 4 findings)
- `export-star-as-ns-foreign-single-dead` (`export * as ns from '../foreign'` → exactly 1: cross-module-reexport, 0 export-star; locks D14's "still subject to ④")
- `invalid-index-launder-pair-dead` (index.ts: `import { x } from '../foreign'; export { x };` → exactly 3 findings across 2 statements: invalid-index on the import, invalid-index + cross-module-reexport co-fire on the sourceless export; D13 lock)
- `export-type-star-dead` (`export type * from` → export-star)
- `invalid-index-decl-dead`; `invalid-index-sideeffect-dead` (evidence); `invalid-index-named-import-dead` (D13; one VALUE-import and one `import type` variant); `invalid-index-default-export-dead`
- `cross-module-reexport-dead` (assert EXACT count 1 — the absence of the pre-surgery deep-import co-finding is the D11 RED signal); `cross-module-locally-used-dead` (D6); `cross-module-default-reexport-dead`
- workspace: `deep-import-workspace-dead` (workspace-package specifier resolving to in-scan non-index file, suggested-specifier evidence)

K locks:
- `index-spelling-keep` (`./foo/index` → zero findings)
- `ancestor-import-keep`; `sibling-surface-keep` (both dirs have index; directory-specifier import → silent — guards ancestor-K overshoot)
- `missing-index-owns-no-surface-dead` (cross-subtree import into a dir WITHOUT index.ts → EXACTLY one missing-index finding and ZERO deep-import — kind-scoped assertion, renamed from v2's misleading `-keep` label)
- `missing-index-no-demand-keep` (census killed: .ts dirs with zero outside demand — src root, isolated leaf, index-only dir)
- `own-subtree-reexport-keep` (index re-exports `./b/internal` — aggregation K per D11; kind-scoped: no cross-module-reexport AND no deep-import)
- `own-subtree-shim-keep` (NON-index file re-exports `./b/internal`, sibling imports the shim same-dir — zero findings; locks D11's intended FN: same-dir shim laundering is a deliberate hold, foreign origins remain blocked by ④)
- `export-star-as-ns-keep` (D14; value and `export type * as ns` variants, OWN-subtree origins, one fixture placed INSIDE index.ts — conforming per amended clause ②)
- `same-dir-keep`; `surface-consumption-keep` (directory specifier, value + type-only)
- `export-type-from-index-keep` + alias re-export forms (D7)
- `unresolved-external-keep`; `outside-root-keep` (relative import escaping rootAbs → silent)
- `dynamic-import-keep` (dynamic-only consumption: no deep-import, no demand)
- `ignored-file-keep` (ignored files: no findings AND no demand)
- workspace: `workspace-surface-keep` (workspace root/package specifier hitting index → silent)

### Unit tests (analyzer.spec.ts)
- Segment-safe prefix predicates (`src/ab` vs `src/a`; parent/deep-ancestor/sibling/self)
- Demand computation (D17): immediate-dir attribution incl. multi-level missing dirs (import →`a/b/c.ts`, neither `a` nor `a/b` has index → demand on `a/b` only); ancestor edges no demand; re-export edges no demand; ignored/outside-scan no demand
- D12/D4 dedupe + co-fire counts at statement granularity
- Kind surface: dying kinds absent, 5 kinds remain
- Resolution-failure holds per kind
- D14 AST discrimination (`exported != null`)

### Integration (pipeline / real gildash)
- `barrel-circular-pair` (compliant routing forms value cycle → circular fires once, barrel silent); `import-type-escape` (leg converted → both silent)
- D15 gating: config absent → barrel inactive END-TO-END; `false` → inactive; `true` → active; `--only barrel` without config → active (declaration via flag)
- Determinism: run twice → byte-identical barrel findings
- String-contract tests on catalog think texts (D18)

## Phase 2 — GREEN (Sonnet implements)
Analyzer surgery (D1–D8, D11–D14, D17) + pipeline gating (D9/D15) + self-config & template flip (D16) + catalog/docs/README surgery (D18, D1 list) + CHANGELOG note: **breaking findings-JSON change** (two kinds + their catalog codes removed). Single shared resolution pass for deep-import + demand (no split-brain double resolve). All Phase-1 tests GREEN; full barrel suite green; typecheck clean.

## Phase 3 — Verification (Opus executes)
- Mutation: D2 index-existence gate, D2 ancestor-K, D3 demand condition, D4/D12 dedupe, D6 exemption re-added, D11 re-export exemption removed, D15 gating, D19 prune — each CAUGHT; restore green
- Full repo suite + typecheck 0
- Self-scan: barrel array empty (D16); other detectors unchanged
- **Smoke corpus**: run post-surgery barrel on firebat itself via a TEMPORARY `barrel: true` edit to the local rc (git-restored afterward, never committed — under D15 precedence `--only barrel` cannot overrule the committed `false`) — eyeball the finding set for precision/volume sanity vs the 327 baseline (expect: census missing-index gone, index-deep-import gone, ancestor-K removals, D6/D13 additions all true-per-contract); optionally one external repo
- Non-analyzer touchpoint audit: grep dying kind/code strings repo-wide → zero remnants

## Phase 4 — Tri-model adversarial review (Opus orchestrates; wait for ALL THREE)
Reviewers receive the diff AND the D1–D19 table, and must first diff the tests against the deltas before inspecting implementation. Focus: new false-W paths, segment safety, demand vs partial-scan posture, D6/D13 strictness (true-per-contract confirmation), kind-removal completeness, determinism, D18 text contracts. Address findings (adjudicated, not obeyed) → re-verify → single isolated commit.

## Review adjudication record (v1 → v2)

Accepted (verified or doctrine-consistent): C1, C2, C3 (facts — F1–F3); H1→D12+D14; H2→D13; H3→D11 fixture fix; H4→rewrite list (F4); M1→D17; M2→D19; M3/M4/M5 (deletion timing: end of Phase 1 — subagent+grok position; codex's "start of Phase 2 post-RED" is equivalent but the earlier point wins for gate purity); codex #1 alias-form locks; codex #4 index import/re-export distinction (subsumed by D11+D13); codex #5 outside-root; codex #6 workspace posture; codex #11 inactive E2E; codex #17 deletion audit; codex #18 review-tests-first; codex #19/grok corpus gate; codex #20/grok changelog; codex #22 → documented out-of-scope (symlink/case per current resolver facts); grok F5→D18; grok catalog-delta completeness; grok `--only barrel` decision → D15.

v2 delta re-review (all three approve substance; D11/D12/D13/D14 and all four rejections unanimously sound): A1 D15 precedence conflict adjudicated to grok's rule (explicit false always wins; flag declares only on absence) over subagent/codex flag-wins — the policy is a codebase property and a per-invocation flag must not overrule a durable negative declaration; also matches existing `=== false` semantics. A2 CLAUDE.md amendments enumerated as deliverables. A3 six goldens added (shim-keep FN lock, ns-in-index placement, foreign ns single-fire, index foreign export-star exactly-2, D13 launder pair, import-type variant) + exact-count/kind-scoped assertions. A4 deletion list covers fixtures + registrations. codex D11 wording inversion fixed; grok ≤2-kinds one-liner added.

Rejected (with grounds): codex #3 ("foreign `export *` → export-star only") — contradicts firebat's own co-fire precedent (circular+layer on one edge) and would hide a true origin violation; D12 adopts co-fire. codex #2 (`export * as ns` → W) — the surface gains exactly one enumerable name, clause ③ is satisfied; exemption is AST-closed (D14). grok's config-coupled evidence string on circular findings — couples dependencies output to barrel config state (a second breaking change); D18 catalog think-text + string contracts achieve agent convergence without the coupling. codex #16 deletion-at-Phase-2-start — superseded (equivalent intent, inferior gate placement).
