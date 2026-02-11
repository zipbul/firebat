import * as path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import type { FirebatLogger } from '../../ports/logger';

import { tryResolveBunxCommand, tryResolveLocalBin } from '../tooling/resolve-bin';

interface TsgoTraceRequest {
  readonly entryFile: string;
  readonly symbol: string;
  readonly tsconfigPath?: string;
  readonly maxDepth?: number;
}

interface TsgoTraceResult {
  readonly ok: boolean;
  readonly tool: 'tsgo';
  readonly error?: string;
  readonly structured?: unknown;
}

interface SourcePosition {
  readonly line: number;
  readonly column: number;
}

interface SourceSpan {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

interface TraceNode {
  readonly id: string;
  readonly kind: 'file' | 'symbol' | 'type' | 'reference' | 'unknown';
  readonly label: string;
  readonly filePath?: string;
  readonly span?: SourceSpan;
}

interface TraceEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: 'references' | 'imports' | 'exports' | 'calls' | 'type-of' | 'unknown';
  readonly label?: string;
}

interface TraceGraph {
  readonly nodes: ReadonlyArray<TraceNode>;
  readonly edges: ReadonlyArray<TraceEdge>;
}

interface TraceEvidenceSpan {
  readonly filePath: string;
  readonly span: SourceSpan;
  readonly text?: string;
}

interface LspPosition {
  readonly line: number;
  readonly character: number;
}

interface LspRange {
  readonly start: LspPosition;
  readonly end: LspPosition;
}

interface LspLocation {
  readonly uri: string;
  readonly range: LspRange;
}

interface LspLocationLink {
  readonly targetUri: string;
  readonly targetRange: LspRange;
  readonly targetSelectionRange?: LspRange;
  readonly originSelectionRange?: LspRange;
}

interface LspRequestPayload {
  readonly id: string | number;
  readonly method: string;
  readonly params: unknown;
}

interface LspPendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
}

interface LspConfigurationItemsParams {
  readonly items?: unknown;
}

interface LspInboundRequestJson {
  readonly id?: unknown;
  readonly method?: unknown;
  readonly params?: unknown;
}

interface LspInboundNotificationJson {
  readonly method?: unknown;
  readonly params?: unknown;
}

interface SymbolPositionCandidate {
  readonly score: number;
  readonly line: number;
  readonly character: number;
}

interface ResolvedTsgoCommand {
  readonly command: string;
  readonly args: string[];
  readonly note?: string;
}

interface WithTsgoSessionOk<T> {
  readonly ok: true;
  readonly value: T;
  readonly note?: string;
}

interface WithTsgoSessionFail {
  readonly ok: false;
  readonly error: string;
}

type WithTsgoSessionResult<T> = WithTsgoSessionOk<T> | WithTsgoSessionFail;

interface OpenTsDocumentResult {
  readonly uri: string;
  readonly text: string;
}

interface StdinWriter {
  write: (chunk: Uint8Array) => unknown;
  flush?: () => unknown;
  end?: () => unknown;
}

interface LspErrorPayload {
  readonly message?: string;
}

interface LspInboundMessage {
  readonly id?: unknown;
  readonly error?: LspErrorPayload;
  readonly result?: unknown;
}

interface LspConnectionStartOptions {
  readonly cwd: string;
  readonly command: string;
  readonly args: string[];
}

interface LspSessionInput {
  readonly root: string;
  readonly tsconfigPath?: string;
  readonly logger: FirebatLogger;
}

interface OpenTsDocumentInput {
  readonly lsp: LspConnection;
  readonly filePath: string;
  readonly languageId?: string;
  readonly version?: number;
  readonly text?: string;
}

interface TsgoLspSession {
  readonly lsp: LspConnection;
  readonly cwd: string;
  readonly rootUri: string;
  readonly initializeResult: unknown;
  readonly note?: string;
}

interface SharedTsgoSessionEntry {
  readonly key: string;
  readonly session: TsgoLspSession;
  readonly lsp: LspConnection;
  refCount: number;
  queue: Promise<unknown>;
  idleTimer: Timer | null;
  note?: string;
}

const sharedTsgoSessions = new Map<string, SharedTsgoSessionEntry>();
const DEFAULT_SHARED_IDLE_MS = 5_000;

interface SharedKeyInput {
  readonly cwd: string;
  readonly command: string;
  readonly args: string[];
}

