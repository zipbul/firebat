import * as path from 'node:path';

import { DETECTOR_ALIASES } from '../types';
import { FirebatConfigSchema, type FirebatConfig } from './firebat-config';

const DEFAULT_FIREBAT_RC_BASENAME = '.firebatrc.jsonc';

const resolveDefaultFirebatRcPath = (rootAbs: string): string => path.join(rootAbs, DEFAULT_FIREBAT_RC_BASENAME);

interface LoadFirebatConfigParams {
  readonly rootAbs: string;
  readonly configPath?: string;
}

interface LoadFirebatConfigResult {
  readonly config: FirebatConfig | null;
  readonly resolvedPath: string;
  readonly exists: boolean;
}

const loadFirebatConfigFile = async (params: LoadFirebatConfigParams): Promise<LoadFirebatConfigResult> => {
  const resolvedPath =
    params.configPath !== undefined ? path.resolve(params.configPath) : resolveDefaultFirebatRcPath(params.rootAbs);
  const file = Bun.file(resolvedPath);

  if (!(await file.exists())) {
    return { config: null, resolvedPath, exists: false };
  }

  const raw = await file.text();
  let parsed: unknown;

  try {
    parsed = Bun.JSONC.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    throw new Error(`[firebat] Failed to parse config: ${resolvedPath}\n${message}`);
  }

  // Apply detector alias remapping for backward compatibility (e.g. 'exception-hygiene' → 'error-flow')
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;

    for (const [alias, canonical] of Object.entries(DETECTOR_ALIASES)) {
      if (alias in obj && !(canonical in obj)) {
        obj[canonical] = obj[alias];

        delete obj[alias];
      }
    }
  }

  const validated = FirebatConfigSchema.safeParse(parsed);

  if (!validated.success) {
    throw new Error(`[firebat] Invalid config: ${resolvedPath}\n${validated.error.message}`);
  }

  return { config: validated.data, resolvedPath, exists: true };
};

export { DEFAULT_FIREBAT_RC_BASENAME, loadFirebatConfigFile, resolveDefaultFirebatRcPath };
