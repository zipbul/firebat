import { describe } from 'bun:test';

import { analyzeUnknownProof } from '../../../../src/test-api';
import { runGolden } from '../../shared/golden-runner';

describe('golden/unknown-proof', () => {
  runGolden(import.meta.dir, 'type-assertion', program =>
    analyzeUnknownProof(program, { rootAbs: '/virtual' }),
  );

  runGolden(import.meta.dir, 'double-assertion', program =>
    analyzeUnknownProof(program, { rootAbs: '/virtual' }),
  );

  runGolden(import.meta.dir, 'no-findings', program =>
    analyzeUnknownProof(program, { rootAbs: '/virtual' }),
  );

  runGolden(import.meta.dir, 'non-null-assert', program =>
    analyzeUnknownProof(program, { rootAbs: '/virtual' }),
  );

  runGolden(import.meta.dir, 'multi-cast', program =>
    analyzeUnknownProof(program, { rootAbs: '/virtual' }),
  );
});
