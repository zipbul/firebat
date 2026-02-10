import { runCache } from './src/adapters/cli/cache';
import { runCli } from './src/adapters/cli/entry';
import { runInstall, runUpdate } from './src/adapters/cli/install';
import { runMcp } from './src/adapters/mcp/entry';
import { appendFirebatLog } from './src/infra/logging';
import { createPrettyConsoleLogger } from './src/infrastructure/logging/pretty-console-logger';
import { resolveFirebatRootFromCwd } from './src/root-resolver';

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

const runSubcommand = async (
  subcommand: string | undefined,
  argv: string[],
  logger: ReturnType<typeof createPrettyConsoleLogger>,
): Promise<number | null> => {
  if (subcommand === 'install' || subcommand === 'i') {
    return runInstall(argv.slice(1), logger);
  }

  if (subcommand === 'update' || subcommand === 'u') {
    return runUpdate(argv.slice(1), logger);
  }

  if (subcommand === 'cache') {
    return runCache(argv.slice(1), logger);
  }

  if (subcommand === 'mcp') {
    await runMcp();

    return null;
  }

  const scanArgv = subcommand === 'scan' ? argv.slice(1) : argv;

  return runCli(scanArgv);
};

const main = async (): Promise<void> => {
  const argv = Bun.argv.slice(2);
  const subcommand = argv[0];
  const logger = createPrettyConsoleLogger({ level: 'info', includeStack: false });

  try {
    const exitCode = await runSubcommand(subcommand, argv, logger);

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
