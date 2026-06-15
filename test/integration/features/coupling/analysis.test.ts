import { describe, expect, it } from 'bun:test';

import { analyzeCouplingFromSources, findCouplingHotspot } from './_shared';

const sharedFixture = {
  '/virtual/coupling/a.ts': `import './shared';\nexport const alpha = 1;`,
  '/virtual/coupling/b.ts': `import './shared';\nexport const beta = 2;`,
  '/virtual/coupling/shared.ts': `export const shared = 3;`,
};

type Hotspot = NonNullable<Awaited<ReturnType<typeof findCouplingHotspot>>['hotspot']>;

interface SharedHotspotCase {
  title: string;
  assertHotspot: (hotspot: Hotspot | undefined) => void;
}

const sharedHotspotCases: SharedHotspotCase[] = [
  {
    title: 'should detect off-main-sequence when module is stable and concrete',
    assertHotspot: hotspot => {
      expect(hotspot?.signals.includes('off-main-sequence')).toBe(true);
    },
  },
  {
    title: 'should include fan-in signals when dependencies are shared',
    assertHotspot: hotspot => {
      expect(hotspot?.metrics.fanIn).toBeGreaterThanOrEqual(1);
    },
  },
];

describe('integration/coupling', () => {
  it.each(sharedHotspotCases)('$title', async ({ assertHotspot }) => {
    // Act
    const { hotspot } = await findCouplingHotspot(sharedFixture, 'shared');

    // Assert
    expect(hotspot).toBeDefined();
    assertHotspot(hotspot);
  });

  it('should return empty hotspots when dependencies are empty', async () => {
    // Act
    const hotspots = await analyzeCouplingFromSources(new Map<string, string>());

    // Assert
    expect(hotspots.length).toBe(0);
  });

  it('should sort hotspots by score then module name when tied', async () => {
    // Act
    const hotspots = await analyzeCouplingFromSources({
      '/virtual/coupling/a.ts': `import './x';\nexport const alpha = 1;`,
      '/virtual/coupling/b.ts': `import './y';\nexport const beta = 2;`,
      '/virtual/coupling/x.ts': `export const x = 3;`,
      '/virtual/coupling/y.ts': `export const y = 4;`,
    });
    const names = hotspots.map(entry => entry.module);

    // Assert
    expect(names.length).toBeGreaterThanOrEqual(2);

    const sortedNames = [...names].sort((left, right) => left.localeCompare(right));

    expect(names[0]).toBe(sortedNames[0]);
  });
});
