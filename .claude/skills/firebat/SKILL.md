---
name: firebat
description: "Run firebat code quality scanner on the current project. Use this skill whenever the user asks to scan code quality, check for dead code, find duplicates, detect code smells, run lint/format/typecheck, or asks about maintainability issues. Also use when the user says 'scan', 'firebat', 'code quality', 'dead store', 'deep nesting', or similar. Even if the user doesn't mention firebat by name, trigger this skill for any code quality analysis request."
---

# firebat

Static analysis tool that detects maintainability issues in TypeScript/JavaScript codebases. Outputs structured JSON to stdout.

## Workflow

<procedure>

### 1. Run

```bash
bun dist/firebat.js [targets...] --log-level error
```

Exit code: **1** when findings exist, **0** when clean.

### 2. Survey the output

Scan the full `analyses` object. Note which **files appear under multiple detectors** and which **directories have clustered findings**. These are structural hotspots — fixing individual findings here without addressing the shared cause will produce churn.

### 3. Identify root causes

When a file appears under 2+ detectors (e.g. nesting + waste in the same file, or coupling + dependencies in the same module), read `references/diagnostics.md`. It documents composite patterns — god function, circular dependency, god module — that explain **why** multiple detectors fire together. Resolving the root cause eliminates downstream findings.

### 4. Prioritize

After root-cause fixes, order remaining findings by impact:

1. **dependencies** — layer violations, circular dependencies, dead exports. These are architectural constraints; violations compound over time.
2. **coupling** — god modules, bidirectional dependencies. High fan-in modules amplify the cost of every change.
3. **error-flow** — unobserved promises, unsafe finally, missing error cause. Silent failures in production.
4. **nesting, early-return, collapsible-if** — complexity findings. Fix these together per-function since they often overlap.
5. **waste** — dead stores. Safe to fix individually.
6. **duplicates** — extract shared abstractions only when the duplication is clearly accidental.
7. **lint, format, typecheck** — mechanical fixes. Address last since earlier refactors may resolve them.

### 5. Address findings

For each remaining finding:

1. Look up the detector name (the key in `analyses`) in the **routing table** below.
2. Read the corresponding reference file.
3. Find the section matching the finding's `code` value.
4. Read `cause` to understand why this was flagged.
5. Follow `think` steps **in order**. If any step concludes with *"stop, no action needed"*, skip this finding and move on — it is a false positive in context. Otherwise, execute the fix described in the `think` steps.

### 6. Verify

After making changes, re-run firebat on the entire project **without `--only` and without target files** to confirm findings are resolved and no new ones were introduced across the codebase.

</procedure>

## JSON output schema

<schema>

```json
{
  "detectors": ["waste", "lint", ...],
  "errors": { "format": "oxfmt binary not found" },
  "blockers": 12,
  "analyses": {
    "waste": [{ "kind": "dead-store", "code": "WASTE_DEAD_STORE", "file": "src/a.ts", "span": {...} }],
    "lint": [{ "file": "src/b.ts", "code": "LINT", "msg": "...", "severity": "error" }]
  }
}
```

- **`blockers`** — Total finding count. 0 means clean.
- **`analyses`** — Finding arrays keyed by detector name. Each finding has a `code` field that maps to a catalog entry in the reference files.
- **`errors`** — Per-detector runtime errors. **Absent entirely** when none occur.

</schema>

## Detector → reference routing

<routing>

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

</routing>

## Rules

- **Do not modify code based on a finding without first reading its reference file.** The `think` steps contain false-positive checks that prevent unnecessary changes.
- **Do not treat all findings as errors.** Some `think` steps explicitly identify cases where the flagged pattern is intentional or justified.
- **Prioritize root causes over individual findings.** A single structural fix (splitting a god function, breaking a cycle) often resolves 5–10 findings at once.
- **Preserve TypeScript strict compliance when making fixes.** This project uses `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. When extracting functions or refactoring, use type guards instead of `as` casts, and ensure extracted functions have explicit parameter and return types.

## Example

**Input:** firebat reports `NESTING_DEEP` and `WASTE_DEAD_STORE` in `src/api/handler.ts`.

**Interpretation:** Same file under two detectors → check `references/diagnostics.md` for `DIAG_GOD_FUNCTION`. The function likely handles multiple concerns. Splitting by responsibility resolves both the deep nesting and dead stores, rather than flattening nesting and deleting stores independently.
