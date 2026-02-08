import { and, eq, sql } from 'drizzle-orm';

import type {
  IndexedSymbolKind,
  SymbolIndexRepository,
  SymbolIndexStats,
  SymbolMatch,
} from '../../ports/symbol-index.repository';
import type { FirebatDrizzleDb } from './drizzle-db';

import { symbolFiles, symbols as symbolsTable } from './schema';

const isIndexedSymbolKind = (value: string): value is IndexedSymbolKind =>
  value === 'function' ||
  value === 'method' ||
  value === 'class' ||
  value === 'type' ||
  value === 'interface' ||
  value === 'enum';

const createSqliteSymbolIndexRepository = (db: FirebatDrizzleDb): SymbolIndexRepository => {
  return {
    async getIndexedFile({ projectKey, filePath }) {
      const row = db
        .select({
          contentHash: symbolFiles.contentHash,
          indexedAt: symbolFiles.indexedAt,
          symbolCount: symbolFiles.symbolCount,
        })
        .from(symbolFiles)
        .where(and(eq(symbolFiles.projectKey, projectKey), eq(symbolFiles.filePath, filePath)))
        .get();

      return Promise.resolve(row ?? null);
    },

    async replaceFileSymbols({ projectKey, filePath, contentHash, indexedAt, symbols }) {
      db.transaction(tx => {
        tx.delete(symbolsTable)
          .where(and(eq(symbolsTable.projectKey, projectKey), eq(symbolsTable.filePath, filePath)))
          .run();

        if (symbols.length > 0) {
          tx.insert(symbolsTable)
            .values(
              symbols.map(s => ({
                projectKey,
                filePath,
                kind: s.kind,
                name: s.name,
                startLine: s.span.start.line,
                startColumn: s.span.start.column,
                endLine: s.span.end.line,
                endColumn: s.span.end.column,
                isExported: s.isExported ?? false,
                indexedAt,
              })),
            )
            .run();
        }

        tx.insert(symbolFiles)
          .values({
            projectKey,
            filePath,
            contentHash,
            indexedAt,
            symbolCount: symbols.length,
          })
          .onConflictDoUpdate({
            target: [symbolFiles.projectKey, symbolFiles.filePath],
            set: { contentHash, indexedAt, symbolCount: symbols.length },
          })
          .run();
      });

      return Promise.resolve();
    },

    async search({ projectKey, query, limit }) {
      const trimmed = query.trim();

      if (trimmed.length === 0) {
        return Promise.resolve([]);
      }

      const pattern = `%${trimmed}%`;
      const max = limit !== undefined && limit > 0 ? Math.min(500, Math.floor(limit)) : 50;
      const rows = db
        .select({
          filePath: symbolsTable.filePath,
          kind: symbolsTable.kind,
          name: symbolsTable.name,
          startLine: symbolsTable.startLine,
          startColumn: symbolsTable.startColumn,
          endLine: symbolsTable.endLine,
          endColumn: symbolsTable.endColumn,
          isExported: symbolsTable.isExported,
        })
        .from(symbolsTable)
        .where(and(eq(symbolsTable.projectKey, projectKey), sql`lower(${symbolsTable.name}) like lower(${pattern})`))
        .limit(max)
        .all();
      const mapped = rows.flatMap((r): SymbolMatch[] => {
        const kind = r.kind;

        if (!isIndexedSymbolKind(kind)) {
          return [];
        }

        return [
          {
            filePath: r.filePath,
            kind,
            name: r.name,
            span: {
              start: { line: r.startLine, column: r.startColumn },
              end: { line: r.endLine, column: r.endColumn },
            },
            isExported: r.isExported ?? false,
          },
        ];
      });

      return Promise.resolve(mapped);
    },

    async getStats({ projectKey }): Promise<SymbolIndexStats> {
      const rows = db
        .select({ indexedAt: symbolFiles.indexedAt, symbolCount: symbolFiles.symbolCount })
        .from(symbolFiles)
        .where(eq(symbolFiles.projectKey, projectKey))
        .all();
      const indexedFileCount = rows.length;
      let symbolCount = 0;
      let lastIndexedAt: number | null = null;

      for (const row of rows) {
        symbolCount += row.symbolCount;

        if (lastIndexedAt === null || row.indexedAt > lastIndexedAt) {
          lastIndexedAt = row.indexedAt;
        }
      }

      return Promise.resolve({ indexedFileCount, symbolCount, lastIndexedAt });
    },

    async clearProject({ projectKey }) {
      db.transaction(tx => {
        tx.delete(symbolsTable).where(eq(symbolsTable.projectKey, projectKey)).run();
        tx.delete(symbolFiles).where(eq(symbolFiles.projectKey, projectKey)).run();
      });

      return Promise.resolve();
    },
  };
};

export { createSqliteSymbolIndexRepository };
