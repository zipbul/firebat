import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { runInstall, runUpdate } from '../../../src/adapters/cli/install';
import { createPrettyConsoleLogger } from '../../../src/infrastructure/logging/pretty-console-logger';

const testLogger = createPrettyConsoleLogger({ level: 'error', includeStack: false });

const sha256Hex = (text: string): string => {
  return createHash('sha256').update(text).digest('hex');
};

const cloneJson = <T>(value: T): T => {
  return structuredClone(value);
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === 'object' && !Array.isArray(value);
};

const jsonText = (value: unknown): string => {
  return JSON.stringify(value, null, 2) + '\n';
};

const withCapturedConsole = async <T>(fn: () => Promise<T>): Promise<{ result: T; logs: string[]; errors: string[] }> => {
  const originalLog = console.log;
  const originalError = console.error;
  const logs: string[] = [];
  const errors: string[] = [];

  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  };

  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  };

  try {
    const result = await fn();

    return { result, logs, errors };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
};

const createTmpProjectRoot = async (): Promise<string> => {
  const tmpRootAbs = await mkdtemp(path.join(os.tmpdir(), 'firebat-install-update-root-'));

  await mkdir(path.join(tmpRootAbs, '.firebat'), { recursive: true });
  await writeFile(
    path.join(tmpRootAbs, 'package.json'),
    JSON.stringify({ name: 'firebat-install-update-fixture', private: true, devDependencies: { firebat: '0.0.0' } }, null, 2) +
      '\n',
    'utf8',
  );

  return tmpRootAbs;
};

const readJsonFile = async (filePath: string): Promise<unknown> => {
  const text = await Bun.file(filePath).text();

  return Bun.JSONC.parse(text) as unknown;
};

const writeJsonFile = async (filePath: string, value: unknown): Promise<void> => {
  await Bun.write(filePath, jsonText(value));
};

const findFirstKey = (value: unknown): string => {
  if (!isRecord(value)) {
    throw new Error('Expected record');
  }

  const keys = Object.keys(value);

  if (keys.length === 0) {
    throw new Error('Expected at least one key');
  }

  const first = keys[0];

  if (first === undefined) {
    throw new Error('Expected first key');
  }

  return first;
};

type Primitive = string | number | boolean | null;

const findFirstPrimitivePath = (value: unknown): { path: string[]; value: Primitive } | null => {
  const visit = (node: unknown, prefix: string[]): { path: string[]; value: Primitive } | null => {
    if (node === null || typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
      return { path: prefix, value: node };
    }

    if (Array.isArray(node)) {
      return null;
    }

    if (isRecord(node)) {
      for (const [key, child] of Object.entries(node)) {
        const found = visit(child, [...prefix, key]);

        if (found) {
          return found;
        }
      }
    }

    return null;
  };

  return visit(value, []);
};

const setAtPath = (root: unknown, pathItems: readonly string[], nextValue: unknown): void => {
  if (!isRecord(root)) {
    throw new Error('Expected root record');
  }

  let cursor: Record<string, unknown> = root;

  for (let i = 0; i < pathItems.length; i += 1) {
    const key = pathItems[i];

    if (key === undefined) {
      throw new Error('Expected key');
    }

    const isLast = i === pathItems.length - 1;

    if (isLast) {
      cursor[key] = nextValue;

      return;
    }

    const current = cursor[key];

    if (isRecord(current)) {
      cursor = current;

      continue;
    }

    const fresh: Record<string, unknown> = {};

    cursor[key] = fresh;
    cursor = fresh;
  }
};

test('should abort update when no install manifest exists', async () => {
  // Arrange
  const tmpRootAbs = await createTmpProjectRoot();
  const originalCwd = process.cwd();

  try {
    process.chdir(tmpRootAbs);

    // Act
    const { result, errors } = await withCapturedConsole(async () => {
      return await runUpdate([], testLogger);
    });

    // Assert
    expect(result).toBe(1);
    expect(errors.join('\n')).toContain('Run `firebat install` first');
  } finally {
    process.chdir(originalCwd);
    await rm(tmpRootAbs, { recursive: true, force: true });
  }
});

