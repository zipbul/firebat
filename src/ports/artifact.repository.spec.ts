import { describe, it, expect } from 'bun:test';

import type { ArtifactRepository, GetArtifactInput, SetArtifactInput } from './artifact.repository';

describe('ArtifactRepository (in-memory implementation)', () => {
  // Implement a simple in-memory version to test the interface contract
  const store = new Map<string, unknown>();

  const repo: ArtifactRepository = {
    async getArtifact<T>(input: GetArtifactInput): Promise<T | null> {
      const key = `${input.projectKey}:${input.kind}:${input.artifactKey}:${input.inputsDigest}`;
      return (store.get(key) as T) ?? null;
    },
    async setArtifact<T>(input: SetArtifactInput<T>): Promise<void> {
      const key = `${input.projectKey}:${input.kind}:${input.artifactKey}:${input.inputsDigest}`;
      store.set(key, input.value);
    },
  };

  it('[HP] getArtifact returns null for unknown key', async () => {
    const result = await repo.getArtifact({
      projectKey: 'p',
      kind: 'scan',
      artifactKey: 'k',
      inputsDigest: 'd',
    });
    expect(result).toBeNull();
  });

  it('[HP] setArtifact then getArtifact returns stored value', async () => {
    const input = { projectKey: 'p2', kind: 'scan', artifactKey: 'k2', inputsDigest: 'd2' };
    await repo.setArtifact({ ...input, value: { result: 42 } });
    const retrieved = await repo.getArtifact<{ result: number }>(input);
    expect(retrieved?.result).toBe(42);
  });

  it('[HP] different inputsDigest produces cache miss', async () => {
    await repo.setArtifact({ projectKey: 'p3', kind: 'scan', artifactKey: 'k3', inputsDigest: 'd3', value: 'x' });
    const result = await repo.getArtifact({ projectKey: 'p3', kind: 'scan', artifactKey: 'k3', inputsDigest: 'OTHER' });
    expect(result).toBeNull();
  });
});
