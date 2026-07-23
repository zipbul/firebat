# 🔥 firebat

Code quality scanner that surfaces **maintainability issues** so teams can prioritize refactoring based on observable signals, not gut feeling.

Built on **Bun** + **oxc**, designed for fast repeated runs. JSON-only CLI output for AI agent integration.

## Install

```bash
bun install
bun run build          # → dist/firebat.js
```

Bun behavior is configured in `bunfig.toml` at the project root.

## Quick Start

```bash
# Scan the entire project
firebat

# Scan specific files
firebat src/app.ts src/utils.ts

# Select detectors and output JSON
firebat --only waste,nesting
```

## CLI Reference

```
firebat [targets...] [options]
firebat scan [targets...] [options]
```

### Commands

| Command | Description |
|---------|-------------|
| `scan` | Run code analysis (default command) |
| `install` | Set up firebat config files in this project |
| `update` | Sync config files with latest templates |
| `cache clean` | Delete cached analysis data (`.firebat/*.sqlite`) |

### Scan Options

| Flag | Default | Description |
|------|---------|-------------|
| `--min-size <n\|auto>` | `auto` | Min AST node size for duplicate detection |
| `--max-forward-depth <n>` | `0` | Max thin-wrapper chain depth |
| `--only <list>` | all | Comma-separated detectors to run |
| `--config <path>` | `.firebatrc.jsonc` | Config file path |
| `--log-level <level>` | `info` | error \| warn \| info \| debug \| trace |
| `--log-stack` | off | Include stack traces in log output |

## Detectors (12)

Most detectors run by default (`barrel` is opt-in). Use `--only` to select a subset.
If `.firebatrc.jsonc` is present and `--only` is not specified, detectors can be disabled by setting `features["<detector>"]` to `false`.

### Code Quality

| Detector | What it finds |
|----------|---------------|
| **exact-duplicates** | Identical AST subtrees across files |
| **structural-duplicates** | Structurally similar code (clone classes) |
| **waste** | Dead stores — variables assigned but never read, or overwritten before read |
| **nesting** | Deep nesting that harms readability, with refactoring suggestions |
| **early-return** | Functions that would benefit from guard clauses / early returns |
| **forwarding** | Thin wrappers that only forward calls, and long forwarding chains |

### Architecture

| Detector | What it finds |
|----------|---------------|
| **barrel** | Barrel file violations: `export *`, deep imports, missing/invalid index files, cross-module re-exports |
| **unknown-proof** | Unsafe `unknown`/`any` usage: type assertions, unvalidated unknown, inferred any |
| **dependencies** | Import dependency cycles and edge-cut hints |
| **nesting** | Cognitive complexity, deep nesting, callback depth, complexity density |
| **early-return** | Invertible if-else, collapsible conditions, guard clause opportunities |
| **collapsible-if** | Nested if statements that can be collapsed into a single condition |
| **indirection** | Thin wrappers, forwarding chains, type remaps, interface rewraps |
| **variable-lifetime** | Long-lived variables, scope-narrowing opportunities |
| **waste** | Dead stores, unused variables |
| **duplicates** | Exact and structural code duplicates |
| **temporal-coupling** | Order-dependent operations |
| **giant-file** | Files exceeding the line budget (default 1000; `maxLines` to override, `false` to disable) |
| **error-flow** | Unsafe error handling patterns |

## Configuration

Create `.firebatrc.jsonc` in your project root:

```jsonc
{
  // Per-feature configuration
  "features": {
    "unknown-proof": {
      "boundaryGlobs": ["src/adapters/**"]
    },
    "barrel": {
      "ignoreGlobs": ["dist/**"]
    }
  }
}
```

## Architecture

```
src/
  adapters/       Entrypoints & composition root (CLI)
  application/    Use-case orchestration (no direct I/O imports)
  ports/          Interfaces for external I/O
  infrastructure/ I/O implementations (SQLite)
  engine/         Pure computation (AST parsing, CFG, hashing, detection)
  features/       Pure analysis logic per detector
```

**Dependency rules:**
- `application/` → depends on `ports/` only (never `infrastructure/`)
- `infrastructure/` → implements `ports/`
- `adapters/` → assembles everything (composition root)
- `engine/` + `features/` → pure, no I/O dependencies

## Development

```bash
bun test                # Run all tests
bun run build           # Build to dist/
bun run deps            # Check dependency rules
```

## License

Private
