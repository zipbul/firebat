import { describe } from 'bun:test';

import { analyzeStructuralDuplicates } from '../../../../src/test-api';
import { runGolden } from '../../shared/golden-runner';

describe('golden/structural-duplicates', () => {
  runGolden(import.meta.dir, 'similar-math', program =>
    analyzeStructuralDuplicates([...program], 2),
  );

  runGolden(import.meta.dir, 'no-findings', program =>
    analyzeStructuralDuplicates([...program], 2),
  );

  runGolden(import.meta.dir, 'for-loops', program =>
    analyzeStructuralDuplicates([...program], 2),
  );

  runGolden(import.meta.dir, 'simple-math', program =>
    analyzeStructuralDuplicates([...program], 2),
  );

  runGolden(import.meta.dir, 'trivial', program =>
    analyzeStructuralDuplicates([...program], 2),
  );
});
