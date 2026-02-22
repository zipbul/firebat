import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { CallToolResult, LoggingMessageNotification, ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import type { FirebatConfig, FirebatLogLevel } from '../../firebat-config';
import type { FirebatCliOptions } from '../../interfaces';
import type { FirebatLogger, FirebatLogFields } from '../../ports/logger';
import type { FirebatDetector } from '../../types';

import { scanUseCase } from '../../application/scan/scan.usecase';
import { toJsonReport } from '../../types';
import { loadFirebatConfigFile } from '../../firebat-config.loader';
import { createPrettyConsoleLogger } from '../../infrastructure/logging/pretty-console-logger';
import { resolveRuntimeContextFromCwd } from '../../runtime-context';
import { resolveTargets } from '../../target-discovery';

const ALL_DETECTORS: ReadonlyArray<FirebatDetector> = [
  'exact-duplicates',
  'waste',
  'barrel-policy',
  'unknown-proof',
  'exception-hygiene',
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
  'implicit-state',
  'temporal-coupling',
  'symmetry-breaking',
  'invariant-blindspot',
  'modification-trap',
  'modification-impact',
  'variable-lifetime',
  'decision-surface',
  'implementation-overhead',
  'concept-scatter',
  'abstraction-fitness',
  'giant-file',
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

  const record = features as Record<string, unknown>;

  return ALL_DETECTORS.filter(detector => record[detector] !== false);
};

const resolveMinSizeFromFeatures = (features: FirebatConfig['features'] | undefined): number | 'auto' | undefined => {
  const { 'exact-duplicates': exact, 'structural-duplicates': structural } = features ?? {};
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
  const { 'unknown-proof': value } = features ?? {};

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
  const { 'barrel-policy': value } = features ?? {};

  if (!value || value === true || typeof value !== 'object') {
    return undefined;
  }

  const ignoreGlobs = value.ignoreGlobs;

  return Array.isArray(ignoreGlobs) && ignoreGlobs.every((element: unknown) => typeof element === 'string')
    ? ignoreGlobs
    : undefined;
};

type DependenciesFeatureValue = {
  readonly layers: ReadonlyArray<{ readonly name: string; readonly glob: string }>;
  readonly allowedDependencies: Readonly<Record<string, ReadonlyArray<string>>>;
};

const resolveDependenciesLayersFromFeatures = (
  features: FirebatConfig['features'] | undefined,
): ReadonlyArray<{ readonly name: string; readonly glob: string }> | undefined => {
  const value = features?.dependencies;

  if (!value || value === true || typeof value !== 'object') {
    return undefined;
  }

  const layers = (value as DependenciesFeatureValue).layers;

  return Array.isArray(layers) && layers.every(layer => typeof layer?.name === 'string' && typeof layer?.glob === 'string')
    ? layers
    : undefined;
};

const resolveDependenciesAllowedDependenciesFromFeatures = (
  features: FirebatConfig['features'] | undefined,
): Readonly<Record<string, ReadonlyArray<string>>> | undefined => {
  const value = features?.dependencies;

  if (!value || value === true || typeof value !== 'object') {
    return undefined;
  }

  const allowed = (value as DependenciesFeatureValue).allowedDependencies;

  if (!allowed || typeof allowed !== 'object') {
    return undefined;
  }

  const entries = Object.entries(allowed as Record<string, unknown>);

  for (const [key, list] of entries) {
    if (typeof key !== 'string' || key.length === 0) {
      return undefined;
    }

    if (!Array.isArray(list) || !list.every(item => typeof item === 'string')) {
      return undefined;
    }
  }

  return allowed as Readonly<Record<string, ReadonlyArray<string>>>;
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
  const record = overrides as Record<string, unknown>;

  for (const detector of ALL_DETECTORS) {
    const override = record[detector];

    if (override === undefined || override === 'inherit') {
      continue;
    }

    out[detector] = override;
  }

  return out as NonNullable<FirebatConfig['features']>;
};

interface FirebatMcpServerOptions {
  rootAbs: string;
  config: FirebatConfig | null;
  logger: FirebatLogger;
}

type StructuredRecord = Record<string, unknown>;

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

      return {
        isError: true,
        content: [{ type: 'text', text: `${message}${stack}` }],
      };
    }
  };
};

