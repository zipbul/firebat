import { describe } from 'bun:test';

import { analyzeBarrelPolicy } from '../../../../src/features/barrel-policy';
import { runGolden } from '../../shared/golden-runner';

describe('golden/barrel-policy', () => {
  runGolden(import.meta.dir, 'export-star', program =>
    analyzeBarrelPolicy(program, { rootAbs: '/virtual' }),
  );

  runGolden(import.meta.dir, 'baseline', program =>
    analyzeBarrelPolicy(program, { rootAbs: '/virtual' }),
  );

  runGolden(import.meta.dir, 'multi-export-star', program =>
    analyzeBarrelPolicy(program, { rootAbs: '/virtual' }),
  );

  runGolden(import.meta.dir, 'named-exports', program =>
    analyzeBarrelPolicy(program, { rootAbs: '/virtual' }),
  );

  runGolden(import.meta.dir, 'no-exports', program =>
    analyzeBarrelPolicy(program, { rootAbs: '/virtual' }),
  );
});
