import { describe, expect, it } from 'bun:test';

import { findCouplingHotspot, relativeImports } from '../_shared';

interface DistanceCase {
  title: string;
  sources: Map<string, string>;
  moduleSubstring: string;
  expectedAbstractness: number;
  expectedInstability: number;
}

const buildPainSources = (): Map<string, string> => {
  const sources = new Map<string, string>();

  for (let index = 0; index < 9; index += 1) {
    sources.set(`/virtual/coupling/distance/in${index}.ts`, `import './pain';\nexport const in${index} = 1;`);
  }

  sources.set('/virtual/coupling/distance/dep.ts', `export const dep = 1;`);
  sources.set('/virtual/coupling/distance/pain.ts', `import './dep';\nexport const pain = 1;`);

  return sources;
};

const buildUselessSources = (): Map<string, string> => {
  const sources = new Map<string, string>();
  const outCount = 9;

  sources.set('/virtual/coupling/distance/in.ts', `import './useless';\nexport const inValue = 1;`);

  for (let index = 0; index < outCount; index += 1) {
    sources.set(`/virtual/coupling/distance/out${index}.ts`, `export const out${index} = 1;`);
  }

  const outImports = relativeImports('out', outCount);

  sources.set(
    '/virtual/coupling/distance/useless.ts',
    `${outImports}\nexport interface IService { get(): string }\nexport abstract class Base { abstract run(): void }`,
  );

  return sources;
};

const distanceCases: DistanceCase[] = [
  {
    title: 'should report Zone of Pain when A=0 and I≈0.1 (D>0.7)',
    sources: buildPainSources(),
    moduleSubstring: 'pain',
    expectedAbstractness: 0,
    expectedInstability: 0.1,
  },
  {
    title: 'should report Zone of Uselessness when A=1 and I≈0.9 (D>0.7)',
    sources: buildUselessSources(),
    moduleSubstring: 'useless',
    expectedAbstractness: 1,
    expectedInstability: 0.9,
  },
];

describe('integration/coupling/distance', () => {
  it.each(distanceCases)('$title', async ({ sources, moduleSubstring, expectedAbstractness, expectedInstability }) => {
    // Act
    const { hotspot } = await findCouplingHotspot(sources, moduleSubstring);

    // Assert
    expect(hotspot).toBeDefined();
    expect(hotspot?.metrics.abstractness).toBe(expectedAbstractness);
    expect(hotspot?.metrics.instability).toBeCloseTo(expectedInstability, 8);
    expect(hotspot?.metrics.distance).toBeGreaterThan(0.7);
    expect(hotspot?.signals.includes('off-main-sequence')).toBe(true);
  });
});
