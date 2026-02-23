import { describe } from 'bun:test';

import { __testing__OxlintRunner as __testing__ } from '../../../../src/test-api';
import { runGolden } from '../../shared/golden-runner';

const { parseOxlintOutput } = __testing__;

describe('golden/lint', () => {
  runGolden(import.meta.dir, 'lint-diagnostics', (_, sources) => {
    const rawJson = Object.values(sources)[0] ?? '';
    return parseOxlintOutput(rawJson);
  });

  runGolden(import.meta.dir, 'lint-empty', (_, sources) => {
    const rawJson = Object.values(sources)[0] ?? '';
    return parseOxlintOutput(rawJson);
  });

  runGolden(import.meta.dir, 'lint-single-warning', (_, sources) => {
    const rawJson = Object.values(sources)[0] ?? '';
    return parseOxlintOutput(rawJson);
  });

  runGolden(import.meta.dir, 'lint-error', (_, sources) => {
    const rawJson = Object.values(sources)[0] ?? '';
    return parseOxlintOutput(rawJson);
  });

  runGolden(import.meta.dir, 'lint-multi', (_, sources) => {
    const rawJson = Object.values(sources)[0] ?? '';
    return parseOxlintOutput(rawJson);
  });
});
