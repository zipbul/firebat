import { describe } from 'bun:test';

import { analyzeAbstractionFitness } from '../../../../src/features/abstraction-fitness';
import { runGolden } from '../../shared/golden-runner';

describe('golden/abstraction-fitness', () => {
  runGolden(import.meta.dir, 'low-fitness', program =>
    analyzeAbstractionFitness(program, { minFitnessScore: 1 }),
  );

  runGolden(import.meta.dir, 'baseline', program =>
    analyzeAbstractionFitness(program, { minFitnessScore: 1 }),
  );

  runGolden(import.meta.dir, 'minimal-module', program =>
    analyzeAbstractionFitness(program, { minFitnessScore: 1 }),
  );

  runGolden(import.meta.dir, 'empty-module', program =>
    analyzeAbstractionFitness(program, { minFitnessScore: 1 }),
  );

  runGolden(import.meta.dir, 'pure-utility', program =>
    analyzeAbstractionFitness(program, { minFitnessScore: 1 }),
  );
});
