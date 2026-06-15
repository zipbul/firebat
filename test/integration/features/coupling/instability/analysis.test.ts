import { describe, expect, it } from 'bun:test';

import { findCouplingHotspot, relativeImports } from '../_shared';

type Hotspot = NonNullable<Awaited<ReturnType<typeof findCouplingHotspot>>['hotspot']>;

const buildStableSources = (): Map<string, string> => {
  const sources = new Map<string, string>();

  sources.set('/virtual/coupling/instability/a.ts', `import './stable';\nexport const a = 1;`);
  sources.set('/virtual/coupling/instability/b.ts', `import './stable';\nexport const b = 2;`);
  sources.set('/virtual/coupling/instability/stable.ts', `export const stable = 3;`);

  return sources;
};

const buildUnstableSources = (): Map<string, string> => {
  const sources = new Map<string, string>();
  const targetCount = 6;

  for (let index = 0; index < targetCount; index += 1) {
    sources.set(`/virtual/coupling/instability/t${index}.ts`, `export const t${index} = ${index};`);
  }

  const imports = relativeImports('t', targetCount);

  sources.set('/virtual/coupling/instability/unstable.ts', `${imports}\nexport const unstable = 1;`);

  return sources;
};

const buildBalancedSources = (): Map<string, string> => {
  const sources = new Map<string, string>();
  const fan = 11;

  for (let index = 0; index < fan; index += 1) {
    sources.set(`/virtual/coupling/instability/in${index}.ts`, `import './core';\nexport const in${index} = 1;`);
  }

  const coreImports = relativeImports('out', fan);

  sources.set('/virtual/coupling/instability/core.ts', `${coreImports}\nexport const core = 1;`);

  for (let index = 0; index < fan; index += 1) {
    sources.set(`/virtual/coupling/instability/out${index}.ts`, `export const out${index} = 1;`);
  }

  return sources;
};

interface InstabilityCase {
  title: string;
  sources: Map<string, string>;
  moduleSubstring: string;
  assertHotspot: (hotspot: Hotspot | undefined) => void;
}

const instabilityCases: InstabilityCase[] = [
  {
    title: 'should compute I=0 when module has Ca>0 and Ce=0',
    sources: buildStableSources(),
    moduleSubstring: 'stable',
    assertHotspot: hotspot => {
      expect(hotspot?.metrics.instability).toBe(0);
    },
  },
  {
    title: 'should compute I=1 when module has Ca=0 and Ce>5',
    sources: buildUnstableSources(),
    moduleSubstring: 'unstable',
    assertHotspot: hotspot => {
      expect(hotspot?.metrics.instability).toBe(1);
      expect(hotspot?.signals.includes('unstable-module')).toBe(true);
    },
  },
  {
    title: 'should compute I=0.5 when module has Ca>10 and Ce>10',
    sources: buildBalancedSources(),
    moduleSubstring: 'core',
    assertHotspot: hotspot => {
      expect(hotspot?.signals.includes('god-module')).toBe(true);
      expect(hotspot?.metrics.instability).toBe(0.5);
    },
  },
];

describe('integration/coupling/instability', () => {
  it.each(instabilityCases)('$title', async ({ sources, moduleSubstring, assertHotspot }) => {
    // Act
    const { hotspot } = await findCouplingHotspot(sources, moduleSubstring);

    // Assert
    expect(hotspot).toBeDefined();
    assertHotspot(hotspot);
  });
});
