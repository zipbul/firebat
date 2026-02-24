import { describe } from 'bun:test';

import { analyzeImplementationOverhead } from '../../../../src/test-api';
import { runGolden } from '../../shared/golden-runner';

describe('golden/implementation-overhead', () => {
  runGolden(import.meta.dir, 'heavy-body', program =>
    analyzeImplementationOverhead(program, { minRatio: 2 }),
  );

  runGolden(import.meta.dir, 'no-findings', program =>
    analyzeImplementationOverhead(program, { minRatio: 2 }),
  );

  runGolden(import.meta.dir, 'medium-ratio', program =>
    analyzeImplementationOverhead(program, { minRatio: 2 }),
  );

  runGolden(import.meta.dir, 'logic-heavy', program =>
    analyzeImplementationOverhead(program, { minRatio: 2 }),
  );

  runGolden(import.meta.dir, 'simple-util', program =>
    analyzeImplementationOverhead(program, { minRatio: 2 }),
  );

  runGolden(import.meta.dir, 'ts-advanced-syntax', program =>
    analyzeImplementationOverhead(program, { minRatio: 2 }),
  );

  runGolden(import.meta.dir, 'edge-cases', program =>
    analyzeImplementationOverhead(program, { minRatio: 2 }),
  );
});
