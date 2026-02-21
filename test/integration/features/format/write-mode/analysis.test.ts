import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';

import { analyzeFormat } from '../../../../../src/features/format';
import { createTempProject, installFakeBin, readText, writeText } from '../../../shared/external-tool-test-kit';

describe('integration/format/write-mode', () => {
  it('should pass --write and --config when provided', async () => {
    const project = await createTempProject('firebat-format-write');

    try {
      const argsFileAbs = path.join(project.rootAbs, 'args.txt');
      const configAbs = path.join(project.rootAbs, '.oxfmtrc.jsonc');

      await writeText(configAbs, '{ /* fmt config */ }');

      await installFakeBin(
        project.rootAbs,
        'oxfmt',
        `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1-}" == "--version" ]]; then
  echo "oxfmt 0.26.0"
  exit 0
fi

printf "%s\n" "$@" > "${argsFileAbs}"
exit 0
`,
      );

      const targetAbs = path.join(project.rootAbs, 'src', 'a.ts');

      await writeText(targetAbs, 'export const a = 1;');

      const analysis = await analyzeFormat({
        targets: [targetAbs],
        fix: true,
        configPath: configAbs,
        cwd: project.rootAbs,
      });

      expect(analysis).toEqual([]);

      const argsText = await readText(argsFileAbs);

      expect(argsText).toContain('--write');
      expect(argsText).toContain('--config');
      expect(argsText).toContain(configAbs);
    } finally {
      await project.dispose();
    }
  });
});
