import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { createDrizzleDb } from './drizzle-db';
import { createSqliteArtifactRepository } from './artifact.repository';

// Use an in-memory SQLite DB + Drizzle for integration tests.
// We bootstrap the schema inline (no migration needed for a few CREATE TABLE stmts).
let db: Database;
let repo: ReturnType<typeof createSqliteArtifactRepository>;

const PROJECT_KEY = 'test-project';

beforeEach(() => {
  db = new Database(':memory:');
  // Create the artifacts table manually to avoid needing migrations
  db.run(`
    CREATE TABLE IF NOT EXISTS artifacts (
      projectKey TEXT NOT NULL,
      kind TEXT NOT NULL,
      artifactKey TEXT NOT NULL,
      inputsDigest TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      payloadJson TEXT NOT NULL,
      PRIMARY KEY (projectKey, kind, artifactKey, inputsDigest)
    )
  `);
  const orm = createDrizzleDb(db);
  repo = createSqliteArtifactRepository(orm);
});

afterEach(() => {
  db.close();
});

describe('infrastructure/sqlite/artifact.repository — getArtifact', () => {
  it('returns null when artifact does not exist', async () => {
    const result = await repo.getArtifact({ projectKey: PROJECT_KEY, kind: 'scan', artifactKey: 'key1', inputsDigest: 'digest1' });
    expect(result).toBeNull();
  });

  it('returns stored artifact after setArtifact', async () => {
    const input = { projectKey: PROJECT_KEY, kind: 'scan', artifactKey: 'key1', inputsDigest: 'digest1' };
    await repo.setArtifact({ ...input, value: { findings: 42 } });
    const result = await repo.getArtifact<{ findings: number }>(input);
    expect(result).not.toBeNull();
    expect(result?.findings).toBe(42);
  });

  it('returns null when inputsDigest differs', async () => {
    await repo.setArtifact({ projectKey: PROJECT_KEY, kind: 'scan', artifactKey: 'key1', inputsDigest: 'digest-A', value: { x: 1 } });
    const result = await repo.getArtifact({ projectKey: PROJECT_KEY, kind: 'scan', artifactKey: 'key1', inputsDigest: 'digest-B' });
    expect(result).toBeNull();
  });

  it('handles invalid JSON in payloadJson by returning null', async () => {
    db.run(`INSERT INTO artifacts (projectKey, kind, artifactKey, inputsDigest, createdAt, payloadJson) VALUES (?, ?, ?, ?, ?, ?)`,
      [PROJECT_KEY, 'scan', 'bad', 'dig1', Date.now(), '{invalid}']);
    const result = await repo.getArtifact({ projectKey: PROJECT_KEY, kind: 'scan', artifactKey: 'bad', inputsDigest: 'dig1' });
    expect(result).toBeNull();
  });
});

describe('infrastructure/sqlite/artifact.repository — setArtifact', () => {
  it('overwrites existing artifact on conflict (upsert)', async () => {
    const input = { projectKey: PROJECT_KEY, kind: 'scan', artifactKey: 'key1', inputsDigest: 'digest1' };
    await repo.setArtifact({ ...input, value: { v: 1 } });
    await repo.setArtifact({ ...input, value: { v: 2 } });
    const result = await repo.getArtifact<{ v: number }>(input);
    expect(result?.v).toBe(2);
  });

  it('stores different kinds independently', async () => {
    const base = { projectKey: PROJECT_KEY, artifactKey: 'k', inputsDigest: 'd' };
    await repo.setArtifact({ ...base, kind: 'scan', value: 'scan-data' });
    await repo.setArtifact({ ...base, kind: 'trace', value: 'trace-data' });
    const scan = await repo.getArtifact<string>({ ...base, kind: 'scan' });
    const trace = await repo.getArtifact<string>({ ...base, kind: 'trace' });
    expect(scan).toBe('scan-data');
    expect(trace).toBe('trace-data');
  });
});
