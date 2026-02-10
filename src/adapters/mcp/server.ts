import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { CallToolResult, ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { watch } from 'node:fs';
import { readdir } from 'node:fs/promises';
import * as path from 'node:path';
import * as z from 'zod';

import type { FirebatConfig } from '../../firebat-config';
import type { FirebatCliOptions } from '../../interfaces';
import type { FirebatLogger } from '../../ports/logger';
import type { FirebatDetector, FirebatReport } from '../../types';

import {
  insertAfterSymbolUseCase,
  insertBeforeSymbolUseCase,
  replaceRangeUseCase,
  replaceRegexUseCase,
  replaceSymbolBodyUseCase,
} from '../../application/editor/edit.usecases';
import { findPatternUseCase } from '../../application/find-pattern/find-pattern.usecase';
import {
  checkCapabilitiesUseCase,
  deleteSymbolUseCase,
  findReferencesUseCase,
  formatDocumentUseCase,
  getAllDiagnosticsUseCase,
  getAvailableExternalSymbolsInFileUseCase,
  getCodeActionsUseCase,
  getCompletionUseCase,
  getDefinitionsUseCase,
  getDiagnosticsUseCase,
  getDocumentSymbolsUseCase,
  getHoverUseCase,
  getSignatureHelpUseCase,
  getTypescriptDependenciesUseCase,
  getWorkspaceSymbolsUseCase,
  indexExternalLibrariesUseCase,
  parseImportsUseCase,
  renameSymbolUseCase,
  searchExternalLibrarySymbolsUseCase,
} from '../../application/lsp/lsp.usecases';
import {
  deleteMemoryUseCase,
  listMemoriesUseCase,
  readMemoryUseCase,
  writeMemoryUseCase,
} from '../../application/memory/memory.usecases';
import { scanUseCase } from '../../application/scan/scan.usecase';
import {
  clearIndexUseCase,
  getIndexStatsFromIndexUseCase,
  indexSymbolsUseCase,
  searchSymbolFromIndexUseCase,
} from '../../application/symbol-index/symbol-index.usecases';
import { traceSymbolUseCase } from '../../application/trace/trace-symbol.usecase';
import { loadFirebatConfigFile } from '../../firebat-config.loader';
import { createPrettyConsoleLogger } from '../../infrastructure/logging/pretty-console-logger';
import { runOxlint } from '../../infrastructure/oxlint/oxlint-runner';
import { resolveRuntimeContextFromCwd } from '../../runtime-context';
import { discoverDefaultTargets, expandTargets } from '../../target-discovery';

const JsonValueSchema = z.json();
const ALL_DETECTORS: ReadonlyArray<FirebatDetector> = [
  'exact-duplicates',
  'waste',
  'barrel-policy',
  'unknown-proof',
  'format',
  'lint',
  'typecheck',
  'dependencies',
  'coupling',
  'structural-duplicates',
  'nesting',
  'early-return',
  'noop',
  'api-drift',
  'forwarding',
];

const asDetectors = (values: ReadonlyArray<string> | undefined): ReadonlyArray<FirebatDetector> => {
  if (!values || values.length === 0) {
    return ALL_DETECTORS;
  }

  const picked = values.filter((v): v is FirebatDetector => (ALL_DETECTORS as ReadonlyArray<string>).includes(v));

  return picked.length > 0 ? picked : ALL_DETECTORS;
};

const resolveEnabledDetectorsFromFeatures = (features: FirebatConfig['features'] | undefined): ReadonlyArray<FirebatDetector> => {
  if (!features) {
    return ALL_DETECTORS;
  }

  return ALL_DETECTORS.filter(detector => {
    const value = features?.[detector as keyof NonNullable<FirebatConfig['features']>];

    return value !== false;
  });
};

const resolveMinSizeFromFeatures = (features: FirebatConfig['features'] | undefined): number | 'auto' | undefined => {
  const exact = features?.['exact-duplicates'];
  const structural = features?.['structural-duplicates'];
  const exactSize = typeof exact === 'object' && exact !== null ? exact.minSize : undefined;
  const structuralSize = typeof structural === 'object' && structural !== null ? structural.minSize : undefined;

  if (exactSize !== undefined && structuralSize !== undefined && exactSize !== structuralSize) {
    throw new Error(
      '[firebat] Invalid config: features.structural-duplicates.minSize must match features.exact-duplicates.minSize',
    );
  }

  return exactSize ?? structuralSize;
};

const resolveMaxForwardDepthFromFeatures = (features: FirebatConfig['features'] | undefined): number | undefined => {
  const forwarding = features?.forwarding;

  if (forwarding === undefined || forwarding === false || forwarding === true) {
    return undefined;
  }

  return forwarding.maxForwardDepth;
};

const resolveUnknownProofBoundaryGlobsFromFeatures = (
  features: FirebatConfig['features'] | undefined,
): ReadonlyArray<string> | undefined => {
  const value = features?.['unknown-proof'];

  if (!value || value === true || typeof value !== 'object') {
    return undefined;
  }

  const boundaryGlobs = value.boundaryGlobs;

  return Array.isArray(boundaryGlobs) && boundaryGlobs.every((element: unknown) => typeof element === 'string')
    ? boundaryGlobs
    : undefined;
};

const resolveBarrelPolicyIgnoreGlobsFromFeatures = (
  features: FirebatConfig['features'] | undefined,
): ReadonlyArray<string> | undefined => {
  const value = features?.['barrel-policy'];

  if (!value || value === true || typeof value !== 'object') {
    return undefined;
  }

  const ignoreGlobs = value.ignoreGlobs;

  return Array.isArray(ignoreGlobs) && ignoreGlobs.every((element: unknown) => typeof element === 'string')
    ? ignoreGlobs
    : undefined;
};

const resolveMcpFeatures = (config: FirebatConfig | null): FirebatConfig['features'] | undefined => {
  const root = config?.features;
  const mcp = config?.mcp;

  if (!mcp || mcp === 'inherit') {
    return root;
  }

  const overrides = mcp.features;

  if (!overrides) {
    return root;
  }

  const out: Record<string, unknown> = { ...root };

  for (const detector of ALL_DETECTORS) {
    const override = overrides[detector as keyof typeof overrides];

    if (override === undefined || override === 'inherit') {
      continue;
    }

    out[detector] = override;
  }

  return out as NonNullable<FirebatConfig['features']>;
};

const nowMs = (): number => {
  // Bun supports performance.now()
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
};

interface FirebatMcpServerOptions {
  rootAbs: string;
  config?: FirebatConfig | null;
  logger: FirebatLogger;
}

interface DiffCounts {
  newFindings: number;
  resolvedFindings: number;
  unchangedFindings: number;
}

/** Wrap a tool handler so that any thrown error becomes a proper MCP error response instead of an unhandled rejection. */
const safeTool = <TArgs>(
  handler: (
    args: TArgs,
    extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
  ) => CallToolResult | Promise<CallToolResult>,
) => {
  return async (args: TArgs, extra: RequestHandlerExtra<ServerRequest, ServerNotification>): Promise<CallToolResult> => {
    try {
      return await handler(args, extra);
    } catch (err: unknown) {
      const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      const stack = err instanceof Error && err.stack ? `\n${err.stack}` : '';

      process.stderr.write(`[firebat] tool error: ${message}${stack}\n`);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  };
};

const toStructured = (value: object): Record<string, unknown> => value as Record<string, unknown>;

const toToolResult = (structured: object): CallToolResult => ({
  content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
  structuredContent: toStructured(structured),
});

export const createFirebatMcpServer = async (options: FirebatMcpServerOptions): Promise<McpServer> => {
  const rootAbs = options.rootAbs;
  const config = options.config ?? null;
  const logger = options.logger;

  logger.debug('MCP server: init', { rootAbs, hasConfig: config !== null });

  const server = new McpServer({
    name: 'firebat',
    version: '2.0.0-strict',
  });
  let lastReport: FirebatReport | null = null;
  let lastScanTimestamp: number | null = null;

  const resolveRootAbs = (root?: string): string => {
    if (root === undefined) {
      return rootAbs;
    }

    const trimmed = root.trim();

    if (trimmed.length === 0) {
      return rootAbs;
    }

    return path.isAbsolute(trimmed) ? trimmed : path.resolve(rootAbs, trimmed);
  };

  const diffReports = (prev: FirebatReport | null, next: FirebatReport): DiffCounts => {
    if (!prev) {
      return { newFindings: -1, resolvedFindings: -1, unchangedFindings: -1 };
    }

    const countFindings = (r: FirebatReport): number => {
      if (!r.analyses) {
        return 0;
      }

      let total = 0;
      const a = r.analyses as Record<string, unknown>;

      for (const key of Object.keys(a)) {
        const v = a[key];

        if (Array.isArray(v)) {
          total += v.length;
        } else if (v && typeof v === 'object') {
          const record = v as Record<string, unknown>;

          if (Array.isArray(record.items)) {
            total += record.items.length;
          } else if (Array.isArray(record.findings)) {
            total += record.findings.length;
          } else if (Array.isArray(record.cloneClasses)) {
            total += record.cloneClasses.length;
          } else if (Array.isArray(record.groups)) {
            total += record.groups.length;
          } else if (Array.isArray(record.hotspots)) {
            total += record.hotspots.length;
          } else if (Array.isArray(record.diagnostics)) {
            total += record.diagnostics.length;
          } else if (Array.isArray(record.cycles)) {
            total += record.cycles.length;
          }
        }
      }

      return total;
    };

    const prevCount = countFindings(prev);
    const nextCount = countFindings(next);
    const diff = nextCount - prevCount;

    return {
      newFindings: diff > 0 ? diff : 0,
      resolvedFindings: diff < 0 ? -diff : 0,
      unchangedFindings: Math.min(prevCount, nextCount),
    };
  };

  const ScanInputSchema = z
    .object({
      targets: z.array(z.string()).optional().describe('File/dir paths to analyze. Defaults to project source files.'),
      detectors: z
        .array(z.string())
        .optional()
        .describe(
          'Subset of detectors to run. Available: exact-duplicates, structural-duplicates, waste, nesting, early-return, noop, forwarding, barrel-policy, unknown-proof, coupling, dependencies, api-drift, lint, format, typecheck.',
        ),
      minSize: z
        .union([z.number().int().nonnegative(), z.literal('auto')])
        .optional()
        .describe('Minimum AST node size for duplicate detection. "auto" (default) adapts to codebase.'),
      maxForwardDepth: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('Max re-export depth for forwarding detector. 0 = disabled.'),
    })
    .strict();

  server.registerTool(
    'scan',
    {
      title: 'Scan',
      description:
        'Run code quality analysis on targets and return a FirebatReport (JSON). ' +
        'Detects: exact-duplicates, structural-duplicates, waste (dead stores via CFG/dataflow), ' +
        'nesting, early-return, noop (empty blocks), forwarding (re-export chains), ' +
        'barrel-policy, unknown-proof, coupling, dependencies, api-drift, lint, format, typecheck. ' +
        'Use the `detectors` param to run a subset. Results are cached per content digest.',
      inputSchema: ScanInputSchema,
      outputSchema: z
        .object({
          report: z.any(),
          timings: z.object({ totalMs: z.number() }),
          diff: z
            .object({
              newFindings: z.number(),
              resolvedFindings: z.number(),
              unchangedFindings: z.number(),
            })
            .optional(),
        })
        .strict(),
    },
    safeTool(async (args: z.infer<typeof ScanInputSchema>) => {
      const t0 = nowMs();
      const rawTargets =
        args.targets !== undefined && args.targets.length > 0
          ? args.targets.map(t => (path.isAbsolute(t) ? t : path.resolve(rootAbs, t)))
          : await discoverDefaultTargets(rootAbs);
      const targets = await expandTargets(rawTargets);
      const effectiveFeatures = resolveMcpFeatures(config);
      const cfgDetectors = resolveEnabledDetectorsFromFeatures(effectiveFeatures);
      const cfgMinSize = resolveMinSizeFromFeatures(effectiveFeatures);
      const cfgMaxForwardDepth = resolveMaxForwardDepthFromFeatures(effectiveFeatures);
      const cfgUnknownProofBoundaryGlobs = resolveUnknownProofBoundaryGlobsFromFeatures(effectiveFeatures);
      const cfgBarrelPolicyIgnoreGlobs = resolveBarrelPolicyIgnoreGlobsFromFeatures(effectiveFeatures);
      const options: FirebatCliOptions = {
        targets,
        format: 'json',
        minSize: args.minSize ?? cfgMinSize ?? 'auto',
        maxForwardDepth: args.maxForwardDepth ?? cfgMaxForwardDepth ?? 0,
        exitOnFindings: false,
        detectors: args.detectors !== undefined ? asDetectors(args.detectors) : cfgDetectors,
        fix: false,
        ...(cfgUnknownProofBoundaryGlobs !== undefined ? { unknownProofBoundaryGlobs: cfgUnknownProofBoundaryGlobs } : {}),
        ...(cfgBarrelPolicyIgnoreGlobs !== undefined ? { barrelPolicyIgnoreGlobs: cfgBarrelPolicyIgnoreGlobs } : {}),
        help: false,
      };
      const report = await scanUseCase(options, { logger });
      const diff = diffReports(lastReport, report);

      lastReport = report;
      lastScanTimestamp = Date.now();

      const totalMs = nowMs() - t0;
      const structured = { report, timings: { totalMs }, ...(diff.newFindings >= 0 ? { diff } : {}) };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
        structuredContent: toStructured(structured),
      };
    }),
  );

  const FindPatternInputSchema = z
    .object({
      targets: z
        .array(z.string())
        .optional()
        .describe('File or directory paths to search. If omitted, default project sources are used.'),
      rule: JsonValueSchema.optional().describe('ast-grep YAML rule object.'),
      matcher: JsonValueSchema.optional().describe('Pattern string to match.'),
      ruleName: z.string().optional().describe('Name of the rule when using rule.'),
    })
    .strict();

  server.registerTool(
    'find_pattern',
    {
      title: 'Find Pattern',
      description:
        'Run ast-grep structural pattern matching across targets. Provide a rule (ast-grep YAML rule object) or matcher (pattern string). If targets is omitted, default project sources are used. Returns matching AST nodes.',
      inputSchema: FindPatternInputSchema,
      outputSchema: z
        .object({
          matches: z.array(
            z.object({
              filePath: z.string(),
              ruleId: z.string(),
              text: z.string(),
              span: z.object({
                start: z.object({ line: z.number(), column: z.number() }),
                end: z.object({ line: z.number(), column: z.number() }),
              }),
            }),
          ),
        })
        .strict(),
    },
    safeTool(async (args: z.infer<typeof FindPatternInputSchema>) => {
      const hasRule = args.rule !== undefined;
      const hasMatcher = args.matcher !== undefined;

      if (!hasRule && !hasMatcher) {
        throw new Error('find_pattern requires one of: rule, matcher');
      }

      const request: Parameters<typeof findPatternUseCase>[0] = {
        ...(args.targets !== undefined ? { targets: args.targets } : {}),
        ...(args.rule !== undefined ? { rule: args.rule } : {}),
        ...(args.matcher !== undefined ? { matcher: args.matcher } : {}),
        ...(args.ruleName !== undefined ? { ruleName: args.ruleName } : {}),
        logger,
      };
      const matches = await findPatternUseCase(request);
      const structured = { matches };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
        structuredContent: toStructured(structured),
      };
    }),
  );

  const TraceSymbolInputSchema = z
    .object({
      entryFile: z.string().describe('Absolute path or path relative to project root where the symbol is defined or used.'),
      symbol: z.string().describe('Name of the symbol to trace.'),
      tsconfigPath: z.string().optional().describe('Optional path to tsconfig.json; used by tsgo.'),
      maxDepth: z.number().int().nonnegative().optional().describe('Maximum depth of the dependency graph.'),
    })
    .strict();

  server.registerTool(
    'trace_symbol',
    {
      title: 'Trace Symbol',
      description:
        "Trace a symbol's type-level dependency graph via tsgo LSP. Returns nodes (files, symbols, types) and edges showing how the symbol connects across the codebase.",
      inputSchema: TraceSymbolInputSchema,
      outputSchema: z
        .object({
          ok: z.boolean(),
          tool: z.literal('tsgo'),
          graph: z.object({ nodes: z.array(z.any()), edges: z.array(z.any()) }),
          evidence: z.array(z.any()),
          error: z.string().optional(),
          raw: z.any().optional(),
        })
        .strict(),
    },
    safeTool(async (args: z.infer<typeof TraceSymbolInputSchema>) => {
      const request: Parameters<typeof traceSymbolUseCase>[0] = {
        entryFile: args.entryFile,
        symbol: args.symbol,
        ...(args.tsconfigPath !== undefined ? { tsconfigPath: args.tsconfigPath } : {}),
        ...(args.maxDepth !== undefined ? { maxDepth: args.maxDepth } : {}),
        logger,
      };
      const structured = await traceSymbolUseCase(request);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
        structuredContent: toStructured(structured),
      };
    }),
  );

  const LintInputSchema = z
    .object({
      targets: z.array(z.string()).describe('File or directory paths to lint (relative to root or absolute).'),
      configPath: z.string().optional().describe('Optional path to config file (e.g. .oxlintrc.json).'),
    })
    .strict();

  server.registerTool(
    'lint',
    {
      title: 'Lint',
      description:
        'Run oxlint on the given file/directory targets and return normalized lint diagnostics. Targets are relative to root or absolute. Optionally provide configPath (e.g. .oxlintrc.json). Returns an array of diagnostics with file, line, column, message, and severity.',
      inputSchema: LintInputSchema,
      outputSchema: z
        .object({
          ok: z.boolean(),
          tool: z.literal('oxlint'),
          diagnostics: z.array(z.any()).optional(),
          error: z.string().optional(),
        })
        .strict(),
    },
    safeTool(async (args: z.infer<typeof LintInputSchema>) => {
      const request: Parameters<typeof runOxlint>[0] = {
        targets: args.targets,
        ...(args.configPath !== undefined ? { configPath: args.configPath } : {}),
        cwd: rootAbs,
        logger,
      };
      const result = await runOxlint(request);
      const structured = {
        ok: result.ok,
        tool: result.tool,
        diagnostics: result.diagnostics ?? [],
        error: result.error,
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
        structuredContent: toStructured(structured),
      };
    }),
  );

  const ListDirInputSchema = z
    .object({
      root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.'),
      relativePath: z.string().describe('Path relative to root to list.'),
      recursive: z.boolean().optional().describe('If true, recursively list all entries. Default: false (non-recursive).'),
    })
    .strict();

  server.registerTool(
    'list_dir',
    {
      title: 'List Dir',
      description:
        'List files and subdirectories in a directory. Root defaults to process.cwd() if omitted. Use relativePath from root. Set recursive=true for a full recursive listing. Returns each entry with its name and whether it is a directory.',
      inputSchema: ListDirInputSchema,
      outputSchema: z
        .object({
          entries: z.array(
            z.object({
              name: z.string(),
              isDir: z.boolean(),
            }),
          ),
        })
        .strict(),
    },
    safeTool(async (args: z.infer<typeof ListDirInputSchema>) => {
      const defaultRoot = rootAbs;
      const root = args.root !== undefined && args.root.trim().length > 0 ? args.root.trim() : defaultRoot;
      const absRoot = path.isAbsolute(root) ? root : path.resolve(defaultRoot, root);
      const absPath = path.resolve(absRoot, args.relativePath);

      if (args.recursive) {
        const entries: Array<{ name: string; isDir: boolean }> = [];

        const walk = async (dir: string, prefix: string): Promise<void> => {
          const dirents = await readdir(dir, { withFileTypes: true });

          if (dirents.length === 0) {
            return;
          }

          for (const d of dirents) {
            const rel = prefix ? `${prefix}/${d.name}` : d.name;
            const isDir = d.isDirectory();

            entries.push({ name: rel, isDir });

            if (isDir) {
              await walk(path.join(dir, d.name), rel);
            }
          }
        };

        await walk(absPath, '');

        const structured = { entries };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
          structuredContent: toStructured(structured),
        };
      }

      const dirents = await readdir(absPath, { withFileTypes: true });
      const entries = dirents.map(d => ({ name: d.name, isDir: d.isDirectory() }));
      const structured = { entries };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
        structuredContent: toStructured(structured),
      };
    }),
  );

  const ListMemoriesInputSchema = z
    .object({ root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.') })
    .strict();

  server.registerTool(
    'list_memories',
    {
      title: 'List Memories',
      description:
        'List all memory record keys stored for this project. Memories persist across MCP sessions in SQLite — useful for caching analysis notes, decisions, or intermediate results.',
      inputSchema: ListMemoriesInputSchema,
      outputSchema: z
        .object({
          memories: z.array(z.object({ memoryKey: z.string(), updatedAt: z.number() })),
        })
        .strict(),
    },
    safeTool(async (args: z.infer<typeof ListMemoriesInputSchema>) => {
      const memories = await listMemoriesUseCase(args.root !== undefined ? { root: args.root, logger } : { logger });
      const structured = { memories };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
        structuredContent: toStructured(structured),
      };
    }),
  );

  const ReadMemoryInputSchema = z
    .object({
      root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.'),
      memoryKey: z.string().describe('Unique key of the memory record to read.'),
    })
    .strict();

  server.registerTool(
    'read_memory',
    {
      title: 'Read Memory',
      description:
        'Read a previously stored memory record by its key. Returns the JSON value if found, or found=false if the key does not exist.',
      inputSchema: ReadMemoryInputSchema,
      outputSchema: z
        .object({
          found: z.boolean(),
          memoryKey: z.string(),
          value: z.any().optional(),
        })
        .strict(),
    },
    safeTool(async (args: z.infer<typeof ReadMemoryInputSchema>) => {
      const rec = await readMemoryUseCase({
        ...(args.root !== undefined ? { root: args.root } : {}),
        memoryKey: args.memoryKey,
        logger,
      });
      const structured = rec
        ? { found: true, memoryKey: args.memoryKey, value: rec.value }
        : { found: false, memoryKey: args.memoryKey };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
        structuredContent: toStructured(structured),
      };
    }),
  );

  const WriteMemoryInputSchema = z
    .object({
      root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.'),
      memoryKey: z.string().describe('Unique key for the record (e.g. "refactor-plan", "last-review-summary").'),
      value: JsonValueSchema.describe('Arbitrary JSON value to store.'),
    })
    .strict();

  server.registerTool(
    'write_memory',
    {
      title: 'Write Memory',
      description:
        'Write or overwrite a memory record with an arbitrary JSON value. The record persists in SQLite across sessions. Use memoryKey as a unique identifier.',
      inputSchema: WriteMemoryInputSchema,
      outputSchema: z.object({ ok: z.boolean(), memoryKey: z.string() }).strict(),
    },
    safeTool(async (args: z.infer<typeof WriteMemoryInputSchema>) => {
      await writeMemoryUseCase({
        ...(args.root !== undefined ? { root: args.root } : {}),
        memoryKey: args.memoryKey,
        value: args.value,
        logger,
      });

      const structured = { ok: true, memoryKey: args.memoryKey };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
        structuredContent: toStructured(structured),
      };
    }),
  );

  const DeleteMemoryInputSchema = z
    .object({
      root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.'),
      memoryKey: z.string().describe('Unique key of the memory record to delete.'),
    })
    .strict();

  server.registerTool(
    'delete_memory',
    {
      title: 'Delete Memory',
      description: 'Delete a memory record by its key. Returns ok=true even if the key did not exist.',
      inputSchema: DeleteMemoryInputSchema,
      outputSchema: z.object({ ok: z.boolean(), memoryKey: z.string() }).strict(),
    },
    safeTool(async (args: z.infer<typeof DeleteMemoryInputSchema>) => {
      await deleteMemoryUseCase({
        ...(args.root !== undefined ? { root: args.root } : {}),
        memoryKey: args.memoryKey,
        logger,
      });

      const structured = { ok: true, memoryKey: args.memoryKey };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
        structuredContent: toStructured(structured),
      };
    }),
  );

  // ----
  // LSMCP Index & Project (subset): symbol index/search
  // ----

  const IndexSymbolsInputSchema = z
    .object({
      root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.'),
      targets: z
        .array(z.string())
        .optional()
        .describe('File or directory paths to index. If omitted, default project sources are used.'),
    })
    .strict();

  server.registerTool(
    'index_symbols',
    {
      title: 'Index Symbols',
      description:
        'Parse and index all symbols (functions, classes, types, variables) from the given targets into SQLite. Required before using search_symbol_from_index. If targets is omitted, default sources are used.',
      inputSchema: IndexSymbolsInputSchema,
      outputSchema: z
        .object({
          ok: z.boolean(),
          indexedFiles: z.number(),
          skippedFiles: z.number(),
          symbolsIndexed: z.number(),
          parseErrors: z.number(),
          timings: z.object({ totalMs: z.number() }),
        })
        .strict(),
    },
    safeTool(async (args: z.infer<typeof IndexSymbolsInputSchema>) => {
      const t0 = nowMs();
      const result = await indexSymbolsUseCase({
        ...(args.root !== undefined ? { root: args.root } : {}),
        ...(args.targets !== undefined ? { targets: args.targets } : {}),
        logger,
      });
      const totalMs = nowMs() - t0;
      const structured = { ...result, timings: { totalMs } };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
        structuredContent: toStructured(structured),
      };
    }),
  );

  const SearchSymbolFromIndexInputSchema = z
    .object({
      root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.'),
      query: z.string().describe('Substring to match symbol names.'),
      kind: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe('Filter by kind (e.g. "function", "class", "type").'),
      file: z.string().optional().describe('Filter by file path substring.'),
      limit: z.number().int().positive().optional().describe('Maximum number of matches to return.'),
    })
    .strict();

  server.registerTool(
    'search_symbol_from_index',
    {
      title: 'Search Symbol From Index',
      description:
        'Search indexed symbols by substring match on name. Optionally filter by symbol kind (e.g. "function", "class", "type") and/or file path substring. Requires index_symbols to have been run first.',
      inputSchema: SearchSymbolFromIndexInputSchema,
      outputSchema: z
        .object({
          matches: z.array(
            z.object({
              filePath: z.string(),
              kind: z.string(),
              name: z.string(),
              span: z.object({
                start: z.object({ line: z.number(), column: z.number() }),
                end: z.object({ line: z.number(), column: z.number() }),
              }),
              isExported: z.boolean().optional(),
            }),
          ),
        })
        .strict(),
    },
    safeTool(async (args: z.infer<typeof SearchSymbolFromIndexInputSchema>) => {
      const matches = await searchSymbolFromIndexUseCase({
        ...(args.root !== undefined ? { root: args.root } : {}),
        query: args.query,
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
        logger,
      });
      const kindsRaw = args.kind === undefined ? [] : Array.isArray(args.kind) ? args.kind : [args.kind];
      const kinds = new Set(kindsRaw.map(k => k.toLowerCase()));
      const fileNeedle = (args.file ?? '').trim().toLowerCase();
      const filtered = matches.filter(m => {
        if (kinds.size > 0 && !kinds.has(m.kind.toLowerCase())) {
          return false;
        }

        if (fileNeedle && !m.filePath.toLowerCase().includes(fileNeedle)) {
          return false;
        }

        return true;
      });
      const structured = { matches: filtered };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
        structuredContent: toStructured(structured),
      };
    }),
  );

  const ClearIndexInputSchema = z
    .object({ root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.') })
    .strict();

  server.registerTool(
    'clear_index',
    {
      title: 'Clear Index',
      description: 'Delete all symbol index data for the given project root. Use to force a full re-index.',
      inputSchema: ClearIndexInputSchema,
      outputSchema: z.object({ ok: z.boolean() }).strict(),
    },
    safeTool(async (args: z.infer<typeof ClearIndexInputSchema>) => {
      await clearIndexUseCase(args.root !== undefined ? { root: args.root, logger } : { logger });

      const structured = { ok: true };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
        structuredContent: toStructured(structured),
      };
    }),
  );

  const GetProjectOverviewInputSchema = z
    .object({ root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.') })
    .strict();

  server.registerTool(
    'get_project_overview',
    {
      title: 'Get Project Overview',
      description:
        'Return project overview: indexed file count, symbol count, last indexed timestamp, tool availability (tsgo, oxlint), last scan timestamp, and root path. Root defaults to process.cwd() if omitted.',
      inputSchema: GetProjectOverviewInputSchema,
      outputSchema: z
        .object({
          root: z.string(),
          symbolIndex: z.object({
            indexedFileCount: z.number(),
            symbolCount: z.number(),
            lastIndexedAt: z.number().nullable(),
          }),
          tools: z.object({
            tsgo: z.boolean(),
            oxlint: z.boolean(),
          }),
          lastScanAt: z.number().nullable(),
        })
        .strict(),
    },
    safeTool(async (args: z.infer<typeof GetProjectOverviewInputSchema>) => {
      if (rootAbs.trim().length === 0) {
        return toToolResult({
          root: rootAbs,
          symbolIndex: { indexedFileCount: 0, symbolCount: 0, lastIndexedAt: null },
          tools: { tsgo: false, oxlint: false },
          lastScanAt: null,
          error: 'Project root is not set',
        });
      }

      const symbolIndex = await getIndexStatsFromIndexUseCase(args.root !== undefined ? { root: args.root, logger } : { logger });
      // Best-effort tool availability check
      const tsgoAvailable = await (async () => {
        if (rootAbs.trim().length === 0) {
          return false;
        }

        try {
          const r = await checkCapabilitiesUseCase({ root: rootAbs, logger });

          return r.ok === true;
        } catch {
          return false;
        }
      })();
      const oxlintAvailable = await (async () => {
        if (rootAbs.trim().length === 0) {
          return false;
        }

        try {
          const r = await runOxlint({ targets: [], cwd: rootAbs, logger });

          // If targets is empty, oxlint may still report ok=false for "no targets" but the tool itself is found.
          return r.ok === true || (r.error !== undefined && !r.error.includes('not available'));
        } catch {
          return false;
        }
      })();
      const structured = {
        root: rootAbs,
        symbolIndex,
        tools: { tsgo: tsgoAvailable, oxlint: oxlintAvailable },
        lastScanAt: lastScanTimestamp,
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
        structuredContent: toStructured(structured),
      };
    }),
  );

  // ----
  // LSP-common tools (via tsgo LSP)
  // ----

  const GetHoverInputSchema = z
    .object({
      root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.'),
      filePath: z.string().describe('Path to the file, relative to root or absolute.'),
      line: z
        .union([z.number(), z.string()])
        .describe(
          '1-based line number (number or numeric string). A non-numeric string is treated as content search (first line containing that text).',
        ),
      character: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('0-based column. Optional; used with line for exact position.'),
      target: z.string().optional().describe('Optional substring to auto-locate the symbol on the line.'),
      tsconfigPath: z.string().optional().describe('Optional path to tsconfig.json; used by tsgo.'),
    })
    .strict();

  server.registerTool(
    'get_hover',
    {
      title: 'Get Hover',
      description:
        'Get type information and documentation for a symbol at a specific position via tsgo LSP. Root defaults to process.cwd(); filePath is relative to root or absolute. Provide line + character for exact position, or use target to auto-locate the symbol in the line.',
      inputSchema: GetHoverInputSchema,
      outputSchema: z
        .object({ ok: z.boolean(), hover: z.any().optional(), error: z.string().optional(), note: z.string().optional() })
        .strict(),
    },
    safeTool(async (args: z.infer<typeof GetHoverInputSchema>) => {
      const rootAbs = resolveRootAbs(args.root);
      const structured = await getHoverUseCase({
        root: rootAbs,
        filePath: args.filePath,
        line: args.line,
        ...(args.character !== undefined ? { character: args.character } : {}),
        ...(args.target !== undefined ? { target: args.target } : {}),
        ...(args.tsconfigPath !== undefined && args.tsconfigPath.length > 0 ? { tsconfigPath: args.tsconfigPath } : {}),
        logger,
      });

      return toToolResult(structured);
    }),
  );

  const FindReferencesInputSchema = z
    .object({
      root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.'),
      filePath: z.string().describe('Path to the file, relative to root or absolute.'),
      line: z
        .union([z.number(), z.string()])
        .describe(
          '1-based line number (number or numeric string) where the symbol appears. A non-numeric string is treated as content search.',
        ),
      symbolName: z.string().describe('Name of the symbol to find references for.'),
      tsconfigPath: z.string().optional().describe('Optional path to tsconfig.json; used by tsgo.'),
    })
    .strict();

  server.registerTool(
    'find_references',
    {
      title: 'Find References',
      description:
        'Find all references to a symbol across the project via tsgo LSP. Root defaults to process.cwd(); filePath is relative to root or absolute. Requires symbolName and the approximate line in the file where the symbol appears. Returns each reference location with file path, line, and column.',
      inputSchema: FindReferencesInputSchema,
      outputSchema: z.object({ ok: z.boolean(), references: z.array(z.any()).optional(), error: z.string().optional() }).strict(),
    },
    safeTool(async (args: z.infer<typeof FindReferencesInputSchema>) => {
      const rootAbs = resolveRootAbs(args.root);
      const structured = await findReferencesUseCase({
        root: rootAbs,
        filePath: args.filePath,
        line: args.line,
        symbolName: args.symbolName,
        ...(args.tsconfigPath !== undefined && args.tsconfigPath.length > 0 ? { tsconfigPath: args.tsconfigPath } : {}),
        logger,
      });

      return toToolResult(structured);
    }),
  );

  const GetDefinitionsInputSchema = z
    .object({
      root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.'),
      filePath: z.string().describe('Path to the file, relative to root or absolute.'),
      line: z
        .union([z.number(), z.string()])
        .describe('1-based line number (number or numeric string). A non-numeric string is treated as content search.'),
      symbolName: z.string().describe('Name of the symbol to jump to.'),
      before: z.number().int().nonnegative().optional().describe('Number of context lines before the definition. Default 2.'),
      after: z.number().int().nonnegative().optional().describe('Number of context lines after the definition. Default 2.'),
      include_body: z.boolean().optional().describe('If true, include the full function/class body in the preview.'),
      tsconfigPath: z.string().optional().describe('Optional path to tsconfig.json; used by tsgo.'),
    })
    .strict();

  server.registerTool(
    'get_definitions',
    {
      title: 'Get Definitions',
      description:
        'Jump to the definition of a symbol via tsgo LSP and return a source preview. Root defaults to process.cwd(); filePath is relative to root or absolute. Use before/after (default 2) to control context lines. Set include_body=true to get the full function/class body.',
      inputSchema: GetDefinitionsInputSchema,
      outputSchema: z
        .object({ ok: z.boolean(), definitions: z.array(z.any()).optional(), error: z.string().optional() })
        .strict(),
    },
    safeTool(async (args: z.infer<typeof GetDefinitionsInputSchema>) => {
      const rootAbs = resolveRootAbs(args.root);
      const structured = await getDefinitionsUseCase({
        root: rootAbs,
        filePath: args.filePath,
        line: args.line,
        symbolName: args.symbolName,
        ...(args.before !== undefined ? { before: args.before } : {}),
        ...(args.after !== undefined ? { after: args.after } : {}),
        ...(args.include_body !== undefined ? { include_body: args.include_body } : {}),
        ...(args.tsconfigPath !== undefined && args.tsconfigPath.length > 0 ? { tsconfigPath: args.tsconfigPath } : {}),
        logger,
      });

      return toToolResult(structured);
    }),
  );

  const GetDiagnosticsInputSchema = z
    .object({
      root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.'),
      filePath: z.string().describe('Path to the file, relative to root or absolute. Single file only.'),
      timeoutMs: z.number().int().positive().optional().describe('Maximum wait time in ms for large files.'),
      forceRefresh: z.boolean().optional().describe('If true, bypass cache and pull fresh diagnostics.'),
      tsconfigPath: z.string().optional().describe('Optional path to tsconfig.json; used by tsgo.'),
    })
    .strict();

  server.registerTool(
    'get_diagnostics',
    {
      title: 'Get Diagnostics',
      description:
        'Get TypeScript diagnostics (errors, warnings) for a single file via tsgo LSP. Root defaults to process.cwd(); filePath is relative to root or absolute. Use forceRefresh=true to bypass cache. Set timeoutMs to limit wait time for large files.',
      inputSchema: GetDiagnosticsInputSchema,
      outputSchema: z.object({ ok: z.boolean(), diagnostics: z.any().optional(), error: z.string().optional() }).strict(),
    },
    safeTool(async (args: z.infer<typeof GetDiagnosticsInputSchema>) => {
      const rootAbs = resolveRootAbs(args.root);
      const structured = await getDiagnosticsUseCase({
        root: rootAbs,
        filePath: args.filePath,
        ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
        ...(args.forceRefresh !== undefined ? { forceRefresh: args.forceRefresh } : {}),
        ...(args.tsconfigPath !== undefined && args.tsconfigPath.length > 0 ? { tsconfigPath: args.tsconfigPath } : {}),
        logger,
      });

      return toToolResult(structured);
    }),
  );

  const GetAllDiagnosticsInputSchema = z
    .object({
      root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.'),
      tsconfigPath: z.string().optional().describe('Optional path to tsconfig.json; used by tsgo.'),
    })
    .strict();

  server.registerTool(
    'get_all_diagnostics',
    {
      title: 'Get All Diagnostics',
      description:
        'Get TypeScript diagnostics for all files in the project via tsgo LSP workspace diagnostics. Returns errors and warnings across the entire codebase in one call. Note: If the tsgo LSP does not support workspace diagnostics, this returns an error; use get_diagnostics per file instead.',
      inputSchema: GetAllDiagnosticsInputSchema,
      outputSchema: z.object({ ok: z.boolean(), diagnostics: z.any().optional(), error: z.string().optional() }).strict(),
    },
    safeTool(async (args: z.infer<typeof GetAllDiagnosticsInputSchema>) => {
      const rootAbs = resolveRootAbs(args.root);
      const structured = await getAllDiagnosticsUseCase({
        root: rootAbs,
        ...(args.tsconfigPath !== undefined && args.tsconfigPath.length > 0 ? { tsconfigPath: args.tsconfigPath } : {}),
        logger,
      });

      return toToolResult(structured);
    }),
  );

  const GetDocumentSymbolsInputSchema = z
    .object({
      root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.'),
      filePath: z.string().describe('Path to the file, relative to root or absolute.'),
      tsconfigPath: z.string().optional().describe('Optional path to tsconfig.json; used by tsgo.'),
    })
    .strict();

  server.registerTool(
    'get_document_symbols',
    {
      title: 'Get Document Symbols',
      description:
        'List all symbols (functions, classes, variables, types, etc.) in a single file via tsgo LSP. Root defaults to process.cwd(); filePath is relative to root or absolute. Returns a hierarchical symbol tree with names, kinds, and ranges.',
      inputSchema: GetDocumentSymbolsInputSchema,
      outputSchema: z.object({ ok: z.boolean(), symbols: z.any().optional(), error: z.string().optional() }).strict(),
    },
    safeTool(async (args: z.infer<typeof GetDocumentSymbolsInputSchema>) => {
      const rootAbs = resolveRootAbs(args.root);
      const structured = await getDocumentSymbolsUseCase({
        root: rootAbs,
        filePath: args.filePath,
        ...(args.tsconfigPath !== undefined && args.tsconfigPath.length > 0 ? { tsconfigPath: args.tsconfigPath } : {}),
        logger,
      });

      return toToolResult(structured);
    }),
  );

  const GetWorkspaceSymbolsInputSchema = z
    .object({
      root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.'),
      query: z
        .string()
        .optional()
        .describe('Filter symbols by name substring. If omitted, behavior is implementation-dependent.'),
      tsconfigPath: z.string().optional().describe('Optional path to tsconfig.json; used by tsgo.'),
    })
    .strict();

  server.registerTool(
    'get_workspace_symbols',
    {
      title: 'Get Workspace Symbols',
      description:
        'Search for symbols across the entire workspace via tsgo LSP. Root defaults to process.cwd(). Provide a query string to filter by name. Returns matching symbols with their file paths, kinds, and locations.',
      inputSchema: GetWorkspaceSymbolsInputSchema,
      outputSchema: z.object({ ok: z.boolean(), symbols: z.any().optional(), error: z.string().optional() }).strict(),
    },
    safeTool(async (args: z.infer<typeof GetWorkspaceSymbolsInputSchema>) => {
      const rootAbs = resolveRootAbs(args.root);
      const structured = await getWorkspaceSymbolsUseCase({
        root: rootAbs,
        ...(args.query !== undefined && args.query.trim().length > 0 ? { query: args.query } : {}),
        ...(args.tsconfigPath !== undefined && args.tsconfigPath.length > 0 ? { tsconfigPath: args.tsconfigPath } : {}),
        logger,
      });

      return toToolResult(structured);
    }),
  );

  const GetCompletionInputSchema = z
    .object({
      root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.'),
      filePath: z.string().describe('Path to the file, relative to root or absolute.'),
      line: z
        .union([z.number(), z.string()])
        .describe(
          '1-based line number (number or numeric string) for the completion position. A non-numeric string is treated as content search.',
        ),
      character: z.number().int().nonnegative().optional().describe('0-based column for the completion position.'),
      tsconfigPath: z.string().optional().describe('Optional path to tsconfig.json; used by tsgo.'),
    })
    .strict();

  server.registerTool(
    'get_completion',
    {
      title: 'Get Completion',
      description:
        'Get code completion suggestions at a specific cursor position via tsgo LSP. Root defaults to process.cwd(); filePath is relative to root or absolute. line and character specify the position where completion is requested. Returns available completions with labels, kinds, and documentation.',
      inputSchema: GetCompletionInputSchema,
      outputSchema: z.object({ ok: z.boolean(), completion: z.any().optional(), error: z.string().optional() }).strict(),
    },
    safeTool(async (args: z.infer<typeof GetCompletionInputSchema>) => {
      const rootAbs = resolveRootAbs(args.root);
      const structured = await getCompletionUseCase({
        root: rootAbs,
        filePath: args.filePath,
        line: args.line,
        ...(args.character !== undefined ? { character: args.character } : {}),
        ...(args.tsconfigPath !== undefined && args.tsconfigPath.length > 0 ? { tsconfigPath: args.tsconfigPath } : {}),
        logger,
      });

      return toToolResult(structured);
    }),
  );

  const GetSignatureHelpInputSchema = z
    .object({
      root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.'),
      filePath: z.string().describe('Path to the file, relative to root or absolute.'),
      line: z
        .union([z.number(), z.string()])
        .describe(
          '1-based line number (number or numeric string) inside a function/method call. A non-numeric string is treated as content search.',
        ),
      character: z.number().int().nonnegative().optional().describe('0-based column inside the call expression.'),
      tsconfigPath: z.string().optional().describe('Optional path to tsconfig.json; used by tsgo.'),
    })
    .strict();

  server.registerTool(
    'get_signature_help',
    {
      title: 'Get Signature Help',
      description:
        'Get function/method signature help at a cursor position via tsgo LSP. Call this when the cursor is inside a function or method call. Root defaults to process.cwd(); filePath is relative to root or absolute. Returns parameter information, active parameter index, and documentation.',
      inputSchema: GetSignatureHelpInputSchema,
      outputSchema: z.object({ ok: z.boolean(), signatureHelp: z.any().optional(), error: z.string().optional() }).strict(),
    },
    safeTool(async (args: z.infer<typeof GetSignatureHelpInputSchema>) => {
      const rootAbs = resolveRootAbs(args.root);
      const structured = await getSignatureHelpUseCase({
        root: rootAbs,
        filePath: args.filePath,
        line: args.line,
        ...(args.character !== undefined ? { character: args.character } : {}),
        ...(args.tsconfigPath !== undefined && args.tsconfigPath.length > 0 ? { tsconfigPath: args.tsconfigPath } : {}),
        logger,
      });

      return toToolResult(structured);
    }),
  );

  const FormatDocumentInputSchema = z
    .object({
      root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.'),
      filePath: z.string().describe('Path to a file or directory. If directory, formats all .ts/.tsx files recursively.'),
      tsconfigPath: z.string().optional().describe('Optional path to tsconfig.json; used by tsgo.'),
    })
    .strict();

  server.registerTool(
    'format_document',
    {
      title: 'Format Document',
      description:
        'Auto-format TypeScript/JavaScript files using tsgo LSP. Root defaults to process.cwd(); filePath is relative to root or absolute. If filePath is a directory, formats all .ts/.tsx files under it recursively. Returns changed=true and changedCount for the number of modified files.',
      inputSchema: FormatDocumentInputSchema,
      outputSchema: z
        .object({
          ok: z.boolean(),
          changed: z.boolean().optional(),
          changedCount: z.number().optional(),
          error: z.string().optional(),
        })
        .strict(),
    },
    safeTool(async (args: z.infer<typeof FormatDocumentInputSchema>) => {
      if (args.filePath.trim().length === 0) {
        return toToolResult({ ok: false, error: 'filePath is required' });
      }

      const rootAbs = resolveRootAbs(args.root);
      const fileAbs = path.isAbsolute(args.filePath) ? args.filePath : path.resolve(rootAbs, args.filePath);
      // Check if filePath is a directory
      let isDir = false;

      try {
        const stat = await Bun.file(fileAbs).stat();

        isDir = typeof stat.isDirectory === 'function' && stat.isDirectory();
      } catch {
        isDir = false;
      }

      if (isDir) {
        const files = await expandTargets([fileAbs]);
        let changedCount = 0;

        for (const f of files) {
          const r = await formatDocumentUseCase({
            root: rootAbs,
            filePath: f,
            ...(args.tsconfigPath !== undefined && args.tsconfigPath.length > 0 ? { tsconfigPath: args.tsconfigPath } : {}),
            logger,
          });

          if (r.changed) {
            changedCount++;
          }
        }

        const structured = { ok: true, changed: changedCount > 0, changedCount };

        return toToolResult(structured);
      }

      const structured = await formatDocumentUseCase({
        root: rootAbs,
        filePath: args.filePath,
        ...(args.tsconfigPath !== undefined && args.tsconfigPath.length > 0 ? { tsconfigPath: args.tsconfigPath } : {}),
        logger,
      });

      return toToolResult(structured);
    }),
  );

  const GetCodeActionsInputSchema = z
    .object({
      root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.'),
      filePath: z.string().describe('Path to the file, relative to root or absolute.'),
      startLine: z
        .union([z.number(), z.string()])
        .describe('1-based start line of the range (required). Number or numeric string.'),
      endLine: z
        .union([z.number(), z.string()])
        .optional()
        .describe('1-based end line of the range. If omitted, defaults to startLine.'),
      includeKinds: z.array(z.string()).optional().describe('Filter actions by kind (e.g. "quickfix").'),
      tsconfigPath: z.string().optional().describe('Optional path to tsconfig.json; used by tsgo.'),
    })
    .strict();

  server.registerTool(
    'get_code_actions',
    {
      title: 'Get Code Actions',
      description:
        'Get available quick-fixes for a line range via tsgo LSP. startLine is required; endLine is optional. tsgo currently only supports "quickfix" actions (no refactor/extract/inline). Root defaults to process.cwd(); filePath is relative to root or absolute. Use includeKinds to filter.',
      inputSchema: GetCodeActionsInputSchema,
      outputSchema: z.object({ ok: z.boolean(), actions: z.any().optional(), error: z.string().optional() }).strict(),
    },
    safeTool(async (args: z.infer<typeof GetCodeActionsInputSchema>) => {
      const rootAbs = resolveRootAbs(args.root);
      const structured = await getCodeActionsUseCase({
        root: rootAbs,
        filePath: args.filePath,
        startLine: args.startLine,
        ...(args.endLine !== undefined ? { endLine: args.endLine } : {}),
        ...(args.includeKinds !== undefined ? { includeKinds: args.includeKinds } : {}),
        ...(args.tsconfigPath !== undefined && args.tsconfigPath.length > 0 ? { tsconfigPath: args.tsconfigPath } : {}),
        logger,
      });

      return toToolResult(structured);
    }),
  );

  const RenameSymbolInputSchema = z
    .object({
      root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.'),
      filePath: z.string().describe('Path to a file containing the symbol. Absolute path recommended.'),
      line: z
        .union([z.number(), z.string()])
        .optional()
        .describe('1-based line where the symbol appears. If omitted, the first occurrence in the file is used.'),
      symbolName: z.string().describe('Current name of the symbol.'),
      newName: z.string().describe('New name to apply.'),
      tsconfigPath: z.string().optional().describe('Optional path to tsconfig.json; used by tsgo.'),
    })
    .strict();

  server.registerTool(
    'rename_symbol',
    {
      title: 'Rename Symbol',
      description:
        'Rename a symbol across all files in the project via tsgo LSP. Applies changes atomically and returns the list of changed files. filePath is relative to root or absolute (absolute recommended). If line is omitted, the first occurrence in the file is used. Provide symbolName and newName.',
      inputSchema: RenameSymbolInputSchema,
      outputSchema: z
        .object({ ok: z.boolean(), changedFiles: z.array(z.string()).optional(), error: z.string().optional() })
        .strict(),
    },
    safeTool(async (args: z.infer<typeof RenameSymbolInputSchema>) => {
      const rootAbs = resolveRootAbs(args.root);
      const structured = await renameSymbolUseCase({
        root: rootAbs,
        filePath: args.filePath,
        ...(args.line !== undefined ? { line: args.line } : {}),
        symbolName: args.symbolName,
        newName: args.newName,
        ...(args.tsconfigPath !== undefined && args.tsconfigPath.length > 0 ? { tsconfigPath: args.tsconfigPath } : {}),
        logger,
      });

      return toToolResult(structured);
    }),
  );

  const DeleteSymbolInputSchema = z
    .object({
      root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.'),
      filePath: z.string().describe('Path to the file, relative to root or absolute.'),
      line: z
        .union([z.number(), z.string()])
        .describe(
          '1-based line number (number or numeric string) where the symbol appears. A non-numeric string is treated as content search.',
        ),
      symbolName: z.string().describe('Name of the symbol to delete.'),
      tsconfigPath: z.string().optional().describe('Optional path to tsconfig.json; used by tsgo.'),
    })
    .strict();

  server.registerTool(
    'delete_symbol',
    {
      title: 'Delete Symbol',
      description:
        "Delete a symbol's entire definition from the source file. Root defaults to process.cwd(); filePath is relative to root or absolute. line is the 1-based line number (number or numeric string) where the symbol appears. Locates the symbol via tsgo LSP definition lookup, then removes the full declaration block.",
      inputSchema: DeleteSymbolInputSchema,
      outputSchema: z.object({ ok: z.boolean(), changed: z.boolean().optional(), error: z.string().optional() }).strict(),
    },
    safeTool(async (args: z.infer<typeof DeleteSymbolInputSchema>) => {
      const rootAbs = resolveRootAbs(args.root);
      const structured = await deleteSymbolUseCase({
        root: rootAbs,
        filePath: args.filePath,
        line: args.line,
        symbolName: args.symbolName,
        ...(args.tsconfigPath !== undefined && args.tsconfigPath.length > 0 ? { tsconfigPath: args.tsconfigPath } : {}),
        logger,
      });

      return toToolResult(structured);
    }),
  );

  const CheckCapabilitiesInputSchema = z
    .object({
      root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.'),
      tsconfigPath: z.string().optional().describe('Optional path to tsconfig.json; used by tsgo.'),
    })
    .strict();

  server.registerTool(
    'check_capabilities',
    {
      title: 'Check Capabilities',
      description:
        'Report which LSP capabilities the tsgo server supports (hover, references, definition, formatting, etc.). Root defaults to process.cwd(). Useful to check feature availability before calling other LSP tools.',
      inputSchema: CheckCapabilitiesInputSchema,
      outputSchema: z
        .object({ ok: z.boolean(), capabilities: z.any().optional(), error: z.string().optional(), note: z.string().optional() })
        .strict(),
    },
    safeTool(async (args: z.infer<typeof CheckCapabilitiesInputSchema>) => {
      const rootAbs = resolveRootAbs(args.root);
      const structured = await checkCapabilitiesUseCase({
        root: rootAbs,
        ...(args.tsconfigPath !== undefined && args.tsconfigPath.length > 0 ? { tsconfigPath: args.tsconfigPath } : {}),
        logger,
      });

      return toToolResult(structured);
    }),
  );

  // ----
  // Serenity-style edit tools
  // ----

  const ReplaceRangeInputSchema = z
    .object({
      root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.'),
      relativePath: z.string().describe('Path to the file relative to root.'),
      startLine: z.number().int().positive().describe('1-based start line of the range.'),
      startColumn: z.number().int().positive().describe('1-based start column of the range.'),
      endLine: z.number().int().positive().describe('1-based end line of the range.'),
      endColumn: z.number().int().positive().describe('1-based end column of the range.'),
      newText: z.string().describe('Replacement content.'),
    })
    .strict();

  server.registerTool(
    'replace_range',
    {
      title: 'Replace Range',
      description:
        'Replace text in a specific 1-based line/column range within a file. All coordinates are 1-based. relativePath is relative to root. Provide startLine, startColumn, endLine, endColumn and newText.',
      inputSchema: ReplaceRangeInputSchema,
      outputSchema: z
        .object({ ok: z.boolean(), filePath: z.string(), changed: z.boolean(), error: z.string().optional() })
        .strict(),
    },
    safeTool(async (args: z.infer<typeof ReplaceRangeInputSchema>) => {
      const rootAbs = resolveRootAbs(args.root);
      const structured = await replaceRangeUseCase({ ...args, root: rootAbs, logger });

      return toToolResult(structured);
    }),
  );

  const ReplaceRegexInputSchema = z
    .object({
      root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.'),
      relativePath: z.string().describe('Path to the file relative to root.'),
      regex: z.string().describe('Regular expression pattern.'),
      repl: z.string().describe('Replacement string.'),
      allowMultipleOccurrences: z.boolean().optional().describe('If true, replace all matches; otherwise only the first.'),
    })
    .strict();

  server.registerTool(
    'replace_regex',
    {
      title: 'Replace Regex',
      description:
        'Apply a regex-based text replacement across a file using global/multiline/dotAll flags (gms). By default replaces only the first match; set allowMultipleOccurrences=true to replace all matches. relativePath is relative to root.',
      inputSchema: ReplaceRegexInputSchema,
      outputSchema: z
        .object({
          ok: z.boolean(),
          filePath: z.string(),
          changed: z.boolean(),
          matchCount: z.number().optional(),
          error: z.string().optional(),
        })
        .strict(),
    },
    safeTool(async (args: z.infer<typeof ReplaceRegexInputSchema>) => {
      const rootAbs = resolveRootAbs(args.root);
      const structured = await replaceRegexUseCase({
        root: rootAbs,
        relativePath: args.relativePath,
        regex: args.regex,
        repl: args.repl,
        ...(args.allowMultipleOccurrences !== undefined ? { allowMultipleOccurrences: args.allowMultipleOccurrences } : {}),
        logger,
      });

      return toToolResult(structured);
    }),
  );

  const ReplaceSymbolBodyInputSchema = z
    .object({
      root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.'),
      namePath: z.string().describe('Symbol path (e.g. "MyClass.myMethod" or "myFunction").'),
      relativePath: z.string().describe('Path to the file relative to root.'),
      body: z.string().describe('New implementation; omit outer braces.'),
    })
    .strict();

  server.registerTool(
    'replace_symbol_body',
    {
      title: 'Replace Symbol Body',
      description:
        'Replace the entire block body of a function, method, or class identified by namePath (e.g. "MyClass.myMethod" or "myFunction"). The body parameter should contain the new implementation without outer braces.',
      inputSchema: ReplaceSymbolBodyInputSchema,
      outputSchema: z
        .object({ ok: z.boolean(), filePath: z.string(), changed: z.boolean(), error: z.string().optional() })
        .strict(),
    },
    safeTool(async (args: z.infer<typeof ReplaceSymbolBodyInputSchema>) => {
      const rootAbs = resolveRootAbs(args.root);
      const structured = await replaceSymbolBodyUseCase({ ...args, root: rootAbs, logger });

      return toToolResult(structured);
    }),
  );

  const InsertBeforeSymbolInputSchema = z
    .object({
      root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.'),
      namePath: z.string().describe('Symbol to insert before (e.g. "MyClass" or "myFunction").'),
      relativePath: z.string().describe('Path to the file relative to root.'),
      body: z.string().describe('Text to insert (e.g. comment, decorator, or new declaration).'),
    })
    .strict();

  server.registerTool(
    'insert_before_symbol',
    {
      title: 'Insert Before Symbol',
      description:
        'Insert text immediately before a symbol definition identified by namePath (e.g. "MyClass" or "myFunction"). Useful for adding imports, comments, decorators, or new declarations above a symbol. relativePath is relative to root. When supported, insertion is on a new line above the symbol.',
      inputSchema: InsertBeforeSymbolInputSchema,
      outputSchema: z
        .object({ ok: z.boolean(), filePath: z.string(), changed: z.boolean(), error: z.string().optional() })
        .strict(),
    },
    safeTool(async (args: z.infer<typeof InsertBeforeSymbolInputSchema>) => {
      const rootAbs = resolveRootAbs(args.root);
      const structured = await insertBeforeSymbolUseCase({ ...args, root: rootAbs, logger });

      return toToolResult(structured);
    }),
  );

  const InsertAfterSymbolInputSchema = z
    .object({
      root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.'),
      namePath: z.string().describe('Symbol to insert after (e.g. "MyClass" or "myFunction").'),
      relativePath: z.string().describe('Path to the file relative to root.'),
      body: z.string().describe('Text to insert (e.g. related function or export).'),
    })
    .strict();

  server.registerTool(
    'insert_after_symbol',
    {
      title: 'Insert After Symbol',
      description:
        'Insert text immediately after a symbol definition identified by namePath (e.g. "MyClass" or "myFunction"). Useful for adding related functions, exports, or test scaffolding below a symbol. relativePath is relative to root.',
      inputSchema: InsertAfterSymbolInputSchema,
      outputSchema: z
        .object({ ok: z.boolean(), filePath: z.string(), changed: z.boolean(), error: z.string().optional() })
        .strict(),
    },
    safeTool(async (args: z.infer<typeof InsertAfterSymbolInputSchema>) => {
      const rootAbs = resolveRootAbs(args.root);
      const structured = await insertAfterSymbolUseCase({ ...args, root: rootAbs, logger });

      return toToolResult(structured);
    }),
  );

  // ----
  // TypeScript-specific tools (best-effort)
  // ----

  const IndexExternalLibrariesInputSchema = z
    .object({
      root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.'),
      maxFiles: z.number().int().positive().optional().describe('Maximum number of .d.ts files to index.'),
      includePatterns: z.array(z.string()).optional().describe('Package names or path patterns to include (e.g. ["zod"]).'),
      excludePatterns: z.array(z.string()).optional().describe('Package names or path patterns to exclude.'),
    })
    .strict();

  server.registerTool(
    'index_external_libraries',
    {
      title: 'Index External Libraries',
      description:
        'Parse and index TypeScript declaration files (.d.ts) from node_modules into memory for external symbol search. Only .d.ts files under node_modules are indexed. includePatterns and excludePatterns filter by package name or path. Required before using search_external_library_symbols.',
      inputSchema: IndexExternalLibrariesInputSchema,
      outputSchema: z
        .object({ ok: z.boolean(), indexedFiles: z.number(), symbols: z.number(), error: z.string().optional() })
        .strict(),
    },
    safeTool(async (args: z.infer<typeof IndexExternalLibrariesInputSchema>) => {
      const rootAbs = resolveRootAbs(args.root);
      const structured = await indexExternalLibrariesUseCase({
        root: rootAbs,
        ...(args.maxFiles !== undefined ? { maxFiles: args.maxFiles } : {}),
        ...(args.includePatterns !== undefined ? { includePatterns: args.includePatterns } : {}),
        ...(args.excludePatterns !== undefined ? { excludePatterns: args.excludePatterns } : {}),
        logger,
      });

      return toToolResult(structured);
    }),
  );

  const GetTypescriptDependenciesInputSchema = z
    .object({ root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.') })
    .strict();

  server.registerTool(
    'get_typescript_dependencies',
    {
      title: 'Get TypeScript Dependencies',
      description:
        'List all npm dependencies (from package.json) that provide TypeScript type declarations. Checks for bundled types and @types/* packages. Useful for deciding which libraries to index with index_external_libraries.',
      inputSchema: GetTypescriptDependenciesInputSchema,
      outputSchema: z
        .object({
          ok: z.boolean(),
          dependencies: z.array(z.object({ name: z.string(), version: z.string(), hasTypes: z.boolean() })).optional(),
          error: z.string().optional(),
        })
        .strict(),
    },
    safeTool(async (args: z.infer<typeof GetTypescriptDependenciesInputSchema>) => {
      const rootAbs = resolveRootAbs(args.root);
      const structured = await getTypescriptDependenciesUseCase({ root: rootAbs, logger });

      return toToolResult(structured);
    }),
  );

  const SearchExternalLibrarySymbolsInputSchema = z
    .object({
      root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.'),
      libraryName: z.string().optional().describe('Filter by library/package name.'),
      symbolName: z.string().optional().describe('Substring to match symbol names.'),
      kind: z.string().optional().describe('Filter by symbol kind.'),
      limit: z.number().int().positive().optional().describe('Maximum number of matches to return.'),
    })
    .strict();

  server.registerTool(
    'search_external_library_symbols',
    {
      title: 'Search External Library Symbols',
      description:
        'Search symbols from indexed external libraries (node_modules). Filter by libraryName, symbolName substring, and/or kind. Requires index_external_libraries to be run first.',
      inputSchema: SearchExternalLibrarySymbolsInputSchema,
      outputSchema: z.object({ ok: z.boolean(), matches: z.any().optional(), error: z.string().optional() }).strict(),
    },
    safeTool(async (args: z.infer<typeof SearchExternalLibrarySymbolsInputSchema>) => {
      const rootAbs = resolveRootAbs(args.root);
      const structured = await searchExternalLibrarySymbolsUseCase({
        root: rootAbs,
        ...(args.libraryName !== undefined ? { libraryName: args.libraryName } : {}),
        ...(args.symbolName !== undefined ? { symbolName: args.symbolName } : {}),
        ...(args.kind !== undefined ? { kind: args.kind } : {}),
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
      });

      return toToolResult(structured);
    }),
  );

  const GetAvailableExternalSymbolsInputSchema = z
    .object({
      root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.'),
      filePath: z.string().describe('Path to the file, relative to root or absolute.'),
    })
    .strict();

  server.registerTool(
    'get_available_external_symbols',
    {
      title: 'Get Available External Symbols',
      description:
        'List all symbol names that are imported in a given file. Parses import declarations only (named, default, namespace imports). Quick way to see what a file depends on. filePath is relative to root or absolute.',
      inputSchema: GetAvailableExternalSymbolsInputSchema,
      outputSchema: z.object({ ok: z.boolean(), symbols: z.array(z.string()), error: z.string().optional() }).strict(),
    },
    safeTool(async (args: z.infer<typeof GetAvailableExternalSymbolsInputSchema>) => {
      const rootAbs = resolveRootAbs(args.root);
      const structured = await getAvailableExternalSymbolsInFileUseCase({ ...args, root: rootAbs });

      return toToolResult(structured);
    }),
  );

  const ParseImportsInputSchema = z
    .object({
      root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.'),
      filePath: z.string().describe('Path to the file, relative to root or absolute.'),
    })
    .strict();

  server.registerTool(
    'parse_imports',
    {
      title: 'Parse Imports',
      description:
        'Parse all import statements in a file and return structured details: specifier, imported names, type-only status, and resolved paths for relative imports. More detailed than get_available_external_symbols.',
      inputSchema: ParseImportsInputSchema,
      outputSchema: z.object({ ok: z.boolean(), imports: z.any().optional(), error: z.string().optional() }).strict(),
    },
    safeTool(async (args: z.infer<typeof ParseImportsInputSchema>) => {
      const rootAbs = resolveRootAbs(args.root);
      const structured = await parseImportsUseCase({ ...args, root: rootAbs });

      return toToolResult(structured);
    }),
  );

  // ----
  // check_tool_availability: consolidated tool status check
  // ----

  const CheckToolAvailabilityInputSchema = z
    .object({ root: z.string().optional().describe('Project root; defaults to process.cwd() if omitted.') })
    .strict();

  server.registerTool(
    'check_tool_availability',
    {
      title: 'Check Tool Availability',
      description:
        'Check availability of all external tools used by firebat: tsgo (LSP/typecheck), oxlint (linting), and ast-grep (pattern matching). Returns a boolean for each tool and version info when available.',
      inputSchema: CheckToolAvailabilityInputSchema,
      outputSchema: z
        .object({
          tsgo: z.object({ available: z.boolean(), note: z.string().optional() }),
          oxlint: z.object({ available: z.boolean(), note: z.string().optional() }),
          astGrep: z.object({ available: z.boolean() }),
        })
        .strict(),
    },
    safeTool(async (_args: z.infer<typeof CheckToolAvailabilityInputSchema>) => {
      const tsgo = await (async () => {
        if (rootAbs.trim().length === 0) {
          return { available: false, note: 'root missing' };
        }

        try {
          const r = await checkCapabilitiesUseCase({ root: rootAbs, logger });

          return { available: r.ok === true, ...(r.note ? { note: r.note } : {}) };
        } catch {
          return { available: false, note: 'check failed' };
        }
      })();
      const oxlint = await (async () => {
        if (rootAbs.trim().length === 0) {
          return { available: false, note: 'root missing' };
        }

        try {
          const r = await runOxlint({ targets: [], cwd: rootAbs, logger });
          const available = r.ok === true || (r.error !== undefined && !r.error.includes('not available'));

          return { available, ...(r.error && !available ? { note: r.error } : {}) };
        } catch {
          return { available: false, note: 'check failed' };
        }
      })();
      const astGrep = { available: true }; // ast-grep/napi is a bundled dependency, always available.
      const structured = { tsgo, oxlint, astGrep };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
        structuredContent: toStructured(structured),
      };
    }),
  );

  server.registerResource(
    'last-report',
    'report://last',
    {
      title: 'Last Firebat Report',
      description: 'The last FirebatReport produced by scan during this MCP session.',
      mimeType: 'application/json',
    },
    (uri: URL) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(lastReport),
        },
      ],
    }),
  );

  server.registerPrompt(
    'review',
    {
      title: 'Firebat Review',
      description: 'Review a Firebat report and propose prioritized fixes.',
      argsSchema: {
        reportJson: z.string().describe('JSON string of FirebatReport'),
      },
    },
    (args: { reportJson: string }) => {
      const { reportJson } = args;

      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: [
                'You are reviewing a Firebat report.',
                '1) Summarize top risks in priority order.',
                '2) Propose minimal fixes with file-level guidance.',
                '3) Call out anything that looks like a false positive.',
                '',
                reportJson,
              ].join('\n'),
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    'workflow',
    {
      title: 'Firebat Workflow',
      description: 'Recommended indexing, symbol search, and output workflow for this MCP server.',
    },
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              '## Recommended Workflow',
              '',
              '1. `index_symbols` — build the local symbol index (optionally provide `targets`).',
              '2. `search_symbol_from_index` — find symbols by name substring. Use `kind`/`file` to narrow results.',
              '3. LSP tools (`get_definitions`, `find_references`) — precision navigation from a known location.',
              '4. Edit tools (`replace_range`, `replace_regex`, `replace_symbol_body`, `insert_before_symbol`, `insert_after_symbol`) — then re-run `index_symbols` if needed.',
              '',
              '## Choosing Search Strategy',
              '',
              '- **Index search** (`search_symbol_from_index`): when you only have a name hint or want a broad scan.',
              '- **LSP lookup** (`get_definitions` / `find_references`): when you have a concrete location (file + line) and want precise results.',
              '- **Imports** (`parse_imports`, `get_available_external_symbols`): to identify external symbol names quickly.',
              '',
              '## Keeping Outputs Compact',
              '',
              '- Use `get_project_overview` for a quick summary of the project state.',
              '- Use `limit` in `search_symbol_from_index` when you expect many matches.',
              '- Tune `before`/`after` and `include_body` in `get_definitions` to control output size.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  return server;
};

export const runMcpServer = async (): Promise<void> => {
  const ctx = await resolveRuntimeContextFromCwd();

  if (ctx.rootAbs.trim().length === 0) {
    return;
  }

  const loaded = await loadFirebatConfigFile({ rootAbs: ctx.rootAbs }).catch(() => null);
  const config = loaded?.config ?? null;
  const logger = createPrettyConsoleLogger({ level: 'warn' });
  const server = await createFirebatMcpServer({ rootAbs: ctx.rootAbs, config, logger });

  // Bootstrap: ensure symbol index is up-to-date once on server start.
  // Then keep it updated with best-effort directory watchers.
  // IMPORTANT: This is deferred until AFTER `server.connect()` so VS Code clients
  // can connect quickly without hitting tool-call timeouts.
  const bootstrapSymbolIndex = (): void => {
    void (async () => {
      try {
        logger.trace('MCP server: bootstrapping symbol index');

        await indexSymbolsUseCase({ root: ctx.rootAbs, logger });

        const targets = await discoverDefaultTargets(ctx.rootAbs);
        const targetSet = new Set(targets.map(t => path.resolve(t)));
        const dirSet = new Set(targets.map(t => path.dirname(path.resolve(t))));
        const pending = new Set<string>();
        let flushTimer: Timer | null = null;

        const flush = (): void => {
          flushTimer = null;

          if (pending.size === 0) {
            return;
          }

          const batch = Array.from(pending);

          pending.clear();

          void indexSymbolsUseCase({ root: ctx.rootAbs, targets: batch, logger }).catch(() => undefined);
        };

        const scheduleFlush = (): void => {
          if (flushTimer) {
            return;
          }

          flushTimer = setTimeout(flush, 250);
        };

        for (const dirAbs of dirSet) {
          try {
            const w = watch(dirAbs, { persistent: true }, (_event, filename) => {
              if (!filename) {
                return;
              }

              const abs = path.resolve(dirAbs, String(filename));

              if (!targetSet.has(abs)) {
                return;
              }

              pending.add(abs);
              scheduleFlush();
            });

            // Prevent the watcher from keeping large resources if closed.
            w.on('error', () => undefined);
          } catch (err) {
            logger.warn('MCP server: watch failed', { dirAbs, error: String(err) });
            continue;
          }
        }
      } catch {
        // Best-effort: MCP still serves tools even if bootstrap fails.
      }
    })();
  };

  const transport = new StdioServerTransport();

  logger.info('MCP server: connecting transport');

  let cleaningUp = false;

  const cleanup = async (signal: string) => {
    if (cleaningUp) {
      return;
    }

    cleaningUp = true;

    logger.debug('MCP server: cleanup triggered', { signal });

    try {
      const { closeAll } = await import('../../infrastructure/sqlite/firebat.db');

      await closeAll();

      logger.trace('MCP server: DB connections closed');
    } catch (err) {
      logger.warn('MCP server: cleanup error', { error: String(err) });
    }

    try {
      await transport.close();

      logger.debug('MCP server: transport closed');
    } catch (err) {
      logger.warn('MCP server: transport close error', { error: String(err) });
    }
  };

  process.on('SIGTERM', () => {
    void cleanup('SIGTERM');
  });
  process.on('SIGINT', () => {
    void cleanup('SIGINT');
  });

  try {
    await server.connect(transport);
  } catch (err) {
    logger.error('MCP server: connection failed', { error: String(err) });

    await cleanup('connect-error');

    return;
  }

  // Handle transport errors (e.g., EPIPE)
  transport.onerror = (error: Error) => {
    logger.warn('MCP server: transport error', { error: String(error) });

    void cleanup('transport-error');
  };

  transport.onclose = () => {
    logger.debug('MCP server: transport closed');

    void cleanup('transport-close');
  };

  logger.info('MCP server: connected and ready');

  bootstrapSymbolIndex();
};
