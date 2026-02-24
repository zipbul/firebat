import { describe } from 'bun:test';

import { analyzeModificationImpact } from '../../../../src/test-api';
import { runGolden } from '../../shared/golden-runner';
import { buildMockGildashFromSources } from '../forwarding/mock-gildash-helper';

describe('golden/modification-impact', () => {
  runGolden(import.meta.dir, 'high-impact', async (program, sources) =>
    analyzeModificationImpact(buildMockGildashFromSources(sources), program, '/virtual'),
  );

  runGolden(import.meta.dir, 'no-findings', async (program, sources) =>
    analyzeModificationImpact(buildMockGildashFromSources(sources), program, '/virtual'),
  );

  runGolden(import.meta.dir, 'medium-impact', async (program, sources) =>
    analyzeModificationImpact(buildMockGildashFromSources(sources), program, '/virtual'),
  );

  runGolden(import.meta.dir, 'leaf-only', async (program, sources) =>
    analyzeModificationImpact(buildMockGildashFromSources(sources), program, '/virtual'),
  );

  runGolden(import.meta.dir, 'shared-config', async (program, sources) =>
    analyzeModificationImpact(buildMockGildashFromSources(sources), program, '/virtual'),
  );
});
