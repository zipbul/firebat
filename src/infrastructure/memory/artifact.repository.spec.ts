import { describe, it, expect } from 'bun:test';

import { createInMemoryArtifactRepository } from './artifact.repository';

describe('createInMemoryArtifactRepository', () => {
  it('[HP] getArtifact returns null for unknown key', async () => {
    const repo = createInMemoryArtifactRepository();
    const result = await repo.getArtifact({
      projectKey: 'p',
      kind: 'scan',
      artifactKey: 'k',
      inputsDigest: 'd',
    });
    expect(result).toBeNull();
  });

  it('[HP] setArtifact then getArtifact returns stored value', async () => {
    const repo = createInMemoryArtifactRepository();
    const input = { projectKey: 'p', kind: 'scan', artifactKey: 'k', inputsDigest: 'd' };
    await repo.setArtifact({ ...input, value: { count: 7 } });
    const result = await repo.getArtifact<{ count: number }>(input);
    expect(result?.count).toBe(7);
  });

  it('[HP] different inputsDigest is a cache miss', async () => {
    const repo = createInMemoryArtifactRepository();
    const input = { projectKey: 'p', kind: 'scan', artifactKey: 'k', inputsDigest: 'd1' };
    await repo.setArtifact({ ...input, value: 'stored' });
    const miss = await repo.getArtifact({ ...input, inputsDigest: 'd2' });
    expect(miss).toBeNull();
  });

  it('[HP] each repo instance has its own store', async () => {
    const repoA = createInMemoryArtifactRepository();
    const repoB = createInMemoryArtifactRepository();
    const input = { projectKey: 'p', kind: 'k', artifactKey: 'a', inputsDigest: 'd' };
    await repoA.setArtifact({ ...input, value: 'a-value' });
    const result = await repoB.getArtifact(input);
    expect(result).toBeNull();
  });

  it('[HP] overwrites existing artifact with latest value', async () => {
    const repo = createInMemoryArtifactRepository();
    const input = { projectKey: 'p', kind: 'k', artifactKey: 'a', inputsDigest: 'd' };
    await repo.setArtifact({ ...input, value: 'first' });
    await repo.setArtifact({ ...input, value: 'second' });
    const result = await repo.getArtifact<string>(input);
    expect(result).toBe('second');
  });
});
