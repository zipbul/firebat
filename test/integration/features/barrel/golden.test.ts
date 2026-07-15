import { describe } from 'bun:test';

import { analyzeBarrel } from '../../../../src/test-api';
import { runGolden } from '../../shared/golden-runner';

describe('golden/barrel', () => {
  runGolden(import.meta.dir, 'export-star', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'baseline', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'multi-export-star', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'named-exports', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'no-exports', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  // ── barrel-surgery (settled definition) — post-surgery expectations, authored RED-first ──
  runGolden(import.meta.dir, 'deep-import-surfaced-dead', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'deep-import-type-only-dead', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'deep-import-into-child-internal-dead', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'missing-index-demanded-dead', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'export-star-nonindex-dead', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'export-star-index-single-dead', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'export-star-foreign-cofire-dead', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'export-star-foreign-index-two-dead', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'export-star-as-ns-foreign-single-dead', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'export-type-star-dead', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'invalid-index-decl-dead', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'invalid-index-sideeffect-dead', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'invalid-index-named-import-dead', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'invalid-index-default-export-dead', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'invalid-index-launder-pair-dead', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'cross-module-reexport-dead', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'cross-module-locally-used-dead', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'cross-module-default-reexport-dead', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'index-spelling-keep', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'ancestor-import-keep', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'sibling-surface-keep', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'missing-index-owns-no-surface-dead', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'missing-index-no-demand-keep', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'own-subtree-reexport-keep', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'own-subtree-shim-keep', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'export-star-as-ns-keep', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'export-type-from-index-keep', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'same-dir-surface-consumption-keep', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'unresolved-and-outside-keep', program => analyzeBarrel(program, { rootAbs: '/virtual' }));

  runGolden(import.meta.dir, 'dynamic-and-ignored-keep', program => analyzeBarrel(program, { rootAbs: '/virtual' }));
});
