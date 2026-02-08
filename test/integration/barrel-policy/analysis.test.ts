import { describe, expect, it } from 'bun:test';

import { analyzeBarrelPolicy } from '../../../src/features/barrel-policy';
import { createProgramFromMap } from '../shared/test-kit';

describe('integration/barrel-policy', () => {
  it('should report missing index when a directory contains source files', async () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/pkg/dir/a.ts', ['export const a = 1;'].join('\n'));

    // Act
    let program = createProgramFromMap(sources);
    let analysis = await analyzeBarrelPolicy(program, { rootAbs: '/virtual' });

    // Assert
    expect(analysis.findings.some(f => f.kind === 'missing-index')).toBe(true);
  });

  it('should report export-star when export * is used', async () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/foo/index.ts', "export { a } from './a';\n");
    sources.set('/virtual/foo/a.ts', "export * from './b';\n");
    sources.set('/virtual/foo/b.ts', 'export const b = 1;\n');

    // Act
    let program = createProgramFromMap(sources);
    let analysis = await analyzeBarrelPolicy(program, { rootAbs: '/virtual' });

    // Assert
    expect(analysis.findings.some(f => f.kind === 'export-star')).toBe(true);
  });

  it('should report deep-import when importing a file from another directory', async () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/pkg/a/index.ts', "export { internal } from './internal';\n");
    sources.set('/virtual/pkg/a/internal.ts', 'export const internal = 1;\n');
    sources.set('/virtual/pkg/b/index.ts', "export { consume } from './consumer';\n");
    sources.set(
      '/virtual/pkg/b/consumer.ts',
      ["import { internal } from '../a/internal';", 'export const consume = internal + 1;'].join('\n'),
    );

    // Act
    let program = createProgramFromMap(sources);
    let analysis = await analyzeBarrelPolicy(program, { rootAbs: '/virtual' });

    // Assert
    expect(analysis.findings.some(f => f.kind === 'deep-import')).toBe(true);
  });

  it('should report index-deep-import when importing /index explicitly from another directory', async () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/pkg/a/index.ts', "export { internal } from './internal';\n");
    sources.set('/virtual/pkg/a/internal.ts', 'export const internal = 1;\n');
    sources.set('/virtual/pkg/b/index.ts', "export { consume } from './consumer';\n");
    sources.set(
      '/virtual/pkg/b/consumer.ts',
      ["import { internal } from '../a/index';", 'export const consume = internal + 1;'].join('\n'),
    );

    // Act
    let program = createProgramFromMap(sources);
    let analysis = await analyzeBarrelPolicy(program, { rootAbs: '/virtual' });

    // Assert
    expect(analysis.findings.some(f => f.kind === 'index-deep-import')).toBe(true);
  });

  it('should report invalid-index-statement when index.ts contains imports/statements', async () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/pkg/a/index.ts', ["import { internal } from './internal';", 'export { internal };'].join('\n'));
    sources.set('/virtual/pkg/a/internal.ts', 'export const internal = 1;\n');

    // Act
    let program = createProgramFromMap(sources);
    let analysis = await analyzeBarrelPolicy(program, { rootAbs: '/virtual' });

    // Assert
    expect(analysis.findings.some(f => f.kind === 'invalid-index-statement')).toBe(true);
  });

  it('should ignore dist/** by default', async () => {
    // Arrange
    let sources = new Map<string, string>();

    // Would normally trigger missing-index, but should be ignored by default.
    sources.set('/virtual/dist/dir/a.ts', 'export const a = 1;\n');

    // Act
    let program = createProgramFromMap(sources);
    let analysis = await analyzeBarrelPolicy(program, { rootAbs: '/virtual' });

    // Assert
    expect(analysis.findings.length).toBe(0);
  });
});
