import { describe, expect, it, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { expandTargets, resolveTargets } from './target-discovery';

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
    const relResults = result.map(p => path.relative(tmpDir, p));

    expect(relResults).toContain('app.ts');
    expect(relResults).toContain('util.ts');
    expect(relResults).not.toContain(path.join('__fixtures__', 'fixture.ts'));
  });

  it('resolveTargets - no exclude - returns all files', async () => {
    // Arrange
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'firebat-test-'));

    const fixturesDir = path.join(tmpDir, '__fixtures__');

    await fs.mkdir(fixturesDir, { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'app.ts'), '');
    await fs.writeFile(path.join(fixturesDir, 'fixture.ts'), '');

    // Act
    const result = await resolveTargets(tmpDir, [tmpDir]);
    // Assert
    const relResults = result.map(p => path.relative(tmpDir, p));

    expect(relResults).toContain('app.ts');
    expect(relResults).toContain(path.join('__fixtures__', 'fixture.ts'));
  });

  it('resolveTargets - empty exclude array - returns all files', async () => {
    // Arrange
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'firebat-test-'));

    const fixturesDir = path.join(tmpDir, '__fixtures__');

    await fs.mkdir(fixturesDir, { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'app.ts'), '');
    await fs.writeFile(path.join(fixturesDir, 'fixture.ts'), '');

    // Act
    const result = await resolveTargets(tmpDir, [tmpDir], []);
    // Assert
    const relResults = result.map(p => path.relative(tmpDir, p));

    expect(relResults).toContain('app.ts');
    expect(relResults).toContain(path.join('__fixtures__', 'fixture.ts'));
  });
});
