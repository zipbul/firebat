import { describe } from 'bun:test';

import { noTombstoneRule } from '../../../../../src/oxlint-plugin/rules/no-tombstone';
import { runGoldenRule } from '../../../shared/oxlint-golden-runner';

describe('golden/no-tombstone', () => {
  runGoldenRule(import.meta.dir, 'comment-only', noTombstoneRule);
  runGoldenRule(import.meta.dir, 'no-findings', noTombstoneRule);
});
