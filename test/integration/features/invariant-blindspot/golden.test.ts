import { describe } from 'bun:test';

import { analyzeInvariantBlindspot } from '../../../../src/test-api';
import { runGolden } from '../../shared/golden-runner';

describe('golden/invariant-blindspot', () => {
  runGolden(import.meta.dir, 'throw-guard', program => analyzeInvariantBlindspot(program));

  runGolden(import.meta.dir, 'no-findings', program => analyzeInvariantBlindspot(program));

  runGolden(import.meta.dir, 'console-assert', program => analyzeInvariantBlindspot(program));

  runGolden(import.meta.dir, 'must-comment', program => analyzeInvariantBlindspot(program));

  runGolden(import.meta.dir, 'switch-throw', program => analyzeInvariantBlindspot(program));
});
