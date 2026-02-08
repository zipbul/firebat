import { and, eq } from 'drizzle-orm';

import type { ArtifactRepository, GetArtifactInput, SetArtifactInput } from '../../ports/artifact.repository';
import type { FirebatDrizzleDb } from './drizzle-db';

import { artifacts } from './schema';

interface JsonObject {
  readonly [k: string]: JsonValue;
}

type JsonValue = null | boolean | number | string | ReadonlyArray<JsonValue> | JsonObject;

const createSqliteArtifactRepository = (db: FirebatDrizzleDb): ArtifactRepository => {
  return {
    async getArtifact<T>(input: GetArtifactInput): Promise<T | null> {
      const { projectKey, kind, artifactKey, inputsDigest } = input;
      const row = db
        .select({ payloadJson: artifacts.payloadJson })
        .from(artifacts)
        .where(
          and(
            eq(artifacts.projectKey, projectKey),
            eq(artifacts.kind, kind),
            eq(artifacts.artifactKey, artifactKey),
            eq(artifacts.inputsDigest, inputsDigest),
          ),
        )
        .get();

      if (!row) {
        return Promise.resolve(null);
      }

      let parsed: JsonValue;

      try {
        parsed = JSON.parse(row.payloadJson) as JsonValue;
      } catch {
        return Promise.resolve(null);
      }

      return Promise.resolve(parsed as T);
    },

    async setArtifact<T>(input: SetArtifactInput<T>): Promise<void> {
      const { projectKey, kind, artifactKey, inputsDigest, value } = input;
      const createdAt = Date.now();
      const payloadJson = JSON.stringify(value);

      db.insert(artifacts)
        .values({
          projectKey,
          kind,
          artifactKey,
          inputsDigest,
          createdAt,
          payloadJson,
        })
        .onConflictDoUpdate({
          target: [artifacts.projectKey, artifacts.kind, artifacts.artifactKey, artifacts.inputsDigest],
          set: { createdAt, payloadJson },
        })
        .run();

      return Promise.resolve();
    },
  };
};

export { createSqliteArtifactRepository };
