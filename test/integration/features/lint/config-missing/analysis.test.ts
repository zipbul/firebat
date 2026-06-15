import { describe, it } from 'bun:test';

import { expectRcNotResolvedFromParent } from '../../../shared/external-tool-test-kit';

describe('integration/lint/config-missing', () => {
  it('should not search parent directories for .oxlintrc.jsonc', async () => {
    await expectRcNotResolvedFromParent('firebat-lint-config-parent', '.oxlintrc.jsonc');
  });
});
