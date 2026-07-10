# error-flow

Detects error handling anti-patterns. Covers throw non-Error (throw & `Promise.reject`), empty catch (block & empty promise rejection handler), unsafe finally, unobserved promises (floating, variable, misused, catch-or-return), missing error cause, promise constructor hygiene, and return-await-in-try.

**Finding fields:** `kind, code, file, span, evidence`

<catalog>

## EF_THROW_NON_ERROR

**Cause:** A throw (or Promise rejection) of a value that is provably not an Error loses message/stack/cause traceability — the original error information cannot be followed at the handler, even when the value reaches one.

<think>

1. Identify the thrown/rejected value. The detector flags only values it can *prove* are non-Error (a string/number/boolean/template literal, an object or array literal, or a primitive-wrapper call like `String(x)`/`Number(x)`); a member or identifier whose type gildash cannot resolve is given the benefit of the doubt and is NOT flagged. If the value is (or may be) an Error subtype, this is a false positive — **stop, no action needed**.
2. Wrap the value in a new Error (or a domain-specific Error subclass) using `new Error(message, { cause: originalValue })` to preserve both the stack trace and the original information.
3. Grep for catch blocks that handle this throw. If they access `.stack` or `.message`, confirm the new Error subclass provides those properties correctly.

</think>

## EF_PROMISE_CONSTRUCTOR_HYGIENE

**Cause:** The Promise constructor has a hygiene issue that swallows or misdirects errors: an async executor (thrown errors never reject), a throw after the promise is already settled (no-op), or swapped resolve/reject parameters.

<think>

1. For an async executor, move the async work out of the executor: await it and call resolve/reject from a surrounding async function, or drop the constructor entirely in favor of async/await.
2. For a throw after settle, move the throw before the resolve/reject call (so it converts to a rejection), or call reject(err) instead of throwing.
3. For swapped parameters, restore the conventional `(resolve, reject)` order so rejections are delivered through the reject callback.

</think>

## EF_MISSING_ERROR_CAUSE

**Cause:** A caught error is re-thrown or wrapped without preserving the original error via the 'cause' option, breaking the error chain.

<think>

1. Read the catch block. Locate where the new error is created or re-thrown. If it logs/transforms then rethrows the ORIGINAL error (`throw err`), the cause is intact — this is a false positive, **stop, no action needed**.
2. Otherwise add `{ cause: caughtError }` as the second argument to the Error constructor (e.g., `new Error("message", { cause: err })`) so the original error stays in the chain.

</think>

## EF_EMPTY_CATCH

**Cause:** A catch block with no statements (or an empty `.catch(…)` / `.then(_, …)` rejection handler) silently swallows the caught error — its observability, propagation and cause are all lost.

<think>

1. Read the catch block and the try body. Decide how the error should be handled: rethrow it (`throw err`), log it, or convert it into a recovery value.
2. If the failure is genuinely expected and ignorable, make the intent observable in code — bind the error and pass it to a no-op handler, or narrow the try to the single statement that may fail. A comment alone does not restore observability.
3. If the catch only exists to suppress a specific expected error, re-throw any other error so unexpected failures still propagate.

</think>

## EF_UNSAFE_FINALLY

**Cause:** A finally block contains a control-flow statement (throw, return, break, or continue) that can override the try/catch result, silently discarding errors.

<think>

1. Read the finally block. The concept's only keep is a finally that does pure cleanup (no throw/return). A `return` or `throw` in finally overrides the try/catch outcome and swallows any in-flight error, so it is W even when intended — do not treat "documented fallback" as an escape; proceed to fix.
2. Remove the return/throw from the finally block. Move it into the try block (for success returns) or catch block (for error re-throws). The finally block should contain only cleanup code (close connections, release resources).

</think>

## EF_UNOBSERVED_PROMISE_FLOATING

**Cause:** A Promise is created but not awaited, returned, or stored, so its rejection will be silently lost.

<think>

1. Read the function call that creates the floating Promise. If the result genuinely does not matter AND the callee handles its own errors, mark the discard explicit with a `void` prefix (e.g., `void doSomething()`) — **stop**. (Bare `void` does NOT restore observability when the callee does not handle its errors — in that case the finding stands; go to the next step.)
2. If the enclosing function is async, add `await` before the Promise-producing call.
3. If the enclosing function is sync, either convert it to async and await, or add `.catch(handleError)` to the floating Promise.

</think>

## EF_UNOBSERVED_PROMISE_CATCH_OR_RETURN

**Cause:** A Promise chain has .then() without a .catch() or the result is not returned/awaited, leaving rejections unhandled.

<think>

1. Read the Promise chain. If the enclosing function is async, replace the `.then()` chain with `await` so rejections propagate automatically.
2. If the enclosing function is sync, add `.catch(err => { /* handle */ })` at the end of the chain, or return the chain so the caller can handle rejections.

</think>

## EF_UNOBSERVED_PROMISE_MISUSED

**Cause:** A Promise is used in a context that expects a synchronous value (e.g., array.forEach callback, conditional expression), leading to always-truthy checks or ignored results.

<think>

1. Read the misuse site. If it is `array.forEach(async item => ...)`, replace with `for (const item of array) { await ... }` to process items sequentially, or use `await Promise.all(array.map(async item => ...))` for parallel execution.
2. If it is a conditional check on a Promise (e.g., `if (promise)`), add `await` before the Promise to get the resolved value before checking.
3. After fixing, verify that error propagation is preserved — each awaited call should be inside a try-catch or the enclosing function should propagate rejections.

</think>

## EF_UNOBSERVED_PROMISE_VARIABLE

**Cause:** A Promise is assigned to a variable but never awaited, .then()ed, or .catch()ed in the same scope.

<think>

1. Grep for the variable name in the current file. If it is passed to another function, returned, or used in `Promise.all()`, the Promise is observed elsewhere — **stop, no action needed**.
2. If the variable is truly unused after assignment, add `await` before the assignment expression, or remove the assignment if the result is not needed.

</think>

## EF_RETURN_AWAIT_IN_TRY

**Cause:** A return statement inside a try block does not await a promise-returning expression, so the catch clause cannot intercept rejections.

<think>

1. Read the return statement in the try block. Verify the returned expression produces a Promise (async function call, fetch, etc.). If it returns a plain value, this is a false positive — **stop, no action needed**.
2. Add `await` before the returned expression (change `return fetchData()` to `return await fetchData()`) so that rejections are caught by the surrounding catch block.

</think>

</catalog>
