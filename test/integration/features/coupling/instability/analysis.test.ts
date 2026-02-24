import { describe, expect, it } from 'bun:test';

import { analyzeCoupling } from '../../../../../src/test-api';
import { analyzeDependencies } from '../../../../../src/test-api';
import { createTempGildash } from '../../../shared/gildash-test-kit';

describe('integration/coupling/instability', () => {
  it('should compute I=0 when module has Ca>0 and Ce=0', async () => {
    // Arrange
    const sources = new Map<string, string>();

    sources.set('/virtual/coupling/instability/a.ts', `import './stable';\nexport const a = 1;`);
    sources.set('/virtual/coupling/instability/b.ts', `import './stable';\nexport const b = 2;`);
    sources.set('/virtual/coupling/instability/stable.ts', `export const stable = 3;`);

    const { gildash, tmpDir, cleanup } = await createTempGildash(sources);

    try {
      // Act
      const dependencies = await analyzeDependencies(gildash, { rootAbs: tmpDir });
      const hotspots = analyzeCoupling(dependencies);
      const hotspot = hotspots.find(h => h.module.includes('stable'));

      // Assert
      expect(hotspot).toBeDefined();
      expect(hotspot?.metrics.instability).toBe(0);
    } finally {
      await cleanup();
    }
  });

  it('should compute I=1 when module has Ca=0 and Ce>5', async () => {
    // Arrange
    const sources = new Map<string, string>();
    const targetCount = 6;

    for (let index = 0; index < targetCount; index += 1) {
      sources.set(`/virtual/coupling/instability/t${index}.ts`, `export const t${index} = ${index};`);
    }

    const imports = Array.from({ length: targetCount }, (_, index) => `import './t${index}';`).join('\n');

    sources.set('/virtual/coupling/instability/unstable.ts', `${imports}\nexport const unstable = 1;`);

    const { gildash, tmpDir, cleanup } = await createTempGildash(sources);

    try {
      // Act
      const dependencies = await analyzeDependencies(gildash, { rootAbs: tmpDir });
      const hotspots = analyzeCoupling(dependencies);
      const hotspot = hotspots.find(h => h.module.includes('unstable'));

      // Assert
      expect(hotspot).toBeDefined();
      expect(hotspot?.metrics.instability).toBe(1);
      expect(hotspot?.signals.includes('unstable-module')).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('should compute I=0.5 when module has Ca>10 and Ce>10', async () => {
    // Arrange
    const sources = new Map<string, string>();
    const fan = 11;

    for (let index = 0; index < fan; index += 1) {
      sources.set(`/virtual/coupling/instability/in${index}.ts`, `import './core';\nexport const in${index} = 1;`);
    }

    const coreImports = Array.from({ length: fan }, (_, index) => `import './out${index}';`).join('\n');

    sources.set('/virtual/coupling/instability/core.ts', `${coreImports}\nexport const core = 1;`);

    for (let index = 0; index < fan; index += 1) {
      sources.set(`/virtual/coupling/instability/out${index}.ts`, `export const out${index} = 1;`);
    }

    const { gildash, tmpDir, cleanup } = await createTempGildash(sources);

    try {
      // Act
      const dependencies = await analyzeDependencies(gildash, { rootAbs: tmpDir });
      const hotspots = analyzeCoupling(dependencies);
      const hotspot = hotspots.find(h => h.module.includes('core'));

      // Assert
      expect(hotspot).toBeDefined();
      expect(hotspot?.signals.includes('god-module')).toBe(true);
      expect(hotspot?.metrics.instability).toBe(0.5);
    } finally {
      await cleanup();
    }
  });
});
