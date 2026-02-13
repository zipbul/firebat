# Copilot Instructions

정본(E0): `AGENTS.md` 를 최우선으로 따른다.

## Codebase Map

Ports & Adapters architecture. Import direction: `adapters → application → ports ← infrastructure`.

| Layer | Path | Role |
|-------|------|------|
| Entrypoints | `index.ts`, `src/adapters/cli/`, `src/adapters/mcp/` | CLI argv routing, MCP stdio server. Composition root — wires infra to ports |
| Use-cases | `src/application/scan/`, `src/application/lsp/`, `src/application/indexing/` | Orchestration. `scan.usecase.ts` is the main scan flow |
| Ports | `src/ports/` | Interfaces only (`FirebatLogger`, `ArtifactRepository`, `FileIndexRepository`, `SymbolIndexRepository`, `MemoryRepository`) |
| Infrastructure | `src/infrastructure/sqlite/`, `src/infrastructure/memory/`, `src/infrastructure/hybrid/` | Port implementations. SQLite for persistence, in-memory for ephemeral, hybrid for layered cache |
| Engine | `src/engine/` | Pure computation: AST normalization, CFG builder, dataflow analysis, hashing, duplicate detection. No I/O |
| Features | `src/features/<detector>/` | 16 detectors. Each exports `analyze*()` + `createEmpty*()`. No cross-feature imports |
| Tests | `src/*.spec.ts` (unit, colocated), `test/integration/<feature>/` | Unit = `*.spec.ts` next to source. Integration = `*.test.ts` under `test/integration/` |

## Build & Dev

```bash
bun run build                    # → dist/firebat.js (single-file bundle via scripts/build.ts)
bun test                         # all unit + integration tests
bun test src/engine/cfg-builder.spec.ts  # single test
bun run firebat                  # run built CLI with --log-level trace
bun run firebat:agent            # JSON output, no-exit, auto-fix (for AI consumption)
```

Build uses `Bun.build()` with `target: "bun"`. Output is a single file with `src/node-header.ts` prepended as banner.

## Key Patterns

- **Feature detector convention**: each `src/features/<name>/` exports via `index.ts` barrel. Public API is `analyze*(targets, options, logger)` returning a typed result + `createEmpty*()` for no-op.
- **Logger injection**: all use-cases and detectors receive `FirebatLogger` via parameter, never import a global logger.
- **oxc-parser for AST**: `src/engine/parse-source.ts` wraps `oxc-parser`. AST types come from `oxc-parser` — not `@babel/types` or `typescript`.
- **tsgo for typecheck**: `src/infrastructure/tsgo/` shells out to `tsgo` binary, not `tsc`. `src/ts-program.ts` creates the program instance.
- **Cache in `.firebat/`**: SQLite DB + artifact files live in `.firebat/` at project root. `cache clean` command deletes `*.sqlite`.
- **Config**: `.firebatrc.jsonc` at project root. Schema at `assets/firebatrc.schema.json`. Loaded by `src/firebat-config.loader.ts`.
- **All `readonly`**: interfaces use `readonly` properties and `ReadonlyArray<T>`. Follow this convention.
