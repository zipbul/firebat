# PLAN — remove the external-tool detectors (lint / format / typecheck) and fix mode

## Ruling (product owner, 2026-07-22)

lint / format / typecheck do not belong in firebat. They are TRANSPORT of other
tools' verdicts (oxlint / oxfmt / tsgo), not firebat judgments — the zero-FP
doctrine cannot even apply to them (firebat cannot vouch for another tool's
rules), which is why they alone never fit any audit this campaign ran, and why
one of them silently died (analyzeLint discards all diagnostics under fix:true,
and the CLI always passes fix:true — lint findings have been structurally empty
in the real pipeline). Consumers run these tools directly in CI anyway.

firebat's lint/format opinions live in the RIGHT vehicle already: the
oxlint-plugin (14 custom rules, separate bundle) — KEPT, untouched.

fix mode is also removed: firebat detectors do not support auto-fixing, and fix
mode existed only to run oxfmt/oxlint --fix before scanning (an orchestration of
the very tools being removed).

## Scope: 15 → 12 detectors

REMOVE
1. Detectors: `src/features/lint/`, `src/features/format/`, `src/features/typecheck/` (analyzers, specs, index surfaces).
2. Tool wrappers under `src/tooling/` that exist solely for them (oxfmt runner, oxlint runner, tsgo runner, tool-failure plumbing) — KEEP anything the oxlint-plugin bundle or non-removed code still consumes (inventory decides; suspected shared: none, but verify).
3. Fix mode: the "run fixable tools before parse" orchestration in scan.usecase, any `--fix`/fixMode flag in arg-parse/interfaces/entry, its log lines and tests.
4. Types/catalog: `'lint' | 'format' | 'typecheck'` out of FirebatDetector; `LINT`, `FORMAT`, `TYPECHECK` catalog codes + entries (catalog 65 → 62); `LintDiagnostic` / `FormatFinding`-adjacent / `TypecheckItem` types and their FirebatAnalyses/report slots; flatten-findings branches; `exception-hygiene`-style aliases unaffected (verify DETECTOR_ALIASES has no mappings to the removed three).
5. CLI: `--only` valid list, DEFAULT_DETECTORS, entry wiring, `resolveToolRcPath` if only used to locate .oxlintrc/.oxfmtrc for the removed runners.
6. Config: rc schema `features.lint/format/typecheck` toggles; own `.firebatrc.jsonc` + `assets/.firebatrc.jsonc` entries for the three.
7. Tests: unit + integration for the three detectors and fix mode, incl. the just-added `test/integration/features/lint/report-integration.test.ts` and typecheck's sibling (they test catalog transport for detectors that will no longer exist — delete outright, they are not oracles of surviving behavior); report-contract expectations referencing the three; catalog count assertions (65→62).
8. Docs: README detector rows + External Tools section; CLAUDE.md line-1 count 15→12 (the three never had definition sections — none to remove).