const makeSharedKey = (input: SharedKeyInput): string => {
  return `${input.command}\n${input.args.join('\u0000')}\n${input.cwd}`;
};

const closeSharedEntry = async (entry: SharedTsgoSessionEntry): Promise<void> => {
  try {
    await entry.lsp.close();
  } catch {
    // ignore
  }
};

const scheduleSharedIdleClose = (entry: SharedTsgoSessionEntry): void => {
  if (entry.idleTimer) {
    try {
      clearTimeout(entry.idleTimer);
    } catch {
      // ignore
    }
  }

  entry.idleTimer = setTimeout(() => {
    const current = sharedTsgoSessions.get(entry.key);

    if (!current) {
      return;
    }

    if (current.refCount > 0) {
      return;
    }

    sharedTsgoSessions.delete(entry.key);
    void closeSharedEntry(current);
  }, DEFAULT_SHARED_IDLE_MS);
};

interface SharedTsgoSessionInput {
  readonly root: string;
  readonly tsconfigPath?: string;
}

interface SharedTsgoSessionOk {
  readonly ok: true;
  readonly entry: SharedTsgoSessionEntry;
}

interface SharedTsgoSessionFail {
  readonly ok: false;
  readonly error: string;
}

type SharedTsgoSessionResult = SharedTsgoSessionOk | SharedTsgoSessionFail;

const acquireSharedTsgoSession = async (input: SharedTsgoSessionInput): Promise<SharedTsgoSessionResult> => {
  const cwd = input.tsconfigPath
    ? path.dirname(path.resolve(process.cwd(), input.tsconfigPath))
    : path.isAbsolute(input.root)
      ? input.root
      : path.resolve(process.cwd(), input.root);
  const resolved = await tryResolveTsgoCommand(cwd);

  if (!resolved) {
    return {
      ok: false,
      error:
        'tsgo is not available. Install @typescript/native-preview (devDependency) or ensure `tsgo` is on PATH (or `bunx` is available).',
    };
  }

  const key = makeSharedKey({ cwd, command: resolved.command, args: resolved.args });
  const existing = sharedTsgoSessions.get(key);

  if (existing) {
    existing.refCount += 1;

    if (existing.idleTimer) {
      try {
        clearTimeout(existing.idleTimer);
      } catch {
        // ignore
      }

      existing.idleTimer = null;
    }

    return { ok: true, entry: existing };
  }

  const lsp = await LspConnection.start({ cwd, command: resolved.command, args: resolved.args });

  try {
    const rootUri = pathToFileURL(cwd).toString();
    const initializeResult = await lsp.request('initialize', {
      processId: null,
      rootUri,
      capabilities: {},
      workspaceFolders: [{ uri: rootUri, name: path.basename(cwd) }],
    });

    await lsp.notify('initialized', {});

    const session: TsgoLspSession = {
      lsp,
      cwd,
      rootUri,
      initializeResult,
      ...(resolved.note !== undefined ? { note: resolved.note } : {}),
    };
    const entry: SharedTsgoSessionEntry = {
      key,
      session,
      lsp,
      refCount: 1,
      queue: Promise.resolve(undefined),
      idleTimer: null,
      ...(resolved.note !== undefined ? { note: resolved.note } : {}),
    };

    sharedTsgoSessions.set(key, entry);

    return { ok: true, entry };
  } catch (error) {
    try {
      await lsp.close();
    } catch {
      // ignore
    }

    const message = error instanceof Error ? error.message : String(error);

    return { ok: false, error: message };
  }
};

const releaseSharedTsgoSession = (entry: SharedTsgoSessionEntry): void => {
  entry.refCount = Math.max(0, entry.refCount - 1);

  if (entry.refCount === 0) {
    scheduleSharedIdleClose(entry);
  }
};

const runInSharedTsgoSession = async <T>(
  entry: SharedTsgoSessionEntry,
  fn: (session: TsgoLspSession) => Promise<T>,
): Promise<T> => {
  // Serialize operations to avoid didOpen/didClose interleaving across callers.
  const task = entry.queue.then(() => fn(entry.session));

  entry.queue = task.then(
    () => undefined,
    () => undefined,
  );

  try {
    return await task;
  } finally {
    releaseSharedTsgoSession(entry);
  }
};

