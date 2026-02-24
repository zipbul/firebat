import { describe } from 'bun:test';

import { analyzeImplicitState } from '../../../../src/test-api';
import { runGolden } from '../../shared/golden-runner';

describe('golden/implicit-state', () => {
  runGolden(import.meta.dir, 'env-key-shared', program => analyzeImplicitState(program));

  runGolden(import.meta.dir, 'no-findings', program => analyzeImplicitState(program));

  runGolden(import.meta.dir, 'singleton', program => analyzeImplicitState(program));

  runGolden(import.meta.dir, 'unused-module-var', program => analyzeImplicitState(program));

  runGolden(import.meta.dir, 'module-cache', program => analyzeImplicitState(program));

  runGolden(import.meta.dir, 'event-channel', program => analyzeImplicitState(program));
});
