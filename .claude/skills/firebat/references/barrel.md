# barrel

Enforces barrel/index file policies. Detects export-star, deep imports bypassing barrels, missing index files, side-effect imports, and cross-module re-exports.

**Finding fields:** `kind, code, file, span, evidence`

<catalog>

## BARREL_EXPORT_STAR

**Cause:** An index file uses 'export *' which re-exports everything from a module, making the public surface implicit and unbounded.

<think>

1. Read the index file and list every symbol re-exported via `export *`. Grep each symbol to see if it is actually imported by any consumer. If all symbols are consumed, the wildcard is justified — **stop, no action needed**.
2. If unused or internal symbols are exposed, replace `export *` with explicit named re-exports for only the consumed symbols.
3. After converting, grep for any newly broken imports across the project and fix them.

</think>

## BARREL_DEEP_IMPORT

**Cause:** A consumer imports directly from a module's internal file, bypassing its barrel (index) entry point.

<think>

1. Read the module's barrel (index.ts). If the needed symbol is already exported there, update the consumer's import path to use the barrel instead of the deep path.
2. If the barrel does not export the needed symbol, add a named re-export for it in the barrel, then update the consumer import.
3. If the symbol is intentionally internal (not part of the public API), the consumer may need a different abstraction — flag for review rather than exposing it.

</think>

## BARREL_INDEX_DEEP_IMPORT

**Cause:** An index file itself imports from a deep path in another module instead of using that module's barrel.

<think>

1. Read the target module's barrel. If the needed symbol is already exported, change this index file's import to use the barrel path.
2. If the target barrel does not export the symbol, add it as a named re-export in the target barrel, then update this import.
3. After updating, grep for other files that deep-import from the same target path — they likely need the same fix.

</think>

## BARREL_MISSING_INDEX

**Cause:** A directory with multiple source files has no index.ts barrel file, leaving no single entry point for the module.

<think>

1. Grep for imports from individual files in this directory. If external consumers import from 2+ files, the directory is acting as a module and needs a barrel.
2. If only one file is imported externally, or files are independent utilities with no shared consumers, a barrel is unnecessary — **stop, no action needed**.
3. Create an index.ts with named re-exports for each symbol that external consumers currently import directly.

</think>

## BARREL_INVALID_INDEX_STMT

**Cause:** An index.ts contains statements other than export declarations (e.g., logic, variable declarations, side effects).

<think>

1. Read the index file and identify each non-export statement (variable declarations, function definitions, logic, side effects).
2. Move each piece of logic into a dedicated module file within the same directory. Add a named re-export in the index for any public symbols.
3. Grep for consumers that rely on the barrel import triggering side effects. If any exist, update them to import from the new dedicated module explicitly.

</think>

## BARREL_SIDE_EFFECT_IMPORT

**Cause:** A barrel file contains a side-effect import (import without specifiers), which executes code when the barrel is imported.

<think>

1. Read the side-effect import target to identify what it does (polyfill registration, global mutation, module augmentation).
2. If the side effect is required for the module to function, move it to an explicit setup file (e.g., `setup.ts`) and have consumers import it directly instead of relying on barrel import order.
3. If the side effect is not needed by any consumer, remove the import from the barrel.

</think>

## BARREL_CROSS_MODULE_REEXPORT

**Cause:** A file re-exports a symbol from outside its own module boundary, creating an unnecessary indirection layer.

<think>

1. Grep for all consumers of this re-export. Redirect each consumer to import directly from the original source module.
2. After redirecting all consumers, remove the re-export statement from this file.

</think>

</catalog>
