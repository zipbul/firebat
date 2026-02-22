import { describe } from 'bun:test';

import { analyzeDecisionSurface } from '../../../../src/features/decision-surface';
import { runGolden } from '../../shared/golden-runner';

describe('golden/decision-surface', () => {
  runGolden(import.meta.dir, 'multi-branch', program =>
    analyzeDecisionSurface(program, { maxAxes: 2 }),
  );

  runGolden(import.meta.dir, 'no-findings', program =>
    analyzeDecisionSurface(program, { maxAxes: 2 }),
  );

  runGolden(import.meta.dir, 'flag-axes', program =>
    analyzeDecisionSurface(program, { maxAxes: 2 }),
  );

  runGolden(import.meta.dir, 'simple-function', program =>
    analyzeDecisionSurface(program, { maxAxes: 2 }),
  );

  runGolden(import.meta.dir, 'const-only', program =>
    analyzeDecisionSurface(program, { maxAxes: 2 }),
  );
});
