import { describe } from 'bun:test';

import { analyzeVariableLifetime } from '../../../../src/features/variable-lifetime';
import { runGolden } from '../../shared/golden-runner';

describe('golden/variable-lifetime', () => {
  runGolden(import.meta.dir, 'long-lifetime', program =>
    analyzeVariableLifetime(program, { maxLifetimeLines: 5 }),
  );

  runGolden(import.meta.dir, 'no-findings', program =>
    analyzeVariableLifetime(program, { maxLifetimeLines: 5 }),
  );

  runGolden(import.meta.dir, 'string-literal-fp', program =>
    analyzeVariableLifetime(program, { maxLifetimeLines: 5 }),
  );

  runGolden(import.meta.dir, 'medium-lifetime', program =>
    analyzeVariableLifetime(program, { maxLifetimeLines: 5 }),
  );

  runGolden(import.meta.dir, 'short-usage', program =>
    analyzeVariableLifetime(program, { maxLifetimeLines: 5 }),
  );
});
