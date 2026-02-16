import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';

import { analyzeLint } from '../../../../src/features/lint';
import { createTempProject, installFakeBin, readText, writeText } from '../../shared/external-tool-test-kit';

describe('integration/lint/fix-mode', () => {
  it('should pass --fix and --config when provided', async () => {
    const project = await createTempProject('firebat-lint-fix');

    try {
      const argsFileAbs = path.join(project.rootAbs, 'args.txt');
      const configAbs = path.join(project.rootAbs, '.oxlintrc.jsonc');

      await writeText(configAbs, '{ /* lint config */ }');

      await installFakeBin(
        project.rootAbs,
        'oxlint',
        `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1-}" == "--version" ]]; then
  echo "oxlint 1.46.0"
  exit 0
fi

printf "%s\n" "$@" > "${argsFileAbs}"
# Return a valid JSON payload even in fix mode.
echo '[]'
exit 0
`,
      );

      const targetAbs = path.join(project.rootAbs, 'src', 'a.ts');

      await writeText(targetAbs, 'export const a = 1;');

      const analysis = await analyzeLint({
        targets: [targetAbs],
        fix: true,
        configPath: configAbs,
        cwd: project.rootAbs,
      });

      expect(analysis).toEqual([]);

      const argsText = await readText(argsFileAbs);

      expect(argsText).toContain('--fix');
      expect(argsText).toContain('--config');
      expect(argsText).toContain(configAbs);
    } finally {
      await project.dispose();
    }
  });
});
