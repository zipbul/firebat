import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

// InMemoryTransport is not in the SDK's main exports; use resolved path (see AGENTS.md / plan).
import { InMemoryTransport } from '../../../../node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import { createFirebatMcpServer } from '../../../../src/test-api';
import { closeAllSqliteConnections } from '../../../../src/test-api';
import { createNoopLogger } from '../../../../src/test-api';

type McpServerInstance = Awaited<ReturnType<typeof createFirebatMcpServer>>;

type ServerTransport = Parameters<McpServerInstance['connect']>[0];

type ClientTransport = Parameters<Client['connect']>[0];

export interface InMemoryMcpContext {
  readonly client: Client;
  readonly server: Awaited<ReturnType<typeof createFirebatMcpServer>>;
  readonly rootAbs: string;
  readonly tmpDir: string;
  readonly close: () => Promise<void>;
}

/**
 * Create an in-process MCP test context using InMemoryTransport.
 * No subprocess or stdio; server and client run in the same process.
 */
export const createInMemoryMcpContext = async (): Promise<InMemoryMcpContext> => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'firebat-inmemory-'));
  const firebatDir = path.join(tmpDir, '.firebat');

  await mkdir(firebatDir, { recursive: true });

  await Bun.write(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({ name: 'firebat-inmemory-test', private: true, devDependencies: { firebat: '0.0.0' } }, null, 2) + '\n',
  );

  const logger = createNoopLogger();
  const server = await createFirebatMcpServer({ rootAbs: tmpDir, config: null, logger });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair() as [ClientTransport, ServerTransport];

  await server.connect(serverTransport);

  const client = new Client({ name: 'firebat-inmemory-test-client', version: '0.0.0' });

  await client.connect(clientTransport);

  const close = async (): Promise<void> => {
    try {
      await client.close();
    } catch {
      /* best-effort */
    }

    try {
      await server.close();
    } catch {
      /* best-effort */
    }

    try {
      await closeAllSqliteConnections();
    } catch {
      /* best-effort */
    }

    await rm(tmpDir, { recursive: true, force: true });
  };

  return { client, server, rootAbs: tmpDir, tmpDir, close };
};
