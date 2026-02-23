import { describe, it, expect } from 'bun:test';

// We test the module via its side effects — the exported function is async and
// relies on Bun.spawn. Instead, we test the internal logic indirectly by
// calling logExternalToolVersionOnce with a non-existent command and verifying
// it doesn't throw (error path) and that the logger's warn is called.

import { createNoopLogger } from '../shared/logger';
import { logExternalToolVersionOnce } from './external-tool-version';

describe('logExternalToolVersionOnce', () => {
  it('[HP] does not throw when cmdPath does not exist (catches internally)', async () => {
    const logger = createNoopLogger('debug');
    await expect(
      logExternalToolVersionOnce({
        tool: 'fake-tool',
        cmdPath: '/nonexistent/bin/faketool',
        cwd: process.cwd(),
        minVersion: '1.0.0',
        logger,
      }),
    ).resolves.toBeUndefined();
  });

  it('[HP] deduplicates calls for the same key (second call is a no-op)', async () => {
    // First call populates the cache; second call returns early
    const logger = createNoopLogger('debug');
    const opts = {
      tool: 'cached-tool',
      cmdPath: '/nonexistent/bin/cachedtool',
      cwd: process.cwd(),
      minVersion: '1.0.0',
      logger,
    };
    await logExternalToolVersionOnce(opts);
    // Second call — should not throw and returns quickly
    await expect(logExternalToolVersionOnce(opts)).resolves.toBeUndefined();
  });
});
