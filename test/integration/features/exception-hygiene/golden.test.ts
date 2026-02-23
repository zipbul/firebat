import { describe } from 'bun:test';

import { analyzeExceptionHygiene } from '../../../../src/test-api';
import { runGolden } from '../../shared/golden-runner';

describe('golden/exception-hygiene', () => {
  runGolden(import.meta.dir, 'silent-catch', program => analyzeExceptionHygiene(program));

  runGolden(import.meta.dir, 'no-findings', program => analyzeExceptionHygiene(program));

  runGolden(import.meta.dir, 'try-finally', program => analyzeExceptionHygiene(program));

  runGolden(import.meta.dir, 'silent-catch2', program => analyzeExceptionHygiene(program));

  runGolden(import.meta.dir, 'async-silent', program => analyzeExceptionHygiene(program));
});
