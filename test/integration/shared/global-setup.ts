/**
 * Bun test preload: open one Gildash semantic context for the entire test run.
 *
 * Configured via `bunfig.toml` `[test] preload = ["./test/integration/shared/global-setup.ts"]`.
 * Bun's preload runs before any test file imports; we open Gildash once,
 * register it as the active binding source via `setGildashSemanticContext`,
 * and let every test pass binding-resolution through the tsc-authoritative
 * path. The firebat repo root is the project; all fixture files under
 * `test/**` are indexed automatically by gildash (tsconfig `exclude` does
 * not gate gildash indexing).
 *
 * Single-instance startup cost (~2.5s cold) amortizes across all tests.
 */
import { Gildash } from '@zipbul/gildash';
import * as path from 'node:path';

import { setParseSourceHook } from '../../../src/engine/ast/parse-source';
import {
  notifyVirtualSource,
  setGildashSemanticContext,
} from '../../../src/engine/dataflow/gildash-binding-source';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const AD_HOC_DIR = path.join(PROJECT_ROOT, '.firebat-test-tmp');

let _instance: Gildash | null = null;

// Deterministic virtual → real-disk path mapping used by the auto-register
// hook. Same virtual path always maps to the same target so repeated parses
// (e.g. fuzz iterations that reuse a path with different content) replace
// the in-memory file in tsc Program rather than accumulating new entries.
const adHocPathFor = (virtualPath: string): string => {
  const safe = virtualPath.replace(/[^A-Za-z0-9._-]+/g, '_');

  return path.join(AD_HOC_DIR, safe);
};

const parseSourceHook = (filePath: string, sourceText: string): void => {
  // Skip real disk files under the project root — gildash's initial scan
  // already indexed them. Everything else (virtual paths, ad-hoc test
  // identifiers like `/clean.ts`, relative paths) is registered with the
  // semantic layer so subsequent binding queries resolve.
  if (filePath.startsWith(PROJECT_ROOT + '/')) {
    return;
  }

  // Notify only — defer the binding query (and its tsc Program rebuild) to
  // the first buildDeclScopeMap call. Querying here would force a second
  // rebuild per parsed file.
  notifyVirtualSource(filePath, adHocPathFor(filePath), sourceText);
};

const open = async (): Promise<void> => {
  _instance = await Gildash.open({
    projectRoot: PROJECT_ROOT,
    semantic: true,
    watchMode: false,
  });
  setGildashSemanticContext(_instance);
  setParseSourceHook(parseSourceHook);
};

// Top-level await is supported in module init; tests start only after this
// promise settles.
await open();

// Best-effort cleanup on process exit. Bun test runner doesn't expose an
// after-all hook for preload modules; rely on the OS to release tsc resources.
const cleanup = (): void => {
  if (_instance !== null) {
    setParseSourceHook(null);
    setGildashSemanticContext(null);
    _instance.close({ cleanup: false }).catch(() => {
      /* best-effort */
    });
    _instance = null;
  }
};

process.on('exit', cleanup);
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
