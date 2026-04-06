# early-return

Identifies guard clause opportunities. Finds wrapping-if (last statement wraps remaining code), invertible if-else (short branch ends in return), cascade guards (else-if chains with early exits), and implicit else patterns.

**Finding fields:** `kind, code, file, span, functionHeader`

<catalog>

## EARLY_RETURN_WRAPPING_IF

**Cause:** A block's last statement is an if (no else) that wraps remaining code. Inverting the condition and adding an early exit (return/continue) reduces nesting by one level.

<think>

1. Read the wrapping if statement. Invert its condition and add an early `return` (or `continue` if inside a loop) for the negated case. Move the wrapped code block out by one indentation level.
2. After inverting, re-read the guard clause. It should express the exceptional/short-circuit case (e.g., `if (!valid) return`). If the inverted condition reads unnaturally, the original nesting may be clearer — **stop, no action needed**.

</think>

## EARLY_RETURN_INVERTIBLE

**Cause:** An if-else structure has a short branch (≤3 statements) ending in return/throw and a long branch, which can be inverted to reduce nesting.

<think>

1. Read the if-else structure. Move the short branch (the one ending in return/throw) to the top as a guard clause. Remove the else keyword and un-indent the long branch.
2. If the short branch handles the error/edge case, the guard naturally reads as a precondition check. If it handles the happy path, inverting would make the code less intuitive — **stop, no action needed**.

</think>

## EARLY_RETURN_CASCADE_GUARD

**Cause:** An else-if chain has all non-final branches ending in return/throw/continue, which can be flattened to sequential guard clauses.

<think>

1. Read the else-if chain. Since each non-final branch exits early, remove the `else` keywords and convert to sequential if statements, each ending with return/throw/continue. The final branch becomes the un-indented default path.
2. After flattening, verify that the guards test independent preconditions. If a guard depends on a previous guard having failed (shared computation), add a comment or keep the else-if to make the dependency explicit.
3. If the chain exceeds 4 guards, the function may be handling too many cases — consider a lookup table or strategy pattern instead of sequential guards.

</think>

## EARLY_RETURN_IMPLICIT_ELSE

**Cause:** An if block (no else) ends with return/throw/continue, followed by a short tail that acts as an implicit else. Inverting the condition and using the tail as a guard clause reduces nesting.

<think>

1. Read the if block and the tail code after it. If the tail is shorter and handles the exceptional case (error, edge case), invert the condition: move the tail into the if block as a guard clause with early return, then un-indent the original if body.
2. If inside a loop, use `continue` instead of `return` for the guard. Verify that the loop accumulator or iterator state is not affected by the inversion.

</think>

</catalog>
