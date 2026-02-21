import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const repoRootAbs = path.resolve(path.dirname(Bun.fileURLToPath(new URL(import.meta.url))), '../../../../');

interface ParseWorkerResponseOk {
  readonly ok: true;
  readonly filePath: string;
  readonly sourceText: string;
  readonly program: unknown;
  readonly errors: ReadonlyArray<unknown>;
}

interface ParseWorkerResponseFail {
  readonly ok: false;
  readonly filePath: string;
  readonly error: string;
}

type ParseWorkerResponse = ParseWorkerResponseOk | ParseWorkerResponseFail;

const runDistWorkerOnce = async (workerOutAbs: string, payload: unknown, timeoutMs = 5_000): Promise<ParseWorkerResponse> => {
  const workerUrl = Bun.pathToFileURL(workerOutAbs);
  const worker = new Worker(workerUrl, { type: 'module' });

  try {
    return await new Promise<ParseWorkerResponse>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);

      worker.onmessage = event => {
        const data = (event as MessageEvent).data as Record<string, unknown> | null;

        if (data && typeof data === 'object' && data.type === 'ready') {
          return;
        }

        clearTimeout(timer);
        resolve((event as MessageEvent).data as ParseWorkerResponse);
      };

      worker.onerror = event => {
        clearTimeout(timer);
        reject(event);
      };

      worker.postMessage(payload);
    });
  } finally {
    try {
      worker.terminate();
    } catch {
      // ignore
    }
  }
};

let tmpRootAbs = '';
let fixturesAbs = '';
let validFileAbs = '';
let syntaxErrorFileAbs = '';
let missingFileAbs = '';
let workerOutAbs = '';

