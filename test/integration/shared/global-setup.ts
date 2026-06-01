/**
 * Bun test preload: open one Gildash semantic context for the entire test run.
 *
 * Configured via `bunfig.toml` `[test] preload = ["./test/integration/shared/global-setup.ts"]`.
 * Bun's preload runs before any test file imports; we open Gildash once and
 * register it as the active binding source via `setGildashSemanticContext`.
 * Binding resolution uses gildash's isolated `getStandaloneFileBindings`
 * (the dataflow layer passes each file's sourceText directly), so no
 * per-source notify or virtual→real path bookkeeping is needed — the test
 * source content flows straight from the ParsedFile.
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
    _instance.close({ cleanup: false }).catch((error: unknown) => {
      // Best-effort cleanup, but surface the cause so a close failure isn't invisible.
      console.error('global-setup: gildash close failed during cleanup', error);
    });
    _instance = null;
  }
};

process.on('exit', cleanup);
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
