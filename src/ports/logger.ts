import type { FirebatLogLevel } from '../firebat-config';

export type FirebatLogFields = Record<string, string | number | boolean | null | undefined>;

export interface FirebatLogger {
  readonly level: FirebatLogLevel;

  log(level: FirebatLogLevel, message: string, fields?: FirebatLogFields, error?: unknown): void;

  error(message: string, fields?: FirebatLogFields, error?: unknown): void;
  warn(message: string, fields?: FirebatLogFields, error?: unknown): void;
  info(message: string, fields?: FirebatLogFields, error?: unknown): void;
  debug(message: string, fields?: FirebatLogFields, error?: unknown): void;
  trace(message: string, fields?: FirebatLogFields, error?: unknown): void;
}

export const createNoopLogger = (level: FirebatLogLevel = 'error'): FirebatLogger => {
  const noop = () => undefined;

  return {
    level,
    log: noop,
    error: noop,
    warn: noop,
    info: noop,
    debug: noop,
    trace: noop,
  };
};
