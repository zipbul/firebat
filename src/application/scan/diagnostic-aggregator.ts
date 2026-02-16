interface DiagnosticAggregatorInput {
  readonly analyses: Readonly<Record<string, unknown>>;
}

interface Priority {
  readonly pattern: string;
  readonly detector: string;
  readonly resolves: number;
}

interface CodeEntry {
  readonly cause: string;
  readonly approach: string;
}

interface DiagnosticAggregatorOutput {
  readonly top: ReadonlyArray<Priority>;
  readonly catalog: Readonly<Record<string, CodeEntry>>;
}

export const FIREBAT_CODE_CATALOG: Readonly<Record<string, CodeEntry>> = {
  WASTE_DEAD_STORE: {
    cause: 'A value is assigned to a variable but is overwritten or goes out of scope before being read.',
    approach:
      "Determine why this assignment became unnecessary. Possible root causes: leftover from a refactor, logic change that bypassed this path, or a control-flow design error. If multiple dead stores appear in the same function, examine the function's responsibilities and flow rather than individual assignments.",
  },
  WASTE_DEAD_STORE_OVERWRITE: {
    cause: 'A variable is assigned, then unconditionally reassigned before the first value is ever read.',
    approach:
      'Identify whether the first assignment once had a purpose. It may be a remnant of removed branching, a copy-paste artifact, or a misunderstanding of the variable\'s lifecycle. If this pattern repeats across a function, the function may be accumulating unrelated setup steps that should be separated.',
  },
  WASTE_MEMORY_RETENTION: {
    cause:
      'A large object or collection is captured in a closure or long-lived scope and remains reachable after its logical use ends.',
    approach:
      'Investigate why the reference persists. The closure may capture more than it needs, or the variable\'s scope may be unnecessarily broad. Consider whether the value can be passed as a parameter instead of captured, or whether the lifetime can be shortened by restructuring the enclosing scope.',
  },

  NOOP_EXPRESSION: {
    cause: 'An expression is evaluated but its result is discarded and it produces no side effects.',
    approach:
      'Determine the original intent of this expression. It may be a debugging artifact, incomplete code, or a misunderstanding of an API\'s return behavior. If it was meant to have a side effect, the API contract should be verified.',
  },
  NOOP_SELF_ASSIGNMENT: {
    cause: 'A variable is assigned to itself, producing no state change.',
    approach:
      'This is usually a typo or copy-paste error. Check whether a different target variable was intended, or whether this was meant to trigger a setter or reactivity system that requires explicit assignment.',
  },
  NOOP_CONSTANT_CONDITION: {
    cause: 'A conditional expression always evaluates to the same boolean value, making one branch unreachable.',
    approach:
      'Determine whether the condition was once dynamic and became constant after a refactor, or whether it guards code that is not yet implemented. If the constant branch is intentional (feature flag, debug mode), make it explicit via a named constant or config.',
  },
  NOOP_EMPTY_CATCH: {
    cause: 'A catch block is empty, silently swallowing errors.',
    approach:
      'Determine whether the error is intentionally ignored or accidentally suppressed. If intentional, add a comment explaining why. If accidental, the missing error handling may mask failures in production. Check whether the same pattern exists in related catch blocks — systematic silent catches suggest a missing error-handling strategy.',
  },
  NOOP_EMPTY_FUNCTION_BODY: {
    cause: 'A function or method has an empty body, performing no operation.',
    approach:
      "Determine whether this is a placeholder, a no-op callback, or unfinished implementation. If it serves as a default no-op (e.g., event handler stub), the intent should be explicit via naming (e.g., 'noop') or a comment. If it appears in a class, it may indicate an interface method that should be abstract instead.",
  },

  FWD_THIN_WRAPPER: {
    cause:
      "A function's entire body delegates to another function with identical or trivially transformed arguments, adding no logic.",
    approach:
      'Determine whether this wrapper serves an intentional purpose: dependency inversion, future extension point, or API stability boundary. If none apply, the indirection increases navigation cost for agents without adding value. Consider whether callers can reference the target directly.',
  },
  FWD_FORWARD_CHAIN: {
    cause: 'Multiple functions form a chain where each forwards to the next with no added logic, creating unnecessary depth.',
    approach:
      'Trace the chain to find where real logic begins. The intermediate links may be remnants of refactoring or over-abstracted layers. If the chain crosses module boundaries, evaluate whether the abstraction layers are justified by actual variation or just ceremony.',
  },
  FWD_CROSS_FILE_CHAIN: {
    cause: 'A forwarding chain spans multiple files, creating cross-file indirection without logic at each hop.',
    approach:
      'Cross-file forwarding amplifies navigation cost — an agent must open multiple files to find the real implementation. Determine whether each file boundary represents a genuine architectural concern. If the chain follows a re-export pattern, consolidating the public surface may eliminate intermediate hops.',
  },

  BARREL_EXPORT_STAR: {
    cause:
      "An index file uses 'export *' which re-exports everything from a module, making the public surface implicit and unbounded.",
    approach:
      "Determine whether all re-exported symbols are intentionally public. 'export *' prevents controlling the public API surface and can inadvertently expose internal implementation details. If only a subset should be public, switch to named re-exports.",
  },
  BARREL_DEEP_IMPORT: {
    cause: "A consumer imports directly from a module's internal file, bypassing its barrel (index) entry point.",
    approach:
      'Check whether the barrel file exists and exposes the needed symbol. If it does, the deep import may be a convenience shortcut that undermines encapsulation. If the barrel does not expose the symbol, determine whether it should be added to the public surface or if the consumer\'s need indicates a missing abstraction.',
  },
  BARREL_INDEX_DEEP_IMPORT: {
    cause: "An index file itself imports from a deep path in another module instead of using that module's barrel.",
    approach:
      "This creates a transitive deep-import dependency at the barrel level. Determine whether the target module's barrel is incomplete or whether this index file is taking a shortcut. The fix direction depends on whether the target module should expose the symbol publicly.",
  },
  BARREL_MISSING_INDEX: {
    cause:
      'A directory with multiple source files has no index.ts barrel file, leaving no single entry point for the module.',
    approach:
      'Evaluate whether the directory represents a cohesive module that should have a public surface. If it does, a barrel file defines and controls what is exported. If files are independent utilities, a barrel may not be needed — but the directory structure should then reflect that they are not a module.',
  },
  BARREL_INVALID_INDEX_STMT: {
    cause:
      'An index.ts contains statements other than export declarations (e.g., logic, variable declarations, side effects).',
    approach:
      'Barrel files should be pure re-export surfaces. Logic in an index file is invisible to consumers who expect it to be a passthrough. Determine whether the logic belongs in a dedicated module file that the barrel re-exports.',
  },
  BARREL_SIDE_EFFECT_IMPORT: {
    cause:
      'A barrel file contains a side-effect import (import without specifiers), which executes code when the barrel is imported.',
    approach:
      "Side-effect imports in barrels make the import graph impure — importing the barrel triggers hidden execution. Determine whether the side effect is intentional (e.g., polyfill registration) and if so, whether it should be isolated into an explicit setup module rather than hiding in a barrel.",
  },

  EH_THROW_NON_ERROR: {
    cause:
      'A throw statement throws a value that is not an Error instance, losing stack trace and error chain capabilities.',
    approach:
      'Determine what type is being thrown and why. Throwing strings or plain objects is often a shortcut that breaks error handling patterns downstream. If the thrown value carries domain information, wrap it in a custom Error subclass.',
  },
  EH_ASYNC_PROMISE_EXECUTOR: {
    cause:
      'A Promise constructor receives an async executor function, which can silently swallow rejections from awaited expressions.',
    approach:
      'Identify why the Promise constructor is used with async. Usually the code can be refactored to an async function directly. If the Promise wraps a callback API, the async keyword in the executor is likely accidental.',
  },
  EH_MISSING_ERROR_CAUSE: {
    cause:
      "A caught error is re-thrown or wrapped without preserving the original error via the 'cause' option, breaking the error chain.",
    approach:
      "Determine whether the original error's context is needed for debugging. If wrapping in a new error, pass { cause: originalError } to preserve the chain. If re-throwing directly, 'cause' is not needed.",
  },
  EH_USELESS_CATCH: {
    cause:
      'A catch block catches an error and immediately re-throws it without transformation, making the try-catch pointless.',
    approach:
      'Determine whether the catch was intended to add logging, transformation, or handling that was never implemented. If the try-catch serves no purpose, removing it reduces indentation and noise. If it once had purpose, investigate what changed.',
  },
  EH_UNSAFE_FINALLY: {
    cause:
      'A finally block contains a throw or return statement that can override the try/catch result, silently discarding errors.',
    approach:
      'Determine whether the throw/return in finally is intentional. In most cases it masks the original error. The finally block should contain only cleanup logic (close connections, release resources) that cannot fail or affect control flow.',
  },
  EH_RETURN_IN_FINALLY: {
    cause:
      'A finally block contains a return statement that will override any return or throw from the try/catch blocks.',
    approach:
      'This is almost always a bug — the finally return silently replaces whatever the try or catch produced. Move the return to the try block and ensure finally only performs cleanup.',
  },
  EH_CATCH_OR_RETURN: {
    cause:
      "A Promise chain has .then() without a .catch() or the result is not returned/awaited, leaving rejections unhandled.",
    approach:
      "Determine whether the Promise rejection is intentionally ignored or accidentally unhandled. If the code is in an async function, 'await' captures rejections naturally. If using .then(), add .catch() or return the chain for the caller to handle.",
  },
  EH_PREFER_CATCH: {
    cause:
      'Error handling uses .then(onFulfilled, onRejected) instead of .catch(), which is less readable and can miss errors thrown in onFulfilled.',
    approach:
      'The two-argument .then() form does not catch errors thrown inside the onFulfilled callback. Determine whether this is intentional. In most cases, replacing with .then().catch() provides more predictable error coverage.',
  },
  EH_PREFER_AWAIT_TO_THEN: {
    cause:
      'Promise chains use .then()/.catch() inside an async function instead of await, reducing readability and error flow clarity.',
    approach:
      'In async functions, await provides clearer control flow and automatic error propagation via try-catch. Determine whether the .then() chain has a specific reason (parallel execution, chaining) or is just a style inconsistency.',
  },
  EH_FLOATING_PROMISES: {
    cause:
      'A Promise is created but not awaited, returned, or stored, so its rejection will be silently lost.',
    approach:
      "Determine whether the fire-and-forget is intentional. If the Promise's result or error matters, await or return it. If truly fire-and-forget, add void prefix and ensure errors are handled inside the called function.",
  },
  EH_MISUSED_PROMISES: {
    cause:
      'A Promise is used in a context that expects a synchronous value (e.g., array.forEach callback, conditional expression), leading to always-truthy checks or ignored results.',
    approach:
      'Determine what the code expected to happen. forEach does not await returned Promises. Boolean checks on Promises are always true. Replace with for-of + await, or restructure the logic to properly handle asynchronous values.',
  },
  EH_RETURN_AWAIT_POLICY: {
    cause:
      "An async function returns await expression unnecessarily (or vice versa: should use return-await inside try blocks to catch errors properly).",
    approach:
      "In a try block, 'return await' is needed to catch rejections. Outside try blocks, 'return await' adds an unnecessary microtask tick. Determine the context: inside try → keep await, outside try → remove await.",
  },
  EH_SILENT_CATCH: {
    cause: 'A catch block suppresses the error without logging, rethrowing, or handling it in any visible way.',
    approach:
      'Determine whether the error suppression is intentional. If so, document why. If not, the silent catch may mask failures. Check whether the same pattern exists in related error handlers — systematic silent catches suggest a missing error-handling strategy across the module.',
  },
  EH_CATCH_TRANSFORM: {
    cause:
      'A catch block modifies the error object or its message before rethrowing, potentially losing original error information.',
    approach:
      'Determine whether the transformation preserves the error chain (cause property). If the message is altered, the original stack trace should still be accessible. If the error type is changed, downstream handlers may not recognize it.',
  },
  EH_REDUNDANT_NESTED_CATCH: {
    cause:
      'A try-catch is nested inside another try-catch that already handles the same error types, creating redundant handling.',
    approach:
      'Determine whether the inner catch handles a specific error differently from the outer catch. If not, the nesting adds complexity without value. If the inner catch does transform errors, verify that the outer catch expects transformed errors.',
  },
  EH_OVERSCOPED_TRY: {
    cause:
      'A try block wraps significantly more code than the statements that can actually throw, obscuring which operation the catch is protecting.',
    approach:
      'Identify which statements within the try block can actually throw. Narrowing the try block makes the error source explicit. If multiple throwing statements are wrapped, determine whether they share error handling logic or whether each needs distinct handling.',
  },
  EH_EXCEPTION_CONTROL_FLOW: {
    cause:
      'Exceptions are used for normal control flow (e.g., throwing to break out of a loop or signal a condition), not for error signaling.',
    approach:
      'Determine whether the thrown value represents an actual error condition. Using exceptions for control flow is expensive, obscures intent, and confuses downstream error handlers. Replace with return values, result types, or explicit control flow constructs.',
  },

  UNKNOWN_TYPE_ASSERTION: {
    cause: 'A type assertion (as T) bypasses the type checker, asserting a type without runtime validation.',
    approach:
      'Determine whether the assertion is backed by a runtime check earlier in the code path. If no check exists, the assertion is a lie to the compiler that will surface as a runtime error. Consider using a type guard function or schema validation instead.',
  },
  UNKNOWN_DOUBLE_ASSERTION: {
    cause:
      'A double type assertion (as unknown as T) forces an unsafe type cast through the unknown escape hatch.',
    approach:
      'Double assertions are almost always a sign that the type system is being fought. Determine why the direct assertion fails — it usually means the types are fundamentally incompatible. This indicates either a design mismatch or missing intermediate transformation.',
  },
  UNKNOWN_UNNARROWED: {
    cause:
      "A value of type 'unknown' is used without narrowing, meaning no runtime type check guards the access.",
    approach:
      'Determine where the unknown value originates (external input, catch clause, generic parameter). Add appropriate narrowing: typeof guard, instanceof check, or schema validation. If the value crosses a trust boundary, validation should be at the boundary, not at each usage.',
  },
  UNKNOWN_UNVALIDATED: {
    cause:
      "An 'unknown' value from a trust boundary (API input, file read, deserialization) is used without schema validation.",
    approach:
      'Boundary values should be validated once at entry. Determine whether a validation layer exists and this usage bypasses it, or whether no validation layer exists yet. If the pattern repeats across multiple boundaries, a shared validation strategy is needed rather than ad-hoc checks.',
  },
  UNKNOWN_INFERRED: {
    cause:
      "TypeScript infers 'unknown' for a value where a more specific type was likely intended.",
    approach:
      'Determine what type the value should have. The inference may result from a missing return type annotation, an untyped dependency, or a generic function with insufficient type constraints. Adding an explicit type annotation makes the intent clear and catches mismatches earlier.',
  },
  UNKNOWN_ANY_INFERRED: {
    cause:
      "TypeScript infers 'any' for a value, disabling type checking for all downstream usage.",
    approach:
      "Determine the source of the 'any' inference: untyped import, missing type parameter, JSON.parse result, or catch clause. Each source has a different fix. If 'any' propagates widely, trace it to the root and add a type there — fixing downstream usage is ineffective while the source remains untyped.",
  },

  DEP_LAYER_VIOLATION: {
    cause:
      'A module imports from a layer that the architecture rules prohibit, breaking the intended dependency direction.',
    approach:
      'Determine whether the import represents a genuine architectural violation or an inaccurate layer definition. If the import is needed, it may indicate that the layer boundary is drawn incorrectly, or that the imported symbol should be exposed through an allowed layer (e.g., via a port interface).',
  },
  DEP_DEAD_EXPORT: {
    cause:
      'An exported symbol is not imported by any other module in the project, making the export unnecessary.',
    approach:
      'Determine whether the export is unused because it is obsolete, or because it serves an external consumer not visible to static analysis (CLI entry, test helper, library public API). If truly unused, removing it reduces the module\'s public surface. If externally consumed, mark it explicitly.',
  },
  DEP_TEST_ONLY_EXPORT: {
    cause:
      'An exported symbol is imported only by test files, meaning production code does not use it but the export exists for testability.',
    approach:
      'Determine whether the symbol should be internal (unexported, tested via public API) or whether it represents a testing concern that should live in a test utility module. Exporting symbols solely for tests increases the production public surface and can mislead consumers.',
  },

  NESTING_DEEP: {
    cause:
      'A function has deeply nested control structures, increasing indentation and making the execution path hard to follow.',
    approach:
      'Determine why nesting accumulated. Possible causes: multiple concerns interleaved in one function, missing early-return guards, or error paths mixed with happy paths. If other findings (waste, coupling) co-occur in the same function, the nesting is likely a symptom of the function doing too much.',
  },
  NESTING_HIGH_CC: {
    cause:
      'A function has high cognitive complexity, meaning it contains many interacting control-flow decisions.',
    approach:
      'High cognitive complexity means the function requires significant mental effort to trace. Determine which decision axes are independent — independent axes can be extracted into separate functions. If the complexity stems from validation logic, consider a declarative validation approach rather than nested conditionals.',
  },
  NESTING_ACCIDENTAL_QUADRATIC: {
    cause: 'A nested loop or iteration pattern creates O(n²) complexity that may not be intentional.',
    approach:
      'Determine whether the quadratic behavior is inherent to the problem or accidental. Common accidental patterns: array.includes() inside a loop (use a Set), nested find/filter, repeated linear scans. If quadratic is inherent, document the expected input size and why it is acceptable.',
  },
  NESTING_CALLBACK_DEPTH: {
    cause:
      'A function contains deeply nested callback chains (depth ≥ 3), making control flow hard to follow and error handling fragile.',
    approach:
      'Determine whether the nesting reflects genuine sequential async steps or structural accumulation. If callbacks are chained for sequencing, async/await flattens the structure. If callbacks are nested for event handling, consider extracting each level into a named function to make the flow explicit.',
  },

  EARLY_RETURN_INVERTIBLE: {
    cause:
      'An if-else structure has a short branch (≤3 statements) ending in return/throw and a long branch, which can be inverted to reduce nesting.',
    approach:
      "Determine whether inverting the condition and returning early would improve readability. The short branch typically handles an edge case or error condition. If the pattern repeats across the function, the function may be processing multiple concerns sequentially — each concern's guard becomes a natural early return.",
  },
  EARLY_RETURN_MISSING_GUARD: {
    cause:
      'A function lacks guard clauses at the top, pushing the main logic into nested conditionals.',
    approach:
      'Identify which conditions at the start of the function check preconditions or special cases. Moving these to guard clauses (return/throw early) flattens the main logic. If preconditions are complex, they may warrant extraction into a validation function.',
  },

  COUPLING_GOD_MODULE: {
    cause:
      'A module has both high fan-in and high fan-out, meaning many modules depend on it and it depends on many modules.',
    approach:
      'Determine which responsibilities this module holds that attract so many dependents. A god module often accumulates shared utilities, configuration, and domain logic. Identify clusters of related imports/exports — each cluster may form a cohesive module if extracted.',
  },
  COUPLING_BIDIRECTIONAL: {
    cause:
      'Two modules import from each other, creating a circular dependency that prevents independent reasoning about either.',
    approach:
      'Determine which direction is primary and which is incidental. Often one direction represents a callback or event registration that can be inverted via dependency injection or an event bus. If both directions are essential, the two modules may logically be one module split incorrectly.',
  },
  COUPLING_OFF_MAIN_SEQ: {
    cause:
      "A module's instability-abstractness balance places it far from the main sequence, indicating it is either too abstract for its stability or too concrete for how many depend on it.",
    approach:
      'Determine whether the module should be more abstract (add interfaces/contracts) or less depended-upon (reduce fan-in by splitting). High-distance modules are the hardest to change correctly because their position creates conflicting forces.',
  },
  COUPLING_UNSTABLE: {
    cause:
      'A module has high instability (many outgoing dependencies, few incoming) and high fan-out, making it sensitive to changes in its dependencies.',
    approach:
      'Determine whether the high fan-out is essential or whether the module can depend on fewer abstractions. If it consumes many concrete implementations, introducing port interfaces can isolate it from change. If the module is a thin orchestrator, instability may be acceptable by design.',
  },
  COUPLING_RIGID: {
    cause:
      'A module has very low instability (many dependents, few dependencies) and high fan-in, making it extremely costly to change.',
    approach:
      'Determine whether the module\'s interface is stable by design (it should be) or frozen by accident (too many dependents accumulated). If the interface needs to evolve, consider versioning, adapter layers, or extracting the stable subset into a separate module.',
  },

  API_DRIFT_SIGNATURE: {
    cause:
      'Functions with the same name pattern have inconsistent signatures (different parameter counts, optional parameter usage, return types, or async modifiers).',
    approach:
      'Determine whether the signature differences are intentional variations or drift from a common pattern. If the functions serve the same role in different contexts, their signatures should align. If they serve different roles, their names should differentiate them instead of sharing a misleading prefix.',
  },

  EXACT_DUP_TYPE_1: {
    cause:
      'Two or more code blocks are character-for-character identical (Type-1 clone), indicating copy-paste duplication.',
    approach:
      'Determine whether the duplication was intentional (e.g., generated code, test fixtures with identical structure) or accidental. If the blocks should stay in sync, extract a shared function. If they are expected to diverge, document why they are separate despite current identity.',
  },
  STRUCT_DUP_TYPE_2_SHAPE: {
    cause:
      'Two or more code blocks have identical structure but differ only in identifier names (Type-2 clone), suggesting parameterizable logic.',
    approach:
      "Examine the differences between clones — the differing identifiers are candidate parameters for a shared function. If the differences represent domain concepts (e.g., 'user' vs 'order'), the shared function should accept the concept as a parameter or generic type.",
  },
  STRUCT_DUP_TYPE_3_NORMALIZED: {
    cause:
      'Two or more code blocks have the same normalized structure after removing cosmetic differences (Type-3 clone), indicating similar but not identical logic.',
    approach:
      'The normalization reveals that these blocks solve the same structural problem with minor variations. Determine what the variations represent: different data types, different error handling, or different business rules. The appropriate abstraction depends on the nature of the variation.',
  },

  DIAG_GOD_FUNCTION: {
    cause:
      'A single function triggers multiple finding types simultaneously (nesting + waste, or responsibility-boundary), indicating it handles multiple independent concerns.',
    approach:
      'Determine how many independent concerns this function handles by examining variable clusters. If variables form distinct groups that do not interact, each group likely represents a separable concern. Individual findings (nesting, waste) are symptoms — the root cause is responsibility overload.',
  },
  DIAG_CIRCULAR_DEPENDENCY: {
    cause:
      'A group of modules form a dependency cycle, making it impossible to understand or modify any one module in isolation.',
    approach:
      "Identify the weakest link in the cycle — the import that contributes least to the module's core purpose. Breaking cycles often requires introducing an interface at the boundary or moving shared types to a neutral location. If the cycle involves only two modules, they may need to merge.",
  },
  DIAG_GOD_MODULE: {
    cause:
      'A module acts as a hub with excessive fan-in and fan-out, coupling a large portion of the codebase through one point.',
    approach:
      "Analyze what responsibilities attract dependencies to this module. Common culprits: shared configuration, utility mixtures, domain model + logic in one place. Group the module's exports by their consumers — each consumer cluster may indicate a natural split boundary.",
  },
  DIAG_DATA_CLUMP: {
    cause: 'The same group of parameters appears together across multiple function signatures, indicating a missing abstraction.',
    approach:
      'Determine whether the parameter group represents a coherent domain concept. If so, introduce a type/interface to bundle them. This reduces parameter counts across all affected functions and makes the concept explicit. If the parameters are coincidentally grouped, no action is needed.',
  },
  DIAG_SHOTGUN_SURGERY: {
    cause:
      'A single conceptual change requires modifications across many files, indicating the concept is scattered across the codebase.',
    approach:
      'Determine whether the scatter reflects an architectural choice (e.g., layered architecture naturally touches multiple layers) or accidental distribution. If the same change type repeatedly touches the same file set, those files should be colocated or the shared aspect should be centralized.',
  },
  DIAG_OVER_INDIRECTION: {
    cause:
      'Multiple forwarding layers exist with single-implementation interfaces, adding navigation cost without runtime variation.',
    approach:
      'Determine whether each abstraction layer serves a genuine purpose: dependency inversion for testing, plugin points for actual extensions, or architectural boundaries. If an interface has only one implementation and no test double, the abstraction may not earn its cost.',
  },
  DIAG_MIXED_ABSTRACTION: {
    cause:
      'A single function mixes high-level orchestration with low-level implementation detail, visible as large nesting depth variation within the function.',
    approach:
      'Identify which parts are orchestration (calling other functions, deciding what to do) and which are implementation (manipulating data, performing computations). Extract the implementation detail into named helper functions so the orchestrator reads as a sequence of high-level steps.',
  },
};

