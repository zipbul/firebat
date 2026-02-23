import { routeFirebatArgv } from './src/adapters/cli/argv-router';
import { runCache } from './src/adapters/cli/cache';
import { runCli } from './src/adapters/cli/entry';
import { runInstall, runUpdate } from './src/adapters/cli/install';
import { runMcp } from './src/adapters/mcp/entry';
import { appendFirebatLog } from './src/infra/logging';
import { createPrettyConsoleLogger } from './src/infrastructure/logging/pretty-console-logger';
import { resolveFirebatRootFromCwd } from './src/shared/root-resolver';

const appendErrorLogSafe = async (subcommand: string | undefined, message: string): Promise<void> => {
  const relativeLogPath = subcommand === 'mcp' ? '.firebat/mcp-error.log' : '.firebat/cli-error.log';
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

const main = async (): Promise<void> => {
  const rawArgv = Bun.argv.slice(2);
  const routed = routeFirebatArgv(rawArgv);
  const logLevel = resolveLogLevel(routed.global.logLevel);

  if (routed.global.logLevel !== undefined && logLevel === null) {
    process.stderr.write(`[firebat] Invalid --log-level: ${routed.global.logLevel}\n`);
    process.exit(1);
  }

  const logger = createPrettyConsoleLogger({ level: logLevel ?? 'info', includeStack: routed.global.logStack });
  const subcommand = routed.subcommand;

  try {
    const exitCode =
      subcommand === 'install'
        ? await runInstall(routed.subcommandArgv, logger)
        : subcommand === 'update'
          ? await runUpdate(routed.subcommandArgv, logger)
          : subcommand === 'cache'
            ? await runCache(routed.subcommandArgv, logger)
            : subcommand === 'mcp'
              ? (await runMcp(), null)
              : await runCli(routed.scanArgv);

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

void main();
