# Test Standards

## Layers

| Layer | Pattern | Location | SUT Boundary |
|-------|---------|----------|--------------|
| Unit | `*.spec.ts` | Colocated with source | Single export (function/class) |
| Integration | `*.test.ts` | `test/` | Cross-module combination |

```
Rule: TST-LAYER
Violation: File extension or location does not match the table above
Enforcement: block
```

## Isolation (common principle across all layers)

All dependencies outside the SUT boundary MUST be mocked/stubbed.
All dependencies inside the SUT boundary MUST use real implementations.
Only the SUT boundary differs per layer; the isolation principle is identical.

- **Unit**: SUT = single export. All external modules/functions it calls = mock (except DTO/Value Objects).
- **Integration**: SUT = combined module set. Inside the set = real, outside = mock.

```
Rule: TST-ISOLATION
Violation: Dependency outside SUT boundary runs without mock/stub,
           or dependency inside SUT boundary is mocked
Enforcement: block
```

```
Rule: TST-HERMETIC
Violation: Non-deterministic resources (I/O, time, random) used inside SUT boundary without mock
Enforcement: block
```

```
Rule: TST-SIDE-EFFECT-SPY
Violation: SUT calls a side-effect (write/delete/send) on an outside dependency
           without spy verification (call count + arguments)
Enforcement: block
```

## Access Boundary

- **Unit**: White-box access to SUT internals allowed.
- **Integration**: Public (exported) API only.

If test access to private members is needed, export them via a `__testing__` object in the source file.
Bypass access to unexported members (type assertion, dynamic property, etc.) is prohibited.

```
Rule: TST-ACCESS
Violation: Integration test accesses unexported member without __testing__ export
Enforcement: block
```

## Test Case Design

### Exhaustive Scenario Enumeration

Before proposing, planning, or writing any test — including enhancement of existing tests —
the agent MUST enumerate test scenarios exhaustively.
This is a **hard gate** — skipping this step prohibits all subsequent test authoring.

#### TST-OVERFLOW — Scenario Flood

For every module/function under test, use `sequential-thinking` MCP to enumerate
**at least 50 scenarios per category** across all 8 categories below.

| # | Category | Description |
|---|----------|-------------|
| 1 | Happy Path | Valid inputs producing expected outputs; primary use cases |
| 2 | Negative / Error | Invalid inputs, error paths, expected exceptions |
| 3 | Edge | Single boundary condition: empty, zero, one, max, min |
| 4 | Corner | Two or more boundary conditions occurring simultaneously |
| 5 | State Transition | Lifecycle changes, reuse after close/dispose, re-initialization |
| 6 | Concurrency / Race | Simultaneous access, ordering races, timing sensitivity |
| 7 | Idempotency | Repeated identical operations must yield identical results |
| 8 | Ordering | Input/execution order affecting outcomes |

**Hard constraints — no exceptions:**

- Each applicable category MUST have **≥ 50 scenarios**. Fewer is a rule violation.
- If a category does not apply to the target, declare `N/A: [concrete reason]`.
  The exclusion declaration itself is evidence of deliberation. Unjustified `N/A` is a violation.
- All enumeration MUST be performed via `sequential-thinking` MCP. Inline reasoning is prohibited.

**Required output — gate block:**

```
[OVERFLOW Checkpoint]
- Target: (module/function name)
- Categories enumerated: (list with count per category, or N/A with reason)
- Total scenarios: (number)
```

Without this block → PRUNE is **prohibited**.

```
Rule: TST-OVERFLOW
Violation: Test code authored without prior scenario enumeration via sequential-thinking,
           or any applicable category has fewer than 50 scenarios,
           or a category is marked N/A without concrete justification,
           or [OVERFLOW Checkpoint] block is missing
Enforcement: block
```

#### TST-PRUNE — Deduplication & Filtering

After OVERFLOW, review all enumerated scenarios and remove:

1. **Duplicates** — scenarios exercising the same code path. Merge into one.
2. **Excessive** — scenarios with no practical verification value.

**Hard constraints:**

- Every removal MUST state its rationale (e.g., "#12 and #35 test the same branch; keeping #12").
- Produce a **numbered final test list** with category tags.
- The final list is the **sole basis** for test code authoring. No ad-hoc additions without re-running OVERFLOW.

**Required output — gate block:**

```
[PRUNE Checkpoint]
- Scenarios before: (number)
- Removed: (number, with rationale summary)
- Final test count: (number)
```

Without this block → test code authoring is **prohibited**.

```
Rule: TST-PRUNE
Violation: Test code authored without a finalized PRUNE list,
           or scenarios removed without stated rationale,
           or test code contains cases not present in the PRUNE list,
           or [PRUNE Checkpoint] block is missing
Enforcement: block
```

### Branch Coverage (Unit / Integration only)

Every branch in the SUT MUST have a corresponding `it`.
Branches include: if, else, switch/case, early return, throw, catch, ternary (`? :`), optional chaining (`?.`), nullish coalescing (`??`).

```
Rule: TST-BRANCH
Applies to: Unit, Integration
Violation: A SUT branch (if/else/switch/early return/throw/catch/ternary/?./??)
           has no corresponding it
Enforcement: block
```

### Input Partitioning (Unit / Integration only)

For each SUT parameter, identify equivalence classes and test one representative value + boundary values per class.

Required cases by type:

| Parameter Type | Required it |
|---------------|-------------|
| nullable (`T \| null \| undefined`) | null input, undefined input |
| array (`T[]`) | empty array, single element, multiple elements |
| string | empty string |
| number | 0, negative (if applicable) |
| union / enum | at least 1 per variant |
| boolean | true, false |

```
Rule: TST-INPUT-PARTITION
Applies to: Unit, Integration
Violation: An equivalence class of a SUT parameter is untested,
           or a required case from the type table above is missing
Enforcement: block
```

### No Duplicates

No two `it` blocks may verify the same branch + same equivalence class.
Different equivalence classes passing through the same branch are NOT duplicates.

```
Rule: TST-NO-DUPLICATE
Violation: Duplicate it blocks for the same branch and equivalence class
Enforcement: block
```

### Single Scenario

```
Rule: TST-SINGLE-SCENARIO
Violation: A single it verifies multiple scenarios or branches
Enforcement: block
```

## Test Structure

```
Rule: TST-BDD
Violation: it title is not in BDD format (should ... when ...)
Enforcement: block
```

```
Rule: TST-AAA
Violation: it body does not follow Arrange → Act → Assert structure
Enforcement: block
```

```
Rule: TST-DESCRIBE-UNIT
Violation: Unit test describe 1-depth is not the SUT identifier,
           or describe title starts with "when "
Enforcement: block
```

## Test Hygiene

```
Rule: TST-CLEANUP
Violation: Test-created resources not cleaned up in teardown
Enforcement: block
```

```
Rule: TST-STATE
Violation: Shared mutable state exists between tests
Enforcement: block
```

```
Rule: TST-RUNNER
Violation: Test runner other than bun:test is used
Enforcement: block
```

```
Rule: TST-COVERAGE-MAP
Violation: A directory has ≥ 1 *.spec.ts but contains *.ts files
           without a corresponding spec
           (excludes *.d.ts, *.spec.ts, *.test.ts, index.ts, types.ts)
Enforcement: block
```
