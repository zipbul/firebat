import { describe } from 'bun:test';

import { analyzeModificationImpact } from '../../../../src/features/modification-impact';
import { runGolden } from '../../shared/golden-runner';

describe('golden/modification-impact', () => {
  runGolden(import.meta.dir, 'high-impact', program => analyzeModificationImpact(program));

  runGolden(import.meta.dir, 'no-findings', program => analyzeModificationImpact(program));

  runGolden(import.meta.dir, 'medium-impact', program => analyzeModificationImpact(program));

  runGolden(import.meta.dir, 'leaf-only', program => analyzeModificationImpact(program));

  runGolden(import.meta.dir, 'shared-config', program => analyzeModificationImpact(program));
});
