import { describe, expect, it } from 'bun:test';

import { findCouplingHotspot, relativeImports } from '../_shared';

describe('integration/coupling/god-module', () => {
  it('should use a dynamic threshold based on total module count', async () => {
    // Arrange
    const sources = new Map<string, string>();
    const totalModules = 200;
    const threshold = Math.max(10, Math.ceil(totalModules * 0.1));
    const fan = threshold + 1;

    // Keep the actual module count equal to totalModules so the analyzer's
    // dynamic threshold matches the fixture's threshold.
    for (let index = 0; index < fan; index += 1) {
      sources.set(`/virtual/coupling/god/m${index}.ts`, `export const m${index} = ${index};`);
    }

    for (let index = 0; index < fan; index += 1) {
      sources.set(`/virtual/coupling/god/in${index}.ts`, `import './core';\nexport const in${index} = 1;`);
    }

    for (let index = 0; index < totalModules - (fan + fan + 1); index += 1) {
      sources.set(`/virtual/coupling/god/f${index}.ts`, `export const f${index} = ${index};`);
    }

    const coreImports = relativeImports('m', fan);

    sources.set('/virtual/coupling/god/core.ts', `${coreImports}\nexport const core = 1;`);

    // Act
    const { hotspot: core } = await findCouplingHotspot(sources, 'core');

    // Assert
    expect(core).toBeDefined();
    expect(core?.signals.includes('god-module')).toBe(true);
    expect(core?.metrics.fanIn).toBe(fan);
    expect(core?.metrics.fanOut).toBe(fan);
  });
});
