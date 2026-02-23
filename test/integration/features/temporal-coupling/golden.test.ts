import { describe } from 'bun:test';

import { analyzeTemporalCoupling } from '../../../../src/test-api';
import { runGolden } from '../../shared/golden-runner';

describe('golden/temporal-coupling', () => {
  runGolden(import.meta.dir, 'module-state', program => analyzeTemporalCoupling(program));

  runGolden(import.meta.dir, 'no-findings', program => analyzeTemporalCoupling(program));

  runGolden(import.meta.dir, 'counter', program => analyzeTemporalCoupling(program));

  runGolden(import.meta.dir, 'pure-function', program => analyzeTemporalCoupling(program));

  runGolden(import.meta.dir, 'session-state', program => analyzeTemporalCoupling(program));
});
