import type { FirebatDetector, FirebatReport } from '../../types';
import type { FirebatCliOptions } from '../../interfaces';
import type { FirebatConfig } from '../../firebat-config';

import { parseArgs } from '../../arg-parse';
import { formatReport } from '../../report';
import { discoverDefaultTargets, expandTargets } from '../../target-discovery';
import { scanUseCase } from '../../application/scan/scan.usecase';
import { appendFirebatLog } from '../../infra/logging';
import { resolveFirebatRootFromCwd } from '../../root-resolver';
import { loadFirebatConfigFile, resolveDefaultFirebatRcPath } from '../../firebat-config.loader';

const LOG_LEVELS = ['silent', 'error', 'warn', 'info'] as const;
type LogLevel = (typeof LOG_LEVELS)[number];

const shouldLog = (level: LogLevel, threshold: LogLevel): boolean => {
  if (threshold === 'silent') return false;
  if (level === 'error') return true;
  if (level === 'warn') return threshold === 'warn' || threshold === 'info';
  return threshold === 'info';
};

const createCliLogger = (logLevel: LogLevel) => {
  return {
    error: (message: string): void => {
      if (shouldLog('error', logLevel)) console.error(message);
    },
    warn: (message: string): void => {
      if (shouldLog('warn', logLevel)) console.error(message);
    },
    info: (message: string): void => {
      if (shouldLog('info', logLevel)) console.error(message);
    },
  };
};

const printHelp = (): void => {
  const lines = [
    'firebat - Bunner code quality scanner',
    '',
    'Usage:',
    '  firebat [targets...] [options]',
    '  firebat scan [targets...] [options]',
    '  firebat install',
    '  firebat i',
    '  firebat update',
    '  firebat u',
    '  firebat cache clean',
    '  firebat mcp',
    '',
    'Defaults:',
    '  - If no targets are provided, firebat scans the repo sources automatically.',
    '  - If --only is not provided, all detectors are executed.',
    '',
    'Options:',
    '  --format text|json       Output format (default: text)',
    '  --min-size <n|auto>      Minimum size threshold for duplicates (default: auto)',
    '  --max-forward-depth <n>  Max allowed thin-wrapper chain depth (default: 0)',
    '  --only <list>            Limit detectors to exact-duplicates,waste,barrel-policy,unknown-proof,format,lint,typecheck,dependencies,coupling,structural-duplicates,nesting,early-return,noop,api-drift,forwarding',
    '  (config) unknown-proof   Configure boundary globs via features["unknown-proof"].boundaryGlobs (default: global)',
    '  (config) barrel-policy   Configure ignore globs via features["barrel-policy"].ignoreGlobs (default: node_modules/**,dist/**)',
    '  --fix                    Apply safe autofixes where supported (oxfmt --write; oxlint --fix)',
    '  --config <path>          Config file path (default: <root>/.firebatrc.jsonc)',
    '  --log-level <level>      silent|error|warn|info (default: error)',
    '  --no-exit                Always exit 0 even if findings exist',
    '  -h, --help               Show this help',
  ];

  console.log(lines.join('\n'));
};

