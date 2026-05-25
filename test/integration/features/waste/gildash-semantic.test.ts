/**
 * Integration test: waste detector through gildash's Semantic Layer.
 *
 * Sets up a real Gildash instance over the firebat repo with `semantic: true`,
 * registers it as the active binding source via `setGildashSemanticContext`,
 * and runs the waste detector against fixtures via their real on-disk paths.
 * Verifies that the tsc-backed `getFileBindings` path produces the same KEEP/
 * DEAD verdicts as the ScopeTracker fallback on the same fixtures, AND that
 * the var-hoisting case continues to resolve correctly.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Gildash } from '@zipbul/gildash';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { detectWaste, parseSource } from '../../../../src/test-api';
import {
  setGildashSemanticContext,
} from '../../../../src/engine/dataflow/gildash-binding-source';

const PROJECT_ROOT = path.resolve(__dirname, '../../../..');

describe('waste detector via gildash semantic layer', () => {
  let g: Gildash;

  beforeAll(async () => {
    g = await Gildash.open({
      projectRoot: PROJECT_ROOT,
      semantic: true,
      watchMode: false,
    });
    setGildashSemanticContext(g);
  });

  afterAll(async () => {
    setGildashSemanticContext(null);
    await g.close({ cleanup: true });
  });

  const runDetectOnFixture = (relPath: string) => {
    const absPath = path.join(PROJECT_ROOT, relPath);
    const src = fs.readFileSync(absPath, 'utf8');
    const parsed = parseSource(absPath, src);

    return detectWaste([parsed]);
  };

  it('var-hoist-for-init: outer ref resolves to inner var binding → KEEP', () => {
    const findings = runDetectOnFixture(
      'test/integration/features/waste/__fixtures__/var-hoist-for-init-keep.ts',
    );

    expect(findings).toEqual([]);
  });

  it('var-hoist-block: var in if-branch resolves to function scope → KEEP', () => {
    const findings = runDetectOnFixture(
      'test/integration/features/waste/__fixtures__/var-hoist-block-keep.ts',
    );

    expect(findings).toEqual([]);
  });

  it('case 7 positive: no-escape-object DEAD via gildash binding', () => {
    const findings = runDetectOnFixture(
      'test/integration/features/waste/__fixtures__/no-escape-object.ts',
    );

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f: { kind: string }) => f.kind === 'dead-store')).toBe(true);
  });

  it('case 6 positive: no-escape-accumulator DEAD via gildash binding', () => {
    const findings = runDetectOnFixture(
      'test/integration/features/waste/__fixtures__/no-escape-accumulator.ts',
    );

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f: { kind: string }) => f.kind === 'dead-store')).toBe(true);
  });

  it('closure-read KEEP boundary holds via gildash binding', () => {
    const findings = runDetectOnFixture(
      'test/integration/features/waste/__fixtures__/closure-read.ts',
    );

    expect(findings).toEqual([]);
  });
});
