import type { FirebatCliOptions } from '../../interfaces';
import type { FirebatConfig, FirebatLogger } from '../../shared';
import type { FirebatDetector, FirebatReport } from '../../types';

import { scanUseCase } from '../../application/scan';
import { formatReport } from '../../report';
import {
  appendFirebatLog,
  createPrettyConsoleLogger,
  isStringArray,
  loadFirebatConfigFile,
  parseArgs,
  resolveDefaultFirebatRcPath,
  resolveFirebatRootFromCwd,
  resolveStartDir,
  resolveTargets,
  toErrorMessage,
} from '../../shared';
import { H, hc, isTty, writeStdout } from './cli-output';

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
    `    ${hc('--cwd, -C', `${H.bold}${H.green}`, c)} ${hc('<dir>', H.gray, c)}         Directory to resolve the project root from ${hc('(default: process.cwd())', H.dim, c)}`,
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
    `    indirection, barrel,`,
    `    error-flow, lint, format, typecheck, dependencies,`,
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

// D15: barrel is declared active only by features.barrel === true or an
// object config — everything else (absent, false, or any other value) means
// "not declared via config" for the purposes of the implicit detector set.
// (Explicit `--only barrel` selection, handled entirely in resolveOptions
// below, is the other declaration path and does not go through this table.)
const isBarrelDeclaredActiveInFeatures = (barrelValue: unknown): boolean =>
  barrelValue === true || (typeof barrelValue === 'object' && barrelValue !== null);

const resolveEnabledDetectorsFromFeatures = (features: FirebatConfig['features'] | undefined): ReadonlyArray<FirebatDetector> => {
  const all: ReadonlyArray<FirebatDetector> = [
    'waste',
    'barrel',
    'error-flow',
    'format',
    'lint',
    'typecheck',
    'dependencies',
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
    return all.filter(detector => detector !== 'barrel');
  }

  const disabled = new Set<FirebatDetector>();

  for (const detector of all) {
    if (detector === 'barrel') {
      if (!isBarrelDeclaredActiveInFeatures((features as Record<string, unknown>).barrel)) {
        disabled.add(detector);
      }

      continue;
    }

    if ((features as Record<string, unknown>)[detector] === false) {
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

  return isStringArray(ignoreGlobs) ? ignoreGlobs : undefined;
};

type DependenciesFeatureValue = {
  readonly layers: ReadonlyArray<{ readonly name: string; readonly glob: string }>;
  readonly allowedDependencies: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly entry?: ReadonlyArray<string>;
  readonly ignore?: ReadonlyArray<string>;
  readonly ignoreDependencies?: ReadonlyArray<string>;
};

const resolveDependenciesGlobsFromFeatures = (
  features: FirebatConfig['features'] | undefined,
  field: 'entry' | 'ignore' | 'ignoreDependencies',
): ReadonlyArray<string> | undefined => {
  const value = features?.dependencies;

  if (!value || value === true || typeof value !== 'object') {
    return undefined;
  }

  const globs = (value as DependenciesFeatureValue)[field];

  return isStringArray(globs) ? globs : undefined;
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

    if (!isStringArray(list)) {
      return undefined;
    }
  }

  return allowed as Readonly<Record<string, ReadonlyArray<string>>>;
};

const resolveMinSizeFromFeatures = (
  features: FirebatConfig['features'] | undefined,
): FirebatCliOptions['minSize'] | undefined => {
  const { duplicates: unified } = features ?? {};

  return typeof unified === 'object' && unified !== null
    ? ((unified as Record<string, unknown>).minSize as number | undefined)
    : undefined;
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
  readonly cfgDependenciesEntry: ReadonlyArray<string> | undefined;
  readonly cfgDependenciesIgnoreDeps: ReadonlyArray<string> | undefined;
  readonly cfgDependenciesIgnore: ReadonlyArray<string> | undefined;
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
    ...(overrides.cfgDependenciesEntry !== undefined ? { dependenciesEntry: overrides.cfgDependenciesEntry } : {}),
    ...(overrides.cfgDependenciesIgnoreDeps !== undefined ? { dependenciesIgnoreDeps: overrides.cfgDependenciesIgnoreDeps } : {}),
    ...(overrides.cfgDependenciesIgnore !== undefined ? { dependenciesIgnore: overrides.cfgDependenciesIgnore } : {}),
    ...(overrides.cfgExclude !== undefined && overrides.cfgExclude.length > 0 ? { exclude: overrides.cfgExclude } : {}),
    ...(overrides.resolvedConfigPath !== undefined ? { configPath: overrides.resolvedConfigPath } : {}),
  };
};

