import { describe } from 'bun:test';

import { noUnmodifiedLoopConditionRule } from '../../../../../src/oxlint-plugin/rules/no-unmodified-loop-condition';
import { runGoldenRule } from '../../../shared/oxlint-golden-runner';

describe('golden/no-unmodified-loop-condition', () => {
  runGoldenRule(import.meta.dir, 'unmodified-while', noUnmodifiedLoopConditionRule);
  runGoldenRule(import.meta.dir, 'no-findings', noUnmodifiedLoopConditionRule);
});