const fileUrlToPathSafe = (uri: string): string => {
  try {
    return fileURLToPath(uri);
  } catch {
    return uri.replace(/^file:\/\//, '');
  }
};

const readFileText = async (filePath: string): Promise<string> => {
  try {
    return await Bun.file(filePath).text();
  } catch {
    return '';
  }
};

const splitLines = (text: string): string[] => text.split(/\r?\n/);

const findSymbolPositionInText = (text: string, symbol: string): LspPosition | null => {
  const lines = splitLines(text);
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const candidates: Array<SymbolPositionCandidate> = [];
  // Prefer likely declarations.
  const declPatterns = [
    new RegExp(`\\b(class|interface|type|enum|function)\\s+${escaped}\\b`),
    new RegExp(`\\b(const|let|var)\\s+${escaped}\\b`),
    new RegExp(`\\bexport\\s+(class|interface|type|enum|function)\\s+${escaped}\\b`),
  ];

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i] ?? '';
    // Skip comments quickly (best-effort).
    const trimmed = lineText.trimStart();

    if (trimmed.startsWith('//')) {
      continue;
    }

    for (let p = 0; p < declPatterns.length; p++) {
      const pattern = declPatterns[p];

      if (!pattern) {
        continue;
      }

      const m = pattern.exec(lineText);

      if (m && m.index >= 0) {
        const idx = lineText.indexOf(symbol, m.index);

        if (idx >= 0) {
          candidates.push({ score: 100 - p * 10, line: i, character: idx });
        }
      }
    }

    // Fallback: first identifier-like occurrence.
    const any = new RegExp(`\\b${escaped}\\b`).exec(lineText);

    if (any && any.index >= 0) {
      candidates.push({ score: 10, line: i, character: any.index });
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => b.score - a.score || a.line - b.line || a.character - b.character);

  const best = candidates[0];

  if (!best) {
    return null;
  }

  return { line: best.line, character: best.character };
};

const toSpanFromRange = (range: LspRange): SourceSpan => {
  return {
    start: { line: range.start.line + 1, column: range.start.character + 1 },
    end: { line: range.end.line + 1, column: range.end.character + 1 },
  };
};

const extractEvidenceText = async (filePath: string, span: SourceSpan): Promise<string | undefined> => {
  const text = await readFileText(filePath);

  if (text.length === 0) {
    return undefined;
  }

  const lines = splitLines(text);
  const lineIdx = Math.max(0, Math.min(lines.length - 1, span.start.line - 1));
  const lineText = lines[lineIdx] ?? '';

  return lineText.trim().slice(0, 300);
};

