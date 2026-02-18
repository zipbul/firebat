import { parseSync } from 'oxc-parser';

declare var self: Worker;

interface ParseWorkerRequest {
  readonly filePath: string;
  readonly requestId?: number;
}

interface ParseWorkerResponseOk {
  readonly ok: true;
  readonly filePath: string;
  readonly requestId: number;
  readonly sourceText: string;
  readonly program: unknown;
  readonly errors: ReadonlyArray<unknown>;
}

interface ParseWorkerResponseFail {
  readonly ok: false;
  readonly filePath: string;
  readonly requestId: number;
  readonly error: string;
  readonly errorStage: 'read' | 'parse' | 'postMessage' | 'unknown';
}

postMessage({ type: 'ready' });

const extractFilePath = (data: unknown): string | null => {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const maybeFilePath = (data as { filePath?: unknown }).filePath;

  if (typeof maybeFilePath !== 'string') {
    return null;
  }

  if (maybeFilePath.trim().length === 0) {
    return null;
  }

  return maybeFilePath;
};

const extractRequestId = (data: unknown): number => {
  if (!data || typeof data !== 'object') {
    return 0;
  }

  if (!('requestId' in data)) {
    return 0;
  }

  const maybeRequestId = (data as { requestId?: unknown }).requestId;

  if (typeof maybeRequestId !== 'number') {
    return 0;
  }

  if (!Number.isFinite(maybeRequestId)) {
    return 0;
  }

  const rounded = Math.floor(maybeRequestId);

  return rounded >= 1 ? rounded : 0;
};

const toCloneableError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === 'object') {
    const maybeMessage = (error as { message?: unknown }).message;

    if (typeof maybeMessage === 'string') {
      return maybeMessage;
    }
  }

  return String(error);
};

self.onmessage = async (event: MessageEvent<ParseWorkerRequest>) => {
  // Ignore READY echo (should not happen but guard)
  const rawData = (event as unknown as { data?: unknown })?.data;

  if (rawData && typeof rawData === 'object' && (rawData as Record<string, unknown>).type === 'ready') {
    return;
  }
  const filePath = extractFilePath((event as unknown as { data?: unknown })?.data);
  const requestId = extractRequestId((event as unknown as { data?: unknown })?.data);

  if (filePath === null) {
    const response: ParseWorkerResponseFail = {
      ok: false,
      filePath: '',
      requestId,
      error: 'invalid filePath',
      errorStage: 'unknown',
    };

    postMessage(response);

    return;
  }

  try {
    const sourceText = await Bun.file(filePath).text();

    const parsed = parseSync(filePath, sourceText);

    const response: ParseWorkerResponseOk = {
      ok: true,
      filePath,
      requestId,
      sourceText,
      program: parsed.program,
      errors: Array.isArray(parsed.errors) ? parsed.errors.map(toCloneableError) : [],
    };

    postMessage(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stage: ParseWorkerResponseFail['errorStage'] = message.includes('DataCloneError') ? 'postMessage' : 'unknown';

    try {
      const response: ParseWorkerResponseFail = { ok: false, filePath, requestId, error: message, errorStage: stage };

      postMessage(response);
    } catch (postError) {
      throw postError;
    }
  }
};
