import { describe } from 'bun:test';

import { singleExportedClassRule } from '../../../../../src/test-api';
import { runGoldenRule } from '../../../shared/oxlint-golden-runner';

describe('golden/single-exported-class', () => {
  runGoldenRule(import.meta.dir, 'two-classes', singleExportedClassRule);
  runGoldenRule(import.meta.dir, 'no-findings', singleExportedClassRule);
});
