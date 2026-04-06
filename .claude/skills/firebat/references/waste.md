# waste

Detects dead stores — variables assigned a value that is never read before going out of scope or being overwritten.

**Finding fields:** `kind, code, file, span, label, variable`

<catalog>

## WASTE_DEAD_STORE

**Cause:** A value is assigned to a variable but is overwritten or goes out of scope before being read.

<think>

1. Read the function containing the dead store. Trace every read of this variable through all branches. If any branch does read the value before it goes out of scope, this is a false positive — **stop, no action needed**.
2. Check git log for the commit that introduced or last modified this assignment. If it was part of a larger refactor that removed the consuming code, the assignment is a leftover — delete it.
3. Grep the function for other dead-store findings. If multiple exist in the same function, the function likely handles too many concerns — flag for extraction rather than fixing individual stores.

</think>

## WASTE_DEAD_STORE_OVERWRITE

**Cause:** A variable is assigned, then unconditionally reassigned before the first value is ever read.

<think>

1. Read both assignments and all code between them. If any conditional branch between the two assignments reads the first value, this is a false positive — **stop, no action needed**.
2. Delete the first assignment. If the variable declaration and first assignment are the same statement (`let x = value`), change it to `let x` or move the declaration to the second assignment site.
3. If the same pattern repeats for multiple variables in this function, the function is accumulating unrelated setup steps — consider splitting it.

</think>

</catalog>
