import { describe, expect, it } from 'bun:test';

import { analyzeDependencies } from '../../../src/features/dependencies';
import { createProgramFromMap } from '../shared/test-kit';

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
    expect(dependencies.fanInTop.length).toBeGreaterThan(0);
    expect(dependencies.fanOutTop.length).toBeGreaterThan(0);
    expect(dependencies.edgeCutHints.length).toBeGreaterThan(0);
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
    expect(dependencies.fanInTop.length).toBe(0);
    expect(dependencies.fanOutTop.length).toBe(0);
    expect(dependencies.edgeCutHints.length).toBe(0);
  });

  it('should return empty stats when input is empty', () => {
    // Arrange
    let sources = new Map<string, string>();
    // Act
    let program = createProgramFromMap(sources);
    let dependencies = analyzeDependencies(program);

    // Assert
    expect(dependencies.cycles.length).toBe(0);
    expect(dependencies.fanInTop.length).toBe(0);
    expect(dependencies.fanOutTop.length).toBe(0);
    expect(dependencies.edgeCutHints.length).toBe(0);
  });

  it('should resolve index modules when importing a directory', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/deps/app.ts', `import './lib';\nexport const app = 1;`);
    sources.set('/virtual/deps/lib/index.ts', `export const lib = 2;`);

    // Act
    let program = createProgramFromMap(sources);
    let dependencies = analyzeDependencies(program);
    let fanOutModules = dependencies.fanOutTop.map(entry => entry.module);

    // Assert
    expect(fanOutModules.length).toBeGreaterThan(0);
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
    expect(dependencies.fanInTop.length).toBe(0);
    expect(dependencies.fanOutTop.length).toBe(0);
  });
});
