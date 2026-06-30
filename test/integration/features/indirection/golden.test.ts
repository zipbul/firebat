import { describe } from 'bun:test';
import * as path from 'node:path';

import type { FixtureSources } from '../../shared/golden-runner';

import { analyzeIndirection, parseSource } from '../../../../src/test-api';
import { withTempGildash } from '../../shared/gildash-test-kit';
import { runGolden } from '../../shared/golden-runner';

// Golden runs against a REAL Gildash (withTempGildash writes the fixture to a temp
// dir and opens production Gildash), matching the dependencies/coupling goldens.
// No mock: cross-file resolution, export status, overload counting and symbol
// lookups all exercise the production gildash path. indirection needs only the
// symbol/relation index (no isTypeAssignableTo), so `semantic` is not required.
//
// Finding paths are relativized tmpDir → /virtual so snapshots stay stable.
const VIRTUAL = '/virtual';

const toVirtual = (filePath: string, tmpDir: string): string => {
  const normalizedTmp = tmpDir.replace(/\\/g, '/');
  const normalizedFile = filePath.replace(/\\/g, '/');
  const idx = normalizedFile.indexOf(normalizedTmp);

  if (idx === -1) {
    return filePath;
  }

  return `${VIRTUAL}${normalizedFile.slice(idx + normalizedTmp.length)}`;
};

describe('golden/indirection', () => {
  const rg = (name: string, maxForwardDepth = 1) =>
    runGolden(import.meta.dir, name, (_program, sources: FixtureSources) =>
      withTempGildash(sources, async (gildash, tmpDir) => {
        const program = Object.entries(sources).map(([virtualPath, src]) => {
          const rel = virtualPath.startsWith(`${VIRTUAL}/`) ? virtualPath.slice(VIRTUAL.length + 1) : virtualPath;

          return parseSource(path.join(tmpDir, rel), src);
        });
        const findings = await analyzeIndirection(gildash, program, { maxForwardDepth, crossFileMinDepth: 2 }, tmpDir);

        return findings.map(f => ({ ...f, filePath: toVirtual(f.filePath, tmpDir) }));
      }),
    );

  rg('thin-wrapper');
  rg('no-findings');
  rg('wrapper2');
  rg('direct-util');
  rg('format-chain');
  rg('chain-depth');
  rg('param-patterns');
  rg('type-remap', 0);
  rg('interface-rewrap', 0);
  rg('mixed-indirection');

  // K-gate branches (definition coverage): reference·identity ②, receiver ③,
  // arg/async/generator/predicate/accessor ①④⑤⑥, class, overload, BVA, cross-file cycle.
  rg('reference-identity');
  rg('receiver-gate');
  rg('arg-async-gates');
  rg('class-rewrap', 0);
  rg('interface-script', 0);
  rg('chain-boundary', 2);
  rg('overload-wrapper', 0);
  rg('cross-file-cycle', 5);
});
