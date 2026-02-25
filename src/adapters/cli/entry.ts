import type { FirebatConfig } from '../../shared/firebat-config';
import type { FirebatCliOptions } from '../../interfaces';
import type { FirebatLogger } from '../../shared/logger';
import type { FirebatDetector, FirebatReport } from '../../types';
import { countBlockers } from '../../types';

import { scanUseCase } from '../../application/scan/scan.usecase';
import { parseArgs } from '../../shared/arg-parse';
import { loadFirebatConfigFile, resolveDefaultFirebatRcPath } from '../../shared/firebat-config.loader';
import { appendFirebatLog } from '../../shared/logger';
import { createPrettyConsoleLogger } from '../../shared/logger';
import { formatReport } from '../../report';
import { resolveFirebatRootFromCwd } from '../../shared/root-resolver';
import { resolveTargets } from '../../shared/target-discovery';

interface CliLoggerInput {
  readonly level: FirebatCliOptions['logLevel'];
  readonly logStack: FirebatCliOptions['logStack'];
}

interface UnknownProofFeatureValue {
  readonly boundaryGlobs?: unknown;
}

interface BarrelPolicyFeatureValue {
  readonly ignoreGlobs?: unknown;
}

interface WasteFeatureValue {
  readonly memoryRetentionThreshold?: unknown;
}

const createCliLogger = (input: CliLoggerInput): FirebatLogger => {
  return createPrettyConsoleLogger({
    level: input.level ?? 'info',
    includeStack: input.logStack ?? false,
  });
};

const isTty = (): boolean => {
  return Boolean(process.stdout?.isTTY);
};

const H = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  gray: '\x1b[90m',
  white: '\x1b[37m',
} as const;

const hc = (text: string, code: string, color: boolean): string => (color ? `${code}${text}${H.reset}` : text);

const writeStdout = (text: string): void => {
  process.stdout.write(text + '\n');
};

const printHelpAndExit = (): number => {
  printHelp();

  return 0;
};

