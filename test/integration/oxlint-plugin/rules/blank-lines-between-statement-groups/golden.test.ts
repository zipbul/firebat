import { describe } from 'bun:test';

import { blankLinesBetweenStatementGroupsRule } from '../../../../../src/oxlint-plugin/rules/blank-lines-between-statement-groups';
import { runGoldenRule } from '../../../shared/oxlint-golden-runner';

describe('golden/blank-lines-between-statement-groups', () => {
  runGoldenRule(import.meta.dir, 'missing-blank-line', blankLinesBetweenStatementGroupsRule);
  runGoldenRule(import.meta.dir, 'no-findings', blankLinesBetweenStatementGroupsRule);
});
