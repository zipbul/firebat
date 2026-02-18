# PLAN: Catalog-Driven Report Schema Overhaul

> **Goal**: Replace the type-unsafe, incomplete catalog system with a type-enforced, agent-optimized report schema.
> **Scope**: 8 files modified, 1 file created.

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Design Decisions](#2-design-decisions)
3. [Type Definitions (types.ts)](#3-type-definitions)
4. [Catalog Rewrite (diagnostic-aggregator.ts)](#4-catalog-rewrite)
5. [Enrich Hardening (scan.usecase.ts)](#5-enrich-hardening)
6. [Output Projection (report.ts, server.ts)](#6-output-projection)
7. [Test Plan](#7-test-plan)
8. [File-by-File Change Ledger](#8-file-by-file-change-ledger)
9. [Implementation Order](#9-implementation-order)
10. [Verification Checklist](#10-verification-checklist)

---

## 1. Problem Statement

### 1-A. Catalog keys are untyped strings

```typescript
// src/types.ts L380-383
export interface CodeEntry {
  readonly cause: string;
  readonly approach: string;   // ← generic advice, not a thinking prompt
}

// src/types.ts L542
readonly catalog: Readonly<Record<string, CodeEntry>>;  // ← string keys, zero enforcement
```

`Record<string, …>` means any typo compiles. No compile-time guarantee that every finding code has a catalog entry.

### 1-B. Phase 1 detectors have zero catalog coverage

12 detectors (implicit-state, temporal-coupling, symmetry-breaking, invariant-blindspot, modification-trap, modification-impact, variable-lifetime, decision-surface, implementation-overhead, concept-scatter, abstraction-fitness, giant-file) have:
- No enrich function → no `code` field on findings
- No entry in `FIREBAT_CODE_CATALOG`

### 1-C. `as any` in catalog lookup

```typescript
// src/application/scan/scan.usecase.ts L1415
const entry = (FIREBAT_CODE_CATALOG as any)[code];  // ← type safety completely bypassed
```

### 1-D. CLI json ≠ MCP json

- CLI: `JSON.stringify(report)` → `FirebatReport` with `meta`, `top`, `catalog`
- MCP: `{ report: FirebatReport, timings: { totalMs }, diff?: … }` → extra wrapping

### 1-E. `meta` and `top` are agent noise

- `meta.engine`, `meta.targetCount`, `meta.minSize`, `meta.maxForwardDepth`, `meta.detectorTimings` are not useful for agents
- `top` is a frequency table — agents can derive this from `analyses`

### 1-F. `dependencies` is the only non-array analysis

`FirebatAnalyses['dependencies']` = `DependencyAnalysis` (object), all others are arrays. This causes:
- `computeTopAndCatalog` skips dependencies (`if (!Array.isArray(value)) continue`) → `DEP_LAYER_VIOLATION`, `DEP_DEAD_EXPORT`, `DEP_TEST_ONLY_EXPORT` are never collected into catalog
- `adjacency`, `exportStats`, `fanIn`, `fanOut` are intermediate data not needed by agents (coupling detector already produces actionable findings from them)

### 1-G. lint / format / typecheck have no catalog entry

External tool results use their own code schemes (`no-unused-vars`, `TS2304`). Currently excluded from catalog entirely.

---

## 2. Design Decisions

Each decision is **final** and must not be re-discussed during implementation.

### D1. Two report types: internal and public

| Type | Purpose | Used by |
|------|---------|---------|
| `FirebatReport` (internal) | `scanUseCase` return. Contains `meta` for text rendering. | `scanUseCase`, `formatText`, integration tests |
| `FirebatJsonReport` (public) | CLI `--format json` and MCP output. No `meta`, no `top`. | `formatReport(…, 'json')`, MCP scan handler |

**Rationale**: Changing `scanUseCase` return type would break 100+ integration tests. Keep internal type, project to public type at output boundary.

### D2. `FirebatCatalogCode` union = single source of truth

80 literal string members. Every finding code in the codebase MUST be a member of this union. Adding a detector without adding its code to the union = compile error.

### D3. `satisfies` for catalog completeness

```typescript
export const FIREBAT_CODE_CATALOG = { … } as const satisfies Record<FirebatCatalogCode, CatalogEntry>;
```

Missing any of the 80 keys = compile error.

### D4. Report catalog = Partial (used codes only)

```typescript
readonly catalog: Readonly<Partial<Record<FirebatCatalogCode, CatalogEntry>>>;
```

Only codes that appear in `analyses` are included. Saves tokens for agent context windows.

### D5. Finding type: strict 2 shapes

```typescript
interface ItemFinding { readonly code: FirebatCatalogCode; readonly file: string; readonly span: SourceSpan; }
interface GroupFinding { readonly code: FirebatCatalogCode; readonly items: ReadonlyArray<{ readonly file: string; readonly span: SourceSpan }>; }
```

Every finding type extends one of these two. No third shape allowed.

### D6. dependencies normalized to array

`DependencyAnalysis` (object with adjacency, fanIn, etc.) → `ReadonlyArray<DependencyFinding>` (discriminated union of ItemFinding/GroupFinding subtypes). Removed fields: `adjacency`, `exportStats`, `fanIn`, `fanOut`. `cuts` absorbed into cycle finding.

### D7. lint / format / typecheck get detector-level catalog codes

`LINT`, `FORMAT`, `TYPECHECK` — one code per detector. CatalogEntry contains thinking prompts about how to approach the results, not about individual rules.

### D8. CatalogEntry structure

```typescript
interface CatalogEntry { readonly cause: string; readonly think: ReadonlyArray<string>; }
```

`approach: string` → `think: ReadonlyArray<string>`. Each element is a reasoning step that guides agents to identify root causes and structural issues. Written in English. No tool usage instructions (no "--fix", no "run prettier").

### D9. MCP: no wrapping, no timings, no diff

MCP scan output = `FirebatJsonReport` directly. `diffReports`, `lastReport`, `timings` all removed.

### D10. `top` removed from both internal and public

`FirebatReport.top` is deleted. `computeTopAndCatalog` renamed to `computeCatalog`. `Priority` type deleted. `aggregateDiagnostics` return type simplified (catalog only, no top).

---

## 3. Type Definitions

All changes in `src/types.ts`.

### 3-A. Add `FirebatCatalogCode` union (after line 39, after `FirebatDetector` type)

```typescript
export type FirebatCatalogCode =
  // waste (3)
  | 'WASTE_DEAD_STORE'
  | 'WASTE_DEAD_STORE_OVERWRITE'
  | 'WASTE_MEMORY_RETENTION'
  // noop (5)
  | 'NOOP_EXPRESSION'
  | 'NOOP_SELF_ASSIGNMENT'
  | 'NOOP_CONSTANT_CONDITION'
  | 'NOOP_EMPTY_CATCH'
  | 'NOOP_EMPTY_FUNCTION_BODY'
  // barrel-policy (6)
  | 'BARREL_EXPORT_STAR'
  | 'BARREL_DEEP_IMPORT'
  | 'BARREL_INDEX_DEEP_IMPORT'
  | 'BARREL_MISSING_INDEX'
  | 'BARREL_INVALID_INDEX_STMT'
  | 'BARREL_SIDE_EFFECT_IMPORT'
  // nesting (4)
  | 'NESTING_DEEP'
  | 'NESTING_HIGH_CC'
  | 'NESTING_ACCIDENTAL_QUADRATIC'
  | 'NESTING_CALLBACK_DEPTH'
  // early-return (2)
  | 'EARLY_RETURN_INVERTIBLE'
  | 'EARLY_RETURN_MISSING_GUARD'
  // exception-hygiene (17)
  | 'EH_THROW_NON_ERROR'
  | 'EH_ASYNC_PROMISE_EXECUTOR'
  | 'EH_MISSING_ERROR_CAUSE'
  | 'EH_USELESS_CATCH'
  | 'EH_UNSAFE_FINALLY'
  | 'EH_RETURN_IN_FINALLY'
  | 'EH_CATCH_OR_RETURN'
  | 'EH_PREFER_CATCH'
  | 'EH_PREFER_AWAIT_TO_THEN'
  | 'EH_FLOATING_PROMISES'
  | 'EH_MISUSED_PROMISES'
  | 'EH_RETURN_AWAIT_POLICY'
  | 'EH_SILENT_CATCH'
  | 'EH_CATCH_TRANSFORM'
  | 'EH_REDUNDANT_NESTED_CATCH'
  | 'EH_OVERSCOPED_TRY'
  | 'EH_EXCEPTION_CONTROL_FLOW'
  // unknown-proof (6)
  | 'UNKNOWN_TYPE_ASSERTION'
  | 'UNKNOWN_DOUBLE_ASSERTION'
  | 'UNKNOWN_UNNARROWED'
  | 'UNKNOWN_UNVALIDATED'
  | 'UNKNOWN_INFERRED'
  | 'UNKNOWN_ANY_INFERRED'
  // forwarding (3)
  | 'FWD_THIN_WRAPPER'
  | 'FWD_FORWARD_CHAIN'
  | 'FWD_CROSS_FILE_CHAIN'
  // coupling (5)
  | 'COUPLING_GOD_MODULE'
  | 'COUPLING_BIDIRECTIONAL'
  | 'COUPLING_OFF_MAIN_SEQ'
  | 'COUPLING_UNSTABLE'
  | 'COUPLING_RIGID'
  // api-drift (1)
  | 'API_DRIFT_SIGNATURE'
  // dependencies (3)
  | 'DEP_LAYER_VIOLATION'
  | 'DEP_DEAD_EXPORT'
  | 'DEP_TEST_ONLY_EXPORT'
  // duplicates (3)
  | 'EXACT_DUP_TYPE_1'
  | 'STRUCT_DUP_TYPE_2_SHAPE'
  | 'STRUCT_DUP_TYPE_3_NORMALIZED'
  // diagnostics (7)
  | 'DIAG_GOD_FUNCTION'
  | 'DIAG_CIRCULAR_DEPENDENCY'
  | 'DIAG_GOD_MODULE'
  | 'DIAG_DATA_CLUMP'
  | 'DIAG_SHOTGUN_SURGERY'
  | 'DIAG_OVER_INDIRECTION'
  | 'DIAG_MIXED_ABSTRACTION'
  // Phase 1 detectors (12)
  | 'IMPLICIT_STATE'
  | 'TEMPORAL_COUPLING'
  | 'SYMMETRY_BREAK'
  | 'INVARIANT_BLINDSPOT'
  | 'MOD_TRAP'
  | 'MOD_IMPACT'
  | 'VAR_LIFETIME'
  | 'DECISION_SURFACE'
  | 'IMPL_OVERHEAD'
  | 'CONCEPT_SCATTER'
  | 'ABSTRACTION_FITNESS'
  | 'GIANT_FILE'
  // external tools (3)
  | 'LINT'
  | 'FORMAT'
  | 'TYPECHECK';
```

### 3-B. Replace `CodeEntry` (line 380-383)

**Before:**
```typescript
export interface CodeEntry {
  readonly cause: string;
  readonly approach: string;
}
```

**After:**
```typescript
export interface CatalogEntry {
  readonly cause: string;
  readonly think: ReadonlyArray<string>;
}
```

Keep `CodeEntry` as a deprecated alias for backward compatibility during transition:
```typescript
/** @deprecated Use CatalogEntry */
export type CodeEntry = CatalogEntry;
```

### 3-C. Add `ItemFinding`, `GroupFinding`, `NoopKind`, `CouplingKind` (after `SourceSpan` definition, ~line 55)

`ItemFinding` and `GroupFinding` describe the **enriched** finding shape (post-enrich). Individual finding types do NOT `extends` these — they exist as documentation/constraint interfaces.

```typescript
export interface ItemFinding {
  readonly code: FirebatCatalogCode;
  readonly file: string;
  readonly span: SourceSpan;
}

export interface GroupFinding {
  readonly code: FirebatCatalogCode;
  readonly items: ReadonlyArray<{
    readonly file: string;
    readonly span: SourceSpan;
  }>;
}
```

Add missing Kind unions needed for Section 5-A kindToCode type hardening:

```typescript
export type NoopKind =
  | 'expression-noop'
  | 'self-assignment'
  | 'constant-condition'
  | 'empty-catch'
  | 'empty-function-body';

export type CouplingKind =
  | 'god-module'
  | 'bidirectional-coupling'
  | 'off-main-sequence'
  | 'unstable-module'
  | 'rigid-module';
```

Also narrow `NoopFinding.kind` from `string` to `NoopKind`.

### 3-D. Add `code` field to every finding type

**All `code` fields MUST be optional.** Detectors create findings *without* `code`. Enrich functions add `code` via spread. If `code` is mandatory, detector code won't compile.

For each finding type, add `readonly code?: FirebatCatalogCode;` if absent. Do NOT remove existing `code: string` fields on `LintDiagnostic`, `TypecheckItem` — they use external tool codes.

Specific changes:

| Type | Current `code` | Change |
|------|---------------|--------|
| `WasteFinding` (L320) | absent | Add `readonly code?: FirebatCatalogCode;` |
| `NoopFinding` (L253) | absent | Add `readonly code?: FirebatCatalogCode;` |
| `BarrelPolicyFinding` (L267) | absent | Add `readonly code?: FirebatCatalogCode;` |
| `NestingItem` (L220) | `code?: string` | Change to `readonly code?: FirebatCatalogCode;` |
| `EarlyReturnItem` (L236) | `code?: string` | Change to `readonly code?: FirebatCatalogCode;` |
| `ExceptionHygieneFinding` (features/exception-hygiene/types.ts L33) | `code?: string` | Change to `readonly code?: FirebatCatalogCode;` |
| `UnknownProofFinding` (L355) | absent | Add `readonly code?: FirebatCatalogCode;` |
| `ForwardingFinding` (L279) | absent | Add `readonly code?: FirebatCatalogCode;` |
| `CouplingHotspot` (L188) | absent | Add `readonly code?: FirebatCatalogCode;` |
| `DuplicateGroup` (L109) | absent | Add `readonly code?: FirebatCatalogCode;` |
| `ApiDriftGroup` (L306) | absent | Add `readonly code?: FirebatCatalogCode;` on outliers |
| `LintDiagnostic` (L336) | `code?: string` (oxlint rule ID) | Keep `code?: string;`, add `readonly catalogCode?: FirebatCatalogCode;` |
| `TypecheckItem` (L351) | `code: string` (TS error code) | Keep `code: string;`, add `readonly catalogCode?: FirebatCatalogCode;` |
| `GiantFileFinding` (L527) | `code: string` | Change to `readonly code?: FirebatCatalogCode;` |
| `ImplicitStateFinding` (L402) | absent | Add `readonly code?: FirebatCatalogCode;` |
| `TemporalCouplingFinding` (L410) | absent | Add `readonly code?: FirebatCatalogCode;` |
| `SymmetryBreakingFinding` (L419) | absent | Add `readonly code?: FirebatCatalogCode;` |
| `InvariantBlindspotFinding` (L428) | absent | Add `readonly code?: FirebatCatalogCode;` |
| `ModificationTrapFinding` (L435) | absent | Add `readonly code?: FirebatCatalogCode;` |
| `ModificationImpactFinding` (L443) | absent | Add `readonly code?: FirebatCatalogCode;` |
| `VariableLifetimeFinding` (L452) | absent | Add `readonly code?: FirebatCatalogCode;` |
| `DecisionSurfaceFinding` (L461) | absent | Add `readonly code?: FirebatCatalogCode;` |
| `ImplementationOverheadFinding` (L470) | absent | Add `readonly code?: FirebatCatalogCode;` |
| `ConceptScatterFinding` (L480) | absent | Add `readonly code?: FirebatCatalogCode;` |
| `AbstractionFitnessFinding` (L492) | absent | Add `readonly code?: FirebatCatalogCode;` |

**Exception for lint/typecheck**: These findings have their own `code` field with external tool codes. Add a separate `catalogCode?: FirebatCatalogCode` field instead. The enrich functions will set `catalogCode: 'LINT'` or `catalogCode: 'TYPECHECK'`. The `computeCatalog` function already handles optional code (`typeof code === 'string'` check).

### 3-E. Add `DependencyFinding` union (enriched dependency shapes)

**Keep** `DependencyAnalysis` interface unchanged — it is used by `features/dependencies/analyzer.ts` (return type) and `features/coupling/analyzer.ts` (input parameter). Also keep `DependencyDeadExportFinding` (L135) and `DependencyLayerViolation` (L126) — they describe the raw analyzer output.

**Keep** `DependencyCycle`, `DependencyFanStat`, `DependencyEdgeCutHint`, `DependencyExportStats` types — they remain available for internal computation.

Add **new** enriched finding types with distinct names (to avoid collision with existing raw types):

```typescript
export interface DepLayerViolationFinding {
  readonly code: FirebatCatalogCode;
  readonly kind: 'layer-violation';
  readonly file: string;
  readonly span: SourceSpan;
  readonly from: string;
  readonly to: string;
  readonly fromLayer: string;
  readonly toLayer: string;
}

export interface DepDeadExportFinding {
  readonly code: FirebatCatalogCode;
  readonly kind: 'dead-export' | 'test-only-export';
  readonly file: string;
  readonly span: SourceSpan;
  readonly module: string;
  readonly name: string;
}

export interface DepCycleFinding {
  readonly code: FirebatCatalogCode;
  readonly kind: 'circular-dependency';
  readonly items: ReadonlyArray<{
    readonly file: string;
    readonly span: SourceSpan;
  }>;
  readonly cut?: {
    readonly from: string;
    readonly to: string;
    readonly score?: number;
  };
}

export type DependencyFinding =
  | DepLayerViolationFinding
  | DepDeadExportFinding
  | DepCycleFinding;
```

**Note**: These enriched types use `code: FirebatCatalogCode` (required, not optional) because they are only constructed by `enrichDependencies`, which always sets code.

### 3-F. Update `FirebatAnalyses`

Add `FormatFinding` type:
```typescript
export interface FormatFinding {
  readonly code: FirebatCatalogCode;
  readonly kind: 'needs-formatting';
  readonly file: string;
  readonly span: SourceSpan;
}
```

**Step 1 (transition)** — use union types to avoid compile errors before enrich functions are updated in Step 7:
```typescript
readonly dependencies: DependencyAnalysis | ReadonlyArray<DependencyFinding>;
readonly format: ReadonlyArray<string> | ReadonlyArray<FormatFinding>;
```

**Final cleanup (post-Step 7)** — remove union, keep only target types:
```typescript
readonly dependencies: ReadonlyArray<DependencyFinding>;
readonly format: ReadonlyArray<FormatFinding>;
```

`lint` and `typecheck` keep their existing array types. `LintDiagnostic` now has `catalogCode?`, `TypecheckItem` now has `catalogCode?`.

### 3-G. Deprecate `Priority` interface (line 376-380)

Mark as deprecated but **keep** until Step 7 removes all references (see Section 9):
```typescript
/** @deprecated Will be removed after top field is deleted */
export interface Priority {
  readonly pattern: string;
  readonly detector: string;
  readonly resolves: number;
}
```

Final cleanup (after Step 7): delete `Priority` interface entirely.

### 3-H. Update `FirebatReport` (internal, line 538-543)

**Before:**
```typescript
export interface FirebatReport {
  readonly meta: FirebatMeta;
  readonly analyses: Partial<FirebatAnalyses>;
  readonly top: ReadonlyArray<Priority>;
  readonly catalog: Readonly<Record<string, CodeEntry>>;
}
```

**After (Step 1 — transition):**
```typescript
export interface FirebatReport {
  readonly meta: FirebatMeta;
  readonly analyses: Partial<FirebatAnalyses>;
  /** @deprecated Will be removed after computeTopAndCatalog is replaced */
  readonly top?: ReadonlyArray<Priority>;
  readonly catalog: Readonly<Partial<Record<FirebatCatalogCode, CatalogEntry>>>;
}
```

**After (final cleanup, post-Step 7):**
```typescript
export interface FirebatReport {
  readonly meta: FirebatMeta;
  readonly analyses: Partial<FirebatAnalyses>;
  readonly catalog: Readonly<Partial<Record<FirebatCatalogCode, CatalogEntry>>>;
}
```

### 3-I. Add `FirebatJsonReport` (public, after `FirebatReport`)

```typescript
export interface FirebatJsonReport {
  readonly detectors: ReadonlyArray<FirebatDetector>;
  readonly errors?: Readonly<Record<string, string>>;
  readonly analyses: Partial<FirebatAnalyses>;
  readonly catalog: Readonly<Partial<Record<FirebatCatalogCode, CatalogEntry>>>;
}
```

### 3-J. Add `toJsonReport` function

```typescript
export const toJsonReport = (report: FirebatReport): FirebatJsonReport => ({
  detectors: report.meta.detectors,
  ...(report.meta.errors !== undefined && Object.keys(report.meta.errors).length > 0
    ? { errors: report.meta.errors }
    : {}),
  analyses: report.analyses,
  catalog: report.catalog,
});
```

---

## 4. Catalog Rewrite

All changes in `src/application/scan/diagnostic-aggregator.ts`.

### 4-A. Remove local `CodeEntry` interface (lines 12-15)

Delete the local `CodeEntry` definition. Import from types:
```typescript
import type { CatalogEntry, FirebatCatalogCode } from '../../types';
```

### 4-B. Remove local `Priority` interface (lines 6-10)

Delete. Import is no longer needed since top is removed.

### 4-C. Change `DiagnosticAggregatorOutput`

**Before:**
```typescript
interface DiagnosticAggregatorOutput {
  readonly top: ReadonlyArray<Priority>;
  readonly catalog: Readonly<Record<string, CodeEntry>>;
}
```

**After:**
```typescript
interface DiagnosticAggregatorOutput {
  readonly catalog: Readonly<Partial<Record<FirebatCatalogCode, CatalogEntry>>>;
}
```

### 4-D. Rewrite `FIREBAT_CODE_CATALOG`

Change type from `Readonly<Record<string, CodeEntry>>` to `satisfies Record<FirebatCatalogCode, CatalogEntry>`.

Replace every `approach: '…'` with `think: ['…', '…', …]`.

**Structure for each entry:**
```typescript
WASTE_DEAD_STORE: {
  cause: '<one sentence explaining the structural root cause>',
  think: [
    '<step 1: what to investigate first>',
    '<step 2: what structural/design issue to check>',
    '<step 3: what broader pattern to look for>',
    '<step 4: what to verify before making changes>',
  ],
},
```

**Rules for `think` content:**
- Each step guides the agent toward root cause identification, NOT toward applying a fix
- No tool usage instructions (no "run --fix", no "use prettier")
- No generic advice (no "consider refactoring")
- Each step should ask the agent to verify something specific about the code structure
- Written in English

**Add 15 new entries** (12 Phase 1 + 3 external tools):

```typescript
IMPLICIT_STATE: {
  cause: 'Module-level mutable state is modified across function calls without explicit protocol, creating hidden coupling between callers.',
  think: [
    'Identify all functions that read or write this state — determine if they form an implicit protocol (init → use → cleanup).',
    'Check whether callers depend on a specific mutation order that is not enforced by the API surface.',
    'Determine if the state can be converted to explicit parameter passing or encapsulated in a class with enforced lifecycle.',
    'Verify whether concurrent or re-entrant calls could observe inconsistent state.',
  ],
},
TEMPORAL_COUPLING: {
  cause: 'Multiple functions must be called in a specific order because they share mutable state, but the required sequence is not enforced by types or API design.',
  think: [
    'Map all writers and readers of the shared state to establish the required call sequence.',
    'Determine whether the ordering constraint is inherent to the domain or an artifact of the current implementation.',
    'Check if a builder pattern, pipeline, or state machine could make the required sequence explicit and compiler-enforced.',
    'Verify whether violating the sequence causes silent corruption or an immediate error.',
  ],
},
SYMMETRY_BREAK: {
  cause: 'A group of functions that should follow the same structural pattern has an outlier with a different signature, breaking the implicit contract.',
  think: [
    'Identify what the majority signature represents — is it an established convention or an accidental majority?',
    'Determine whether the outlier diverges for a valid domain reason or due to incremental drift.',
    'Check if callers of the outlier have to special-case their logic because of the signature difference.',
    'Verify whether aligning the outlier would require changes that propagate beyond the immediate function.',
  ],
},
INVARIANT_BLINDSPOT: {
  cause: 'A runtime assumption is relied upon but not checked, meaning violations will propagate silently until they cause failures far from the source.',
  think: [
    'Identify the exact assumption being made — what property must hold for the subsequent code to be correct?',
    'Trace where the assumed value originates and whether its producer guarantees the property.',
    'Determine the failure mode: what happens when the invariant is violated? Is it a silent data corruption or a crash?',
    'Check whether a type narrowing, assertion, or schema validation at the boundary would catch violations early.',
  ],
},
MOD_TRAP: {
  cause: 'A code pattern makes safe modification structurally difficult — changes that appear local have non-obvious side effects or require coordinated updates elsewhere.',
  think: [
    'Identify what makes modification risky: is it shared mutable state, implicit dependencies, or semantic coupling?',
    'Determine whether the pattern repeats — if so, the trap is systemic, not local.',
    'Check if the modification surface can be narrowed by introducing an explicit interface or indirection point.',
    'Verify whether existing tests would catch a modification that breaks the implicit contract.',
  ],
},
MOD_IMPACT: {
  cause: 'A function or module has high modification impact radius — changes to it require verifying many downstream dependents.',
  think: [
    'Identify the high-risk callers and determine if they depend on the full interface or only a subset.',
    'Check whether the interface can be split into stable and volatile parts to reduce the blast radius.',
    'Determine if the dependents use the function in uniform ways (suggesting they could depend on an abstraction instead).',
    'Verify whether the impact radius is inherent to the domain or accidental coupling.',
  ],
},
VAR_LIFETIME: {
  cause: 'A variable is declared far from its first use or lives across many lines, increasing the cognitive burden of tracking its state.',
  think: [
    'Determine why the variable was declared early — does it depend on an earlier computation, or is it just a habit?',
    'Check whether the variable crosses a logical boundary (e.g., declared before a loop but used only inside it).',
    'Determine if the long lifetime masks a function that is doing too many things sequentially.',
    'Verify whether narrowing the scope would require restructuring the surrounding control flow.',
  ],
},
DECISION_SURFACE: {
  cause: 'A function has many independent decision axes that multiply into a large number of combinatorial paths, making exhaustive reasoning impractical.',
  think: [
    'Identify which decision axes are truly independent — independent axes can be factored into separate functions.',
    'Check for repeated condition checks that suggest the same decision is being made in multiple places.',
    'Determine whether the combinatorial paths represent real domain complexity or accidental condition accumulation.',
    'Verify whether a lookup table, strategy pattern, or early return chain could linearize the decision space.',
  ],
},
IMPL_OVERHEAD: {
  cause: 'The implementation complexity of a function far exceeds what its interface promises, suggesting hidden responsibilities or accidental complexity.',
  think: [
    'Compare the interface signature (parameters, return type) with the implementation body — what extra work is happening?',
    'Determine whether the overhead comes from error handling, data transformation, or coordination with other modules.',
    'Check if the excess complexity belongs in a different abstraction layer.',
    'Verify whether the interface could be redesigned to make the implementation straightforward.',
  ],
},
CONCEPT_SCATTER: {
  cause: 'A single domain concept is implemented across many files and layers, meaning a conceptual change requires coordinated modifications in scattered locations.',
  think: [
    'List all files that participate in this concept and determine what role each plays.',
    'Check whether the scatter follows the architecture (e.g., one file per layer is expected) or is accidental.',
    'Determine if the concept has a natural home module where most of its logic could be colocated.',
    'Verify whether the scatter causes actual change amplification — does modifying the concept always touch all listed files?',
  ],
},
ABSTRACTION_FITNESS: {
  cause: 'A module boundary does not align well with the actual usage patterns — internal cohesion is low or external coupling is high relative to what the module exports.',
  think: [
    'Examine what the module exports versus what its internals actually do — are the exports a coherent surface?',
    'Check whether consumers use the module as a whole or cherry-pick unrelated parts.',
    'Determine if splitting or merging with adjacent modules would improve the cohesion/coupling balance.',
    'Verify whether the fitness score reflects a real design problem or is an artifact of the current file organization.',
  ],
},
GIANT_FILE: {
  cause: 'A single file exceeds the line count threshold, suggesting it accumulates multiple responsibilities that could be separated.',
  think: [
    'Identify clusters of related functions/types within the file — each cluster is a candidate for extraction.',
    'Determine whether the file grew because of genuine complexity or because of convenience (adding to the nearest file).',
    'Check if the file has a single clear responsibility that simply requires many lines, or if it mixes concerns.',
    'Verify whether splitting would create circular dependencies between the resulting files.',
  ],
},
LINT: {
  cause: 'Static analysis rules flagged code patterns that correlate with bugs, maintenance burden, or inconsistent conventions.',
  think: [
    'Read the rule ID and understand what structural or semantic property it detects — do not treat it as a style preference.',
    'Trace the flagged construct to its origin: is it a leftover from refactoring, a design shortcut, or intentional divergence?',
    'Determine whether the pattern masks a deeper design issue — repeated lint hits in one module often signal responsibility overload.',
    'If the rule is project-wide noise rather than a real signal, the project configuration is the root cause, not individual call sites.',
  ],
},
FORMAT: {
  cause: 'Source files do not conform to the project formatter output, indicating either formatter was not applied or conflicting format configurations exist.',
  think: [
    'Determine whether the formatting difference is in a generated file, vendored code, or hand-written source.',
    'Check whether the project has a consistent formatter configuration that covers all source paths.',
    'If formatting differences cluster in specific directories, investigate whether those paths are excluded from the formatter.',
    'Determine whether the format divergence was introduced by a tool (code generator, IDE auto-format with different settings).',
  ],
},
TYPECHECK: {
  cause: 'The type checker reports errors indicating broken type contracts between modules or unresolvable type expressions.',
  think: [
    'Read the error code and locate the exact type mismatch — determine which side (provider or consumer) has the wrong type.',
    'Trace the type flow from its declaration to the error site to find where the contract breaks.',
    'Check whether the error is caused by a missing type narrowing, an incorrect generic instantiation, or a stale type declaration.',
    'Determine whether the type error is local or symptomatic of a structural mismatch between modules.',
  ],
},
```

Full catalog: 65 existing entries (converted from `approach` to `think`) + 15 new = 80 entries.

**Conversion rule for existing entries**: Split the `approach` string into 3-5 `think` array elements. Each element should be one investigative step. Rewrite to remove phrases like "consider", "replace with", or imperative fix instructions. Focus on "determine", "identify", "check whether", "trace", "verify".

### 4-E. Simplify `aggregateDiagnostics`

Remove all `top.push(…)` calls. Remove `top` from return value. Keep catalog population logic. The function now only returns `{ catalog }`.

Remove the `top.sort(…)` line.

---

## 5. Enrich Hardening

All changes in `src/application/scan/scan.usecase.ts`.

### 5-A. Strengthen `kindToCode` maps in every enrich function

**Pattern** — before:
```typescript
const kindToCode: Record<string, string> = {
  'dead-store': 'WASTE_DEAD_STORE',
  …
};
```

**Pattern** — after:
```typescript
const kindToCode: Readonly<Record<WasteKind, FirebatCatalogCode>> = {
  'dead-store': 'WASTE_DEAD_STORE',
  'dead-store-overwrite': 'WASTE_DEAD_STORE_OVERWRITE',
  'memory-retention': 'WASTE_MEMORY_RETENTION',
} as const;
```

The key type comes from the detector's Kind union (e.g., `WasteKind`, `NestingKind`, `EarlyReturnKind`, `BarrelPolicyFindingKind`, `ForwardingFindingKind`). The value type is `FirebatCatalogCode`. `satisfies` or `as const` enforced.

**Special handling for `tool-unavailable`**: `ExceptionHygieneFindingKind` and `UnknownProofFindingKind` both contain `'tool-unavailable'` which has no catalog code. Use `Exclude<>` in the Record key type and add a `.filter()` before `.map()` in the enrich function.

Apply to ALL enrich functions (lines 952-1340):
- `enrichWaste` (L952): `Record<WasteKind, FirebatCatalogCode>`
- `enrichNoop` (L974): `Record<NoopKind, FirebatCatalogCode>`
- `enrichBarrelPolicy` (L998): `Record<BarrelPolicyFindingKind, FirebatCatalogCode>`
- `enrichNesting` (L1022): `Record<NestingKind, FirebatCatalogCode>`
- `enrichEarlyReturn` (L1042): `Record<EarlyReturnKind, FirebatCatalogCode>`
- `enrichExceptionHygiene` (L1060): `Record<Exclude<ExceptionHygieneFindingKind, 'tool-unavailable'>, FirebatCatalogCode>` — filter out `tool-unavailable` before map
- `enrichUnknownProof` (L1095): `Record<Exclude<UnknownProofFindingKind, 'tool-unavailable'>, FirebatCatalogCode>` — filter out `tool-unavailable` before map
- `enrichForwarding` (L1121): `Record<ForwardingFindingKind, FirebatCatalogCode>`
- `enrichCoupling` (L1144): `Record<CouplingKind, FirebatCatalogCode>`
- `enrichApiDrift` (L1200): `{ signature: 'API_DRIFT_SIGNATURE' } as const`
- `enrichExactDuplicateGroups` (L1292): `Record<'type-1', FirebatCatalogCode>`
- `enrichDuplicateGroups` (L1308): `Record<DuplicateCloneType, FirebatCatalogCode>`

**Filter pattern for `tool-unavailable`** (applies to `enrichExceptionHygiene` and `enrichUnknownProof`):
```typescript
return items
  .filter(item => String(item?.kind ?? '') !== 'tool-unavailable')
  .map(item => { … });
```

`tool-unavailable` findings indicate tsgo is missing — this information is already captured in `meta.errors`. Dropping it from findings is safe.

### 5-B. Add Phase 1 enrich functions (12)

Each Phase 1 detector currently passes raw results directly to analyses without enrichment. Add an enrich function for each that:
1. Adds `code: FirebatCatalogCode` field
2. Converts `filePath` to project-relative path via `toProjectRelative()`

**Template:**
```typescript
const enrichImplicitState = (items: ReadonlyArray<any>): ReadonlyArray<any> => {
  return items.map(item => ({
    ...item,
    code: 'IMPLICIT_STATE' as FirebatCatalogCode,
    file: toProjectRelative(String(item?.file ?? item?.filePath ?? '')),
  }));
};
```

Repeat for all 12:
| Detector | Code |
|----------|------|
| implicit-state | `IMPLICIT_STATE` |
| temporal-coupling | `TEMPORAL_COUPLING` |
| symmetry-breaking | `SYMMETRY_BREAK` |
| invariant-blindspot | `INVARIANT_BLINDSPOT` |
| modification-trap | `MOD_TRAP` |
| modification-impact | `MOD_IMPACT` |
| variable-lifetime | `VAR_LIFETIME` |
| decision-surface | `DECISION_SURFACE` |
| implementation-overhead | `IMPL_OVERHEAD` |
| concept-scatter | `CONCEPT_SCATTER` |
| abstraction-fitness | `ABSTRACTION_FITNESS` |
| giant-file | `GIANT_FILE` |

### 5-C. Enrich lint / format / typecheck

**Lint**: In the analyses assembly (L1437), change:
```typescript
// Before
...(selectedDetectors.has('lint') && lint !== null ? { lint: lint } : {}),
// After
...(selectedDetectors.has('lint') && lint !== null ? { lint: enrichLint(lint) } : {}),
```

Where `enrichLint` adds `catalogCode: 'LINT' as FirebatCatalogCode` to each diagnostic.

**Typecheck**: Same pattern, `catalogCode: 'TYPECHECK' as FirebatCatalogCode`.

**Format**: Convert `format: ReadonlyArray<string>` (file paths) to `ReadonlyArray<FormatFinding>`:
```typescript
const enrichFormat = (files: ReadonlyArray<string>): ReadonlyArray<any> => {
  const zeroSpan = { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } };
  return files.map(f => ({
    code: 'FORMAT' as FirebatCatalogCode,
    kind: 'needs-formatting',
    file: toProjectRelative(f),
    span: zeroSpan,
  }));
};
```

### 5-D. Normalize dependencies enrichment

Replace `enrichDependencies` (L1243-1290). New version:

```typescript
const enrichDependencies = (value: any): ReadonlyArray<any> => {
  const zeroSpan = { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } };
  const findings: any[] = [];

  // Cycles → DependencyCycleFinding (GroupFinding)
  const cycles = Array.isArray(value?.cycles) ? value.cycles : [];
  const cuts = Array.isArray(value?.edgeCutHints)
    ? value.edgeCutHints
    : Array.isArray(value?.cuts) ? value.cuts : [];

  for (const cycle of cycles) {
    const pathModules = Array.isArray(cycle?.path) ? cycle.path : [];
    const bestCut = cuts.find((c: any) =>
      pathModules.includes(c?.from) && pathModules.includes(c?.to)
    );
    findings.push({
      code: 'DIAG_CIRCULAR_DEPENDENCY',
      kind: 'circular-dependency',
      items: pathModules.map((mod: string) => ({
        file: toProjectRelative(mod),
        span: zeroSpan,
      })),
      ...(bestCut ? { cut: { from: bestCut.from, to: bestCut.to, score: bestCut.score } } : {}),
    });
  }

  // Layer violations → DependencyLayerViolationFinding (ItemFinding)
  const layerViolations = Array.isArray(value?.layerViolations) ? value.layerViolations : [];
  for (const v of layerViolations) {
    findings.push({
      code: 'DEP_LAYER_VIOLATION',
      kind: 'layer-violation',
      file: toProjectRelative(String(v?.from ?? '')),
      span: zeroSpan,
      from: String(v?.from ?? ''),
      to: String(v?.to ?? ''),
      fromLayer: String(v?.fromLayer ?? ''),
      toLayer: String(v?.toLayer ?? ''),
    });
  }

  // Dead exports → DependencyDeadExportFinding (ItemFinding)
  const deadExports = Array.isArray(value?.deadExports) ? value.deadExports : [];
  for (const d of deadExports) {
    const kind = String(d?.kind ?? 'dead-export');
    findings.push({
      code: kind === 'test-only-export' ? 'DEP_TEST_ONLY_EXPORT' : 'DEP_DEAD_EXPORT',
      kind,
      file: toProjectRelative(String(d?.module ?? '')),
      span: zeroSpan,
      module: String(d?.module ?? ''),
      name: String(d?.exportName ?? d?.name ?? ''),
    });
  }

  return findings;
};
```

### 5-E. Replace `computeTopAndCatalog` with `computeCatalog`

Remove `top` computation entirely. New function:

```typescript
const computeCatalog = (input: {
  readonly analyses: FirebatReport['analyses'];
  readonly diagnostics: ReturnType<typeof aggregateDiagnostics>;
}): FirebatReport['catalog'] => {
  const seenCodes = new Set<FirebatCatalogCode>();

  // Collect codes from all analysis arrays
  for (const [, value] of Object.entries(input.analyses)) {
    if (!Array.isArray(value)) continue;

    for (const item of value as ReadonlyArray<any>) {
      const code = item?.code ?? item?.catalogCode;
      if (typeof code === 'string' && code in FIREBAT_CODE_CATALOG) {
        seenCodes.add(code as FirebatCatalogCode);
      }

      // Handle nested items (GroupFinding: duplicates, api-drift outliers)
      const items = item?.items ?? item?.outliers;
      if (Array.isArray(items)) {
        for (const sub of items) {
          const subCode = sub?.code ?? sub?.catalogCode;
          if (typeof subCode === 'string' && subCode in FIREBAT_CODE_CATALOG) {
            seenCodes.add(subCode as FirebatCatalogCode);
          }
        }
      }
    }
  }

  // Merge diagnostic catalog entries
  const catalog: Partial<Record<FirebatCatalogCode, CatalogEntry>> = { ...input.diagnostics.catalog };

  for (const code of seenCodes) {
    if (!(code in catalog)) {
      catalog[code] = FIREBAT_CODE_CATALOG[code];
    }
  }

  return catalog;
};
```

### 5-F. Update analyses assembly

In the analyses object construction (~L1424-1458), wrap Phase 1 results with enrich functions:

```typescript
...(selectedDetectors.has('giant-file') ? { 'giant-file': enrichGiantFile(giantFile) } : {}),
...(selectedDetectors.has('decision-surface') ? { 'decision-surface': enrichDecisionSurface(decisionSurface) } : {}),
// … etc for all 12
```

Also wrap lint/format/typecheck:
```typescript
...(selectedDetectors.has('format') && format !== null ? { format: enrichFormat(format) } : {}),
...(selectedDetectors.has('lint') && lint !== null ? { lint: enrichLint(lint) } : {}),
...(selectedDetectors.has('typecheck') && typecheck !== null ? { typecheck: enrichTypecheck(typecheck) } : {}),
```

### 5-G. Update report construction

**Before:**
```typescript
const topAndCatalog = computeTopAndCatalog({ analyses, diagnostics });
const report: FirebatReport = {
  meta: { … },
  analyses,
  top: topAndCatalog.top,
  catalog: topAndCatalog.catalog,
};
```

**After:**
```typescript
const catalog = computeCatalog({ analyses, diagnostics });
const report: FirebatReport = {
  meta: { … },
  analyses,
  catalog,
};
```

---

## 6. Output Projection

### 6-A. `src/report.ts`

Change `formatReport` (L832-840):

**Before:**
```typescript
const formatReport = (report: FirebatReport, format: OutputFormat): string => {
  if (format === 'json') {
    return JSON.stringify(report);
  }
  return formatText(report);
};
```

**After:**
```typescript
import { toJsonReport } from './types';

const formatReport = (report: FirebatReport, format: OutputFormat): string => {
  if (format === 'json') {
    return JSON.stringify(toJsonReport(report));
  }
  return formatText(report);
};
```

**Also in `formatText`**: Remove any references to `report.top`. Currently `report.top` is NOT used in `formatText` (verified by grep — only `fanInTop`/`fanOutTop` appear, which are legacy aliases inside `deps`).

#### formatText dependencies rendering (~80 lines changed)

After normalization, `analyses.dependencies` is an array. The entire deps rendering pipeline must be rewritten:

**1. Initialization (L184-202) — replace object fallback + legacy aliases with array:**
```typescript
// Before (~20 lines: object fallback + depsLegacy cast + depsFanIn/Out/Cuts)
const deps = analyses.dependencies ?? { cycles: [], adjacency: {}, … };
const depsLegacy = deps as typeof deps & { … };
const depsFanIn = depsLegacy.fanInTop ?? deps.fanIn;
const depsFanOut = depsLegacy.fanOutTop ?? deps.fanOut;
const depsCuts = depsLegacy.edgeCutHints ?? deps.cuts;

// After (simple array initialization)
const depsFindings = Array.isArray(analyses.dependencies) ? analyses.dependencies : [];
const depsCycles = depsFindings.filter((d: any) => d.kind === 'circular-dependency');
const depsLayerViolations = depsFindings.filter((d: any) => d.kind === 'layer-violation');
const depsDeadExports = depsFindings.filter((d: any) => d.kind === 'dead-export' || d.kind === 'test-only-export');
```

Delete `depsFanIn`, `depsFanOut`, `depsCuts` variables entirely.

**2. Summary bar (L391-401) — replace object property access:**
```typescript
// Before
case 'dependencies':
  return {
    count: deps.cycles.length + deps.layerViolations.length + deps.deadExports.length,
    filesCount: deps.cycles.length === 0 ? 0 : new Set([
      ...deps.cycles.flatMap(c => c.path),
      ...depsFanIn.map(s => extractModule(s)).filter(Boolean),
      …
    ]).size,
  };

// After
case 'dependencies':
  return {
    count: depsFindings.length,
    filesCount: depsFindings.length === 0 ? 0 : new Set(
      depsFindings.flatMap((d: any) => 'items' in d ? d.items.map((i: any) => i.file) : [d.file])
    ).size,
  };
```

**3. Body rendering (L601-648) — replace all object access with array iteration:**
```typescript
// Before (~50 lines)
if (deps.deadExports.length > 0) { for (const finding of deps.deadExports) { … } }
if (deps.layerViolations.length > 0) { for (const finding of deps.layerViolations) { … } }
if (deps.cycles.length > 0) { for (const cycle of deps.cycles) { cycle.path.join(' → ') } }
if (depsCuts.length > 0) { … }

// After
if (depsDeadExports.length > 0) { for (const finding of depsDeadExports) { … finding.module, finding.name … } }
if (depsLayerViolations.length > 0) { for (const finding of depsLayerViolations) { … finding.from → finding.to … } }
if (depsCycles.length > 0) { for (const cycle of depsCycles) { cycle.items.map((i: any) => i.file).join(' → ') } }
// depsCuts section deleted entirely (no longer in output)
```

The section header also changes: `depsCuts.length` reference removed.

#### formatText format section (L320)

```typescript
// Before — format is string[], Set deduplicates strings
filesCount: formatFindings === 0 ? 0 : new Set(format).size,
// After — format is FormatFinding[] (during transition may be either type)
filesCount: formatFindings === 0 ? 0 : new Set(
  format.map((f: any) => typeof f === 'string' ? f : f.file)
).size,
```

### 6-B. `src/adapters/mcp/server.ts`

**Remove** (L242-330):
- `DiffCounts` type
- `diffReports` function
- `lastReport` variable

**Remove** from output assembly (L485-493):
- `diff` computation
- `timings` computation
- `structured` wrapping

**Replace** scan handler return (L485-494):

**Before:**
```typescript
const diff = diffReports(lastReport, report);
lastReport = report;
const totalMs = nowMs() - t0;
const structured: StructuredRecord = {
  report,
  timings: { totalMs },
  ...(diff.newFindings >= 0 ? { diff } : {}),
};
return {
  content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
  structuredContent: toStructured(structured),
};
```

**After:**
```typescript
const jsonReport = toJsonReport(report);
return {
  content: [{ type: 'text' as const, text: JSON.stringify(jsonReport) }],
  structuredContent: toStructured(jsonReport as unknown as StructuredRecord),
};
```

**Update** `outputSchema` (L440-453):

**Before:**
```typescript
outputSchema: z
  .object({
    report: FirebatReportSchema,
    timings: z.object({ totalMs: z.number() }),
    diff: z.object({ … }).optional(),
  })
  .strict(),
```

**After:**
```typescript
outputSchema: FirebatJsonReportSchema,
```

Where `FirebatJsonReportSchema` is:
```typescript
const FirebatJsonReportSchema = z
  .object({
    detectors: z.array(FirebatDetectorSchema),
    errors: z.record(z.string(), z.string()).optional(),
    analyses: z.record(z.string(), z.unknown()),
    catalog: z.record(z.string(), z.object({ cause: z.string(), think: z.array(z.string()) })),
  })
  .strict();
```

**Remove** `FirebatMetaSchema`, `FirebatTopItemSchema`, `FirebatCatalogEntrySchema` (no longer needed in output).

**Update** tool description to remove references to `timings`, `diff`, `meta`, `top`.

---

## 7. Test Plan

### 7-A. `src/application/scan/diagnostic-aggregator.spec.ts` (NEW FILE)

```
describe('FIREBAT_CODE_CATALOG')
  it('should have exactly 80 entries')
  it('should have an entry for every FirebatCatalogCode member')
  it('should have no extra keys beyond FirebatCatalogCode members')
  it('should have non-empty cause for every entry')
  it('should have non-empty think array for every entry')
  it('should have at least 2 think steps for every entry')
  it('should not contain fix instructions in think steps')

describe('aggregateDiagnostics')
  describe('DIAG_GOD_FUNCTION')
    it('should detect god function when high-CC nesting and waste co-occur in same file')
    it('should set resolves to waste count in overlapping files')
    it('should not detect when nesting has no high-cognitive-complexity kind')
    it('should not detect when waste is empty')
    it('should not detect when high-CC and waste are in different files')
    it('should handle empty analyses')

  describe('DIAG_CIRCULAR_DEPENDENCY')
    it('should detect when cycles array is non-empty')
    it('should set resolves to cycle count')
    it('should not detect when cycles is empty')
    it('should not detect when dependencies key is absent')

  describe('DIAG_GOD_MODULE')
    it('should detect when coupling has god-module kind')
    it('should set resolves to god-module count')
    it('should not detect when coupling has no god-module kind')
    it('should not detect when coupling is empty')

  describe('catalog population')
    it('should include catalog entries only for detected diagnostics')
    it('should not include catalog entries when no diagnostics detected')
    it('should return valid CatalogEntry objects with cause and think')
```

### 7-B. `src/types.spec.ts` (NEW FILE — toJsonReport unit tests)

```
describe('toJsonReport')
  it('should extract detectors from meta.detectors')
  it('should extract errors from meta.errors when present')
  it('should omit errors when meta.errors is undefined')
  it('should omit errors when meta.errors is empty object')
  it('should pass through analyses unchanged')
  it('should pass through catalog unchanged')
  it('should not include meta in output')
  it('should not include top in output')  // (if internal report still has it during transition)
```

### 7-C. Updates to `src/report.spec.ts` (~80-100 lines changed)

Update JSON format tests AND dependency fixture shapes:

```
describe('formatReport')
  describe('json format')
    it('should output FirebatJsonReport structure with detectors at root')
    it('should not include meta in json output')
    it('should not include top in json output')
    it('should include errors at root when present')
    it('should omit errors from root when absent')
    it('should include catalog with CatalogEntry shape (cause + think)')
```

Additional required changes:
- All `emptyDeps: DependencyAnalysis` fixtures (~9 places) must change to `emptyDeps: ReadonlyArray<any> = []`
- `makeReport` helper must remove `top: []` field
- Text output tests that assert dependency section must use array-based rendering
- Keep `DependencyAnalysis` import for any test that directly tests analyzer output

### 7-D. Updates to `test/integration/scan/report-contract.test.ts` (~60 lines changed)

Change existing test assertions:
- **L125**: Remove `expect(Array.isArray(report.top)).toBe(true)`
- **L333-380**: Rewrite deps shape test entirely — `deps` is now an array, not an object. Remove `deps.fanIn`, `deps.fanOut`, `deps.cuts` assertions. Assert each item has `code`, `kind`, `file` or `items`.
- **L488-489**: Remove `report.top` assertions (2 lines)
- **L667-668**: Remove `report.top` assertions (2 lines)
- **L909-913**: Remove `report.top` block (5 lines: `some(p => p.detector)`, `patterns = new Set(report.top.map(...))`)
- **L920**: Change `.approach` to `.think`, assert `Array.isArray(…think)`

Add new tests:
```
it('should return dependencies as an array of DependencyFinding')
  // Assert: Array.isArray(report.analyses.dependencies)
  // Assert: each item has code, kind, file or items

it('should have catalog entries with cause and think fields')
  // Assert: Object.values(report.catalog).every(e => typeof e.cause === 'string' && Array.isArray(e.think))
```

---

## 8. File-by-File Change Ledger

| # | File | Action | Lines affected (approx) |
|---|------|--------|------------------------|
| 1 | `src/types.ts` | Modify | +140 (new types incl. NoopKind, CouplingKind, FormatFinding, DependencyFinding union), ~30 lines changed (finding types + code field), Priority deprecated not deleted |
| 2 | `src/features/exception-hygiene/types.ts` | Modify | Change `code?: string` to `code?: FirebatCatalogCode` (+1 import) |
| 3 | `src/application/scan/diagnostic-aggregator.ts` | Rewrite | ~450 lines → ~500 lines (think arrays are longer than approach strings) |
| 4 | `src/application/scan/diagnostic-aggregator.spec.ts` | Create | ~200 lines |
| 5 | `src/types.spec.ts` | Create | ~80 lines |
| 6 | `src/application/scan/scan.usecase.ts` | Modify | ~200 lines changed (enrich functions + catalog computation + Phase 1 enrich + tool-unavailable filters) |
| 7 | `src/report.ts` | Modify | ~80 lines changed (JSON projection + deps init/summary/body rewrite + format Set fix) |
| 8 | `src/report.spec.ts` | Modify | ~80-100 lines changed (deps fixtures ×9 + JSON tests + makeReport + text output) |
| 9 | `src/adapters/mcp/server.ts` | Modify | ~120 lines deleted (diff logic), ~30 lines changed (output schema + handler return) |
| 10 | `test/integration/scan/report-contract.test.ts` | Modify | ~60 lines changed (top removal ×5, deps shape rewrite ~50, approach→think) |

---

## 9. Implementation Order

Follows Test-First Flow from `workflow.md`.

```
Step 1: src/types.ts
  → Add new types (FirebatCatalogCode, CatalogEntry, ItemFinding, GroupFinding,
    NoopKind, CouplingKind, FormatFinding,
    DependencyFinding union [DepLayerViolationFinding, DepDeadExportFinding, DepCycleFinding],
    FirebatJsonReport, toJsonReport)
  → Modify existing finding types (add code?: FirebatCatalogCode)
  → Transition FirebatReport: top → optional (keep @deprecated Priority)
  → Transition FirebatAnalyses: dependencies → union (DependencyAnalysis | ReadonlyArray<DependencyFinding>)
  → Transition FirebatAnalyses: format → union (ReadonlyArray<string> | ReadonlyArray<FormatFinding>)
  → Replace CodeEntry with CatalogEntry (keep CodeEntry as deprecated alias)
  → Narrow NoopFinding.kind from string to NoopKind
  → No tests needed (pure type changes). Compile check only.

Step 2: src/types.spec.ts (NEW)
  → Write all toJsonReport tests
  → Run → RED (toJsonReport not yet working with new types)

Step 3: src/types.ts (toJsonReport implementation)
  → Already written in Step 1. Run → GREEN

Step 4: src/application/scan/diagnostic-aggregator.spec.ts (NEW)
  → Write all FIREBAT_CODE_CATALOG + aggregateDiagnostics tests
  → Run → RED (catalog has old shape, missing entries)

Step 5: src/application/scan/diagnostic-aggregator.ts
  → Rewrite FIREBAT_CODE_CATALOG with satisfies
  → Rewrite aggregateDiagnostics (remove top)
  → Run → GREEN

Step 6: src/features/exception-hygiene/types.ts
  → Modify code field type
  → Compile check

Step 7: src/application/scan/scan.usecase.ts
  → Modify all enrich functions (kindToCode type hardening with Exclude<> for tool-unavailable)
  → Add tool-unavailable filter to enrichExceptionHygiene AND enrichUnknownProof
  → Add 12 Phase 1 enrich functions
  → Add enrichLint, enrichTypecheck, enrichFormat
  → Rewrite enrichDependencies (normalize DependencyAnalysis object → ReadonlyArray<DependencyFinding>)
  → Replace computeTopAndCatalog with computeCatalog
  → Update analyses assembly + report construction (remove top)
  → Run existing integration tests → should pass (internal FirebatReport shape is compatible)

Step 7.5: src/types.ts (final cleanup)
  → Remove union types: dependencies → ReadonlyArray<DependencyFinding> only
  → Remove union types: format → ReadonlyArray<FormatFinding> only
  → Remove top? field from FirebatReport
  → Delete Priority interface
  → Compile check

Step 8: src/report.spec.ts
  → Update deps fixtures (DependencyAnalysis object → ReadonlyArray<DependencyFinding> [])  (~9 places)
  → Update makeReport helper (remove top field)
  → Update JSON format tests (FirebatJsonReport shape)
  → Update text output tests for deps rendering
  → Run → RED

Step 9: src/report.ts
  → Change formatReport to use toJsonReport for JSON
  → Rewrite formatText deps initialization (~20 lines: array-based)
  → Rewrite formatText deps summary bar (~15 lines)
  → Rewrite formatText deps body rendering (~50 lines, remove depsCuts)
  → Fix format summary: new Set(format.map(…))
  → Run → GREEN

Step 10: src/adapters/mcp/server.ts
  → Remove diff/timings logic
  → Update output schema + handler return
  → Compile check

Step 11: test/integration/scan/report-contract.test.ts
  → Remove report.top assertions (5 locations)
  → Rewrite deps shape test (L333-380: object → array)
  → Change .approach → .think assertion
  → Add new DependencyFinding shape + CatalogEntry shape tests
  → Run full integration suite

Step 12: bun test (full suite)
  → All 800+ tests pass

Step 13: Cache invalidation
  → Run `bun run firebat cache clean` or `rm -rf .firebat/*.sqlite`
  → Document in commit message: "BREAKING: run `cache clean` after update"
```

---

## 10. Verification Checklist

After all implementation is complete, verify each item:

- [ ] `FirebatCatalogCode` has exactly 80 members
- [ ] `FIREBAT_CODE_CATALOG` compiles with `satisfies Record<FirebatCatalogCode, CatalogEntry>`
- [ ] Every `CatalogEntry` has `cause: string` and `think: string[]` (no `approach`)
- [ ] No `as any` remains in `scan.usecase.ts` for catalog lookup
- [ ] Every finding type has `code?: FirebatCatalogCode` (optional, not required)
- [ ] `LintDiagnostic` and `TypecheckItem` have `catalogCode?: FirebatCatalogCode` (separate from their `code` field)
- [ ] `NoopKind` and `CouplingKind` union types are defined in `types.ts`
- [ ] `DependencyAnalysis` interface is preserved (used by analyzer + coupling)
- [ ] Enriched dependency types use distinct names (`DepLayerViolationFinding`, etc.)
- [ ] `FirebatReport.top` is fully removed (no optional, no field)
- [ ] `Priority` interface is deleted
- [ ] `FirebatJsonReport` has no `meta` field, no `top` field
- [ ] CLI `--format json` output matches `FirebatJsonReport` structure
- [ ] MCP scan output matches `FirebatJsonReport` structure (no wrapping)
- [ ] MCP server has no `diffReports`, `lastReport`, `timings` code
- [ ] `dependencies` analysis is `ReadonlyArray<DependencyFinding>`
- [ ] `format` analysis is `ReadonlyArray<FormatFinding>`
- [ ] `enrichExceptionHygiene` filters out `tool-unavailable` findings
- [ ] `enrichUnknownProof` filters out `tool-unavailable` findings
- [ ] `kindToCode` for exception-hygiene uses `Exclude<ExceptionHygieneFindingKind, 'tool-unavailable'>`
- [ ] `kindToCode` for unknown-proof uses `Exclude<UnknownProofFindingKind, 'tool-unavailable'>`
- [ ] `report.ts` deps initialization uses array-based filtering (no object fallback)
- [ ] `report.ts` format summary uses `new Set(format.map(…))` not `new Set(format)`
- [ ] `report.spec.ts` deps fixtures are arrays (not `DependencyAnalysis` objects)
- [ ] `report-contract.test.ts` has no `report.top` references
- [ ] `report-contract.test.ts` checks `.think` not `.approach` on catalog entries
- [ ] Cache cleaned after schema change (`cache clean`)
- [ ] `bun test` passes all tests (0 failures)
- [ ] `bun run build` succeeds

---

*End of PLAN.*
