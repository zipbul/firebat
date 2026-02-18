# Workflow Rules

## Spec-Check Loop

1. Before starting, read relevant SPEC/PLAN documents.
2. Extract a requirements checklist.
3. After completion, re-compare against the checklist.
4. Report any missing items.

## Impact-First

Before modifying code, **assess impact scope first:**

1. Search for all usages/references of the target symbol.
2. Search for related imports/dependencies.
3. Include impact scope in approval Targets.

## Test-First Flow

1. Determine the scope of changes.
2. **OVERFLOW**: Follow `TST-OVERFLOW` (test-standards.md). Output `[OVERFLOW Checkpoint]`.
3. **PRUNE**: Follow `TST-PRUNE` (test-standards.md). Output `[PRUNE Checkpoint]`.
4. **Write ALL tests** (unit + integration) based solely on the PRUNE output.
5. Execute tests → confirm RED → report to user.
6. `ㅇㅇ` approval → begin implementation.
7. Implementation complete → confirm GREEN.

### Stage Gate Blocks

Each stage transition requires its gate block in the response. **No gate block → no transition.**

Gate chain: **OVERFLOW → PRUNE → RED → GREEN**. Skipping any gate is a rule violation.

**After step 5 (RED confirmed):**
```
[RED Checkpoint]
- Test file(s): (paths)
- Execution result: (fail count + key error messages)
- Status: RED confirmed
```
Without this block → implementation code is **prohibited**.

**After step 7 (GREEN confirmed):**
```
[GREEN Checkpoint]
- Test file(s): (paths)
- Execution result: (pass count)
- Status: GREEN confirmed
```
Without this block → commit proposal is **prohibited**.

## Incremental Test Run

- After each file modification, **immediately run related tests.**
- On failure → do not proceed to the next file. Fix first.
- After all files are modified → run full test suite.

## Commit Checkpoint

- Propose a commit at each logical unit (one feature, one bug fix).
- Commit message follows conventional commits format.
- User approves → execute. User declines → skip.
