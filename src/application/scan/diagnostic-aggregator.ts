import type { FirebatCatalogCode, CatalogEntry } from '../../types';

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
      'Determine why this assignment became unnecessary — leftover from a refactor, logic change that bypassed this path, or a control-flow design error.',
      'Trace the variable through its enclosing scope to identify whether any branch could still read the value.',
      'Check whether multiple dead stores appear in the same function; if so, examine the function responsibilities and flow rather than individual assignments.',
    ],
  },
  WASTE_DEAD_STORE_OVERWRITE: {
    cause: 'A variable is assigned, then unconditionally reassigned before the first value is ever read.',
    think: [
      'Identify whether the first assignment once had a purpose — it may be a remnant of removed branching or a copy-paste artifact.',
      "Trace the variable's lifecycle to verify that no conditional path reads the first value before the overwrite.",
      'Check whether this pattern repeats across the function; if so, the function may be accumulating unrelated setup steps that should be separated.',
    ],
  },
  WASTE_MEMORY_RETENTION: {
    cause:
      'A large object or collection is captured in a closure or long-lived scope and remains reachable after its logical use ends.',
    think: [
      'Investigate why the reference persists — the closure may capture more than it needs, or the variable scope may be unnecessarily broad.',
      'Determine whether the value can be passed as a parameter instead of captured to narrow the retention window.',
      'Verify whether restructuring the enclosing scope or nullifying the reference after use can shorten the lifetime.',
    ],
  },

  FWD_THIN_WRAPPER: {
    cause:
      "A function's entire body delegates to another function with identical or trivially transformed arguments, adding no logic.",
    think: [
      'Determine whether this wrapper serves an intentional purpose: dependency inversion, future extension point, or API stability boundary.',
      'Trace callers to check whether they rely on the wrapper identity (e.g., for mocking or binding).',
      'If no purpose is found, verify that callers can reference the target function directly without breaking contracts.',
    ],
  },
  FWD_FORWARD_CHAIN: {
    cause: 'Multiple functions form a chain where each forwards to the next with no added logic, creating unnecessary depth.',
    think: [
      'Trace the chain to find where real logic begins — the intermediate links may be remnants of refactoring.',
      'Determine whether the chain crosses module boundaries and if each boundary represents a genuine architectural concern.',
      'Verify that collapsing intermediate hops does not break consumers that import from the middle of the chain.',
    ],
  },
  FWD_CROSS_FILE_CHAIN: {
    cause: 'A forwarding chain spans multiple files, creating cross-file indirection without logic at each hop.',
    think: [
      'Identify each file boundary in the chain and determine whether it represents a genuine architectural layer.',
      'Check whether the chain follows a re-export pattern that can be consolidated at the public surface.',
      'Verify that eliminating intermediate files does not break other consumers that import from those files.',
    ],
  },

  BARREL_EXPORT_STAR: {
    cause:
      "An index file uses 'export *' which re-exports everything from a module, making the public surface implicit and unbounded.",
    think: [
      'Determine whether all re-exported symbols are intentionally public.',
      "Check whether 'export *' inadvertently exposes internal implementation details.",
      'Verify whether switching to named re-exports would provide a controlled public API surface.',
    ],
  },
  BARREL_DEEP_IMPORT: {
    cause: "A consumer imports directly from a module's internal file, bypassing its barrel (index) entry point.",
    think: [
      'Check whether the barrel file exists and exposes the needed symbol.',
      'Determine whether the deep import is a convenience shortcut that undermines encapsulation.',
      "If the barrel does not expose the symbol, verify whether it should be added to the public surface or if the consumer's need indicates a missing abstraction.",
    ],
  },
  BARREL_INDEX_DEEP_IMPORT: {
    cause: "An index file itself imports from a deep path in another module instead of using that module's barrel.",
    think: [
      "Determine whether the target module's barrel is incomplete or this index file is taking a shortcut.",
      'Check whether the target module should expose the symbol publicly through its barrel.',
      'Verify that adding the missing re-export to the target barrel fixes the transitive deep-import dependency.',
    ],
  },
  BARREL_MISSING_INDEX: {
    cause: 'A directory with multiple source files has no index.ts barrel file, leaving no single entry point for the module.',
    think: [
      'Determine whether the directory represents a cohesive module that should have a public surface.',
      'Check whether external consumers already import from individual files — a barrel would centralize those imports.',
      'If the files are independent utilities that do not form a module, verify that the directory structure reflects this.',
    ],
  },
  BARREL_INVALID_INDEX_STMT: {
    cause: 'An index.ts contains statements other than export declarations (e.g., logic, variable declarations, side effects).',
    think: [
      'Identify what non-export statements the barrel contains and their purpose.',
      'Determine whether the logic belongs in a dedicated module file that the barrel re-exports.',
      'Verify that moving the logic out does not break consumers that rely on barrel import side effects.',
    ],
  },
  BARREL_SIDE_EFFECT_IMPORT: {
    cause:
      'A barrel file contains a side-effect import (import without specifiers), which executes code when the barrel is imported.',
    think: [
      'Identify what side effect the import produces (e.g., polyfill registration, global mutation).',
      'Determine whether the side effect is intentional and documented.',
      'If intentional, verify whether it should be isolated into an explicit setup module rather than hiding in a barrel.',
    ],
  },

  EH_THROW_NON_ERROR: {
    cause: 'A throw statement throws a value that is not an Error instance, losing stack trace and error chain capabilities.',
    think: [
      'Identify what type is being thrown and why an Error subclass was not used.',
      'Determine whether downstream catch blocks depend on Error properties (stack, message, cause).',
      'If the thrown value carries domain information, verify that wrapping it in a custom Error subclass preserves that information.',
    ],
  },
  EH_ASYNC_PROMISE_EXECUTOR: {
    cause:
      'A Promise constructor receives an async executor function, which can silently swallow rejections from awaited expressions.',
    think: [
      'Identify why the Promise constructor is used with an async function instead of returning an async function directly.',
      'Check whether the code wraps a callback-based API where the async keyword in the executor is accidental.',
      'Verify whether refactoring to a plain async function eliminates the Promise constructor entirely.',
    ],
  },
  EH_MISSING_ERROR_CAUSE: {
    cause:
      "A caught error is re-thrown or wrapped without preserving the original error via the 'cause' option, breaking the error chain.",
    think: [
      "Determine whether the original error's context is needed for debugging downstream.",
      'Check whether the new error is created with { cause: originalError } to preserve the chain.',
      'If re-throwing the original error directly, verify that wrapping is not needed and the error chain is intact.',
    ],
  },
  EH_USELESS_CATCH: {
    cause: 'A catch block catches an error and immediately re-throws it without transformation, making the try-catch pointless.',
    think: [
      'Determine whether the catch was intended to add logging, transformation, or handling that was never implemented.',
      'Check whether the try-catch once had purpose by examining version history.',
      'Verify that removing the try-catch does not affect finally blocks or control flow.',
    ],
  },
  EH_UNSAFE_FINALLY: {
    cause:
      'A finally block contains a throw or return statement that can override the try/catch result, silently discarding errors.',
    think: [
      'Determine whether the throw or return in finally is intentional or accidental.',
      'Check whether the finally block masks the original error from the try or catch blocks.',
      'Verify that the finally block contains only cleanup logic (close connections, release resources) that cannot affect control flow.',
    ],
  },
  EH_RETURN_IN_FINALLY: {
    cause: 'A finally block contains a return statement that will override any return or throw from the try/catch blocks.',
    think: [
      'Identify what value the finally return produces and whether it silently replaces try/catch results.',
      'Determine whether the return should be moved to the try block instead.',
      'Verify that the finally block performs only cleanup after moving the return.',
    ],
  },
  EH_CATCH_OR_RETURN: {
    cause: 'A Promise chain has .then() without a .catch() or the result is not returned/awaited, leaving rejections unhandled.',
    think: [
      'Determine whether the Promise rejection is intentionally ignored or accidentally unhandled.',
      "Check whether the code is in an async function where 'await' would capture rejections naturally.",
      'If using .then(), verify that adding .catch() or returning the chain for the caller to handle resolves the issue.',
    ],
  },
  EH_PREFER_CATCH: {
    cause:
      'Error handling uses .then(onFulfilled, onRejected) instead of .catch(), which is less readable and can miss errors thrown in onFulfilled.',
    think: [
      'Determine whether the two-argument .then() form is intentional or a style inconsistency.',
      'Check whether errors thrown inside the onFulfilled callback would be caught by the onRejected handler (they would not).',
      'Verify that replacing with .then().catch() provides more predictable error coverage.',
    ],
  },
  EH_PREFER_AWAIT_TO_THEN: {
    cause:
      'Promise chains use .then()/.catch() inside an async function instead of await, reducing readability and error flow clarity.',
    think: [
      'Determine whether the .then() chain has a specific reason (parallel execution, chaining) or is a style inconsistency.',
      'Check whether await provides clearer control flow and automatic error propagation via try-catch.',
      'Verify that converting to await does not change the concurrency semantics of the code.',
    ],
  },
  EH_FLOATING_PROMISES: {
    cause: 'A Promise is created but not awaited, returned, or stored, so its rejection will be silently lost.',
    think: [
      'Determine whether the fire-and-forget is intentional or accidental.',
      "Check whether the Promise's result or error matters for correctness.",
      'If truly fire-and-forget, verify that errors are handled inside the called function and consider adding void prefix for clarity.',
    ],
  },
  EH_MISUSED_PROMISES: {
    cause:
      'A Promise is used in a context that expects a synchronous value (e.g., array.forEach callback, conditional expression), leading to always-truthy checks or ignored results.',
    think: [
      'Determine what the code expected to happen — forEach does not await returned Promises and boolean checks on Promises are always true.',
      'Identify whether replacing with for-of + await restructures the logic to properly handle asynchronous values.',
      'Verify that the fix preserves iteration order and error propagation semantics.',
    ],
  },
  EH_RETURN_AWAIT_POLICY: {
    cause:
      'An async function returns await expression unnecessarily (or vice versa: should use return-await inside try blocks to catch errors properly).',
    think: [
      "Determine the context: inside a try block, 'return await' is needed to catch rejections.",
      "Outside try blocks, check whether 'return await' adds an unnecessary microtask tick.",
      'Verify that the fix matches the project policy for return-await consistency.',
    ],
  },
  EH_SILENT_CATCH: {
    cause: 'A catch block suppresses the error without logging, rethrowing, or handling it in any visible way.',
    think: [
      'Determine whether the error suppression is intentional and if so, verify that it is documented.',
      'Check whether the same pattern exists in related error handlers — systematic silent catches suggest a missing strategy.',
      'If not intentional, identify what logging or handling should be added to prevent silent failures.',
    ],
  },
  EH_CATCH_TRANSFORM: {
    cause:
      'A catch block modifies the error object or its message before rethrowing, potentially losing original error information.',
    think: [
      'Determine whether the transformation preserves the error chain via the cause property.',
      'Check whether the original stack trace remains accessible after the message is altered.',
      'Verify that downstream handlers still recognize the transformed error type.',
    ],
  },
  EH_REDUNDANT_NESTED_CATCH: {
    cause:
      'A try-catch is nested inside another try-catch that already handles the same error types, creating redundant handling.',
    think: [
      'Determine whether the inner catch handles a specific error type differently from the outer catch.',
      'Check whether the outer catch expects transformed errors from the inner catch.',
      'If handling is identical, verify that removing the inner try-catch does not alter error propagation behavior.',
    ],
  },
  EH_OVERSCOPED_TRY: {
    cause:
      'A try block wraps significantly more code than the statements that can actually throw, obscuring which operation the catch is protecting.',
    think: [
      'Identify which statements within the try block can actually throw.',
      'Determine whether narrowing the try block makes the error source explicit.',
      'Check whether multiple throwing statements share error handling logic or need distinct handling.',
    ],
  },
  EH_EXCEPTION_CONTROL_FLOW: {
    cause:
      'Exceptions are used for normal control flow (e.g., throwing to break out of a loop or signal a condition), not for error signaling.',
    think: [
      'Determine whether the thrown value represents an actual error condition or a control signal.',
      'Check whether return values, result types, or explicit control flow constructs can replace the exception.',
      'Verify that downstream error handlers are not confused by non-error exceptions mixed with real errors.',
    ],
  },

  UNKNOWN_UNNARROWED: {
    cause: "A value of type 'unknown' is used without narrowing, meaning no runtime type check guards the access.",
    think: [
      'Determine where the unknown value originates (external input, catch clause, generic parameter).',
      'Identify the appropriate narrowing strategy: typeof guard, instanceof check, or schema validation.',
      'If the value crosses a trust boundary, verify that validation is at the boundary rather than each usage site.',
    ],
  },
  UNKNOWN_INFERRED: {
    cause: "TypeScript infers 'unknown' for a value where a more specific type was likely intended.",
    think: [
      'Determine what type the value should have based on its usage context.',
      'Check whether the inference results from a missing return type annotation, untyped dependency, or insufficient generic constraints.',
      'Verify that adding an explicit type annotation makes the intent clear and catches mismatches earlier.',
    ],
  },
  UNKNOWN_ANY_INFERRED: {
    cause: "TypeScript infers 'any' for a value, disabling type checking for all downstream usage.",
    think: [
      "Identify the source of the 'any' inference: untyped import, missing type parameter, JSON.parse result, or catch clause.",
      'Trace how far the any type propagates downstream to assess the blast radius.',
      'Fix the source by adding a type annotation at the root rather than suppressing any at each usage site.',
    ],
  },
  UNKNOWN_ANY_CAST: {
    cause: "An explicit 'as any' cast removes type safety, allowing any operation on the value without type checking.",
    think: [
      'Determine why the cast was added — missing types for a library, workaround for a type error, or intentional escape hatch.',
      'Check whether adding proper types or using a type assertion to a specific type eliminates the need for `as any`.',
      'If the cast is unavoidable, verify that the scope of the `any` is minimized and does not propagate.',
    ],
  },
  UNKNOWN_DOUBLE_CAST: {
    cause:
      "A double assertion (e.g. `x as unknown as T`) bypasses TypeScript's type safety by casting through an intermediate type.",
    think: [
      'Determine whether the double assertion masks a genuine type incompatibility that should be resolved structurally.',
      'Check whether a type guard, generic constraint, or interface refinement can replace the double assertion.',
      'If the cast is unavoidable at a boundary, verify that it is documented and the scope is minimized.',
    ],
  },

  DEP_LAYER_VIOLATION: {
    cause: 'A module imports from a layer that the architecture rules prohibit, breaking the intended dependency direction.',
    think: [
      'Determine whether the import represents a genuine architectural violation or an inaccurate layer definition.',
      'Check whether the imported symbol should be exposed through an allowed layer (e.g., via a port interface).',
      'Verify that fixing the import does not require restructuring the layer boundaries themselves.',
    ],
  },
  DEP_DEAD_EXPORT: {
    cause: 'An exported symbol is not imported by any other module in the project, making the export unnecessary.',
    think: [
      'Determine whether the export is unused because it is obsolete or because it serves an external consumer not visible to static analysis.',
      'Check whether the symbol is consumed via CLI entry, test helper, or library public API.',
      "If truly unused, verify that removing the export reduces the module's public surface without breaking external contracts.",
    ],
  },
  DEP_TEST_ONLY_EXPORT: {
    cause:
      'An exported symbol is imported only by test files, meaning production code does not use it but the export exists for testability.',
    think: [
      'Determine whether the symbol should be internal (unexported, tested via public API).',
      'Check whether the symbol represents a testing concern that should live in a test utility module.',
      'Verify that keeping the export solely for tests does not mislead production consumers about the public surface.',
    ],
  },

  NESTING_DEEP: {
    cause:
      'A function has deeply nested control structures, increasing indentation and making the execution path hard to follow.',
    think: [
      'Determine why nesting accumulated: multiple concerns interleaved, missing early-return guards, or error paths mixed with happy paths.',
      'Check whether other findings (waste, coupling) co-occur in the same function, indicating the nesting is a symptom of doing too much.',
      'Identify which nesting levels can be eliminated by extracting helper functions or applying guard clauses.',
    ],
  },
  NESTING_HIGH_CC: {
    cause: 'A function has high cognitive complexity, meaning it contains many interacting control-flow decisions.',
    think: [
      'Identify which decision axes within the function are independent and can be extracted into separate functions.',
      'Check whether the complexity stems from validation logic that could use a declarative approach.',
      'Verify that the extracted functions reduce the original function to a readable orchestration of named steps.',
    ],
  },
  NESTING_ACCIDENTAL_QUADRATIC: {
    cause: 'A nested loop or iteration pattern creates O(n²) complexity that may not be intentional.',
    think: [
      'Determine whether the quadratic behavior is inherent to the problem or accidental.',
      'Check for common accidental patterns: array.includes() inside a loop (use a Set), nested find/filter, or repeated linear scans.',
      'If quadratic is inherent, verify that the expected input size is documented and the complexity is acceptable.',
    ],
  },
  NESTING_CALLBACK_DEPTH: {
    cause:
      'A function contains deeply nested callback chains (depth ≥ 3), making control flow hard to follow and error handling fragile.',
    think: [
      'Determine whether the nesting reflects genuine sequential async steps or structural accumulation.',
      'Check whether async/await can flatten the callback chain while preserving the same sequencing.',
      'If callbacks are nested for event handling, verify whether extracting each level into a named function makes the flow explicit.',
    ],
  },
  NESTING_PROMISE_CHAIN: {
    cause:
      'A function contains a deeply chained or nested Promise chain (.then/.catch/.finally), creating hard-to-follow asynchronous control flow that cognitive complexity metrics miss.',
    think: [
      'Determine whether the chain can be converted to async/await to flatten the control flow.',
      'Check whether intermediate .then() callbacks contain logic that should be extracted into named functions.',
      'If the chain must remain, verify that error handling (.catch) is placed at appropriate points rather than only at the end.',
    ],
  },
  NESTING_COMPLEXITY_DENSITY: {
    cause:
      'A function has high cognitive complexity relative to its size (CC/LOC), indicating dense decision logic packed into a small number of lines.',
    think: [
      'Determine whether the density reflects inherently complex logic or multiple concerns compressed together.',
      'Check whether extracting sub-decisions into named helper functions reduces the density without increasing total complexity.',
      'Verify that the function size is not artificially small due to missing error handling or edge cases.',
    ],
  },

  EARLY_RETURN_WRAPPING_IF: {
    cause:
      "A block's last statement is an if (no else) that wraps remaining code. Inverting the condition and adding an early exit (return/continue) reduces nesting by one level.",
    think: [
      'Check if the wrapping condition tests a precondition or error case that naturally becomes a guard.',
      'If inside a loop, verify that a continue statement preserves the iteration intent.',
      'Count how many lines of code would be un-indented — larger blocks benefit more.',
    ],
  },
  EARLY_RETURN_INVERTIBLE: {
    cause:
      'An if-else structure has a short branch (≤3 statements) ending in return/throw and a long branch, which can be inverted to reduce nesting.',
    think: [
      'Determine whether inverting the condition and returning early improves readability.',
      'Check whether the short branch handles an edge case or error condition that naturally becomes a guard clause.',
      'If the pattern repeats across the function, verify whether each guard represents a distinct precondition.',
    ],
  },
  EARLY_RETURN_CASCADE_GUARD: {
    cause:
      'An else-if chain has all non-final branches ending in return/throw/continue, which can be flattened to sequential guard clauses.',
    think: [
      'Verify that each guard tests an independent precondition rather than a shared computation.',
      'Check whether flattening the chain makes the final "happy path" easier to follow.',
      'If the chain exceeds 3-4 guards, consider whether a lookup table or strategy pattern is clearer.',
    ],
  },
  EARLY_RETURN_IMPLICIT_ELSE: {
    cause:
      'An if block (no else) ends with return/throw/continue, followed by a short tail that acts as an implicit else. Inverting the condition and using the tail as a guard clause reduces nesting.',
    think: [
      'Check whether the tail represents an error/edge case that naturally becomes a guard clause.',
      'Verify that inverting the condition reads clearly — the guard should express the exceptional case.',
      'If inside a loop, confirm that adding a continue to the guard preserves iteration semantics.',
    ],
  },

  COLLAPSIBLE_IF: {
    cause:
      'Nested if statements with no else branches can be merged into a single if with a combined condition (&&), reducing one level of nesting.',
    think: [
      'Check whether the two conditions are logically independent or if one depends on the other being true.',
      'Verify that merging the conditions does not reduce readability — named variables may be clearer than a long && chain.',
      'If either condition has side effects, confirm that short-circuit evaluation preserves the intended behavior.',
    ],
  },
  COLLAPSIBLE_ELSE_IF: {
    cause:
      'An else block contains a single if statement that can be collapsed into else-if, removing unnecessary braces and one level of nesting.',
    think: [
      'Check whether the inner if was wrapped in braces intentionally (e.g., for a comment or future expansion) or by accident.',
      'Verify that collapsing to else-if does not obscure the logical grouping — sometimes the brace separation aids readability.',
      'If the inner if has its own else, confirm that the resulting else-if-else chain reads clearly and maintains the intended branching logic.',
    ],
  },

  COUPLING_GOD_MODULE: {
    cause: 'A module has both high fan-in and high fan-out, meaning many modules depend on it and it depends on many modules.',
    think: [
      'Determine which responsibilities this module holds that attract so many dependents.',
      'Identify clusters of related imports and exports — each cluster may form a cohesive module if extracted.',
      'Verify that splitting the module along cluster boundaries reduces both fan-in and fan-out.',
    ],
  },
  COUPLING_BIDIRECTIONAL: {
    cause: 'Two modules import from each other, creating a circular dependency that prevents independent reasoning about either.',
    think: [
      'Determine which import direction is primary and which is incidental.',
      'Check whether the incidental direction can be inverted via dependency injection or an event bus.',
      'If both directions are essential, verify whether the two modules logically should be merged.',
    ],
  },
  COUPLING_OFF_MAIN_SEQ: {
    cause:
      "A module's instability-abstractness balance places it far from the main sequence, indicating it is either too abstract for its stability or too concrete for how many depend on it.",
    think: [
      'Determine whether the module should be more abstract (add interfaces/contracts) or less depended-upon (reduce fan-in).',
      'Check the distance value to assess severity — high-distance modules create conflicting forces on change.',
      'Verify whether splitting the module or adding abstractions brings it closer to the main sequence.',
    ],
  },
  COUPLING_UNSTABLE: {
    cause:
      'A module has high instability (many outgoing dependencies, few incoming) and high fan-out, making it sensitive to changes in its dependencies.',
    think: [
      'Determine whether the high fan-out is essential or whether the module can depend on fewer abstractions.',
      'Check whether introducing port interfaces can isolate the module from concrete implementation changes.',
      'If the module is a thin orchestrator, verify that instability is acceptable by design and documented.',
    ],
  },
  COUPLING_RIGID: {
    cause:
      'A module has very low instability (many dependents, few dependencies) and high fan-in, making it extremely costly to change.',
    think: [
      "Determine whether the module's interface is stable by design or frozen by accident (too many dependents accumulated).",
      'Check whether the interface needs to evolve and if versioning or adapter layers can shield existing dependents.',
      'Verify whether extracting the stable subset into a separate module allows the rest to evolve independently.',
    ],
  },

  DUP_EXACT: {
    cause: 'Two or more code blocks are character-for-character identical, indicating copy-paste duplication.',
    think: [
      'Determine why the same code exists in multiple places — a missing shared abstraction, an incomplete module API, or a concern with no clear owner.',
      'Check whether the duplicated blocks change together historically; synchronized changes signal a missing single source of truth.',
      'Assess whether the duplication is structural (same pattern recurring across the codebase) or isolated (one-off copy-paste).',
    ],
  },
  DUP_SHAPE: {
    cause:
      'Two or more code blocks share identical structure but differ only in identifier names, suggesting the codebase repeatedly handles a concept without a unifying abstraction.',
    think: [
      'Identify what the varying names represent — they often reveal a domain concept (entity type, resource kind, operation) that the design does not yet model explicitly.',
      'Check whether this pattern appears beyond the reported clones; if the same shape recurs elsewhere, the missing abstraction is systemic, not local.',
      'Assess whether the repetition reflects an intentional design choice (e.g., explicit per-entity handling for clarity) or an accidental gap in the module structure.',
    ],
  },
  DUP_NORMALIZED: {
    cause:
      'Two or more code blocks share the same normalized structure after removing cosmetic differences, indicating similar logic with minor variations.',
    think: [
      'Examine what the variations between clones represent — they often encode decisions (data type, error strategy, business rule) that the codebase makes repeatedly without a shared policy.',
      'Check whether the variations are accidental divergence from a common origin or intentional specialization; version history clarifies which.',
      'Assess whether the responsibility for this logic is scattered across modules that should instead share a common concern.',
    ],
  },
  DUP_NEAR_MISS: {
    cause:
      'Two or more code blocks are structurally similar but have diverged beyond simple naming or cosmetic differences, suggesting shared origin with incremental drift.',
    think: [
      'Identify the divergence points between clones — they reveal where requirements or assumptions differ and whether those differences are intentional design decisions.',
      'Check whether the drift is growing over time; increasing divergence suggests the clones serve genuinely different purposes and may be better kept separate with clear documentation.',
      'Assess whether the similar structure indicates a missing abstraction that accommodates variation, or whether forced unification would create a fragile over-generalized component.',
    ],
  },

  DIAG_GOD_FUNCTION: {
    cause:
      'A single function triggers multiple finding types simultaneously (nesting + waste, or responsibility-boundary), indicating it handles multiple independent concerns.',
    think: [
      'Determine how many independent concerns this function handles by examining variable clusters.',
      'Check whether variables form distinct groups that do not interact — each group likely represents a separable concern.',
      'Verify that individual findings (nesting, waste) are symptoms of responsibility overload rather than standalone issues.',
    ],
  },
  DIAG_CIRCULAR_DEPENDENCY: {
    cause:
      'A group of modules form a dependency cycle, making it impossible to understand or modify any one module in isolation.',
    think: [
      "Identify the weakest link in the cycle — the import that contributes least to the module's core purpose.",
      'Determine whether introducing an interface at the boundary or moving shared types to a neutral location breaks the cycle.',
      'If the cycle involves only two modules, verify whether they logically should be merged.',
    ],
  },
  DIAG_GOD_MODULE: {
    cause:
      'A module acts as a hub with excessive fan-in and fan-out, coupling a large portion of the codebase through one point.',
    think: [
      'Analyze what responsibilities attract dependencies to this module.',
      "Group the module's exports by their consumers — each consumer cluster may indicate a natural split boundary.",
      'Verify that splitting along consumer boundaries reduces both inbound and outbound coupling.',
    ],
  },
  DIAG_DATA_CLUMP: {
    cause: 'The same group of parameters appears together across multiple function signatures, indicating a missing abstraction.',
    think: [
      'Determine whether the parameter group represents a coherent domain concept.',
      'Check whether introducing a type or interface to bundle them reduces parameter counts across all affected functions.',
      'If the parameters are coincidentally grouped, verify that no action is needed by confirming they vary independently.',
    ],
  },
  DIAG_SHOTGUN_SURGERY: {
    cause:
      'A single conceptual change requires modifications across many files, indicating the concept is scattered across the codebase.',
    think: [
      'Determine whether the scatter reflects an architectural choice (layered architecture naturally touches multiple layers) or accidental distribution.',
      'Check whether the same change type repeatedly touches the same file set.',
      'If files change together repeatedly, verify whether colocation or centralization of the shared aspect reduces the change set.',
    ],
  },
  DIAG_OVER_INDIRECTION: {
    cause:
      'Multiple forwarding layers exist with single-implementation interfaces, adding navigation cost without runtime variation.',
    think: [
      'Determine whether each abstraction layer serves a genuine purpose: dependency inversion for testing, plugin points, or architectural boundaries.',
      'Check whether any interface has only one implementation and no test double.',
      'If an abstraction does not earn its cost, verify that removing it does not break testability or future extensibility.',
    ],
  },
  DIAG_MIXED_ABSTRACTION: {
    cause:
      'A single function mixes high-level orchestration with low-level implementation detail, visible as large nesting depth variation within the function.',
    think: [
      'Identify which parts are orchestration (calling other functions, deciding what to do) and which are implementation (manipulating data, performing computations).',
      'Check whether the implementation details can be extracted into named helper functions.',
      'Verify that after extraction, the orchestrator reads as a sequence of high-level steps.',
    ],
  },

  TEMPORAL_COUPLING: {
    cause: 'Two or more operations must be called in a specific order, but this constraint is not expressed in the type system.',
    think: [
      'Determine whether the ordering constraint can be encoded in types (e.g., requiring the result of step A as input to step B).',
      'Check whether combining the steps into a single function eliminates the temporal dependency.',
      'If the constraint remains, verify that it is documented explicitly and validated at runtime if possible.',
    ],
  },
  SYMMETRY_BREAK: {
    cause:
      'Functions in the same group have inconsistent shapes — different parameter patterns, return types, or async modifiers — breaking expected symmetry.',
    think: [
      'Examine the outliers to determine whether their differences are intentional variations or accidental drift.',
      'If the differences represent distinct responsibilities, check whether renaming clarifies the distinct roles.',
      'If they should be uniform, verify that aligning them to the majority pattern does not break callers.',
    ],
  },
  VAR_LIFETIME: {
    cause:
      'A variable has a longer lifetime than necessary — it is declared far from its use or lives across multiple unrelated operations.',
    think: [
      'Determine the actual first read and last write of the variable.',
      'Check whether the variable can be introduced closer to its use or eliminated by restructuring the flow.',
      'Verify that reducing the lifetime does not break readability by scattering related declarations.',
    ],
  },
  IMPL_OVERHEAD: {
    cause:
      'A module or function has significantly more implementation complexity than its interface complexity suggests, hiding complexity from callers.',
    think: [
      'Determine whether the implementation complexity reflects an inherently hard problem or accidental complexity from poor structure.',
      'Identify which parts can be extracted, simplified, or replaced with existing utilities.',
      'Verify that high implementation-to-interface ratios indicate missing abstractions rather than genuinely dense logic.',
    ],
  },
  GIANT_FILE: {
    cause: 'A source file exceeds the line threshold, concentrating too many responsibilities in a single file.',
    think: [
      'Identify the distinct concerns within the file by grouping related functions, types, and constants by purpose.',
      'Check whether each cohesive group is a candidate for extraction into its own module.',
      'If the file resists decomposition, verify that tight coupling between its parts is the root cause and address that first.',
    ],
  },

  LINT: {
    cause: 'A lint rule violation was detected by the configured linter.',
    think: [
      'Review the specific lint rule that was violated and its rationale.',
      'Determine whether the violation reflects a genuine code quality issue or a misconfigured rule.',
      'If the rule does not apply to this context, verify that a targeted suppression with an explanatory comment is appropriate.',
    ],
  },
  FORMAT: {
    cause: 'A source file does not conform to the project formatting standard.',
    think: [
      'Determine whether the formatting difference is in hand-written source, generated code, or vendored files — generated and vendored files may legitimately diverge.',
      'Check whether the formatter is integrated into the development workflow (pre-commit hook or editor save action).',
      'If formatting conflicts recur, verify that the formatter configuration is consistent across the team.',
    ],
  },
  TYPECHECK: {
    cause: 'A TypeScript type error was detected during type checking.',
    think: [
      'Examine the type error message and the types involved to determine the mismatch.',
      'Determine whether the mismatch represents a genuine logic error or an overly strict type annotation.',
      'Verify whether the type error is local to one declaration or symptomatic of a structural mismatch between modules — repeated errors sharing the same root type suggest the contract itself is wrong, not individual call sites.',
    ],
  },
} satisfies Record<FirebatCatalogCode, CatalogEntry>;

