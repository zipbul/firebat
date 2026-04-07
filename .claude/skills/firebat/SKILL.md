---
name: firebat
description: "Run firebat code quality scanner on the current project. Use this skill whenever the user asks to scan code quality, check for dead code, find duplicates, detect code smells, run lint/format/typecheck, or asks about maintainability issues. Also use when the user says 'scan', 'firebat', 'code quality', 'dead store', 'deep nesting', or similar. Even if the user doesn't mention firebat by name, trigger this skill for any code quality analysis request."
---

# firebat

Static analysis tool that detects maintainability issues in TypeScript/JavaScript codebases.

The scanner — not the agent — determines what requires fixing. Every finding is an error. Read the reference file before touching any code. The `think` steps contain fix-design guidance — skipping them causes incorrect fixes.

<critical>
Completion is enforced by the Stop Hook. The hook rescans with `bun dist/firebat.js` on every session exit. `blockers = 0` is the only way out. The agent cannot declare completion.
</critical>

<procedure>

## Entry

Check state by work products (not mechanism files):
- `.claude/firebat-plan.md` + `.claude/firebat-scan.json` both exist → **Phase 2** (resume execution)
- `.claude/firebat-scan.json` exists (no plan) → **Phase 1.2** (scan done, design needed)
- Otherwise → **Phase 1** (fresh scan)

## Phase 1: Design

### 1.1 Scan, save, activate loop

1. Remove previous cycle artifacts (`.claude/firebat-plan.md`, `.claude/firebat-scan.json`, `.claude/firebat-loop.local.md`)
2. Run `bun dist/firebat.js --log-level error` and save the JSON output to `.claude/firebat-scan.json`
3. If `blockers` is 0, report clean and stop.
4. If `errors` is present, report which detectors failed.
5. Activate the Ralph Loop — write `.claude/firebat-loop.local.md` with the following content:

```markdown
---
iteration: 1
max_iterations: 100
---
You are resuming a firebat code quality fix cycle.

Read .claude/firebat-plan.md for the fix strategy. Read .claude/firebat-scan.json for current findings.

For each unchecked fix in the plan (highest priority first):
1. Read the reference file for the finding code (see routing table below)
2. Read the source file
3. Apply the fix — root cause, not workaround
4. Run affected tests
5. Mark [x] in .claude/firebat-plan.md

Priority order (category 1 before 2, 2 before 3):
1. dependencies  2. coupling  3. error-flow
4. nesting/early-return/collapsible-if  5. waste
6. barrel/unknown-proof/indirection
7. variable-lifetime/temporal-coupling/giant-file
8. duplicates  9. lint/format/typecheck

Reference files (read BEFORE modifying code for that detector):
waste → references/waste.md | barrel → references/barrel.md
indirection → references/indirection.md | error-flow → references/error-flow.md
unknown-proof → references/unknown-proof.md | dependencies → references/dependencies.md
nesting → references/nesting.md | early-return → references/early-return.md
collapsible-if → references/collapsible-if.md | coupling → references/coupling.md
duplicates → references/duplicates.md | temporal-coupling → references/temporal-coupling.md
variable-lifetime → references/variable-lifetime.md | giant-file → references/giant-file.md
lint, format, typecheck → references/external-tools.md

Constraints:
- Do not silence, suppress, or bypass findings. Fix root cause.
- Do not modify code without reading its reference file first.
- Do not skip findings. Every finding must be fixed.
- Preserve TypeScript strict compliance.
- Straightforward fixes only. No over-engineering.

When all planned fixes are applied, let the session end. The Stop Hook will rescan and decide.
```

### 1.2 Read all findings

Ensure `.claude/firebat-loop.local.md` exists — create it (see 1.1 step 5) if missing.

Read `.claude/firebat-scan.json` in full. Focus on understanding **what each finding means and how to fix it** — not on counting or aggregating.

For each finding: look up its `code` in the routing table below, read the matching reference file section, evaluate `cause` + `think` steps to determine the fix approach.

### 1.3 Design fix strategy

Write `.claude/firebat-plan.md` with the complete fix strategy, organized by directory:

**Directory ordering** (sort directories in this order):
1. By highest-priority finding category — a directory with `dependencies` findings goes before one with only `coupling`
2. Ties broken by structural finding count (`DEP_*`, `COUPLING_*`, `DIAG_*`)
3. `test/` directories after all source directories
4. Directories linked by cross-file findings (circular deps, cross-dir duplicates) are merged into one work unit

**Within each directory:**
- Fixes ordered by category priority (1→9)
- For every finding or batched group: the specific fix action, referencing file path and code
- Hotspot files (2+ detectors) with composite pattern identification from `references/diagnostics.md`
- Each directory section has a `[ ]` checkbox for completion tracking

