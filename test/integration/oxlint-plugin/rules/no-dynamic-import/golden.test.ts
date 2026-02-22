import { describe } from 'bun:test';

import { noDynamicImportRule } from '../../../../../src/oxlint-plugin/rules/no-dynamic-import';
import { runGoldenRule } from '../../../shared/oxlint-golden-runner';

describe('golden/no-dynamic-import', () => {
  runGoldenRule(import.meta.dir, 'dynamic-import', noDynamicImportRule);
  runGoldenRule(import.meta.dir, 'no-findings', noDynamicImportRule);
});
