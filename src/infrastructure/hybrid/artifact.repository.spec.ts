import { describe, it, expect, spyOn } from 'bun:test';
import { createHybridArtifactRepository } from './artifact.repository';
import type { ArtifactRepository } from '../../ports/artifact.repository';

const makeMemoryRepo = (): ArtifactRepository => {
  const store = new Map<string, unknown>();
  return {
    async getArtifact<T>(args: { artifactKey: string }): Promise<T | null> {
      return (store.get(args.artifactKey) as T | undefined) ?? null;
    },
    async setArtifact<T>(args: { artifactKey: string; value: T }): Promise<void> {
      store.set(args.artifactKey, args.value);
    },
  };
};

const BASE_ARGS = {
  projectKey: 'proj',
  kind: 'analysis',
  artifactKey: 'key1',
  inputsDigest: 'digest',
};

describe('createHybridArtifactRepository', () => {
  it('should return memory value and not call sqlite.getArtifact when memory hits', async () => {
    // Arrange
    const memory = makeMemoryRepo();
    const sqlite = makeMemoryRepo();
    await memory.setArtifact({ ...BASE_ARGS, value: { data: 'cached' } });
    const repo = createHybridArtifactRepository({ memory, sqlite });
    const spyGet = spyOn(sqlite, 'getArtifact');

    // Act
    const result = await repo.getArtifact(BASE_ARGS);

    // Assert
    expect(result).toEqual({ data: 'cached' });
    expect(spyGet).not.toHaveBeenCalled();
  });

  it('should return sqlite value when memory misses and sqlite hits', async () => {
    // Arrange
    const memory = makeMemoryRepo();
    const sqlite = makeMemoryRepo();
    await sqlite.setArtifact({ ...BASE_ARGS, value: { data: 'from-sqlite' } });
    const repo = createHybridArtifactRepository({ memory, sqlite });

    // Act
    const result = await repo.getArtifact(BASE_ARGS);

    // Assert
    expect(result).toEqual({ data: 'from-sqlite' });
  });

  it('should call memory.setArtifact to cache sqlite value on memory miss', async () => {
    // Arrange
    const memory = makeMemoryRepo();
    const sqlite = makeMemoryRepo();
    await sqlite.setArtifact({ ...BASE_ARGS, value: 'sqlite-value' });
    const repo = createHybridArtifactRepository({ memory, sqlite });
    const spySet = spyOn(memory, 'setArtifact');

    // Act
    await repo.getArtifact(BASE_ARGS);

    // Assert
    expect(spySet).toHaveBeenCalledTimes(1);
    expect(spySet).toHaveBeenCalledWith(expect.objectContaining({ value: 'sqlite-value' }));
  });

  it('should call both memory.setArtifact and sqlite.setArtifact when setArtifact is called', async () => {
    // Arrange
    const memory = makeMemoryRepo();
    const sqlite = makeMemoryRepo();
    const repo = createHybridArtifactRepository({ memory, sqlite });
    const spyMemSet = spyOn(memory, 'setArtifact');
    const spySqlSet = spyOn(sqlite, 'setArtifact');

    // Act
    await repo.setArtifact({ ...BASE_ARGS, value: 42 });

    // Assert
    expect(spyMemSet).toHaveBeenCalledTimes(1);
    expect(spySqlSet).toHaveBeenCalledTimes(1);
  });

  it('should return null when both memory and sqlite miss', async () => {
    // Arrange
    const memory = makeMemoryRepo();
    const sqlite = makeMemoryRepo();
    const repo = createHybridArtifactRepository({ memory, sqlite });

    // Act
    const result = await repo.getArtifact(BASE_ARGS);

    // Assert
    expect(result).toBeNull();
  });

  it('should return from memory on second call after sqlite populated cache', async () => {
    // Arrange
    const memory = makeMemoryRepo();
    const sqlite = makeMemoryRepo();
    await sqlite.setArtifact({ ...BASE_ARGS, value: 'val' });
    const repo = createHybridArtifactRepository({ memory, sqlite });
    await repo.getArtifact(BASE_ARGS); // first: memory miss, sqlite hit, caches

    const spySqlGet = spyOn(sqlite, 'getArtifact');

    // Act
    const result = await repo.getArtifact(BASE_ARGS); // second: memory hit

    // Assert
    expect(result).toBe('val');
    expect(spySqlGet).not.toHaveBeenCalled();
  });
});
