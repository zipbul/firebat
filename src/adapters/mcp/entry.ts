import { runMcpServer } from './server';
import { appendFirebatLog } from '../../infra/logging';
import { resolveFirebatRootFromCwd } from '../../root-resolver';

const installMcpErrorHandlers = (): void => {
  const append = async (message: string): Promise<void> => {
    try {
      const { rootAbs } = await resolveFirebatRootFromCwd();

      await appendFirebatLog(rootAbs, '.firebat/mcp-error.log', message);
    } catch {
      // ignore
    }
  };

  process.on('uncaughtException', err => {
    const msg = `[firebat] uncaughtException: ${err.name}: ${err.message}\n${err.stack ?? ''}`;
    process.stderr.write(msg + '\n');
    void append(`uncaughtException\n${err.name}: ${err.message}\n${err.stack ?? ''}`);
  });

  process.on('unhandledRejection', reason => {
    const message =
      reason instanceof Error
        ? `${reason.name}: ${reason.message}\n${reason.stack ?? ''}`
        : typeof reason === 'string' || typeof reason === 'number' || typeof reason === 'boolean'
          ? String(reason)
          : reason === null || reason === undefined
            ? String(reason)
            : '[firebat] non-Error rejection reason';

    process.stderr.write(`[firebat] unhandledRejection: ${message}\n`);
    void append(`unhandledRejection\n${message}`);
  });
};

const runMcp = async (): Promise<void> => {
  installMcpErrorHandlers();
  await runMcpServer();
};

export { runMcp };
