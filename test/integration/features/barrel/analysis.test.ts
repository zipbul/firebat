import { describe, expect, it } from 'bun:test';

import { analyzeBarrel, analyzeDependencies } from '../../../../src/test-api';
import { withTempGildash } from '../../shared/gildash-test-kit';
import { createProgramFromMap } from '../../shared/test-kit';

const runBarrel = (sources: Map<string, string>) => {
  return analyzeBarrel(createProgramFromMap(sources), { rootAbs: '/virtual' });
};

const sourcesOf = (entries: Readonly<Record<string, string>>): Map<string, string> => {
  return new Map(Object.entries(entries));
};

interface KindCase {
  title: string;
  expectedKind: string;
  files: Readonly<Record<string, string>>;
}

const kindCases: KindCase[] = [
  {
    title: 'should report export-star when export * is used',
    expectedKind: 'export-star',
    files: {
      '/virtual/foo/index.ts': "export { a } from './a';\n",
      '/virtual/foo/a.ts': "export * from './b';\n",
      '/virtual/foo/b.ts': 'export const b = 1;\n',
    },
  },
  {
    title: 'should report invalid-index-statement when index.ts contains imports/statements',
    expectedKind: 'invalid-index-statement',
    files: {
      '/virtual/pkg/a/index.ts': ["import { internal } from './internal';", 'export { internal };'].join('\n'),
      '/virtual/pkg/a/internal.ts': 'export const internal = 1;\n',
    },
  },
];

const crossDirFiles = (importPath: string): Readonly<Record<string, string>> => {
  return {
    '/virtual/pkg/a/index.ts': "export { internal } from './internal';\n",
    '/virtual/pkg/a/internal.ts': 'export const internal = 1;\n',
    '/virtual/pkg/b/index.ts': "export { consume } from './consumer';\n",
    '/virtual/pkg/b/consumer.ts': [`import { internal } from '${importPath}';`, 'export const consume = internal + 1;'].join(
      '\n',
    ),
  };
};

const crossDirImportCases: KindCase[] = [
  {
    title: 'should report deep-import when importing a file from another directory',
    expectedKind: 'deep-import',
    files: crossDirFiles('../a/internal'),
  },
];

describe('integration/barrel', () => {
  it.each([...kindCases, ...crossDirImportCases])('$title', async ({ expectedKind, files }) => {
    // Act
    const analysis = await runBarrel(sourcesOf(files));

    // Assert
    expect(analysis.some(f => f.kind === expectedKind)).toBe(true);
  });

  it('should ignore dist/** by default', async () => {
    // Arrange: would normally trigger missing-index, but should be ignored by default.
    const sources = sourcesOf({ '/virtual/dist/dir/a.ts': 'export const a = 1;\n' });
    // Act
    const analysis = await runBarrel(sources);

    // Assert
    expect(analysis.length).toBe(0);
  });

  // ── barrel-surgery (settled definition) — C1: circular-dependency × barrel ──
  // PLAN-barrel-surgery.md D18 (circular-dependency catalog gains a line about
  // never resolving a cycle by deep-importing): these lock the underlying
  // premise — a value cycle CAN be formed entirely through barrel-compliant
  // routing (directory-surface imports + own-subtree re-exports), so
  // circular-dependency and barrel are orthogonal detectors that can both fire
  // (or both stay silent) on the same sources. GREEN today: dependencies'
  // Tarjan cycle detection and barrel's own-subtree aggregation exemption are
  // both already-correct, unrelated to the D1–D19 kind surgery.

  describe('barrel-circular-pair — barrel-compliant routing can still form a value cycle', () => {
    const circularSources = sourcesOf({
      '/virtual/a/index.ts': "export { implA } from './impl';\n",
      '/virtual/a/impl.ts': ["import { implB } from '../b';", 'export const implA = () => implB() + 1;'].join('\n'),
      '/virtual/b/index.ts': "export { implB } from './impl';\n",
      '/virtual/b/impl.ts': ["import { implA } from '../a';", 'export const implB = () => implA() + 1;'].join('\n'),
    });

    it('analyzeDependencies reports exactly 1 circular-dependency', async () => {
      const dependencies = await withTempGildash(circularSources, (gildash, tmpDir) =>
        analyzeDependencies(gildash, { rootAbs: tmpDir }),
      );

      expect(dependencies.cycles.length).toBe(1);
    });

    it('analyzeBarrel over the same sources reports zero findings (compliant)', async () => {
      const analysis = await runBarrel(circularSources);

      expect(analysis.length).toBe(0);
    });
  });

  describe('import-type-escape — converting one cycle leg to `import type` breaks the value cycle', () => {
    const importTypeEscapeSources = sourcesOf({
      '/virtual/a/index.ts': "export { implA } from './impl';\n",
      '/virtual/a/impl.ts': ["import { implB } from '../b';", 'export const implA = () => implB() + 1;'].join('\n'),
      '/virtual/b/index.ts': "export { implB } from './impl';\n",
      '/virtual/b/impl.ts': ["import type { implA } from '../a';", 'export const implB: typeof implA = () => 1;'].join('\n'),
    });

    it('analyzeDependencies reports zero circular-dependency (type-only edge excluded)', async () => {
      const dependencies = await withTempGildash(importTypeEscapeSources, (gildash, tmpDir) =>
        analyzeDependencies(gildash, { rootAbs: tmpDir }),
      );

      expect(dependencies.cycles).toEqual([]);
    });

    it('analyzeBarrel over the same sources still reports zero findings', async () => {
      const analysis = await runBarrel(importTypeEscapeSources);

      expect(analysis.length).toBe(0);
    });
  });
});
