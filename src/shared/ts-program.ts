import type { ParsedFile } from '../engine/types';
import type { FirebatProgramConfig } from '../interfaces';

import { parseSource } from '../engine/ast/parse-source';

const normalizePath = (filePath: string): string => filePath.replaceAll('\\', '/');

const shouldIncludeFile = (filePath: string): boolean => {
  const normalized = normalizePath(filePath);
  const segments = normalized.split('/');
  const nodeModulesSegment = 'node' + '_modules';

  if (segments.includes(nodeModulesSegment)) {
    return false;
  }

  if (normalized.endsWith('.d.ts')) {
    return false;
  }

  return true;
};

interface EligibleFile {
  readonly filePath: string;
  readonly index: number;
}

interface ParseWorkerRequest {
  readonly filePath: string;
  readonly requestId: number;
}

interface ParseWorkerResponseOk {
  readonly ok: true;
  readonly filePath: string;
  readonly requestId: number;
  readonly sourceText: string;
  readonly program: ParsedFile['program'];
  readonly errors: ReadonlyArray<unknown>;
}

interface ParseWorkerResponseFail {
  readonly ok: false;
  readonly filePath: string;
  readonly requestId: number;
  readonly error: string;
  readonly errorStage?: 'read' | 'parse' | 'postMessage' | 'unknown';
}

type ParseWorkerResponse = ParseWorkerResponseOk | ParseWorkerResponseFail;

interface WorkerHandlers {
  onmessage: ((event: MessageEvent<ParseWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
}

interface ParseWorkerResponseShape {
  readonly ok?: unknown;
  readonly filePath?: unknown;
}

const isParseWorkerResponse = (value: unknown): value is ParseWorkerResponse => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const shape = value as ParseWorkerResponseShape;
  const ok = shape.ok;
  const filePath = shape.filePath;

  return typeof ok === 'boolean' && typeof filePath === 'string';
};

const isParseWorkerOk = (value: ParseWorkerResponse): value is ParseWorkerResponseOk => value.ok === true;

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === 'object') {
    const maybeMessage = (error as { message?: unknown }).message;
    const maybeError = (error as { error?: unknown }).error;

    if (typeof maybeMessage === 'string' && maybeMessage.length > 0) {
      return maybeMessage;
    }

    if (typeof maybeError === 'string' && maybeError.length > 0) {
      return maybeError;
    }
  }

  return String(error);
};

const createParseWorker = (): Worker => {
  return new Worker(new URL('../workers/parse-worker.js', import.meta.url), { type: 'module' });
};

let readyTimeoutMs = 10_000;

interface ReadyMessageShape {
  readonly type?: unknown;
}

const waitForReady = (worker: Worker, timeoutMs: number): Promise<boolean> => {
  return new Promise((resolve) => {
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;

        (worker as unknown as WorkerHandlers).onmessage = null;

        resolve(false);
      }
    }, timeoutMs);

    (worker as unknown as WorkerHandlers).onmessage = ((event: MessageEvent) => {
      const data = event.data as ReadyMessageShape | null;

      if (data && typeof data === 'object' && data.type === 'ready') {
        if (!resolved) {
          resolved = true;

          clearTimeout(timer);

          (worker as unknown as WorkerHandlers).onmessage = null;

          resolve(true);
        }
      }
    }) as WorkerHandlers['onmessage'];
  });
};

