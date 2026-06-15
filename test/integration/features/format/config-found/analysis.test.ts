import { describe, it } from 'bun:test';

import { expectRcResolvedFromRoot } from '../../../shared/external-tool-test-kit';

describe('integration/format/config-found', () => {
  it('should resolve .oxfmtrc.jsonc only from rootAbs', async () => {
    await expectRcResolvedFromRoot('firebat-format-config-found', '.oxfmtrc.jsonc');
  });
});
