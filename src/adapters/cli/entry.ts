import type { FirebatConfig } from '../../firebat-config';
import type { FirebatCliOptions } from '../../interfaces';
import type { FirebatLogger } from '../../ports/logger';
import type { FirebatDetector, FirebatReport } from '../../types';

import { scanUseCase } from '../../application/scan/scan.usecase';
import { parseArgs } from '../../arg-parse';
import { loadFirebatConfigFile, resolveDefaultFirebatRcPath } from '../../firebat-config.loader';
import { appendFirebatLog } from '../../infra/logging';
import { createPrettyConsoleLogger } from '../../infrastructure/logging/pretty-console-logger';
import { formatReport } from '../../report';
import { resolveFirebatRootFromCwd } from '../../root-resolver';
import { discoverDefaultTargets, expandTargets } from '../../target-discovery';

const createCliLogger = (input: {
  level: FirebatCliOptions['logLevel'];
  logStack: FirebatCliOptions['logStack'];
}): FirebatLogger => {
  return createPrettyConsoleLogger({
    level: input.level ?? 'info',
    includeStack: input.logStack ?? false,
  });
};

const isTty = (): boolean => Boolean((process as any)?.stdout?.isTTY);

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
    `    noop, forwarding, barrel-policy, unknown-proof, api-drift,`,
    `    lint, format, typecheck, dependencies, coupling`,
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
    `    ${hc('$', H.dim, c)} firebat --only waste,noop --format json`,
    `    ${hc('$', H.dim, c)} firebat --fix                        ${hc('# Auto-fix lint & format issues', H.dim, c)}`,
    `    ${hc('$', H.dim, c)} firebat install                      ${hc('# Set up config files', H.dim, c)}`,
    '',
  ];

  writeStdout(lines.join('\n'));
};

const countBlockingFindings = (report: FirebatReport): number => {
  const typecheckErrors = report.analyses['typecheck']?.items?.filter(item => item.severity === 'error').length ?? 0;
  const forwardingFindings = report.analyses['forwarding']?.findings?.length ?? 0;
  const lintErrors = report.analyses['lint']?.diagnostics?.filter(item => item.severity === 'error').length ?? 0;
  const unknownProofFindings = report.analyses['unknown-proof']?.findings?.length ?? 0;
  const formatStatus = report.analyses['format']?.status;
  const formatFindings = formatStatus === 'needs-formatting' || formatStatus === 'failed' ? 1 : 0;
  const barrelPolicyFindings = report.analyses['barrel-policy']?.findings?.length ?? 0;

  return (
    (report.analyses['exact-duplicates']?.length ?? 0) +
    (report.analyses['waste']?.length ?? 0) +
    barrelPolicyFindings +
    formatFindings +
    unknownProofFindings +
    lintErrors +
    typecheckErrors +
    forwardingFindings
  );
};

