# dependencies

Analyzes dependency structure. Detects architecture layer violations, dead exports, test-only exports, unused files, unused/unlisted packages, unresolved imports, duplicate exports, and unused enum/namespace members.

**Finding fields:** `kind, code, file, span (+ type-specific fields)`

<catalog>

## DEP_LAYER_VIOLATION

**Cause:** A module imports from a layer that the architecture rules prohibit, breaking the intended dependency direction.

<think>

1. Read the import statement and identify which layers are involved (e.g., application importing from infrastructure). Check the architecture rules in CLAUDE.md or firebat config to confirm this is a violation.
2. If the imported symbol represents a capability (e.g., database access), create or use an existing port interface in the allowed layer and have the infrastructure implement it. Update the import to reference the port.
3. If the layer rules themselves are wrong (the dependency direction makes sense architecturally), update the firebat configuration rather than restructuring the code.

</think>

## DEP_DEAD_EXPORT

**Cause:** An exported symbol is not imported by any other module in the project, making the export unnecessary.

<think>

1. Grep for the symbol name across the entire project (including test files, scripts, and config files). If it is referenced anywhere outside this file, this is a false positive — **stop, no action needed**.
2. Check if the symbol is part of a public library API (listed in package.json exports or a public barrel). If so, it is consumed by external packages — **stop, no action needed**.
3. Remove the `export` keyword from the symbol declaration. If the symbol is also unused locally, delete it entirely.

</think>

## DEP_TEST_ONLY_EXPORT

**Cause:** An exported symbol is imported only by test files, meaning production code does not use it but the export exists for testability.

<think>

1. Read the test files that import this symbol. If they test the symbol directly (unit test of an internal function), consider whether the behavior can be tested through the public API instead.
2. If direct access is needed for testing, rename the export to use a `__testing__` prefix or move it to a `__testing__` named export block to signal its purpose.
3. If the symbol is a test utility (helper, factory, mock builder), move it to a test utility file instead of exporting from production code.

</think>

## DEP_UNUSED_FILE

**Cause:** A source file is not reachable from any entry point in the project, making it effectively dead code.

<think>

1. Grep for the file name (without extension) across the project to check for dynamic imports (`import()`, `require()`), worker references, or script entries not in package.json. If found, this is a false positive — **stop, no action needed**.
2. Check git log for this file. If it was recently created and is part of an in-progress feature, leave it. If the last meaningful change was before a major refactor, it is likely a leftover.
3. Delete the file. Run the build and tests to confirm nothing breaks.

</think>

## DEP_UNUSED_DEPENDENCY

**Cause:** A package listed in package.json dependencies is not imported anywhere in the project source code.

<think>

1. Grep for the package name in all config files (e.g., `.babelrc`, `postcss.config`, `jest.config`, `tsconfig.json`, build scripts). If it is used as a plugin, preset, or CLI tool, it is consumed indirectly — **stop, no action needed**.
2. Check if it is a peer dependency required by another installed package. Run `bun pm ls` or check `node_modules` to see if another package depends on it.
3. Remove the package from package.json and run `bun install`. Run the build and tests to confirm nothing breaks.

</think>

## DEP_UNLISTED_DEPENDENCY

**Cause:** A package is imported in source code but not declared in any dependency section of package.json.

<think>

1. Read the import statement. If the specifier is a typo or refers to a renamed/removed package, fix the import path.
2. If the package exists in node_modules via a transitive dependency, add it explicitly to package.json — transitive dependencies can disappear on updates. Use `dependencies` for runtime imports, `devDependencies` for build/test-only imports.

</think>

## DEP_UNRESOLVED_IMPORT

**Cause:** An import specifier in source code cannot be resolved to any file in the project.

<think>

1. Check if the target file was renamed or moved. Search for files with a similar name using glob patterns. If found, update the import path.
2. If the import uses path aliases (e.g., `@/utils`), check `tsconfig.json` paths configuration. If the alias is missing or misconfigured, fix it.
3. If the file was deleted intentionally, remove the import and any code that depends on the imported symbols.

</think>

## DEP_DUPLICATE_EXPORT

**Cause:** The same symbol name is exported from multiple files in the project, creating ambiguity for consumers.

<think>

1. Grep for all export sites of the symbol name. Read each one to determine if they are the same implementation (copy-paste) or different implementations sharing a name.
2. If they are copies, choose one canonical source file and update all consumers to import from it. Delete the duplicate export from the other file.
3. If they are different implementations, rename one to disambiguate (e.g., `parseJSON` vs `parseXML` instead of both being `parse`).

</think>

## DEP_UNUSED_ENUM_MEMBER

**Cause:** An exported enum member is never referenced by any consumer in the project.

<think>

1. Grep for the enum member name (e.g., `MyEnum.MemberName` and `MemberName`) across the project. Also search for dynamic access patterns like `MyEnum[variable]`. If found, this is a false positive — **stop, no action needed**.
2. Check if the enum maps to an external contract (API response codes, database status values). If so, the member must exist for completeness — **stop, no action needed**.
3. Remove the unused enum member. Run the type checker to catch any references that static search missed.

</think>

## DEP_UNUSED_NS_EXPORT

**Cause:** A module export is not accessed through the namespace import that brings in the module.

<think>

1. Grep for the export name as a standalone named import (e.g., `import { symbolName } from ...`) in other files. If it is imported directly elsewhere, the namespace import is not the only consumer — **stop, no action needed**.
2. If the export is truly unused everywhere, remove the `export` keyword. If the symbol is also unused locally, delete it.

</think>

## DEP_UNUSED_NS_MEMBER

**Cause:** A TypeScript namespace member is exported but never referenced outside the namespace.

<think>

1. Grep for the namespace member name across the project (e.g., `Namespace.MemberName`). Also check for computed property access patterns. If found, this is a false positive — **stop, no action needed**.
2. If the namespace is part of a public API consumed by external packages, the member may be needed for completeness — **stop, no action needed**.
3. Remove the member from the namespace. If the namespace becomes empty, consider removing the namespace entirely and converting remaining members to module-level exports.

</think>

</catalog>
