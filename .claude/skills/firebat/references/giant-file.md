# giant-file

Detects source files whose line count exceeds the effective line budget — the configured `maxLines`, or the documented default (`DEFAULT_MAX_LINES = 1000`) when none is configured. Active by default; a pure budget-exceedance comparison, not a design-quality claim.

**Finding fields:** `kind, code, file, span, metrics: { lineCount, maxLines, defaulted }`

<catalog>

## GIANT_FILE

**Cause:** A source file's line count exceeds the configured (or default) line budget.

<think>

1. Decide which side of the comparison to adjust: the budget, or the file. Check whether the configured (or default) `maxLines` actually fits this project and this file.
2. If the file is intentionally large (generated code, a schema, a registry, a data table), exclude it by glob or raise `maxLines` for this project — no further action needed.
3. Otherwise, split or extract the file into separate modules without changing behavior: group its exports by domain, extract the largest cohesive group into a new file, update imports, and repeat until it is under budget.

</think>

</catalog>
