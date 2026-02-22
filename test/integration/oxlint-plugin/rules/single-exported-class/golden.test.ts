import { describe } from 'bun:test';

import { singleExportedClassRule } from '../../../../../src/oxlint-plugin/rules/single-exported-class';
import { runGoldenRule } from '../../../shared/oxlint-golden-runner';

describe('golden/single-exported-class', () => {
  runGoldenRule(import.meta.dir, 'two-classes', singleExportedClassRule);
  runGoldenRule(import.meta.dir, 'no-findings', singleExportedClassRule);
});
