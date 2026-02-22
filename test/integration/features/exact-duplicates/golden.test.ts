import { describe } from 'bun:test';

import { detectExactDuplicates } from '../../../../src/features/exact-duplicates';
import { runGolden } from '../../shared/golden-runner';

describe('golden/exact-duplicates', () => {
  runGolden(import.meta.dir, 'identical-loops', program =>
    detectExactDuplicates([...program], 5),
  );

  runGolden(import.meta.dir, 'no-findings', program =>
    detectExactDuplicates([...program], 5),
  );

  runGolden(import.meta.dir, 'identical-transform', program =>
    detectExactDuplicates([...program], 5),
  );

  runGolden(import.meta.dir, 'different-functions', program =>
    detectExactDuplicates([...program], 5),
  );

  runGolden(import.meta.dir, 'single-const', program =>
    detectExactDuplicates([...program], 5),
  );

  runGolden(import.meta.dir, 'ts-advanced-syntax', program =>
    detectExactDuplicates([...program], 5),
  );
});
