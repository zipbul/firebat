import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';

import { analyzeLint } from '../../../../../src/features/lint';
import { createTempProject, installFakeBin, writeText } from '../../../shared/external-tool-test-kit';

describe('integration/lint/diagnostics-parse', () => {
  it('should parse JSON diagnostics into a bare array (best-effort normalization)', async () => {
    const project = await createTempProject('firebat-lint-diag-parse');

    try {
      await installFakeBin(
        project.rootAbs,
        'oxlint',
        `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1-}" == "--version" ]]; then
  echo "oxlint 1.46.0"
  exit 0
fi

# Emit a mixed-shape JSON diagnostic list.
cat <<'JSON'
[
  {
    "filename": "src/a.ts",
    "text": "no-unused-vars",
    "ruleId": "no-unused-vars",
    "level": "warning",
    "row": 3,
    "col": 4
  }
]
JSON
exit 1
`,
      );

      const targetAbs = path.join(project.rootAbs, 'src', 'a.ts');

      await writeText(targetAbs, 'export const a = 1;');

      const analysis = await analyzeLint({
        targets: [targetAbs],
        fix: false,
        cwd: project.rootAbs,
      });

      expect(Array.isArray(analysis)).toBe(true);
      expect(analysis.length).toBe(1);

      const diag = analysis[0] as any;

      expect(diag?.msg).toBe('no-unused-vars');
      expect(diag?.code).toBe('no-unused-vars');
      expect(diag?.severity).toBe('error');
      expect(diag?.file).toBe('src/a.ts');
      expect(diag?.span.start.line).toBe(3);
      expect(diag?.span.start.column).toBe(4);
    } finally {
      await project.dispose();
    }
  });
});
