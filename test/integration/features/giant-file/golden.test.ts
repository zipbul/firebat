import { describe } from 'bun:test';

import { analyzeGiantFile } from '../../../../src/test-api';
import { runGolden } from '../../shared/golden-runner';

// giant-file surgery (PLAN-giant-file-surgery.md D2): `defaulted` is a real
// field on AnalyzeGiantFileOptions/GiantFileMetrics. Golden callers here are
// direct analyzer callers (not scan-wiring), so per the plan they pass
// `defaulted: false` explicitly.
describe('golden/giant-file', () => {
  runGolden(import.meta.dir, 'large', program => analyzeGiantFile(program, { maxLines: 10, defaulted: false }));

  runGolden(import.meta.dir, 'no-findings', program => analyzeGiantFile(program, { maxLines: 10, defaulted: false }));

  runGolden(import.meta.dir, 'border', program => analyzeGiantFile(program, { maxLines: 10, defaulted: false }));

  runGolden(import.meta.dir, 'small', program => analyzeGiantFile(program, { maxLines: 10, defaulted: false }));

  runGolden(import.meta.dir, 'medium', program => analyzeGiantFile(program, { maxLines: 10, defaulted: false }));
});
