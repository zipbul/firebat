import * as path from 'node:path';

import type { FirebatLogLevel } from './firebat-config';
import type { FirebatCliExplicitFlags, FirebatCliOptions } from './interfaces';
import type { FirebatDetector, MinSizeOption, OutputFormat } from './types';

const DEFAULT_MIN_SIZE: MinSizeOption = 'auto';
const DEFAULT_MAX_FORWARD_DEPTH = 0;
const DEFAULT_DETECTORS: ReadonlyArray<FirebatDetector> = [
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

const parseLogLevel = (value: string): FirebatLogLevel => {
  if (value === 'error' || value === 'warn' || value === 'info' || value === 'debug' || value === 'trace') {
    return value;
  }

  throw new Error(`[firebat] Invalid --log-level: ${value}. Expected error|warn|info|debug|trace`);
};

const parseNumber = (value: string, label: string): number => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`[firebat] Invalid ${label}: ${value}`);
  }

  return parsed;
};

const parseMinSize = (value: string): MinSizeOption => {
  if (value === 'auto') {
    return 'auto';
  }

  return parseNumber(value, '--min-size');
};

const parseOutputFormat = (value: string): OutputFormat => {
  if (value === 'text' || value === 'json') {
    return value;
  }

  throw new Error(`[firebat] Invalid --format: ${value}. Expected text|json`);
};

const parseDetectors = (value: string): ReadonlyArray<FirebatDetector> => {
  const selections = value
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0);

  if (selections.length === 0) {
    throw new Error('[firebat] Missing value for --only');
  }

  const detectors: FirebatDetector[] = [];
  const seen = new Set<FirebatDetector>();

  for (const selection of selections) {
    if (
      selection !== 'exact-duplicates' &&
      selection !== 'waste' &&
      selection !== 'barrel-policy' &&
      selection !== 'unknown-proof' &&
      selection !== 'exception-hygiene' &&
      selection !== 'format' &&
      selection !== 'lint' &&
      selection !== 'typecheck' &&
      selection !== 'dependencies' &&
      selection !== 'coupling' &&
      selection !== 'structural-duplicates' &&
      selection !== 'nesting' &&
      selection !== 'early-return' &&
      selection !== 'noop' &&
      selection !== 'api-drift' &&
      selection !== 'forwarding'
    ) {
      throw new Error(
        `[firebat] Invalid --only: ${selection}. Expected exact-duplicates|waste|barrel-policy|unknown-proof|exception-hygiene|format|lint|typecheck|dependencies|coupling|structural-duplicates|nesting|early-return|noop|api-drift|forwarding`,
      );
    }

    if (seen.has(selection)) {
      continue;
    }

    seen.add(selection);
    detectors.push(selection);
  }

  if (detectors.length === 0) {
    throw new Error('[firebat] Missing value for --only');
  }

  return detectors;
};

const normalizeTarget = (raw: string): string => {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    throw new Error('[firebat] Empty target path');
  }

  return path.resolve(trimmed);
};

interface ExplicitMutable {
  format: boolean;
  minSize: boolean;
  maxForwardDepth: boolean;
  exitOnFindings: boolean;
  detectors: boolean;
  fix: boolean;
  configPath: boolean;
  logLevel: boolean;
  logStack: boolean;
}

const parseArgs = (argv: readonly string[]): FirebatCliOptions => {
  const targets: string[] = [];
  let format: OutputFormat = 'text';
  let minSize: MinSizeOption = DEFAULT_MIN_SIZE;
  let maxForwardDepth = DEFAULT_MAX_FORWARD_DEPTH;
  let exitOnFindings = true;
  let detectors: ReadonlyArray<FirebatDetector> = DEFAULT_DETECTORS;
  let fix = false;
  let configPath: string | undefined;
  let logLevel: FirebatLogLevel | undefined;
  let logStack: boolean | undefined;

  const toExplicitFlags = (input: ExplicitMutable): FirebatCliExplicitFlags => {
    return {
      format: input.format,
      minSize: input.minSize,
      maxForwardDepth: input.maxForwardDepth,
      exitOnFindings: input.exitOnFindings,
      detectors: input.detectors,
      fix: input.fix,
      configPath: input.configPath,
      logLevel: input.logLevel,
      logStack: input.logStack,
    };
  };

  const explicit: ExplicitMutable = {
    format: false,
    minSize: false,
    maxForwardDepth: false,
    exitOnFindings: false,
    detectors: false,
    fix: false,
    configPath: false,
    logLevel: false,
    logStack: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (typeof arg !== 'string') {
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      return {
        targets: [],
        format,
        minSize,
        maxForwardDepth,
        exitOnFindings,
        detectors,
        fix,
        help: true,
        ...(configPath !== undefined ? { configPath } : {}),
        ...(logLevel !== undefined ? { logLevel } : {}),
        explicit: toExplicitFlags(explicit),
      };
    }

    if (arg === '--format') {
      const value = argv[i + 1];

      if (typeof value !== 'string') {
        throw new Error('[firebat] Missing value for --format');
      }

      format = parseOutputFormat(value);
      explicit.format = true;

      i += 1;

      continue;
    }

    if (arg === '--min-size') {
      const value = argv[i + 1];

      if (typeof value !== 'string') {
        throw new Error('[firebat] Missing value for --min-size');
      }

      minSize = parseMinSize(value);
      explicit.minSize = true;

      i += 1;

      continue;
    }

    if (arg === '--max-forward-depth') {
      const value = argv[i + 1];

      if (typeof value !== 'string') {
        throw new Error('[firebat] Missing value for --max-forward-depth');
      }

      maxForwardDepth = Math.max(0, Math.round(parseNumber(value, '--max-forward-depth')));
      explicit.maxForwardDepth = true;

      i += 1;

      continue;
    }

    if (arg === '--no-exit') {
      exitOnFindings = false;
      explicit.exitOnFindings = true;

      continue;
    }

    if (arg === '--fix') {
      fix = true;
      explicit.fix = true;

      continue;
    }

    if (arg === '--only') {
      const value = argv[i + 1];

      if (typeof value !== 'string') {
        throw new Error('[firebat] Missing value for --only');
      }

      detectors = parseDetectors(value);
      explicit.detectors = true;

      i += 1;

      continue;
    }

    if (arg === '--config') {
      const value = argv[i + 1];

      if (typeof value !== 'string') {
        throw new Error('[firebat] Missing value for --config');
      }

      configPath = path.resolve(value);
      explicit.configPath = true;

      i += 1;

      continue;
    }

    if (arg === '--log-level') {
      const value = argv[i + 1];

      if (typeof value !== 'string') {
        throw new Error('[firebat] Missing value for --log-level');
      }

      logLevel = parseLogLevel(value);
      explicit.logLevel = true;

      i += 1;

      continue;
    }

    if (arg === '--log-stack') {
      logStack = true;
      explicit.logStack = true;

      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`[firebat] Unknown option: ${arg}`);
    }

    targets.push(normalizeTarget(arg));
  }

  return {
    targets,
    format,
    minSize,
    maxForwardDepth,
    exitOnFindings,
    detectors,
    fix,
    help: false,
    ...(configPath !== undefined ? { configPath } : {}),
    ...(logLevel !== undefined ? { logLevel } : {}),
    ...(logStack !== undefined ? { logStack } : {}),
    explicit: toExplicitFlags(explicit),
  };
};

export { parseArgs };