const printHelp = (): void => {
  const c = isTty();
  const lines = [
    '',
    `  ${hc('🔥 firebat', `${H.bold}${H.cyan}`, c)}  ${hc('Code quality scanner powered by Bun', H.dim, c)}`,
    '',
    `  ${hc('USAGE', `${H.bold}${H.yellow}`, c)}`,
    '',
    `    ${hc('$', H.dim, c)} firebat ${hc('[targets...] [options]', H.gray, c)}`,
    `    ${hc('$', H.dim, c)} firebat scan ${hc('[targets...] [options]', H.gray, c)}`,
    '',
    `  ${hc('COMMANDS', `${H.bold}${H.yellow}`, c)}`,
    '',
    `    ${hc('scan', `${H.bold}${H.white}`, c)}       ${hc('Run code analysis (default command)', H.dim, c)}`,
    `    ${hc('install', `${H.bold}${H.white}`, c)}    ${hc('Set up firebat config files in this project', H.dim, c)}`,
    `    ${hc('update', `${H.bold}${H.white}`, c)}     ${hc('Sync config files with latest templates', H.dim, c)}`,
    `    ${hc('cache', `${H.bold}${H.white}`, c)} ${hc('clean', H.white, c)}  ${hc('Delete cached analysis data (.firebat/*.sqlite)', H.dim, c)}`,
    `    ${hc('mcp', `${H.bold}${H.white}`, c)}        ${hc('Start MCP server (stdio transport)', H.dim, c)}`,
    '',
    `  ${hc('SCAN OPTIONS', `${H.bold}${H.yellow}`, c)}`,
    '',
    `    ${hc('--format', `${H.bold}${H.green}`, c)} ${hc('text|json', H.gray, c)}       Output format ${hc('(default: text)', H.dim, c)}`,
    `    ${hc('--min-size', `${H.bold}${H.green}`, c)} ${hc('<n|auto>', H.gray, c)}     Min AST node size for duplicate detection ${hc('(default: auto)', H.dim, c)}`,
    `    ${hc('--max-forward-depth', `${H.bold}${H.green}`, c)} ${hc('<n>', H.gray, c)}  Max thin-wrapper chain depth ${hc('(default: 0)', H.dim, c)}`,
    `    ${hc('--only', `${H.bold}${H.green}`, c)} ${hc('<list>', H.gray, c)}            Comma-separated detectors to run`,
    `    ${hc('--fix', `${H.bold}${H.green}`, c)}                    Apply safe autofixes ${hc('(oxfmt --write; oxlint --fix)', H.dim, c)}`,
    `    ${hc('--config', `${H.bold}${H.green}`, c)} ${hc('<path>', H.gray, c)}          Config file path ${hc('(default: <root>/.firebatrc.jsonc)', H.dim, c)}`,
    `    ${hc('--no-exit', `${H.bold}${H.green}`, c)}                Always exit 0, even with findings`,
    '',
    `  ${hc('LOG OPTIONS', `${H.bold}${H.yellow}`, c)}`,
    '',
    `    ${hc('--log-level', `${H.bold}${H.green}`, c)} ${hc('<level>', H.gray, c)}     error|warn|info|debug|trace ${hc('(default: info)', H.dim, c)}`,
    `    ${hc('--log-stack', `${H.bold}${H.green}`, c)}              Include stack traces in log output`,
    `    ${hc('-h, --help', `${H.bold}${H.green}`, c)}               Show this help`,
    '',
    `  ${hc('DETECTORS', `${H.bold}${H.yellow}`, c)}`,
    '',
    `    exact-duplicates, structural-duplicates, waste, nesting, early-return,`,
    `    forwarding, barrel-policy, unknown-proof,`,
    `    exception-hygiene, lint, format, typecheck, dependencies, coupling,`,
    `    implicit-state, temporal-coupling, symmetry-breaking, invariant-blindspot,`,
    `    modification-trap, modification-impact, variable-lifetime, decision-surface,`,
    `    implementation-overhead, concept-scatter, abstraction-fitness, giant-file,`,
    `    duplicates`,
    '',
    `  ${hc('CONFIG-ONLY OPTIONS', `${H.bold}${H.yellow}`, c)}  ${hc('(set in .firebatrc.jsonc)', H.dim, c)}`,
    '',
    `    ${hc('features["unknown-proof"].boundaryGlobs', H.gray, c)}   Boundary glob patterns`,
    `    ${hc('features["barrel-policy"].ignoreGlobs', H.gray, c)}    Ignore glob patterns`,
    '',
    `  ${hc('EXAMPLES', `${H.bold}${H.yellow}`, c)}`,
    '',
    `    ${hc('$', H.dim, c)} firebat                              ${hc('# Scan entire project', H.dim, c)}`,
    `    ${hc('$', H.dim, c)} firebat src/app.ts src/utils.ts       ${hc('# Scan specific files', H.dim, c)}`,
    `    ${hc('$', H.dim, c)} firebat --only waste,lint --format json`,
    `    ${hc('$', H.dim, c)} firebat --fix                        ${hc('# Auto-fix lint & format issues', H.dim, c)}`,
    `    ${hc('$', H.dim, c)} firebat install                      ${hc('# Set up config files', H.dim, c)}`,
    '',
  ];

  writeStdout(lines.join('\n'));
};



const resolveEnabledDetectorsFromFeatures = (features: FirebatConfig['features'] | undefined): ReadonlyArray<FirebatDetector> => {
  const all: ReadonlyArray<FirebatDetector> = [
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
    'duplicates',
  ];

  if (!features) {
    return all;
  }

  const record = features as Record<string, unknown>;
  const disabled = new Set<FirebatDetector>();

  for (const detector of all) {
    if (record[detector] === false) {
      disabled.add(detector);
    }
  }

  return all.filter(detector => !disabled.has(detector));
};

