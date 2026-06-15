import { describe, it } from 'bun:test';

import { expectRcNotResolvedFromParent } from '../../../shared/external-tool-test-kit';

describe('integration/format/config-missing', () => {
  it('should not search parent directories for .oxfmtrc.jsonc', async () => {
    await expectRcNotResolvedFromParent('firebat-format-config-parent', '.oxfmtrc.jsonc');
  });
});
