import { describe } from 'bun:test';

import { analyzeIndirection } from '../../../../src/test-api';
import { runGolden } from '../../shared/golden-runner';
import { buildMockGildashFromSources } from './mock-gildash-helper';

describe('golden/indirection', () => {
  runGolden(import.meta.dir, 'thin-wrapper', async (program, sources) =>
    analyzeIndirection(buildMockGildashFromSources(sources), program, { maxForwardDepth: 1, crossFileMinDepth: 2 }, '/virtual'),
  );

  runGolden(import.meta.dir, 'no-findings', async (program, sources) =>
    analyzeIndirection(buildMockGildashFromSources(sources), program, { maxForwardDepth: 1, crossFileMinDepth: 2 }, '/virtual'),
  );

  runGolden(import.meta.dir, 'wrapper2', async (program, sources) =>
    analyzeIndirection(buildMockGildashFromSources(sources), program, { maxForwardDepth: 1, crossFileMinDepth: 2 }, '/virtual'),
  );

  runGolden(import.meta.dir, 'direct-util', async (program, sources) =>
    analyzeIndirection(buildMockGildashFromSources(sources), program, { maxForwardDepth: 1, crossFileMinDepth: 2 }, '/virtual'),
  );

  runGolden(import.meta.dir, 'format-chain', async (program, sources) =>
    analyzeIndirection(buildMockGildashFromSources(sources), program, { maxForwardDepth: 1, crossFileMinDepth: 2 }, '/virtual'),
  );

  runGolden(import.meta.dir, 'chain-depth', async (program, sources) =>
    analyzeIndirection(buildMockGildashFromSources(sources), program, { maxForwardDepth: 1, crossFileMinDepth: 2 }, '/virtual'),
  );

  runGolden(import.meta.dir, 'param-patterns', async (program, sources) =>
    analyzeIndirection(buildMockGildashFromSources(sources), program, { maxForwardDepth: 1, crossFileMinDepth: 2 }, '/virtual'),
  );
});
