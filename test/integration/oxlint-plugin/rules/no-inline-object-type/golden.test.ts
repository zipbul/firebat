import { describe } from 'bun:test';

import { noInlineObjectTypeRule } from '../../../../../src/oxlint-plugin/rules/no-inline-object-type';
import { runGoldenRule } from '../../../shared/oxlint-golden-runner';

describe('golden/no-inline-object-type', () => {
  runGoldenRule(import.meta.dir, 'inline-param-type', noInlineObjectTypeRule);
  runGoldenRule(import.meta.dir, 'baseline', noInlineObjectTypeRule);
});