test('should apply template changes when user matches base', async () => {
  // Arrange
  const tmpRootAbs = await createTmpProjectRoot();
  const originalCwd = process.cwd();

  try {
    process.chdir(tmpRootAbs);

    const installResult = await withCapturedConsole(async () => {
      return await runInstall([], testLogger);
    });

    expect(installResult.result).toBe(0);

    const manifestPath = path.join(tmpRootAbs, '.firebat', 'install-manifest.json');
    const manifest = (await readJsonFile(manifestPath)) as any;
    const templatePath = path.resolve(import.meta.dir, '../../../assets/.firebatrc.jsonc');
    const templateText = await Bun.file(templatePath).text();
    const templateParsed = Bun.JSONC.parse(templateText);
    const keyToRemove = findFirstKey(templateParsed);
    const baseParsed = cloneJson(templateParsed) as any;

    delete baseParsed[keyToRemove];

    const userParsed = cloneJson(baseParsed);
    const baseText = jsonText(baseParsed);
    const baseSha = sha256Hex(baseText);
    const baseSnapshotPath = path.join(tmpRootAbs, '.firebat', 'install-bases', `.firebatrc.jsonc.${baseSha}.json`);

    await mkdir(path.dirname(baseSnapshotPath), { recursive: true });
    await Bun.write(baseSnapshotPath, baseText);

    manifest.baseSnapshots['.firebatrc.jsonc'] = { sha256: baseSha, filePath: baseSnapshotPath };

    await Bun.write(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

    const rcPath = path.join(tmpRootAbs, '.firebatrc.jsonc');

    await writeJsonFile(rcPath, userParsed);

    // Act
    const updateResult = await withCapturedConsole(async () => {
      return await runUpdate([], testLogger);
    });

    // Assert
    expect(updateResult.result).toBe(0);

    const updated = await readJsonFile(rcPath);

    expect(updated).toEqual(templateParsed);
  } finally {
    process.chdir(originalCwd);
    await rm(tmpRootAbs, { recursive: true, force: true });
  }
});

test('should not overwrite user-edited existing keys', async () => {
  // Arrange
  const tmpRootAbs = await createTmpProjectRoot();
  const originalCwd = process.cwd();

  try {
    process.chdir(tmpRootAbs);

    const installResult = await withCapturedConsole(async () => {
      return await runInstall([], testLogger);
    });

    expect(installResult.result).toBe(0);

    const manifestPath = path.join(tmpRootAbs, '.firebat', 'install-manifest.json');
    const manifestBeforeText = await Bun.file(manifestPath).text();
    const manifest = JSON.parse(manifestBeforeText) as any;
    const templatePath = path.resolve(import.meta.dir, '../../../assets/.firebatrc.jsonc');
    const templateText = await Bun.file(templatePath).text();
    const templateParsed = Bun.JSONC.parse(templateText);
    const leaf = findFirstPrimitivePath(templateParsed);

    if (!leaf) {
      throw new Error('Expected at least one primitive path in template');
    }

    const baseParsed = cloneJson(templateParsed);
    const userParsed = cloneJson(templateParsed);

    // Ensure base snapshot differs (so update still has a base file to satisfy manifest requirements).
    setAtPath(baseParsed, leaf.path, 'BASE');
    // User edits an existing key; update must not overwrite it.
    setAtPath(userParsed, leaf.path, 'USER');

    const baseText = jsonText(baseParsed);
    const baseSha = sha256Hex(baseText);
    const baseSnapshotPath = path.join(tmpRootAbs, '.firebat', 'install-bases', `.firebatrc.jsonc.${baseSha}.json`);

    await mkdir(path.dirname(baseSnapshotPath), { recursive: true });
    await Bun.write(baseSnapshotPath, baseText);

    manifest.baseSnapshots['.firebatrc.jsonc'] = { sha256: baseSha, filePath: baseSnapshotPath };

    await Bun.write(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

    const rcPath = path.join(tmpRootAbs, '.firebatrc.jsonc');
    // Keep JSONC with a comment that must survive update (no rewrite when no keyset changes).
    const userRcText = `// user comment\n${jsonText(userParsed)}`;

    await Bun.write(rcPath, userRcText);

    const beforeRcText = await Bun.file(rcPath).text();
    // Act
    const updateResult = await withCapturedConsole(async () => {
      return await runUpdate([], testLogger);
    });

    // Assert
    expect(updateResult.result).toBe(0);

    const afterRcText = await Bun.file(rcPath).text();

    // No key additions/removals => file should not be rewritten (comments preserved).
    expect(afterRcText).toBe(beforeRcText);

    const afterParsed = Bun.JSONC.parse(afterRcText) as any;
    // User value should remain.
    const afterLeaf = findFirstPrimitivePath(afterParsed);

    expect(afterLeaf?.value).toBe('USER');
  } finally {
    process.chdir(originalCwd);
    await rm(tmpRootAbs, { recursive: true, force: true });
  }
});

test('should delete keys missing from template even if user added them', async () => {
  // Arrange
  const tmpRootAbs = await createTmpProjectRoot();
  const originalCwd = process.cwd();

  try {
    process.chdir(tmpRootAbs);

    const installResult = await withCapturedConsole(async () => {
      return await runInstall([], testLogger);
    });

    expect(installResult.result).toBe(0);

    const rcPath = path.join(tmpRootAbs, '.firebatrc.jsonc');
    const rcText = await Bun.file(rcPath).text();
    const parsed = Bun.JSONC.parse(rcText) as any;

    // Inject extra keys (root + nested) that are not present in the template.
    parsed.__extraRootKey = 123;

    if (parsed.features && typeof parsed.features === 'object') {
      parsed.features.__extraFeatureKey = true;
    }

    await Bun.write(rcPath, `// keep me\n${jsonText(parsed)}`);

    // Act
    const updateResult = await withCapturedConsole(async () => {
      return await runUpdate([], testLogger);
    });

    // Assert
    expect(updateResult.result).toBe(0);

    const afterText = await Bun.file(rcPath).text();
    const after = Bun.JSONC.parse(afterText) as any;

    expect(after.__extraRootKey).toBeUndefined();
    expect(after.features?.__extraFeatureKey).toBeUndefined();
    // Unrelated comment should remain unless update had to rewrite.
    expect(afterText).toContain('// keep me');
  } finally {
    process.chdir(originalCwd);
    await rm(tmpRootAbs, { recursive: true, force: true });
  }
});

test('should not rewrite .oxfmtrc.jsonc when keyset is unchanged (comments preserved)', async () => {
  // Arrange
  const tmpRootAbs = await createTmpProjectRoot();
  const originalCwd = process.cwd();

  try {
    process.chdir(tmpRootAbs);

    const installResult = await withCapturedConsole(async () => {
      return await runInstall([], testLogger);
    });

    expect(installResult.result).toBe(0);

    const templatePath = path.resolve(import.meta.dir, '../../../assets/.oxfmtrc.jsonc');
    const templateText = await Bun.file(templatePath).text();
    const templateParsed = Bun.JSONC.parse(templateText) as any;
    const cfgPath = path.join(tmpRootAbs, '.oxfmtrc.jsonc');
    const userText = `// keep me\n${jsonText(templateParsed)}`;

    await Bun.write(cfgPath, userText);

    const before = await Bun.file(cfgPath).text();
    // Act
    const updateResult = await withCapturedConsole(async () => {
      return await runUpdate([], testLogger);
    });

    // Assert
    expect(updateResult.result).toBe(0);

    const after = await Bun.file(cfgPath).text();

    expect(after).toBe(before);
    expect(after).toContain('// keep me');
  } finally {
    process.chdir(originalCwd);
    await rm(tmpRootAbs, { recursive: true, force: true });
  }
});

test('should delete keys missing from template in .oxlintrc.jsonc', async () => {
  // Arrange
  const tmpRootAbs = await createTmpProjectRoot();
  const originalCwd = process.cwd();

  try {
    process.chdir(tmpRootAbs);

    const installResult = await withCapturedConsole(async () => {
      return await runInstall([], testLogger);
    });

    expect(installResult.result).toBe(0);

    const cfgPath = path.join(tmpRootAbs, '.oxlintrc.jsonc');
    const beforeText = await Bun.file(cfgPath).text();
    const parsed = Bun.JSONC.parse(beforeText) as any;

    parsed.__extraRootKey = 123;

    await Bun.write(cfgPath, `// keep me\n${jsonText(parsed)}`);

    // Act
    const updateResult = await withCapturedConsole(async () => {
      return await runUpdate([], testLogger);
    });

    // Assert
    expect(updateResult.result).toBe(0);

    const afterText = await Bun.file(cfgPath).text();
    const after = Bun.JSONC.parse(afterText) as any;

    expect(after.__extraRootKey).toBeUndefined();
    expect(afterText).toContain('// keep me');
  } finally {
    process.chdir(originalCwd);
    await rm(tmpRootAbs, { recursive: true, force: true });
  }
});

test('should abort update when config parsing fails', async () => {
  // Arrange
  const tmpRootAbs = await createTmpProjectRoot();
  const originalCwd = process.cwd();

  try {
    process.chdir(tmpRootAbs);

    const installResult = await withCapturedConsole(async () => {
      return await runInstall([], testLogger);
    });

    expect(installResult.result).toBe(0);

    const rcPath = path.join(tmpRootAbs, '.firebatrc.jsonc');

    await Bun.write(rcPath, '{');

    // Act
    const updateResult = await withCapturedConsole(async () => {
      return await runUpdate([], testLogger);
    });

    // Assert
    expect(updateResult.result).toBe(1);

    const afterText = await Bun.file(rcPath).text();

    expect(afterText).toBe('{');
  } finally {
    process.chdir(originalCwd);
    await rm(tmpRootAbs, { recursive: true, force: true });
  }
});
