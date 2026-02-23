import { describe } from 'bun:test';

import { detectWaste } from '../../../../src/test-api';
import { runGolden } from '../../shared/golden-runner';

describe('golden/waste', () => {
  runGolden(import.meta.dir, 'dead-export', program =>
    detectWaste([...program]),
  );

  runGolden(import.meta.dir, 'no-findings', program =>
    detectWaste([...program]),
  );

  runGolden(import.meta.dir, 'underscore-prefix', program =>
    detectWaste([...program]),
  );

  runGolden(import.meta.dir, 'dead-reassign', program =>
    detectWaste([...program]),
  );

  runGolden(import.meta.dir, 'unused-local', program =>
    detectWaste([...program]),
  );
});
