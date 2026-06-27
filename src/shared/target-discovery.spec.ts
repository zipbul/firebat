import { describe, expect, it, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { expandTargets, resolveTargets } from './target-discovery';

/** Map `result` paths relative to `tmpDir`, assert it contains `name`, and return them. */
const relPathsContaining = (result: ReadonlyArray<string>, tmpDir: string, name: string): string[] => {
  const rel = result.map(p => path.relative(tmpDir, p));

  expect(rel).toContain(name);

  return rel;
};

describe('target-discovery', () => {
  it('should expand directory targets into ts files', async () => {
    // Arrange
    let input = ['src'];
    // Act
    let result = await expandTargets(input);

    // Assert
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain(path.resolve('src/firebat.ts'));
  });

  it('should keep explicit .ts file targets', async () => {
    // Arrange
    let target = path.resolve('src/types.ts');
    // Act
    let result = await expandTargets([target]);

    // Assert
    expect(result).toEqual([target]);
  });
});

describe('resolveTargets - exclude', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('resolveTargets - exclude patterns - filters matching files', async () => {
    // Arrange
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'firebat-test-'));

    const fixturesDir = path.join(tmpDir, '__fixtures__');

    await fs.mkdir(fixturesDir, { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'app.ts'), '');
    await fs.writeFile(path.join(tmpDir, 'util.ts'), '');
    await fs.writeFile(path.join(fixturesDir, 'fixture.ts'), '');

    // Act
    const result = await resolveTargets(tmpDir, [tmpDir], ['**/__fixtures__/**']);
    // Assert
    const relResults = relPathsContaining(result, tmpDir, 'app.ts');

    expect(relResults).toContain('util.ts');
    expect(relResults).not.toContain(path.join('__fixtures__', 'fixture.ts'));
  });

  it.each<[string, ReadonlyArray<string> | undefined]>([
    ['exclude arg is omitted', undefined],
    ['exclude is an empty array', []],
  ])('resolveTargets - returns all files when %s', async (_label, exclude) => {
    // Arrange
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'firebat-test-'));

    const fixturesDir = path.join(tmpDir, '__fixtures__');

    await fs.mkdir(fixturesDir, { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'app.ts'), '');
    await fs.writeFile(path.join(fixturesDir, 'fixture.ts'), '');

    // Act
    const result = await resolveTargets(tmpDir, [tmpDir], exclude);
    // Assert
    const relResults = relPathsContaining(result, tmpDir, 'app.ts');

    expect(relResults).toContain(path.join('__fixtures__', 'fixture.ts'));
  });
});
