import { describe, expect, it } from 'bun:test';

import { analyzeCoupling } from '../../../../../src/test-api';
import { analyzeDependencies } from '../../../../../src/test-api';
import { createTempGildash } from '../../../shared/gildash-test-kit';

describe('integration/coupling/distance', () => {
  it('should report Zone of Pain when A=0 and I≈0.1 (D>0.7)', async () => {
    // Arrange
    const sources = new Map<string, string>();

    for (let index = 0; index < 9; index += 1) {
      sources.set(`/virtual/coupling/distance/in${index}.ts`, `import './pain';\nexport const in${index} = 1;`);
    }

    sources.set('/virtual/coupling/distance/dep.ts', `export const dep = 1;`);
    sources.set('/virtual/coupling/distance/pain.ts', `import './dep';\nexport const pain = 1;`);

    const { gildash, tmpDir, cleanup } = await createTempGildash(sources);

    try {
      // Act
      const dependencies = await analyzeDependencies(gildash, { rootAbs: tmpDir });
      const hotspots = analyzeCoupling(dependencies);
      const hotspot = hotspots.find(h => h.module.includes('pain'));

      // Assert
      expect(hotspot).toBeDefined();
      expect(hotspot?.metrics.abstractness).toBe(0);
      expect(hotspot?.metrics.instability).toBeCloseTo(0.1, 8);
      expect(hotspot?.metrics.distance).toBeGreaterThan(0.7);
      expect(hotspot?.signals.includes('off-main-sequence')).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('should report Zone of Uselessness when A=1 and I≈0.9 (D>0.7)', async () => {
    // Arrange
    const sources = new Map<string, string>();
    const outCount = 9;

    sources.set('/virtual/coupling/distance/in.ts', `import './useless';\nexport const inValue = 1;`);

    for (let index = 0; index < outCount; index += 1) {
      sources.set(`/virtual/coupling/distance/out${index}.ts`, `export const out${index} = 1;`);
    }

    const outImports = Array.from({ length: outCount }, (_, index) => `import './out${index}';`).join('\n');

    sources.set(
      '/virtual/coupling/distance/useless.ts',
      `${outImports}\nexport interface IService { get(): string }\nexport abstract class Base { abstract run(): void }`,
    );

    const { gildash, tmpDir, cleanup } = await createTempGildash(sources);

    try {
      // Act
      const dependencies = await analyzeDependencies(gildash, { rootAbs: tmpDir });
      const hotspots = analyzeCoupling(dependencies);
      const hotspot = hotspots.find(h => h.module.includes('useless'));

      // Assert
      expect(hotspot).toBeDefined();
      expect(hotspot?.metrics.abstractness).toBe(1);
      expect(hotspot?.metrics.instability).toBeCloseTo(0.9, 8);
      expect(hotspot?.metrics.distance).toBeGreaterThan(0.7);
      expect(hotspot?.signals.includes('off-main-sequence')).toBe(true);
    } finally {
      await cleanup();
    }
  });
});
