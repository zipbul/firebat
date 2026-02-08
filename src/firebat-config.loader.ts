import * as path from 'node:path';

import { FirebatConfigSchema, type FirebatConfig } from './firebat-config';

export const DEFAULT_FIREBAT_RC_BASENAME = '.firebatrc.jsonc';

export const resolveDefaultFirebatRcPath = (rootAbs: string): string => path.join(rootAbs, DEFAULT_FIREBAT_RC_BASENAME);

export const loadFirebatConfigFile = async (params: {
  readonly rootAbs: string;
  readonly configPath?: string;
}): Promise<{ config: FirebatConfig | null; resolvedPath: string; exists: boolean }> => {
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

  const validated = FirebatConfigSchema.safeParse(parsed);

  if (!validated.success) {
    throw new Error(`[firebat] Invalid config: ${resolvedPath}\n${validated.error.message}`);
  }

  return { config: validated.data, resolvedPath, exists: true };
};
