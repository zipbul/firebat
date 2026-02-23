import { describe } from 'bun:test';

import { noUmbrellaTypesRule } from '../../../../../src/test-api';
import { runGoldenRule } from '../../../shared/oxlint-golden-runner';

describe('golden/no-umbrella-types', () => {
  runGoldenRule(import.meta.dir, 'umbrella-param', noUmbrellaTypesRule);
  runGoldenRule(import.meta.dir, 'no-findings', noUmbrellaTypesRule);
});
