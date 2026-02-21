import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';

import { resolveToolRcPath } from '../../../../../src/application/scan/scan.usecase';
import { createTempProject, writeText } from '../../../shared/external-tool-test-kit';

describe('integration/lint/config-missing', () => {
  it('should not search parent directories for .oxlintrc.jsonc', async () => {
    const parent = await createTempProject('firebat-lint-config-parent');

    try {
      const childAbs = path.join(parent.rootAbs, 'child');

      await writeText(path.join(parent.rootAbs, '.oxlintrc.jsonc'), '{ /* parent */ }');
      await writeText(path.join(childAbs, 'placeholder.txt'), 'ok');

      const resolved = await resolveToolRcPath(childAbs, '.oxlintrc.jsonc');

      expect(resolved).toBeUndefined();
    } finally {
      await parent.dispose();
    }
  });
});
