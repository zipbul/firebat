# barrel

Under a user-declared directory-surface policy (`features.barrel`), enforces that every directory is a nested module whose public surface is its single `index.ts`. Detects `export *`, deep imports that bypass a directory's surface, directories with unmet consumption demand and no surface, non-conforming index.ts statements, and cross-module re-exports. Fully inactive when the policy is not declared (opt-in, same pattern as layer-violation).

**Finding fields:** `kind, code, file, span, evidence`

<catalog>

## BARREL_EXPORT_STAR

**Cause:** A file uses bare `export * from` which re-exports everything from a module, making the public surface implicit and unbounded.

<think>

1. Enumerate every symbol re-exported via `export *` (read the origin module or grep its exports) and convert the statement into explicit named re-exports (`export { … } from`) listing each one.
2. If a single namespace name is intended instead of individually-flattened symbols, use `export * as ns from` (exempt from this finding) instead of the bare wildcard.
3. Never leave the bare `export *` in place — the surface must become either an explicit named re-export list or a single namespace re-export. After converting, grep for any newly broken imports across the project and fix them.

</think>

## BARREL_DEEP_IMPORT

**Cause:** A consumer imports directly from a module's internal file, bypassing its barrel (index) entry point.

<think>

1. Read the module's barrel (index.ts). If the needed symbol is already exported there, route the import through the directory surface instead of the deep path.
2. If the barrel does not export the needed symbol, add a named re-export for it in the barrel, then update the consumer import to use the surface.
3. If routing through the surface creates a value cycle, fix it with `import type` (if only the type is needed), extracting the shared symbol into its own module, or merging the two modules — never restore the deep import.

</think>

## BARREL_MISSING_INDEX

**Cause:** A directory has outside-subtree consumption demand (at least one import resolves into it) but no index.ts barrel file, so that demand has no single entry point.

<think>

1. Grep for imports from individual files in this directory to confirm the demand this finding reports — every finding here already has at least one outside-subtree consumer (demand-driven: a directory with zero demand is never flagged).
2. Create an index.ts with named re-exports for each symbol that outside-subtree consumers currently import directly, and update those imports to go through the new surface.
3. If the directory is not meant to be a module boundary at all, merge its files into the consuming directory or the nearest existing module instead of adding a barrel.

</think>

## BARREL_INVALID_INDEX_STMT

**Cause:** An index.ts contains a statement that is not a named re-export form — including logic, variable/side-effect declarations, and any import (an index file's surface consists only of `export {…} from` / `export type {…} from` / `export * as ns from` statements).

<think>

1. Read the index file and identify each non-conforming statement (imports, variable declarations, function/class definitions, side effects).
2. Move each piece of logic (and any import it needs) into a dedicated module file within the same directory. Add a named re-export in the index for any symbol that must stay public.
3. Grep for consumers that rely on the barrel import triggering side effects. If any exist, update them to import from the new dedicated module explicitly.

</think>

## BARREL_CROSS_MODULE_REEXPORT

**Cause:** A file re-exports a symbol whose origin resolves outside its own directory subtree, creating an unnecessary indirection layer.

<think>

1. Grep for all consumers of this re-export and redirect each one to the origin module's own public surface (its barrel) — never import the internal file directly.
2. If the origin belongs conceptually to this subtree, move it here instead of re-exporting it from afar.
3. After redirecting all consumers (or moving the origin), remove the re-export statement from this file.

</think>

</catalog>

## Semantics (post-surgery)

- **Edge classes are separate.** `deep-import` and missing-index demand consider only `ImportDeclaration` edges (any `importKind`, including `import type`). `ExportNamedDeclaration`/`ExportAllDeclaration` (re-export) edges never produce `deep-import` and never create demand — they are governed solely by `cross-module-reexport`'s origin rule.
- **`deep-import` gates** (ImportDeclaration, resolved internally, different directory): (a) the resolved target is an `index.ts` → never a finding (there is no separate "index-deep-import" kind — the spelling used to reach it does not matter); (b)+(c) the target directory is the importer's own directory, or a proper ancestor of it (segment-safe: `importerDir === targetDir || importerDir.startsWith(targetDir + '/')`) → K; (d) the target directory must contain an `index.ts` in the scan set — otherwise `missing-index` owns it, not `deep-import`.
- **`missing-index` is demand-driven**, not a census. For every `ImportDeclaration` edge whose resolved target is a non-index file in a directory D (D not the importer's own directory, D not an ancestor of it, importer not ignored), if D has no `index.ts` in the scan set, that creates demand on D. One `missing-index` finding per demanded directory (evidence and `file` are the directory path). A directory with zero outside demand is never flagged, even with zero index.ts.
- **`export-star` fires everywhere**, index or not. `export * as ns from` and `export type * as ns from` (an `ExportAllDeclaration` with a non-null `exported` alias) are **exempt** — the surface gains exactly one enumerable name, satisfying the "re-exports are enumerable" clause. Bare `export * from` and `export type * from` are not exempt.
- **`invalid-index-statement` covers every non-conforming index.ts statement**, not just declarations: any `ImportDeclaration` (evidence `'side-effect-import'` for a zero-specifier import, `'ImportDeclaration'` otherwise), any `ExportNamedDeclaration` that lacks a `source` or carries a `declaration` (evidence is the statement's AST `type`), and any other statement kind (evidence is its AST `type`). `ExportAllDeclaration` never produces `invalid-index-statement` — it is owned entirely by `export-star` (co-firing with `invalid-index-statement` on the same statement would double-report the same violation).
- **`cross-module-reexport` has no local-use exemption.** A `export { x }` / `export default x` that re-exports an import from outside the file's own directory subtree fires regardless of whether `x` is also used locally in that file — a local read does not excuse exposing a foreign origin on this file's surface.
- **Overlap is a first-class outcome, not a bug.** Different contract clauses co-fire on the same statement when they are each independently true — e.g. `export * from '../foreign'` is both `export-star` (surface form) and `cross-module-reexport` (foreign origin), 2 findings on one statement, in any file including `index.ts`. The only dedupe is same-clause/same-granularity (`export-star` vs `invalid-index-statement` on the same `ExportAllDeclaration`, above).
- **Remedy precedence.** `deep-import`'s fix is to route through the directory surface; if doing so creates a value cycle, fix it with `import type`, shared-module extraction, or a module merge — **never** restore the deep import as the "fix". `cross-module-reexport`'s fix is to point consumers at the origin module's own surface (or move the origin into this subtree) — **never** tell consumers to import the internal file directly (that would just relocate the violation one hop over, and is itself a `deep-import`).
