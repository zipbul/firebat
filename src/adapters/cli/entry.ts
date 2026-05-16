import type { FirebatCliOptions } from '../../interfaces';
import type { FirebatConfig, FirebatCouplingConfig } from '../../shared/firebat-config';
import type { FirebatLogger } from '../../shared/logger';
import type { FirebatDetector, FirebatReport } from '../../types';

import { scanUseCase } from '../../application/scan/scan.usecase';
import { formatReport } from '../../report';
import { parseArgs } from '../../shared/arg-parse';
import { loadFirebatConfigFile, resolveDefaultFirebatRcPath } from '../../shared/firebat-config.loader';
import { appendFirebatLog } from '../../shared/logger';
import { createPrettyConsoleLogger } from '../../shared/logger';
import { resolveFirebatRootFromCwd } from '../../shared/root-resolver';
import { resolveTargets } from '../../shared/target-discovery';

interface CliLoggerInput {
  readonly level: FirebatCliOptions['logLevel'];
  readonly logStack: FirebatCliOptions['logStack'];
}

interface BarrelFeatureValue {
  readonly ignoreGlobs?: unknown;
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
    '',
    `  ${hc('SCAN OPTIONS', `${H.bold}${H.yellow}`, c)}`,
    '',
    `    ${hc('--min-size', `${H.bold}${H.green}`, c)} ${hc('<n|auto>', H.gray, c)}     Min AST node size for duplicate detection ${hc('(default: auto)', H.dim, c)}`,
    `    ${hc('--max-forward-depth', `${H.bold}${H.green}`, c)} ${hc('<n>', H.gray, c)}  Max thin-wrapper chain depth ${hc('(default: 0)', H.dim, c)}`,
    `    ${hc('--only', `${H.bold}${H.green}`, c)} ${hc('<list>', H.gray, c)}            Comma-separated detectors to run`,
    `    ${hc('--config', `${H.bold}${H.green}`, c)} ${hc('<path>', H.gray, c)}          Config file path ${hc('(default: <root>/.firebatrc.jsonc)', H.dim, c)}`,
    '',
    `  ${hc('LOG OPTIONS', `${H.bold}${H.yellow}`, c)}`,
    '',
    `    ${hc('--log-level', `${H.bold}${H.green}`, c)} ${hc('<level>', H.gray, c)}     error|warn|info|debug|trace ${hc('(default: info)', H.dim, c)}`,
    `    ${hc('--log-stack', `${H.bold}${H.green}`, c)}              Include stack traces in log output`,
    `    ${hc('-h, --help', `${H.bold}${H.green}`, c)}               Show this help`,
    '',
    `  ${hc('DETECTORS', `${H.bold}${H.yellow}`, c)}`,
    '',
    `    waste, nesting, early-return,`,
    `    indirection, barrel, unknown-proof,`,
    `    error-flow, lint, format, typecheck, dependencies, coupling,`,
    `    temporal-coupling,`,
    `    variable-lifetime,`,
    `    giant-file,`,
    `    duplicates`,
    '',
    `  ${hc('CONFIG-ONLY OPTIONS', `${H.bold}${H.yellow}`, c)}  ${hc('(set in .firebatrc.jsonc)', H.dim, c)}`,
    '',
    `    ${hc('features["barrel"].ignoreGlobs', H.gray, c)}    Ignore glob patterns`,
    '',
    `  ${hc('EXAMPLES', `${H.bold}${H.yellow}`, c)}`,
    '',
    `    ${hc('$', H.dim, c)} firebat                              ${hc('# Scan entire project', H.dim, c)}`,
    `    ${hc('$', H.dim, c)} firebat src/app.ts src/utils.ts       ${hc('# Scan specific files', H.dim, c)}`,
    `    ${hc('$', H.dim, c)} firebat --only waste,lint`,
    `    ${hc('$', H.dim, c)} firebat install                      ${hc('# Set up config files', H.dim, c)}`,
    '',
  ];

  writeStdout(lines.join('\n'));
};

