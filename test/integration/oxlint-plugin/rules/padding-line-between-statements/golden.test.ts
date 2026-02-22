import { describe } from 'bun:test';

import { paddingLineBetweenStatementsRule } from '../../../../../src/oxlint-plugin/rules/padding-line-between-statements';
import { runGoldenRule } from '../../../shared/oxlint-golden-runner';

describe('golden/padding-line-between-statements', () => {
  runGoldenRule(import.meta.dir, 'const-with-blank', paddingLineBetweenStatementsRule);
  runGoldenRule(import.meta.dir, 'no-findings', paddingLineBetweenStatementsRule);
});
