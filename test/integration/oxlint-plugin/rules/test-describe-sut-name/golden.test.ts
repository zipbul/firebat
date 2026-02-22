import { describe } from 'bun:test';

import { testDescribeSutNameRule } from '../../../../../src/oxlint-plugin/rules/test-describe-sut-name';
import { runGoldenRule } from '../../../shared/oxlint-golden-runner';

describe('golden/test-describe-sut-name', () => {
  // Both fixtures are treated as if they belong to 'user-service.spec.ts'.
  // The rule derives expected SUT name = 'user-service' from that filename.
  runGoldenRule(import.meta.dir, 'wrong-describe.spec', testDescribeSutNameRule, {
    filename: 'user-service.spec.ts',
  });
  runGoldenRule(import.meta.dir, 'correct-describe.spec', testDescribeSutNameRule, {
    filename: 'user-service.spec.ts',
  });
});
