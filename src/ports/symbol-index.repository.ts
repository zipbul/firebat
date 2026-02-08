import type { SourceSpan } from '../types';

export type IndexedSymbolKind = 'function' | 'method' | 'class' | 'type' | 'interface' | 'enum';

export interface IndexedSymbol {
  readonly kind: IndexedSymbolKind;
  readonly name: string;
  readonly span: SourceSpan;
  readonly isExported?: boolean;
}

export interface SymbolMatch {
  readonly filePath: string;
  readonly kind: IndexedSymbolKind;
  readonly name: string;
  readonly span: SourceSpan;
  readonly isExported?: boolean;
}

export interface SymbolIndexStats {
  readonly indexedFileCount: number;
  readonly symbolCount: number;
  readonly lastIndexedAt: number | null;
}

export interface GetIndexedFileInput {
  readonly projectKey: string;
  readonly filePath: string;
}

export interface IndexedFileInfo {
  readonly contentHash: string;
  readonly indexedAt: number;
  readonly symbolCount: number;
}

export interface ReplaceFileSymbolsInput {
  readonly projectKey: string;
  readonly filePath: string;
  readonly contentHash: string;
  readonly indexedAt: number;
  readonly symbols: ReadonlyArray<IndexedSymbol>;
}

export interface SearchSymbolsInput {
  readonly projectKey: string;
  readonly query: string;
  readonly limit?: number;
}

export interface GetSymbolIndexStatsInput {
  readonly projectKey: string;
}

export interface ClearSymbolIndexProjectInput {
  readonly projectKey: string;
}

export interface SymbolIndexRepository {
  getIndexedFile(input: GetIndexedFileInput): Promise<IndexedFileInfo | null>;

  replaceFileSymbols(input: ReplaceFileSymbolsInput): Promise<void>;

  search(input: SearchSymbolsInput): Promise<ReadonlyArray<SymbolMatch>>;

  getStats(input: GetSymbolIndexStatsInput): Promise<SymbolIndexStats>;

  clearProject(input: ClearSymbolIndexProjectInput): Promise<void>;
}
