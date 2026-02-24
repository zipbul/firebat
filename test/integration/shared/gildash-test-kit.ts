/**
 * Gildash test helper for integration tests.
 *
 * Creates a real Gildash instance from fixture source files by writing them
 * to a temporary directory. Always call the cleanup function when done.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { Gildash } from '@zipbul/gildash';
import { isErr } from '@zipbul/result';

export interface TempGildash {
  readonly gildash: Gildash;
  readonly tmpDir: string;
  readonly cleanup: () => Promise<void>;
}

/**
 * Create a Gildash instance from a Map of virtual-path → source-text.
 *
 * Entries like `/virtual/deps/a.ts` are written to `<tmpDir>/deps/a.ts`.
 * A minimal `package.json` is created for gildash project discovery.
 *
 * @param stripPrefix  Path prefix to strip from source keys (default `/virtual/`).
 */
export const createTempGildash = async (
  sources: Map<string, string> | Record<string, string>,
  options?: { stripPrefix?: string },
): Promise<TempGildash> => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'firebat-int-test-'));
  const prefix = options?.stripPrefix ?? '/virtual/';

  // gildash requires package.json for project boundary discovery
  fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test","version":"0.0.0"}');

  const entries = sources instanceof Map ? sources.entries() : Object.entries(sources);

  for (const [virtualPath, content] of entries) {
    // Strip configured prefix (e.g. /virtual/) from path keys
    const relPath = virtualPath.startsWith(prefix) ? virtualPath.slice(prefix.length) : virtualPath;
    const fullPath = path.join(tmpDir, relPath);

    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
  }

  const result = await Gildash.open({
    projectRoot: tmpDir,
    watchMode: false,
    extensions: ['.ts'],
  });

  if (isErr(result)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });

    throw new Error(`Gildash open failed: ${result.data.message}`);
  }

  const gildash = result;

  return {
    gildash,
    tmpDir,
    cleanup: async () => {
      await gildash.close({ cleanup: true });
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
};
