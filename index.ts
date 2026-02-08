import { runCache } from './src/adapters/cli/cache';
import { runCli } from './src/adapters/cli/entry';
import { runInstall, runUpdate } from './src/adapters/cli/install';
import { runMcp } from './src/adapters/mcp/entry';
import { appendFirebatLog } from './src/infra/logging';
import { createPrettyConsoleLogger } from './src/infrastructure/logging/pretty-console-logger';
import { resolveFirebatRootFromCwd } from './src/root-resolver';

const main = async (): Promise<void> => {
  const argv = Bun.argv.slice(2);
  const subcommand = argv[0];
  const logger = createPrettyConsoleLogger({ level: 'info', includeStack: false });

  try {
    if (subcommand === 'install' || subcommand === 'i') {
      const exitCode = await runInstall(argv.slice(1), logger);

      process.exit(exitCode);
    }

    if (subcommand === 'update' || subcommand === 'u') {
      const exitCode = await runUpdate(argv.slice(1), logger);

      process.exit(exitCode);
    }

    if (subcommand === 'cache') {
      const exitCode = await runCache(argv.slice(1), logger);

      process.exit(exitCode);
    }

    if (subcommand === 'mcp') {
      await runMcp();

      return;
    }

    const scanArgv = subcommand === 'scan' ? argv.slice(1) : argv;
    const exitCode = await runCli(scanArgv);

    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);
    const relativeLogPath = subcommand === 'mcp' ? '.firebat/mcp-error.log' : '.firebat/cli-error.log';

    try {
      const { rootAbs } = await resolveFirebatRootFromCwd();

      await appendFirebatLog(rootAbs, relativeLogPath, message);
    } catch {
      // ignore
    }

    logger.error(message);

    process.exit(1);
  }
};

void main();
