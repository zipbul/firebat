import { integer, sqliteTable, text, primaryKey, index } from 'drizzle-orm/sqlite-core';

export const files = sqliteTable(
  'files',
  {
    projectKey: text('projectKey').notNull(),
    filePath: text('filePath').notNull(),
    mtimeMs: integer('mtimeMs').notNull(),
    size: integer('size').notNull(),
    contentHash: text('contentHash').notNull(),
    updatedAt: integer('updatedAt').notNull(),
  },
  table => [
    primaryKey({ columns: [table.projectKey, table.filePath] }),
    index('idx_files_projectKey').on(table.projectKey),
  ],
);

export const artifacts = sqliteTable(
  'artifacts',
  {
    projectKey: text('projectKey').notNull(),
    kind: text('kind').notNull(),
    artifactKey: text('artifactKey').notNull(),
    inputsDigest: text('inputsDigest').notNull(),
    createdAt: integer('createdAt').notNull(),
    payloadJson: text('payloadJson').notNull(),
  },
  table => [
    primaryKey({ columns: [table.projectKey, table.kind, table.artifactKey, table.inputsDigest] }),
    index('idx_artifacts_projectKey_kind').on(table.projectKey, table.kind),
    index('idx_artifacts_createdAt').on(table.createdAt),
  ],
);

export const memories = sqliteTable(
  'memories',
  {
    projectKey: text('projectKey').notNull(),
    memoryKey: text('memoryKey').notNull(),
    createdAt: integer('createdAt').notNull(),
    updatedAt: integer('updatedAt').notNull(),
    payloadJson: text('payloadJson').notNull(),
  },
  table => [
    primaryKey({ columns: [table.projectKey, table.memoryKey] }),
    index('idx_memories_projectKey').on(table.projectKey),
    index('idx_memories_updatedAt').on(table.updatedAt),
  ],
);

export const symbolFiles = sqliteTable(
  'symbol_files',
  {
    projectKey: text('projectKey').notNull(),
    filePath: text('filePath').notNull(),
    contentHash: text('contentHash').notNull(),
    indexedAt: integer('indexedAt').notNull(),
    symbolCount: integer('symbolCount').notNull(),
  },
  table => [
    primaryKey({ columns: [table.projectKey, table.filePath] }),
    index('idx_symbol_files_projectKey').on(table.projectKey),
    index('idx_symbol_files_indexedAt').on(table.indexedAt),
  ],
);

export const symbols = sqliteTable(
  'symbols',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectKey: text('projectKey').notNull(),
    filePath: text('filePath').notNull(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    startLine: integer('startLine').notNull(),
    startColumn: integer('startColumn').notNull(),
    endLine: integer('endLine').notNull(),
    endColumn: integer('endColumn').notNull(),
    isExported: integer('isExported', { mode: 'boolean' }).notNull().default(false),
    indexedAt: integer('indexedAt').notNull(),
  },
  table => [
    index('idx_symbols_projectKey_name').on(table.projectKey, table.name),
    index('idx_symbols_projectKey_filePath').on(table.projectKey, table.filePath),
    index('idx_symbols_projectKey_kind').on(table.projectKey, table.kind),
  ],
);
