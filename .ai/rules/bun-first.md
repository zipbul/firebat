# Bun-first Policy

## Runtime Priority

1. **Bun built-in / Bun runtime API** — highest
2. Node.js standard API — only when Bun lacks support
3. npm packages — only when Bun and Node cannot solve it
4. Custom implementation — last resort

## Scope

Applies to **every** case where Node.js API, npm package, or custom implementation is considered.
No exception for size or perceived importance. A one-liner utility still requires Bun-alternative verification.

## Verification Flow

1. About to use Node.js / npm / custom implementation → **STOP.**
2. Search Bun official documentation for an equivalent Bun API. Follow `.ai/rules/search-policy.md` lookup priority.
3. Bun alternative **exists** → use it.
4. Bun alternative **confirmed absent** (with search evidence) → present the evidence + proposed alternative → obtain `ㅇㅇ`.

**Selecting Node/npm without search verification is a policy violation.**

## Required Output Block (hard gate)

When this rule triggers, the response MUST contain the following block **before any code that uses the chosen API**.
Absence of this block = decision not made = code using Node/npm/custom is **prohibited**.

```
[Bun-first Check]
- API/module considered: (e.g., node:url fileURLToPath)
- Bun alternative searched: (yes/no)
- Source 1: (URL or tool + result summary)
- Source 2: (URL or tool + result summary)
- Bun alternative exists: (yes → use it / no → justify)
- Decision: (Bun API name / Node API name + reason)
```

- Both `Source 1` and `Source 2` must be filled (dual-source per `search-policy.md`).
- If Bun alternative exists → `Decision` MUST be the Bun API. No override allowed.
- If Bun alternative absent → `ㅇㅇ` approval required before proceeding.

## Node.js Dependency Minimization

- Do not replicate existing Node.js patterns in new code if a Bun alternative exists.
- When encountering Node.js API usage in existing code, propose migration to Bun equivalent (approval required).
