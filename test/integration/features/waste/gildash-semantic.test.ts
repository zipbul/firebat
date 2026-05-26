/**
 * Integration test: waste detector through gildash's Semantic Layer.
 *
 * Uses the preload-bootstrapped Gildash instance (test/integration/shared/
 * global-setup.ts). Verifies that with `setGildashSemanticContext` active,
 * the tsc-backed `getFileBindings` path drives binding resolution and
 * produces correct KEEP/DEAD verdicts on real disk fixtures.
 */
import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { detectWaste, parseSource } from '../../../../src/test-api';
import { getGildashSemanticContext } from '../../../../src/engine/dataflow/gildash-binding-source';

describe('waste detector via gildash semantic layer', () => {
  it('preload-registered gildash context is available', () => {
    expect(getGildashSemanticContext()).not.toBeNull();
  });

  const runDetectOnFixture = (relPath: string) => {
    const absPath = path.resolve(__dirname, '../../..', relPath);
    const src = fs.readFileSync(absPath, 'utf8');
    const virtualPath = `/virtual/${path.basename(absPath)}`;
    const parsed = parseSource(virtualPath, src);

    return detectWaste([parsed]);
  };

  it('var-hoist-for-init: outer ref resolves to inner var binding → KEEP', () => {
    const findings = runDetectOnFixture(
      'integration/features/waste/__fixtures__/var-hoist-for-init-keep.ts',
    );

    expect(findings).toEqual([]);
  });

  it('var-hoist-block: var in if-branch resolves to function scope → KEEP', () => {
    const findings = runDetectOnFixture(
      'integration/features/waste/__fixtures__/var-hoist-block-keep.ts',
    );

    expect(findings).toEqual([]);
  });

  it('case 7 positive: no-escape-object DEAD via gildash binding', () => {
    const findings = runDetectOnFixture(
      'integration/features/waste/__fixtures__/no-escape-object.ts',
    );

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f: { kind: string }) => f.kind === 'dead-store')).toBe(true);
  });

  it('case 6 positive: no-escape-accumulator DEAD via gildash binding', () => {
    const findings = runDetectOnFixture(
      'integration/features/waste/__fixtures__/no-escape-accumulator.ts',
    );

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f: { kind: string }) => f.kind === 'dead-store')).toBe(true);
  });

  it('closure-read KEEP boundary holds via gildash binding', () => {
    const findings = runDetectOnFixture(
      'integration/features/waste/__fixtures__/closure-read.ts',
    );

    expect(findings).toEqual([]);
  });
});