<gate>
Do not write any code until `.claude/firebat-plan.md` exists and contains a fix action for every finding. If any finding lacks a fix action, return to 1.2 for that finding.
</gate>

Proceed to Phase 2.

## Phase 2: Execute

Ensure `.claude/firebat-loop.local.md` exists — create it (see 1.1 step 5) if missing.

Read `.claude/firebat-plan.md`. Find the next uncompleted directory (first unchecked `[ ]` directory section).

### 2.1 Work one directory

For each finding in the current directory, in category priority order:
1. Read the reference file section for the finding's `code`
2. Read the source file to be modified
3. Apply the fix
4. Run affected tests

When all fixes in the directory are applied, mark the directory `[x]` in `.claude/firebat-plan.md`.

### 2.2 Next directory or exit

Move to the next unchecked directory. When all directories are completed, let the session end naturally.

The Stop Hook will rescan automatically:
- `blockers = 0` → hook deletes all cycle artifacts (`firebat-loop.local.md`, `firebat-plan.md`, `firebat-scan.json`), session ends. **Done.**
- `blockers > 0` → hook saves updated scan to `.claude/firebat-scan.json`, re-enters session. On re-entry: read plan and new scan, add fix actions for any new findings not yet in the plan, continue fixing from the next unchecked directory.

</procedure>

<constraints>

**Root cause, not workaround.** Fix the actual problem. Do not silence, suppress, or bypass any finding. Do not move code to a different module to avoid a finding. Structural findings require structural fixes.

**Reference before code.** Do not modify code without first reading its reference file. The `think` steps determine the fix approach.

**Priority order is execution order.** Do not reorder by difficulty, safety, or convenience. Earlier categories resolve later ones.

<priority-order>
1. **dependencies** — layer violations, circular deps, dead exports
2. **coupling** — god modules, bidirectional deps
3. **error-flow** — unobserved promises, unsafe finally, missing error cause
4. **nesting, early-return, collapsible-if** — complexity (fix together per-function)
5. **waste** — dead stores
6. **barrel, unknown-proof, indirection** — import structure, type safety, forwarding layers
7. **variable-lifetime, temporal-coupling, giant-file** — scope, ordering, file size
8. **duplicates** — extract shared code
9. **lint, format, typecheck** — mechanical
</priority-order>

**Every finding, no exceptions.** Every finding reported by the scanner must have a fix applied. Do not skip, omit, ignore, or deprioritize any finding. Only narrow scope when the user explicitly instructs it.

**Module boundaries.** Feature types stay in the feature. Shared types stay in shared.

**TypeScript strict.** Preserve `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Use type guards instead of `as` casts. Extracted functions must have explicit parameter and return types.

**Straightforward fixes.** No over-engineering, no unnecessary abstraction. The simplest correct fix is the best fix.

</constraints>

## Review policy

The scanner's output is authoritative. The agent does not judge whether a finding is valid.

- **One finding, one fix.** Each finding needs its own think-step evaluation and fix plan.
- **Batching by identical pattern is allowed.** When findings share the exact same root cause, state the fix once and list affected findings.
- **Think steps guide fix design, not validity.** If a think step concludes "no change needed" — this means the standard fix does not apply. Find an alternative fix approach. A think step cannot override the scanner.

Per-finding checklist (record for each finding or batched group):

```
[ ] Reference file read — matching `code` section found
[ ] Think steps evaluated — fix approach determined from actual code
[ ] Fix plan recorded — specific action to resolve the finding
[ ] Fix is not a workaround
[ ] Fix is straightforward — no over-engineering
[ ] Fix addresses root cause — not symptom
```

## Reference

### JSON output

```json
{
  "detectors": ["waste", "lint", ...],
  "errors": { "format": "oxfmt binary not found" },
  "blockers": 12,
  "analyses": {
    "waste": [{ "kind": "dead-store", "code": "WASTE_DEAD_STORE", "file": "src/a.ts", "span": {...} }]
  }
}
```

- `blockers` — total finding count. 0 = clean.
- `analyses` — findings keyed by detector. Each has a `code` mapping to a catalog entry.
- `errors` — per-detector runtime errors. Absent when none occur.

### Routing table

| Detector | Reference |
|----------|-----------|
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
| lint, format, typecheck | `references/external-tools.md` |

### Stop Hook

The firebat plugin includes a Stop Hook that enforces the Ralph Loop:
- On session exit, the hook runs `bun dist/firebat.js --log-level error`
- `blockers = 0` → deletes all cycle artifacts (`firebat-loop.local.md`, `firebat-plan.md`, `firebat-scan.json`), allows exit
- `blockers > 0` → saves updated scan, blocks exit, re-enters with the prompt from the state file
- The agent cannot bypass this

<critical>
Every finding must be fixed. Priority order is execution order. The hook enforces completion. Read the reference file before modifying code.
</critical>
