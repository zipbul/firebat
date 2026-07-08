import type { FirebatCatalogCode, CatalogEntry } from '../../types';

import { itemFileString } from './finding-item-fields';

interface DiagnosticAggregatorInput {
  readonly analyses: Readonly<Record<string, unknown>>;
}

interface DiagnosticAggregatorOutput {
  readonly catalog: Readonly<Partial<Record<FirebatCatalogCode, CatalogEntry>>>;
}

export const FIREBAT_CODE_CATALOG = {
  WASTE_DEAD_STORE: {
    cause: 'A value is assigned to a variable but is overwritten or goes out of scope before being read.',
    think: [
      'Read the function containing the dead store. Trace every read of this variable through all branches. If any branch does read the value before it goes out of scope, this is a false positive — stop, no action needed.',
      'Delete the assignment. If the declaration and assignment are one statement (`let x = value`), drop the initializer (`let x`) or move the declaration to where the value is actually first used.',
      'If multiple dead stores exist in the same function, it likely handles too many concerns — flag for extraction rather than patching each store.',
    ],
  },
  WASTE_DEAD_STORE_OVERWRITE: {
    cause: 'A variable is assigned, then unconditionally reassigned before the first value is ever read.',
    think: [
      'Read both assignments and all code between them. If any conditional branch between the two assignments reads the first value, this is a false positive — stop, no action needed.',
      'Delete the first assignment. If the variable declaration and first assignment are the same statement (`let x = value`), change it to `let x` or move the declaration to the second assignment site.',
      'If the same pattern repeats for multiple variables in this function, the function is accumulating unrelated setup steps — consider splitting it.',
    ],
  },
  WASTE_REDUNDANT_BINDING: {
    cause:
      "A const binding's initializer is read exactly once; the binding is needless indirection and the initializer can be inlined at its single use.",
    think: [
      'Read the declaration and its single use. If the initializer is evaluated elsewhere or the variable is read more than once, this is a false positive — stop, no action needed.',
      "Confirm none of the detector's keep-conditions hold (any one ⇒ false positive, stop): the source identifier is reassigned, or a receiver/getter the initializer reads is mutated, between declaration and use; the use sits inside a loop or a closure that does not contain the declaration (re-evaluated/deferred); the source is type-narrowed (guard/assertion) between declaration and use; inlining would move a member read into call/tag position and change `this`; or the RHS is an optional chain.",
      'Inline the initializer at the use site and delete the declaration — a single-use name earns no keep; the substituted expression carries the same meaning. (Readability of the name is not a keep-reason per CLAUDE.md. The one information-preservation exception — an opaque bare-literal value whose name is its only documentation — never reaches you here, because the detector does not flag bare-literal initializers.)',
    ],
  },

  IND_THIN_WRAPPER: {
    cause:
      "A function's entire body delegates to another function with identical or trivially transformed arguments, adding no logic.",
    think: [
      'Read the wrapper function body. If it contains any logic beyond delegation (branching, error handling, argument transformation, logging), this is a false positive — stop, no action needed.',
      'Grep for all call sites of the wrapper function name across the project. If callers exist in test files that mock or spy on this wrapper specifically, the wrapper serves a test isolation purpose — stop, no action needed.',
      'Replace all caller references with direct calls to the target function. Update imports in every affected file, then delete the wrapper.',
    ],
  },
  IND_FORWARD_CHAIN: {
    cause: 'Multiple functions form a chain where each forwards to the next with no added logic, creating unnecessary depth.',
    think: [
      'Read each function in the chain from first to last. Identify where real logic begins — the function that does more than forward arguments is the true entry point.',
      'Grep for imports of each intermediate function. If an intermediate function is imported by external consumers (not just the next link), it serves as a public API boundary — stop, no action needed for that link.',
      'Redirect all callers of the chain entry to call the true entry point directly. Remove each intermediate function that has zero remaining callers after redirection.',
    ],
  },
  IND_CROSS_FILE_CHAIN: {
    cause: 'A forwarding chain spans multiple files, creating cross-file indirection without logic at each hop.',
    think: [
      'Read each file in the chain. If a file boundary aligns with a layer in the architecture (e.g., adapter → application → engine), the hop is intentional — stop, no action needed for that hop.',
      'Grep for imports of each intermediate file from outside the chain. If other consumers import from an intermediate file, it is a public surface that must remain.',
      'For hops that have no external consumers and no architectural justification, redirect the upstream import to the downstream file and delete the intermediate re-export.',
    ],
  },
  IND_TYPE_REMAP: {
    cause: 'A type alias is a direct synonym for another named type, adding no type-level transformation.',
    think: [
      'Read the alias definition. If it shortens a deeply qualified namespace path (e.g., `type Node = ts.Node`), check the project convention — if namespace access is standard, the alias is justified — stop, no action needed.',
      'Grep for all usages of the alias name across the project. Note each file and line that references it.',
      'Replace every usage with the original type name, update imports, and delete the alias declaration. Run the type checker to confirm no breakage.',
    ],
  },
  IND_INTERFACE_REWRAP: {
    cause: 'An interface extends another type but declares no additional members, making it a pure synonym.',
    think: [
      'Grep for the interface name across the entire project. If another file adds members to this interface via declaration merging (re-declaring the same interface name with additional fields), it is intentional — stop, no action needed.',
      'If this interface is part of a plugin or extension API where consumers are expected to augment it, keep it — stop, no action needed.',
      'Replace all usages of the interface with the base type, update imports, and delete the interface declaration.',
    ],
  },

  BARREL_EXPORT_STAR: {
    cause:
      "An index file uses 'export *' which re-exports everything from a module, making the public surface implicit and unbounded.",
    think: [
      'Read the index file and list every symbol re-exported via `export *`. Grep each symbol to see if it is actually imported by any consumer. If all symbols are consumed, the wildcard is justified — stop, no action needed.',
      'If unused or internal symbols are exposed, replace `export *` with explicit named re-exports for only the consumed symbols.',
      'After converting, grep for any newly broken imports across the project and fix them.',
    ],
  },
  BARREL_DEEP_IMPORT: {
    cause: "A consumer imports directly from a module's internal file, bypassing its barrel (index) entry point.",
    think: [
      "Read the module's barrel (index.ts). If the needed symbol is already exported there, update the consumer's import path to use the barrel instead of the deep path.",
      'If the barrel does not export the needed symbol, add a named re-export for it in the barrel, then update the consumer import.',
      'If the symbol is intentionally internal (not part of the public API), the consumer may need a different abstraction — flag for review rather than exposing it.',
    ],
  },
  BARREL_INDEX_DEEP_IMPORT: {
    cause: "An index file itself imports from a deep path in another module instead of using that module's barrel.",
    think: [
      "Read the target module's barrel. If the needed symbol is already exported, change this index file's import to use the barrel path.",
      'If the target barrel does not export the symbol, add it as a named re-export in the target barrel, then update this import.',
      'After updating, grep for other files that deep-import from the same target path — they likely need the same fix.',
    ],
  },
  BARREL_MISSING_INDEX: {
    cause: 'A directory with multiple source files has no index.ts barrel file, leaving no single entry point for the module.',
    think: [
      'Grep for imports from individual files in this directory. If external consumers import from 2+ files, the directory is acting as a module and needs a barrel.',
      'If only one file is imported externally, or files are independent utilities with no shared consumers, a barrel is unnecessary — stop, no action needed.',
      'Create an index.ts with named re-exports for each symbol that external consumers currently import directly.',
    ],
  },
  BARREL_INVALID_INDEX_STMT: {
    cause: 'An index.ts contains statements other than export declarations (e.g., logic, variable declarations, side effects).',
    think: [
      'Read the index file and identify each non-export statement (variable declarations, function definitions, logic, side effects).',
      'Move each piece of logic into a dedicated module file within the same directory. Add a named re-export in the index for any public symbols.',
      'Grep for consumers that rely on the barrel import triggering side effects. If any exist, update them to import from the new dedicated module explicitly.',
    ],
  },
  BARREL_SIDE_EFFECT_IMPORT: {
    cause:
      'A barrel file contains a side-effect import (import without specifiers), which executes code when the barrel is imported.',
    think: [
      'Read the side-effect import target to identify what it does (polyfill registration, global mutation, module augmentation).',
      'If the side effect is required for the module to function, move it to an explicit setup file (e.g., `setup.ts`) and have consumers import it directly instead of relying on barrel import order.',
      'If the side effect is not needed by any consumer, remove the import from the barrel.',
    ],
  },
  BARREL_CROSS_MODULE_REEXPORT: {
    cause: 'A file re-exports a symbol from outside its own module boundary, creating an unnecessary indirection layer.',
    think: [
      'Grep for all consumers of this re-export. Redirect each consumer to import directly from the original source module.',
      'After redirecting all consumers, remove the re-export statement from this file.',
    ],
  },

  EF_THROW_NON_ERROR: {
    cause:
      'A throw (or Promise rejection) of a value that is provably not an Error loses message/stack/cause traceability — the original error information cannot be followed at the handler, even when the value reaches one.',
    think: [
      'Identify the thrown/rejected value. The detector flags only values it can *prove* are non-Error (a string/number/boolean/template literal, an object or array literal, or a primitive-wrapper call like `String(x)`/`Number(x)`); a member or identifier whose type gildash cannot resolve is given the benefit of the doubt and is NOT flagged. If the value is (or may be) an Error subtype, this is a false positive — stop, no action needed.',
      'Wrap the value in a new Error (or a domain-specific Error subclass) using `new Error(message, { cause: originalValue })` to preserve both the stack trace and the original information.',
      'Grep for catch blocks that handle this throw. If they access `.stack` or `.message`, confirm the new Error subclass provides those properties correctly.',
    ],
  },
  EF_PROMISE_CONSTRUCTOR_HYGIENE: {
    cause:
      'The Promise constructor has a hygiene issue that swallows or misdirects errors: an async executor (thrown errors never reject), a throw after the promise is already settled (no-op), or swapped resolve/reject parameters.',
    think: [
      'For an async executor, move the async work out of the executor: await it and call resolve/reject from a surrounding async function, or drop the constructor entirely in favor of async/await.',
      'For a throw after settle, move the throw before the resolve/reject call (so it converts to a rejection), or call reject(err) instead of throwing.',
      'For swapped parameters, restore the conventional `(resolve, reject)` order so rejections are delivered through the reject callback.',
    ],
  },
  EF_MISSING_ERROR_CAUSE: {
    cause:
      "A caught error is re-thrown or wrapped without preserving the original error via the 'cause' option, breaking the error chain.",
    think: [
      'Read the catch block. Locate where the new error is created or re-thrown. If it logs/transforms then rethrows the ORIGINAL error (`throw err`), the cause is intact — this is a false positive, stop, no action needed.',
      'Otherwise add `{ cause: caughtError }` as the second argument to the Error constructor (e.g., `new Error("message", { cause: err })`) so the original error stays in the chain.',
    ],
  },
  EF_UNSAFE_FINALLY: {
    cause:
      'A finally block contains a control-flow statement (throw, return, break, or continue) that can override the try/catch result, silently discarding errors.',
    think: [
      'Read the finally block. The concept\'s only keep is a finally that does pure cleanup (no throw/return). A `return` or `throw` in finally overrides the try/catch outcome and swallows any in-flight error, so it is W even when intended — do not treat "documented fallback" as an escape; proceed to fix.',
      'Remove the return/throw from the finally block. Move it into the try block (for success returns) or catch block (for error re-throws). The finally block should contain only cleanup code (close connections, release resources).',
    ],
  },
  EF_UNOBSERVED_PROMISE_FLOATING: {
    cause: 'A Promise is created but not awaited, returned, or stored, so its rejection will be silently lost.',
    think: [
      'Read the function call that creates the floating Promise. If the result genuinely does not matter AND the callee handles its own errors, mark the discard explicit with a `void` prefix (e.g., `void doSomething()`) — stop. (Bare `void` does NOT restore observability when the callee does not handle its errors — in that case the finding stands; go to the next step.)',
      'If the enclosing function is async, add `await` before the Promise-producing call.',
      'If the enclosing function is sync, either convert it to async and await, or add `.catch(handleError)` to the floating Promise.',
    ],
  },
  EF_UNOBSERVED_PROMISE_CATCH_OR_RETURN: {
    cause: 'A Promise chain has .then() without a .catch() or the result is not returned/awaited, leaving rejections unhandled.',
    think: [
      'Read the Promise chain. If the enclosing function is async, replace the `.then()` chain with `await` so rejections propagate automatically.',
      'If the enclosing function is sync, add `.catch(err => { /* handle */ })` at the end of the chain, or return the chain so the caller can handle rejections.',
    ],
  },
  EF_UNOBSERVED_PROMISE_MISUSED: {
    cause:
      'A Promise is used in a context that expects a synchronous value (e.g., array.forEach callback, conditional expression), leading to always-truthy checks or ignored results.',
    think: [
      'Read the misuse site. If it is `array.forEach(async item => ...)`, replace with `for (const item of array) { await ... }` to process items sequentially, or use `await Promise.all(array.map(async item => ...))` for parallel execution.',
      'If it is a conditional check on a Promise (e.g., `if (promise)`), add `await` before the Promise to get the resolved value before checking.',
      'After fixing, verify that error propagation is preserved — each awaited call should be inside a try-catch or the enclosing function should propagate rejections.',
    ],
  },
  EF_UNOBSERVED_PROMISE_VARIABLE: {
    cause: 'A Promise is assigned to a variable but never awaited, .then()ed, or .catch()ed in the same scope.',
    think: [
      'Grep for the variable name in the current file. If it is passed to another function, returned, or used in `Promise.all()`, the Promise is observed elsewhere — stop, no action needed.',
      'If the variable is truly unused after assignment, add `await` before the assignment expression, or remove the assignment if the result is not needed.',
    ],
  },
  EF_UNOBSERVED_PROMISE_CALLBACK_IN_PROMISE: {
    cause: 'A callback-style API is used inside a Promise chain, mixing two async patterns and risking unhandled errors.',
    think: [
      'Read the callback-style API call. Check if a Promise-based alternative exists (e.g., `fs/promises` instead of `fs`, `util.promisify()` for Node.js callbacks). If so, replace the callback API with the Promise version.',
      'If no Promise alternative exists, wrap the callback in `new Promise((resolve, reject) => { api(args, (err, result) => err ? reject(err) : resolve(result)) })` and await it.',
    ],
  },
  EF_EMPTY_CATCH: {
    cause:
      'A catch block with no statements (or an empty `.catch(…)` / `.then(_, …)` rejection handler) silently swallows the caught error — its observability, propagation and cause are all lost.',
    think: [
      'Read the catch block and the try body. Decide how the error should be handled: rethrow it (`throw err`), log it, or convert it into a recovery value.',
      'If the failure is genuinely expected and ignorable, make the intent observable in code — bind the error and pass it to a no-op handler, or narrow the try to the single statement that may fail. A comment alone does not restore observability.',
      'If the catch only exists to suppress a specific expected error, re-throw any other error so unexpected failures still propagate.',
    ],
  },
  EF_RETURN_AWAIT_IN_TRY: {
    cause:
      'A return statement inside a try block does not await a promise-returning expression, so the catch clause cannot intercept rejections.',
    think: [
      'Read the return statement in the try block. Verify the returned expression produces a Promise (async function call, fetch, etc.). If it returns a plain value, this is a false positive — stop, no action needed.',
      'Add `await` before the returned expression (change `return fetchData()` to `return await fetchData()`) so that rejections are caught by the surrounding catch block.',
    ],
  },
  DEP_LAYER_VIOLATION: {
    cause: 'A module imports from a layer that the architecture rules prohibit, breaking the intended dependency direction.',
    think: [
      'Read the import statement and identify which layers are involved (e.g., application importing from infrastructure). Check the architecture rules in CLAUDE.md or firebat config to confirm this is a violation.',
      'If the imported symbol represents a capability (e.g., database access), create or use an existing port interface in the allowed layer and have the infrastructure implement it. Update the import to reference the port.',
      'If the layer rules themselves are wrong (the dependency direction makes sense architecturally), update the firebat configuration rather than restructuring the code.',
    ],
  },
  DEP_DEAD_EXPORT: {
    cause: 'An exported symbol is not imported by any other module in the project, making the export unnecessary.',
    think: [
      'Grep for the symbol name across the entire project (including test files, scripts, and config files). If it is referenced anywhere outside this file, this is a false positive — stop, no action needed.',
      'Check if the symbol is part of a public library API (listed in package.json exports or a public barrel). If so, it is consumed by external packages — stop, no action needed.',
      'Remove the `export` keyword from the symbol declaration. If the symbol is also unused locally, delete it entirely.',
    ],
  },
  DEP_UNUSED_FILE: {
    cause: 'A source file is not reachable from any entry point in the project, making it effectively dead code.',
    think: [
      'Grep for the file name (without extension) across the project to check for dynamic imports (`import()`, `require()`), worker references, or script entries not in package.json. If found, this is a false positive — stop, no action needed.',
      'Check git log for this file. If it was recently created and is part of an in-progress feature, leave it. If the last meaningful change was before a major refactor, it is likely a leftover.',
      'Delete the file. Run the build and tests to confirm nothing breaks.',
    ],
  },
  DEP_UNUSED_DEPENDENCY: {
    cause: 'A package listed in package.json dependencies is not imported anywhere in the project source code.',
    think: [
      'Grep for the package name in all config files (e.g., `.babelrc`, `postcss.config`, `jest.config`, `tsconfig.json`, build scripts). If it is used as a plugin, preset, or CLI tool, it is consumed indirectly — stop, no action needed.',
      'Check if it is a peer dependency required by another installed package. Run `bun pm ls` or check `node_modules` to see if another package depends on it.',
      'Remove the package from package.json and run `bun install`. Run the build and tests to confirm nothing breaks.',
    ],
  },
  DEP_UNLISTED_DEPENDENCY: {
    cause: 'A package is imported in source code but not declared in any dependency section of package.json.',
    think: [
      'Read the import statement. If the specifier is a typo or refers to a renamed/removed package, fix the import path.',
      'If the package exists in node_modules via a transitive dependency, add it explicitly to package.json — transitive dependencies can disappear on updates. Use `dependencies` for runtime imports, `devDependencies` for build/test-only imports.',
    ],
  },
  DEP_UNRESOLVED_IMPORT: {
    cause: 'An import specifier in source code cannot be resolved to any file in the project.',
    think: [
      'Check if the target file was renamed or moved. Search for files with a similar name using glob patterns. If found, update the import path.',
      'If the import uses path aliases (e.g., `@/utils`), check `tsconfig.json` paths configuration. If the alias is missing or misconfigured, fix it.',
      'If the file was deleted intentionally, remove the import and any code that depends on the imported symbols.',
    ],
  },
  DEP_DUPLICATE_EXPORT: {
    cause: 'The same symbol name is exported from multiple files in the project, creating ambiguity for consumers.',
    think: [
      'Grep for all export sites of the symbol name. Read each one to determine if they are the same implementation (copy-paste) or different implementations sharing a name.',
      'If they are copies, choose one canonical source file and update all consumers to import from it. Delete the duplicate export from the other file.',
      'If they are different implementations, rename one to disambiguate (e.g., `parseJSON` vs `parseXML` instead of both being `parse`).',
    ],
  },
  DEP_UNUSED_ENUM_MEMBER: {
    cause: 'An exported enum member is never referenced by any consumer in the project.',
    think: [
      'Grep for the enum member name (e.g., `MyEnum.MemberName` and `MemberName`) across the project. Also search for dynamic access patterns like `MyEnum[variable]`. If found, this is a false positive — stop, no action needed.',
      'Check if the enum maps to an external contract (API response codes, database status values). If so, the member must exist for completeness — stop, no action needed.',
      'Remove the unused enum member. Run the type checker to catch any references that static search missed.',
    ],
  },
  DEP_UNUSED_NS_EXPORT: {
    cause: 'A module export is not accessed through the namespace import that brings in the module.',
    think: [
      'Grep for the export name as a standalone named import (e.g., `import { symbolName } from ...`) in other files. If it is imported directly elsewhere, the namespace import is not the only consumer — stop, no action needed.',
      'If the export is truly unused everywhere, remove the `export` keyword. If the symbol is also unused locally, delete it.',
    ],
  },
  DEP_UNUSED_NS_MEMBER: {
    cause: 'A TypeScript namespace member is exported but never referenced outside the namespace.',
    think: [
      'Grep for the namespace member name across the project (e.g., `Namespace.MemberName`). Also check for computed property access patterns. If found, this is a false positive — stop, no action needed.',
      'If the namespace is part of a public API consumed by external packages, the member may be needed for completeness — stop, no action needed.',
      'Remove the member from the namespace. If the namespace becomes empty, consider removing the namespace entirely and converting remaining members to module-level exports.',
    ],
  },

  NESTING_DEEP: {
    cause:
      'A function has deeply nested control structures, increasing indentation and making the execution path hard to follow.',
    think: [
      'Read the function and identify the deepest nesting path. Check if the outermost levels are precondition checks (null checks, error checks) that can be converted to early returns/guard clauses to reduce nesting by 1-2 levels.',
      'Check if other firebat findings (WASTE_DEAD_STORE, COUPLING_GOD_MODULE) co-occur in this function. If so, the nesting is a symptom of the function doing too much — split by responsibility rather than flattening nesting mechanically.',
      'For remaining deep nesting, extract the inner block into a named helper function. The extracted function name should describe what the block does, making the parent function read as a sequence of high-level steps.',
    ],
  },
  NESTING_HIGH_CC: {
    cause: 'A function has high cognitive complexity, meaning it contains many interacting control-flow decisions.',
    think: [
      'Read the function and group its if/switch/loop branches by what they decide (validation, routing, transformation, error handling). If groups are independent of each other, each group is a candidate for extraction into its own function.',
      'If the complexity comes from validation logic (multiple field checks), replace the chain with a declarative validation schema or a data-driven lookup table.',
      'Extract each identified group into a named function. After extraction, the original function should read as a linear orchestration of named steps with CC under the threshold.',
    ],
  },
  NESTING_ACCIDENTAL_QUADRATIC: {
    cause: 'A nested loop or iteration pattern creates O(n²) complexity that may not be intentional.',
    think: [
      'Read the nested iteration. Identify the inner operation: if it is `array.includes()`, `array.find()`, or `array.filter()` inside a loop, replace it with a Set or Map lookup (O(1) per check instead of O(n)).',
      'If the quadratic behavior is inherent to the problem (e.g., pairwise comparison), check the expected input size. If the input is bounded and small (< 100 items), the quadratic cost is acceptable — stop, no action needed.',
      'For large or unbounded inputs, restructure: pre-build a Map/Set from the inner collection before the outer loop, then perform lookups inside the loop.',
    ],
  },
  NESTING_CALLBACK_DEPTH: {
    cause:
      'A function contains deeply nested callback chains (depth ≥ 3), making control flow hard to follow and error handling fragile.',
    think: [
      'Read the callback chain. If the enclosing function can be made async, convert each nested callback into a sequential `await` call, flattening the chain entirely.',
      'If the callbacks are event listeners (not sequential async steps), extract each level into a named function with a descriptive name. Wire them together at the top level so the event flow reads linearly.',
    ],
  },
  NESTING_PROMISE_CHAIN: {
    cause:
      'A function contains a deeply chained or nested Promise chain (.then/.catch/.finally), creating hard-to-follow asynchronous control flow that cognitive complexity metrics miss.',
    think: [
      'Read the Promise chain. If the enclosing function is async (or can be made async), convert the `.then()` chain to sequential `await` calls with try-catch for error handling.',
      'If individual `.then()` callbacks contain substantial logic (more than 2-3 lines), extract each into a named function. The chain should read as: `.then(validate).then(transform).then(persist)`.',
      'Verify that `.catch()` handlers cover all rejection paths. After converting to await, ensure every awaited call is inside a try-catch or the function propagates rejections to its caller.',
    ],
  },
  NESTING_COMPLEXITY_DENSITY: {
    cause:
      'A function has high cognitive complexity relative to its size (CC/LOC), indicating dense decision logic packed into a small number of lines.',
    think: [
      'Read the function. If it is a compact decision table (short switch/if-else chain mapping inputs to outputs), the density may be inherent and acceptable — stop, no action needed.',
      'If the function mixes multiple concerns in few lines (validation + transformation + error handling), split each concern into a separate function. The density drops because LOC increases proportionally to CC.',
    ],
  },

  EARLY_RETURN_WRAPPING_IF: {
    cause:
      "A block's last statement is an if (no else) that wraps remaining code. Inverting the condition and adding an early exit (return/continue) reduces nesting by one level.",
    think: [
      'Read the wrapping if statement. Invert its condition and add an early `return` (or `continue` if inside a loop) for the negated case. Move the wrapped code block out by one indentation level.',
      'After inverting, re-read the guard clause. It should express the exceptional/short-circuit case (e.g., `if (!valid) return`). If the inverted condition reads unnaturally, the original nesting may be clearer — stop, no action needed.',
    ],
  },
  EARLY_RETURN_INVERTIBLE: {
    cause:
      'An if-else structure has a short branch (≤3 statements) ending in return/throw and a long branch, which can be inverted to reduce nesting.',
    think: [
      'Read the if-else structure. Move the short branch (the one ending in return/throw) to the top as a guard clause. Remove the else keyword and un-indent the long branch.',
      'If the short branch handles the error/edge case, the guard naturally reads as a precondition check. If it handles the happy path, inverting would make the code less intuitive — stop, no action needed.',
    ],
  },
  EARLY_RETURN_CASCADE_GUARD: {
    cause:
      'An else-if chain has all non-final branches ending in return/throw/continue, which can be flattened to sequential guard clauses.',
    think: [
      'Read the else-if chain. Since each non-final branch exits early, remove the `else` keywords and convert to sequential if statements, each ending with return/throw/continue. The final branch becomes the un-indented default path.',
      'After flattening, verify that the guards test independent preconditions. If a guard depends on a previous guard having failed (shared computation), add a comment or keep the else-if to make the dependency explicit.',
      'If the chain exceeds 4 guards, the function may be handling too many cases — consider a lookup table or strategy pattern instead of sequential guards.',
    ],
  },
  EARLY_RETURN_IMPLICIT_ELSE: {
    cause:
      'An if block (no else) ends with return/throw/continue, followed by a short tail that acts as an implicit else. Inverting the condition and using the tail as a guard clause reduces nesting.',
    think: [
      'Read the if block and the tail code after it. If the tail is shorter and handles the exceptional case (error, edge case), invert the condition: move the tail into the if block as a guard clause with early return, then un-indent the original if body.',
      'If inside a loop, use `continue` instead of `return` for the guard. Verify that the loop accumulator or iterator state is not affected by the inversion.',
    ],
  },

  COLLAPSIBLE_IF: {
    cause:
      'Nested if statements with no else branches can be merged into a single if with a combined condition (&&), reducing one level of nesting.',
    think: [
      'Read both conditions. If merging them into `if (condA && condB)` produces a condition longer than ~80 characters, extract the combined condition into a named boolean variable (e.g., `const isEligible = condA && condB`) for readability.',
      'If either condition has side effects (function call that mutates state), confirm that short-circuit evaluation preserves the intended behavior — `condB` will not execute when `condA` is false. If this changes behavior, do not merge — stop, no action needed.',
    ],
  },
  COLLAPSIBLE_ELSE_IF: {
    cause:
      'An else block contains a single if statement that can be collapsed into else-if, removing unnecessary braces and one level of nesting.',
    think: [
      'Read the else block. If it contains only a single if statement (no other code), collapse `else { if (...) }` into `else if (...)` and remove the extra braces.',
      'If the inner if has its own else, verify that the resulting `else if ... else` chain reads correctly and maintains the intended branching logic.',
    ],
  },

  COUPLING_GOD_MODULE: {
    cause: 'A module has both high fan-in and high fan-out, meaning many modules depend on it and it depends on many modules.',
    think: [
      'Read the module and list all its exports. Group exports by domain responsibility (e.g., types, utilities, business logic, constants). Each group that has its own set of consumers is a candidate for extraction.',
      'Grep for each export to identify consumer clusters. If group A is consumed only by modules X and Y, and group B only by modules Z and W, the module serves two unrelated audiences and should be split.',
      'Extract each responsibility group into its own module. Update all consumer imports. After splitting, verify that the original module is either deleted or reduced to a thin re-export barrel.',
    ],
  },
  COUPLING_BIDIRECTIONAL: {
    cause: 'Two modules import from each other, creating a circular dependency that prevents independent reasoning about either.',
    think: [
      'Read the import statements in both directions. Identify which direction is primary (core logic depends on it) and which is incidental (convenience, type reference, or utility access).',
      'For the incidental direction: extract the shared symbol into a third module that both can import, or invert the dependency using dependency injection (pass the dependency as a parameter instead of importing).',
      'If both directions are truly essential (each module needs the other to function), the two modules are a single cohesive unit — merge them into one module.',
    ],
  },
  COUPLING_OFF_MAIN_SEQ: {
    cause:
      "A module's instability-abstractness balance places it far from the main sequence, indicating it is either too abstract for its stability or too concrete for how many depend on it.",
    think: [
      'Read the module. If it is too concrete (many dependents but no interfaces), add interfaces/contracts for the capabilities it provides so dependents can depend on abstractions instead of implementations.',
      'If it is too abstract (mostly interfaces but few dependents), the abstractions may be premature — inline them into the modules that use them.',
      'If the module is a mixed bag, split it: concrete implementations in one module, abstract contracts in another.',
    ],
  },
  COUPLING_UNSTABLE: {
    cause:
      'A module has high instability (many outgoing dependencies, few incoming) and high fan-out, making it sensitive to changes in its dependencies.',
    think: [
      'Read the module and list all its imports. If it is an orchestrator (composition root, adapter, controller), high fan-out is by design — stop, no action needed.',
      'If it is not an orchestrator, identify which imports can be replaced with port interfaces. Create interfaces for the volatile dependencies and inject implementations via the composition root.',
      'After adding interfaces, verify that the module only depends on stable abstractions (ports, types) rather than concrete implementations.',
    ],
  },
  COUPLING_RIGID: {
    cause:
      'A module has very low instability (many dependents, few dependencies) and high fan-in, making it extremely costly to change.',
    think: [
      'Read the module and its exports. If the module is intentionally stable (core types, shared constants, fundamental utilities), rigidity is by design — stop, no action needed.',
      'If the module needs to evolve, identify the stable subset that dependents rely on. Extract this subset into a separate module that remains frozen, allowing the rest to change freely.',
      'If dependents use different subsets of the module, split it by consumer group so that changes affect only the relevant consumers.',
    ],
  },

  DUP_EXACT: {
    cause: 'Two or more code blocks are character-for-character identical, indicating copy-paste duplication.',
    think: [
      'Read both duplicate blocks and their surrounding context. Identify what varies between the call sites (different arguments, different modules, different data types).',
      'Extract the duplicated code into a shared function in the nearest common ancestor module. Parameterize any differences between call sites as function arguments.',
      'Check git log for both blocks. If they always change together (same commits), the single source of truth is overdue. If they diverge independently, they may serve different purposes — verify before unifying.',
    ],
  },
  DUP_SHAPE: {
    cause:
      'Two or more code blocks share identical structure but differ only in identifier names, suggesting the codebase repeatedly handles a concept without a unifying abstraction.',
    think: [
      'Read the clones and list the differing identifiers. These names usually represent a domain concept (entity type, resource kind, operation variant) that the code handles repeatedly without an explicit model.',
      'Grep for the same structural pattern elsewhere in the codebase. If the shape recurs beyond the reported clones, the missing abstraction is systemic — a generic function parameterized by the varying concept is warranted.',
      'If the repetition is intentional (explicit per-entity handling for clarity), and the blocks are short (< 10 lines each), the duplication cost may be acceptable — stop, no action needed.',
    ],
  },
  DUP_NORMALIZED: {
    cause:
      'Two or more code blocks share the same normalized structure after removing cosmetic differences, indicating similar logic with minor variations.',
    think: [
      'Read the clones side by side and identify the specific variations (different data types, error strategies, business rules). These variations encode decisions the codebase makes repeatedly without a shared policy.',
      'Check git log for both blocks to determine if the variations are accidental divergence from a common origin or intentional specialization. If divergence happened gradually without clear intent, unification is likely correct.',
      'Create a shared function that accepts the varying parts as parameters or callbacks. If the variations are too complex to parameterize cleanly, the duplication may be preferable to a forced abstraction — stop, no action needed.',
    ],
  },
  DUP_FRAGMENT: {
    cause:
      'A contiguous run of statements inside one function body is duplicated, with the same normalized structure, inside another function — a copy-pasted block below declaration granularity.',
    think: [
      'Read the duplicated statement run in both functions. It carries a single decision (a computation or transformation) expressed twice; changing it in one place but not the other introduces an inconsistency bug.',
      'Extract the run into a shared helper. The run is reported only when it is safely extractable (at most one value flows out, no control-flow escapes), so a single function with the run body and its inputs as parameters is mechanically sound.',
      'If the two runs are about to diverge for independent reasons, the duplication may be intentional — confirm the decision is genuinely shared before unifying.',
    ],
  },

  DIAG_GOD_FUNCTION: {
    cause:
      'A single function triggers multiple finding types simultaneously (nesting + waste, or responsibility-boundary), indicating it handles multiple independent concerns.',
    think: [
      'Read the function and list all variables. Group variables by which ones interact with each other (read/write dependencies). Groups that share no variables represent independent concerns.',
      'For each independent group, extract the code block into a named helper function. The function name should describe the concern (e.g., `validateInput`, `transformPayload`, `persistResult`).',
      'After extraction, verify that the individual findings (NESTING_DEEP, WASTE_DEAD_STORE) disappear — they were symptoms of responsibility overload. If findings remain, address them in the extracted functions.',
    ],
  },
  DIAG_CIRCULAR_DEPENDENCY: {
    cause:
      'A group of modules form a dependency cycle, making it impossible to understand or modify any one module in isolation.',
    think: [
      "Read the import statements of each module in the cycle. Identify the weakest link — the import that contributes least to the module's core purpose (often a type import or a utility function reference).",
      'Break the cycle at the weakest link: extract the shared symbol (type, interface, constant) into a new module that both sides can import from, or invert the dependency by passing the needed value as a parameter.',
      'If the cycle involves only two modules that are tightly intertwined, merge them into a single module — the cycle indicates they are a single cohesive unit.',
    ],
  },
  DIAG_GOD_MODULE: {
    cause:
      'A module acts as a hub with excessive fan-in and fan-out, coupling a large portion of the codebase through one point.',
    think: [
      'Read the module and list all exports. Grep for each export to identify which consumers use it. Group exports by consumer overlap — exports used by the same set of consumers belong together.',
      'Split the module along consumer group boundaries. Each new module should serve a cohesive set of consumers. Update all import paths.',
      'After splitting, verify that no new module has both high fan-in and high fan-out. If one does, repeat the analysis on that module.',
    ],
  },
  DIAG_DATA_CLUMP: {
    cause: 'The same group of parameters appears together across multiple function signatures, indicating a missing abstraction.',
    think: [
      'Read the function signatures that share the parameter group. If the parameters represent a coherent domain concept (e.g., `x, y, z` → `Point`, `host, port, protocol` → `ConnectionConfig`), create an interface or type for the group.',
      'Replace the parameter group with a single parameter of the new type in all affected function signatures. Update all call sites.',
      'If the parameters are coincidentally grouped (they vary independently across call sites and have no semantic relationship), this is a false positive — stop, no action needed.',
    ],
  },
  DIAG_SHOTGUN_SURGERY: {
    cause:
      'A single conceptual change requires modifications across many files, indicating the concept is scattered across the codebase.',
    think: [
      'Check git log for recent commits that touched many files for a single change. If the scattered files all belong to different architectural layers (adapter, application, port), this is inherent to layered architecture — stop, no action needed.',
      'If the scattered files are at the same architectural level, the concept they share should be colocated. Identify the shared aspect (validation rule, business logic, configuration) and centralize it in one module.',
      'After centralizing, grep for remaining references to the old scattered locations and redirect them to the new central module.',
    ],
  },
  DIAG_OVER_INDIRECTION: {
    cause:
      'Multiple forwarding layers exist with single-implementation interfaces, adding navigation cost without runtime variation.',
    think: [
      'Read each interface in the indirection chain. Grep for implementations of each interface. If an interface has exactly one implementation and no test double (mock/stub), the abstraction does not earn its cost.',
      'For interfaces with only one implementation: inline the implementation into the consumer, remove the interface, and remove the forwarding layer. Update all references.',
      'If the interface exists for testability (used with `mock.module()` or `spyOn`), keep it — stop, no action needed.',
    ],
  },
  DIAG_MIXED_ABSTRACTION: {
    cause:
      'A single function mixes high-level orchestration with low-level implementation detail, visible as large nesting depth variation within the function.',
    think: [
      'Read the function and mark each block as either orchestration (calling named functions, deciding what to do next, routing) or implementation (data manipulation, computation, string building, iteration over raw data).',
      'Extract each implementation block into a named helper function. The function name should describe the operation at the same abstraction level as the orchestration calls around it.',
      'After extraction, the function should read as a linear sequence of high-level steps with no inline implementation details.',
    ],
  },

  TEMPORAL_COUPLING: {
    cause: 'Two or more operations must be called in a specific order, but this constraint is not expressed in the type system.',
    think: [
      "Read the operations that must be ordered. If step B requires output from step A, refactor step B to take step A's result as a parameter — the type system then enforces the ordering (you cannot call B without first calling A to get the input).",
      'If both steps are independent but must run in sequence (e.g., init before use), combine them into a single function that encapsulates the ordering.',
      'If the constraint cannot be encoded in types or combined, add a runtime assertion at the start of step B that checks whether step A has completed (e.g., check a state flag or non-null value).',
    ],
  },
  SYMMETRY_BREAK: {
    cause:
      'Functions in the same group have inconsistent shapes — different parameter patterns, return types, or async modifiers — breaking expected symmetry.',
    think: [
      'Read all functions in the group and identify the majority pattern (most common parameter order, return type, async modifier). Identify which functions are outliers.',
      'For each outlier, check if the difference is intentional (the function genuinely does something different). If so, rename it to clarify the distinct role — stop, no action needed for that function.',
      'If the difference is accidental drift, align the outlier to the majority pattern. Update all callers of the modified function to match the new signature.',
    ],
  },
  VAR_LIFETIME: {
    cause:
      'A variable has a longer lifetime than necessary — it is declared far from its use or lives across multiple unrelated operations.',
    think: [
      'Read the function and find the first read and last write of the variable. Count the lines between the declaration and the first use.',
      'Move the declaration to just before the first use. If the variable is initialized with a value, ensure the initialization expression does not depend on code that runs between the old and new declaration site.',
      'If the variable spans unrelated operations (used in block A, then again in block C with unrelated block B in between), split it into two separate variables — one for each usage context.',
    ],
  },
  LIFETIME_SCOPE_NARROWING: {
    cause: 'A variable is declared in a wider scope than necessary — all its uses are inside a single narrower block.',
    think: [
      'Read the variable declaration and all its usages. Confirm that every read and write is inside the same block (if, for, while, or nested function). Move the declaration inside that block.',
      'If the variable is a `let` with reassignments, verify that all assignments are also inside the target block. If any assignment is outside, the variable cannot be narrowed — stop, no action needed.',
    ],
  },
  LIFETIME_LIVENESS_PRESSURE: {
    cause:
      'A function has too many simultaneously live variables at a single point, indicating excessive state to track mentally.',
    think: [
      'Read the function and identify the point of maximum liveness (where the most variables are alive simultaneously). Group the live variables by which ones interact — independent groups can be separated.',
      "Extract each independent group into a helper function. The helper takes its group's inputs as parameters and returns the outputs, reducing the parent function's live variable count at any given point.",
      'If liveness is high because variables are declared too early, move each declaration to just before its first use — this alone may reduce the peak liveness count.',
    ],
  },
  LIFETIME_MUTATION_DENSITY: {
    cause:
      'A variable is reassigned too many times outside of loop accumulation, suggesting the variable serves multiple unrelated purposes.',
    think: [
      "Read the variable's assignments. If it is reassigned for different purposes (e.g., first holds a URL, then holds a response, then holds parsed data), split it into separate `const` variables — one per purpose, with a descriptive name for each.",
      'If the reassignments build up a value incrementally (string concatenation, object assembly), replace with a pipeline pattern: `const result = steps.reduce(...)` or a builder.',
      'If the variable is a loop accumulator (e.g., `sum += item.value`), the mutations are inherent — stop, no action needed.',
    ],
  },
  GIANT_FILE: {
    cause: 'A source file exceeds the line threshold, concentrating too many responsibilities in a single file.',
    think: [
      'Read the file and group its exports (functions, types, constants) by domain responsibility. Each group that has a distinct purpose and its own set of consumers is a candidate for extraction into a separate module.',
      'Extract the largest cohesive group first into a new file in the same directory. Update all imports across the project. Repeat until the original file is under the threshold.',
      'If the file resists decomposition (every function depends on every other), the tight coupling is the root cause. Address coupling first (break circular dependencies, extract shared types) before splitting the file.',
    ],
  },

  LINT: {
    cause: 'A lint rule violation was detected by the configured linter.',
    think: [
      'Read the lint error message and the violated rule name. Look up the rule in the linter documentation to understand its rationale.',
      "Fix the violation according to the rule's guidance. If the fix is an autofix-capable rule, run the linter with `--fix` flag.",
      'If the rule does not apply to this specific context (e.g., a lint rule about browser APIs in a Node.js file), add a targeted inline suppression comment with an explanation of why the rule is inapplicable.',
    ],
  },
  FORMAT: {
    cause: 'A source file does not conform to the project formatting standard.',
    think: [
      'Run the project formatter on the file (e.g., `oxfmt --write <file>`). If the file is generated code or vendored, formatting divergence may be intentional — stop, no action needed.',
      'If formatting conflicts recur after running the formatter, check whether the formatter configuration (`.oxfmtrc`, `printWidth`, etc.) matches the project standard.',
    ],
  },
  TYPECHECK: {
    cause: 'A TypeScript type error was detected during type checking.',
    think: [
      'Read the type error message. Identify the expected type and the actual type. If the mismatch is in your own code, fix the source: add a missing property, correct a return type, or update the function signature.',
      'If the error repeats across multiple call sites with the same root type, the type definition itself is wrong — fix the interface/type declaration rather than patching each call site.',
      'If the error comes from a third-party library type mismatch, check if a newer version of `@types/` exists. If not, add a targeted type assertion at the boundary with a comment explaining the mismatch.',
    ],
  },
} satisfies Record<FirebatCatalogCode, CatalogEntry>;

