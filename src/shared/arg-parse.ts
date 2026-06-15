import * as path from 'node:path';

import type { FirebatCliExplicitFlags, FirebatCliOptions } from '../interfaces';
import type { FirebatDetector, MinSizeOption } from '../types';
import type { FirebatLogLevel } from './firebat-config';

import { DETECTOR_ALIASES } from '../types';

const DEFAULT_MIN_SIZE: MinSizeOption = 'auto';
const DEFAULT_MAX_FORWARD_DEPTH = 0;
const DEFAULT_CROSS_FILE_MIN_DEPTH = 2;
const DEFAULT_DETECTORS: ReadonlyArray<FirebatDetector> = [
  'duplicates',
  'waste',
  'barrel',
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

const parseClampedIntArg = (value: string | undefined, flag: string, floor: number): number => {
  if (typeof value !== 'string') {
    throw new Error(`[firebat] Missing value for ${flag}`);
  }

  return Math.max(floor, Math.round(parseNumber(value, flag)));
};

const parseMinSize = (value: string): MinSizeOption => {
  if (value === 'auto') {
    return 'auto';
  }

  return parseNumber(value, '--min-size');
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

  for (const raw of selections) {
    // Apply alias mapping for backward compatibility (e.g. 'exception-hygiene' → 'error-flow')
    const selection = DETECTOR_ALIASES[raw] ?? raw;

    if (
      selection !== 'duplicates' &&
      selection !== 'waste' &&
      selection !== 'barrel' &&
      selection !== 'error-flow' &&
      selection !== 'format' &&
      selection !== 'lint' &&
      selection !== 'typecheck' &&
      selection !== 'dependencies' &&
      selection !== 'coupling' &&
      selection !== 'nesting' &&
      selection !== 'early-return' &&
      selection !== 'collapsible-if' &&
      selection !== 'indirection' &&
      selection !== 'temporal-coupling' &&
      selection !== 'variable-lifetime' &&
      selection !== 'giant-file'
    ) {
      throw new Error(
        `[firebat] Invalid --only: ${selection}. Expected duplicates|waste|barrel|error-flow|format|lint|typecheck|dependencies|coupling|nesting|early-return|collapsible-if|indirection|temporal-coupling|variable-lifetime|giant-file`,
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
  minSize: boolean;
  maxForwardDepth: boolean;
  crossFileMinDepth: boolean;
  detectors: boolean;
  configPath: boolean;
  logLevel: boolean;
  logStack: boolean;
}

const parseArgs = (argv: readonly string[]): FirebatCliOptions => {
  const targets: string[] = [];
  let minSize: MinSizeOption = DEFAULT_MIN_SIZE;
  let maxForwardDepth = DEFAULT_MAX_FORWARD_DEPTH;
  let crossFileMinDepth = DEFAULT_CROSS_FILE_MIN_DEPTH;
  let detectors: ReadonlyArray<FirebatDetector> = DEFAULT_DETECTORS;
  let configPath: string | undefined;
  let logLevel: FirebatLogLevel | undefined;
  let logStack: boolean | undefined;

  const toExplicitFlags = (input: ExplicitMutable): FirebatCliExplicitFlags => {
    return {
      minSize: input.minSize,
      maxForwardDepth: input.maxForwardDepth,
      crossFileMinDepth: input.crossFileMinDepth,
      detectors: input.detectors,
      configPath: input.configPath,
      logLevel: input.logLevel,
      logStack: input.logStack,
    };
  };

  const explicit: ExplicitMutable = {
    minSize: false,
    maxForwardDepth: false,
    crossFileMinDepth: false,
    detectors: false,
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
        minSize,
        maxForwardDepth,
        crossFileMinDepth,
        detectors,
        help: true,
        ...(configPath !== undefined ? { configPath } : {}),
        ...(logLevel !== undefined ? { logLevel } : {}),
        explicit: toExplicitFlags(explicit),
      };
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
      maxForwardDepth = parseClampedIntArg(argv[i + 1], '--max-forward-depth', 0);
      explicit.maxForwardDepth = true;

      i += 1;

      continue;
    }

    if (arg === '--cross-file-min-depth') {
      crossFileMinDepth = parseClampedIntArg(argv[i + 1], '--cross-file-min-depth', 1);
      explicit.crossFileMinDepth = true;

      i += 1;

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
    minSize,
    maxForwardDepth,
    crossFileMinDepth,
    detectors,
    help: false,
    ...(configPath !== undefined ? { configPath } : {}),
    ...(logLevel !== undefined ? { logLevel } : {}),
    ...(logStack !== undefined ? { logStack } : {}),
    explicit: toExplicitFlags(explicit),
  };
};

export { parseArgs };
