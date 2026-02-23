import { describe } from 'bun:test';

import { analyzeCoupling } from '../../../../src/test-api';
import { analyzeDependencies } from '../../../../src/test-api';
import { runGolden } from '../../shared/golden-runner';

describe('golden/coupling', () => {
  runGolden(import.meta.dir, 'hub-module', program =>
    analyzeCoupling(analyzeDependencies(program, { rootAbs: '/virtual' })),
  );

  runGolden(import.meta.dir, 'baseline', program =>
    analyzeCoupling(analyzeDependencies(program, { rootAbs: '/virtual' })),
  );

  runGolden(import.meta.dir, 'two-modules', program =>
    analyzeCoupling(analyzeDependencies(program, { rootAbs: '/virtual' })),
  );

  runGolden(import.meta.dir, 'isolated', program =>
    analyzeCoupling(analyzeDependencies(program, { rootAbs: '/virtual' })),
  );

  runGolden(import.meta.dir, 'star-hub', program =>
    analyzeCoupling(analyzeDependencies(program, { rootAbs: '/virtual' })),
  );
});