// Replaces createFirebatProgram to return ParsedFile[]
export const createFirebatProgram = async (config: FirebatProgramConfig): Promise<ParsedFile[]> => {
  const fileNames = config.targets;
  const hardware =
    typeof navigator === 'object' && typeof navigator.hardwareConcurrency === 'number'
      ? Math.max(1, Math.floor(navigator.hardwareConcurrency))
      : 4;
  const eligible: EligibleFile[] = [];

  for (let i = 0; i < fileNames.length; i += 1) {
    const filePath = fileNames[i];

    if (filePath === undefined) {
      continue;
    }

    if (!shouldIncludeFile(filePath)) {
      continue;
    }

    eligible.push({ filePath, index: i });
  }

  if (eligible.length === 0) {
    config.logger.debug('No eligible files to parse');

    return [];
  }

  const workerCount = Math.max(1, Math.min(hardware, eligible.length));
  const workers: Worker[] = [];

  config.logger.debug('Spawning parse workers', {
    workerCount,
    eligibleCount: eligible.length,
    hardwareConcurrency: hardware,
  });

  try {
    const maxBootRetries = 2;

    for (let i = 0; i < workerCount; i += 1) {
      let workerReady = false;

      for (let attempt = 0; attempt <= maxBootRetries; attempt += 1) {
        const w = createParseWorker();

        const ready = await waitForReady(w, readyTimeoutMs);

        if (ready) {
          workers.push(w);
          workerReady = true;

          break;
        }

        config.logger.warn('Parse worker boot stall', { workerId: i, attempt });

        try {
          w.terminate();
        } catch {
          // ignore
        }
      }

      if (!workerReady) {
        config.logger.warn('Parse worker boot failed after retries', { workerId: i, maxBootRetries });
      }
    }

    const resultsByIndex: Array<ParsedFile | undefined> = new Array<ParsedFile | undefined>(fileNames.length);
    let cursor = 0;

    const parseWithFallback = async (filePath: string, reason: string): Promise<ParsedFile | null> => {
      try {
        const sourceText = await Bun.file(filePath).text();

        return parseSource(filePath, sourceText);
      } catch (error) {
        config.logger.warn('Parse fallback failed', { filePath, reason, error: formatUnknownError(error) });

        return null;
      }
    };

    let nextRequestId = 1;

    const requestParse = async (worker: Worker, workerId: number, filePath: string): Promise<ParseWorkerResponse> => {
      return new Promise((resolve, reject) => {
        const w = worker as WorkerHandlers;
        const prevOnMessage = w.onmessage;
        const prevOnError = w.onerror;
        const prevOnMessageError = w.onmessageerror;
        const requestId = nextRequestId;

        nextRequestId += 1;

        w.onmessage = (event: MessageEvent<ParseWorkerResponse>) => {
          w.onmessage = prevOnMessage;
          w.onerror = prevOnError;
          w.onmessageerror = prevOnMessageError;

          resolve(event.data);
        };

        w.onerror = (event: ErrorEvent) => {
          w.onmessage = prevOnMessage;
          w.onerror = prevOnError;
          w.onmessageerror = prevOnMessageError;

          reject(event);
        };

        w.onmessageerror = (event: MessageEvent<unknown>) => {
          w.onmessage = prevOnMessage;
          w.onerror = prevOnError;
          w.onmessageerror = prevOnMessageError;

          config.logger.warn('Parse worker messageerror', { workerId, requestId, filePath });

          reject(event);
        };

        const payload: ParseWorkerRequest = { filePath, requestId };

        worker.postMessage(payload);
      });
    };

    const runners = workers.map((worker, workerId) =>
      (async (): Promise<void> => {
        while (true) {
          const current = cursor;

          cursor += 1;

          const item = eligible[current];

          if (!item) {
            return;
          }

          try {
            const data = await requestParse(worker, workerId, item.filePath);

            if (!isParseWorkerResponse(data) || !isParseWorkerOk(data)) {
              const errText =
                isParseWorkerResponse(data) && typeof (data as ParseWorkerResponseFail).error === 'string'
                  ? (data as ParseWorkerResponseFail).error
                  : 'unknown error';
              const fallback = await parseWithFallback(item.filePath, `worker-response:${errText}`);

              if (fallback) {
                resultsByIndex[item.index] = { ...fallback, comments: [] };

                continue;
              }

              config.logger.warn('Parse failed', { filePath: item.filePath, error: errText });

              continue;
            }

            resultsByIndex[item.index] = {
              filePath: item.filePath,
              program: data.program,
              errors: Array.isArray(data.errors) ? data.errors : [],
              comments: [],
              sourceText: typeof data.sourceText === 'string' ? data.sourceText : '',
            };
          } catch (error) {
            const message = formatUnknownError(error);
            const fallback = await parseWithFallback(item.filePath, `worker-error:${message}`);

            if (fallback) {
              resultsByIndex[item.index] = { ...fallback, comments: [] };

              continue;
            }

            config.logger.warn('Parse failed', { filePath: item.filePath, error: message }, error);
          }
        }
      })(),
    );

    await Promise.all(runners);

    const results = resultsByIndex.filter((v): v is ParsedFile => v !== undefined);

    config.logger.trace('Parse complete', { okCount: results.length, eligibleCount: eligible.length });

    return results;
  } finally {
    for (const worker of workers) {
      try {
        worker.terminate();
      } catch {
        // ignore
      }
    }
  }
};

// End of file

export const __testing__ = {
  setReadyTimeoutMs: (ms: number): void => {
    readyTimeoutMs = ms;
  },
  resetReadyTimeoutMs: (): void => {
    readyTimeoutMs = 10_000;
  },
};
