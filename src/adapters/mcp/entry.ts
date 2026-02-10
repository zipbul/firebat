import { appendFirebatLog } from '../../infra/logging';
import { resolveFirebatRootFromCwd } from '../../root-resolver';
import { runMcpServer } from './server';

const appendMcpErrorLog = async (message: string): Promise<void> => {
  if (message.trim().length === 0) {
    return;
  }

  try {
    const { rootAbs } = await resolveFirebatRootFromCwd();

    await appendFirebatLog(rootAbs, '.firebat/mcp-error.log', message);
  } catch (err) {
    process.stderr.write(`[firebat] Failed to append MCP error log: ${String(err)}\n`);
  }
};

const installMcpErrorHandlers = (): void => {
  process.on('uncaughtException', err => {
    const msg = `[firebat] uncaughtException: ${err.name}: ${err.message}\n${err.stack ?? ''}`;

    process.stderr.write(msg + '\n');
    void appendMcpErrorLog(`uncaughtException\n${err.name}: ${err.message}\n${err.stack ?? ''}`);
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
    void appendMcpErrorLog(`unhandledRejection\n${message}`);
  });
};

const runMcp = async (): Promise<void> => {
  installMcpErrorHandlers();
  await runMcpServer();
};

export { runMcp };