const toStructured = (value: StructuredRecord): StructuredRecord => value;

// ── MCP Logger ────────────────────────────────────────────────────────────────

type McpLoggingLevel = LoggingMessageNotification['params']['level'];

const toMcpLevel = (level: FirebatLogLevel): McpLoggingLevel => {
  switch (level) {
    case 'error': return 'error';
    case 'warn': return 'warning';
    case 'info': return 'info';
    case 'debug': return 'debug';
    case 'trace': return 'debug'; // MCP has no trace level
  }
};

const createMcpLogger = (server: McpServer, baseLogger: FirebatLogger): FirebatLogger => {
  const forward = (level: FirebatLogLevel, message: string, fields?: FirebatLogFields): void => {
    const data: unknown = fields !== undefined && Object.keys(fields).length > 0
      ? { message, ...fields }
      : message;

    server.sendLoggingMessage({ level: toMcpLevel(level), data }).catch(() => {
      // fire-and-forget: suppress send errors
    });
  };

  return {
    level: baseLogger.level,
    log: (lvl, msg, fields, error) => { baseLogger.log(lvl, msg, fields, error); forward(lvl, msg, fields); },
    error: (msg, fields, error) => { baseLogger.error(msg, fields, error); forward('error', msg, fields); },
    warn: (msg, fields, error) => { baseLogger.warn(msg, fields, error); forward('warn', msg, fields); },
    info: (msg, fields, error) => { baseLogger.info(msg, fields, error); forward('info', msg, fields); },
    debug: (msg, fields, error) => { baseLogger.debug(msg, fields, error); forward('debug', msg, fields); },
    trace: (msg, fields, error) => { baseLogger.trace(msg, fields, error); forward('trace', msg, fields); },
  };
};

// ── File-pattern filter ────────────────────────────────────────────────────────

const extractFindingFilePaths = (finding: unknown): ReadonlyArray<string> => {
  const f = finding as Record<string, unknown>;

  if (typeof f['file'] === 'string' && f['file'].length > 0) return [f['file']];
  if (typeof f['filePath'] === 'string' && f['filePath'].length > 0) return [f['filePath']];
  if (typeof f['module'] === 'string' && f['module'].length > 0) return [f['module']];

  if (Array.isArray(f['items'])) {
    return (f['items'] as Record<string, unknown>[])
      .flatMap(item => [
        typeof item['filePath'] === 'string' ? item['filePath'] : '',
        typeof item['file'] === 'string' ? item['file'] : '',
      ])
      .filter(Boolean);
  }

  if (Array.isArray(f['outliers'])) {
    return (f['outliers'] as Record<string, unknown>[])
      .map(item => (typeof item['filePath'] === 'string' ? item['filePath'] : ''))
      .filter(Boolean);
  }

  return [];
};

const filterAnalysesByFilePatterns = (
  analyses: Record<string, unknown>,
  filePatterns: ReadonlyArray<string>,
): Record<string, unknown> => {
  if (filePatterns.length === 0) {
    return analyses;
  }

  const globs = filePatterns.map(p => new Bun.Glob(p));

  const matchesAny = (filePath: string): boolean =>
    globs.some(glob => glob.match(filePath));

  const filtered: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(analyses)) {
    if (!Array.isArray(value)) {
      filtered[key] = value;
      continue;
    }

    filtered[key] = (value as unknown[]).filter(finding => {
      const paths = extractFindingFilePaths(finding);

      return paths.length === 0 || paths.some(p => matchesAny(p));
    });
  }

  return filtered;
};

