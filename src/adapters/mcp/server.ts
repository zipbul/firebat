import * as z from 'zod';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import type { FirebatCliOptions } from '../../interfaces';
import type { FirebatDetector, FirebatReport } from '../../types';

import { scanUseCase } from '../../application/scan/scan.usecase';
import { discoverDefaultTargets, expandTargets } from '../../target-discovery';
import { findPatternUseCase } from '../../application/find-pattern/find-pattern.usecase';
import {
  deleteMemoryUseCase,
  listMemoriesUseCase,
  readMemoryUseCase,
  writeMemoryUseCase,
} from '../../application/memory/memory.usecases';
import {
  clearIndexUseCase,
  getIndexStatsFromIndexUseCase,
  indexSymbolsUseCase,
  searchSymbolFromIndexUseCase,
} from '../../application/symbol-index/symbol-index.usecases';
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
  resolveSymbolUseCase,
  searchExternalLibrarySymbolsUseCase,
} from '../../application/lsp/lsp.usecases';
import {
  insertAfterSymbolUseCase,
  insertBeforeSymbolUseCase,
  replaceRangeUseCase,
  replaceRegexUseCase,
  replaceSymbolBodyUseCase,
} from '../../application/editor/edit.usecases';
import { getSymbolsOverviewUseCase, querySymbolsUseCase } from '../../application/symbols/symbol-tools.usecases';
import { traceSymbolUseCase } from '../../application/trace/trace-symbol.usecase';
import { runOxlint } from '../../infrastructure/oxlint/oxlint-runner';
import { readdir } from 'node:fs/promises';
import { watch } from 'node:fs';
import * as path from 'node:path';
import { resolveRuntimeContextFromCwd } from '../../runtime-context';
import { loadFirebatConfigFile, resolveDefaultFirebatRcPath } from '../../firebat-config.loader';
import type { FirebatConfig } from '../../firebat-config';

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
    const value = (features as any)[detector];
    return value !== false;
  });
};