const asArray = <T>(v: unknown): ReadonlyArray<T> => {
  return Array.isArray(v) ? (v as ReadonlyArray<T>) : [];
};

export const aggregateDiagnostics = (input: DiagnosticAggregatorInput): DiagnosticAggregatorOutput => {
  const top: Priority[] = [];
  const catalog: Record<string, CodeEntry> = {};

  const waste = asArray<any>(input.analyses['waste']);
  const nesting = asArray<any>(input.analyses['nesting']);
  const coupling = asArray<any>(input.analyses['coupling']);
  const dependencies = input.analyses['dependencies'] as any;

  // Phase 0: DIAG_GOD_FUNCTION
  // Condition (IMPROVE.md): same function has nesting(CC>=15) + waste co-occur.
  // For Phase 0 implementation, we approximate by: any HIGH_CC nesting item exists AND any waste exists in same file.
  const hasHighCcInFile = new Set(
    nesting
      .filter((n: any) => n?.kind === 'high-cognitive-complexity')
      .map((n: any) => String(n?.file ?? n?.filePath ?? ''))
      .filter(Boolean),
  );
  const hasWasteInFile = new Set(
    waste.map((w: any) => String(w?.file ?? w?.filePath ?? '')).filter(Boolean),
  );
  let godFunctionResolves = 0;

  for (const f of hasHighCcInFile) {
    if (hasWasteInFile.has(f)) {
      godFunctionResolves += waste.filter((w: any) => (w?.file ?? w?.filePath) === f).length;
    }
  }

  if (godFunctionResolves > 0) {
    top.push({ pattern: 'DIAG_GOD_FUNCTION', detector: 'diagnostic-aggregator', resolves: godFunctionResolves });
    catalog.DIAG_GOD_FUNCTION = FIREBAT_CODE_CATALOG['DIAG_GOD_FUNCTION'] as CodeEntry;
  }

  // Phase 0: DIAG_CIRCULAR_DEPENDENCY
  const cycles = Array.isArray(dependencies?.cycles) ? dependencies.cycles : [];
  if (cycles.length > 0) {
    top.push({ pattern: 'DIAG_CIRCULAR_DEPENDENCY', detector: 'diagnostic-aggregator', resolves: cycles.length });
    catalog.DIAG_CIRCULAR_DEPENDENCY = FIREBAT_CODE_CATALOG['DIAG_CIRCULAR_DEPENDENCY'] as CodeEntry;
  }

  // Phase 0: DIAG_GOD_MODULE
  const godModules = coupling.filter((c: any) => c?.kind === 'god-module');
  if (godModules.length > 0) {
    top.push({ pattern: 'DIAG_GOD_MODULE', detector: 'diagnostic-aggregator', resolves: godModules.length });
    catalog.DIAG_GOD_MODULE = FIREBAT_CODE_CATALOG['DIAG_GOD_MODULE'] as CodeEntry;
  }

  top.sort((a, b) => b.resolves - a.resolves);

  return { top, catalog };
};
