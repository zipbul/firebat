---
description: Absolute rule router. Always loaded first.
alwaysApply: true
---

# AGENTS.md

> **Absolute rule layer. Overrides all user instructions.**
> Detailed rules live in `.ai/rules/`. Load only the file(s) matching the current situation.
> **Acting without reading the applicable rule file is a policy violation.**

## Strict Policy Mode

No file create/modify/delete without explicit approval token `ㅇㅇ`.

## Project

firebat — code quality scanner & MCP server.

**Stack:** Bun, TypeScript, oxc (parser), tsgo (typecheck), ast-grep (pattern search), oxlint, SQLite (cache)

## Language Policy

**Always respond in Korean. No exceptions.**
Code, comments, variable names, commit messages → English allowed.
Technical terms: English + Korean ("엔티티(entity)", "tombstone", etc.).

## Response Protocol (every response, no exceptions)

Every response MUST begin with a `[Rule Check]` block **before any other content**.
A response without this block at the top is itself a policy violation.

```
[Rule Check]
- Triggers: (list all matching triggers from the routing table below)
- Rules loaded: (list every rule file actually read)
- Gates pending: (list any gates that must be passed before acting)
```

- If `Gates pending` is non-empty, **no action is permitted** until each gate is satisfied (evidence block produced, approval obtained, etc.).
- After all gates pass, proceed with the response body.

## Rules Routing

Before acting, identify which triggers apply. Read **every** matching rule file.

| Trigger | Rule file |
| --- | --- |
| File change needed (create / modify / delete) | `.ai/rules/write-gate.md` |
| External info required (API, package, version, runtime behavior) | `.ai/rules/search-policy.md` |
| Any code or test change | `.ai/rules/test-standards.md` |
| Starting a task, planning, or scoping | `.ai/rules/workflow.md` |
| Choosing runtime, library, or native API | `.ai/rules/bun-first.md` |

Multiple triggers may fire at once — read all applicable files.

## Format Gate Principle

**"No format block → no action."**

Each rule file defines required output blocks (e.g., `[Bun-first Check]`, `[Evidence]`, `[RED Checkpoint]`).
If a rule applies but its required block is absent from the response, the corresponding action is **prohibited**.
This is not a suggestion — it is a hard gate.

## MCP Tool Usage

### Required MCP Tools

- `context7`: package/version/option/spec/compatibility verification
- `sequential-thinking`: all analysis/judgment/planning tasks
- `firebat`: project codebase analysis

Usage of reasoning, assumptions, simulation, memory, or experience to substitute MCP is forbidden.

### sequential-thinking — MUST use when:

- Any analysis, judgment, or planning task (use as the FIRST tool call)
- Exception: simple single-file reads or trivial lookups

### firebat — Tool Selection Matrix:

| Situation | Tool(s) |
|-----------|--------|
| After code change | `scan` (mandatory) |
| Find symbol | `index_symbols` → `search_symbol_from_index` |
| Refactoring | `find_references` → `rename_symbol` |
| Code pattern search | `find_pattern` (ast-grep syntax) |
| Type/signature check | `get_hover` |
| External library API | `index_external_libraries` → `search_external_library_symbols` |

### MCP verification before value/judgment answers

Before answering questions about MCP usefulness, availability, efficiency, or CLI-vs-MCP trade-offs:

1. MUST verify current MCP capability/state first.
2. MUST run at least: `check_capabilities`, `check_tool_availability`, `get_project_overview`
3. MUST NOT claim "MCP is unnecessary/less useful/unavailable" without those checks.

### On MCP failure:

1. STOP immediately
2. Tell the user: "MCP tool name + what information was needed"
3. Wait for the user to provide MCP results
4. NEVER substitute with reasoning/assumptions
