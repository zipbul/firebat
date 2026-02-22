import { describe } from 'bun:test';

import { noBracketNotationRule } from '../../../../../src/oxlint-plugin/rules/no-bracket-notation';
import { runGoldenRule } from '../../../shared/oxlint-golden-runner';

describe('golden/no-bracket-notation', () => {
  runGoldenRule(import.meta.dir, 'bracket-access', noBracketNotationRule);
  runGoldenRule(import.meta.dir, 'no-findings', noBracketNotationRule);
});
