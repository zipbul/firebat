import { describe } from 'bun:test';

import { analyzeDependencies } from '../../../../src/features/dependencies';
import { runGolden } from '../../shared/golden-runner';

describe('golden/dependencies', () => {
  runGolden(import.meta.dir, 'cycle', program =>
    analyzeDependencies(program, { rootAbs: '/virtual' }),
  );

  runGolden(import.meta.dir, 'no-cycle', program =>
    analyzeDependencies(program, { rootAbs: '/virtual' }),
  );

  runGolden(import.meta.dir, 'fan-out', program =>
    analyzeDependencies(program, { rootAbs: '/virtual' }),
  );

  runGolden(import.meta.dir, 'linear-chain', program =>
    analyzeDependencies(program, { rootAbs: '/virtual' }),
  );

  runGolden(import.meta.dir, 'no-deps', program =>
    analyzeDependencies(program, { rootAbs: '/virtual' }),
  );
});