export const createFirebatMcpServer = async (options: FirebatMcpServerOptions): Promise<McpServer> => {
  const { rootAbs, config, logger } = options;
  const server = new McpServer(
    { name: 'firebat', version: '2.0.0-scan-only' },
    { capabilities: { logging: {} } },
  );
  const ScanInputSchema = z
    .object({
      targets: z
        .array(z.string())
        .optional()
        .describe(
          [
            'File/dir paths to analyze.',
            'Accepts absolute paths, or paths relative to the MCP server root.',
            'If omitted, Firebat discovers default targets under the project root.',
          ].join(' '),
        ),
      detectors: z
        .array(z.string())
        .optional()
        .describe(
          [
            'Subset of detectors to run.',
            'If omitted, uses enabled detectors from config (including config.mcp.features overrides); otherwise uses all detectors.',
            'Unknown detector names are ignored.',
            'Available: exact-duplicates, structural-duplicates, waste, nesting, early-return, noop, forwarding, barrel-policy, unknown-proof, exception-hygiene, coupling, dependencies, api-drift, lint, format, typecheck, implicit-state, temporal-coupling, symmetry-breaking, invariant-blindspot, modification-trap, modification-impact, variable-lifetime, decision-surface, implementation-overhead, concept-scatter, abstraction-fitness, giant-file.',
          ].join(' '),
        ),
      minSize: z
        .union([z.number().int().nonnegative(), z.literal('auto')])
        .optional()
        .describe(
          [
            'Minimum AST node size for duplicate detection (exact-duplicates / structural-duplicates).',
            '"auto" adapts to the codebase.',
            'If omitted, uses config defaults when available.',
          ].join(' '),
        ),
      maxForwardDepth: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe(
          [
            'Max re-export depth for the forwarding detector.',
            '0 disables forwarding analysis.',
            'If omitted, uses config defaults when available.',
          ].join(' '),
        ),
      filePatterns: z
        .array(z.string())
        .optional()
        .describe(
          [
            'Glob patterns to filter findings by file path.',
            'Only findings whose file matches at least one pattern are returned.',
            'If omitted or empty, all findings are returned.',
            'Example: ["src/adapters/**", "src/engine/**"].',
          ].join(' '),
        ),
    })
    .strict();
  const FirebatDetectorSchema = z.enum([...ALL_DETECTORS] as [FirebatDetector, ...Array<FirebatDetector>]);

  server.registerTool(
    'scan',
    {
      title: 'Scan codebase',
      description: [
        'Run Firebat static analysis on a set of files/directories and return a JSON report.',
        '',
        'Inputs:',
        '- targets: file/dir paths to analyze. If omitted, Firebat discovers default targets under the project root.',
        '- detectors: detector names to run. If omitted, uses enabled detectors from config (including config.mcp.features overrides).',
        '  Detector guide for non-obvious names:',
        '  invariant-blindspot=mutation without validation, modification-trap=N-place sync required,',
        '  modification-impact=high-fanin change radius, variable-lifetime=long-lived variable burden,',
        '  decision-surface=combinatorial branch explosion, implementation-overhead=impl complexity >> interface,',
        '  concept-scatter=one concept spread across many files, abstraction-fitness=cohesion vs coupling score.',
        '- minSize: minimum AST node size for duplicate detection. Use "auto" to adapt to the codebase. Typical: 30-50 for small projects.',
        '- maxForwardDepth: max re-export depth for the forwarding detector (0 disables). Typical: 2-3.',
        '- filePatterns: glob patterns to filter findings by file path. Only matching findings are returned.',
        '',
        'Outputs:',
        '- detectors: list of detectors that were run.',
        '- analyses: per-detector findings (each value is an array of findings).',
        '- catalog: diagnostic code definitions referenced in findings.',
        '- errors (optional): per-detector error messages if a detector failed.',
        '',
        'Notes:',
        '- Unknown detector names are ignored when `detectors` is provided (if none are valid, Firebat falls back to running all detectors).',
        '- Firebat may cache results internally for identical inputs to speed up repeated scans.',
      ].join('\n'),
      inputSchema: ScanInputSchema,
      outputSchema: z
        .object({
          detectors: z.array(FirebatDetectorSchema),
          errors: z.record(z.string(), z.string()).optional(),
          blockers: z.number(),
          analyses: z.record(z.string(), z.unknown()),
          catalog: z.record(
            z.string(),
            z.object({ cause: z.string(), think: z.array(z.string()) }).strict(),
          ),
        })
        .strict(),
    },
    safeTool(async (args: z.infer<typeof ScanInputSchema>) => {
      const mcpLogger = createMcpLogger(server, logger);
      const targets = await resolveTargets(rootAbs, args.targets);
      const effectiveFeatures = resolveMcpFeatures(config);
      const cfgDetectors = resolveEnabledDetectorsFromFeatures(effectiveFeatures);
      const cfgMinSize = resolveMinSizeFromFeatures(effectiveFeatures);
      const cfgMaxForwardDepth = resolveMaxForwardDepthFromFeatures(effectiveFeatures);
      const cfgUnknownProofBoundaryGlobs = resolveUnknownProofBoundaryGlobsFromFeatures(effectiveFeatures);
      const cfgBarrelPolicyIgnoreGlobs = resolveBarrelPolicyIgnoreGlobsFromFeatures(effectiveFeatures);
      const cfgDependenciesLayers = resolveDependenciesLayersFromFeatures(effectiveFeatures);
      const cfgDependenciesAllowedDeps = resolveDependenciesAllowedDependenciesFromFeatures(effectiveFeatures);
      const cliOptions: FirebatCliOptions = {
        targets,
        format: 'json',
        minSize: args.minSize ?? cfgMinSize ?? 'auto',
        maxForwardDepth: args.maxForwardDepth ?? cfgMaxForwardDepth ?? 0,
        exitOnFindings: false,
        detectors: args.detectors !== undefined ? asDetectors(args.detectors) : cfgDetectors,
        fix: false,
        ...(cfgUnknownProofBoundaryGlobs !== undefined ? { unknownProofBoundaryGlobs: cfgUnknownProofBoundaryGlobs } : {}),
        ...(cfgBarrelPolicyIgnoreGlobs !== undefined ? { barrelPolicyIgnoreGlobs: cfgBarrelPolicyIgnoreGlobs } : {}),
        ...(cfgDependenciesLayers !== undefined ? { dependenciesLayers: cfgDependenciesLayers } : {}),
        ...(cfgDependenciesAllowedDeps !== undefined ? { dependenciesAllowedDependencies: cfgDependenciesAllowedDeps } : {}),
        help: false,
      };
      const report = await scanUseCase(cliOptions, { logger: mcpLogger });
      const jsonReport = toJsonReport(report);

      const filePatterns = args.filePatterns ?? [];
      const filteredAnalyses = filterAnalysesByFilePatterns(
        jsonReport.analyses as unknown as Record<string, unknown>,
        filePatterns,
      );
      const filteredReport = { ...jsonReport, analyses: filteredAnalyses };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(filteredReport) }],
        structuredContent: toStructured(filteredReport as unknown as StructuredRecord),
      };
    }),
  );

  return server;
};

