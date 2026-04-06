# error-flow

Detects error handling anti-patterns. Covers throw non-Error, useless catch, unsafe finally, unobserved promises (floating, variable, misused), missing error cause, promise constructor hygiene, and return-await-in-try.

**Finding fields:** `kind, code, file, span, evidence`

<catalog>

## EF_THROW_NON_ERROR

**Cause:** A throw statement throws a value that is not an Error instance, losing stack trace and error chain capabilities.

<think>

1. Read the throw statement and identify the thrown value type (string literal, object, number, etc.). If it is already an Error subclass, this is a false positive — **stop, no action needed**.
2. Wrap the thrown value in a new Error (or a domain-specific Error subclass) using `new Error(message, { cause: originalValue })` to preserve both the stack trace and the original information.
3. Grep for catch blocks that handle this throw. If they access `.stack` or `.message`, confirm the new Error subclass provides those properties correctly.

</think>

## EF_PROMISE_CONSTRUCTOR_HYGIENE

**Cause:** The Promise constructor has a hygiene issue: async executor, throw in sync executor, return value in executor, swapped params, or unnecessary new Promise in async function.

<think>

1. Read the Promise constructor call. If the enclosing function is already async, replace `return new Promise(...)` with direct async/await logic and remove the constructor entirely.
2. If the Promise wraps a callback-based API (e.g., `fs.readFile` with callback), the constructor is justified — fix only the specific hygiene issue (async executor → sync executor, swapped params → correct order) — **stop, no action needed** for the constructor itself.
3. If none of the above, convert to an async function with try/catch to eliminate the Promise constructor.

</think>

## EF_MISSING_ERROR_CAUSE

**Cause:** A caught error is re-thrown or wrapped without preserving the original error via the 'cause' option, breaking the error chain.

<think>

1. Read the catch block. Locate where the new error is created or re-thrown.
2. Add `{ cause: caughtError }` as the second argument to the Error constructor (e.g., `new Error("message", { cause: err })`). If the error is re-thrown with `throw err`, no change is needed — **stop, no action needed**.

</think>

## EF_USELESS_CATCH

**Cause:** A catch block catches an error and immediately re-throws it without transformation, making the try-catch pointless.

<think>

1. Read the entire try-catch-finally structure. If a `finally` block exists that performs cleanup, the try block must remain — remove only the catch clause, not the try-finally.
2. If there is no finally block, remove the entire try-catch wrapper and leave only the body of the try block.
3. Check git log for the catch block. If the commit message indicates future handling was planned, leave a TODO comment instead of removing.

</think>

## EF_UNSAFE_FINALLY

**Cause:** A finally block contains a throw or return statement that can override the try/catch result, silently discarding errors.

<think>

1. Read the finally block and identify the throw or return statement. If it is a return that provides a meaningful fallback value (documented intent), this may be deliberate — **stop, no action needed**.
2. Remove the return/throw from the finally block. Move it into the try block (for success returns) or catch block (for error re-throws). The finally block should contain only cleanup code (close connections, release resources).

</think>

## EF_PREFER_DOT_CATCH_CATCH

**Cause:** Error handling uses .then(onFulfilled, onRejected) instead of .catch(), which is less readable and can miss errors thrown in onFulfilled.

<think>

1. Read the `.then(onFulfilled, onRejected)` call. Note that errors thrown inside `onFulfilled` are NOT caught by `onRejected` in the two-argument form — this is a real bug if `onFulfilled` can throw.
2. Replace `.then(onFulfilled, onRejected)` with `.then(onFulfilled).catch(onRejected)` so that both the original rejection and errors from `onFulfilled` are handled.

</think>

## EF_PREFER_DOT_CATCH_AWAIT

**Cause:** Promise chains use .then()/.catch() inside an async function instead of await, reducing readability and error flow clarity.

<think>

1. Read the enclosing function. If the .then() chain runs multiple promises in parallel (e.g., `Promise.all([...]).then()`), await would change concurrency semantics — **stop, no action needed**.
2. Replace the .then() chain with `const result = await promise` and move error handling into a try-catch block wrapping the await.
3. If there is a .catch() handler, convert it to the catch clause of the try-catch. Ensure the same error handling logic is preserved.

</think>

## EF_PREFER_DOT_CATCH_NO_WRAP

**Cause:** A .then() callback returns Promise.resolve() or Promise.reject() unnecessarily — the value can be returned directly.

<think>

1. Read the .then() callback body. Replace `return Promise.resolve(value)` with `return value` and `return Promise.reject(error)` with `throw error`.
2. Run the type checker to confirm the return type is compatible after removing the wrapper.

</think>

## EF_UNOBSERVED_PROMISE_FLOATING

**Cause:** A Promise is created but not awaited, returned, or stored, so its rejection will be silently lost.

<think>

1. Read the function call that creates the floating Promise. If the result genuinely does not matter and errors are handled inside the called function, add `void` prefix for clarity (e.g., `void doSomething()`) — **stop, no action needed**.
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

## EF_UNOBSERVED_PROMISE_ALWAYS_RETURN

**Cause:** A .then() callback does not return a value, breaking the Promise chain and losing the resolved value.

<think>

1. Read the .then() callback. If it performs a side effect (logging, mutation) and no downstream .then() depends on the return value, this is acceptable — **stop, no action needed**.
2. If downstream .then() calls or the final consumer expects a transformed value, add an explicit `return` statement to the callback.

</think>

## EF_UNOBSERVED_PROMISE_CALLBACK_IN_PROMISE

**Cause:** A callback-style API is used inside a Promise chain, mixing two async patterns and risking unhandled errors.

<think>

1. Read the callback-style API call. Check if a Promise-based alternative exists (e.g., `fs/promises` instead of `fs`, `util.promisify()` for Node.js callbacks). If so, replace the callback API with the Promise version.
2. If no Promise alternative exists, wrap the callback in `new Promise((resolve, reject) => { api(args, (err, result) => err ? reject(err) : resolve(result)) })` and await it.

</think>

## EF_RETURN_AWAIT_IN_TRY

**Cause:** A return statement inside a try block does not await a promise-returning expression, so the catch clause cannot intercept rejections.

<think>

1. Read the return statement in the try block. Verify the returned expression produces a Promise (async function call, fetch, etc.). If it returns a plain value, this is a false positive — **stop, no action needed**.
2. Add `await` before the returned expression (change `return fetchData()` to `return await fetchData()`) so that rejections are caught by the surrounding catch block.

</think>

</catalog>
