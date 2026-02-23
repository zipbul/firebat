import { describe } from 'bun:test';

import { noGlobalThisMutationRule } from '../../../../../src/test-api';
import { runGoldenRule } from '../../../shared/oxlint-golden-runner';

describe('golden/no-globalthis-mutation', () => {
  runGoldenRule(import.meta.dir, 'globalthis-write', noGlobalThisMutationRule);
  runGoldenRule(import.meta.dir, 'no-findings', noGlobalThisMutationRule);
});