KEEP
- `src/oxlint-plugin/**` + `oxlint-plugin.ts` bundle entry (untouched).
- `assets/.oxlintrc.jsonc` / `assets/.oxfmtrc.jsonc`: still installed for the CONSUMER's own oxlint/oxfmt usage with the shipped plugin (install remains useful) — verify install-assets keeps working.
- package.json `lint` script (repo's own dev lint via oxlint directly).
- error-flow's gildash type oracle (independent of the typecheck detector — verify no import from features/typecheck).

## Tri-review amendments (folded — v2)

- **THREE-part breaking change** (commit message must name all + point at `firebat update` as the migration): ① report slots/kinds/codes for the three disappear; ② `--only lint|format|typecheck` becomes a hard CLI error; ③ the features zod schema is `.strict()` — a legacy rc still carrying `features.lint` etc. HARD-FAILS config load on every scan until the keys are removed. ③ is INTENDED (declared-config-as-fact doctrine), decided here, not discovered in P2. Also: scan no longer auto-fixes format/lint before parsing.
- **No tsgo exists** — the typecheck detector uses the `typescript` package / gildash semantic diagnostics; there is no tsgo runner or dependency (plan prose corrected; executor must not hunt for one). Name trap: `computeToolVersion` (src/shared/tool-version.ts — firebat's OWN version, feeds projectKey; scan AND trace consume it) is KEPT; `src/tooling/external-tool-version.ts` dies.
- **Fix mode is a hardwired block, not a flag** — no `--fix` exists; remove the scan.usecase orchestration + `fixMode` log fields only.
- **`test/integration/shared/external-tool-test-kit.ts` is TRIMMED, not deleted**: `createTempProject`/`writeText`/`readText` are consumed by scan-fixture → surviving suites (giant-file, temporal-coupling, variable-lifetime, report-contract). Delete only the tool-mock helpers (makeProc, restoreToolMocks, registerToolMockTeardown, expectToolFailure, expectConfigArgs, expectRcNotResolvedFromParent, expectRcResolvedFromRoot, installFakeBin).
- Additional sweep items: `assets/firebatrc.schema.json` format/lint/typecheck keys; `src/shared/tool-analysis-input.ts` + its src/shared re-export; `resolveToolRcPath` blast radius (scan.usecase export, test-api re-export, scan.usecase.spec describe, kit helpers); test-api's analyzeFormat/analyzeLint/__testing__ exports; `needsSemantic` drops 'typecheck'; **dead catalogCode machinery** — withCatalogCode was the ONLY producer, so after removal normalizeCode's catalogCode-first branch, COMMON_KEYS 'catalogCode', hasCatalogCode, and the collectItemCodes rationale comment are dead paths tsc cannot flag (remove; collection/normalization simplifies to `code`); README L26/L105/L126 + entry.ts help L79/L93 examples; scan.usecase stray `fixMode: true` log field.
- **Dependencies**: move `oxfmt`, `oxlint`, `oxlint-tsgolint` dependencies → devDependencies (consumed only by the repo's own lint/format scripts post-removal; consumers run their OWN oxlint). `typescript` STAYS runtime (dependencies analyzer imports it). Nothing deleted.
- **D15 migration is THREE sites, not one**: entry.spec.ts ~363 (typecheck:false + --only typecheck pin), ~373 (mixed all-false pin), and the entry.ts ~352-360 comment naming typecheck — all migrate to `waste`.
- MIGRATE-not-die tests: report-contract.test.ts (trim lint/format sections incl. meta.errors-capture + fix:true-drops tests), flatten-findings.spec, cache-keys.spec fixture lists, arg-parse.spec, diagnostic-aggregator.spec (65→62). DIE list includes both report-integration tests (lint + typecheck), per-feature config-found/config-missing/golden/fix-mode/diagnostics-parse/binary-missing/check-mode/write-mode suites and fixtures.
- **Gates corrected**: self-scan active set is **11** (own rc declares barrel:false; 12 is the supported total and the --only error list length). Added gates: build+load the plugin bundle and assert all 14 rules exported; run self-scan in a clean worktree and assert NO file mutation (proves fix orchestration is gone — finding counts alone can't); `'tool-unavailable'` is an ErrorFlowFindingKind (error-flow's own — keep); DIAG prose "lint territory / typecheck territory" is domain-boundary language — keep.

## Known interactions to verify (inventory phase)
- scan cache keys / inputs digest referencing fix mode or the three detectors' configs.
- `resolveToolRcPath` consumers; `computeToolVersion` (shared?); diagnostic-aggregator references; `DIAG_*` entries mentioning lint/typecheck in prose (adjust text only if it names the removed detectors as firebat detectors).
- The D15 false-wins gate negative control uses `typecheck: false` + `--only typecheck` as its pinned example — the pin must move to another non-gated detector (e.g. `waste`), NOT be deleted (the gate's domain {barrel, giant-file} is unchanged).
- Report/JSON: removing three FirebatAnalyses slots is a BREAKING output change (kinds/codes disappear) — changelog note in the commit message, same treatment as the barrel kind removals.

## Phases (Sonnet executes, Fable gates)
P0 inventory: exact touchpoint list per scope items 1–8 + the interactions above; deletion list vs keep list; STOP on anything ambiguous (a tooling file with a live non-removed consumer).
P1 tests-first where behavior survives: the D15 negative-control pin migration (RED against nothing — it's a pin edit, do it with the removal); everything else is deletion (no negative-case conversions — killed semantics are deleted outright, per doctrine).
P2 removal per inventory. Gates: tsc 0; full suite 0 fail; `bun run build` both bundles; self-scan runs with 12 detectors and total findings unchanged minus the three categories (they contributed 0 today — lint dead, format/typecheck clean: verify); `--only lint` now rejects with the invalid-detector error listing 12.
P3 (Fable): gate verification + residue grep (lint|format|typecheck as detector identifiers — careful: the WORDS appear legitimately in oxlint-plugin, package.json scripts, comments about the plugin; scope the grep to detector-identifier positions).
P4 tri-review of the diff, then ONE commit (scope `repo`), push.