const resolveMinSizeFromFeatures = (features: FirebatConfig['features'] | undefined): number | 'auto' | undefined => {
  const exact = features?.['exact-duplicates'];
  const structural = features?.['structural-duplicates'];
  const exactSize = typeof exact === 'object' && exact !== null ? exact.minSize : undefined;
  const structuralSize = typeof structural === 'object' && structural !== null ? structural.minSize : undefined;

  if (exactSize !== undefined && structuralSize !== undefined && exactSize !== structuralSize) {
    throw new Error("[firebat] Invalid config: features.structural-duplicates.minSize must match features.exact-duplicates.minSize");
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
  const value = (features as any)?.['unknown-proof'];

  if (value === undefined || value === false) {
    return undefined;
  }

  if (value === true) {
    // Global by default: do not apply boundary matching unless explicitly configured.
    return undefined;
  }

  if (typeof value === 'object' && value !== null) {
    const boundaryGlobs = (value as any).boundaryGlobs;
    return Array.isArray(boundaryGlobs) && boundaryGlobs.every((e: any) => typeof e === 'string')
      ? boundaryGlobs
      : undefined;
  }

  return undefined;
};

const resolveBarrelPolicyIgnoreGlobsFromFeatures = (
  features: FirebatConfig['features'] | undefined,
): ReadonlyArray<string> | undefined => {
  const value = (features as any)?.['barrel-policy'];

  if (value === undefined || value === false) {
    return undefined;
  }

  if (value === true) {
    return undefined;
  }

  if (typeof value === 'object' && value !== null) {
    const ignoreGlobs = (value as any).ignoreGlobs;
    return Array.isArray(ignoreGlobs) && ignoreGlobs.every((e: any) => typeof e === 'string') ? ignoreGlobs : undefined;
  }

  return undefined;
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

  const out: any = { ...(root ?? {}) };

  for (const detector of ALL_DETECTORS) {
    const override = (overrides as any)[detector];

    if (override === undefined || override === 'inherit') {
      continue;
    }

    out[detector] = override;
  }

  return out;
};

const nowMs = (): number => {
  // Bun supports performance.now()
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
};

const runMcpServer = async (): Promise<void> => {
  // MCP process constraints:
  // - No `process.exit()` calls (transport stability)
  // - No stdout logs (reserved for protocol messages)

  const ctx = await resolveRuntimeContextFromCwd();

  let config: FirebatConfig | null = null;

  try {
    const configPath = resolveDefaultFirebatRcPath(ctx.rootAbs);
    const loaded = await loadFirebatConfigFile({ rootAbs: ctx.rootAbs, configPath });
    config = loaded.config;
  } catch {
    // Best-effort: ignore config errors in MCP (no stdout logging).
  }

  const server: any = new McpServer({
    name: 'firebat',
    version: '2.0.0-strict',
  });
  let lastReport: FirebatReport | null = null;

  // Bootstrap: ensure symbol index is up-to-date once on server start.
  // Then keep it updated with best-effort directory watchers.
  try {
    await indexSymbolsUseCase({ root: ctx.rootAbs });

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

      void indexSymbolsUseCase({ root: ctx.rootAbs, targets: batch }).catch(() => undefined);
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
      } catch {
        continue;
      }
    }
  } catch {
    // Best-effort: MCP still serves tools even if bootstrap fails.
  }
  const ScanInputSchema = z
    .object({
      targets: z.array(z.string()).optional(),
      detectors: z.array(z.string()).optional(),
      minSize: z.union([z.number().int().nonnegative(), z.literal('auto')]).optional(),
      maxForwardDepth: z.number().int().nonnegative().optional(),
    })
    .strict();

  server.registerTool(
    'scan',
    {
      title: 'Scan',
      description: 'Analyze targets and return FirebatReport (JSON).',
      inputSchema: ScanInputSchema,
      outputSchema: z
        .object({
          report: z.any(),
          timings: z.object({ totalMs: z.number() }),
        })
        .strict(),
    },
    async (args: z.infer<typeof ScanInputSchema>) => {
      const t0 = nowMs();
      const rawTargets =
        args.targets !== undefined && args.targets.length > 0 ? args.targets : await discoverDefaultTargets(ctx.rootAbs);
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
      const report = await scanUseCase(options);

      lastReport = report;

      const totalMs = nowMs() - t0;
      const structured = { report, timings: { totalMs } };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
        structuredContent: structured,
      };
    },
  );

  const FindPatternInputSchema = z
    .object({
      targets: z.array(z.string()).optional(),
      rule: JsonValueSchema.optional(),
      matcher: JsonValueSchema.optional(),
      ruleName: z.string().optional(),
    })
    .strict();

  server.registerTool(
    'find_pattern',
    {
      title: 'Find Pattern',
      description: 'Run ast-grep rule matching across targets (structured rule/matcher).',
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
    async (args: z.infer<typeof FindPatternInputSchema>) => {
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
      };
      const matches = await findPatternUseCase(request);
      const structured = { matches };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
        structuredContent: structured,
      };
    },
  );

  const TraceSymbolInputSchema = z
    .object({
      entryFile: z.string(),
      symbol: z.string(),
      tsconfigPath: z.string().optional(),
      maxDepth: z.number().int().nonnegative().optional(),
    })
    .strict();

  server.registerTool(
    'trace_symbol',
    {
      title: 'Trace Symbol',
      description: 'Type-aware symbol tracing via tsgo.',
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
    async (args: z.infer<typeof TraceSymbolInputSchema>) => {
      const request: Parameters<typeof traceSymbolUseCase>[0] = {
        entryFile: args.entryFile,
        symbol: args.symbol,
        ...(args.tsconfigPath !== undefined ? { tsconfigPath: args.tsconfigPath } : {}),
        ...(args.maxDepth !== undefined ? { maxDepth: args.maxDepth } : {}),
      };
      const structured = await traceSymbolUseCase(request);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
        structuredContent: structured,
      };
    },
  );

  const LintInputSchema = z
    .object({
      targets: z.array(z.string()),
      configPath: z.string().optional(),
    })
    .strict();

  server.registerTool(
    'lint',
    {
      title: 'Lint',
      description: 'Run oxlint and return normalized diagnostics (best-effort).',
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
    async (args: z.infer<typeof LintInputSchema>) => {
      const request: Parameters<typeof runOxlint>[0] = {
        targets: args.targets,
        ...(args.configPath !== undefined ? { configPath: args.configPath } : {}),
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
        structuredContent: structured,
      };
    },
  );

  const ListDirInputSchema = z
    .object({
      root: z.string().optional(),
      relativePath: z.string(),
    })
    .strict();

  server.registerTool(
    'list_dir',
    {
      title: 'List Dir',
      description: 'List directory entries (best-effort, non-recursive).',
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
    async (args: z.infer<typeof ListDirInputSchema>) => {
      const cwd = process.cwd();
      const root = args.root !== undefined && args.root.trim().length > 0 ? args.root.trim() : cwd;
      const absRoot = path.isAbsolute(root) ? root : path.resolve(cwd, root);
      const absPath = path.resolve(absRoot, args.relativePath);
      const dirents = await readdir(absPath, { withFileTypes: true });
      const entries = dirents.map(d => ({ name: d.name, isDir: d.isDirectory() }));
      const structured = { entries };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
        structuredContent: structured,
      };
    },
  );

  const ListMemoriesInputSchema = z.object({ root: z.string().optional() }).strict();

  server.registerTool(
    'list_memories',
    {
      title: 'List Memories',
      description: 'List stored memory keys for the given root.',
      inputSchema: ListMemoriesInputSchema,
      outputSchema: z
        .object({
          memories: z.array(z.object({ memoryKey: z.string(), updatedAt: z.number() })),
        })
        .strict(),
    },
    async (args: z.infer<typeof ListMemoriesInputSchema>) => {
      const memories = await listMemoriesUseCase((args.root !== undefined ? { root: args.root } : {}));
      const structured = { memories };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
        structuredContent: structured,
      };
    },
  );

  const ReadMemoryInputSchema = z.object({ root: z.string().optional(), memoryKey: z.string() }).strict();

  server.registerTool(
    'read_memory',
    {
      title: 'Read Memory',
      description: 'Read a memory record by key.',
      inputSchema: ReadMemoryInputSchema,
      outputSchema: z
        .object({
          found: z.boolean(),
          memoryKey: z.string(),
          value: z.any().optional(),
        })
        .strict(),
    },
    async (args: z.infer<typeof ReadMemoryInputSchema>) => {
      const rec = await readMemoryUseCase({
        ...(args.root !== undefined ? { root: args.root } : {}),
        memoryKey: args.memoryKey,
      });
      const structured = rec ? { found: true, memoryKey: args.memoryKey, value: rec.value } : { found: false, memoryKey: args.memoryKey };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
        structuredContent: structured,
      };
    },
  );

  const WriteMemoryInputSchema = z
    .object({ root: z.string().optional(), memoryKey: z.string(), value: JsonValueSchema })
    .strict();

  server.registerTool(
    'write_memory',
    {
      title: 'Write Memory',
      description: 'Write a memory record (JSON).',
      inputSchema: WriteMemoryInputSchema,
      outputSchema: z
        .object({ ok: z.boolean(), memoryKey: z.string() })
        .strict(),
    },
    async (args: z.infer<typeof WriteMemoryInputSchema>) => {
      await writeMemoryUseCase({
        ...(args.root !== undefined ? { root: args.root } : {}),
        memoryKey: args.memoryKey,
        value: args.value,
      });

      const structured = { ok: true, memoryKey: args.memoryKey };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
        structuredContent: structured,
      };
    },
  );

  const DeleteMemoryInputSchema = z.object({ root: z.string().optional(), memoryKey: z.string() }).strict();

  server.registerTool(
    'delete_memory',
    {
      title: 'Delete Memory',
      description: 'Delete a memory record by key.',
      inputSchema: DeleteMemoryInputSchema,
      outputSchema: z
        .object({ ok: z.boolean(), memoryKey: z.string() })
        .strict(),
    },
    async (args: z.infer<typeof DeleteMemoryInputSchema>) => {
      await deleteMemoryUseCase({
        ...(args.root !== undefined ? { root: args.root } : {}),
        memoryKey: args.memoryKey,
      });

      const structured = { ok: true, memoryKey: args.memoryKey };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
        structuredContent: structured,
      };
    },
  );

  // ----
  // LSMCP Index & Project (subset): symbol index/search
  // ----

  const IndexSymbolsInputSchema = z.object({ root: z.string().optional(), targets: z.array(z.string()).optional() }).strict();

  server.registerTool(
    'index_symbols',
    {
      title: 'Index Symbols',
      description: 'Index symbols for the given targets (best-effort).',
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
    async (args: z.infer<typeof IndexSymbolsInputSchema>) => {
      const t0 = nowMs();
      const result = await indexSymbolsUseCase({
        ...(args.root !== undefined ? { root: args.root } : {}),
        ...(args.targets !== undefined ? { targets: args.targets } : {}),
      });
      const totalMs = nowMs() - t0;
      const structured = { ...result, timings: { totalMs } };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
        structuredContent: structured,
      };
    },
  );

  const SearchSymbolFromIndexInputSchema = z
    .object({
      root: z.string().optional(),
      query: z.string(),
      limit: z.number().int().positive().optional(),
    })
    .strict();

  server.registerTool(
    'search_symbol_from_index',
    {
      title: 'Search Symbol From Index',
      description: 'Search indexed symbols by substring match on name.',
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
            }),
          ),
        })
        .strict(),
    },
    async (args: z.infer<typeof SearchSymbolFromIndexInputSchema>) => {
      const matches = await searchSymbolFromIndexUseCase({
        ...(args.root !== undefined ? { root: args.root } : {}),
        query: args.query,
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
      });
      const structured = { matches };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
        structuredContent: structured,
      };
    },
  );

  // LSMCP name drift: provide `search_symbols` as an alias of `search_symbol_from_index`.
  server.registerTool(
    'search_symbols',
    {
      title: 'Search Symbols',
      description: 'Alias of search_symbol_from_index (name drift compatibility).',
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
            }),
          ),
        })
        .strict(),
    },
    async (args: z.infer<typeof SearchSymbolFromIndexInputSchema>) => {
      const matches = await searchSymbolFromIndexUseCase({
        ...(args.root !== undefined ? { root: args.root } : {}),
        query: args.query,
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
      });
      const structured = { matches };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
        structuredContent: structured,
      };
    },
  );

  const GetIndexStatsFromIndexInputSchema = z.object({ root: z.string().optional() }).strict();

  server.registerTool(
    'get_index_stats_from_index',
    {
      title: 'Get Index Stats From Index',
      description: 'Get basic stats for the symbol index.',
      inputSchema: GetIndexStatsFromIndexInputSchema,
      outputSchema: z
        .object({
          indexedFileCount: z.number(),
          symbolCount: z.number(),
          lastIndexedAt: z.number().nullable(),
        })
        .strict(),
    },
    async (args: z.infer<typeof GetIndexStatsFromIndexInputSchema>) => {
      const structured = await getIndexStatsFromIndexUseCase((args.root !== undefined ? { root: args.root } : {}));

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
        structuredContent: structured,
      };
    },
  );

  const ClearIndexInputSchema = z.object({ root: z.string().optional() }).strict();

  server.registerTool(
    'clear_index',
    {
      title: 'Clear Index',
      description: 'Delete all symbol index data for the given root.',
      inputSchema: ClearIndexInputSchema,
      outputSchema: z
        .object({ ok: z.boolean() })
        .strict(),
    },
    async (args: z.infer<typeof ClearIndexInputSchema>) => {
      await clearIndexUseCase((args.root !== undefined ? { root: args.root } : {}));

      const structured = { ok: true };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
        structuredContent: structured,
      };
    },
  );

  const GetProjectOverviewInputSchema = z.object({ root: z.string().optional() }).strict();

  server.registerTool(
    'get_project_overview',
    {
      title: 'Get Project Overview',
      description: 'Return basic project overview information (currently: symbol index stats).',
      inputSchema: GetProjectOverviewInputSchema,
      outputSchema: z
        .object({
          symbolIndex: z.object({
            indexedFileCount: z.number(),
            symbolCount: z.number(),
            lastIndexedAt: z.number().nullable(),
          }),
        })
        .strict(),
    },
    async (args: z.infer<typeof GetProjectOverviewInputSchema>) => {
      const symbolIndex = await getIndexStatsFromIndexUseCase((args.root !== undefined ? { root: args.root } : {}));
      const structured = { symbolIndex };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
        structuredContent: structured,
      };
    },
  );

  // ----
  // LSP-common tools (via tsgo LSP)
  // ----

  const GetHoverInputSchema = z
    .object({
      root: z.string(),
      filePath: z.string(),
      line: z.union([z.number(), z.string()]),
      character: z.number().int().nonnegative().optional(),
      target: z.string().optional(),
      tsconfigPath: z.string().optional(),
    })
    .strict();

  server.registerTool(
    'get_hover',
    {
      title: 'Get Hover',
      description: 'Get hover/type information at a position or for a target string (tsgo LSP).',
      inputSchema: GetHoverInputSchema,
      outputSchema: z.object({ ok: z.boolean(), hover: z.any().optional(), error: z.string().optional(), note: z.string().optional() }).strict(),
    },
    async (args: z.infer<typeof GetHoverInputSchema>) => {
      const structured = await getHoverUseCase({
        root: args.root,
        filePath: args.filePath,
        line: args.line,
        ...(args.character !== undefined ? { character: args.character } : {}),
        ...(args.target !== undefined ? { target: args.target } : {}),
        ...(args.tsconfigPath !== undefined && args.tsconfigPath.length > 0 ? { tsconfigPath: args.tsconfigPath } : {}),
      });

      return { content: [{ type: 'text' as const, text: JSON.stringify(structured) }], structuredContent: structured };
    },
  );

  const FindReferencesInputSchema = z
    .object({
      root: z.string(),
      filePath: z.string(),
      line: z.union([z.number(), z.string()]),
      symbolName: z.string(),
      tsconfigPath: z.string().optional(),
    })
    .strict();

  server.registerTool(
    'find_references',
    {
      title: 'Find References',
      description: 'Find all references to a symbol (tsgo LSP).',
      inputSchema: FindReferencesInputSchema,
      outputSchema: z.object({ ok: z.boolean(), references: z.array(z.any()).optional(), error: z.string().optional() }).strict(),
    },
    async (args: z.infer<typeof FindReferencesInputSchema>) => {
      const structured = await findReferencesUseCase({
        root: args.root,
        filePath: args.filePath,
        line: args.line,
        symbolName: args.symbolName,
        ...(args.tsconfigPath !== undefined && args.tsconfigPath.length > 0 ? { tsconfigPath: args.tsconfigPath } : {}),
      });

      return { content: [{ type: 'text' as const, text: JSON.stringify(structured) }], structuredContent: structured };
    },
  );

  const GetDefinitionsInputSchema = z
    .object({
      root: z.string(),
      filePath: z.string(),
      line: z.union([z.number(), z.string()]),
      symbolName: z.string(),
      before: z.number().int().nonnegative().optional(),
      after: z.number().int().nonnegative().optional(),
      include_body: z.boolean().optional(),
      tsconfigPath: z.string().optional(),
    })
    .strict();

  server.registerTool(
    'get_definitions',
    {
      title: 'Get Definitions',
      description: 'Go to definition with preview (tsgo LSP).',
      inputSchema: GetDefinitionsInputSchema,
      outputSchema: z.object({ ok: z.boolean(), definitions: z.array(z.any()).optional(), error: z.string().optional() }).strict(),
    },
    async (args: z.infer<typeof GetDefinitionsInputSchema>) => {
      const structured = await getDefinitionsUseCase({
        root: args.root,
        filePath: args.filePath,
        line: args.line,
        symbolName: args.symbolName,
        ...(args.before !== undefined ? { before: args.before } : {}),
        ...(args.after !== undefined ? { after: args.after } : {}),
        ...(args.include_body !== undefined ? { include_body: args.include_body } : {}),
        ...(args.tsconfigPath !== undefined && args.tsconfigPath.length > 0 ? { tsconfigPath: args.tsconfigPath } : {}),
      });

      return { content: [{ type: 'text' as const, text: JSON.stringify(structured) }], structuredContent: structured };
    },
  );

  const GetDiagnosticsInputSchema = z
    .object({
      root: z.string(),
      filePath: z.string(),
      timeoutMs: z.number().int().positive().optional(),
      forceRefresh: z.boolean().optional(),
      tsconfigPath: z.string().optional(),
    })
    .strict();

  server.registerTool(
    'get_diagnostics',
    {
      title: 'Get Diagnostics',
      description: 'Get diagnostics for a file (pull diagnostics; server dependent).',
      inputSchema: GetDiagnosticsInputSchema,
      outputSchema: z.object({ ok: z.boolean(), diagnostics: z.any().optional(), error: z.string().optional() }).strict(),
    },
    async (args: z.infer<typeof GetDiagnosticsInputSchema>) => {
      const structured = await getDiagnosticsUseCase({
        root: args.root,
        filePath: args.filePath,
        ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
        ...(args.forceRefresh !== undefined ? { forceRefresh: args.forceRefresh } : {}),
        ...(args.tsconfigPath !== undefined && args.tsconfigPath.length > 0 ? { tsconfigPath: args.tsconfigPath } : {}),
      });

      return { content: [{ type: 'text' as const, text: JSON.stringify(structured) }], structuredContent: structured };
    },
  );

  const GetAllDiagnosticsInputSchema = z.object({ root: z.string(), tsconfigPath: z.string().optional() }).strict();

  server.registerTool(
    'get_all_diagnostics',
    {
      title: 'Get All Diagnostics',
      description: 'Project-wide diagnostics (workspace/diagnostic; server dependent).',
      inputSchema: GetAllDiagnosticsInputSchema,
      outputSchema: z.object({ ok: z.boolean(), diagnostics: z.any().optional(), error: z.string().optional() }).strict(),
    },
    async (args: z.infer<typeof GetAllDiagnosticsInputSchema>) => {
      const structured = await getAllDiagnosticsUseCase({
        root: args.root,
        ...(args.tsconfigPath !== undefined && args.tsconfigPath.length > 0 ? { tsconfigPath: args.tsconfigPath } : {}),
      });

      return { content: [{ type: 'text' as const, text: JSON.stringify(structured) }], structuredContent: structured };
    },
  );

  const GetDocumentSymbolsInputSchema = z.object({ root: z.string(), filePath: z.string(), tsconfigPath: z.string().optional() }).strict();

  server.registerTool(
    'get_document_symbols',
    {
      title: 'Get Document Symbols',
      description: 'List all symbols in a document (tsgo LSP).',
      inputSchema: GetDocumentSymbolsInputSchema,
      outputSchema: z.object({ ok: z.boolean(), symbols: z.any().optional(), error: z.string().optional() }).strict(),
    },
    async (args: z.infer<typeof GetDocumentSymbolsInputSchema>) => {
      const structured = await getDocumentSymbolsUseCase({
        root: args.root,
        filePath: args.filePath,
        ...(args.tsconfigPath !== undefined && args.tsconfigPath.length > 0 ? { tsconfigPath: args.tsconfigPath } : {}),
      });

      return { content: [{ type: 'text' as const, text: JSON.stringify(structured) }], structuredContent: structured };
    },
  );

  const GetWorkspaceSymbolsInputSchema = z.object({ root: z.string(), query: z.string().optional(), tsconfigPath: z.string().optional() }).strict();

  server.registerTool(
    'get_workspace_symbols',
    {
      title: 'Get Workspace Symbols',
      description: 'Workspace symbol search (tsgo LSP).',
      inputSchema: GetWorkspaceSymbolsInputSchema,
      outputSchema: z.object({ ok: z.boolean(), symbols: z.any().optional(), error: z.string().optional() }).strict(),
    },
    async (args: z.infer<typeof GetWorkspaceSymbolsInputSchema>) => {
      const structured = await getWorkspaceSymbolsUseCase({
        root: args.root,
        ...(args.query !== undefined && args.query.trim().length > 0 ? { query: args.query } : {}),
        ...(args.tsconfigPath !== undefined && args.tsconfigPath.length > 0 ? { tsconfigPath: args.tsconfigPath } : {}),
      });

      return { content: [{ type: 'text' as const, text: JSON.stringify(structured) }], structuredContent: structured };
    },
  );

  const GetCompletionInputSchema = z
    .object({
      root: z.string(),
      filePath: z.string(),
      line: z.union([z.number(), z.string()]),
      character: z.number().int().nonnegative().optional(),
      tsconfigPath: z.string().optional(),
    })
    .strict();

  server.registerTool(
    'get_completion',
    {
      title: 'Get Completion',
      description: 'Completion at a position (tsgo LSP).',
      inputSchema: GetCompletionInputSchema,
      outputSchema: z.object({ ok: z.boolean(), completion: z.any().optional(), error: z.string().optional() }).strict(),
    },
    async (args: z.infer<typeof GetCompletionInputSchema>) => {
      const structured = await getCompletionUseCase({
        root: args.root,
        filePath: args.filePath,
        line: args.line,
        ...(args.character !== undefined ? { character: args.character } : {}),
        ...(args.tsconfigPath !== undefined && args.tsconfigPath.length > 0 ? { tsconfigPath: args.tsconfigPath } : {}),
      });

      return { content: [{ type: 'text' as const, text: JSON.stringify(structured) }], structuredContent: structured };
    },
  );

  const GetSignatureHelpInputSchema = z
    .object({
      root: z.string(),
      filePath: z.string(),
      line: z.union([z.number(), z.string()]),
      character: z.number().int().nonnegative().optional(),
      tsconfigPath: z.string().optional(),
    })
    .strict();

  server.registerTool(
    'get_signature_help',
    {
      title: 'Get Signature Help',
      description: 'Signature help at a position (tsgo LSP).',
      inputSchema: GetSignatureHelpInputSchema,
      outputSchema: z.object({ ok: z.boolean(), signatureHelp: z.any().optional(), error: z.string().optional() }).strict(),
    },
    async (args: z.infer<typeof GetSignatureHelpInputSchema>) => {
      const structured = await getSignatureHelpUseCase({
        root: args.root,
        filePath: args.filePath,
        line: args.line,
        ...(args.character !== undefined ? { character: args.character } : {}),
        ...(args.tsconfigPath !== undefined && args.tsconfigPath.length > 0 ? { tsconfigPath: args.tsconfigPath } : {}),
      });

      return { content: [{ type: 'text' as const, text: JSON.stringify(structured) }], structuredContent: structured };
    },
  );

  const FormatDocumentInputSchema = z.object({ root: z.string(), filePath: z.string(), tsconfigPath: z.string().optional() }).strict();

  server.registerTool(
    'format_document',
    {
      title: 'Format Document',
      description: 'Format the entire document (tsgo LSP).',
      inputSchema: FormatDocumentInputSchema,
      outputSchema: z.object({ ok: z.boolean(), changed: z.boolean().optional(), error: z.string().optional() }).strict(),
    },
    async (args: z.infer<typeof FormatDocumentInputSchema>) => {
      const structured = await formatDocumentUseCase({
        root: args.root,
        filePath: args.filePath,
        ...(args.tsconfigPath !== undefined && args.tsconfigPath.length > 0 ? { tsconfigPath: args.tsconfigPath } : {}),
      });

      return { content: [{ type: 'text' as const, text: JSON.stringify(structured) }], structuredContent: structured };
    },
  );

  const GetCodeActionsInputSchema = z
    .object({
      root: z.string(),
      filePath: z.string(),
      startLine: z.union([z.number(), z.string()]),
      endLine: z.union([z.number(), z.string()]).optional(),
      includeKinds: z.array(z.string()).optional(),
      tsconfigPath: z.string().optional(),
    })
    .strict();

  server.registerTool(
    'get_code_actions',
    {
      title: 'Get Code Actions',
      description: 'Get available code actions for a line range (tsgo LSP).',
      inputSchema: GetCodeActionsInputSchema,
      outputSchema: z.object({ ok: z.boolean(), actions: z.any().optional(), error: z.string().optional() }).strict(),
    },
    async (args: z.infer<typeof GetCodeActionsInputSchema>) => {
      const structured = await getCodeActionsUseCase({
        root: args.root,
        filePath: args.filePath,
        startLine: args.startLine,
        ...(args.endLine !== undefined ? { endLine: args.endLine } : {}),
        ...(args.includeKinds !== undefined ? { includeKinds: args.includeKinds } : {}),
        ...(args.tsconfigPath !== undefined && args.tsconfigPath.length > 0 ? { tsconfigPath: args.tsconfigPath } : {}),
      });

      return { content: [{ type: 'text' as const, text: JSON.stringify(structured) }], structuredContent: structured };
    },
  );

  const RenameSymbolInputSchema = z
    .object({
      root: z.string(),
      filePath: z.string(),
      line: z.union([z.number(), z.string()]).optional(),
      symbolName: z.string(),
      newName: z.string(),
      tsconfigPath: z.string().optional(),
    })
    .strict();

  server.registerTool(
    'rename_symbol',
    {
      title: 'Rename Symbol',
      description: 'Rename a symbol project-wide (tsgo LSP).',
      inputSchema: RenameSymbolInputSchema,
      outputSchema: z
        .object({ ok: z.boolean(), changedFiles: z.array(z.string()).optional(), error: z.string().optional() })
        .strict(),
    },
    async (args: z.infer<typeof RenameSymbolInputSchema>) => {
      const structured = await renameSymbolUseCase({
        root: args.root,
        filePath: args.filePath,
        ...(args.line !== undefined ? { line: args.line } : {}),
        symbolName: args.symbolName,
        newName: args.newName,
        ...(args.tsconfigPath !== undefined && args.tsconfigPath.length > 0 ? { tsconfigPath: args.tsconfigPath } : {}),
      });

      return { content: [{ type: 'text' as const, text: JSON.stringify(structured) }], structuredContent: structured };
    },
  );

  const DeleteSymbolInputSchema = z
    .object({
      root: z.string(),
      filePath: z.string(),
      line: z.union([z.number(), z.string()]),
      symbolName: z.string(),
      tsconfigPath: z.string().optional(),
    })
    .strict();

  server.registerTool(
    'delete_symbol',
    {
      title: 'Delete Symbol',
      description: 'Delete symbol definition (best-effort, via LSP definition lookup).',
      inputSchema: DeleteSymbolInputSchema,
      outputSchema: z.object({ ok: z.boolean(), changed: z.boolean().optional(), error: z.string().optional() }).strict(),
    },
    async (args: z.infer<typeof DeleteSymbolInputSchema>) => {
      const structured = await deleteSymbolUseCase({
        root: args.root,
        filePath: args.filePath,
        line: args.line,
        symbolName: args.symbolName,
        ...(args.tsconfigPath !== undefined && args.tsconfigPath.length > 0 ? { tsconfigPath: args.tsconfigPath } : {}),
      });

      return { content: [{ type: 'text' as const, text: JSON.stringify(structured) }], structuredContent: structured };
    },
  );

  const CheckCapabilitiesInputSchema = z.object({ root: z.string(), tsconfigPath: z.string().optional() }).strict();

  server.registerTool(
    'check_capabilities',
    {
      title: 'Check Capabilities',
      description: 'Report supported LSP capabilities (tsgo LSP).',
      inputSchema: CheckCapabilitiesInputSchema,
      outputSchema: z.object({ ok: z.boolean(), capabilities: z.any().optional(), error: z.string().optional(), note: z.string().optional() }).strict(),
    },
    async (args: z.infer<typeof CheckCapabilitiesInputSchema>) => {
      const structured = await checkCapabilitiesUseCase({
        root: args.root,
        ...(args.tsconfigPath !== undefined && args.tsconfigPath.length > 0 ? { tsconfigPath: args.tsconfigPath } : {}),
      });

      return { content: [{ type: 'text' as const, text: JSON.stringify(structured) }], structuredContent: structured };
    },
  );

  // ----
  // Serenity-style edit tools
  // ----

  const ReplaceRangeInputSchema = z
    .object({
      root: z.string(),
      relativePath: z.string(),
      startLine: z.number().int().positive(),
      startColumn: z.number().int().positive(),
      endLine: z.number().int().positive(),
      endColumn: z.number().int().positive(),
      newText: z.string(),
    })
    .strict();

  server.registerTool(
    'replace_range',
    {
      title: 'Replace Range',
      description: 'Replace a specific 1-based line/column range in a file.',
      inputSchema: ReplaceRangeInputSchema,
      outputSchema: z.object({ ok: z.boolean(), filePath: z.string(), changed: z.boolean(), error: z.string().optional() }).strict(),
    },
    async (args: z.infer<typeof ReplaceRangeInputSchema>) => {
      const structured = await replaceRangeUseCase(args);

      return { content: [{ type: 'text' as const, text: JSON.stringify(structured) }], structuredContent: structured };
    },
  );

  const ReplaceRegexInputSchema = z
    .object({
      root: z.string(),
      relativePath: z.string(),
      regex: z.string(),
      repl: z.string(),
      allowMultipleOccurrences: z.boolean().optional(),
    })
    .strict();

  server.registerTool(
    'replace_regex',
    {
      title: 'Replace Regex',
      description: 'Regex-based replacement (gms).',
      inputSchema: ReplaceRegexInputSchema,
      outputSchema: z
        .object({ ok: z.boolean(), filePath: z.string(), changed: z.boolean(), matchCount: z.number().optional(), error: z.string().optional() })
        .strict(),
    },
    async (args: z.infer<typeof ReplaceRegexInputSchema>) => {
      const structured = await replaceRegexUseCase({
        root: args.root,
        relativePath: args.relativePath,
        regex: args.regex,
        repl: args.repl,
        ...(args.allowMultipleOccurrences !== undefined
          ? { allowMultipleOccurrences: args.allowMultipleOccurrences }
          : {}),
      });

      return { content: [{ type: 'text' as const, text: JSON.stringify(structured) }], structuredContent: structured };
    },
  );

  const ReplaceSymbolBodyInputSchema = z.object({ root: z.string(), namePath: z.string(), relativePath: z.string(), body: z.string() }).strict();

  server.registerTool(
    'replace_symbol_body',
    {
      title: 'Replace Symbol Body',
      description: 'Replace the block body of a symbol by namePath (best-effort; TS/JS only).',
      inputSchema: ReplaceSymbolBodyInputSchema,
      outputSchema: z.object({ ok: z.boolean(), filePath: z.string(), changed: z.boolean(), error: z.string().optional() }).strict(),
    },
    async (args: z.infer<typeof ReplaceSymbolBodyInputSchema>) => {
      const structured = await replaceSymbolBodyUseCase(args);

      return { content: [{ type: 'text' as const, text: JSON.stringify(structured) }], structuredContent: structured };
    },
  );

  const InsertBeforeSymbolInputSchema = z.object({ root: z.string(), namePath: z.string(), relativePath: z.string(), body: z.string() }).strict();

  server.registerTool(
    'insert_before_symbol',
    {
      title: 'Insert Before Symbol',
      description: 'Insert text before a symbol definition by namePath (best-effort).',
      inputSchema: InsertBeforeSymbolInputSchema,
      outputSchema: z.object({ ok: z.boolean(), filePath: z.string(), changed: z.boolean(), error: z.string().optional() }).strict(),
    },
    async (args: z.infer<typeof InsertBeforeSymbolInputSchema>) => {
      const structured = await insertBeforeSymbolUseCase(args);

      return { content: [{ type: 'text' as const, text: JSON.stringify(structured) }], structuredContent: structured };
    },
  );

  const InsertAfterSymbolInputSchema = z.object({ root: z.string(), namePath: z.string(), relativePath: z.string(), body: z.string() }).strict();

  server.registerTool(
    'insert_after_symbol',
    {
      title: 'Insert After Symbol',
      description: 'Insert text after a symbol definition by namePath (best-effort).',
      inputSchema: InsertAfterSymbolInputSchema,
      outputSchema: z.object({ ok: z.boolean(), filePath: z.string(), changed: z.boolean(), error: z.string().optional() }).strict(),
    },
    async (args: z.infer<typeof InsertAfterSymbolInputSchema>) => {
      const structured = await insertAfterSymbolUseCase(args);

      return { content: [{ type: 'text' as const, text: JSON.stringify(structured) }], structuredContent: structured };
    },
  );

  // ----
  // Symbol overview helpers
  // ----

  const GetSymbolsOverviewInputSchema = z.object({ root: z.string().optional() }).strict();

  server.registerTool(
    'get_symbols_overview',
    {
      title: 'Get Symbols Overview',
      description: 'Summarize the current symbol index for the project root.',
      inputSchema: GetSymbolsOverviewInputSchema,
      outputSchema: z.object({ root: z.string(), index: z.any() }).strict(),
    },
    async (args: z.infer<typeof GetSymbolsOverviewInputSchema>) => {
      const structured = await getSymbolsOverviewUseCase(args.root !== undefined ? { root: args.root } : {});

      return { content: [{ type: 'text' as const, text: JSON.stringify(structured) }], structuredContent: structured };
    },
  );

  const QuerySymbolsInputSchema = z
    .object({
      root: z.string().optional(),
      query: z.string(),
      kind: z.union([z.string(), z.array(z.string())]).optional(),
      file: z.string().optional(),
      limit: z.number().int().positive().optional(),
    })
    .strict();

  server.registerTool(
    'query_symbols',
    {
      title: 'Query Symbols',
      description: 'Query symbols from the index (best-effort filter).',
      inputSchema: QuerySymbolsInputSchema,
      outputSchema: z.object({ matches: z.array(z.any()) }).strict(),
    },
    async (args: z.infer<typeof QuerySymbolsInputSchema>) => {
      const structured = await querySymbolsUseCase({
        query: args.query,
        ...(args.root !== undefined ? { root: args.root } : {}),
        ...(args.kind !== undefined ? { kind: args.kind } : {}),
        ...(args.file !== undefined ? { file: args.file } : {}),
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
      });

      return { content: [{ type: 'text' as const, text: JSON.stringify(structured) }], structuredContent: structured };
    },
  );

  // ----
  // TypeScript-specific tools (best-effort)
  // ----

  const IndexExternalLibrariesInputSchema = z
    .object({
      root: z.string(),
      maxFiles: z.number().int().positive().optional(),
      includePatterns: z.array(z.string()).optional(),
      excludePatterns: z.array(z.string()).optional(),
    })
    .strict();

  server.registerTool(
    'index_external_libraries',
    {
      title: 'Index External Libraries',
      description: 'Index .d.ts files in node_modules for basic external symbol search.',
      inputSchema: IndexExternalLibrariesInputSchema,
      outputSchema: z
        .object({ ok: z.boolean(), indexedFiles: z.number(), symbols: z.number(), error: z.string().optional() })
        .strict(),
    },
    async (args: z.infer<typeof IndexExternalLibrariesInputSchema>) => {
      const structured = await indexExternalLibrariesUseCase({
        root: args.root,
        ...(args.maxFiles !== undefined ? { maxFiles: args.maxFiles } : {}),
        ...(args.includePatterns !== undefined ? { includePatterns: args.includePatterns } : {}),
        ...(args.excludePatterns !== undefined ? { excludePatterns: args.excludePatterns } : {}),
      });

      return { content: [{ type: 'text' as const, text: JSON.stringify(structured) }], structuredContent: structured };
    },
  );

  const GetTypescriptDependenciesInputSchema = z.object({ root: z.string() }).strict();

  server.registerTool(
    'get_typescript_dependencies',
    {
      title: 'Get TypeScript Dependencies',
      description: 'List dependencies that appear to provide TypeScript declarations.',
      inputSchema: GetTypescriptDependenciesInputSchema,
      outputSchema: z.object({ ok: z.boolean(), dependencies: z.array(z.string()).optional(), error: z.string().optional() }).strict(),
    },
    async (args: z.infer<typeof GetTypescriptDependenciesInputSchema>) => {
      const structured = await getTypescriptDependenciesUseCase({ root: args.root });

      return { content: [{ type: 'text' as const, text: JSON.stringify(structured) }], structuredContent: structured };
    },
  );

  const SearchExternalLibrarySymbolsInputSchema = z
    .object({
      root: z.string(),
      libraryName: z.string().optional(),
      symbolName: z.string().optional(),
      kind: z.string().optional(),
      limit: z.number().int().positive().optional(),
    })
    .strict();

  server.registerTool(
    'search_external_library_symbols',
    {
      title: 'Search External Library Symbols',
      description: 'Search indexed external symbols (requires index_external_libraries first).',
      inputSchema: SearchExternalLibrarySymbolsInputSchema,
      outputSchema: z.object({ ok: z.boolean(), matches: z.any().optional(), error: z.string().optional() }).strict(),
    },
    async (args: z.infer<typeof SearchExternalLibrarySymbolsInputSchema>) => {
      const structured = await searchExternalLibrarySymbolsUseCase({
        root: args.root,
        ...(args.libraryName !== undefined ? { libraryName: args.libraryName } : {}),
        ...(args.symbolName !== undefined ? { symbolName: args.symbolName } : {}),
        ...(args.kind !== undefined ? { kind: args.kind } : {}),
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
      });

      return { content: [{ type: 'text' as const, text: JSON.stringify(structured) }], structuredContent: structured };
    },
  );

  const ResolveSymbolInputSchema = z
    .object({ root: z.string(), filePath: z.string(), symbolName: z.string(), tsconfigPath: z.string().optional() })
    .strict();

  server.registerTool(
    'resolve_symbol',
    {
      title: 'Resolve Symbol',
      description: 'Resolve a symbol definition using LSP definition lookup.',
      inputSchema: ResolveSymbolInputSchema,
      outputSchema: z.object({ ok: z.boolean(), definition: z.any().optional(), error: z.string().optional() }).strict(),
    },
    async (args: z.infer<typeof ResolveSymbolInputSchema>) => {
      const structured = await resolveSymbolUseCase({
        root: args.root,
        filePath: args.filePath,
        symbolName: args.symbolName,
        ...(args.tsconfigPath !== undefined ? { tsconfigPath: args.tsconfigPath } : {}),
      });

      return { content: [{ type: 'text' as const, text: JSON.stringify(structured) }], structuredContent: structured };
    },
  );

  const GetAvailableExternalSymbolsInputSchema = z.object({ root: z.string(), filePath: z.string() }).strict();

  server.registerTool(
    'get_available_external_symbols',
    {
      title: 'Get Available External Symbols',
      description: 'List imported symbol names in a file (best-effort import parser).',
      inputSchema: GetAvailableExternalSymbolsInputSchema,
      outputSchema: z.object({ ok: z.boolean(), symbols: z.array(z.string()), error: z.string().optional() }).strict(),
    },
    async (args: z.infer<typeof GetAvailableExternalSymbolsInputSchema>) => {
      const structured = await getAvailableExternalSymbolsInFileUseCase(args);

      return { content: [{ type: 'text' as const, text: JSON.stringify(structured) }], structuredContent: structured };
    },
  );

  const ParseImportsInputSchema = z.object({ root: z.string(), filePath: z.string() }).strict();

  server.registerTool(
    'parse_imports',
    {
      title: 'Parse Imports',
      description: 'Parse and summarize imports (best-effort).',
      inputSchema: ParseImportsInputSchema,
      outputSchema: z.object({ ok: z.boolean(), imports: z.any().optional(), error: z.string().optional() }).strict(),
    },
    async (args: z.infer<typeof ParseImportsInputSchema>) => {
      const structured = await parseImportsUseCase(args);

      return { content: [{ type: 'text' as const, text: JSON.stringify(structured) }], structuredContent: structured };
    },
  );

  // ----
  // Onboarding / guidance tools (text-only)
  // ----

  server.registerTool(
    'index_onboarding',
    {
      title: 'Index Onboarding',
      description: 'Explain the recommended indexing + symbol search workflow for this server.',
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ text: z.string() }).strict(),
    },
    () => {
      const structured = {
        text: [
          'Recommended workflow:',
          '1) `index_symbols` to build the local symbol index (optionally provide `targets`).',
          '2) Use `search_symbol_from_index` (or `search_symbols`) to find symbols by name substring.',
          '3) Use LSP tools like `get_definitions` / `find_references` for precision navigation.',
          '4) Use edit tools (`replace_range`, `replace_regex`, `replace_symbol_body`, `insert_before_symbol`, `insert_after_symbol`) and re-run `index_symbols` if needed.',
        ].join('\n'),
      };

      return { content: [{ type: 'text' as const, text: JSON.stringify(structured) }], structuredContent: structured };
    },
  );

  server.registerTool(
    'get_symbol_search_guidance',
    {
      title: 'Get Symbol Search Guidance',
      description: 'Guidance for choosing between index search vs. LSP-based lookup.',
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ text: z.string() }).strict(),
    },
    () => {
      const structured = {
        text: [
          'Use `search_symbol_from_index` / `search_symbols` when you only have a name hint or want a broad scan.',
          'Use `get_definitions` / `find_references` when you have a concrete location (file + line) and want precise results.',
          'For TypeScript imports, `parse_imports` and `get_available_external_symbols` can help identify names quickly.',
        ].join('\n'),
      };

      return { content: [{ type: 'text' as const, text: JSON.stringify(structured) }], structuredContent: structured };
    },
  );

  server.registerTool(
    'get_compression_guidance',
    {
      title: 'Get Compression Guidance',
      description: 'Guidance for keeping outputs compact and tool-friendly.',
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ text: z.string() }).strict(),
    },
    () => {
      const structured = {
        text: [
          'Tips to keep outputs compact:',
          '- Prefer `get_index_stats_from_index` / `get_project_overview` for summaries.',
          '- Use `limit` for `search_symbol_from_index` / `search_symbols` when you expect many matches.',
          '- For definitions, tune `before`/`after` and `include_body` in `get_definitions` as needed.',
        ].join('\n'),
      };

      return { content: [{ type: 'text' as const, text: JSON.stringify(structured) }], structuredContent: structured };
    },
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

  const transport = new StdioServerTransport();

  await server.connect(transport);
};

export { runMcpServer };
