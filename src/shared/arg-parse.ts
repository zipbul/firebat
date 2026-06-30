import * as path from 'node:path';

import type { FirebatCliExplicitFlags, FirebatCliOptions } from '../interfaces';
import type { FirebatDetector, MinSizeOption } from '../types';
import type { FirebatLogLevel } from './firebat-config';

import { DETECTOR_ALIASES } from '../types';
import { addAndPush } from './multi-map';
import { resolveStartDir } from './runtime-context';
import { splitTrimNonEmpty } from './split-lines';

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

/**
 * 플래그 인자값이 반드시 존재(문자열)해야 함을 강제한다. 없으면 "Missing value" throw.
 * 모든 값-요구 플래그 파싱이 공유하는 "인자값 필수" 단일 결정.
 */
const requireArgValue = (value: string | undefined, flag: string): string => {
  if (typeof value !== 'string') {
    throw new Error(`[firebat] Missing value for ${flag}`);
  }

  return value;
};

const parseClampedIntArg = (value: string | undefined, flag: string, floor: number): number =>
  Math.max(floor, Math.round(parseNumber(requireArgValue(value, flag), flag)));

const parseMinSize = (value: string): MinSizeOption => {
  if (value === 'auto') {
    return 'auto';
  }

  return parseNumber(value, '--min-size');
};

const parseDetectors = (value: string): ReadonlyArray<FirebatDetector> => {
  const selections = splitTrimNonEmpty(value, ',');

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

    addAndPush(seen, detectors, selection);
  }

  if (detectors.length === 0) {
    throw new Error('[firebat] Missing value for --only');
  }

  return detectors;
};

const assertKnownOption = (arg: string): void => {
  if (arg.startsWith('-')) {
    throw new Error(`[firebat] Unknown option: ${arg}`);
  }
};

// Keep the raw (trimmed) target; absolutization is deferred until after the full
// arg pass so relative targets resolve against the start dir (--cwd/-C → env →
// process.cwd()) — `--cwd` may appear after the target in argv.
const normalizeTarget = (raw: string): string => {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    throw new Error('[firebat] Empty target path');
  }

  return trimmed;
};

/** Absolutize a raw target against `startDir` (absolute targets pass through). */
const resolveTargetAbs = (raw: string, startDir: string): string => (path.isAbsolute(raw) ? raw : path.resolve(startDir, raw));

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
  let cwd: string | undefined;
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
      const value = requireArgValue(argv[i + 1], '--min-size');

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
      const value = requireArgValue(argv[i + 1], '--only');

      detectors = parseDetectors(value);
      explicit.detectors = true;

      i += 1;

      continue;
    }

    if (arg === '--config') {
      const value = requireArgValue(argv[i + 1], '--config');

      configPath = path.resolve(value);
      explicit.configPath = true;

      i += 1;

      continue;
    }

    if (arg === '--cwd' || arg === '-C') {
      cwd = path.resolve(requireArgValue(argv[i + 1], arg));

      i += 1;

      continue;
    }

    if (arg === '--log-level') {
      const value = requireArgValue(argv[i + 1], '--log-level');

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

    assertKnownOption(arg);

    targets.push(normalizeTarget(arg));
  }

  const startDir = resolveStartDir(cwd);

  return {
    targets: targets.map(t => resolveTargetAbs(t, startDir)),
    minSize,
    maxForwardDepth,
    crossFileMinDepth,
    detectors,
    help: false,
    ...(configPath !== undefined ? { configPath } : {}),
    ...(cwd !== undefined ? { cwd } : {}),
    ...(logLevel !== undefined ? { logLevel } : {}),
    ...(logStack !== undefined ? { logStack } : {}),
    explicit: toExplicitFlags(explicit),
  };
};

export { assertKnownOption, parseArgs };
