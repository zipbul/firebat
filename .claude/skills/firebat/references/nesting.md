# nesting

Measures complexity. Detects deep nesting, high cognitive complexity, accidental quadratic patterns, callback depth, promise chain depth, and complexity density (CC/LOC ratio).

**Finding fields:** `kind, code, file, span, functionHeader, metrics`

<catalog>

## NESTING_DEEP

**Cause:** A function has deeply nested control structures, increasing indentation and making the execution path hard to follow.

<think>

1. Read the function and identify the deepest nesting path. Check if the outermost levels are precondition checks (null checks, error checks) that can be converted to early returns/guard clauses to reduce nesting by 1-2 levels.
2. Check if other firebat findings (WASTE_DEAD_STORE, COUPLING_GOD_MODULE) co-occur in this function. If so, the nesting is a symptom of the function doing too much — split by responsibility rather than flattening nesting mechanically.
3. For remaining deep nesting, extract the inner block into a named helper function. The extracted function name should describe what the block does, making the parent function read as a sequence of high-level steps.

</think>

## NESTING_HIGH_CC

**Cause:** A function has high cognitive complexity, meaning it contains many interacting control-flow decisions.

<think>

1. Read the function and group its if/switch/loop branches by what they decide (validation, routing, transformation, error handling). If groups are independent of each other, each group is a candidate for extraction into its own function.
2. If the complexity comes from validation logic (multiple field checks), replace the chain with a declarative validation schema or a data-driven lookup table.
3. Extract each identified group into a named function. After extraction, the original function should read as a linear orchestration of named steps with CC under the threshold.

</think>

## NESTING_ACCIDENTAL_QUADRATIC

**Cause:** A nested loop or iteration pattern creates O(n²) complexity that may not be intentional.

<think>

1. Read the nested iteration. Identify the inner operation: if it is `array.includes()`, `array.find()`, or `array.filter()` inside a loop, replace it with a Set or Map lookup (O(1) per check instead of O(n)).
2. If the quadratic behavior is inherent to the problem (e.g., pairwise comparison), check the expected input size. If the input is bounded and small (< 100 items), the quadratic cost is acceptable — **stop, no action needed**.
3. For large or unbounded inputs, restructure: pre-build a Map/Set from the inner collection before the outer loop, then perform lookups inside the loop.

</think>

## NESTING_CALLBACK_DEPTH

**Cause:** A function contains deeply nested callback chains (depth ≥ 3), making control flow hard to follow and error handling fragile.

<think>

1. Read the callback chain. If the enclosing function can be made async, convert each nested callback into a sequential `await` call, flattening the chain entirely.
2. If the callbacks are event listeners (not sequential async steps), extract each level into a named function with a descriptive name. Wire them together at the top level so the event flow reads linearly.

</think>

## NESTING_PROMISE_CHAIN

**Cause:** A function contains a deeply chained or nested Promise chain (.then/.catch/.finally), creating hard-to-follow asynchronous control flow that cognitive complexity metrics miss.

<think>

1. Read the Promise chain. If the enclosing function is async (or can be made async), convert the `.then()` chain to sequential `await` calls with try-catch for error handling.
2. If individual `.then()` callbacks contain substantial logic (more than 2-3 lines), extract each into a named function. The chain should read as: `.then(validate).then(transform).then(persist)`.
3. Verify that `.catch()` handlers cover all rejection paths. After converting to await, ensure every awaited call is inside a try-catch or the function propagates rejections to its caller.

</think>

## NESTING_COMPLEXITY_DENSITY

**Cause:** A function has high cognitive complexity relative to its size (CC/LOC), indicating dense decision logic packed into a small number of lines.

<think>

1. Read the function. If it is a compact decision table (short switch/if-else chain mapping inputs to outputs), the density may be inherent and acceptable — **stop, no action needed**.
2. If the function mixes multiple concerns in few lines (validation + transformation + error handling), split each concern into a separate function. The density drops because LOC increases proportionally to CC.

</think>

</catalog>
