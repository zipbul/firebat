import { describe } from 'bun:test';

import { __testing__FormatAnalyzer as __testing__ } from '../../../../src/test-api';
import { runGolden } from '../../shared/golden-runner';

const { parseOxfmtFiles } = __testing__;

describe('golden/format', () => {
  const rg = (name: string) => runGolden(import.meta.dir, name, (_, sources) => parseOxfmtFiles(Object.values(sources)[0] ?? ''));

  rg('oxfmt-paths');
  rg('oxfmt-empty');
  rg('oxfmt-single');
  rg('oxfmt-with-noise');
  rg('oxfmt-non-ts');
});
