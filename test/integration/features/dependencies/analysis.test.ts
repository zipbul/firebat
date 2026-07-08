import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';

import { analyzeDependencies } from '../../../../src/test-api';
import { withTempGildash } from '../../shared/gildash-test-kit';
import { expectNoFanInOut } from '../../shared/test-kit';

const toCycleKey = (cycle: { readonly path: ReadonlyArray<string> }): string => {
  const normalized =
    cycle.path.length > 1 && cycle.path[0] === cycle.path[cycle.path.length - 1] ? cycle.path.slice(0, -1) : [...cycle.path];

  return normalized
    .map(entry => path.basename(entry))
    .sort()
    .join('|');
};

const expectEmptyGraphStats = (dependencies: {
  readonly cycles: ReadonlyArray<unknown>;
  readonly fanIn: ReadonlyArray<unknown>;
  readonly fanOut: ReadonlyArray<unknown>;
  readonly cuts: ReadonlyArray<unknown>;
}): void => {
  expect(dependencies.cycles.length).toBe(0);
  expectNoFanInOut(dependencies);
  expect(dependencies.cuts.length).toBe(0);
};

/** Run dependency analysis over `sources` in a temp gildash project and pass the result to `check`. */
const withDeps = async (
  sources: Parameters<typeof withTempGildash>[0],
  check: (dependencies: Awaited<ReturnType<typeof analyzeDependencies>>) => void,
): Promise<void> => {
  await withTempGildash(sources, async (gildash, tmpDir) => {
    check(await analyzeDependencies(gildash, { rootAbs: tmpDir }));
  });
};

/** withDeps check: assert at least one cycle was detected. */
const expectHasCycles = (dependencies: Awaited<ReturnType<typeof analyzeDependencies>>): void => {
  expect(dependencies.cycles.length).toBeGreaterThan(0);
};

/** Add a complete `moduleCount`-node strongly-connected component (each module imports every other) under `prefix`. */
const addCompleteScc = (sources: Map<string, string>, prefix: string, moduleCount: number): void => {
  for (let index = 0; index < moduleCount; index += 1) {
    const imports: string[] = [];

    for (let target = 0; target < moduleCount; target += 1) {
      if (target === index) {
        continue;
      }

      imports.push(`import './${prefix}${target}';`);
    }

    imports.push(`export const value${index} = ${index};`);
    sources.set(`/virtual/deps/${prefix}${index}.ts`, imports.join('\n'));
  }
};

/** The canonical a→b→c import cycle fixture, reused (and locally extended) across cycle tests. */
const makeCycleSources = (): Map<string, string> =>
  new Map([
    ['/virtual/deps/a.ts', `import './b';\nexport const alpha = 1;`],
    ['/virtual/deps/b.ts', `import './c';\nexport const beta = 2;`],
    ['/virtual/deps/c.ts', `import './a';\nexport const gamma = 3;`],
  ]);

interface CyclePresenceCase {
  readonly title: string;
  readonly files: Readonly<Record<string, string>>;
  readonly expectedKey: ReadonlyArray<string>;
}

const cyclePresenceCases: CyclePresenceCase[] = [
  {
    title: 'a module imports itself',
    files: { '/virtual/deps/self.ts': `import './self';\nexport const value = 1;` },
    expectedKey: ['self.ts'],
  },
  {
    title: 'modules import each other',
    files: {
      '/virtual/deps/a.ts': `import './b';\nexport const alpha = 1;`,
      '/virtual/deps/b.ts': `import './a';\nexport const beta = 2;`,
    },
    expectedKey: ['a.ts', 'b.ts'],
  },
  {
    title: 'export-from edges close a cycle',
    files: {
      '/virtual/deps/a.ts': `export * from './b';\nexport const alpha = 1;`,
      '/virtual/deps/b.ts': `export { gamma } from './c';\nexport const beta = 2;`,
      '/virtual/deps/c.ts': `import './a';\nexport const gamma = 3;`,
    },
    expectedKey: ['a.ts', 'b.ts', 'c.ts'],
  },
  {
    title: 'type-only import edges close a cycle',
    files: {
      '/virtual/deps/a.ts': `import type { Beta } from './b';\nexport const alpha = 1;`,
      '/virtual/deps/b.ts': `import './a';\nexport type Beta = { value: number };`,
    },
    expectedKey: ['a.ts', 'b.ts'],
  },
];

interface DeadExportCase {
  readonly title: string;
  readonly kind: string;
  readonly expectedName: string;
  readonly files: Readonly<Record<string, string>>;
}

const deadExportCases: DeadExportCase[] = [
  {
    title: 'an exported symbol is never imported',
    kind: 'dead-export',
    expectedName: 'unused',
    files: {
      '/virtual/dead/a.ts': `export const unused = 1;\nexport const used = 2;`,
      '/virtual/dead/b.ts': `import { used } from './a';\nexport const x = used;`,
    },
  },
];

