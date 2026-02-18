# Search & Verification Policy

## Lookup Priority (mandatory order)

When external information is needed, follow this order strictly:

### 1. Official documentation (latest, authoritative)

- Access official doc URLs directly (bun.sh/docs, nodejs.org/api, orm docs, etc.)
- If URL is unknown → proceed to priority 2.

### 2. Web search (latest, broad)

- Use web search tools/MCP if available.
- Or access search result pages directly.

### 4. Codebase search (internal patterns)

- Text/regex search, semantic search, file read.
- For confirming existing patterns and usage within the repo.

## Dual Source Verification

Any decision based on external information requires **cross-check from ≥ 2 sources.**

- Official docs + doc-query MCP
- Official docs + web search
- Single-source decisions are a policy violation.

## Mandatory Lookup Situations (no exceptions)

1. Runtime choice (Bun vs Node)
2. Package decisions (add/remove/version/API/compat)
3. Public API changes
4. Config file changes
5. Version/compatibility decisions
6. Bun/Node API behavior, options, or defaults
7. Native library/module selection — Bun alternative check

## Required Output Block (hard gate)

When this rule triggers, the response MUST contain an `[Evidence]` block **before any decision based on external information**.
Absence of this block = evidence not gathered = decision is **prohibited**.

```
[Evidence]
- Question: (what external fact is needed)
- Source 1: (priority level + URL/tool + result summary)
- Source 2: (priority level + URL/tool + result summary)
- Conclusion: (factual answer derived from sources)
```

- Both sources are mandatory (dual-source rule).
- If only 1 source is available, state why the second failed and **wait for user guidance**.
- `Conclusion` must be a factual statement, not inference.

## On Failure

Lookup failure → report "tool name + information needed" to user and wait.
**Never substitute with inference.**
