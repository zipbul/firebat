import { describe, expect, it } from 'bun:test';

import { analyzeCoupling } from '../../../../src/test-api';
import { analyzeDependencies } from '../../../../src/test-api';
import { withTempGildash } from '../../shared/gildash-test-kit';

describe('integration/coupling', () => {
  it('should detect off-main-sequence when module is stable and concrete', async () => {
    // Arrange
    const sources = new Map<string, string>();

    sources.set('/virtual/coupling/a.ts', `import './shared';\nexport const alpha = 1;`);
    sources.set('/virtual/coupling/b.ts', `import './shared';\nexport const beta = 2;`);
    sources.set('/virtual/coupling/shared.ts', `export const shared = 3;`);

    await withTempGildash(sources, async (gildash, tmpDir) => {
      // Act
      const dependencies = await analyzeDependencies(gildash, { rootAbs: tmpDir });
      const hotspots = analyzeCoupling(dependencies);
      const hotspot = hotspots.find(entry => entry.module.includes('shared'));

      // Assert
      expect(hotspot).toBeDefined();
      expect(hotspot?.signals.includes('off-main-sequence')).toBe(true);
    });
  });

  it('should return empty hotspots when dependencies are empty', async () => {
    // Arrange
    const sources = new Map<string, string>();

    await withTempGildash(sources, async (gildash, tmpDir) => {
      const dependencies = await analyzeDependencies(gildash, { rootAbs: tmpDir });
      // Act
      const hotspots = analyzeCoupling(dependencies);

      // Assert
      expect(hotspots.length).toBe(0);
    });
  });

  it('should include fan-in signals when dependencies are shared', async () => {
    // Arrange
    const sources = new Map<string, string>();

    sources.set('/virtual/coupling/a.ts', `import './shared';\nexport const alpha = 1;`);
    sources.set('/virtual/coupling/b.ts', `import './shared';\nexport const beta = 2;`);
    sources.set('/virtual/coupling/shared.ts', `export const shared = 3;`);

    await withTempGildash(sources, async (gildash, tmpDir) => {
      // Act
      const dependencies = await analyzeDependencies(gildash, { rootAbs: tmpDir });
      const hotspots = analyzeCoupling(dependencies);
      const hotspot = hotspots.find(entry => entry.module.includes('shared'));

      // Assert
      expect(hotspot).toBeDefined();
      expect(hotspot?.metrics.fanIn).toBeGreaterThanOrEqual(1);
    });
  });

  it('should sort hotspots by score then module name when tied', async () => {
    // Arrange
    const sources = new Map<string, string>();

    sources.set('/virtual/coupling/a.ts', `import './x';\nexport const alpha = 1;`);
    sources.set('/virtual/coupling/b.ts', `import './y';\nexport const beta = 2;`);
    sources.set('/virtual/coupling/x.ts', `export const x = 3;`);
    sources.set('/virtual/coupling/y.ts', `export const y = 4;`);

    await withTempGildash(sources, async (gildash, tmpDir) => {
      // Act
      const dependencies = await analyzeDependencies(gildash, { rootAbs: tmpDir });
      const hotspots = analyzeCoupling(dependencies);
      const names = hotspots.map(entry => entry.module);

      // Assert
      expect(names.length).toBeGreaterThanOrEqual(2);

      const sortedNames = [...names].sort((left, right) => left.localeCompare(right));

      expect(names[0]).toBe(sortedNames[0]);
    });
  });
});
