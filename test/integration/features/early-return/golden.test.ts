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
});
