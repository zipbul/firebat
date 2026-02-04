import type { FirebatReport } from '../../types';
import type { FirebatCliOptions } from '../../interfaces';

import { parseArgs } from '../../arg-parse';
import { formatReport } from '../../report';
import { discoverDefaultTargets } from '../../target-discovery';
import { scanUseCase } from '../../application/scan/scan.usecase';
import { appendFirebatLog } from '../../infra/logging';
import { resolveFirebatRootFromCwd } from '../../root-resolver';

const printHelp = (): void => {
  const lines = [
    'firebat - Bunner code quality scanner',
    '',
    'Usage:',
    '  firebat [targets...] [options]',
    '  firebat scan [targets...] [options]',
    '  firebat install',
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
    '  --only <list>            Limit detectors to duplicates,waste,typecheck,dependencies,coupling,duplication,nesting,early-return,noop,api-drift,forwarding',
    '  --no-exit                Always exit 0 even if findings exist',
    '  -h, --help               Show this help',
  ];

  console.log(lines.join('\n'));
};

const countBlockingFindings = (report: FirebatReport): number => {
  const typecheckErrors = report.analyses.typecheck.items.filter(item => item.severity === 'error').length;
  const forwardingFindings = report.analyses.forwarding.findings.length;

  return report.analyses.duplicates.length + report.analyses.waste.length + typecheckErrors + forwardingFindings;
};

const resolveOptions = async (argv: readonly string[]): Promise<FirebatCliOptions> => {
  const options = parseArgs(argv);

  if (options.targets.length > 0 || options.help) {
    return options;
  }

  const targets = await discoverDefaultTargets(process.cwd());

  return {
    ...options,
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
      const rootAbs = await resolveFirebatRootFromCwd();

      await appendFirebatLog(
        rootAbs,
        '.firebat/cli-error.log',
        err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ''}` : String(err),
      );
    } catch {
      // ignore
    }

    console.error(message);

    return 1;
  }

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
      const rootAbs = await resolveFirebatRootFromCwd();

      await appendFirebatLog(
        rootAbs,
        '.firebat/cli-error.log',
        err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ''}` : String(err),
      );
    } catch {
      // ignore
    }

    console.error(`[firebat] Failed: ${message}`);

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