const asArray = <T>(v: unknown): ReadonlyArray<T> => {
  return Array.isArray(v) ? (v as ReadonlyArray<T>) : [];
};

export const aggregateDiagnostics = (input: DiagnosticAggregatorInput): DiagnosticAggregatorOutput => {
  const catalog: Partial<Record<FirebatCatalogCode, CatalogEntry>> = {};
  const waste = asArray<any>(input.analyses['waste']);
  const nesting = asArray<any>(input.analyses['nesting']);
  const coupling = asArray<any>(input.analyses['coupling']);
  const dependencies = input.analyses['dependencies'] as any;

  // DIAG_GOD_FUNCTION: nesting(CC>=15) + waste co-occur in same file
  const hasHighCcInFile = new Set(
    nesting
      .filter((n: any) => n?.kind === 'high-cognitive-complexity')
      .map((n: any) => String(n?.file ?? n?.filePath ?? ''))
      .filter(Boolean),
  );
  const hasWasteInFile = new Set(waste.map((w: any) => String(w?.file ?? w?.filePath ?? '')).filter(Boolean));
  let godFunctionResolves = 0;

  for (const f of hasHighCcInFile) {
    if (hasWasteInFile.has(f)) {
      godFunctionResolves += waste.filter((w: any) => (w?.file ?? w?.filePath) === f).length;
    }
  }

  if (godFunctionResolves > 0) {
    const entry = FIREBAT_CODE_CATALOG.DIAG_GOD_FUNCTION;

    if (entry !== undefined) catalog.DIAG_GOD_FUNCTION = entry;
  }

  // DIAG_CIRCULAR_DEPENDENCY
  const cycles = Array.isArray(dependencies?.cycles) ? dependencies.cycles : [];

  if (cycles.length > 0) {
    const entry = FIREBAT_CODE_CATALOG.DIAG_CIRCULAR_DEPENDENCY;

    if (entry !== undefined) catalog.DIAG_CIRCULAR_DEPENDENCY = entry;
  }

  // DIAG_GOD_MODULE
  const godModules = coupling.filter((c: any) => c?.kind === 'god-module');

  if (godModules.length > 0) {
    const entry = FIREBAT_CODE_CATALOG.DIAG_GOD_MODULE;

    if (entry !== undefined) catalog.DIAG_GOD_MODULE = entry;
  }

  return { catalog };
};
