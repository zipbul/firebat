import { describe } from 'bun:test';

import { __testing__OxlintRunner as __testing__ } from '../../../../src/test-api';
import { runGolden } from '../../shared/golden-runner';

const { parseOxlintOutput } = __testing__;

describe('golden/lint', () => {
  const rg = (name: string) =>
    runGolden(import.meta.dir, name, (_, sources) => parseOxlintOutput(Object.values(sources)[0] ?? ''));

  rg('lint-diagnostics');
  rg('lint-empty');
  rg('lint-single-warning');
  rg('lint-error');
  rg('lint-multi');
});
