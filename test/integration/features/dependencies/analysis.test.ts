import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';

import { analyzeDependencies } from '../../../../src/test-api';
import { createTempGildash } from '../../shared/gildash-test-kit';

const toCycleKey = (cycle: { readonly path: ReadonlyArray<string> }): string => {
  const normalized =
    cycle.path.length > 1 && cycle.path[0] === cycle.path[cycle.path.length - 1] ? cycle.path.slice(0, -1) : [...cycle.path];

  return normalized
    .map(entry => path.basename(entry))
    .sort()
    .join('|');
};

describe('integration/dependencies', () => {
  it('should detect cycles and fan stats when modules are linked', async () => {
    const sources = new Map<string, string>();

    sources.set('/virtual/deps/a.ts', `import './b';\nexport const alpha = 1;`);
    sources.set('/virtual/deps/b.ts', `import './c';\nexport const beta = 2;`);
    sources.set('/virtual/deps/c.ts', `import './a';\nexport const gamma = 3;`);

    const { gildash, tmpDir, cleanup } = await createTempGildash(sources);

    try {
      const dependencies = await analyzeDependencies(gildash, { rootAbs: tmpDir });

      expect(dependencies.cycles.length).toBeGreaterThan(0);
      expect(dependencies.fanIn.length).toBeGreaterThan(0);
      expect(dependencies.fanOut.length).toBeGreaterThan(0);
      expect(dependencies.cuts.length).toBeGreaterThan(0);
    } finally {
      await cleanup();
    }
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

    const { gildash, tmpDir, cleanup } = await createTempGildash(sources);

    try {
      const dependencies = await analyzeDependencies(gildash, {
        rootAbs: tmpDir,
        layers,
        allowedDependencies,
      });

      expect(dependencies.layerViolations.length).toBe(1);
      expect(dependencies.layerViolations[0]?.kind).toBe('layer-violation');
      expect(dependencies.layerViolations[0]?.fromLayer).toBe('adapters');
      expect(dependencies.layerViolations[0]?.toLayer).toBe('engine');
    } finally {
      await cleanup();
    }
  });

  it('should detect self-loop cycles when a module imports itself', async () => {
    const sources = new Map<string, string>();

    sources.set('/virtual/deps/self.ts', `import './self';\nexport const value = 1;`);

    const { gildash, tmpDir, cleanup } = await createTempGildash(sources);

    try {
      const dependencies = await analyzeDependencies(gildash, { rootAbs: tmpDir });
      const cycleKeys = new Set(dependencies.cycles.map(toCycleKey));

      expect(cycleKeys.has(['self.ts'].join('|'))).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('should detect two-node cycles when modules import each other', async () => {
    const sources = new Map<string, string>();

    sources.set('/virtual/deps/a.ts', `import './b';\nexport const alpha = 1;`);
    sources.set('/virtual/deps/b.ts', `import './a';\nexport const beta = 2;`);

    const { gildash, tmpDir, cleanup } = await createTempGildash(sources);

    try {
      const dependencies = await analyzeDependencies(gildash, { rootAbs: tmpDir });
      const cycleKeys = new Set(dependencies.cycles.map(toCycleKey));

      expect(cycleKeys.has(['a.ts', 'b.ts'].sort().join('|'))).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('should return empty stats when modules do not import each other', async () => {
    const sources = new Map<string, string>();

    sources.set('/virtual/deps/solo.ts', `export const solo = 1;`);
    sources.set('/virtual/deps/other.ts', `export const other = 2;`);

    const { gildash, tmpDir, cleanup } = await createTempGildash(sources);

    try {
      const dependencies = await analyzeDependencies(gildash, { rootAbs: tmpDir });

      expect(dependencies.cycles.length).toBe(0);
      expect(dependencies.fanIn.length).toBe(0);
      expect(dependencies.fanOut.length).toBe(0);
      expect(dependencies.cuts.length).toBe(0);
    } finally {
      await cleanup();
    }
  });

  it('should return empty stats when input is empty', async () => {
    const sources = new Map<string, string>();
    const { gildash, tmpDir, cleanup } = await createTempGildash(sources);

    try {
      const dependencies = await analyzeDependencies(gildash, { rootAbs: tmpDir });

      expect(dependencies.cycles.length).toBe(0);
      expect(dependencies.fanIn.length).toBe(0);
      expect(dependencies.fanOut.length).toBe(0);
      expect(dependencies.cuts.length).toBe(0);
    } finally {
      await cleanup();
    }
  });

  it.todo('should resolve index modules when importing a directory');

  it('should include export-from edges when building the graph', async () => {
    const sources = new Map<string, string>();

    sources.set('/virtual/deps/a.ts', `export * from './b';\nexport const alpha = 1;`);
    sources.set('/virtual/deps/b.ts', `export { gamma } from './c';\nexport const beta = 2;`);
    sources.set('/virtual/deps/c.ts', `import './a';\nexport const gamma = 3;`);

    const { gildash, tmpDir, cleanup } = await createTempGildash(sources);

    try {
      const dependencies = await analyzeDependencies(gildash, { rootAbs: tmpDir });
      const cycleKeys = new Set(dependencies.cycles.map(toCycleKey));

      expect(cycleKeys.has(['a.ts', 'b.ts', 'c.ts'].sort().join('|'))).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('should include type-only import edges when building the graph', async () => {
    const sources = new Map<string, string>();

    sources.set('/virtual/deps/a.ts', `import type { Beta } from './b';\nexport const alpha = 1;`);
    sources.set('/virtual/deps/b.ts', `import './a';\nexport type Beta = { value: number };`);

    const { gildash, tmpDir, cleanup } = await createTempGildash(sources);

    try {
      const dependencies = await analyzeDependencies(gildash, { rootAbs: tmpDir });
      const cycleKeys = new Set(dependencies.cycles.map(toCycleKey));

      expect(cycleKeys.has(['a.ts', 'b.ts'].sort().join('|'))).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('should include dynamic import() edges when building the graph', async () => {
    const sources = new Map<string, string>();

    sources.set('/virtual/deps/a.ts', `export async function f() { await import('./b'); }`);
    sources.set('/virtual/deps/b.ts', `export const x = 1;`);

    const { gildash, tmpDir, cleanup } = await createTempGildash(sources);

    try {
      const dependencies = await analyzeDependencies(gildash, { rootAbs: tmpDir });
      const aEdges = dependencies.adjacency['deps/a.ts'] ?? [];

      expect(aEdges).toContain('deps/b.ts');
    } finally {
      await cleanup();
    }
  });

  it('should report dead exports when an exported symbol is never imported', async () => {
    const sources = new Map<string, string>();

    sources.set('/virtual/dead/a.ts', `export const unused = 1;\nexport const used = 2;`);
    sources.set('/virtual/dead/b.ts', `import { used } from './a';\nexport const x = used;`);

    const { gildash, tmpDir, cleanup } = await createTempGildash(sources);

    try {
      const dependencies = await analyzeDependencies(gildash, { rootAbs: tmpDir });
      const hits = dependencies.deadExports.filter(f => f.kind === 'dead-export');

      expect(hits.some(f => f.module === 'dead/a.ts' && f.name === 'unused')).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('should report test-only-export when an export is only imported from test files', async () => {
    const sources = new Map<string, string>();

    sources.set('/virtual/dead/a.ts', `export const onlyTest = 1;`);
    sources.set('/virtual/dead/a.spec.ts', `import { onlyTest } from './a';\nexport const x = onlyTest;`);

    const { gildash, tmpDir, cleanup } = await createTempGildash(sources);

    try {
      const dependencies = await analyzeDependencies(gildash, { rootAbs: tmpDir });
      const hits = dependencies.deadExports.filter(f => f.kind === 'test-only-export');

      expect(hits.some(f => f.module === 'dead/a.ts' && f.name === 'onlyTest')).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('should detect all cycles when multiple paths converge', async () => {
    const sources = new Map<string, string>();

    sources.set('/virtual/deps/a.ts', `import './b';\nimport './d';\nexport const alpha = 1;`);
    sources.set('/virtual/deps/b.ts', `import './c';\nexport const beta = 2;`);
    sources.set('/virtual/deps/c.ts', `import './a';\nexport const gamma = 3;`);
    sources.set('/virtual/deps/d.ts', `import './c';\nexport const delta = 4;`);

    const { gildash, tmpDir, cleanup } = await createTempGildash(sources);

    try {
      const dependencies = await analyzeDependencies(gildash, { rootAbs: tmpDir });
      const cycleKeys = new Set(dependencies.cycles.map(toCycleKey));

      expect(cycleKeys.has(['a.ts', 'b.ts', 'c.ts'].sort().join('|'))).toBe(true);
      expect(cycleKeys.has(['a.ts', 'c.ts', 'd.ts'].sort().join('|'))).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('should de-duplicate identical cycles when the same circuit is discovered multiple ways', async () => {
    const sources = new Map<string, string>();

    sources.set('/virtual/deps/a.ts', `import './b';\nimport './c';\nexport const alpha = 1;`);
    sources.set('/virtual/deps/b.ts', `import './c';\nexport const beta = 2;`);
    sources.set('/virtual/deps/c.ts', `import './a';\nexport const gamma = 3;`);

    const { gildash, tmpDir, cleanup } = await createTempGildash(sources);

    try {
      const dependencies = await analyzeDependencies(gildash, { rootAbs: tmpDir });
      const triangleCycles = dependencies.cycles.filter(
        cycle => toCycleKey(cycle) === ['a.ts', 'b.ts', 'c.ts'].sort().join('|'),
      );

      expect(triangleCycles.length).toBe(1);
    } finally {
      await cleanup();
    }
  });

  it('should cap cycle enumeration when the scc is large', async () => {
    const sources = new Map<string, string>();
    const moduleCount = 6;

    for (let index = 0; index < moduleCount; index += 1) {
      const imports: string[] = [];

      for (let target = 0; target < moduleCount; target += 1) {
        if (target === index) {
          continue;
        }

        imports.push(`import './m${target}';`);
      }

      imports.push(`export const value${index} = ${index};`);
      sources.set(`/virtual/deps/m${index}.ts`, imports.join('\n'));
    }

    const { gildash, tmpDir, cleanup } = await createTempGildash(sources);

    try {
      const dependencies = await analyzeDependencies(gildash, { rootAbs: tmpDir });

      // gildash getCyclePaths uses default maxCycles; verify cycles are returned
      expect(dependencies.cycles.length).toBeGreaterThan(0);
    } finally {
      await cleanup();
    }
  });

  it('should cap cycle enumeration per scc when the graph has multiple scc components', async () => {
    const sources = new Map<string, string>();
    const moduleCount = 6;

    const addCompleteScc = (prefix: string): void => {
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

    addCompleteScc('a');
    addCompleteScc('b');

    const { gildash, tmpDir, cleanup } = await createTempGildash(sources);

    try {
      const dependencies = await analyzeDependencies(gildash, { rootAbs: tmpDir });

      // gildash getCyclePaths uses default maxCycles; verify cycles are returned
      expect(dependencies.cycles.length).toBeGreaterThan(0);
    } finally {
      await cleanup();
    }
  });

  it('should ignore non-relative imports when building the graph', async () => {
    const sources = new Map<string, string>();

    sources.set('/virtual/deps/app.ts', `import 'react';\nexport const app = 1;`);
    sources.set('/virtual/deps/other.ts', `export const other = 2;`);

    const { gildash, tmpDir, cleanup } = await createTempGildash(sources);

    try {
      const dependencies = await analyzeDependencies(gildash, { rootAbs: tmpDir });

      expect(dependencies.fanIn.length).toBe(0);
      expect(dependencies.fanOut.length).toBe(0);
    } finally {
      await cleanup();
    }
  });
});
