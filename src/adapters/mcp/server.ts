import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { CallToolResult, ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { z } from 'zod';

import type { FirebatConfig } from '../../firebat-config';
import type { FirebatCliOptions } from '../../interfaces';
import type { FirebatLogger } from '../../ports/logger';
import type { FirebatDetector, FirebatReport } from '../../types';

import { scanUseCase } from '../../application/scan/scan.usecase';
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

  const {
    'exact-duplicates': exactDuplicates,
    waste,
    'barrel-policy': barrelPolicy,
    'unknown-proof': unknownProof,
    'exception-hygiene': exceptionHygiene,
    format,
    lint,
    typecheck,
    dependencies,
    coupling,
    'structural-duplicates': structuralDuplicates,
    nesting,
    'early-return': earlyReturn,
    noop,
    'api-drift': apiDrift,
    forwarding,
  } = features;
  const enabled: Record<FirebatDetector, boolean> = {
    'exact-duplicates': exactDuplicates !== false,
    waste: waste !== false,
    'barrel-policy': barrelPolicy !== false,
    'unknown-proof': unknownProof !== false,
    'exception-hygiene': exceptionHygiene !== false,
    format: format !== false,
    lint: lint !== false,
    typecheck: typecheck !== false,
    dependencies: dependencies !== false,
    coupling: coupling !== false,
    'structural-duplicates': structuralDuplicates !== false,
    nesting: nesting !== false,
    'early-return': earlyReturn !== false,
    noop: noop !== false,
    'api-drift': apiDrift !== false,
    forwarding: forwarding !== false,
  };

  return ALL_DETECTORS.filter(detector => enabled[detector]);
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
  const {
    'exact-duplicates': exactDuplicates,
    waste,
    'barrel-policy': barrelPolicy,
    'unknown-proof': unknownProof,
    'exception-hygiene': exceptionHygiene,
    format,
    lint,
    typecheck,
    dependencies,
    coupling,
    'structural-duplicates': structuralDuplicates,
    nesting,
    'early-return': earlyReturn,
    noop,
    'api-drift': apiDrift,
    forwarding,
  } = overrides;
  const overrideMap: Record<FirebatDetector, unknown> = {
    'exact-duplicates': exactDuplicates,
    waste,
    'barrel-policy': barrelPolicy,
    'unknown-proof': unknownProof,
    'exception-hygiene': exceptionHygiene,
    format,
    lint,
    typecheck,
    dependencies,
    coupling,
    'structural-duplicates': structuralDuplicates,
    nesting,
    'early-return': earlyReturn,
    noop,
    'api-drift': apiDrift,
    forwarding,
  };

  for (const detector of ALL_DETECTORS) {
    const override = overrideMap[detector];

    if (override === undefined || override === 'inherit') {
      continue;
    }

    out[detector] = override;
  }

  return out as NonNullable<FirebatConfig['features']>;
};

