import { describe } from 'bun:test';

import { analyzeForwarding } from '../../../../src/features/forwarding';
import { runGolden } from '../../shared/golden-runner';

describe('golden/forwarding', () => {
  runGolden(import.meta.dir, 'thin-wrapper', program =>
    analyzeForwarding(program, 1),
  );

  runGolden(import.meta.dir, 'no-findings', program =>
    analyzeForwarding(program, 1),
  );

  runGolden(import.meta.dir, 'wrapper2', program =>
    analyzeForwarding(program, 1),
  );

  runGolden(import.meta.dir, 'direct-util', program =>
    analyzeForwarding(program, 1),
  );

  runGolden(import.meta.dir, 'format-chain', program =>
    analyzeForwarding(program, 1),
  );
});
