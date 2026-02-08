import type { ArtifactRepository, GetArtifactInput, SetArtifactInput } from '../../ports/artifact.repository';

interface ArtifactRow {
  readonly payloadJson: string;
}

const keyOf = (input: GetArtifactInput): string => `${input.projectKey}|${input.kind}|${input.artifactKey}|${input.inputsDigest}`;

const createInMemoryArtifactRepository = (): ArtifactRepository => {
  const store = new Map<string, ArtifactRow>();

  return {
    async getArtifact<T>(input: GetArtifactInput): Promise<T | null> {
      const row = store.get(keyOf(input));

      if (!row) {
        return Promise.resolve(null);
      }

      let parsed: T;

      try {
        parsed = JSON.parse(row.payloadJson) as T;
      } catch {
        return Promise.resolve(null);
      }

      return Promise.resolve(parsed);
    },

    async setArtifact<T>(input: SetArtifactInput<T>): Promise<void> {
      store.set(keyOf(input), { payloadJson: JSON.stringify(input.value) });

      return Promise.resolve();
    },
  };
};

export { createInMemoryArtifactRepository };
