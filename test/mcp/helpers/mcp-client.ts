import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Result parsing helpers
// ---------------------------------------------------------------------------

interface ToolResultContentItem {
  readonly text?: string;
}

interface ToolResultLike {
  readonly structuredContent?: unknown;
  readonly content?: ReadonlyArray<ToolResultContentItem>;
  readonly isError?: boolean;
}

const parseJsonText = (text: string | undefined): unknown => {
  if (text === undefined || text.length === 0) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
};

const getStructuredContent = (result: ToolResultLike): unknown => {
  if (result.structuredContent !== undefined) {
    return result.structuredContent;
  }

  const first = result.content?.[0];

  return parseJsonText(first?.text);
};

const getTextContent = (result: ToolResultLike): string => {
  const first = result.content?.[0];

  return first?.text ?? '';
};

// ---------------------------------------------------------------------------
// MCP test context
// ---------------------------------------------------------------------------

interface McpTestContext {
  readonly client: Client;
  readonly tmpRootAbs: string;
  readonly fixturesAbs: string;
  readonly close: () => Promise<void>;
}

const FIXTURES_SRC = path.resolve(import.meta.dir, '../fixtures');
const SERVER_ENTRY = path.resolve(import.meta.dir, '../../../index.ts');

interface CreateMcpTestContextOptions {
  readonly copyFixtures?: boolean;
  readonly extraFiles?: Record<string, string>;
}

/**
 * Create an isolated MCP test context with a temp directory and connected client.
 *
 * - `copyFixtures` copies `test/mcp/fixtures/` into `<tmpRoot>/fixtures/`
 * - `extraFiles` creates additional files inside `<tmpRoot>` (key = relative path, value = content)
 */
const createMcpTestContext = async (opts?: CreateMcpTestContextOptions): Promise<McpTestContext> => {
  const tmpRootAbs = await mkdtemp(path.join(os.tmpdir(), 'firebat-mcp-test-'));
  const firebatDir = path.join(tmpRootAbs, '.firebat');

  await mkdir(firebatDir, { recursive: true });

  // Minimal package.json so firebat recognizes the project root.
  await writeFile(
    path.join(tmpRootAbs, 'package.json'),
    JSON.stringify({ name: 'firebat-mcp-test-fixture', private: true, devDependencies: { firebat: '0.0.0' } }, null, 2) + '\n',
    'utf8',
  );

  const fixturesAbs = path.join(tmpRootAbs, 'fixtures');

  if (opts?.copyFixtures) {
    await cp(FIXTURES_SRC, fixturesAbs, { recursive: true });
  } else {
    await mkdir(fixturesAbs, { recursive: true });
  }

  if (opts?.extraFiles) {
    for (const [relPath, content] of Object.entries(opts.extraFiles)) {
      const abs = path.join(tmpRootAbs, relPath);

      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content, 'utf8');
    }
  }

  const client = new Client({ name: 'firebat-mcp-aggressive-test', version: '0.0.0' });
  const transport = new StdioClientTransport({
    command: 'bun',
    args: [SERVER_ENTRY, 'mcp'],
    cwd: tmpRootAbs,
  });

  await client.connect(transport);

  const close = async (): Promise<void> => {
    try {
      await client.close();
    } catch {
      /* best-effort */
    }

    await rm(tmpRootAbs, { recursive: true, force: true });
  };

  return { client, tmpRootAbs, fixturesAbs, close };
};

// ---------------------------------------------------------------------------
// Convenience: call a tool and return structured content
// ---------------------------------------------------------------------------

interface CallToolResult {
  readonly structured: unknown;
  readonly raw: ToolResultLike;
  readonly isError: boolean;
}

const callTool = async (client: Client, name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> => {
  const raw = (await client.callTool({ name, arguments: args })) as ToolResultLike;

  return { structured: getStructuredContent(raw), raw, isError: raw.isError === true };
};

/**
 * Like callTool but never throws – captures transport/protocol errors as `isError: true`.
 */
const callToolSafe = async (client: Client, name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> => {
  try {
    return await callTool(client, name, args);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    return {
      structured: { error: msg },
      raw: { content: [{ text: msg }], isError: true },
      isError: true,
    };
  }
};

export type { CallToolResult, CreateMcpTestContextOptions, McpTestContext, ToolResultContentItem, ToolResultLike };
export { callTool, callToolSafe, createMcpTestContext, getStructuredContent, getTextContent, parseJsonText };
