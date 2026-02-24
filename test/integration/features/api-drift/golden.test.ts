import { describe } from 'bun:test';

import { analyzeApiDrift } from '../../../../src/test-api';
import { runGolden } from '../../shared/golden-runner';

describe('golden/api-drift', () => {
  runGolden(import.meta.dir, 'async-drift', program => analyzeApiDrift(program));

  runGolden(import.meta.dir, 'no-findings', program => analyzeApiDrift(program));

  runGolden(import.meta.dir, 'all-sync', program => analyzeApiDrift(program));

  runGolden(import.meta.dir, 'all-async', program => analyzeApiDrift(program));

  runGolden(import.meta.dir, 'no-functions', program => analyzeApiDrift(program));

  runGolden(import.meta.dir, 'prefix-drift', program => analyzeApiDrift(program));

  runGolden(import.meta.dir, 'class-drift', program => analyzeApiDrift(program));
});
