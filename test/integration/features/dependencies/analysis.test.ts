import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';

import { analyzeDependencies } from '../../../../src/features/dependencies';
import { createProgramFromMap } from '../../shared/test-kit';

const toCycleKey = (cycle: { readonly path: ReadonlyArray<string> }): string => {
  const normalized =
    cycle.path.length > 1 && cycle.path[0] === cycle.path[cycle.path.length - 1] ? cycle.path.slice(0, -1) : [...cycle.path];

  return normalized
    .map(entry => path.basename(entry))
    .sort()
    .join('|');
};

describe('integration/dependencies', () => {
  it('should detect cycles and fan stats when modules are linked', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/deps/a.ts', `import './b';\nexport const alpha = 1;`);
    sources.set('/virtual/deps/b.ts', `import './c';\nexport const beta = 2;`);
    sources.set('/virtual/deps/c.ts', `import './a';\nexport const gamma = 3;`);

    // Act
    let program = createProgramFromMap(sources);
    let dependencies = analyzeDependencies(program);

    // Assert
    expect(dependencies.cycles.length).toBeGreaterThan(0);
    expect(dependencies.fanIn.length).toBeGreaterThan(0);
    expect(dependencies.fanOut.length).toBeGreaterThan(0);
    expect(dependencies.cuts.length).toBeGreaterThan(0);
  });

  it('should detect layer violations when disallowed imports cross layers', () => {
    // Arrange
    const rootAbs = '/repo';
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
    let sources = new Map<string, string>();

    sources.set(`${rootAbs}/src/adapters/cli/foo.ts`, `import { x } from '../../engine/x';\nexport const foo = x;`);
    sources.set(`${rootAbs}/src/application/scan/bar.ts`, `import { x } from '../../engine/x';\nexport const bar = x;`);
    sources.set(`${rootAbs}/src/engine/x.ts`, `export const x = 1;`);

    // Act
    let program = createProgramFromMap(sources);
    let dependencies = analyzeDependencies(program, { rootAbs, layers, allowedDependencies });

    // Assert
    expect(dependencies.layerViolations.length).toBe(1);
    expect(dependencies.layerViolations[0]?.kind).toBe('layer-violation');
    expect(dependencies.layerViolations[0]?.fromLayer).toBe('adapters');
    expect(dependencies.layerViolations[0]?.toLayer).toBe('engine');
  });

  it('should detect self-loop cycles when a module imports itself', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/deps/self.ts', `import './self';\nexport const value = 1;`);

    // Act
    let program = createProgramFromMap(sources);
    let dependencies = analyzeDependencies(program);
    let cycleKeys = new Set(dependencies.cycles.map(toCycleKey));

    // Assert
    expect(cycleKeys.has(['self.ts'].join('|'))).toBe(true);
  });

  it('should detect two-node cycles when modules import each other', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/deps/a.ts', `import './b';\nexport const alpha = 1;`);
    sources.set('/virtual/deps/b.ts', `import './a';\nexport const beta = 2;`);

    // Act
    let program = createProgramFromMap(sources);
    let dependencies = analyzeDependencies(program);
    let cycleKeys = new Set(dependencies.cycles.map(toCycleKey));

    // Assert
    expect(cycleKeys.has(['a.ts', 'b.ts'].sort().join('|'))).toBe(true);
  });

  it('should return empty stats when modules do not import each other', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/deps/solo.ts', `export const solo = 1;`);
    sources.set('/virtual/deps/other.ts', `export const other = 2;`);

    // Act
    let program = createProgramFromMap(sources);
    let dependencies = analyzeDependencies(program);

    // Assert
    expect(dependencies.cycles.length).toBe(0);
    expect(dependencies.fanIn.length).toBe(0);
    expect(dependencies.fanOut.length).toBe(0);
    expect(dependencies.cuts.length).toBe(0);
  });

  it('should return empty stats when input is empty', () => {
    // Arrange
    let sources = new Map<string, string>();
    // Act
    let program = createProgramFromMap(sources);
    let dependencies = analyzeDependencies(program);

    // Assert
    expect(dependencies.cycles.length).toBe(0);
    expect(dependencies.fanIn.length).toBe(0);
    expect(dependencies.fanOut.length).toBe(0);
    expect(dependencies.cuts.length).toBe(0);
  });

  it('should resolve index modules when importing a directory', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/deps/app.ts', `import './lib';\nexport const app = 1;`);
    sources.set('/virtual/deps/lib/index.ts', `export const lib = 2;`);

    // Act
    let program = createProgramFromMap(sources);
    let dependencies = analyzeDependencies(program);
    let fanOutModules = dependencies.fanOut.map(entry => entry.module);

    // Assert
    expect(fanOutModules.length).toBeGreaterThan(0);
  });

  it('should include export-from edges when building the graph', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/deps/a.ts', `export * from './b';\nexport const alpha = 1;`);
    sources.set('/virtual/deps/b.ts', `export { gamma } from './c';\nexport const beta = 2;`);
    sources.set('/virtual/deps/c.ts', `import './a';\nexport const gamma = 3;`);

    // Act
    let program = createProgramFromMap(sources);
    let dependencies = analyzeDependencies(program);
    let cycleKeys = new Set(dependencies.cycles.map(toCycleKey));

    // Assert
    expect(cycleKeys.has(['a.ts', 'b.ts', 'c.ts'].sort().join('|'))).toBe(true);
  });

  it('should include type-only import edges when building the graph', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/deps/a.ts', `import type { Beta } from './b';\nexport const alpha = 1;`);
    sources.set('/virtual/deps/b.ts', `import './a';\nexport type Beta = { value: number };`);

    // Act
    let program = createProgramFromMap(sources);
    let dependencies = analyzeDependencies(program);
    let cycleKeys = new Set(dependencies.cycles.map(toCycleKey));

    // Assert
    expect(cycleKeys.has(['a.ts', 'b.ts'].sort().join('|'))).toBe(true);
  });

  it('should include dynamic import() edges when building the graph', () => {
    // Arrange
    const rootAbs = '/virtual';
    let sources = new Map<string, string>();

    sources.set(`${rootAbs}/deps/a.ts`, `export async function f() { await import('./b'); }`);
    sources.set(`${rootAbs}/deps/b.ts`, `export const x = 1;`);

    // Act
    let program = createProgramFromMap(sources);
    let dependencies = analyzeDependencies(program, { rootAbs });
    let aEdges = dependencies.adjacency['deps/a.ts'] ?? [];

    // Assert
    expect(aEdges).toContain('deps/b.ts');
  });

  it('should report dead exports when an exported symbol is never imported', () => {
    // Arrange
    const rootAbs = '/virtual';
    let sources = new Map<string, string>();

    sources.set(`${rootAbs}/dead/a.ts`, `export const unused = 1;\nexport const used = 2;`);
    sources.set(`${rootAbs}/dead/b.ts`, `import { used } from './a';\nexport const x = used;`);

    // Act
    let program = createProgramFromMap(sources);
    let dependencies = analyzeDependencies(program, { rootAbs });
    let hits = dependencies.deadExports.filter(f => f.kind === 'dead-export');

    // Assert
    expect(hits.some(f => f.module === 'dead/a.ts' && f.name === 'unused')).toBe(true);
  });

  it('should report test-only-export when an export is only imported from test files', () => {
    // Arrange
    const rootAbs = '/virtual';
    let sources = new Map<string, string>();

    sources.set(`${rootAbs}/dead/a.ts`, `export const onlyTest = 1;`);
    sources.set(`${rootAbs}/dead/a.spec.ts`, `import { onlyTest } from './a';\nexport const x = onlyTest;`);

    // Act
    let program = createProgramFromMap(sources);
    let dependencies = analyzeDependencies(program, { rootAbs });
    let hits = dependencies.deadExports.filter(f => f.kind === 'test-only-export');

    // Assert
    expect(hits.some(f => f.module === 'dead/a.ts' && f.name === 'onlyTest')).toBe(true);
  });

  it('should detect all cycles when multiple paths converge', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/deps/a.ts', `import './b';\nimport './d';\nexport const alpha = 1;`);
    sources.set('/virtual/deps/b.ts', `import './c';\nexport const beta = 2;`);
    sources.set('/virtual/deps/c.ts', `import './a';\nexport const gamma = 3;`);
    sources.set('/virtual/deps/d.ts', `import './c';\nexport const delta = 4;`);

    // Act
    let program = createProgramFromMap(sources);
    let dependencies = analyzeDependencies(program);
    let cycleKeys = new Set(dependencies.cycles.map(toCycleKey));

    // Assert
    expect(cycleKeys.has(['a.ts', 'b.ts', 'c.ts'].sort().join('|'))).toBe(true);
    expect(cycleKeys.has(['a.ts', 'c.ts', 'd.ts'].sort().join('|'))).toBe(true);
  });

  it('should de-duplicate identical cycles when the same circuit is discovered multiple ways', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/deps/a.ts', `import './b';\nimport './c';\nexport const alpha = 1;`);
    sources.set('/virtual/deps/b.ts', `import './c';\nexport const beta = 2;`);
    sources.set('/virtual/deps/c.ts', `import './a';\nexport const gamma = 3;`);

    // Act
    let program = createProgramFromMap(sources);
    let dependencies = analyzeDependencies(program);
    let triangleCycles = dependencies.cycles.filter(cycle => toCycleKey(cycle) === ['a.ts', 'b.ts', 'c.ts'].sort().join('|'));

    // Assert
    expect(triangleCycles.length).toBe(1);
  });

  it('should cap cycle enumeration when the scc is large', () => {
    // Arrange
    let sources = new Map<string, string>();
    let moduleCount = 6;

    for (let index = 0; index < moduleCount; index += 1) {
      let imports: string[] = [];

      for (let target = 0; target < moduleCount; target += 1) {
        if (target === index) {
          continue;
        }

        imports.push(`import './m${target}';`);
      }

      imports.push(`export const value${index} = ${index};`);
      sources.set(`/virtual/deps/m${index}.ts`, imports.join('\n'));
    }

    // Act
    let program = createProgramFromMap(sources);
    let dependencies = analyzeDependencies(program);

    // Assert
    expect(dependencies.cycles.length).toBe(100);
  });

  it('should cap cycle enumeration per scc when the graph has multiple scc components', () => {
    // Arrange
    let sources = new Map<string, string>();
    let moduleCount = 6;

    const addCompleteScc = (prefix: string): void => {
      for (let index = 0; index < moduleCount; index += 1) {
        let imports: string[] = [];

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

    // Act
    let program = createProgramFromMap(sources);
    let dependencies = analyzeDependencies(program);

    // Assert
    expect(dependencies.cycles.length).toBe(200);
  });

  it('should ignore non-relative imports when building the graph', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/deps/app.ts', `import 'react';\nexport const app = 1;`);
    sources.set('/virtual/deps/other.ts', `export const other = 2;`);

    // Act
    let program = createProgramFromMap(sources);
    let dependencies = analyzeDependencies(program);

    // Assert
    expect(dependencies.fanIn.length).toBe(0);
    expect(dependencies.fanOut.length).toBe(0);
  });
});
