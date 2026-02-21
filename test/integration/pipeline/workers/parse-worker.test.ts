import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

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

const runWorkerOnce = async (payload: unknown, timeoutMs = 5_000): Promise<ParseWorkerResponse> => {
  const worker = new Worker(new URL('../../../../src/workers/parse-worker.ts', import.meta.url), { type: 'module' });

  try {
    return await new Promise<ParseWorkerResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      worker.onmessage = (event: MessageEvent) => {
        const data = event.data as Record<string, unknown> | null;

        if (data && typeof data === 'object' && data.type === 'ready') {
          return;
        }

        clearTimeout(timer);
        resolve(event.data as ParseWorkerResponse);
      };

      worker.onerror = (event: ErrorEvent) => {
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
let emptyFileAbs = '';
let whitespaceFileAbs = '';
let validSimpleFileAbs = '';
let validUtf8FileAbs = '';
let syntaxErrorFileAbs = '';
let missingFileAbs = '';
let dirAsFileAbs = '';

beforeAll(async () => {
  tmpRootAbs = await mkdtemp(path.join(os.tmpdir(), 'firebat-worker-test-'));
  fixturesAbs = path.join(tmpRootAbs, 'fixtures');

  await mkdir(fixturesAbs, { recursive: true });

  emptyFileAbs = path.join(fixturesAbs, 'empty.ts');
  whitespaceFileAbs = path.join(fixturesAbs, 'whitespace.ts');
  validSimpleFileAbs = path.join(fixturesAbs, 'valid-simple.ts');
  validUtf8FileAbs = path.join(fixturesAbs, 'valid-utf8.ts');
  syntaxErrorFileAbs = path.join(fixturesAbs, 'syntax-error.ts');
  missingFileAbs = path.join(fixturesAbs, 'does-not-exist.ts');
  dirAsFileAbs = path.join(fixturesAbs, 'as-dir');

  await Bun.write(emptyFileAbs, '');
  await Bun.write(whitespaceFileAbs, '   \n\n');
  await Bun.write(validSimpleFileAbs, 'export const x = 1;\n');
  await Bun.write(validUtf8FileAbs, 'export const greeting = "안녕";\n');
  await Bun.write(syntaxErrorFileAbs, 'export const = 123\n');
  await mkdir(dirAsFileAbs, { recursive: true });
}, 30_000);

afterAll(async () => {
  if (!tmpRootAbs) {
    return;
  }

  await rm(tmpRootAbs, { recursive: true, force: true });
});

describe('parse-worker (integration)', () => {
  test('should return ok=false when payload is undefined', async () => {
    // Arrange
    const payload = undefined;
    // Act
    const result = await runWorkerOnce(payload);

    // Assert
    expect(result.ok).toBe(false);
    expect((result as ParseWorkerResponseFail).error.toLowerCase()).toContain('invalid');
  });

  test('should return ok=false when payload is null', async () => {
    // Arrange
    const payload = null;
    // Act
    const result = await runWorkerOnce(payload);

    // Assert
    expect(result.ok).toBe(false);
    expect((result as ParseWorkerResponseFail).error.toLowerCase()).toContain('invalid');
  });

  test('should return ok=false when payload is a number', async () => {
    // Arrange
    const payload = 123;
    // Act
    const result = await runWorkerOnce(payload);

    // Assert
    expect(result.ok).toBe(false);
    expect((result as ParseWorkerResponseFail).error.toLowerCase()).toContain('invalid');
  });

  test('should return ok=false when payload is a boolean', async () => {
    // Arrange
    const payload = true;
    // Act
    const result = await runWorkerOnce(payload);

    // Assert
    expect(result.ok).toBe(false);
    expect((result as ParseWorkerResponseFail).error.toLowerCase()).toContain('invalid');
  });

  test('should return ok=false when payload is a string', async () => {
    // Arrange
    const payload = 'not-an-object-payload';
    // Act
    const result = await runWorkerOnce(payload);

    // Assert
    expect(result.ok).toBe(false);
    expect((result as ParseWorkerResponseFail).error.toLowerCase()).toContain('invalid');
  });

  test('should return ok=false when payload is an empty object', async () => {
    // Arrange
    const payload = {};
    // Act
    const result = await runWorkerOnce(payload);

    // Assert
    expect(result.ok).toBe(false);
    expect((result as ParseWorkerResponseFail).error.toLowerCase()).toContain('invalid');
  });

  test('should return ok=false when payload has filePath empty string', async () => {
    // Arrange
    const payload = { filePath: '' };
    // Act
    const result = await runWorkerOnce(payload);

    // Assert
    expect(result.ok).toBe(false);
    expect((result as ParseWorkerResponseFail).error.toLowerCase()).toContain('invalid');
  });

  test('should return ok=false when payload has filePath whitespace-only', async () => {
    // Arrange
    const payload = { filePath: '   ' };
    // Act
    const result = await runWorkerOnce(payload);

    // Assert
    expect(result.ok).toBe(false);
    expect((result as ParseWorkerResponseFail).error.toLowerCase()).toContain('invalid');
  });

  test('should return ok=false when payload has filePath number', async () => {
    // Arrange
    const payload = { filePath: 123 as any };
    // Act
    const result = await runWorkerOnce(payload);

    // Assert
    expect(result.ok).toBe(false);
    expect((result as ParseWorkerResponseFail).error.toLowerCase()).toContain('invalid');
  });

  test('should return ok=false when payload has filePath null', async () => {
    // Arrange
    const payload = { filePath: null as any };
    // Act
    const result = await runWorkerOnce(payload);

    // Assert
    expect(result.ok).toBe(false);
    expect((result as ParseWorkerResponseFail).error.toLowerCase()).toContain('invalid');
  });

  test('should return ok=false when payload has wrong key name', async () => {
    // Arrange
    const payload = { notFilePath: validSimpleFileAbs };
    // Act
    const result = await runWorkerOnce(payload);

    // Assert
    expect(result.ok).toBe(false);
    expect((result as ParseWorkerResponseFail).error.toLowerCase()).toContain('invalid');
  });

  test('should return ok=true when filePath points to an empty file', async () => {
    // Arrange
    const payload = { filePath: emptyFileAbs };
    // Act
    const result = await runWorkerOnce(payload);

    // Assert
    expect(result.ok).toBe(true);
    expect((result as ParseWorkerResponseOk).filePath).toBe(emptyFileAbs);
    expect((result as ParseWorkerResponseOk).sourceText).toBe('');
    expect(Array.isArray((result as ParseWorkerResponseOk).errors)).toBe(true);
  });

  test('should return ok=true when filePath points to a whitespace-only file', async () => {
    // Arrange
    const payload = { filePath: whitespaceFileAbs };
    // Act
    const result = await runWorkerOnce(payload);

    // Assert
    expect(result.ok).toBe(true);
    expect((result as ParseWorkerResponseOk).filePath).toBe(whitespaceFileAbs);
    expect((result as ParseWorkerResponseOk).sourceText).toBe('   \n\n');
    expect(Array.isArray((result as ParseWorkerResponseOk).errors)).toBe(true);
  });

  test('should return ok=true when filePath points to a valid TypeScript file', async () => {
    // Arrange
    const payload = { filePath: validSimpleFileAbs };
    // Act
    const result = await runWorkerOnce(payload);

    // Assert
    expect(result.ok).toBe(true);
    expect((result as ParseWorkerResponseOk).filePath).toBe(validSimpleFileAbs);
    expect((result as ParseWorkerResponseOk).sourceText).toBe('export const x = 1;\n');
    expect(Array.isArray((result as ParseWorkerResponseOk).errors)).toBe(true);
  });

  test('should return ok=true when parsing the same valid file repeatedly (1)', async () => {
    // Arrange
    const payload = { filePath: validSimpleFileAbs };
    // Act
    const result = await runWorkerOnce(payload);

    // Assert
    expect(result.ok).toBe(true);
  });

  test('should return ok=true when parsing the same valid file repeatedly (2)', async () => {
    // Arrange
    const payload = { filePath: validSimpleFileAbs };
    // Act
    const result = await runWorkerOnce(payload);

    // Assert
    expect(result.ok).toBe(true);
  });

  test('should return ok=true when parsing the same valid file repeatedly (3)', async () => {
    // Arrange
    const payload = { filePath: validSimpleFileAbs };
    // Act
    const result = await runWorkerOnce(payload);

    // Assert
    expect(result.ok).toBe(true);
  });

  test('should return ok=true when parsing the same valid file repeatedly (4)', async () => {
    // Arrange
    const payload = { filePath: validSimpleFileAbs };
    // Act
    const result = await runWorkerOnce(payload);

    // Assert
    expect(result.ok).toBe(true);
  });

  test('should return ok=true when parsing the same valid file repeatedly (5)', async () => {
    // Arrange
    const payload = { filePath: validSimpleFileAbs };
    // Act
    const result = await runWorkerOnce(payload);

    // Assert
    expect(result.ok).toBe(true);
  });

  test('should return ok=true when parsing the same valid file concurrently (10 workers)', async () => {
    // Arrange
    const p1 = { filePath: validSimpleFileAbs };
    const p2 = { filePath: validSimpleFileAbs };
    const p3 = { filePath: validSimpleFileAbs };
    const p4 = { filePath: validSimpleFileAbs };
    const p5 = { filePath: validSimpleFileAbs };
    const p6 = { filePath: validSimpleFileAbs };
    const p7 = { filePath: validSimpleFileAbs };
    const p8 = { filePath: validSimpleFileAbs };
    const p9 = { filePath: validSimpleFileAbs };
    const p10 = { filePath: validSimpleFileAbs };
    // Act
    const results = await Promise.all([
      runWorkerOnce(p1),
      runWorkerOnce(p2),
      runWorkerOnce(p3),
      runWorkerOnce(p4),
      runWorkerOnce(p5),
      runWorkerOnce(p6),
      runWorkerOnce(p7),
      runWorkerOnce(p8),
      runWorkerOnce(p9),
      runWorkerOnce(p10),
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
  });

  test('should return ok=true when filePath contains UTF-8 source text', async () => {
    // Arrange
    const payload = { filePath: validUtf8FileAbs };
    // Act
    const result = await runWorkerOnce(payload);

    // Assert
    expect(result.ok).toBe(true);
    expect((result as ParseWorkerResponseOk).filePath).toBe(validUtf8FileAbs);
    expect((result as ParseWorkerResponseOk).sourceText).toContain('안녕');
    expect(Array.isArray((result as ParseWorkerResponseOk).errors)).toBe(true);
  });

  test('should return ok=true and include parse errors when source has syntax errors', async () => {
    // Arrange
    const payload = { filePath: syntaxErrorFileAbs };
    // Act
    const result = await runWorkerOnce(payload);

    // Assert
    expect(result.ok).toBe(true);
    expect((result as ParseWorkerResponseOk).filePath).toBe(syntaxErrorFileAbs);
    expect(Array.isArray((result as ParseWorkerResponseOk).errors)).toBe(true);
    expect((result as ParseWorkerResponseOk).errors.length).toBeGreaterThan(0);
  });

  test('should return ok=false when filePath points to a non-existent file', async () => {
    // Arrange
    const payload = { filePath: missingFileAbs };
    // Act
    const result = await runWorkerOnce(payload);

    // Assert
    expect(result.ok).toBe(false);
    expect(typeof (result as ParseWorkerResponseFail).error).toBe('string');
    expect((result as ParseWorkerResponseFail).error.toLowerCase()).toMatch(/enoent|no such/);
  });

  test('should return ok=false when filePath points to a directory', async () => {
    // Arrange
    const payload = { filePath: dirAsFileAbs };
    // Act
    const result = await runWorkerOnce(payload);

    // Assert
    expect(result.ok).toBe(false);
    expect(typeof (result as ParseWorkerResponseFail).error).toBe('string');
    expect((result as ParseWorkerResponseFail).error.length).toBeGreaterThan(0);
  });
});
