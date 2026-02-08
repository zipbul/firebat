import { describe, expect, it } from 'bun:test';

import { detectExactDuplicates } from '../../../src/features/exact-duplicates';
import { createProgramFromMap } from '../shared/test-kit';

function createFunctionSource(name: string, value: number): string {
  return [`export function ${name}() {`, `  const localValue = ${value};`, '  return localValue + 1;', '}'].join('\n');
}

function createClassSource(name: string): string {
  return [`export class ${name} {`, '  run() {', '    return 1;', '  }', '}'].join('\n');
}

describe('integration/exact-duplicates', () => {
  it('should detect duplicate groups when functions are identical', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/dup-detector/one.ts', createFunctionSource('alpha', 1));
    sources.set('/virtual/dup-detector/two.ts', createFunctionSource('beta', 1));

    // Act
    let program = createProgramFromMap(sources);
    let groups = detectExactDuplicates(program, 1);
    let hasGroup = groups.some(group => group.items.length >= 2);

    // Assert
    expect(hasGroup).toBe(true);
  });

  it('should not group functions when minSize is too high', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/dup-detector/one.ts', createFunctionSource('alpha', 1));
    sources.set('/virtual/dup-detector/two.ts', createFunctionSource('beta', 1));

    // Act
    let program = createProgramFromMap(sources);
    let groups = detectExactDuplicates(program, 500);

    // Assert
    expect(groups.length).toBe(0);
  });

  it('should not group near-duplicates when literals differ', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/dup-detector/one.ts', createFunctionSource('alpha', 1));
    sources.set('/virtual/dup-detector/two.ts', createFunctionSource('beta', 2));

    // Act
    let program = createProgramFromMap(sources);
    let groups = detectExactDuplicates(program, 1);

    // Assert
    expect(groups.length).toBe(0);
  });

  it('should detect duplicate classes when bodies are identical', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/dup-detector/one.ts', createClassSource('Alpha'));
    sources.set('/virtual/dup-detector/two.ts', createClassSource('Beta'));

    // Act
    let program = createProgramFromMap(sources);
    let groups = detectExactDuplicates(program, 1);
    let hasClassGroup = groups.some(group => group.items.some(item => item.kind === 'type'));

    // Assert
    expect(hasClassGroup).toBe(true);
  });

  it('should return no findings when input is empty', () => {
    // Arrange
    let sources = new Map<string, string>();
    // Act
    let program = createProgramFromMap(sources);
    let groups = detectExactDuplicates(program, 1);

    // Assert
    expect(groups.length).toBe(0);
  });
});
