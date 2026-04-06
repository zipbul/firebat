# diagnostics

Composite diagnostic patterns derived from cross-detector analysis. These are not a detector — they identify root causes (god function, circular dependency, god module, data clump, shotgun surgery, over-indirection, mixed abstraction) that explain why multiple detectors fire on the same code.

**Finding fields:** `code, signals, description`

<catalog>

## DIAG_GOD_FUNCTION

**Cause:** A single function triggers multiple finding types simultaneously (nesting + waste, or responsibility-boundary), indicating it handles multiple independent concerns.

<think>

1. Read the function and list all variables. Group variables by which ones interact with each other (read/write dependencies). Groups that share no variables represent independent concerns.
2. For each independent group, extract the code block into a named helper function. The function name should describe the concern (e.g., `validateInput`, `transformPayload`, `persistResult`).
3. After extraction, verify that the individual findings (NESTING_DEEP, WASTE_DEAD_STORE) disappear — they were symptoms of responsibility overload. If findings remain, address them in the extracted functions.

</think>

## DIAG_CIRCULAR_DEPENDENCY

**Cause:** A group of modules form a dependency cycle, making it impossible to understand or modify any one module in isolation.

<think>

1. Read the import statements of each module in the cycle. Identify the weakest link — the import that contributes least to the module's core purpose (often a type import or a utility function reference).
2. Break the cycle at the weakest link: extract the shared symbol (type, interface, constant) into a new module that both sides can import from, or invert the dependency by passing the needed value as a parameter.
3. If the cycle involves only two modules that are tightly intertwined, merge them into a single module — the cycle indicates they are a single cohesive unit.

</think>

## DIAG_GOD_MODULE

**Cause:** A module acts as a hub with excessive fan-in and fan-out, coupling a large portion of the codebase through one point.

<think>

1. Read the module and list all exports. Grep for each export to identify which consumers use it. Group exports by consumer overlap — exports used by the same set of consumers belong together.
2. Split the module along consumer group boundaries. Each new module should serve a cohesive set of consumers. Update all import paths.
3. After splitting, verify that no new module has both high fan-in and high fan-out. If one does, repeat the analysis on that module.

</think>

## DIAG_DATA_CLUMP

**Cause:** The same group of parameters appears together across multiple function signatures, indicating a missing abstraction.

<think>

1. Read the function signatures that share the parameter group. If the parameters represent a coherent domain concept (e.g., `x, y, z` → `Point`, `host, port, protocol` → `ConnectionConfig`), create an interface or type for the group.
2. Replace the parameter group with a single parameter of the new type in all affected function signatures. Update all call sites.
3. If the parameters are coincidentally grouped (they vary independently across call sites and have no semantic relationship), this is a false positive — **stop, no action needed**.

</think>

## DIAG_SHOTGUN_SURGERY

**Cause:** A single conceptual change requires modifications across many files, indicating the concept is scattered across the codebase.

<think>

1. Check git log for recent commits that touched many files for a single change. If the scattered files all belong to different architectural layers (adapter, application, port), this is inherent to layered architecture — **stop, no action needed**.
2. If the scattered files are at the same architectural level, the concept they share should be colocated. Identify the shared aspect (validation rule, business logic, configuration) and centralize it in one module.
3. After centralizing, grep for remaining references to the old scattered locations and redirect them to the new central module.

</think>

## DIAG_OVER_INDIRECTION

**Cause:** Multiple forwarding layers exist with single-implementation interfaces, adding navigation cost without runtime variation.

<think>

1. Read each interface in the indirection chain. Grep for implementations of each interface. If an interface has exactly one implementation and no test double (mock/stub), the abstraction does not earn its cost.
2. For interfaces with only one implementation: inline the implementation into the consumer, remove the interface, and remove the forwarding layer. Update all references.
3. If the interface exists for testability (used with `mock.module()` or `spyOn`), keep it — **stop, no action needed**.

</think>

## DIAG_MIXED_ABSTRACTION

**Cause:** A single function mixes high-level orchestration with low-level implementation detail, visible as large nesting depth variation within the function.

<think>

1. Read the function and mark each block as either orchestration (calling named functions, deciding what to do next, routing) or implementation (data manipulation, computation, string building, iteration over raw data).
2. Extract each implementation block into a named helper function. The function name should describe the operation at the same abstraction level as the orchestration calls around it.
3. After extraction, the function should read as a linear sequence of high-level steps with no inline implementation details.

</think>

</catalog>