const appendCliErrorLog = async (err: unknown): Promise<void> => {
  if (err === undefined || err === null) {
    return;
  }

  try {
    const { rootAbs } = await resolveFirebatRootFromCwd();

    await appendFirebatLog(
      rootAbs,
      '.firebat/cli-error.log',
      err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ''}` : String(err),
    );
  } catch (logErr) {
    process.stderr.write(`[firebat] Failed to append CLI error log: ${String(logErr)}\n`);
  }
};

const resolveUnknownProofBoundaryGlobsFromFeatures = (
  features: FirebatConfig['features'] | undefined,
): ReadonlyArray<string> | undefined => {
  const { 'unknown-proof': value } = features ?? {};

  if (!value || value === true || typeof value !== 'object') {
    return undefined;
  }

  const boundaryGlobs = (value as UnknownProofFeatureValue).boundaryGlobs;

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

  const ignoreGlobs = (value as BarrelPolicyFeatureValue).ignoreGlobs;

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

const resolveMinSizeFromFeatures = (
  features: FirebatConfig['features'] | undefined,
): FirebatCliOptions['minSize'] | undefined => {
  const { 'exact-duplicates': exact, 'structural-duplicates': structural, duplicates: unified } = features ?? {};
  const exactSize = typeof exact === 'object' && exact !== null ? exact.minSize : undefined;
  const structuralSize = typeof structural === 'object' && structural !== null ? structural.minSize : undefined;
  const unifiedSize = typeof unified === 'object' && unified !== null ? (unified as Record<string, unknown>).minSize as number | undefined : undefined;

  if (exactSize !== undefined && structuralSize !== undefined && exactSize !== structuralSize) {
    throw new Error(
      '[firebat] Invalid config: features.structural-duplicates.minSize must match features.exact-duplicates.minSize',
    );
  }

  return exactSize ?? structuralSize ?? unifiedSize;
};

const resolveMaxForwardDepthFromFeatures = (features: FirebatConfig['features'] | undefined): number | undefined => {
  const forwarding = features?.forwarding;

  if (forwarding === undefined || forwarding === false || forwarding === true) {
    return undefined;
  }

  return forwarding.maxForwardDepth;
};

const resolveWasteMemoryRetentionThresholdFromFeatures = (
  features: FirebatConfig['features'] | undefined,
): number | undefined => {
  const waste = features?.waste;

  if (waste === undefined || waste === null || typeof waste !== 'object') {
    return undefined;
  }

  const threshold = (waste as WasteFeatureValue).memoryRetentionThreshold;

  return typeof threshold === 'number' && Number.isFinite(threshold) ? Math.max(0, Math.round(threshold)) : undefined;
};

const resolveOptions = async (argv: readonly string[], logger: FirebatLogger): Promise<FirebatCliOptions> => {
  const options = parseArgs(argv);

  logger.trace('CLI args parsed', { targets: options.targets.length, format: options.format, help: options.help });

  if (options.help) {
    return options;
  }

  const { rootAbs } = await resolveFirebatRootFromCwd();

  logger.debug('Project root resolved', { rootAbs });

  let config: FirebatConfig | null = null;
  const configPath = options.configPath ?? resolveDefaultFirebatRcPath(rootAbs);
  const loaded = await loadFirebatConfigFile({ rootAbs, configPath });

  config = loaded.config;

  logger.debug('Config loaded', { resolvedPath: loaded.resolvedPath, hasConfig: config !== null });

  const featuresCfg = config?.features;
  const cfgDetectors = resolveEnabledDetectorsFromFeatures(featuresCfg);
  const cfgMinSize = resolveMinSizeFromFeatures(featuresCfg);
  const cfgMaxForwardDepth = resolveMaxForwardDepthFromFeatures(featuresCfg);
  const cfgWasteMemoryRetentionThreshold = resolveWasteMemoryRetentionThresholdFromFeatures(featuresCfg);
  const cfgUnknownProofBoundaryGlobs = resolveUnknownProofBoundaryGlobsFromFeatures(featuresCfg);
  const cfgBarrelPolicyIgnoreGlobs = resolveBarrelPolicyIgnoreGlobsFromFeatures(featuresCfg);
  const cfgDependenciesLayers = resolveDependenciesLayersFromFeatures(featuresCfg);
  const cfgDependenciesAllowedDeps = resolveDependenciesAllowedDependenciesFromFeatures(featuresCfg);

  logger.trace('Features resolved from config', {
    detectors: cfgDetectors.length,
    minSize: cfgMinSize,
    maxForwardDepth: cfgMaxForwardDepth,
  });

  const merged: FirebatCliOptions = {
    ...options,
    ...(options.explicit?.minSize ? {} : cfgMinSize !== undefined ? { minSize: cfgMinSize } : {}),
    ...(options.explicit?.maxForwardDepth ? {} : cfgMaxForwardDepth !== undefined ? { maxForwardDepth: cfgMaxForwardDepth } : {}),
    ...(options.explicit?.detectors ? {} : { detectors: cfgDetectors }),
    ...(cfgWasteMemoryRetentionThreshold !== undefined
      ? { wasteMemoryRetentionThreshold: cfgWasteMemoryRetentionThreshold }
      : {}),
    ...(cfgUnknownProofBoundaryGlobs !== undefined ? { unknownProofBoundaryGlobs: cfgUnknownProofBoundaryGlobs } : {}),
    ...(cfgBarrelPolicyIgnoreGlobs !== undefined ? { barrelPolicyIgnoreGlobs: cfgBarrelPolicyIgnoreGlobs } : {}),
    ...(cfgDependenciesLayers !== undefined ? { dependenciesLayers: cfgDependenciesLayers } : {}),
    ...(cfgDependenciesAllowedDeps !== undefined ? { dependenciesAllowedDependencies: cfgDependenciesAllowedDeps } : {}),
    configPath: loaded.resolvedPath,
  };

  if (merged.targets.length > 0) {
    const targets = await resolveTargets(rootAbs, merged.targets);

    logger.debug('Targets expanded', { inputTargetCount: merged.targets.length, expandedTargetCount: targets.length });

    return {
      ...merged,
      targets,
    };
  }

  const targets = await resolveTargets(rootAbs);

  logger.debug('Targets auto-discovered', { discoveredTargetCount: targets.length, rootAbs });

  return {
    ...merged,
    targets,
  };
};

const runCli = async (argv: readonly string[]): Promise<number> => {
  let exitCode = 0;
  let options: FirebatCliOptions | null = null;
  // Create early logger for resolveOptions; upgraded after options are known.
  const earlyLogger = createCliLogger({ level: undefined, logStack: undefined });

  try {
    options = await resolveOptions(argv, earlyLogger);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await appendCliErrorLog(err);
    createPrettyConsoleLogger({ level: 'error', includeStack: false }).error(message);

    exitCode = 1;
  }

  if (options?.help) {
    return printHelpAndExit();
  }

  if (exitCode === 0 && options) {
    const logger = createCliLogger({ level: options.logLevel, logStack: options.logStack });

    logger.debug('Options resolved', {
      targetCount: options.targets.length,
      detectorCount: options.detectors.length,
      format: options.format,
    });

    if (exitCode === 0) {
      let report: FirebatReport | null = null;

      try {
        report = await scanUseCase(options, { logger });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        await appendCliErrorLog(err);

        logger.error('Failed', { message }, err);

        exitCode = 1;
      }

      if (report) {
        const output = formatReport(report, options.format);

        logger.trace('Report formatted', { format: options.format, length: output.length });

        process.stdout.write(output + '\n');

        const blockers = countBlockers(report.analyses);

        logger.debug('Blocking findings counted', { blockers });

        exitCode = blockers > 0 && options.exitOnFindings ? 1 : 0;
      }
    }
  }

  return exitCode;
};

export { runCli };

export const __testing__ = {
  resolveEnabledDetectorsFromFeatures,
  resolveUnknownProofBoundaryGlobsFromFeatures,
  resolveBarrelPolicyIgnoreGlobsFromFeatures,
  resolveDependenciesLayersFromFeatures,
  resolveDependenciesAllowedDependenciesFromFeatures,
  resolveMinSizeFromFeatures,
  resolveMaxForwardDepthFromFeatures,
  resolveWasteMemoryRetentionThresholdFromFeatures,
};
