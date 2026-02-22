import { describe } from 'bun:test';

import { memberOrderingRule } from '../../../../../src/oxlint-plugin/rules/member-ordering';
import { runGoldenRule } from '../../../shared/oxlint-golden-runner';

describe('golden/member-ordering', () => {
  runGoldenRule(import.meta.dir, 'method-before-field', memberOrderingRule);
  runGoldenRule(import.meta.dir, 'no-findings', memberOrderingRule);
});