// D5 (giant-file surgery, extending D15): a `false`-declared detector's
// non-participation is durable and always wins, even over an explicit
// `--only <detector>` (a per-invocation flag must not overrule it). Applied
// AFTER config/CLI merge because `--only` otherwise bypasses cfgDetectors
// entirely. The domain is PINNED to exactly {barrel, giant-file} — the two
// detectors whose committed definitions declare false-wins. NOT generalized
// to every detector: e.g. `typecheck: false` + occasional `--only typecheck`
// is a real workflow, and every other detector's semantics are unaffected by
// this list unless its own definition adopts false-wins.
const FALSE_WINS_DETECTORS: ReadonlyArray<FirebatDetector> = ['barrel', 'giant-file'];

const applyFalseWinsGate = (
  detectors: ReadonlyArray<FirebatDetector>,
  featuresCfg: FirebatConfig['features'] | undefined,
  logger: FirebatLogger,
): ReadonlyArray<FirebatDetector> => {
  return FALSE_WINS_DETECTORS.reduce((current, detector) => {
    const declaredFalse = (featuresCfg as Record<string, unknown> | undefined)?.[detector] === false;

    if (!declaredFalse || !current.includes(detector)) {
      return current;
    }

    logger.warn(`${detector} policy declared false in config; --only ${detector} ignored`);

    return current.filter(d => d !== detector);
  }, detectors);
};

const resolveOptions = async (
  argv: readonly string[],
  logger: FirebatLogger,
): Promise<{ options: FirebatCliOptions; rootAbs: string }> => {
  const options = parseArgs(argv);

  logger.trace('CLI args parsed', { targets: options.targets.length, help: options.help });

  if (options.help) {
    return { options, rootAbs: resolveStartDir(options.cwd) };
  }

  const { rootAbs } = await resolveFirebatRootFromCwd(resolveStartDir(options.cwd));

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
  const cfgDependenciesEntry = resolveDependenciesGlobsFromFeatures(featuresCfg, 'entry');
  const cfgDependenciesIgnoreDeps = resolveDependenciesGlobsFromFeatures(featuresCfg, 'ignoreDependencies');
  const cfgDependenciesIgnore = resolveDependenciesGlobsFromFeatures(featuresCfg, 'ignore');
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
    cfgDependenciesEntry,
    cfgDependenciesIgnoreDeps,
    cfgDependenciesIgnore,
    cfgExclude,
    resolvedConfigPath: loaded.resolvedPath,
  });
  const targets = await resolveExpandedTargets(rootAbs, merged, cfgExclude, logger);
  const detectors = applyFalseWinsGate(merged.detectors, featuresCfg, logger);

  return { options: { ...merged, detectors, targets }, rootAbs };
};

const runScan = async (
  options: FirebatCliOptions,
  rootAbs: string,
  logger: ReturnType<typeof createCliLogger>,
): Promise<number> => {
  let report: FirebatReport | null;

  try {
    report = await scanUseCase(options, { logger, rootAbs });
  } catch (err) {
    await appendCliErrorLog(err);

    logger.error('Failed', { message: toErrorMessage(err) }, err);

    return 1;
  }

  if (!report) {
    return 0;
  }

  const output = formatReport(report);

  logger.trace('Report formatted', { length: output.length });

  process.stdout.write(output + '\n');

  const total = report.findings.length;
  const hasDetectorErrors = report.meta.errors !== undefined && Object.keys(report.meta.errors).length > 0;

  logger.debug('Findings counted', { total, hasDetectorErrors });

  if (hasDetectorErrors) {
    return 2;
  }

  return total > 0 ? 1 : 0;
};

const runCli = async (argv: readonly string[]): Promise<number> => {
  // Create early logger for resolveOptions; upgraded after options are known.
  const earlyLogger = createCliLogger({ level: undefined, logStack: undefined });
  let options: FirebatCliOptions;
  let rootAbs: string;

  try {
    const resolved = await resolveOptions(argv, earlyLogger);

    options = resolved.options;
    rootAbs = resolved.rootAbs;
  } catch (err) {
    await appendCliErrorLog(err);
    createPrettyConsoleLogger({ level: 'error', includeStack: false }).error(toErrorMessage(err));

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

  return runScan(options, rootAbs, logger);
};

export { runCli };

export const __testing__ = {
  resolveEnabledDetectorsFromFeatures,
  resolveBarrelIgnoreGlobsFromFeatures,
  resolveDependenciesLayersFromFeatures,
  resolveDependenciesAllowedDependenciesFromFeatures,
  resolveDependenciesGlobsFromFeatures,
  resolveMinSizeFromFeatures,
  resolveMaxForwardDepthFromFeatures,
  resolveCrossFileMinDepthFromFeatures,
};
