import { describe, expect, it } from 'bun:test';

import { analyzeCoupling } from '../../../../../src/features/coupling';
import { analyzeDependencies } from '../../../../../src/features/dependencies';
import { createProgramFromMap } from '../../../shared/test-kit';

describe('integration/coupling/instability', () => {
  it('should compute I=0 when module has Ca>0 and Ce=0', () => {
    // Arrange
    const sources = new Map<string, string>();

    sources.set('/virtual/coupling/instability/a.ts', `import './stable';\nexport const a = 1;`);
    sources.set('/virtual/coupling/instability/b.ts', `import './stable';\nexport const b = 2;`);
    sources.set('/virtual/coupling/instability/stable.ts', `export const stable = 3;`);

    // Act
    const program = createProgramFromMap(sources);
    const dependencies = analyzeDependencies(program);
    const hotspots = analyzeCoupling(dependencies);
    const hotspot = hotspots.find(h => h.module.includes('stable'));

    // Assert
    expect(hotspot).toBeDefined();
    expect(hotspot?.metrics.instability).toBe(0);
  });

  it('should compute I=1 when module has Ca=0 and Ce>5', () => {
    // Arrange
    const sources = new Map<string, string>();
    const targetCount = 6;

    for (let index = 0; index < targetCount; index += 1) {
      sources.set(`/virtual/coupling/instability/t${index}.ts`, `export const t${index} = ${index};`);
    }

    const imports = Array.from({ length: targetCount }, (_, index) => `import './t${index}';`).join('\n');

    sources.set('/virtual/coupling/instability/unstable.ts', `${imports}\nexport const unstable = 1;`);

    // Act
    const program = createProgramFromMap(sources);
    const dependencies = analyzeDependencies(program);
    const hotspots = analyzeCoupling(dependencies);
    const hotspot = hotspots.find(h => h.module.includes('unstable'));

    // Assert
    expect(hotspot).toBeDefined();
    expect(hotspot?.metrics.instability).toBe(1);
    expect(hotspot?.signals.includes('unstable-module')).toBe(true);
  });

  it('should compute I=0.5 when module has Ca>10 and Ce>10', () => {
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

    // Act
    const program = createProgramFromMap(sources);
    const dependencies = analyzeDependencies(program);
    const hotspots = analyzeCoupling(dependencies);
    const hotspot = hotspots.find(h => h.module.includes('core'));

    // Assert
    expect(hotspot).toBeDefined();
    expect(hotspot?.signals.includes('god-module')).toBe(true);
    expect(hotspot?.metrics.instability).toBe(0.5);
  });
});