const resolveEnabledDetectorsFromFeatures = (features: FirebatConfig['features'] | undefined): ReadonlyArray<FirebatDetector> => {
  const all: ReadonlyArray<FirebatDetector> = [
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

  if (!features) {
    return all;
  }

  return all.filter(detector => {
    const value = (features as any)[detector];

    return value !== false;
  });
};

const resolveUnknownProofBoundaryGlobsFromFeatures = (
  features: FirebatConfig['features'] | undefined,
): ReadonlyArray<string> | undefined => {
  const value = (features as any)?.['unknown-proof'];

  if (value === undefined || value === false) {
    return undefined;
  }

  if (value === true) {
    return undefined;
  }

  if (typeof value === 'object' && value !== null) {
    const boundaryGlobs = (value as any).boundaryGlobs;

    return Array.isArray(boundaryGlobs) && boundaryGlobs.every((e: any) => typeof e === 'string') ? boundaryGlobs : undefined;
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

const resolveMinSizeFromFeatures = (
  features: FirebatConfig['features'] | undefined,
): FirebatCliOptions['minSize'] | undefined => {
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

const resolveOptions = async (argv: readonly string[], logger: FirebatLogger): Promise<FirebatCliOptions> => {
  const options = parseArgs(argv);

  logger.trace('CLI args parsed', { targets: options.targets.length, format: options.format, help: options.help });

  if (options.help) {
    return options;
  }

  const { rootAbs } = await resolveFirebatRootFromCwd();

  logger.debug(`Project root: ${rootAbs}`);

  let config: FirebatConfig | null = null;
  const configPath = options.configPath ?? resolveDefaultFirebatRcPath(rootAbs);
  const loaded = await loadFirebatConfigFile({ rootAbs, configPath });

  config = loaded.config;

  logger.debug(`Config loaded from ${loaded.resolvedPath}`, { hasConfig: config !== null });

  const featuresCfg = config?.features;
  const cfgDetectors = resolveEnabledDetectorsFromFeatures(featuresCfg);
  const cfgMinSize = resolveMinSizeFromFeatures(featuresCfg);
  const cfgMaxForwardDepth = resolveMaxForwardDepthFromFeatures(featuresCfg);
  const cfgUnknownProofBoundaryGlobs = resolveUnknownProofBoundaryGlobsFromFeatures(featuresCfg);
  const cfgBarrelPolicyIgnoreGlobs = resolveBarrelPolicyIgnoreGlobsFromFeatures(featuresCfg);

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
    ...(cfgUnknownProofBoundaryGlobs !== undefined ? { unknownProofBoundaryGlobs: cfgUnknownProofBoundaryGlobs } : {}),
    ...(cfgBarrelPolicyIgnoreGlobs !== undefined ? { barrelPolicyIgnoreGlobs: cfgBarrelPolicyIgnoreGlobs } : {}),
    configPath: loaded.resolvedPath,
  };

  if (merged.targets.length > 0) {
    const targets = await expandTargets(merged.targets);

    logger.debug(`Expanded ${merged.targets.length} explicit targets to ${targets.length} files`);

    return {
      ...merged,
      targets,
    };
  }

  const targets = await discoverDefaultTargets(rootAbs);

  logger.debug(`Auto-discovered ${targets.length} files from ${rootAbs}`);

  return {
    ...merged,
    targets,
  };
};

const runCli = async (argv: readonly string[]): Promise<number> => {
  let options: FirebatCliOptions;
  // Create early logger for resolveOptions; upgraded after options are known.
  const earlyLogger = createCliLogger({ level: undefined, logStack: undefined });

  try {
    options = await resolveOptions(argv, earlyLogger);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    try {
      const { rootAbs } = await resolveFirebatRootFromCwd();

      await appendFirebatLog(
        rootAbs,
        '.firebat/cli-error.log',
        err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ''}` : String(err),
      );
    } catch {
      // ignore
    }

    createPrettyConsoleLogger({ level: 'error', includeStack: false }).error(message);

    return 1;
  }

  const logger = createCliLogger({ level: options.logLevel, logStack: options.logStack });

  logger.debug(
    `Options resolved: ${options.targets.length} targets, ${options.detectors.length} detectors, format=${options.format}`,
  );

  if (options.help) {
    printHelp();

    return 0;
  }

  let report: FirebatReport;

  try {
    report = await scanUseCase(options, { logger });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    try {
      const { rootAbs } = await resolveFirebatRootFromCwd();

      await appendFirebatLog(
        rootAbs,
        '.firebat/cli-error.log',
        err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ''}` : String(err),
      );
    } catch {
      // ignore
    }

    logger.error('Failed', { message }, err);

    return 1;
  }

  const output = formatReport(report, options.format);

  logger.trace(`Report formatted (${options.format}), length=${output.length}`);

  process.stdout.write(output + '\n');

  const findingCount = countBlockingFindings(report);

  logger.debug(`Blocking findings: ${findingCount}`);

  const exitCode = findingCount > 0 && options.exitOnFindings ? 1 : 0;

  return exitCode;
};

export { runCli };
