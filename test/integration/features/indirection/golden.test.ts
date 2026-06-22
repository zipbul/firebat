import { describe } from 'bun:test';

import { analyzeIndirection } from '../../../../src/test-api';
import { runGolden } from '../../shared/golden-runner';
import { buildMockGildashFromSources } from './mock-gildash-helper';

describe('golden/indirection', () => {
  const rg = (name: string, maxForwardDepth = 1) =>
    runGolden(import.meta.dir, name, async (program, sources) =>
      analyzeIndirection(buildMockGildashFromSources(sources), program, { maxForwardDepth, crossFileMinDepth: 2 }, '/virtual'),
    );

  rg('thin-wrapper');
  rg('no-findings');
  rg('wrapper2');
  rg('direct-util');
  rg('format-chain');
  rg('chain-depth');
  rg('param-patterns');
  rg('type-remap', 0);
  rg('interface-rewrap', 0);
  rg('mixed-indirection');
});