const buildLspMessage = (payload: unknown): Uint8Array => {
  const json = JSON.stringify(payload);
  const header = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n`;

  return new TextEncoder().encode(header + json);
};

class LspConnection {
  private readonly proc: ReturnType<typeof Bun.spawn>;
  private readonly stdin: StdinWriter;
  private nextId = 1;
  private readonly pending = new Map<number, LspPendingRequest>();
  private readonly notificationHandlers = new Map<string, Set<(params: unknown) => void>>();
  private readonly anyNotificationHandlers = new Set<(method: string, params: unknown) => void>();
  private readonly readerLoop: Promise<void>;

  private constructor(proc: ReturnType<typeof Bun.spawn>) {
    this.proc = proc;

    if (!proc.stdin || typeof proc.stdin === 'number') {
      throw new Error('tsgo stdin is not available');
    }

    const stdin: unknown = proc.stdin;

    // Bun.spawn({ stdin: 'pipe' }) returns a FileSink (write/flush/end), not a Web WritableStream.
    if (!stdin || typeof stdin !== 'object' || !('write' in stdin) || typeof stdin.write !== 'function') {
      throw new Error('tsgo stdin does not support write()');
    }

    this.stdin = stdin as StdinWriter;
    this.readerLoop = this.startReadLoop();
  }

  static async start(opts: LspConnectionStartOptions): Promise<LspConnection> {
    const proc = Bun.spawn({
      cmd: [opts.command, ...opts.args],
      cwd: opts.cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'pipe',
    });

    return new LspConnection(proc);
  }

  async request<T = unknown>(method: string, params?: unknown, timeoutMs = 30_000): Promise<T> {
    const id = this.nextId++;
    const payload = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    };
    const p = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });

      if (timeoutMs > 0) {
        const timer = setTimeout(() => {
          const entry = this.pending.get(id);

          if (entry) {
            this.pending.delete(id);
            entry.reject(new Error(`LSP request timed out after ${timeoutMs}ms: ${method}`));
          }
        }, timeoutMs);
        // Ensure the timer doesn't prevent process exit and gets cleaned up on resolve/reject.
        const origResolve = resolve as (v: unknown) => void;
        const origReject = reject;

        const wrappedResolve = (v: unknown): void => {
          clearTimeout(timer);
          origResolve(v);
        };

        const wrappedReject = (e: Error): void => {
          clearTimeout(timer);
          origReject(e);
        };

        this.pending.set(id, { resolve: wrappedResolve, reject: wrappedReject });
      }
    });

    this.writeToStdin(buildLspMessage(payload));

    return p;
  }

  async notify(method: string, params?: unknown): Promise<void> {
    const payload = {
      jsonrpc: '2.0',
      method,
      ...(params !== undefined ? { params } : {}),
    };

    this.writeToStdin(buildLspMessage(payload));
  }

  onNotification(method: string, handler: (params: unknown) => void): () => void {
    const normalized = method.trim();

    if (normalized.length === 0) {
      return () => undefined;
    }

    const existing = this.notificationHandlers.get(normalized);
    const set = existing ?? new Set<(params: unknown) => void>();

    set.add(handler);

    if (!existing) {
      this.notificationHandlers.set(normalized, set);
    }

    return () => {
      const current = this.notificationHandlers.get(normalized);

      if (!current) {
        return;
      }

      current.delete(handler);

      if (current.size === 0) {
        this.notificationHandlers.delete(normalized);
      }
    };
  }

  onAnyNotification(handler: (method: string, params: unknown) => void): () => void {
    this.anyNotificationHandlers.add(handler);

    return () => {
      this.anyNotificationHandlers.delete(handler);
    };
  }

  async close(): Promise<void> {
    try {
      await this.request('shutdown');
      await this.notify('exit');
    } catch {
      // ignore
    }

    try {
      this.notificationHandlers.clear();
      this.anyNotificationHandlers.clear();
    } catch {
      // ignore
    }

    try {
      if (typeof this.stdin.end === 'function') {
        this.stdin.end();
      }
    } catch {
      // ignore
    }

    try {
      this.proc.kill();
    } catch {
      // ignore
    }

    try {
      await this.readerLoop;
    } catch {
      // ignore
    }
  }

  async waitForExit(): Promise<number> {
    return this.proc.exited;
  }

  async readStderr(): Promise<string> {
    if (!this.proc.stderr || typeof this.proc.stderr === 'number') {
      return '';
    }

    return new Response(this.proc.stderr).text();
  }

  private writeToStdin(payload: Uint8Array): void {
    try {
      this.stdin.write(payload);

      if (typeof this.stdin.flush === 'function') {
        this.stdin.flush();
      }
    } catch {
      // ignore write failures; the request will eventually fail when the connection closes
    }
  }

  private respondToServerRequest(input: LspRequestPayload): void {
    const { id, method, params } = input;

    const ok = (result: unknown): void => {
      this.writeToStdin(
        buildLspMessage({
          jsonrpc: '2.0',
          id,
          result,
        }),
      );
    };

    const err = (code: number, message: string): void => {
      this.writeToStdin(
        buildLspMessage({
          jsonrpc: '2.0',
          id,
          error: { code, message },
        }),
      );
    };

    try {
      // tsgo uses client/registerCapability early and will block if we don't respond.
      if (method === 'client/registerCapability' || method === 'client/unregisterCapability') {
        ok(null);

        return;
      }

      // Some servers request configuration values after initialization.
      if (method === 'workspace/configuration') {
        const paramsRecord = params && typeof params === 'object' ? (params as LspConfigurationItemsParams) : undefined;
        const items = Array.isArray(paramsRecord?.items) ? paramsRecord.items : [];

        ok(items.map(() => null));

        return;
      }

      if (method === 'workspace/workspaceFolders') {
        ok(null);

        return;
      }

      if (method === 'window/workDoneProgress/create') {
        ok(null);

        return;
      }

      if (method === 'window/showMessageRequest') {
        ok(null);

        return;
      }

      // Best-effort fallback: for common LSP "client-side" request namespaces, respond with null.
      if (method.startsWith('client/') || method.startsWith('workspace/') || method.startsWith('window/')) {
        ok(null);

        return;
      }

      err(-32601, `Method not found: ${method}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);

      err(-32603, message.length > 0 ? message : 'Internal error');
    }
  }

  private async startReadLoop(): Promise<void> {
    if (!this.proc.stdout || typeof this.proc.stdout === 'number') {
      throw new Error('tsgo stdout is not available');
    }

    const stream = this.proc.stdout as ReadableStream<Uint8Array>;
    const reader = stream.getReader();
    let buffer = Buffer.alloc(0);

    const readMore = async (): Promise<boolean> => {
      const { value, done } = await reader.read();

      if (done) {
        return false;
      }

      buffer = Buffer.concat([buffer, Buffer.from(value)]);

      return true;
    };

    const parseOne = (): unknown | null => {
      const headerEnd = buffer.indexOf('\r\n\r\n');

      if (headerEnd === -1) {
        return null;
      }

      const header = buffer.subarray(0, headerEnd).toString('utf8');
      const m = /Content-Length:\s*(\d+)/i.exec(header);

      if (!m) {
        // Can't parse header; drop until after headerEnd.
        buffer = Buffer.from(buffer.subarray(headerEnd + 4));

        return null;
      }

      const len = Number(m[1]);
      const bodyStart = headerEnd + 4;

      if (buffer.length < bodyStart + len) {
        return null;
      }

      const body = buffer.subarray(bodyStart, bodyStart + len).toString('utf8');

      buffer = Buffer.from(buffer.subarray(bodyStart + len));

      try {
        return JSON.parse(body);
      } catch {
        return null;
      }
    };

    while (true) {
      let msg = parseOne();

      while (msg) {
        if (msg && typeof msg === 'object' && 'id' in msg && 'method' in msg) {
          const json = msg as LspInboundRequestJson;
          const id = json.id;
          const method = typeof json.method === 'string' ? json.method : '';
          const params = json.params;

          if ((typeof id === 'string' || typeof id === 'number') && method.length > 0) {
            this.respondToServerRequest({ id, method, params });
          }
        } else if (msg && typeof msg === 'object' && 'id' in msg) {
          const json = msg as LspInboundMessage;
          const id = Number(json.id);
          const pending = this.pending.get(id);

          if (pending) {
            this.pending.delete(id);

            if (json.error) {
              const err = json.error;

              pending.reject(new Error(typeof err?.message === 'string' ? err.message : 'LSP error'));
            } else {
              pending.resolve(json.result);
            }
          }
        }

        // Notifications (JSON-RPC: method without id)
        if (msg && typeof msg === 'object' && 'method' in msg && !('id' in msg)) {
          const json = msg as LspInboundNotificationJson;
          const method = typeof json.method === 'string' ? json.method : '';
          const params = json.params;

          if (method.length > 0) {
            for (const handler of this.anyNotificationHandlers) {
              try {
                handler(method, params);
              } catch {
                // ignore
              }
            }

            const handlers = this.notificationHandlers.get(method);

            if (handlers) {
              for (const handler of handlers) {
                try {
                  handler(params);
                } catch {
                  // ignore
                }
              }
            }
          }
        }

        msg = parseOne();
      }

      const ok = await readMore();

      if (!ok) {
        break;
      }
    }

    // Process ended; reject pending requests.
    for (const [, pending] of this.pending) {
      pending.reject(new Error('LSP connection closed'));
    }

    this.pending.clear();
  }
}

