import { describe, it } from 'bun:test';

import { expectRcResolvedFromRoot } from '../../../shared/external-tool-test-kit';

describe('integration/lint/config-found', () => {
  it('should resolve .oxlintrc.jsonc only from rootAbs', async () => {
    await expectRcResolvedFromRoot('firebat-lint-config-found', '.oxlintrc.jsonc');
  });
});
