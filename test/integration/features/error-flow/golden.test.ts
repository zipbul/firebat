import { describe } from 'bun:test';

import { analyzeErrorFlow } from '../../../../src/test-api';
import { runGolden } from '../../shared/golden-runner';

describe('golden/error-flow', () => {
  runGolden(import.meta.dir, 'no-findings', program => analyzeErrorFlow(program));

  runGolden(import.meta.dir, 'try-finally', program => analyzeErrorFlow(program));

  runGolden(import.meta.dir, 'throw-non-error', program => analyzeErrorFlow(program));

  runGolden(import.meta.dir, 'promise-patterns', program => analyzeErrorFlow(program));

  runGolden(import.meta.dir, 'nested-try-catch', program => analyzeErrorFlow(program));
});
