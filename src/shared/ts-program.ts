import type { Gildash } from '@zipbul/gildash';

import type { ParsedFile } from '../engine/types';
import type { FirebatProgramConfig } from '../interfaces';

import { createGildash } from '../store/gildash';

// Re-export ParsedFile so external callers (specs) can import it from this module
export type { ParsedFile };

const normalizePath = (filePath: string): string => filePath.replaceAll('\\', '/');

const shouldIncludeFile = (filePath: string): boolean => {
  const normalized = normalizePath(filePath);
  const segments = normalized.split('/');
  const nodeModulesSegment = 'node' + '_modules';

  if (segments.includes(nodeModulesSegment)) {
    return false;
  }

  if (normalized.endsWith('.d.ts')) {
    return false;
  }

  return true;
};

export const createFirebatProgram = async (
  config: FirebatProgramConfig & { readonly gildash?: Gildash },
): Promise<ParsedFile[]> => {
  const { logger } = config;

  const eligible = config.targets.filter(shouldIncludeFile);

  if (eligible.length === 0) {
    logger.debug('No eligible files to parse');
    return [];
  }

  logger.debug('Parsing files with gildash', { eligibleCount: eligible.length });

  const ownsGildash = config.gildash === undefined;
  const root = process.cwd();
  const gildash = config.gildash ?? (await createGildash({ projectRoot: root, watchMode: false }));

  try {
    const { parsed } = await gildash.batchParse(eligible);

    return Array.from(parsed.values()) as unknown as ParsedFile[];
  } finally {
    if (ownsGildash) {
      await gildash.close({ cleanup: false });
    }
  }
};
