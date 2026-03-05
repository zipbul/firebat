import { describe } from 'bun:test';

import { analyzeEarlyReturn } from '../../../../src/test-api';
import { runGolden } from '../../shared/golden-runner';

describe('golden/early-return', () => {
  runGolden(import.meta.dir, 'nested-else', program => analyzeEarlyReturn(program));

  runGolden(import.meta.dir, 'guard-clause', program => analyzeEarlyReturn(program));

  runGolden(import.meta.dir, 'no-findings', program => analyzeEarlyReturn(program));

  runGolden(import.meta.dir, 'throw-guard', program => analyzeEarlyReturn(program));

  runGolden(import.meta.dir, 'multi-guard', program => analyzeEarlyReturn(program));

  runGolden(import.meta.dir, 'ts-advanced-syntax', program => analyzeEarlyReturn(program));

  runGolden(import.meta.dir, 'invertible-if-else', program => analyzeEarlyReturn(program));

  runGolden(import.meta.dir, 'else-if-chain', program => analyzeEarlyReturn(program));

  runGolden(import.meta.dir, 'return-guard', program => analyzeEarlyReturn(program));

  runGolden(import.meta.dir, 'multi-statement-guard', program => analyzeEarlyReturn(program));

  runGolden(import.meta.dir, 'arrow-function', program => analyzeEarlyReturn(program));

  runGolden(import.meta.dir, 'class-method', program => analyzeEarlyReturn(program));

  runGolden(import.meta.dir, 'invertible-boundary', program => analyzeEarlyReturn(program));

  runGolden(import.meta.dir, 'nested-invertible', program => analyzeEarlyReturn(program));

  runGolden(import.meta.dir, 'empty-function', program => analyzeEarlyReturn(program));

  runGolden(import.meta.dir, 'async-function', program => analyzeEarlyReturn(program));

  runGolden(import.meta.dir, 'nested-function', program => analyzeEarlyReturn(program));

  runGolden(import.meta.dir, 'switch-return', program => analyzeEarlyReturn(program));

  // New fixtures for v2 patterns
  runGolden(import.meta.dir, 'wrapping-if', program => analyzeEarlyReturn(program));

  runGolden(import.meta.dir, 'tail-if', program => analyzeEarlyReturn(program));

  runGolden(import.meta.dir, 'loop-wrapping-if', program => analyzeEarlyReturn(program));

  runGolden(import.meta.dir, 'cascade-guard', program => analyzeEarlyReturn(program));

  runGolden(import.meta.dir, 'cascade-guard-loop', program => analyzeEarlyReturn(program));

  runGolden(import.meta.dir, 'mixed-opportunities', program => analyzeEarlyReturn(program));

  runGolden(import.meta.dir, 'score-threshold', program => analyzeEarlyReturn(program));
});
