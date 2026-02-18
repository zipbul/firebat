# 🔥 firebat

Code quality scanner that surfaces **maintainability issues** so teams can prioritize refactoring based on observable signals, not gut feeling.

Built on **Bun** + **oxc**, designed for fast repeated runs and seamless integration with AI agents via MCP.

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
firebat --only waste,noop --format json

# Auto-fix lint & format issues
firebat --fix

# Start MCP server (stdio)
firebat mcp
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
| `mcp` | Start MCP server (stdio transport) |

### Scan Options

| Flag | Default | Description |
|------|---------|-------------|
| `--format text\|json` | `text` | Output format |
| `--min-size <n\|auto>` | `auto` | Min AST node size for duplicate detection |
| `--max-forward-depth <n>` | `0` | Max thin-wrapper chain depth |
| `--only <list>` | all | Comma-separated detectors to run |
| `--fix` | off | Apply safe autofixes (oxfmt --write; oxlint --fix) |
| `--config <path>` | `.firebatrc.jsonc` | Config file path |
| `--no-exit` | off | Always exit 0, even with findings |
| `--log-level <level>` | `info` | error \| warn \| info \| debug \| trace |
| `--log-stack` | off | Include stack traces in log output |

## Detectors (28)

All detectors run by default. Use `--only` to select a subset.
If `.firebatrc.jsonc` is present and `--only` is not specified, detectors can be disabled by setting `features["<detector>"]` to `false`.

### Code Quality

| Detector | What it finds |
|----------|---------------|
| **exact-duplicates** | Identical AST subtrees across files |
| **structural-duplicates** | Structurally similar code (clone classes) |
| **waste** | Dead stores — variables assigned but never read, or overwritten before read |
| **nesting** | Deep nesting that harms readability, with refactoring suggestions |
| **early-return** | Functions that would benefit from guard clauses / early returns |
| **noop** | No-op code: side-effect-free expression statements, constant conditions, empty catch blocks, self-assignments, empty function bodies |
| **forwarding** | Thin wrappers that only forward calls, and long forwarding chains |

### Architecture

| Detector | What it finds |
|----------|---------------|
| **barrel-policy** | Barrel file violations: `export *`, deep imports, missing/invalid index files |
| **unknown-proof** | Unsafe `unknown`/`any` usage: type assertions, unvalidated unknown, inferred any |
| **api-drift** | Functions with the same name but inconsistent signatures across files |
| **dependencies** | Import dependency cycles and edge-cut hints |
| **coupling** | High-coupling hotspot modules |

### External Tools

| Detector | Tool | What it finds |
|----------|------|---------------|
| **lint** | oxlint | Lint errors and warnings |
| **format** | oxfmt | Files that need formatting |
| **typecheck** | tsgo | Type errors and warnings with code frames |

## MCP Integration

firebat exposes a single tool (`scan`) via the [Model Context Protocol](https://modelcontextprotocol.io/) for AI agent integration.

### Setup

Add to your MCP client config (e.g. Claude Desktop, VS Code):

```json
{
  "mcpServers": {
    "firebat": {
      "command": "node",
      "args": ["path/to/dist/firebat.js", "mcp"]
    }
  }
}
```

### Agent Prompt (Recommended)

Copy the following block into your agent's instruction file
(e.g. `copilot-instructions.md`, `AGENTS.md`, `.cursor/rules`)
so your AI agent can discover and leverage all firebat tools automatically:

```markdown
## firebat (MCP Code Quality Scanner)

This project uses a firebat MCP server for automated code quality analysis.

### Tools
- 🔍 Analysis: `scan`

### Required Rules
- After any code change, always run `scan` to check for quality regressions.
- Review scan findings and address them in priority order before moving on.

### When to Use What
- After editing code → `scan`

```

> **Tip:** `firebat install` prints this block automatically so you can copy it right away.

## Configuration

Create `.firebatrc.jsonc` in your project root:

```jsonc
{
  // Detectors to run (default: all)
  "detectors": ["waste", "noop", "nesting"],

  // Per-feature configuration
  "features": {
    "unknown-proof": {
      "boundaryGlobs": ["src/adapters/**"]
    },
    "barrel-policy": {
      "ignoreGlobs": ["dist/**"]
    }
  }
}
```

## Architecture

```
src/
  adapters/       Entrypoints & composition root (CLI, MCP)
  application/    Use-case orchestration (no direct I/O imports)
  ports/          Interfaces for external I/O
  infrastructure/ I/O implementations (SQLite, tsgo, oxlint, ast-grep)
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
bun run knip            # Find unused exports
```

## License

Private