const countBlockingFindings = (report: FirebatReport): number => {
  const typecheckErrors = report.analyses.typecheck.items.filter(item => item.severity === 'error').length;
  const forwardingFindings = report.analyses.forwarding.findings.length;
  const lintErrors = report.analyses.lint.diagnostics.filter(item => item.severity === 'error').length;
  const unknownProofFindings = report.analyses.unknownProof.findings.length;
  const formatFindings = report.analyses.format.status === 'needs-formatting' || report.analyses.format.status === 'failed' ? 1 : 0;
  const barrelPolicyFindings = report.analyses.barrelPolicy.findings.length;

  return (
    report.analyses['exact-duplicates'].length +
    report.analyses.waste.length +
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

const resolveMinSizeFromFeatures = (features: FirebatConfig['features'] | undefined): FirebatCliOptions['minSize'] | undefined => {
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

const resolveOptions = async (argv: readonly string[]): Promise<FirebatCliOptions> => {
  const options = parseArgs(argv);

  if (options.help) {
    return options;
  }

  const { rootAbs } = await resolveFirebatRootFromCwd();

  let config: FirebatConfig | null = null;
  const configPath = options.configPath ?? resolveDefaultFirebatRcPath(rootAbs);
  const loaded = await loadFirebatConfigFile({ rootAbs, configPath });
  config = loaded.config;

  const outputCfg = config?.output;
  const loggingCfg = config?.logging;
  const featuresCfg = config?.features;
  const cfgDetectors = resolveEnabledDetectorsFromFeatures(featuresCfg);
  const cfgMinSize = resolveMinSizeFromFeatures(featuresCfg);
  const cfgMaxForwardDepth = resolveMaxForwardDepthFromFeatures(featuresCfg);
  const cfgUnknownProofBoundaryGlobs = resolveUnknownProofBoundaryGlobsFromFeatures(featuresCfg);
  const cfgBarrelPolicyIgnoreGlobs = resolveBarrelPolicyIgnoreGlobsFromFeatures(featuresCfg);

  const merged: FirebatCliOptions = {
    ...options,
    ...(options.explicit?.format ? {} : outputCfg?.format !== undefined ? { format: outputCfg.format } : {}),
    ...(options.explicit?.exitOnFindings
      ? {}
      : outputCfg?.exitOnFindings !== undefined
        ? { exitOnFindings: outputCfg.exitOnFindings }
        : {}),
    ...(options.explicit?.minSize ? {} : cfgMinSize !== undefined ? { minSize: cfgMinSize } : {}),
    ...(options.explicit?.maxForwardDepth ? {} : cfgMaxForwardDepth !== undefined ? { maxForwardDepth: cfgMaxForwardDepth } : {}),
    ...(options.explicit?.detectors ? {} : { detectors: cfgDetectors }),
    ...(options.explicit?.logLevel ? {} : loggingCfg?.level !== undefined ? { logLevel: loggingCfg.level } : {}),
    ...(cfgUnknownProofBoundaryGlobs !== undefined ? { unknownProofBoundaryGlobs: cfgUnknownProofBoundaryGlobs } : {}),
    ...(cfgBarrelPolicyIgnoreGlobs !== undefined ? { barrelPolicyIgnoreGlobs: cfgBarrelPolicyIgnoreGlobs } : {}),
    configPath: loaded.resolvedPath,
  };

  if (merged.targets.length > 0) {
    const targets = await expandTargets(merged.targets);

    return {
      ...merged,
      targets,
    };
  }

  const targets = await discoverDefaultTargets(rootAbs);

  return {
    ...merged,
    targets,
  };
};

const runCli = async (argv: readonly string[]): Promise<number> => {
  let options: FirebatCliOptions;

  try {
    options = await resolveOptions(argv);
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

    const logger = createCliLogger('error');
    logger.error(message);

    return 1;
  }

  const logger = createCliLogger(options.logLevel ?? 'error');

  if (options.help) {
    printHelp();

    return 0;
  }

  let report: FirebatReport;

  try {
    report = await scanUseCase(options);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    try {
      const { rootAbs } = await resolveFirebatRootFromCwd();

      let logPath = '.firebat/cli-error.log';

      try {
        const loaded = await loadFirebatConfigFile({
          rootAbs,
          ...(options.configPath !== undefined ? { configPath: options.configPath } : {}),
        });
        const filePath = loaded.config?.logging?.filePath;

        if (typeof filePath === 'string' && filePath.trim().length > 0) {
          logPath = filePath;
        }
      } catch {
        // ignore
      }

      await appendFirebatLog(
        rootAbs,
        logPath,
        err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ''}` : String(err),
      );
    } catch {
      // ignore
    }

    logger.error(`[firebat] Failed: ${message}`);

    return 1;
  }

  const output = formatReport(report, options.format);

  console.log(output);

  const findingCount = countBlockingFindings(report);

  if (findingCount > 0 && options.exitOnFindings) {
    return 1;
  }

  return 0;
};

export { runCli };
