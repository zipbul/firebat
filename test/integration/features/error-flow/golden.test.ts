import { describe } from 'bun:test';

import type { Gildash } from '@zipbul/gildash';

import { analyzeErrorFlow } from '../../../../src/test-api';
import { runGolden } from '../../shared/golden-runner';

const noopGildash = {
  isTypeAssignableToType: () => null,
  getResolvedTypesAtPositions: () => new Map(),
  isTypeAssignableToTypeAtPositions: () => new Map(),
} as unknown as Gildash;

describe('golden/error-flow', () => {
  runGolden(import.meta.dir, 'no-findings', program => analyzeErrorFlow(program, { gildash: noopGildash }));

  runGolden(import.meta.dir, 'try-finally', program => analyzeErrorFlow(program, { gildash: noopGildash }));

  runGolden(import.meta.dir, 'throw-non-error', program => analyzeErrorFlow(program, { gildash: noopGildash }));

  runGolden(import.meta.dir, 'promise-patterns', program => analyzeErrorFlow(program, { gildash: noopGildash }));

  runGolden(import.meta.dir, 'nested-try-catch', program => analyzeErrorFlow(program, { gildash: noopGildash }));

  runGolden(import.meta.dir, 'unobserved-variable', program => analyzeErrorFlow(program, { gildash: noopGildash }));
});