const nowMs = (): number => {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
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

type DiffCounts = { newFindings: number; resolvedFindings: number; unchangedFindings: number };

const diffReports = (prev: FirebatReport | null, next: FirebatReport): DiffCounts => {
  if (!prev) {
    return { newFindings: -1, resolvedFindings: -1, unchangedFindings: -1 };
  }

  const stableStringify = (value: unknown): string => {
    if (value === null || value === undefined) {
      return String(value);
    }

    if (typeof value !== 'object') {
      return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
      return `[${value.map(stableStringify).join(',')}]`;
    }

    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const entries = keys.map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`);

    return `{${entries.join(',')}}`;
  };

  const collectFindings = (value: unknown): ReadonlyArray<unknown> => {
    if (!value) {
      return [];
    }

    if (Array.isArray(value)) {
      // Treat array items as the "finding" units.
      return value;
    }

    if (typeof value !== 'object') {
      return [];
    }

    const out: Array<unknown> = [];
    const record = value as Record<string, unknown>;

    for (const v of Object.values(record)) {
      out.push(...collectFindings(v));
    }

    return out;
  };

  const findingKeys = (report: FirebatReport): ReadonlyArray<string> => {
    const keys: Array<string> = [];

    for (const [detector, analysis] of Object.entries(report.analyses ?? {})) {
      for (const item of collectFindings(analysis)) {
        keys.push(`${detector}:${stableStringify(item)}`);
      }
    }

    return keys;
  };

  const prevKeys = new Set(findingKeys(prev));
  const nextKeys = new Set(findingKeys(next));
  let newFindings = 0;
  let resolvedFindings = 0;
  let unchangedFindings = 0;

  for (const k of nextKeys) {
    if (prevKeys.has(k)) {
      unchangedFindings++;
    } else {
      newFindings++;
    }
  }

  for (const k of prevKeys) {
    if (!nextKeys.has(k)) {
      resolvedFindings++;
    }
  }

  return { newFindings, resolvedFindings, unchangedFindings };
};

export const createFirebatMcpServer = async (options: FirebatMcpServerOptions): Promise<McpServer> => {
  const { rootAbs, config, logger } = options;
  const server = new McpServer({
    name: 'firebat',
    version: '2.0.0-scan-only',
  });
  let lastReport: FirebatReport | null = null;
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
            'Available: exact-duplicates, structural-duplicates, waste, nesting, early-return, noop, forwarding, barrel-policy, unknown-proof, exception-hygiene, coupling, dependencies, api-drift, lint, format, typecheck.',
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
    })
    .strict();
  const FirebatDetectorSchema = z.enum([...ALL_DETECTORS] as [FirebatDetector, ...Array<FirebatDetector>]);
  const FirebatMetaSchema = z
    .object({
      engine: z.literal('oxc'),
      targetCount: z.number().int().nonnegative(),
      minSize: z.number().int().nonnegative(),
      maxForwardDepth: z.number().int().nonnegative(),
      detectors: z.array(FirebatDetectorSchema),
      detectorTimings: z.record(z.string(), z.number()).optional(),
      errors: z.record(z.string(), z.string()).optional(),
    })
    .strict();

  const FirebatTopItemSchema = z
    .object({
      pattern: z.string(),
      detector: z.string(),
      resolves: z.number().int().nonnegative(),
    })
    .strict();

  const FirebatCatalogEntrySchema = z
    .object({
      cause: z.string(),
      approach: z.string(),
    })
    .strict();

  const FirebatReportSchema = z
    .object({
      meta: FirebatMetaSchema,
      analyses: z.record(z.string(), z.unknown()),
      top: z.array(FirebatTopItemSchema),
      catalog: z.record(z.string(), FirebatCatalogEntrySchema),
    })
    .strict();

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
        '- minSize: minimum AST node size for duplicate detection. Use "auto" to adapt to the codebase.',
        '- maxForwardDepth: max re-export depth for the forwarding detector (0 disables forwarding analysis).',
        '',
        'Outputs:',
        '- report: the Firebat report as JSON (includes `meta`, `analyses`, `top`, and `catalog`).',
        '- timings.totalMs: total wall time for this scan call.',
        '- diff (optional): comparison to the previous `scan` call in the same server process.',
        '',
        'Notes:',
        '- Unknown detector names are ignored when `detectors` is provided (if none are valid, Firebat falls back to running all detectors).',
        '- `diff` is only returned from the second scan onward (first scan has no previous baseline).',
        '- Firebat may cache results internally for identical inputs to speed up repeated scans.',
      ].join('\n'),
      inputSchema: ScanInputSchema,
      outputSchema: z
        .object({
          report: FirebatReportSchema,
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
      const report = await scanUseCase(cliOptions, { logger });
      const diff = diffReports(lastReport, report);

      lastReport = report;

      const totalMs = nowMs() - t0;
      const structured: StructuredRecord = {
        report,
        timings: { totalMs },
        ...(diff.newFindings >= 0 ? { diff } : {}),
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
        structuredContent: toStructured(structured),
      };
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
