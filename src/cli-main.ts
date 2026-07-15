import { routeFirebatArgv, runCache, runCli, runInstall, runUpdate } from './adapters/cli';
import { appendFirebatLog, createPrettyConsoleLogger, resolveFirebatRootFromCwd } from './shared';

const appendErrorLogSafe = async (_subcommand: string | undefined, message: string): Promise<void> => {
  const relativeLogPath = '.firebat/cli-error.log';
  const rootAbs = await resolveFirebatRootFromCwd()
    .then(result => result.rootAbs)
    .catch(err => {
      process.stderr.write(`[firebat] Failed to resolve root for error log: ${String(err)}\n`);

      return null;
    });

  if (!rootAbs) {
    return;
  }

  await appendFirebatLog(rootAbs, relativeLogPath, message).catch(err => {
    process.stderr.write(`[firebat] Failed to append error log: ${String(err)}\n`);
  });
};

const resolveLogLevel = (value: string | undefined): 'error' | 'warn' | 'info' | 'debug' | 'trace' | null => {
  if (value === undefined) {
    return null;
  }

  if (value === 'error' || value === 'warn' || value === 'info' || value === 'debug' || value === 'trace') {
    return value;
  }

  return null;
};

export const main = async (): Promise<void> => {
  const rawArgv = Bun.argv.slice(2);
  const routed = routeFirebatArgv(rawArgv);
  const logLevel = resolveLogLevel(routed.global.logLevel);

  if (routed.global.logLevel !== undefined && logLevel === null) {
    process.stderr.write(`[firebat] Invalid --log-level: ${routed.global.logLevel}\n`);
    process.exit(1);
  }

  const logger = createPrettyConsoleLogger({ level: logLevel ?? 'info', includeStack: routed.global.logStack });
  const subcommand = routed.subcommand;
  const subcommandHandlers: Record<string, () => Promise<number | null>> = {
    install: () => runInstall(routed.subcommandArgv, logger),
    update: () => runUpdate(routed.subcommandArgv, logger),
    cache: () => runCache(routed.subcommandArgv, logger),
  };

  try {
    const handler = subcommandHandlers[subcommand ?? ''] ?? (() => runCli(routed.scanArgv));
    const exitCode = await handler();

    if (exitCode !== null) {
      process.exit(exitCode);
    }
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);

    await appendErrorLogSafe(subcommand, message);

    logger.error(message);

    process.exit(1);
  }
};
