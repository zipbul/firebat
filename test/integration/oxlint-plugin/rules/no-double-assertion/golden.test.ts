import { describe } from 'bun:test';

import { noDoubleAssertionRule } from '../../../../../src/test-api';
import { runGoldenRule } from '../../../shared/oxlint-golden-runner';

describe('golden/no-double-assertion', () => {
  runGoldenRule(import.meta.dir, 'double-assertion', noDoubleAssertionRule);
  runGoldenRule(import.meta.dir, 'no-findings', noDoubleAssertionRule);
});
