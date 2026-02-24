import { describe } from 'bun:test';

import { analyzeForwarding } from '../../../../src/test-api';
import { runGolden } from '../../shared/golden-runner';
import { buildMockGildashFromSources } from './mock-gildash-helper';

describe('golden/forwarding', () => {
  runGolden(import.meta.dir, 'thin-wrapper', async (program, sources) =>
    analyzeForwarding(buildMockGildashFromSources(sources), program, 1, '/virtual'),
  );

  runGolden(import.meta.dir, 'no-findings', async (program, sources) =>
    analyzeForwarding(buildMockGildashFromSources(sources), program, 1, '/virtual'),
  );

  runGolden(import.meta.dir, 'wrapper2', async (program, sources) =>
    analyzeForwarding(buildMockGildashFromSources(sources), program, 1, '/virtual'),
  );

  runGolden(import.meta.dir, 'direct-util', async (program, sources) =>
    analyzeForwarding(buildMockGildashFromSources(sources), program, 1, '/virtual'),
  );

  runGolden(import.meta.dir, 'format-chain', async (program, sources) =>
    analyzeForwarding(buildMockGildashFromSources(sources), program, 1, '/virtual'),
  );

  runGolden(import.meta.dir, 'chain-depth', async (program, sources) =>
    analyzeForwarding(buildMockGildashFromSources(sources), program, 1, '/virtual'),
  );

  runGolden(import.meta.dir, 'param-patterns', async (program, sources) =>
    analyzeForwarding(buildMockGildashFromSources(sources), program, 1, '/virtual'),
  );
});
