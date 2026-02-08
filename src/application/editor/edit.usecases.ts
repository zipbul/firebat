import { readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import type { FirebatLogger } from '../../ports/logger';

import { parseSource } from '../../engine/parse-source';
import { extractSymbolsOxc } from '../../engine/symbol-extractor-oxc';
import { indexSymbolsUseCase } from '../symbol-index/symbol-index.usecases';

type SourcePosition = { line: number; column: number };

type SourceSpan = { start: SourcePosition; end: SourcePosition };

type Extracted = { kind: string; name: string; span: SourceSpan };

type EditResult = {
  ok: boolean;
  filePath: string;
  changed: boolean;
  error?: string;
};

const resolveRootAbs = (root: string | undefined): string => {
  const cwd = process.cwd();

  if (root === undefined || root.trim().length === 0) {
    return cwd;
  }

  const trimmed = root.trim();

  return path.isAbsolute(trimmed) ? trimmed : path.resolve(cwd, trimmed);
};

const resolveFileAbs = (rootAbs: string, relativePath: string): string => {
  return path.isAbsolute(relativePath) ? relativePath : path.resolve(rootAbs, relativePath);
};

const splitLines = (text: string): string[] => text.split(/\r?\n/);

const posToOffset = (text: string, pos: SourcePosition): number => {
  const lines = splitLines(text);
  const line0 = Math.max(0, Math.min(lines.length - 1, pos.line - 1));
  let offset = 0;

  for (let i = 0; i < line0; i++) {
    offset += (lines[i]?.length ?? 0) + 1;
  }

  const col0 = Math.max(0, Math.min(lines[line0]?.length ?? 0, pos.column));

  return offset + col0;
};

const offsetToLineIndent = (text: string, offset: number): string => {
  const before = text.slice(0, offset);
  const lastNl = before.lastIndexOf('\n');
  const lineStart = lastNl === -1 ? 0 : lastNl + 1;
  const linePrefix = before.slice(lineStart);
  const m = /^\s*/.exec(linePrefix);

  return m?.[0] ?? '';
};

const findByNamePath = (symbols: ReadonlyArray<Extracted>, namePath: string): Extracted | null => {
  const parts = namePath
    .split('/')
    .map(p => p.trim())
    .filter(Boolean);
  const needle = parts.length > 0 ? parts[parts.length - 1]! : namePath.trim();

  if (!needle) {
    return null;
  }

  // Prefer exact match.
  const exact = symbols.find(s => s.name === needle);

  if (exact) {
    return exact;
  }

  // Fallback: case-insensitive contains.
  const lower = needle.toLowerCase();

  return symbols.find(s => s.name.toLowerCase().includes(lower)) ?? null;
};

const writeIfChanged = async (filePath: string, prevText: string, nextText: string): Promise<boolean> => {
  if (nextText === prevText) {
    return false;
  }

  await writeFile(filePath, nextText, 'utf8');

  return true;
};

const reindexFile = async (rootAbs: string, fileAbs: string, logger: FirebatLogger): Promise<void> => {
  await indexSymbolsUseCase({ root: rootAbs, targets: [fileAbs], logger }).catch(() => undefined);
};

export const replaceRangeUseCase = async (input: {
  root: string;
  relativePath: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  newText: string;
  logger: FirebatLogger;
}): Promise<EditResult> => {
  const rootAbs = resolveRootAbs(input.root);
  const fileAbs = resolveFileAbs(rootAbs, input.relativePath);

  input.logger.debug('edit:replaceRange', { filePath: input.relativePath, startLine: input.startLine, endLine: input.endLine });

  try {
    const prev = await readFile(fileAbs, 'utf8');
    const start: SourcePosition = { line: input.startLine, column: Math.max(0, input.startColumn - 1) };
    const end: SourcePosition = { line: input.endLine, column: Math.max(0, input.endColumn - 1) };
    const startOff = posToOffset(prev, start);
    const endOff = posToOffset(prev, end);

    if (endOff < startOff) {
      throw new Error('Invalid range: end before start');
    }

    const next = prev.slice(0, startOff) + input.newText + prev.slice(endOff);
    const changed = await writeIfChanged(fileAbs, prev, next);

    if (changed) {
      await reindexFile(rootAbs, fileAbs, input.logger);
    }

    return { ok: true, filePath: fileAbs, changed };
  } catch (error) {
    return { ok: false, filePath: fileAbs, changed: false, error: error instanceof Error ? error.message : String(error) };
  }
};

export const replaceRegexUseCase = async (input: {
  root: string;
  relativePath: string;
  regex: string;
  repl: string;
  allowMultipleOccurrences?: boolean;
  logger: FirebatLogger;
}): Promise<EditResult & { matchCount?: number }> => {
  const rootAbs = resolveRootAbs(input.root);
  const fileAbs = resolveFileAbs(rootAbs, input.relativePath);

  input.logger.debug('edit:replaceRegex', { filePath: input.relativePath, regex: input.regex });

  try {
    const prev = await readFile(fileAbs, 'utf8');
    const re = new RegExp(input.regex, 'gms');
    const matches = Array.from(prev.matchAll(re));

    if (matches.length === 0) {
      throw new Error('No matches for regex');
    }

    if (!input.allowMultipleOccurrences && matches.length !== 1) {
      throw new Error(`Expected exactly 1 match, found ${matches.length}`);
    }

    const next = prev.replace(re, input.repl);
    const changed = await writeIfChanged(fileAbs, prev, next);

    if (changed) {
      await reindexFile(rootAbs, fileAbs, input.logger);
    }

    return { ok: true, filePath: fileAbs, changed, matchCount: matches.length };
  } catch (error) {
    return { ok: false, filePath: fileAbs, changed: false, error: error instanceof Error ? error.message : String(error) };
  }
};

export const insertBeforeSymbolUseCase = async (input: {
  root: string;
  namePath: string;
  relativePath: string;
  body: string;
  logger: FirebatLogger;
}): Promise<EditResult> => {
  const rootAbs = resolveRootAbs(input.root);
  const fileAbs = resolveFileAbs(rootAbs, input.relativePath);

  input.logger.debug('edit:insertBefore', { filePath: input.relativePath, namePath: input.namePath });

  try {
    const prev = await readFile(fileAbs, 'utf8');
    const parsed = parseSource(fileAbs, prev);
    const symbols = extractSymbolsOxc(parsed) as any as Extracted[];
    const sym = findByNamePath(symbols, input.namePath);

    if (!sym) {
      throw new Error(`Symbol not found: ${input.namePath}`);
    }

    const startOff = posToOffset(prev, sym.span.start);
    const insertion = input.body.endsWith('\n') ? input.body : input.body + '\n';
    const next = prev.slice(0, startOff) + insertion + prev.slice(startOff);
    const changed = await writeIfChanged(fileAbs, prev, next);

    if (changed) {
      await reindexFile(rootAbs, fileAbs, input.logger);
    }

    return { ok: true, filePath: fileAbs, changed };
  } catch (error) {
    return { ok: false, filePath: fileAbs, changed: false, error: error instanceof Error ? error.message : String(error) };
  }
};

export const insertAfterSymbolUseCase = async (input: {
  root: string;
  namePath: string;
  relativePath: string;
  body: string;
  logger: FirebatLogger;
}): Promise<EditResult> => {
  const rootAbs = resolveRootAbs(input.root);
  const fileAbs = resolveFileAbs(rootAbs, input.relativePath);

  input.logger.debug('edit:insertAfter', { filePath: input.relativePath, namePath: input.namePath });

  try {
    const prev = await readFile(fileAbs, 'utf8');
    const parsed = parseSource(fileAbs, prev);
    const symbols = extractSymbolsOxc(parsed) as any as Extracted[];
    const sym = findByNamePath(symbols, input.namePath);

    if (!sym) {
      throw new Error(`Symbol not found: ${input.namePath}`);
    }

    const endOff = posToOffset(prev, sym.span.end);
    const insertion = input.body.startsWith('\n') ? input.body : '\n' + input.body;
    const next = prev.slice(0, endOff) + insertion + prev.slice(endOff);
    const changed = await writeIfChanged(fileAbs, prev, next);

    if (changed) {
      await reindexFile(rootAbs, fileAbs, input.logger);
    }

    return { ok: true, filePath: fileAbs, changed };
  } catch (error) {
    return { ok: false, filePath: fileAbs, changed: false, error: error instanceof Error ? error.message : String(error) };
  }
};

export const replaceSymbolBodyUseCase = async (input: {
  root: string;
  namePath: string;
  relativePath: string;
  body: string;
  logger: FirebatLogger;
}): Promise<EditResult> => {
  const rootAbs = resolveRootAbs(input.root);
  const fileAbs = resolveFileAbs(rootAbs, input.relativePath);

  input.logger.debug('edit:replaceSymbolBody', { filePath: input.relativePath, namePath: input.namePath });

  try {
    const prev = await readFile(fileAbs, 'utf8');
    const parsed = parseSource(fileAbs, prev);
    const symbols = extractSymbolsOxc(parsed) as any as Extracted[];
    const sym = findByNamePath(symbols, input.namePath);

    if (!sym) {
      throw new Error(`Symbol not found: ${input.namePath}`);
    }

    const startOff = posToOffset(prev, sym.span.start);
    const endOff = posToOffset(prev, sym.span.end);
    const segment = prev.slice(startOff, endOff);
    const open = segment.indexOf('{');
    const close = segment.lastIndexOf('}');

    if (open === -1 || close === -1 || close <= open) {
      throw new Error('Symbol does not appear to have a block body');
    }

    const braceOff = startOff + open;
    const indent = offsetToLineIndent(prev, braceOff) + '  ';
    const normalizedBody = input.body.endsWith('\n') ? input.body : input.body + '\n';
    const bodyLines = splitLines(normalizedBody).map((l, idx) => (idx === 0 && l.trim().length === 0 ? l : indent + l));
    const bodyText = '\n' + bodyLines.join('\n');
    const nextSegment = segment.slice(0, open + 1) + bodyText + offsetToLineIndent(prev, braceOff) + segment.slice(close);
    const next = prev.slice(0, startOff) + nextSegment + prev.slice(endOff);
    const changed = await writeIfChanged(fileAbs, prev, next);

    if (changed) {
      await reindexFile(rootAbs, fileAbs, input.logger);
    }

    return { ok: true, filePath: fileAbs, changed };
  } catch (error) {
    return { ok: false, filePath: fileAbs, changed: false, error: error instanceof Error ? error.message : String(error) };
  }
};
