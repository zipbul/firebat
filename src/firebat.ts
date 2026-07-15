import { runCli } from './adapters/cli';

const runFirebat = async (): Promise<void> => {
  const exitCode = await runCli(Bun.argv.slice(2));

  process.exit(exitCode);
};

export { runFirebat };