const tryResolveTsgoCommand = async (cwd: string): Promise<ResolvedTsgoCommand | null> => {
  const resolved = await tryResolveLocalBin({ cwd, binName: 'tsgo', callerDir: import.meta.dir });

  if (resolved) {
    return { command: resolved, args: ['--lsp', '--stdio'] };
  }

  // If running from a nested dir, also try the current process cwd.
  // (Some callers pass a tsconfig-derived cwd.)
  const resolvedFromProcessCwd = await tryResolveLocalBin({ cwd: process.cwd(), binName: 'tsgo', callerDir: import.meta.dir });

  if (resolvedFromProcessCwd) {
    return { command: resolvedFromProcessCwd, args: ['--lsp', '--stdio'] };
  }

  // Last resort: bunx package that provides tsgo
  const bunx = tryResolveBunxCommand();

  if (bunx) {
    // `bunx -y @typescript/native-preview --lsp --stdio`
    return {
      command: bunx.command,
      args: [...bunx.prefixArgs, '-y', '@typescript/native-preview', '--lsp', '--stdio'],
      note: 'bunx fallback',
    };
  }

  return null;
};

const runTsgoTraceSymbol = async (req: TsgoTraceRequest): Promise<TsgoTraceResult> => {
  try {
    const baseCwd = process.cwd();
    const entryFile = path.isAbsolute(req.entryFile) ? req.entryFile : path.resolve(baseCwd, req.entryFile);
    const cwd = req.tsconfigPath ? path.dirname(path.resolve(baseCwd, req.tsconfigPath)) : baseCwd;
    const resolved = await tryResolveTsgoCommand(cwd);

    if (!resolved) {
      return {
        ok: false,
        tool: 'tsgo',
        error:
          'tsgo is not available. Install @typescript/native-preview (devDependency) or ensure `tsgo` is on PATH (or `bunx` is available).',
      };
    }

    const entryText = await readFileText(entryFile);

    if (entryText.length === 0) {
      return { ok: false, tool: 'tsgo', error: `failed to read entryFile: ${entryFile}` };
    }

    const pos = findSymbolPositionInText(entryText, req.symbol);

    if (!pos) {
      return { ok: false, tool: 'tsgo', error: `symbol not found in entryFile text: ${req.symbol}` };
    }

    const lsp = await LspConnection.start({ cwd, command: resolved.command, args: resolved.args });

    try {
      const rootUri = pathToFileURL(cwd).toString();
      const entryUri = pathToFileURL(entryFile).toString();

      await lsp.request('initialize', {
        processId: null,
        rootUri,
        capabilities: {},
        workspaceFolders: [{ uri: rootUri, name: path.basename(cwd) }],
      });
      await lsp.notify('initialized', {});

      await lsp.notify('textDocument/didOpen', {
        textDocument: {
          uri: entryUri,
          languageId: 'typescript',
          version: 1,
          text: entryText,
        },
      });

      // Give tsgo a moment to process the opened document.
      await new Promise<void>(r => setTimeout(r, 500));

      const definitionResult = await lsp
        .request<LspLocation | LspLocation[] | LspLocationLink[] | null>('textDocument/definition', {
          textDocument: { uri: entryUri },
          position: pos,
        })
        .catch(() => null);
      const references = await lsp.request<LspLocation[]>('textDocument/references', {
        textDocument: { uri: entryUri },
        position: pos,
        context: { includeDeclaration: true },
      });
      const nodes: TraceNode[] = [];
      const edges: TraceEdge[] = [];
      const evidence: TraceEvidenceSpan[] = [];
      const nodeIds = new Set<string>();
      const edgeIds = new Set<string>();

      const addNode = (node: TraceNode): void => {
        if (nodeIds.has(node.id)) {
          return;
        }

        nodeIds.add(node.id);
        nodes.push(node);
      };

      const addEdge = (edge: TraceEdge): void => {
        const id = `${edge.from}->${edge.to}:${edge.kind}:${edge.label ?? ''}`;

        if (edgeIds.has(id)) {
          return;
        }

        edgeIds.add(id);
        edges.push(edge);
      };

      const symbolNodeId = `symbol:${req.symbol}`;

      addNode({ id: symbolNodeId, kind: 'symbol', label: req.symbol, filePath: entryFile });

      const entryFileNodeId = `file:${entryFile}`;

      addNode({ id: entryFileNodeId, kind: 'file', label: path.basename(entryFile), filePath: entryFile });
      addEdge({ from: symbolNodeId, to: entryFileNodeId, kind: 'references' });

      const normalizeLocations = (value: unknown): LspLocation[] => {
        if (!value) {
          return [];
        }

        if (Array.isArray(value)) {
          // Location[] or LocationLink[]
          const out: LspLocation[] = [];

          for (const item of value) {
            if (!item || typeof item !== 'object') {
              continue;
            }

            if ('uri' in item && 'range' in item) {
              out.push(item as LspLocation);
            } else if ('targetUri' in item && 'targetRange' in item) {
              const link = item as LspLocationLink;

              out.push({ uri: link.targetUri, range: link.targetRange });
            }
          }

          return out;
        }

        if (typeof value === 'object' && value && 'uri' in value && 'range' in value) {
          return [value as LspLocation];
        }

        return [];
      };

      const defLocations = normalizeLocations(definitionResult);

      if (defLocations.length > 0) {
        const def = defLocations[0];

        if (def) {
          const defPath = fileUrlToPathSafe(def.uri);
          const defSpan = toSpanFromRange(def.range);
          const defNodeId = `ref:def:${defPath}:${def.range.start.line}:${def.range.start.character}`;

          addNode({
            id: defNodeId,
            kind: 'reference',
            label: `definition:${path.basename(defPath)}:${defSpan.start.line}`,
            filePath: defPath,
            span: defSpan,
          });
          addEdge({ from: symbolNodeId, to: defNodeId, kind: 'references', label: 'definition' });

          const defFileNodeId = `file:${defPath}`;

          addNode({ id: defFileNodeId, kind: 'file', label: path.basename(defPath), filePath: defPath });
          addEdge({ from: defNodeId, to: defFileNodeId, kind: 'references' });

          const text = await extractEvidenceText(defPath, defSpan);

          evidence.push({ filePath: defPath, span: defSpan, ...(text !== undefined ? { text } : {}) });
        }
      }

      const maxRefs = Math.max(1, req.maxDepth ?? 200);
      const refsToUse = references.slice(0, maxRefs);

      for (const ref of refsToUse) {
        const filePath = fileUrlToPathSafe(ref.uri);
        const span = toSpanFromRange(ref.range);
        const fileNodeId = `file:${filePath}`;

        addNode({ id: fileNodeId, kind: 'file', label: path.basename(filePath), filePath });

        const refNodeId = `ref:${filePath}:${ref.range.start.line}:${ref.range.start.character}`;

        addNode({ id: refNodeId, kind: 'reference', label: `${path.basename(filePath)}:${span.start.line}`, filePath, span });

        addEdge({ from: symbolNodeId, to: refNodeId, kind: 'references' });
        addEdge({ from: refNodeId, to: fileNodeId, kind: 'references' });

        const text = await extractEvidenceText(filePath, span);

        evidence.push({ filePath, span, ...(text !== undefined ? { text } : {}) });
      }

      const structured = { graph: { nodes, edges } satisfies TraceGraph, evidence, meta: resolved.note };

      return { ok: true, tool: 'tsgo', structured };
    } finally {
      await lsp.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return { ok: false, tool: 'tsgo', error: message };
  }
};

export { runTsgoTraceSymbol };
export type { TsgoTraceRequest, TsgoTraceResult };

export type { LspPosition, LspRange, LspLocation, LspLocationLink, TsgoLspSession };

export const withTsgoLspSession = async <T>(
  input: LspSessionInput,
  fn: (session: TsgoLspSession) => Promise<T>,
): Promise<WithTsgoSessionResult<T>> => {
  try {
    input.logger.debug('Acquiring tsgo LSP session', { root: input.root, tsconfigPath: input.tsconfigPath });

    const acquired = await acquireSharedTsgoSession(input);

    if (!acquired.ok) {
      input.logger.warn(`tsgo LSP session unavailable: ${acquired.error}`);

      return { ok: false, error: acquired.error };
    }

    input.logger.trace('tsgo LSP session acquired', {
      key: acquired.entry.key,
      refCount: acquired.entry.refCount,
      note: acquired.entry.note,
    });

    const value = await runInSharedTsgoSession(acquired.entry, fn);

    input.logger.trace('tsgo LSP session operation complete');

    return { ok: true, value, ...(acquired.entry.note ? { note: acquired.entry.note } : {}) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    input.logger.error(`tsgo LSP session error: ${message}`, undefined, error);

    return { ok: false, error: message };
  }
};

export const openTsDocument = async (input: OpenTsDocumentInput): Promise<OpenTsDocumentResult> => {
  const text = input.text ?? (await readFileText(input.filePath));
  const uri = pathToFileURL(input.filePath).toString();

  await input.lsp.notify('textDocument/didOpen', {
    textDocument: {
      uri,
      languageId: input.languageId ?? 'typescript',
      version: input.version ?? 1,
      text,
    },
  });

  return { uri, text };
};

export const lspUriToFilePath = fileUrlToPathSafe;
