import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';

import { resolveToolRcPath } from '../../../../../src/test-api';
import { createTempProject, writeText } from '../../../shared/external-tool-test-kit';

describe('integration/format/config-found', () => {
  it('should resolve .oxfmtrc.jsonc only from rootAbs', async () => {
    const project = await createTempProject('firebat-format-config-found');

    try {
      const configAbs = path.join(project.rootAbs, '.oxfmtrc.jsonc');

      await writeText(configAbs, '{ /* test */ }');

      const resolved = await resolveToolRcPath(project.rootAbs, '.oxfmtrc.jsonc');

      expect(resolved).toBe(configAbs);
    } finally {
      await project.dispose();
    }
  });
});