const resolveEnabledDetectorsFromFeatures = (features: FirebatConfig['features'] | undefined): ReadonlyArray<FirebatDetector> => {
  const all: ReadonlyArray<FirebatDetector> = [
    'waste',
    'barrel',
    'unknown-proof',
    'error-flow',
    'format',
    'lint',
    'typecheck',
    'dependencies',
    'coupling',
    'nesting',
    'early-return',
    'collapsible-if',
    'indirection',
    'temporal-coupling',
    'variable-lifetime',
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

const resolveBarrelIgnoreGlobsFromFeatures = (
  features: FirebatConfig['features'] | undefined,
): ReadonlyArray<string> | undefined => {
  const { barrel: value } = features ?? {};

  if (!value || value === true || typeof value !== 'object') {
    return undefined;
  }

  const ignoreGlobs = (value as BarrelFeatureValue).ignoreGlobs;

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
  const { duplicates: unified } = features ?? {};
  const unifiedSize =
    typeof unified === 'object' && unified !== null
      ? ((unified as Record<string, unknown>).minSize as number | undefined)
      : undefined;

  return unifiedSize;
};

const resolveMaxForwardDepthFromFeatures = (features: FirebatConfig['features'] | undefined): number | undefined => {
  const indirection = features?.indirection;

  if (indirection === undefined || indirection === false || indirection === true) {
    return undefined;
  }

  return indirection.maxForwardDepth;
};

const resolveCrossFileMinDepthFromFeatures = (features: FirebatConfig['features'] | undefined): number | undefined => {
  const indirection = features?.indirection;

  if (indirection === undefined || indirection === false || indirection === true) {
    return undefined;
  }

  return indirection.crossFileMinDepth;
};

const resolveCouplingConfigFromFeatures = (
  features: FirebatConfig['features'] | undefined,
): FirebatCouplingConfig | undefined => {
  const coupling = features?.coupling;

  if (coupling === undefined || coupling === false || coupling === true) {
    return undefined;
  }

  return coupling;
};

const resolveExpandedTargets = async (
  rootAbs: string,
  options: FirebatCliOptions,
  cfgExclude: readonly string[] | undefined,
  logger: FirebatLogger,
): Promise<string[]> => {
  if (options.targets.length > 0) {
    const targets = await resolveTargets(rootAbs, options.targets, cfgExclude);

    logger.debug('Targets expanded', { inputTargetCount: options.targets.length, expandedTargetCount: targets.length });

    return targets;
  }

  const targets = await resolveTargets(rootAbs, undefined, cfgExclude);

  logger.debug('Targets auto-discovered', { discoveredTargetCount: targets.length, rootAbs });

  return targets;
};

interface ConfigOverrides {
  readonly cfgDetectors: ReadonlyArray<FirebatDetector>;
  readonly cfgMinSize: FirebatCliOptions['minSize'] | undefined;
  readonly cfgMaxForwardDepth: number | undefined;
  readonly cfgCrossFileMinDepth: number | undefined;
  readonly cfgBarrelIgnoreGlobs: ReadonlyArray<string> | undefined;
  readonly cfgDependenciesLayers: ReadonlyArray<{ readonly name: string; readonly glob: string }> | undefined;
  readonly cfgDependenciesAllowedDeps: Readonly<Record<string, ReadonlyArray<string>>> | undefined;
  readonly cfgCouplingConfig: FirebatCouplingConfig | undefined;
  readonly cfgExclude: ReadonlyArray<string> | undefined;
  readonly resolvedConfigPath: string | undefined;
}

const applyIfNotExplicit = <K extends string, V>(
  explicit: boolean | undefined,
  key: K,
  value: V | undefined,
): { [P in K]?: V } => {
  if (explicit || value === undefined) {
    return {};
  }

  return { [key]: value } as { [P in K]?: V };
};

const mergeConfigIntoOptions = (options: FirebatCliOptions, overrides: ConfigOverrides): FirebatCliOptions => {
  const { explicit } = options;

  return {
    ...options,
    ...applyIfNotExplicit(explicit?.minSize, 'minSize', overrides.cfgMinSize),
    ...applyIfNotExplicit(explicit?.maxForwardDepth, 'maxForwardDepth', overrides.cfgMaxForwardDepth),
    ...applyIfNotExplicit(explicit?.crossFileMinDepth, 'crossFileMinDepth', overrides.cfgCrossFileMinDepth),
    ...(explicit?.detectors ? {} : { detectors: overrides.cfgDetectors }),
    ...(overrides.cfgBarrelIgnoreGlobs !== undefined ? { barrelIgnoreGlobs: overrides.cfgBarrelIgnoreGlobs } : {}),
    ...(overrides.cfgDependenciesLayers !== undefined ? { dependenciesLayers: overrides.cfgDependenciesLayers } : {}),
    ...(overrides.cfgDependenciesAllowedDeps !== undefined
      ? { dependenciesAllowedDependencies: overrides.cfgDependenciesAllowedDeps }
      : {}),
    ...(overrides.cfgCouplingConfig !== undefined ? { couplingConfig: overrides.cfgCouplingConfig } : {}),
    ...(overrides.cfgExclude !== undefined && overrides.cfgExclude.length > 0 ? { exclude: overrides.cfgExclude } : {}),
    ...(overrides.resolvedConfigPath !== undefined ? { configPath: overrides.resolvedConfigPath } : {}),
  };
};

const resolveOptions = async (argv: readonly string[], logger: FirebatLogger): Promise<FirebatCliOptions> => {
  const options = parseArgs(argv);

  logger.trace('CLI args parsed', { targets: options.targets.length, help: options.help });

  if (options.help) {
    return options;
  }

  const { rootAbs } = await resolveFirebatRootFromCwd();

  logger.debug('Project root resolved', { rootAbs });

  const configPath = options.configPath ?? resolveDefaultFirebatRcPath(rootAbs);
  const loaded = await loadFirebatConfigFile({ rootAbs, configPath });
  const config = loaded.config;

  logger.debug('Config loaded', { resolvedPath: loaded.resolvedPath, hasConfig: config !== null });

  const featuresCfg = config?.features;
  const cfgDetectors = resolveEnabledDetectorsFromFeatures(featuresCfg);
  const cfgMinSize = resolveMinSizeFromFeatures(featuresCfg);
  const cfgMaxForwardDepth = resolveMaxForwardDepthFromFeatures(featuresCfg);
  const cfgCrossFileMinDepth = resolveCrossFileMinDepthFromFeatures(featuresCfg);
  const cfgBarrelIgnoreGlobs = resolveBarrelIgnoreGlobsFromFeatures(featuresCfg);
  const cfgDependenciesLayers = resolveDependenciesLayersFromFeatures(featuresCfg);
  const cfgDependenciesAllowedDeps = resolveDependenciesAllowedDependenciesFromFeatures(featuresCfg);
  const cfgCouplingConfig = resolveCouplingConfigFromFeatures(featuresCfg);
  const cfgExclude = config?.exclude;

  logger.trace('Features resolved from config', {
    detectors: cfgDetectors.length,
    minSize: cfgMinSize,
    maxForwardDepth: cfgMaxForwardDepth,
    crossFileMinDepth: cfgCrossFileMinDepth,
  });

  const merged = mergeConfigIntoOptions(options, {
    cfgDetectors,
    cfgMinSize,
    cfgMaxForwardDepth,
    cfgCrossFileMinDepth,
    cfgBarrelIgnoreGlobs,
    cfgDependenciesLayers,
    cfgDependenciesAllowedDeps,
    cfgCouplingConfig,
    cfgExclude,
    resolvedConfigPath: loaded.resolvedPath,
  });
  const targets = await resolveExpandedTargets(rootAbs, merged, cfgExclude, logger);

  return { ...merged, targets };
};

const runScan = async (options: FirebatCliOptions, logger: ReturnType<typeof createCliLogger>): Promise<number> => {
  let report: FirebatReport | null = null;

  try {
    report = await scanUseCase(options, { logger });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await appendCliErrorLog(err);

    logger.error('Failed', { message }, err);

    return 1;
  }

  if (!report) {
    return 0;
  }

  if (report.meta.errors !== undefined) {
    for (const [key, message] of Object.entries(report.meta.errors)) {
      logger.error('Detector error', { key, message });
    }
  }

  const output = formatReport(report);

  logger.trace('Report formatted', { length: output.length });

  process.stdout.write(output + '\n');

  const total = report.findings.length;

  logger.debug('Findings counted', { total });

  return total > 0 ? 1 : 0;
};

const runCli = async (argv: readonly string[]): Promise<number> => {
  // Create early logger for resolveOptions; upgraded after options are known.
  const earlyLogger = createCliLogger({ level: undefined, logStack: undefined });
  let options: FirebatCliOptions | null = null;

  try {
    options = await resolveOptions(argv, earlyLogger);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await appendCliErrorLog(err);
    createPrettyConsoleLogger({ level: 'error', includeStack: false }).error(message);

    return 1;
  }

  if (options.help) {
    return printHelpAndExit();
  }

  const logger = createCliLogger({ level: options.logLevel, logStack: options.logStack });

  logger.debug('Options resolved', {
    targetCount: options.targets.length,
    detectorCount: options.detectors.length,
  });

  return runScan(options, logger);
};

export { runCli };

export const __testing__ = {
  resolveEnabledDetectorsFromFeatures,
  resolveBarrelIgnoreGlobsFromFeatures,
  resolveDependenciesLayersFromFeatures,
  resolveDependenciesAllowedDependenciesFromFeatures,
  resolveMinSizeFromFeatures,
  resolveMaxForwardDepthFromFeatures,
  resolveCrossFileMinDepthFromFeatures,
};
