import { describe, test, expect } from 'bun:test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { createFirebatProgram, __testing__ } from './ts-program';

interface FakeWorkerEvent<T> {
  readonly data: T;
}

interface FakeWorkerMessageErrorEvent {
  readonly type: 'messageerror';
}

class FakeWorker {
  public onmessage: ((event: FakeWorkerEvent<any>) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;
  public onmessageerror: ((event: FakeWorkerMessageErrorEvent) => void) | null = null;

  readonly url: string;
  readonly options: unknown;

  static created: FakeWorker[] = [];
  static postedPayloads: unknown[] = [];
  static simulateOkFalseOnce = false;
  static simulateOkFalseError = 'simulated worker error';
  static simulateMessageErrorOnce = false;

  constructor(url: URL | string, options?: unknown) {
    this.url = typeof url === 'string' ? url : url.toString();
    this.options = options;

    FakeWorker.created.push(this);

    // Simulate worker boot completion (READY handshake)
    queueMicrotask(() => {
      this.onmessage?.({ data: { type: 'ready' } });
    });
  }

  postMessage(payload: unknown): void {
    FakeWorker.postedPayloads.push(payload);

    queueMicrotask(() => {
      if (FakeWorker.simulateMessageErrorOnce) {
        FakeWorker.simulateMessageErrorOnce = false;

        this.onmessageerror?.({ type: 'messageerror' });

        return;
      }

      if (!this.onmessage) {
        return;
      }

      const filePath = (payload as any)?.filePath;

      if (FakeWorker.simulateOkFalseOnce) {
        FakeWorker.simulateOkFalseOnce = false;

        this.onmessage({
          data: {
            ok: false,
            filePath: typeof filePath === 'string' ? filePath : '',
            error: FakeWorker.simulateOkFalseError,
          },
        });

        return;
      }

      this.onmessage({
        data: {
          ok: true,
          filePath: typeof filePath === 'string' ? filePath : '',
          sourceText: 'export const x = 1;\n',
          program: {},
          errors: [],
        },
      });
    });
  }

  terminate(): void {
    // noop
  }
}

describe('ts-program', () => {
  test('should post a {filePath} payload when parsing targets', async () => {
    // Arrange
    const realWorker = globalThis.Worker;

    (globalThis as any).Worker = FakeWorker;

    FakeWorker.created = [];
    FakeWorker.postedPayloads = [];

    const warns: Array<{ message: string }> = [];
    const logger = {
      level: 'trace',
      log: () => undefined,
      error: () => undefined,
      warn: (message: string) => {
        warns.push({ message });
      },
      info: () => undefined,
      debug: () => undefined,
      trace: () => undefined,
    };
    const filePath = path.join(process.cwd(), 'test/mcp/fixtures/sample.ts');

    try {
      // Act
      const result = await createFirebatProgram({ targets: [filePath], logger } as any);

      // Assert
      expect(result.length).toBe(1);
      expect(result[0]?.filePath).toBe(filePath);
      expect(FakeWorker.postedPayloads[0]).toMatchObject({ filePath, requestId: 1 });
      expect(warns.length).toBe(0);
    } finally {
      // Cleanup
      (globalThis as any).Worker = realWorker;
    }
  });

  test('should prefer parse-worker.js when it can be constructed', async () => {
    // Arrange
    const realWorker = globalThis.Worker;

    (globalThis as any).Worker = FakeWorker;

    FakeWorker.created = [];
    FakeWorker.postedPayloads = [];

    const logger = {
      level: 'trace',
      log: () => undefined,
      error: () => undefined,
      warn: () => undefined,
      info: () => undefined,
      debug: () => undefined,
      trace: () => undefined,
    };
    const filePath = path.join(process.cwd(), 'test/mcp/fixtures/sample.ts');

    try {
      // Act
      await createFirebatProgram({ targets: [filePath], logger } as any);

      // Assert
      expect(FakeWorker.created.length).toBeGreaterThan(0);
      expect(FakeWorker.created[0]?.url.endsWith('workers/parse-worker.js')).toBe(true);
      expect(FakeWorker.created[0]?.options).toEqual({ type: 'module' });
    } finally {
      // Cleanup
      (globalThis as any).Worker = realWorker;
    }
  });

  test('should throw when parse-worker.js construction throws', async () => {
    // Arrange
    const realWorker = globalThis.Worker;

    class ThrowingJsWorker extends FakeWorker {
      constructor(url: URL | string, options?: unknown) {
        const urlString = typeof url === 'string' ? url : url.toString();

        if (urlString.endsWith('workers/parse-worker.js')) {
          throw new Error('simulate missing dist worker');
        }

        super(url, options);
      }
    }

    (globalThis as any).Worker = ThrowingJsWorker;

    FakeWorker.created = [];
    FakeWorker.postedPayloads = [];

    const logger = {
      level: 'trace',
      log: () => undefined,
      error: () => undefined,
      warn: () => undefined,
      info: () => undefined,
      debug: () => undefined,
      trace: () => undefined,
    };
    const filePath = path.join(process.cwd(), 'test/mcp/fixtures/sample.ts');

    try {
      // Act
      let thrown: unknown = null;

      try {
        await createFirebatProgram({ targets: [filePath], logger } as any);
      } catch (error) {
        thrown = error;
      }

      // Assert
      expect(thrown).toBeTruthy();
      expect(FakeWorker.created.length).toBe(0);
    } finally {
      // Cleanup
      (globalThis as any).Worker = realWorker;
    }
  });

  test('should return parsed files even when worker returns ok=false (fallback path)', async () => {
    // Arrange
    const realWorker = globalThis.Worker;

    (globalThis as any).Worker = FakeWorker;

    FakeWorker.created = [];
    FakeWorker.postedPayloads = [];
    FakeWorker.simulateOkFalseOnce = true;
    FakeWorker.simulateOkFalseError = 'simulated worker failure';

    const warns: Array<{ message: string }> = [];
    const logger = {
      level: 'trace',
      log: () => undefined,
      error: () => undefined,
      warn: (message: string) => {
        warns.push({ message });
      },
      info: () => undefined,
      debug: () => undefined,
      trace: () => undefined,
    };
    const tmpRootAbs = await mkdtemp(path.join(os.tmpdir(), 'firebat-ts-program-test-'));
    const fixturesAbs = path.join(tmpRootAbs, 'fixtures');

    await mkdir(fixturesAbs, { recursive: true });

    const filePath = path.join(fixturesAbs, 'fallback.ts');

    await Bun.write(filePath, 'export const x = 1;\n');

    try {
      // Act
      const result = await createFirebatProgram({ targets: [filePath], logger } as any);

      // Assert
      expect(result.length).toBe(1);
      expect(result[0]?.filePath).toBe(filePath);
      expect(warns.length).toBe(0);
    } finally {
      // Cleanup
      await rm(tmpRootAbs, { recursive: true, force: true });

      (globalThis as any).Worker = realWorker;
    }
  });

  test('should fall back when worker triggers messageerror (clone failure) rather than hanging', async () => {
    // Arrange
    const realWorker = globalThis.Worker;

    (globalThis as any).Worker = FakeWorker;

    FakeWorker.created = [];
    FakeWorker.postedPayloads = [];
    FakeWorker.simulateMessageErrorOnce = true;

    const warns: Array<{ message: string }> = [];
    const logger = {
      level: 'trace',
      log: () => undefined,
      error: () => undefined,
      warn: (message: string) => {
        warns.push({ message });
      },
      info: () => undefined,
      debug: () => undefined,
      trace: () => undefined,
    };
    const tmpRootAbs = await mkdtemp(path.join(os.tmpdir(), 'firebat-ts-program-messageerror-test-'));
    const fixturesAbs = path.join(tmpRootAbs, 'fixtures');

    await mkdir(fixturesAbs, { recursive: true });

    const filePath = path.join(fixturesAbs, 'messageerror.ts');

    await Bun.write(filePath, 'export const x = 1;\n');

    try {
      // Act
      const result = await createFirebatProgram({ targets: [filePath], logger } as any);

      // Assert
      expect(result.length).toBe(1);
      expect(result[0]?.filePath).toBe(filePath);
      expect(warns.length).toBe(1);
      expect(warns[0]?.message).toBe('Parse worker messageerror');
    } finally {
      // Cleanup
      await rm(tmpRootAbs, { recursive: true, force: true });

      (globalThis as any).Worker = realWorker;
    }
  }, 1500);

  test('should recover when a worker fails to boot (READY handshake)', async () => {
    // Arrange
    const realWorker = globalThis.Worker;
    const terminatedUrls: string[] = [];
    let creationIndex = 0;

    class ReadyAwareFakeWorker {
      public onmessage: ((event: any) => void) | null = null;
      public onerror: ((event: any) => void) | null = null;
      public onmessageerror: ((event: any) => void) | null = null;

      readonly url: string;
      readonly options: unknown;
      private readonly stalled: boolean;

      constructor(url: URL | string, options?: unknown) {
        this.url = typeof url === 'string' ? url : url.toString();
        this.options = options;

        this.stalled = creationIndex === 0;
        creationIndex += 1;

        if (!this.stalled) {
          queueMicrotask(() => {
            this.onmessage?.({ data: { type: 'ready' } });
          });
        }
      }

      postMessage(payload: unknown): void {
        if (this.stalled) {
          return;
        }

        queueMicrotask(() => {
          if (!this.onmessage) {
            return;
          }

          const filePath = (payload as any)?.filePath;

          this.onmessage({
            data: {
              ok: true,
              filePath: typeof filePath === 'string' ? filePath : '',
              requestId: (payload as any)?.requestId ?? 0,
              sourceText: 'export const x = 1;\n',
              program: {},
              errors: [],
            },
          });
        });
      }

      terminate(): void {
        terminatedUrls.push(this.url);
      }
    }

    (globalThis as any).Worker = ReadyAwareFakeWorker;

    const warns: Array<{ message: string }> = [];
    const logger = {
      level: 'trace',
      log: () => undefined,
      error: () => undefined,
      warn: (message: string) => {
        warns.push({ message });
      },
      info: () => undefined,
      debug: () => undefined,
      trace: () => undefined,
    };
    const filePath = path.join(process.cwd(), 'test/mcp/fixtures/sample.ts');

    try {
      __testing__.setReadyTimeoutMs(200);

      // Act
      const result = await createFirebatProgram({ targets: [filePath], logger } as any);

      // Assert — stalled worker terminated, retry created a new one, parsing succeeded
      expect(result.length).toBe(1);
      expect(result[0]?.filePath).toBe(filePath);
      expect(terminatedUrls.length).toBeGreaterThanOrEqual(1);
      expect(creationIndex).toBeGreaterThan(1);
    } finally {
      __testing__.resetReadyTimeoutMs();

      (globalThis as any).Worker = realWorker;
    }
  }, 5000);
});
