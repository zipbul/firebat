import { describe } from 'bun:test';

import { analyzeConceptScatter } from '../../../../src/features/concept-scatter';
import { runGolden } from '../../shared/golden-runner';

describe('golden/concept-scatter', () => {
  runGolden(import.meta.dir, 'scattered', program =>
    analyzeConceptScatter(program, { maxScatterIndex: 2 }),
  );

  runGolden(import.meta.dir, 'no-findings', program =>
    analyzeConceptScatter(program, { maxScatterIndex: 2 }),
  );

  runGolden(import.meta.dir, 'payment-scatter', program =>
    analyzeConceptScatter(program, { maxScatterIndex: 2 }),
  );

  runGolden(import.meta.dir, 'single-concept', program =>
    analyzeConceptScatter(program, { maxScatterIndex: 2 }),
  );

  runGolden(import.meta.dir, 'three-file-scatter', program =>
    analyzeConceptScatter(program, { maxScatterIndex: 2 }),
  );
});
