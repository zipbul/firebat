# collapsible-if

Finds mergeable conditionals. Detects nested if statements that can be combined with && and else blocks containing a single if that can be collapsed to else-if.

**Finding fields:** `kind, code, file, span, functionHeader`

<catalog>

## COLLAPSIBLE_IF

**Cause:** Nested if statements with no else branches can be merged into a single if with a combined condition (&&), reducing one level of nesting.

<think>

1. Read both conditions. If merging them into `if (condA && condB)` produces a condition longer than ~80 characters, extract the combined condition into a named boolean variable (e.g., `const isEligible = condA && condB`) for readability.
2. If either condition has side effects (function call that mutates state), confirm that short-circuit evaluation preserves the intended behavior — `condB` will not execute when `condA` is false. If this changes behavior, do not merge — **stop, no action needed**.

</think>

## COLLAPSIBLE_ELSE_IF

**Cause:** An else block contains a single if statement that can be collapsed into else-if, removing unnecessary braces and one level of nesting.

<think>

1. Read the else block. If it contains only a single if statement (no other code), collapse `else { if (...) }` into `else if (...)` and remove the extra braces.
2. If the inner if has its own else, verify that the resulting `else if ... else` chain reads correctly and maintains the intended branching logic.

</think>

</catalog>
