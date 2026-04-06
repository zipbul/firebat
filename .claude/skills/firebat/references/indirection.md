# indirection

Detects unnecessary indirection layers. Finds thin wrappers (functions that only delegate), forward chains, cross-file chains, type remaps (synonym type aliases), and interface rewraps (empty interface extensions).

**Finding fields:** `kind, code, file, span, functionHeader`

<catalog>

## IND_THIN_WRAPPER

**Cause:** A function's entire body delegates to another function with identical or trivially transformed arguments, adding no logic.

<think>

1. Read the wrapper function body. If it contains any logic beyond delegation (branching, error handling, argument transformation, logging), this is a false positive — **stop, no action needed**.
2. Grep for all call sites of the wrapper function name across the project. If callers exist in test files that mock or spy on this wrapper specifically, the wrapper serves a test isolation purpose — **stop, no action needed**.
3. Replace all caller references with direct calls to the target function. Update imports in every affected file, then delete the wrapper.

</think>

## IND_FORWARD_CHAIN

**Cause:** Multiple functions form a chain where each forwards to the next with no added logic, creating unnecessary depth.

<think>

1. Read each function in the chain from first to last. Identify where real logic begins — the function that does more than forward arguments is the true entry point.
2. Grep for imports of each intermediate function. If an intermediate function is imported by external consumers (not just the next link), it serves as a public API boundary — **stop, no action needed** for that link.
3. Redirect all callers of the chain entry to call the true entry point directly. Remove each intermediate function that has zero remaining callers after redirection.

</think>

## IND_CROSS_FILE_CHAIN

**Cause:** A forwarding chain spans multiple files, creating cross-file indirection without logic at each hop.

<think>

1. Read each file in the chain. If a file boundary aligns with a layer in the architecture (e.g., adapter → application → engine), the hop is intentional — **stop, no action needed** for that hop.
2. Grep for imports of each intermediate file from outside the chain. If other consumers import from an intermediate file, it is a public surface that must remain.
3. For hops that have no external consumers and no architectural justification, redirect the upstream import to the downstream file and delete the intermediate re-export.

</think>

## IND_TYPE_REMAP

**Cause:** A type alias is a direct synonym for another named type, adding no type-level transformation.

<think>

1. Read the alias definition. If it shortens a deeply qualified namespace path (e.g., `type Node = ts.Node`), check the project convention — if namespace access is standard, the alias is justified — **stop, no action needed**.
2. Grep for all usages of the alias name across the project. Note each file and line that references it.
3. Replace every usage with the original type name, update imports, and delete the alias declaration. Run the type checker to confirm no breakage.

</think>

## IND_INTERFACE_REWRAP

**Cause:** An interface extends another type but declares no additional members, making it a pure synonym.

<think>

1. Grep for the interface name across the entire project. If another file adds members to this interface via declaration merging (re-declaring the same interface name with additional fields), it is intentional — **stop, no action needed**.
2. If this interface is part of a plugin or extension API where consumers are expected to augment it, keep it — **stop, no action needed**.
3. Replace all usages of the interface with the base type, update imports, and delete the interface declaration.

</think>

</catalog>
