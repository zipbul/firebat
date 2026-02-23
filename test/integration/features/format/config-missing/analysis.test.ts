import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';

import { resolveToolRcPath } from '../../../../../src/test-api';
import { createTempProject, writeText } from '../../../shared/external-tool-test-kit';

describe('integration/format/config-missing', () => {
  it('should not search parent directories for .oxfmtrc.jsonc', async () => {
    const parent = await createTempProject('firebat-format-config-parent');

    try {
      const childAbs = path.join(parent.rootAbs, 'child');

      await writeText(path.join(parent.rootAbs, '.oxfmtrc.jsonc'), '{ /* parent */ }');
      await writeText(path.join(childAbs, 'placeholder.txt'), 'ok');

      const resolved = await resolveToolRcPath(childAbs, '.oxfmtrc.jsonc');

      expect(resolved).toBeUndefined();
    } finally {
      await parent.dispose();
    }
  });
});
