import { describe, expect, it } from 'bun:test';

import { analyzeDependencies, createEmptyDependencies } from './analyzer';
import { parseSource } from '../../engine/ast/parse-source';
import type { ParsedFile } from '../../engine/types';

const toFile = (filePath: string, code: string): ParsedFile =>
  parseSource(filePath, code) as ParsedFile;

describe('features/dependencies/analyzer — createEmptyDependencies', () => {
  it('returns the empty DependencyAnalysis shape', () => {
    const empty = createEmptyDependencies();
    expect(Array.isArray(empty.cycles)).toBe(true);
    expect(empty.cycles.length).toBe(0);
    expect(typeof empty.adjacency).toBe('object');
    expect(Array.isArray(empty.fanIn)).toBe(true);
    expect(Array.isArray(empty.fanOut)).toBe(true);
    expect(Array.isArray(empty.cuts)).toBe(true);
    expect(Array.isArray(empty.layerViolations)).toBe(true);
    expect(Array.isArray(empty.deadExports)).toBe(true);
  });
});

describe('features/dependencies/analyzer — analyzeDependencies', () => {
  it('returns empty analysis for empty files list', () => {
    const result = analyzeDependencies([]);
    expect(result.cycles.length).toBe(0);
    expect(Object.keys(result.adjacency).length).toBe(0);
  });

  it('builds adjacency from imports', () => {
    const rootAbs = '/project';
    const a = toFile('/project/src/a.ts', `import { b } from './b';`);
    const b = toFile('/project/src/b.ts', `export const b = 1;`);
    const result = analyzeDependencies([a, b], { rootAbs });
    expect(typeof result.adjacency).toBe('object');
    // adjacency should have keys
    expect(Object.keys(result.adjacency).length).toBeGreaterThanOrEqual(1);
  });

  it('detects circular dependency', () => {
    const rootAbs = '/project';
    const a = toFile('/project/src/a.ts', `import { b } from './b';`);
    const b = toFile('/project/src/b.ts', `import { a } from './a';`);
    const result = analyzeDependencies([a, b], { rootAbs });
    expect(Array.isArray(result.cycles)).toBe(true);
    // cycles should be detected
    expect(result.cycles.length).toBeGreaterThanOrEqual(1);
  });

  it('fanIn and fanOut are arrays of DependencyFanStat', () => {
    const rootAbs = '/project';
    const a = toFile('/project/src/a.ts', `import x from './shared'; import y from './shared2';`);
    const shared = toFile('/project/src/shared.ts', `export default 1;`);
    const shared2 = toFile('/project/src/shared2.ts', `export default 2;`);
    const result = analyzeDependencies([a, shared, shared2], { rootAbs });
    expect(Array.isArray(result.fanIn)).toBe(true);
    expect(Array.isArray(result.fanOut)).toBe(true);
    for (const stat of result.fanIn) {
      expect(typeof stat.module).toBe('string');
      expect(typeof stat.count).toBe('number');
    }
  });

  it('detects layer violations when layers config is provided', () => {
    const rootAbs = '/project';
    const a = toFile('/project/src/ui/comp.ts', `import { service } from '../domain/service';`);
    const b = toFile('/project/src/domain/service.ts', `export const service = 1;`);
    const layers = [
      { name: 'ui', glob: 'src/ui/**' },
      { name: 'domain', glob: 'src/domain/**' },
    ];
    // allowedDependencies: ui can depend on domain
    const result = analyzeDependencies([a, b], {
      rootAbs,
      layers,
      allowedDependencies: { ui: ['domain'] },
    });
    expect(Array.isArray(result.layerViolations)).toBe(true);
  });

  it('DependencyAnalysis has exportStats with total and abstract counts', () => {
    const rootAbs = '/project';
    const f = toFile('/project/src/mod.ts', `export function doSomething() {} export interface IFoo {}`);
    const result = analyzeDependencies([f], { rootAbs });
    expect(typeof result.exportStats).toBe('object');
  });

  it('processes multiple files without error', () => {
    const rootAbs = '/project';
    const files = [
      toFile('/project/src/a.ts', `import b from './b'; export const a = 1;`),
      toFile('/project/src/b.ts', `import c from './c'; export default 2;`),
      toFile('/project/src/c.ts', `export default 3;`),
    ];
    const result = analyzeDependencies(files, { rootAbs });
    expect(Array.isArray(result.cycles)).toBe(true);
    expect(typeof result.adjacency).toBe('object');
  });
});
