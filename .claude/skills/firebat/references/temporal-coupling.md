# temporal-coupling

Detects temporal coupling and symmetry breaks. Finds module-scope shared state accessed by multiple exported functions, and function groups with inconsistent signatures (different parameter patterns, return types, or async modifiers).

**Finding fields:** `kind, code, file, span, state, writerCount, readerCount`

<catalog>

## TEMPORAL_COUPLING

**Cause:** Two or more operations must be called in a specific order, but this constraint is not expressed in the type system.

<think>

1. Read the operations that must be ordered. If step B requires output from step A, refactor step B to take step A's result as a parameter — the type system then enforces the ordering (you cannot call B without first calling A to get the input).
2. If both steps are independent but must run in sequence (e.g., init before use), combine them into a single function that encapsulates the ordering.
3. If the constraint cannot be encoded in types or combined, add a runtime assertion at the start of step B that checks whether step A has completed (e.g., check a state flag or non-null value).

</think>

## SYMMETRY_BREAK

**Cause:** Functions in the same group have inconsistent shapes — different parameter patterns, return types, or async modifiers — breaking expected symmetry.

<think>

1. Read all functions in the group and identify the majority pattern (most common parameter order, return type, async modifier). Identify which functions are outliers.
2. For each outlier, check if the difference is intentional (the function genuinely does something different). If so, rename it to clarify the distinct role — **stop, no action needed** for that function.
3. If the difference is accidental drift, align the outlier to the majority pattern. Update all callers of the modified function to match the new signature.

</think>

</catalog>
