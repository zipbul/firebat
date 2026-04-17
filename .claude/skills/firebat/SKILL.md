---
name: firebat
description: "Run firebat code quality scanner on the current project. Use this skill whenever the user asks to scan code quality, check for dead code, find duplicates, detect code smells, run lint/format/typecheck, or asks about maintainability issues. Also use when the user says 'scan', 'firebat', 'code quality', 'dead store', 'deep nesting', or similar. Even if the user doesn't mention firebat by name, trigger this skill for any code quality analysis request."
---

<role>
You operate firebat's directory-scoped refactor workflow. On fresh user invocation, run the orchestrator and report its exit.

Per-iteration routing, plan verification, index maintenance, and staleness detection are handled by `orchestrate.sh` in bash. The orchestrator spawns minimal `claude` subprocesses whose only job is to dispatch a single sub-agent (planner/fixer/global-reviewer) via the Task tool with pre-resolved parameters.
</role>

## Fresh invocation

User invoked `/firebat`. Run the orchestrator once; its internal loop terminates only when `total = 0 AND all dirs [x]`:

```bash
bash .claude/skills/firebat/scripts/orchestrate.sh
```

Report to user:
- Exit 0: done. Show `git diff --stat` of changed files.
- Exit 2: `total = 0` reached but some dirs blocked. List blocked slugs from `.firebat/state.json`.
- Non-zero (other): report `.firebat/state.json` `.log` section for debugging.

## Architecture summary

```
orchestrate.sh (bash while loop)
  │
  ├── Init: build + scan → scan-split.sh
  │     (produces scan.json, tree.json, by-dir/, by-dir-slim/, finding-index.json)
  │
  ├── PLANNING phase:
  │     ├── pick-next.sh planning  →  {action, slug, plan_file, ...}
  │     ├── spawn claude with minimal prompt: "Task: firebat-planner with <params>"
  │     ├── post-plan-verify.sh  →  verify-plan.sh + index.md + feedback
  │     └── stagnation guard: N consecutive linter FAILs → blocked
  │
  ├── Phase 1 → Phase 2 transition when plan-complete.sh passes
  │
  └── EXECUTING phase:
        ├── maybe_rescan (skip when last fixer modified 0 files)
        ├── termination check: total = 0 AND all non-blocked dirs [x]
        ├── pick-next.sh executing → {action, slug, plan_file, ...}
        └── spawn claude: "Task: firebat-fixer with <params>"
              → writes last-fix-summary.json (used by next iter's maybe_rescan)
```

## Scripts

All in `.claude/skills/firebat/scripts/`:

| Script | Role |
|---|---|
| `orchestrate.sh` | Outer state machine. Phase loop, stagnation, termination. |
| `scan-split.sh` | Transforms `scan.json` into `tree.json`, `by-dir/`, `by-dir-slim/`, `finding-index.json`. |
| `pick-next.sh` | Bash routing: decides next action (plan/fix/global-review/none) with pre-resolved params. |
| `post-plan-verify.sh` | Post-planner: `verify-plan.sh` + index.md update + feedback persistence. |
| `verify-plan.sh` | Deterministic C1-C9 linter (authoritative). |
| `plan-complete.sh` | Phase 1 → Phase 2 transition gate. |
| `extract-reference.sh` | Per-code reference section extractor. |
| `extract-verdict.sh` | Agent output tag-block extractor. |

## Sub-agents (invoked via Task tool from minimal claude subprocesses)

| Agent | Role | Input | Output |
|---|---|---|---|
| `firebat-planner` | Write one dir's plan | slug, dir, plan_file, feedback_file | plan file (status: draft) |
| `firebat-fixer` | Apply plan's fixes | slug, dir, plan_file | execution-summary JSON (also saved to `last-fix-summary.json`) |
| `firebat-global-reviewer` | Cross-plan consistency (G1-G7) | all plans + finding-index.json | `global-review-pass` marker or affected_plans to revert |

Note: `firebat-reviewer` was removed — `verify-plan.sh` is authoritative for C1-C9. Cross-plan semantic conflicts (formerly C7) are now caught by global-reviewer's G6 (broader check).

## Runtime files (`.firebat/`)

```
.firebat/
  state.json              phase + fail_log + blocked (owned by orchestrate.sh)
  scan.json               latest scan output (flat Finding[] format)
  tree.json               dir hierarchy + counts
  by-dir/<slug>.json      per-dir findings (full with detail, for fixer)
  by-dir-slim/<slug>.json per-dir primary findings (no detail, for planner)
  finding-index.json      project-wide index (for global-reviewer)
  last-fix-summary.json   most recent fixer summary (used by maybe_rescan)
  plan/
    index.md              directory checklist (unchecked→checked progression)
    NN-<slug>.md          per-directory plan (number stable across revisions)
    <slug>.feedback.json  pending linter feedback for revision
    global-review-pass    marker after global-reviewer PASS
```

<category-priority>
1. dependencies   2. coupling   3. error-flow
4. nesting / early-return / collapsible-if   5. waste
6. barrel / unknown-proof / indirection
7. variable-lifetime / temporal-coupling / giant-file
8. duplicates   9. lint / format / typecheck
</category-priority>

<reference-routing>
Sub-agents fetch per-code reference via `bash .claude/skills/firebat/scripts/extract-reference.sh <category> <code>`.

| Category | File |
|----------|------|
| waste | `references/waste.md` |
| barrel | `references/barrel.md` |
| indirection | `references/indirection.md` |
| error-flow | `references/error-flow.md` |
| unknown-proof | `references/unknown-proof.md` |
| dependencies | `references/dependencies.md` |
| nesting | `references/nesting.md` |
| early-return | `references/early-return.md` |
| collapsible-if | `references/collapsible-if.md` |
| coupling | `references/coupling.md` |
| duplicates | `references/duplicates.md` |
| temporal-coupling | `references/temporal-coupling.md` |
| variable-lifetime | `references/variable-lifetime.md` |
| giant-file | `references/giant-file.md` |
| lint / format / typecheck | `references/external-tools.md` |
</reference-routing>

<critical-invariants>
- Content-hash finding IDs are stable across rescans.
- `total = 0 AND all dirs [x]` is the only termination condition.
- Staleness: new finding IDs introduced by a fix → caught on next iter's rescan, regress dir to draft.
- Global-reviewer's G2-b (secondary file ownership) is non-negotiable — parallel Phase 2 (future) must serialize through G2-b.
- No retry caps. Linter FAIL → revise next iter (cooldown at N consecutive via stagnation guard).
</critical-invariants>
