import { describe } from 'bun:test';

import { analyzeGiantFile } from '../../../../src/features/giant-file';
import { runGolden } from '../../shared/golden-runner';

describe('golden/giant-file', () => {
  runGolden(import.meta.dir, 'large', program =>
    analyzeGiantFile(program, { maxLines: 10 }),
  );

  runGolden(import.meta.dir, 'no-findings', program =>
    analyzeGiantFile(program, { maxLines: 10 }),
  );

  runGolden(import.meta.dir, 'border', program =>
    analyzeGiantFile(program, { maxLines: 10 }),
  );

  runGolden(import.meta.dir, 'small', program =>
    analyzeGiantFile(program, { maxLines: 10 }),
  );

  runGolden(import.meta.dir, 'medium', program =>
    analyzeGiantFile(program, { maxLines: 10 }),
  );
});
