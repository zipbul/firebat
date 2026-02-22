import { describe } from 'bun:test';

import { unusedImportsRule } from '../../../../../src/oxlint-plugin/rules/unused-imports';
import { runGoldenRule } from '../../../shared/oxlint-golden-runner';

describe('golden/unused-imports', () => {
  runGoldenRule(import.meta.dir, 'unused', unusedImportsRule);
  runGoldenRule(import.meta.dir, 'no-findings', unusedImportsRule);
});
