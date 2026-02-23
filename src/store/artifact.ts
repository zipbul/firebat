import { Database } from 'bun:sqlite';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GetArtifactInput {
  readonly projectKey: string;
  readonly kind: string;
  readonly artifactKey: string;
  readonly inputsDigest: string;
}

export interface SetArtifactInput<T> {
  readonly projectKey: string;
  readonly kind: string;
  readonly artifactKey: string;
  readonly inputsDigest: string;
  readonly value: T;
}

export interface ArtifactStore {
  get<T>(input: GetArtifactInput): T | null;
  set<T>(input: SetArtifactInput<T>): void;
}

// ---------------------------------------------------------------------------
// Schema DDL
// ---------------------------------------------------------------------------

const ENSURE_TABLE = `
CREATE TABLE IF NOT EXISTS artifacts (
  projectKey  TEXT    NOT NULL,
  kind        TEXT    NOT NULL,
  artifactKey TEXT    NOT NULL,
  inputsDigest TEXT   NOT NULL,
  createdAt   INTEGER NOT NULL,
  payloadJson TEXT    NOT NULL,
  PRIMARY KEY (projectKey, kind, artifactKey, inputsDigest)
);
`;

const ENSURE_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_artifacts_projectKey_kind ON artifacts(projectKey, kind);',
  'CREATE INDEX IF NOT EXISTS idx_artifacts_createdAt ON artifacts(createdAt);',
];

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const cacheKey = (input: GetArtifactInput): string =>
  `${input.projectKey}\0${input.kind}\0${input.artifactKey}\0${input.inputsDigest}`;

export const createArtifactStore = (db: Database): ArtifactStore => {
  // Ensure schema
  db.run(ENSURE_TABLE);

  for (const ddl of ENSURE_INDEXES) {
    db.run(ddl);
  }

  // Prepared statements
  const getStmt = db.prepare<{ payloadJson: string }, [string, string, string, string]>(
    'SELECT payloadJson FROM artifacts WHERE projectKey = ? AND kind = ? AND artifactKey = ? AND inputsDigest = ?',
  );

  const upsertStmt = db.prepare<void, [string, string, string, string, number, string]>(
    `INSERT INTO artifacts (projectKey, kind, artifactKey, inputsDigest, createdAt, payloadJson)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (projectKey, kind, artifactKey, inputsDigest)
     DO UPDATE SET createdAt = excluded.createdAt, payloadJson = excluded.payloadJson`,
  );

  // L1 in-memory cache
  const cache = new Map<string, string>();

  return {
    get<T>(input: GetArtifactInput): T | null {
      const key = cacheKey(input);

      // L1 hit
      const cached = cache.get(key);

      if (cached !== undefined) {
        try {
          return JSON.parse(cached) as T;
        } catch {
          cache.delete(key);
        }
      }

      // L2 sqlite
      const row = getStmt.get(input.projectKey, input.kind, input.artifactKey, input.inputsDigest);

      if (!row) {
        return null;
      }

      // Populate L1
      cache.set(key, row.payloadJson);

      try {
        return JSON.parse(row.payloadJson) as T;
      } catch {
        return null;
      }
    },

    set<T>(input: SetArtifactInput<T>): void {
      const { projectKey, kind, artifactKey, inputsDigest, value } = input;
      const payloadJson = JSON.stringify(value);
      const key = cacheKey(input);

      // L1
      cache.set(key, payloadJson);

      // L2
      upsertStmt.run(projectKey, kind, artifactKey, inputsDigest, Date.now(), payloadJson);
    },
  };
};
