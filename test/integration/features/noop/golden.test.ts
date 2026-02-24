import { describe } from 'bun:test';

import { analyzeNoop } from '../../../../src/test-api';
import { runGolden } from '../../shared/golden-runner';

describe('golden/noop', () => {
  runGolden(import.meta.dir, 'self-assignment', program => analyzeNoop(program));

  runGolden(import.meta.dir, 'no-findings', program => analyzeNoop(program));

  runGolden(import.meta.dir, 'expression-noop', program => analyzeNoop(program));

  runGolden(import.meta.dir, 'constant-condition', program => analyzeNoop(program));

  runGolden(import.meta.dir, 'empty-catch', program => analyzeNoop(program));

  runGolden(import.meta.dir, 'empty-body-noop', program => analyzeNoop(program));
});
