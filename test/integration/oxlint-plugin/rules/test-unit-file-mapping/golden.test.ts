import { describe } from 'bun:test';

import { testUnitFileMappingRule } from '../../../../../src/test-api';
import { runGoldenRule } from '../../../shared/oxlint-golden-runner';

describe('golden/test-unit-file-mapping', () => {
  // missing-spec: logicful .ts file whose spec does NOT exist -> reports missingSpec
  runGoldenRule(import.meta.dir, 'missing-spec', testUnitFileMappingRule, {
    filename: '/virtual/missing-spec.ts',
    fileExists: () => false,
  });
  // no-findings: logicful .ts file whose spec DOES exist -> no report
  runGoldenRule(import.meta.dir, 'no-findings', testUnitFileMappingRule, {
    filename: '/virtual/no-findings.ts',
    fileExists: () => true,
  });
});
