import { describe } from 'bun:test';

import { paddingLineBetweenStatementsRule } from '../../../../../src/test-api';
import { runGoldenRule } from '../../../shared/oxlint-golden-runner';

describe('golden/padding-line-between-statements', () => {
  runGoldenRule(import.meta.dir, 'const-with-blank', paddingLineBetweenStatementsRule);
  runGoldenRule(import.meta.dir, 'no-findings', paddingLineBetweenStatementsRule);
});