const asArray = <T>(v: unknown): ReadonlyArray<T> => {
  return Array.isArray(v) ? (v as ReadonlyArray<T>) : [];
};

const countGodFunctionResolves = (waste: ReadonlyArray<any>, nesting: ReadonlyArray<any>): number => {
  const hasHighCcInFile = new Set(
    nesting
      .filter((n: any) => n?.kind === 'high-cognitive-complexity')
      .map(itemFileString)
      .filter(Boolean),
  );
  const hasWasteInFile = new Set(waste.map(itemFileString).filter(Boolean));
  let count = 0;

  for (const f of hasHighCcInFile) {
    if (hasWasteInFile.has(f)) {
      count += waste.filter((w: any) => (w?.file ?? w?.filePath) === f).length;
    }
  }

  return count;
};

export const aggregateDiagnostics = (input: DiagnosticAggregatorInput): DiagnosticAggregatorOutput => {
  const catalog: Partial<Record<FirebatCatalogCode, CatalogEntry>> = {};
  // DIAG_GOD_FUNCTION: nesting(CC>=15) + waste co-occur in same file
  const godFunctionResolves = countGodFunctionResolves(
    asArray<any>(input.analyses['waste']),
    asArray<any>(input.analyses['nesting']),
  );

  if (godFunctionResolves > 0) {
    const entry = FIREBAT_CODE_CATALOG.DIAG_GOD_FUNCTION;

    if (entry !== undefined) {
      catalog.DIAG_GOD_FUNCTION = entry;
    }
  }

  // DIAG_CIRCULAR_DEPENDENCY
  const dependencies = input.analyses['dependencies'] as any;
  const cycles = Array.isArray(dependencies?.cycles) ? dependencies.cycles : [];

  if (cycles.length > 0) {
    const entry = FIREBAT_CODE_CATALOG.DIAG_CIRCULAR_DEPENDENCY;

    if (entry !== undefined) {
      catalog.DIAG_CIRCULAR_DEPENDENCY = entry;
    }
  }

  // DIAG_GOD_MODULE
  const godModules = asArray<any>(input.analyses['coupling']).filter((c: any) => c?.kind === 'god-module');

  if (godModules.length > 0) {
    const entry = FIREBAT_CODE_CATALOG.DIAG_GOD_MODULE;

    if (entry !== undefined) {
      catalog.DIAG_GOD_MODULE = entry;
    }
  }

  return { catalog };
};
