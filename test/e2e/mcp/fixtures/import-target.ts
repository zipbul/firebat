// Fixture for import parsing tools (parse_imports, get_available_external_symbols)

import type { Stats } from 'node:fs';

import * as path from 'node:path';

export const resolvePath = (...segments: string[]): string => path.resolve(...segments);

export const readTextFile = async (filePath: string): Promise<string> => {
  return Bun.file(filePath).text();
};

export const writeTextFile = async (filePath: string, content: string): Promise<void> => {
  await Bun.write(filePath, content);
};

export type FileStats = Pick<Stats, 'size' | 'mtime'>;
