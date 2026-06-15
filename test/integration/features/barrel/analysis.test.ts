import { describe, expect, it } from 'bun:test';

import { analyzeBarrel } from '../../../../src/test-api';
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
    title: 'should report missing index when a directory contains source files',
    expectedKind: 'missing-index',
    files: { '/virtual/pkg/dir/a.ts': 'export const a = 1;' },
  },
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
  {
    title: 'should report barrel-side-effect-import when index.ts contains side-effect imports',
    expectedKind: 'barrel-side-effect-import',
    files: {
      '/virtual/pkg/a/index.ts': ["import './polyfill';", "export { internal } from './internal';"].join('\n'),
      '/virtual/pkg/a/polyfill.ts': 'globalThis.__polyfilled = true;\n',
      '/virtual/pkg/a/internal.ts': 'export const internal = 1;\n',
    },
  },
];

const crossDirFiles = (importPath: string): Readonly<Record<string, string>> => {
  return {
    '/virtual/pkg/a/index.ts': "export { internal } from './internal';\n",
    '/virtual/pkg/a/internal.ts': 'export const internal = 1;\n',
    '/virtual/pkg/b/index.ts': "export { consume } from './consumer';\n",
    '/virtual/pkg/b/consumer.ts': [`import { internal } from '${importPath}';`, 'export const consume = internal + 1;'].join('\n'),
  };
};

const crossDirImportCases: KindCase[] = [
  {
    title: 'should report deep-import when importing a file from another directory',
    expectedKind: 'deep-import',
    files: crossDirFiles('../a/internal'),
  },
  {
    title: 'should report index-deep-import when importing /index explicitly from another directory',
    expectedKind: 'index-deep-import',
    files: crossDirFiles('../a/index'),
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
});
