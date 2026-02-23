import { describe } from 'bun:test';

import { __testing__FormatAnalyzer as __testing__ } from '../../../../src/test-api';
import { runGolden } from '../../shared/golden-runner';

const { parseOxfmtFiles } = __testing__;

describe('golden/format', () => {
  runGolden(import.meta.dir, 'oxfmt-paths', (_, sources) => {
    const rawStdout = Object.values(sources)[0] ?? '';
    return parseOxfmtFiles(rawStdout);
  });

  runGolden(import.meta.dir, 'oxfmt-empty', (_, sources) => {
    const rawStdout = Object.values(sources)[0] ?? '';
    return parseOxfmtFiles(rawStdout);
  });

  runGolden(import.meta.dir, 'oxfmt-single', (_, sources) => {
    const rawStdout = Object.values(sources)[0] ?? '';
    return parseOxfmtFiles(rawStdout);
  });

  runGolden(import.meta.dir, 'oxfmt-with-noise', (_, sources) => {
    const rawStdout = Object.values(sources)[0] ?? '';
    return parseOxfmtFiles(rawStdout);
  });

  runGolden(import.meta.dir, 'oxfmt-non-ts', (_, sources) => {
    const rawStdout = Object.values(sources)[0] ?? '';
    return parseOxfmtFiles(rawStdout);
  });
});
