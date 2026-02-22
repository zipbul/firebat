import { describe } from 'bun:test';

import { analyzeNesting } from '../../../../src/features/nesting';
import { runGolden } from '../../shared/golden-runner';

describe('golden/nesting', () => {
  runGolden(import.meta.dir, 'deep-if', program => analyzeNesting(program));

  runGolden(import.meta.dir, 'no-findings', program => analyzeNesting(program));

  runGolden(import.meta.dir, 'for-nesting', program => analyzeNesting(program));

  runGolden(import.meta.dir, 'switch-nesting', program => analyzeNesting(program));

  runGolden(import.meta.dir, 'well-structured', program => analyzeNesting(program));
});