describe('build (integration)', () => {
  beforeAll(async () => {
    // Arrange
    workerOutAbs = path.join(repoRootAbs, 'dist/workers/parse-worker.js');

    const result = Bun.spawnSync(['bun', 'run', 'build'], {
      cwd: repoRootAbs,
      stdout: 'pipe',
      stderr: 'pipe',
      env: process.env,
    });

    expect(result.exitCode).toBe(0);
    expect(await Bun.file(workerOutAbs).exists()).toBe(true);

    tmpRootAbs = await mkdtemp(path.join(os.tmpdir(), 'firebat-dist-worker-test-'));
    fixturesAbs = path.join(tmpRootAbs, 'fixtures');

    await mkdir(fixturesAbs, { recursive: true });

    validFileAbs = path.join(fixturesAbs, 'valid.ts');
    syntaxErrorFileAbs = path.join(fixturesAbs, 'syntax-error.ts');
    missingFileAbs = path.join(fixturesAbs, 'does-not-exist.ts');

    await Bun.write(validFileAbs, 'export const x = 1;\n');
    await Bun.write(syntaxErrorFileAbs, 'export const = 123\n');
  }, 60_000);

  afterAll(async () => {
    if (!tmpRootAbs) {
      return;
    }

    await rm(tmpRootAbs, { recursive: true, force: true });
  });

  test('should emit dist/workers/parse-worker.js when build runs', async () => {
    // Arrange
    await rm(workerOutAbs, { force: true });

    // Act
    const result = Bun.spawnSync(['bun', 'run', 'build'], {
      cwd: repoRootAbs,
      stdout: 'pipe',
      stderr: 'pipe',
      env: process.env,
    });

    // Assert
    expect(result.exitCode).toBe(0);
    expect(await Bun.file(workerOutAbs).exists()).toBe(true);
  }, 60_000);

  test('should return ok=true when dist worker parses a valid file', async () => {
    // Arrange
    const payload = { filePath: validFileAbs };
    // Act
    const data = await runDistWorkerOnce(workerOutAbs, payload);

    // Assert
    expect(data.ok).toBe(true);
    expect((data as ParseWorkerResponseOk).filePath).toBe(validFileAbs);
    expect((data as ParseWorkerResponseOk).sourceText).toBe('export const x = 1;\n');
    expect(Array.isArray((data as ParseWorkerResponseOk).errors)).toBe(true);
  }, 60_000);

  test('should return ok=true and include parse errors when dist worker parses syntax-error file', async () => {
    // Arrange
    const payload = { filePath: syntaxErrorFileAbs };
    // Act
    const data = await runDistWorkerOnce(workerOutAbs, payload);

    // Assert
    expect(data.ok).toBe(true);
    expect((data as ParseWorkerResponseOk).filePath).toBe(syntaxErrorFileAbs);
    expect(Array.isArray((data as ParseWorkerResponseOk).errors)).toBe(true);
    expect((data as ParseWorkerResponseOk).errors.length).toBeGreaterThan(0);
  }, 60_000);

  test('should return ok=false when dist worker receives payload as string', async () => {
    // Arrange
    const payload = 'not-an-object-payload';
    // Act
    const data = await runDistWorkerOnce(workerOutAbs, payload);

    // Assert
    expect(data.ok).toBe(false);
    expect((data as ParseWorkerResponseFail).error.toLowerCase()).toContain('invalid');
  }, 60_000);

  test('should return ok=false when dist worker receives payload missing filePath', async () => {
    // Arrange
    const payload = {};
    // Act
    const data = await runDistWorkerOnce(workerOutAbs, payload);

    // Assert
    expect(data.ok).toBe(false);
    expect((data as ParseWorkerResponseFail).error.toLowerCase()).toContain('invalid');
  }, 60_000);

  test('should return ok=false when dist worker receives filePath number', async () => {
    // Arrange
    const payload = { filePath: 123 as any };
    // Act
    const data = await runDistWorkerOnce(workerOutAbs, payload);

    // Assert
    expect(data.ok).toBe(false);
    expect((data as ParseWorkerResponseFail).error.toLowerCase()).toContain('invalid');
  }, 60_000);

  test('should return ok=false when dist worker receives non-existent filePath', async () => {
    // Arrange
    const payload = { filePath: missingFileAbs };
    // Act
    const data = await runDistWorkerOnce(workerOutAbs, payload);

    // Assert
    expect(data.ok).toBe(false);
    expect((data as ParseWorkerResponseFail).error.toLowerCase()).toMatch(/enoent|no such/);
  }, 60_000);

  test('should return ok=true when dist worker parses the same file repeatedly (1)', async () => {
    // Arrange
    const payload = { filePath: validFileAbs };
    // Act
    const data = await runDistWorkerOnce(workerOutAbs, payload);

    // Assert
    expect(data.ok).toBe(true);
  }, 60_000);

  test('should return ok=true when dist worker parses the same file repeatedly (2)', async () => {
    // Arrange
    const payload = { filePath: validFileAbs };
    // Act
    const data = await runDistWorkerOnce(workerOutAbs, payload);

    // Assert
    expect(data.ok).toBe(true);
  }, 60_000);

  test('should return ok=true when dist worker parses the same file repeatedly (3)', async () => {
    // Arrange
    const payload = { filePath: validFileAbs };
    // Act
    const data = await runDistWorkerOnce(workerOutAbs, payload);

    // Assert
    expect(data.ok).toBe(true);
  }, 60_000);

  test('should return ok=true when dist worker parses the same file repeatedly (4)', async () => {
    // Arrange
    const payload = { filePath: validFileAbs };
    // Act
    const data = await runDistWorkerOnce(workerOutAbs, payload);

    // Assert
    expect(data.ok).toBe(true);
  }, 60_000);

  test('should return ok=true when dist worker parses the same file repeatedly (5)', async () => {
    // Arrange
    const payload = { filePath: validFileAbs };
    // Act
    const data = await runDistWorkerOnce(workerOutAbs, payload);

    // Assert
    expect(data.ok).toBe(true);
  }, 60_000);

  test('should return ok=true when dist worker parses the same file concurrently (10 workers)', async () => {
    // Arrange
    const p1 = { filePath: validFileAbs };
    const p2 = { filePath: validFileAbs };
    const p3 = { filePath: validFileAbs };
    const p4 = { filePath: validFileAbs };
    const p5 = { filePath: validFileAbs };
    const p6 = { filePath: validFileAbs };
    const p7 = { filePath: validFileAbs };
    const p8 = { filePath: validFileAbs };
    const p9 = { filePath: validFileAbs };
    const p10 = { filePath: validFileAbs };
    // Act
    const results = await Promise.all([
      runDistWorkerOnce(workerOutAbs, p1),
      runDistWorkerOnce(workerOutAbs, p2),
      runDistWorkerOnce(workerOutAbs, p3),
      runDistWorkerOnce(workerOutAbs, p4),
      runDistWorkerOnce(workerOutAbs, p5),
      runDistWorkerOnce(workerOutAbs, p6),
      runDistWorkerOnce(workerOutAbs, p7),
      runDistWorkerOnce(workerOutAbs, p8),
      runDistWorkerOnce(workerOutAbs, p9),
      runDistWorkerOnce(workerOutAbs, p10),
    ]);

    // Assert
    expect(results[0]?.ok).toBe(true);
    expect(results[1]?.ok).toBe(true);
    expect(results[2]?.ok).toBe(true);
    expect(results[3]?.ok).toBe(true);
    expect(results[4]?.ok).toBe(true);
    expect(results[5]?.ok).toBe(true);
    expect(results[6]?.ok).toBe(true);
    expect(results[7]?.ok).toBe(true);
    expect(results[8]?.ok).toBe(true);
    expect(results[9]?.ok).toBe(true);
  }, 60_000);
});
