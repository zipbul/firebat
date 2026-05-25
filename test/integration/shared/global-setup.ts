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

import { setGildashSemanticContext } from '../../../src/engine/dataflow/gildash-binding-source';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

let _instance: Gildash | null = null;

const open = async (): Promise<void> => {
  _instance = await Gildash.open({
    projectRoot: PROJECT_ROOT,
    semantic: true,
    watchMode: false,
  });
  setGildashSemanticContext(_instance);
};

// Top-level await is supported in module init; tests start only after this
// promise settles.
await open();

// Best-effort cleanup on process exit. Bun test runner doesn't expose an
// after-all hook for preload modules; rely on the OS to release tsc resources.
const cleanup = (): void => {
  if (_instance !== null) {
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
