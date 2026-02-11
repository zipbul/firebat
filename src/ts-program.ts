import type { ParsedFile } from './engine/types';
import type { FirebatProgramConfig } from './interfaces';

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
}

interface ParseWorkerResponseOk {
  readonly ok: true;
  readonly filePath: string;
  readonly sourceText: string;
  readonly program: ParsedFile['program'];
  readonly errors: ReadonlyArray<unknown>;
}

interface ParseWorkerResponseFail {
  readonly ok: false;
  readonly filePath: string;
  readonly error: string;
}

type ParseWorkerResponse = ParseWorkerResponseOk | ParseWorkerResponseFail;

interface WorkerHandlers {
  onmessage: ((event: MessageEvent<ParseWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
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

  const workerSource = `
    import { parseSync } from "oxc-parser";
    declare var self: Worker;

    self.onmessage = async (event: MessageEvent) => {
      const filePath = (event as any)?.data?.filePath;
      if (typeof filePath !== "string" || filePath.length === 0) {
        postMessage({ ok: false, filePath: String(filePath ?? ""), error: "invalid filePath" });
        return;
      }

      try {
        const sourceText = await Bun.file(filePath).text();
        const parsed = parseSync(filePath, sourceText);

        // NOTE: parsed.comments is not structured-cloneable in Bun workers.
        postMessage({ ok: true, filePath, sourceText, program: parsed.program, errors: parsed.errors });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        postMessage({ ok: false, filePath, error: message });
      }
    };
  `;
  const workerFile = new File([workerSource], 'firebat-parse-worker.ts', { type: 'text/javascript' });
  const workerUrl = URL.createObjectURL(workerFile);
  const workerCount = Math.max(1, Math.min(hardware, eligible.length));
  const workers: Worker[] = [];

  config.logger.debug(`Spawning ${workerCount} parse workers for ${eligible.length} eligible files`, {
    hardwareConcurrency: hardware,
  });

  try {
    for (let i = 0; i < workerCount; i += 1) {
      workers.push(new Worker(workerUrl));
    }

    const resultsByIndex: Array<ParsedFile | undefined> = new Array<ParsedFile | undefined>(fileNames.length);
    let cursor = 0;

    const requestParse = async (worker: Worker, filePath: string): Promise<ParseWorkerResponse> => {
      return new Promise((resolve, reject) => {
        const w = worker as WorkerHandlers;
        const prevOnMessage = w.onmessage;
        const prevOnError = w.onerror;

        w.onmessage = (event: MessageEvent<ParseWorkerResponse>) => {
          w.onmessage = prevOnMessage;
          w.onerror = prevOnError;

          resolve(event.data);
        };

        w.onerror = (event: ErrorEvent) => {
          w.onmessage = prevOnMessage;
          w.onerror = prevOnError;

          reject(event);
        };

        const payload: ParseWorkerRequest = { filePath };

        worker.postMessage(payload);
      });
    };

    const runners = workers.map(worker =>
      (async (): Promise<void> => {
        while (true) {
          const current = cursor;

          cursor += 1;

          const item = eligible[current];

          if (!item) {
            return;
          }

          try {
            const data = await requestParse(worker, item.filePath);

            if (!isParseWorkerResponse(data) || !isParseWorkerOk(data)) {
              const errText =
                isParseWorkerResponse(data) && typeof (data as ParseWorkerResponseFail).error === 'string'
                  ? (data as ParseWorkerResponseFail).error
                  : 'unknown error';

              config.logger.warn(`Parse failed: ${item.filePath}: ${errText}`);

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
            const message = error instanceof Error ? error.message : String(error);

            config.logger.warn(`Parse failed: ${item.filePath}: ${message}`);
          }
        }
      })(),
    );

    await Promise.all(runners);

    const results = resultsByIndex.filter((v): v is ParsedFile => v !== undefined);

    config.logger.trace(`Parse complete: ${results.length}/${eligible.length} files succeeded`);

    return results;
  } finally {
    for (const worker of workers) {
      try {
        worker.terminate();
      } catch {
        // ignore
      }
    }

    try {
      URL.revokeObjectURL(workerUrl);
    } catch {
      // ignore
    }
  }
};

// End of file
