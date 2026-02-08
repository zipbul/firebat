# 🔥 firebat

Code quality scanner that surfaces **maintainability issues** so teams can prioritize refactoring based on observable signals, not gut feeling.

Built on **Bun** + **oxc**, designed for fast repeated runs and seamless integration with AI agents via MCP.

## Install

```bash
bun install
bun run build          # → dist/firebat.js
```

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

## Detectors (15)

All detectors run by default. Use `--only` to select a subset.

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

firebat exposes 37 tools via the [Model Context Protocol](https://modelcontextprotocol.io/) for AI agent integration.

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

### Tool Categories
- 🔍 Analysis: `scan` (15 detectors), `lint` (oxlint), `find_pattern` (ast-grep structural search)
- 🧭 Navigation: `get_hover`, `get_definitions`, `find_references`, `trace_symbol`, `parse_imports`, `get_document_symbols`, `get_workspace_symbols`, `get_signature_help`
- ✏️ Editing: `replace_range`, `replace_regex`, `replace_symbol_body`, `insert_before_symbol`, `insert_after_symbol`, `rename_symbol`, `delete_symbol`, `format_document`, `get_code_actions`
- 📇 Indexing: `index_symbols`, `search_symbol_from_index`, `clear_index`, `get_project_overview`
- 📦 External libs: `index_external_libraries`, `search_external_library_symbols`, `get_available_external_symbols`, `get_typescript_dependencies`
- 🧠 Memory: `read_memory`, `write_memory`, `list_memories`, `delete_memory`
- 🛠️ Infra: `list_dir`, `get_diagnostics`, `get_all_diagnostics`, `get_completion`, `check_capabilities`

### Required Rules
- After any code change, always run `scan` to check for quality regressions.
- Review scan findings and address them in priority order before moving on.

### When to Use What
- After editing code → `scan`
- Finding a symbol → `index_symbols` → `search_symbol_from_index`
- Refactoring → `find_references` → `rename_symbol`
- Searching code patterns → `find_pattern` (ast-grep syntax)
- Checking types / signatures → `get_hover`
- Exploring external library APIs → `index_external_libraries` → `search_external_library_symbols`
- Reviewing analysis results → invoke the `workflow` or `review` prompt
```

> **Tip:** `firebat install` prints this block automatically so you can copy it right away.

### Key MCP Tools

| Tool | Purpose |
|------|---------|
| `scan` | Run analysis with selected detectors, targets, and options |
| `find_pattern` | Search code using ast-grep structural patterns |
| `trace_symbol` | Build a reference graph for a symbol |
| `get_hover` | Get type/hover info at a position (tsgo LSP) |
| `rename_symbol` | Project-wide rename (tsgo LSP) |
| `index_symbols` | Index project symbols for fast search |
| `search_symbol_from_index` | Search indexed symbols by name, kind, or file |
| `lint` | Run oxlint and return diagnostics |

### Prompts

| Prompt | Description |
|--------|-------------|
| `review` | Generate a code review prompt based on scan results |
| `workflow` | Guidance on effective tool usage patterns |

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
