# waste

Detects dead stores — variables assigned a value that is never read before going out of scope or being overwritten.

**Finding fields:** `kind, code, file, span, label, variable`

<catalog>

## WASTE_DEAD_STORE

**Cause:** A value is assigned to a variable but is overwritten or goes out of scope before being read.

<think>

1. Read the function containing the dead store. Trace every read of this variable through all branches. If any branch does read the value before it goes out of scope, this is a false positive — **stop, no action needed**.
2. Delete the assignment. If the declaration and assignment are one statement (`let x = value`), drop the initializer (`let x`) or move the declaration to where the value is actually first used.
3. If multiple dead stores exist in the same function, it likely handles too many concerns — flag for extraction rather than patching each store.

</think>

## WASTE_DEAD_STORE_OVERWRITE

**Cause:** A variable is assigned, then unconditionally reassigned before the first value is ever read.

<think>

1. Read both assignments and all code between them. If any conditional branch between the two assignments reads the first value, this is a false positive — **stop, no action needed**.
2. Delete the first assignment. If the variable declaration and first assignment are the same statement (`let x = value`), change it to `let x` or move the declaration to the second assignment site.
3. If the same pattern repeats for multiple variables in this function, the function is accumulating unrelated setup steps — consider splitting it.

</think>

## WASTE_REDUNDANT_BINDING

**Cause:** A const binding's initializer is read exactly once; the binding is needless indirection and the initializer can be inlined at its single use.

<think>

1. Read the declaration and its single use. If the initializer is evaluated elsewhere or the variable is read more than once, this is a false positive — **stop, no action needed**.
2. Confirm none of the detector's keep-conditions hold (any one ⇒ false positive, **stop**): the source identifier is reassigned, or a receiver/getter the initializer reads is mutated, between declaration and use; the use sits inside a loop or a closure that does not contain the declaration (re-evaluated/deferred); the source is type-narrowed (guard/assertion) between declaration and use; inlining would move a member read into call/tag position and change `this`; or the RHS is an optional chain.
3. Inline the initializer at the use site and delete the declaration — a single-use name earns no keep; the substituted expression carries the same meaning. (Readability of the name is not a keep-reason per CLAUDE.md. The one information-preservation exception — an opaque bare-literal value whose name is its only documentation — never reaches you here, because the detector does not flag bare-literal initializers.)

</think>

</catalog>
