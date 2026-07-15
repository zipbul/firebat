import type { Gildash } from '@zipbul/gildash';

import { normalizePath } from '@zipbul/gildash';

import type { ParsedFile } from '../engine/types';
import type { FirebatProgramConfig } from '../interfaces';

import { createGildash } from '../store/gildash';

const shouldIncludeFile = (filePath: string): boolean => {
  const normalized = normalizePath(filePath);
  const segments = normalized.split('/');

  if (segments.includes('node' + '_modules')) {
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
  // When the caller injects gildash (the scan path) this fallback is never taken;
  // for standalone callers, open gildash at the resolved root (or cwd) — never a
  // separate raw process.cwd() that could diverge from the project root.
  const gildash = config.gildash ?? (await createGildash({ projectRoot: config.rootAbs ?? process.cwd(), watchMode: false }));

  try {
    const { parsed } = await gildash.batchParse(eligible);

    // gildash.batchParse는 병렬 Map 채움이라 .values() 순서가 동일 입력에도 run마다 다르다.
    // 모든 detector가 결정적 결과를 내도록 filePath로 정규 정렬한다 (재현 가능한 출력의 근본 보장).
    return Array.from(parsed.values()).sort((a, b) => (a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0));
  } finally {
    if (ownsGildash) {
      await gildash.close({ cleanup: false });
    }
  }
};
