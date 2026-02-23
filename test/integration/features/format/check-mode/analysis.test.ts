import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';

import { analyzeFormat } from '../../../../../src/test-api';
import { createTempProject, installFakeBin, writeText } from '../../../shared/external-tool-test-kit';

describe('integration/format/check-mode', () => {
  it('should return file paths when exit code is non-zero and stdout contains paths', async () => {
    const project = await createTempProject('firebat-format-check');

    try {
      await installFakeBin(
        project.rootAbs,
        'oxfmt',
        `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1-}" == "--version" ]]; then
  echo "oxfmt 0.26.0"
  exit 0
fi

# In check mode, exit non-zero and print path-like lines.
target="\${@: -1}"
echo "\${target}"
exit 7
`,
      );

      const targetAbs = path.join(project.rootAbs, 'src', 'a.ts');

      await writeText(targetAbs, 'export const a = 1;');

      const analysis = await analyzeFormat({
        targets: [targetAbs],
        fix: false,
        cwd: project.rootAbs,
      });

      expect(Array.isArray(analysis)).toBe(true);
      expect(analysis.length).toBe(1);
      expect(analysis[0]).toBe(targetAbs);
    } finally {
      await project.dispose();
    }
  });

  it('should return an empty array when exit code is 0 (even if stdout has lines)', async () => {
    const project = await createTempProject('firebat-format-check-ok');

    try {
      await installFakeBin(
        project.rootAbs,
        'oxfmt',
        `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1-}" == "--version" ]]; then
  echo "oxfmt 0.26.0"
  exit 0
fi

echo "random output that should not flip status"
echo "src/a.ts"
exit 0
`,
      );

      const targetAbs = path.join(project.rootAbs, 'src', 'a.ts');

      await writeText(targetAbs, 'export const a = 1;');

      const analysis = await analyzeFormat({
        targets: [targetAbs],
        fix: false,
        cwd: project.rootAbs,
      });

      expect(analysis).toEqual([]);
    } finally {
      await project.dispose();
    }
  });
});
