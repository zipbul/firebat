# variable-lifetime

Analyzes variable lifecycles. Detects long-lived variables (declared far from use), scope narrowing opportunities (variable used only inside a narrower block), liveness pressure (too many simultaneously live variables), and mutation density (excessive reassignment).

**Finding fields:** `kind, code, file, span, variable, lifetimeLines, contextBurden`

<catalog>

## VAR_LIFETIME

**Cause:** A variable has a longer lifetime than necessary — it is declared far from its use or lives across multiple unrelated operations.

<think>

1. Read the function and find the first read and last write of the variable. Count the lines between the declaration and the first use.
2. Move the declaration to just before the first use. If the variable is initialized with a value, ensure the initialization expression does not depend on code that runs between the old and new declaration site.
3. If the variable spans unrelated operations (used in block A, then again in block C with unrelated block B in between), split it into two separate variables — one for each usage context.

</think>

## LIFETIME_SCOPE_NARROWING

**Cause:** A variable is declared in a wider scope than necessary — all its uses are inside a single narrower block.

<think>

1. Read the variable declaration and all its usages. Confirm that every read and write is inside the same block (if, for, while, or nested function). Move the declaration inside that block.
2. If the variable is a `let` with reassignments, verify that all assignments are also inside the target block. If any assignment is outside, the variable cannot be narrowed — **stop, no action needed**.

</think>

## LIFETIME_LIVENESS_PRESSURE

**Cause:** A function has too many simultaneously live variables at a single point, indicating excessive state to track mentally.

<think>

1. Read the function and identify the point of maximum liveness (where the most variables are alive simultaneously). Group the live variables by which ones interact — independent groups can be separated.
2. Extract each independent group into a helper function. The helper takes its group's inputs as parameters and returns the outputs, reducing the parent function's live variable count at any given point.
3. If liveness is high because variables are declared too early, move each declaration to just before its first use — this alone may reduce the peak liveness count.

</think>

## LIFETIME_MUTATION_DENSITY

**Cause:** A variable is reassigned too many times outside of loop accumulation, suggesting the variable serves multiple unrelated purposes.

<think>

1. Read the variable's assignments. If it is reassigned for different purposes (e.g., first holds a URL, then holds a response, then holds parsed data), split it into separate `const` variables — one per purpose, with a descriptive name for each.
2. If the reassignments build up a value incrementally (string concatenation, object assembly), replace with a pipeline pattern: `const result = steps.reduce(...)` or a builder.
3. If the variable is a loop accumulator (e.g., `sum += item.value`), the mutations are inherent — **stop, no action needed**.

</think>

</catalog>
