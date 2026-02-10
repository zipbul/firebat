import type { FirebatLogLevel } from '../../firebat-config';
import type { FirebatLogFields, FirebatLogger } from '../../ports/logger';

interface PrettyConsoleLoggerOptions {
  readonly level: FirebatLogLevel;
  readonly includeStack?: boolean;
  readonly useColor?: boolean;
}

const LEVEL_RANK: Record<FirebatLogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

const isTty = (): boolean => {
  return Boolean(process.stderr?.isTTY);
};

interface LevelStyle {
  readonly emoji: string;
  readonly color: string;
}

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
} as const;

const c = (text: string, color: string, enabled: boolean): string => {
  if (!enabled) {
    return text;
  }

  return `${color}${text}${ANSI.reset}`;
};

const levelStyle = (level: FirebatLogLevel): LevelStyle => {
  switch (level) {
    case 'error':
      return { emoji: '✖', color: ANSI.red };
    case 'warn':
      return { emoji: '▲', color: ANSI.yellow };
    case 'info':
      return { emoji: '●', color: ANSI.cyan };
    case 'debug':
      return { emoji: '◆', color: ANSI.magenta };
    case 'trace':
      return { emoji: '·', color: ANSI.gray };
    default:
      return { emoji: '·', color: ANSI.gray };
  }
};

const formatDuration = (ms: number | undefined): string => {
  if (ms === undefined) {
    return '';
  }

  if (ms < 1000) {
    return `${ms}ms`;
  }

  return `${(ms / 1000).toFixed(2)}s`;
};

const formatFields = (fields: FirebatLogFields | undefined, useColor: boolean): string => {
  if (!fields) {
    return '';
  }

  const parts: string[] = [];

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      continue;
    }

    if (key === 'durationMs') {
      parts.push(c(formatDuration(value as number), ANSI.dim, useColor));
    } else {
      parts.push(c(`${key}=${String(value)}`, ANSI.dim, useColor));
    }
  }

  if (parts.length === 0) {
    return '';
  }

  return ` ${parts.join(' ')}`;
};

export const createPrettyConsoleLogger = (options: PrettyConsoleLoggerOptions): FirebatLogger => {
  const useColor = options.useColor ?? isTty();
  const threshold = options.level;
  const includeStack = options.includeStack ?? false;

  const isEnabled = (level: FirebatLogLevel): boolean => {
    return LEVEL_RANK[level] <= LEVEL_RANK[threshold];
  };

  const emit = (level: FirebatLogLevel, message: string, fields?: FirebatLogFields, error?: unknown): void => {
    if (!isEnabled(level)) {
      return;
    }

    const style = levelStyle(level);
    const dot = c(style.emoji, style.color, useColor);
    const msg = level === 'error' || level === 'warn' ? c(message, style.color, useColor) : message;
    let line = `  ${dot}  ${msg}${formatFields(fields, useColor)}`;

    if (includeStack && error instanceof Error && error.stack) {
      line += `\n${c(error.stack, ANSI.dim, useColor)}`;
    }

    console.error(line);
  };

  return {
    level: threshold,

    log: emit,

    error: (message, fields, error) => emit('error', message, fields, error),
    warn: (message, fields, error) => emit('warn', message, fields, error),
    info: (message, fields, error) => emit('info', message, fields, error),
    debug: (message, fields, error) => emit('debug', message, fields, error),
    trace: (message, fields, error) => emit('trace', message, fields, error),
  };
};
