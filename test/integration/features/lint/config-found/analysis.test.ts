import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';

import { resolveToolRcPath } from '../../../../../src/application/scan/scan.usecase';
import { createTempProject, writeText } from '../../../shared/external-tool-test-kit';

describe('integration/lint/config-found', () => {
  it('should resolve .oxlintrc.jsonc only from rootAbs', async () => {
    const project = await createTempProject('firebat-lint-config-found');

    try {
      const configAbs = path.join(project.rootAbs, '.oxlintrc.jsonc');

      await writeText(configAbs, '{ /* test */ }');

      const resolved = await resolveToolRcPath(project.rootAbs, '.oxlintrc.jsonc');

      expect(resolved).toBe(configAbs);
    } finally {
      await project.dispose();
    }
  });
});