export const __testing__ = {
  createMcpLogger,
  filterAnalysesByFilePatterns,
  extractFindingFilePaths,
  asDetectors,
  resolveEnabledDetectorsFromFeatures,
  resolveMinSizeFromFeatures,
  resolveMaxForwardDepthFromFeatures,
  toMcpLevel,
};

export const runMcpServer = async (): Promise<void> => {
  const ctx = await resolveRuntimeContextFromCwd();

  if (ctx.rootAbs.trim().length === 0) {
    return;
  }

  const loaded = await loadFirebatConfigFile({ rootAbs: ctx.rootAbs }).catch(() => null);
  const config = loaded?.config ?? null;
  const logger = createPrettyConsoleLogger({ level: 'info' });
  const server = await createFirebatMcpServer({ rootAbs: ctx.rootAbs, config, logger });
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
      logger.warn('MCP server: cleanup error', undefined, err);
    }

    try {
      await transport.close();

      logger.debug('MCP server: transport closed');
    } catch (err) {
      logger.warn('MCP server: transport close error', undefined, err);
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
    logger.error('MCP server: connection failed', undefined, err);

    await cleanup('connect-error');

    return;
  }

  transport.onerror = (error: Error) => {
    logger.warn('MCP server: transport error', undefined, error);

    void cleanup('transport-error');
  };

  transport.onclose = () => {
    logger.debug('MCP server: transport closed');

    void cleanup('transport-close');
  };

  logger.info('MCP server: connected and ready');
};
