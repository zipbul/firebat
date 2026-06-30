/**
 * Run the indirection analyzer against a REAL (production) Gildash.
 *
 * Writes the in-memory fixture sources to a temp dir, opens production Gildash
 * (no `semantic` — indirection needs only the symbol/relation index), parses the
 * temp files, runs `analyzeIndirection`, and relativizes finding paths back to
 * `/virtual/...` so callers (and golden snapshots) see stable paths.
 *
 * This replaces the former regex `buildMockGildashFromSources` mock: every
 * cross-file resolution, export-status check, overload count and symbol lookup
 * now exercises the production gildash path — no drift between test and prod.
 */
import type { IndirectionFinding } from '../../../../src/types';

import * as path from 'node:path';

import { analyzeIndirection, parseSource } from '../../../../src/test-api';
import { type GildashSources, withTempGildash } from '../../shared/gildash-test-kit';

const VIRTUAL = '/virtual';

const toVirtual = (filePath: string, tmpDir: string): string => {
  const normalizedTmp = tmpDir.replace(/\\/g, '/');
  const normalizedFile = filePath.replace(/\\/g, '/');
  const idx = normalizedFile.indexOf(normalizedTmp);

  if (idx === -1) {
    return filePath;
  }

  return `${VIRTUAL}${normalizedFile.slice(idx + normalizedTmp.length)}`;
};

export interface IndirectionRunOptions {
  readonly maxForwardDepth: number;
  readonly crossFileMinDepth: number;
}

export const analyzeIndirectionReal = (
  sources: GildashSources,
  options: IndirectionRunOptions,
): Promise<readonly IndirectionFinding[]> =>
  withTempGildash(sources, async (gildash, tmpDir) => {
    const entries = sources instanceof Map ? [...sources.entries()] : Object.entries(sources);
    const program = entries.map(([virtualPath, src]) => {
      const rel = virtualPath.startsWith(`${VIRTUAL}/`) ? virtualPath.slice(VIRTUAL.length + 1) : virtualPath;

      return parseSource(path.join(tmpDir, rel), src);
    });
    const findings = await analyzeIndirection(gildash, program, options, tmpDir);

    return findings.map(f => ({ ...f, filePath: toVirtual(f.filePath, tmpDir) }));
  });
