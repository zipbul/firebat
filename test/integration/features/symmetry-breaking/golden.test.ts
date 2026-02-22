import { describe } from 'bun:test';

import { analyzeSymmetryBreaking } from '../../../../src/features/symmetry-breaking';
import { runGolden } from '../../shared/golden-runner';

describe('golden/symmetry-breaking', () => {
  runGolden(import.meta.dir, 'handler-outlier', program => analyzeSymmetryBreaking(program));

  runGolden(import.meta.dir, 'no-findings', program => analyzeSymmetryBreaking(program));

  runGolden(import.meta.dir, 'controller-outlier', program => analyzeSymmetryBreaking(program));

  // FP guard: file with 'Controller' only in a comment should not be counted as a controller file
  runGolden(import.meta.dir, 'comment-only-controller', program => analyzeSymmetryBreaking(program));

  runGolden(import.meta.dir, 'method-outlier', program => analyzeSymmetryBreaking(program));
});
