import { describe } from 'bun:test';

import { analyzeModificationTrap } from '../../../../src/test-api';
import { runGolden } from '../../shared/golden-runner';

describe('golden/modification-trap', () => {
  runGolden(import.meta.dir, 'user-usage', program => analyzeModificationTrap(program));

  runGolden(import.meta.dir, 'post-usage', program => analyzeModificationTrap(program));

  runGolden(import.meta.dir, 'no-findings', program => analyzeModificationTrap(program));

  runGolden(import.meta.dir, 'order-usage', program => analyzeModificationTrap(program));

  runGolden(import.meta.dir, 'product-usage', program => analyzeModificationTrap(program));

  runGolden(import.meta.dir, 'import-type-trap', program => analyzeModificationTrap(program));
});
