import { Gildash } from '@zipbul/gildash';
/**
 * Gildash test helper for integration tests.
 *
 * Creates a real Gildash instance from fixture source files by writing them
 * to a temporary directory. Always call the cleanup function when done.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface TempGildash {
  readonly gildash: Gildash;
  readonly tmpDir: string;
  readonly cleanup: () => Promise<void>;
}

/** Virtual-path → source-text fixtures, as a Map or a plain record. */
export type GildashSources = Map<string, string> | Record<string, string>;

export interface TempGildashOptions {
  /** Path prefix to strip from source keys (default `/virtual/`). */
  readonly stripPrefix?: string;
  /** Open gildash with the semantic layer enabled. */
  readonly semantic?: boolean;
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
  sources: GildashSources,
  options?: TempGildashOptions,
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

  let gildash: Gildash;

  try {
    gildash = await Gildash.open({
      projectRoot: tmpDir,
      watchMode: false,
      extensions: ['.ts'],
      ...(options?.semantic === true ? { semantic: true } : {}),
    });
  } catch (e) {
    fs.rmSync(tmpDir, { recursive: true, force: true });

    throw e;
  }

  return {
    gildash,
    tmpDir,
    cleanup: async () => {
      await gildash.close({ cleanup: true });
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
};

/**
 * Run `fn` against a temporary Gildash instance built from `sources`, always
 * cleaning up afterwards (even if `fn` throws).
 *
 * This is the create → try/finally(cleanup) scaffold that every gildash-backed
 * integration test repeats verbatim. The body of `fn` is the only thing that
 * differs per test (which analyzer is run, which assertions follow), so callers
 * keep their distinct Act/Assert while the lifecycle lives in one place.
 */
export const withTempGildash = async <T>(
  sources: GildashSources,
  fn: (gildash: Gildash, tmpDir: string) => T | Promise<T>,
  options?: TempGildashOptions,
): Promise<T> => {
  const { gildash, tmpDir, cleanup } = await createTempGildash(sources, options);

  try {
    return await fn(gildash, tmpDir);
  } finally {
    await cleanup();
  }
};
