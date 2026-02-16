import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';

import { analyzeLint } from '../../../../src/features/lint';
import { createTempProject, writeText } from '../../shared/external-tool-test-kit';

describe('integration/lint/binary-missing', () => {
  it("should throw when oxlint binary can't be resolved (project-only)", async () => {
    const project = await createTempProject('firebat-lint-missing-bin');

    try {
      const targetAbs = path.join(project.rootAbs, 'src', 'a.ts');

      await writeText(targetAbs, 'export const a = 1;');

      await expect(
        analyzeLint({
          targets: [targetAbs],
          fix: false,
          cwd: project.rootAbs,
          resolveMode: 'project-only',
        }),
      ).rejects.toMatchObject({ message: expect.stringContaining('not available') });
    } finally {
      await project.dispose();
    }
  });
});
