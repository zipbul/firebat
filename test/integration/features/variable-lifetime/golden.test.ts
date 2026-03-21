import { describe } from 'bun:test';

import { analyzeVariableLifetime } from '../../../../src/test-api';
import { runGolden } from '../../shared/golden-runner';

describe('golden/variable-lifetime', () => {
  runGolden(import.meta.dir, 'long-lifetime', program => analyzeVariableLifetime(program, { maxLifetimeLines: 5 }));

  runGolden(import.meta.dir, 'no-findings', program => analyzeVariableLifetime(program, { maxLifetimeLines: 5 }));

  runGolden(import.meta.dir, 'string-literal-fp', program => analyzeVariableLifetime(program, { maxLifetimeLines: 5 }));

  runGolden(import.meta.dir, 'medium-lifetime', program => analyzeVariableLifetime(program, { maxLifetimeLines: 5 }));

  runGolden(import.meta.dir, 'short-usage', program => analyzeVariableLifetime(program, { maxLifetimeLines: 5 }));

  runGolden(import.meta.dir, 'scope-isolation', program => analyzeVariableLifetime(program, { maxLifetimeLines: 5 }));

  runGolden(import.meta.dir, 'early-return-dead-code', program => analyzeVariableLifetime(program, { maxLifetimeLines: 5 }));

  runGolden(import.meta.dir, 'liveness-pressure', program =>
    analyzeVariableLifetime(program, { maxLifetimeLines: 999, maxLiveVariables: 7, minFunctionLines: 10 }),
  );
});
