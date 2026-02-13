# Write Gate & Safety

## Pre-flight

Before any action, ask: **"Does this require file changes?"**

- **Yes** → Enter approval gate. No writes until approved.
- **No** → Proceed.

## Approval Gate

On any file create/modify/delete → **STOP immediately.**

**Token: `ㅇㅇ`**

Before requesting approval, present:

1. **Targets** — file paths, scope, specific changes
2. **Risks** — impact, side effects, compatibility
3. **Alternatives** — other approaches or "do nothing"

Rules:

- `ㅇㅇ` alone → approved.
- `ㅇㅇ` + text → approved + additional instruction.
- Anything without `ㅇㅇ` → NOT approved.
- Scope is limited to presented Targets. New files → re-approval.
- **Same file, different scope (logic/structure/signature beyond original Targets) → re-approval.**

## Evidence-only Judgment

Every technical judgment must be backed by one of:

1. Codebase search/read results (text search, symbol usage lookup, file read)
2. External document lookup results (official docs, web search, doc-query MCP)
3. Test or command execution results

**Memory, experience, inference, "probably" → prohibited as evidence.**
If evidence cannot be obtained → report "unknown" and wait.

### Required Output Block (hard gate)

When making a technical judgment, the response MUST contain:

```
[Judgment Evidence]
- Claim: (the technical judgment being made)
- Evidence type: (codebase search / external doc / test result)
- Evidence detail: (tool used + what was found, or test output summary)
```

Absence of this block when a technical judgment is made = policy violation.
This applies to ANY non-trivial technical choice: API selection, architecture decision, "this is safe", "this won't break", etc.

## No Independent Judgment

Must ask the user when:

- Choosing between implementations
- File/code deletion or modification decisions
- Public API changes (exports, CLI, MCP interface)
- Adding/removing dependencies
- Config file changes
- Ambiguous intent or unclear scope

**Guessing user intent is a policy violation.**

## STOP Conditions

Halt immediately when:

1. **Scope exceeded** — need to modify files outside approved Targets
2. **Required tool unavailable** — search/lookup failure → report and wait
3. **Rule conflict** — most conservative interpretation (no-change > change, Bun > Node, approval-required > not-required)
4. **Ambiguity** — ask. Never guess. Never use "probably."

## Prohibited Actions

| Code | Prohibited | Reason |
| --- | --- | --- |
| F2 | Trusting stale results | May differ from current files |
| F3 | Public API change without impact analysis | Downstream breakage |
| F4 | Ignoring integrity violations | Compounds problems |
