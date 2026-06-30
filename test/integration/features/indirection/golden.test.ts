import { describe } from 'bun:test';

import type { FixtureSources } from '../../shared/golden-runner';

import { runGolden } from '../../shared/golden-runner';
import { analyzeIndirectionReal } from './real-gildash';

// Golden runs against a REAL Gildash (analyzeIndirectionReal → withTempGildash),
// matching the dependencies/coupling goldens. No mock: cross-file resolution,
// export status, overload counting and symbol lookups all exercise production
// gildash. Finding paths are relativized tmpDir → /virtual so snapshots stay stable.
describe('golden/indirection', () => {
  const rg = (name: string, maxForwardDepth = 1) =>
    runGolden(import.meta.dir, name, (_program, sources: FixtureSources) =>
      analyzeIndirectionReal(sources, { maxForwardDepth, crossFileMinDepth: 2 }),
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
  rg('self-recursive'); // K — self-recursive wrapper (no layer to inline)
  rg('exported-wrapper'); // K — exported single-delegation (cross-module, AST export status)
});
