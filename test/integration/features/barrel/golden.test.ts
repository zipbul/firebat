import { describe } from 'bun:test';

import { analyzeBarrel } from '../../../../src/test-api';
import { runGolden } from '../../shared/golden-runner';

describe('golden/barrel', () => {
  runGolden(import.meta.dir, 'export-star', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'baseline', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'multi-export-star', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'named-exports', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'no-exports', program => analyzeBarrel(program, { rootAbs: '/virtual' }));
});
