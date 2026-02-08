// Fixture for import parsing tools (parse_imports, get_available_external_symbols)

import type { Stats } from 'node:fs';

import { readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

export const resolvePath = (...segments: string[]): string => path.resolve(...segments);

export const readTextFile = async (filePath: string): Promise<string> => {
  return readFile(filePath, 'utf8');
};

export const writeTextFile = async (filePath: string, content: string): Promise<void> => {
  await writeFile(filePath, content, 'utf8');
};

export type FileStats = Pick<Stats, 'size' | 'mtime'>;