describe('integration/dependencies', () => {
  it('should detect cycles and fan stats when modules are linked', async () => {
    const sources = makeCycleSources();

    await withDeps(sources, dependencies => {
      expect(dependencies.cycles.length).toBeGreaterThan(0);
      expect(dependencies.fanIn.length).toBeGreaterThan(0);
      expect(dependencies.fanOut.length).toBeGreaterThan(0);
      expect(dependencies.cuts.length).toBeGreaterThan(0);
    });
  });

  it('should detect layer violations when disallowed imports cross layers', async () => {
    const layers = [
      { name: 'adapters', glob: 'src/adapters/**' },
      { name: 'application', glob: 'src/application/**' },
      { name: 'engine', glob: 'src/engine/**' },
      { name: 'infrastructure', glob: 'src/infrastructure/**' },
    ] as const;
    const allowedDependencies = {
      adapters: ['application'],
      application: ['engine', 'infrastructure'],
      engine: [],
      infrastructure: [],
    } as const;
    const sources = new Map<string, string>();

    sources.set('/virtual/src/adapters/cli/foo.ts', `import { x } from '../../engine/x';\nexport const foo = x;`);
    sources.set('/virtual/src/application/scan/bar.ts', `import { x } from '../../engine/x';\nexport const bar = x;`);
    sources.set('/virtual/src/engine/x.ts', `export const x = 1;`);

    await withTempGildash(sources, async (gildash, tmpDir) => {
      const dependencies = await analyzeDependencies(gildash, {
        rootAbs: tmpDir,
        layers,
        allowedDependencies,
      });

      expect(dependencies.layerViolations.length).toBe(1);
      expect(dependencies.layerViolations[0]?.kind).toBe('layer-violation');
      expect(dependencies.layerViolations[0]?.fromLayer).toBe('adapters');
      expect(dependencies.layerViolations[0]?.toLayer).toBe('engine');
    });
  });

  it.each(cyclePresenceCases)('should detect a cycle when $title', async ({ files, expectedKey }) => {
    await withDeps(files, dependencies => {
      const cycleKeys = new Set(dependencies.cycles.map(toCycleKey));

      expect(cycleKeys.has([...expectedKey].sort().join('|'))).toBe(true);
    });
  });

  it('should return empty stats when modules do not import each other', async () => {
    await withDeps(
      {
        '/virtual/deps/solo.ts': `export const solo = 1;`,
        '/virtual/deps/other.ts': `export const other = 2;`,
      },
      expectEmptyGraphStats,
    );
  });

  it('should return empty stats when input is empty', async () => {
    await withDeps(new Map<string, string>(), expectEmptyGraphStats);
  });

  it.todo('should resolve index modules when importing a directory', () => {});

  it('should include dynamic import() edges when building the graph', async () => {
    const sources = new Map<string, string>();

    sources.set('/virtual/deps/a.ts', `export async function f() { await import('./b'); }`);
    sources.set('/virtual/deps/b.ts', `export const x = 1;`);

    await withDeps(sources, dependencies => {
      const aEdges = dependencies.adjacency['deps/a.ts'] ?? [];

      expect(aEdges).toContain('deps/b.ts');
    });
  });

  it.each(deadExportCases)('should report $kind when $title', async ({ kind, files, expectedName }) => {
    await withDeps(files, dependencies => {
      const hits = dependencies.deadExports.filter(f => f.kind === kind);

      expect(hits.some(f => f.module === 'dead/a.ts' && f.name === expectedName)).toBe(true);
    });
  });

  it('should detect all cycles when multiple paths converge', async () => {
    const sources = makeCycleSources();

    sources.set('/virtual/deps/a.ts', `import './b';\nimport './d';\nexport const alpha = 1;`);
    sources.set('/virtual/deps/d.ts', `import './c';\nexport const delta = 4;`);

    await withDeps(sources, dependencies => {
      const cycleKeys = new Set(dependencies.cycles.map(toCycleKey));

      expect(cycleKeys.has(['a.ts', 'b.ts', 'c.ts'].sort().join('|'))).toBe(true);
      expect(cycleKeys.has(['a.ts', 'c.ts', 'd.ts'].sort().join('|'))).toBe(true);
    });
  });

  it('should de-duplicate identical cycles when the same circuit is discovered multiple ways', async () => {
    const sources = makeCycleSources();

    sources.set('/virtual/deps/a.ts', `import './b';\nimport './c';\nexport const alpha = 1;`);

    await withDeps(sources, dependencies => {
      const triangleCycles = dependencies.cycles.filter(cycle => toCycleKey(cycle) === ['a.ts', 'b.ts', 'c.ts'].sort().join('|'));

      expect(triangleCycles.length).toBe(1);
    });
  });

  it('should cap cycle enumeration when the scc is large', async () => {
    const sources = new Map<string, string>();

    addCompleteScc(sources, 'm', 6);

    await withDeps(sources, expectHasCycles);
  });

  it('should cap cycle enumeration per scc when the graph has multiple scc components', async () => {
    const sources = new Map<string, string>();

    addCompleteScc(sources, 'a', 6);
    addCompleteScc(sources, 'b', 6);

    await withDeps(sources, expectHasCycles);
  });

  it('should ignore non-relative imports when building the graph', async () => {
    const sources = new Map<string, string>();

    sources.set('/virtual/deps/app.ts', `import 'react';\nexport const app = 1;`);
    sources.set('/virtual/deps/other.ts', `export const other = 2;`);

    await withDeps(sources, expectNoFanInOut);
  });
});
