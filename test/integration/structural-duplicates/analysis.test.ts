import { describe, expect, it } from 'bun:test';

import type { ParsedFile } from '../../../src/engine/types';

import { analyzeStructuralDuplicates } from '../../../src/features/structural-duplicates';
import { createProgramFromMap } from '../shared/test-kit';

function createFunctionSource(name: string, value: number): string {
  return `export function ${name}() {\n  const localValue = ${value};\n  return localValue + 1;\n}`;
}

function createAnonymousFunctionSource(value: number): string {
  return `export default function () {\n  const localValue = ${value};\n  return localValue + 1;\n}`;
}

describe('integration/structural-duplicates', () => {
  it('should detect clone classes when structures match', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/dup/one.ts', createFunctionSource('alpha', 1));
    sources.set('/virtual/dup/two.ts', createFunctionSource('beta', 1));

    // Act
    let program = createProgramFromMap(sources);
    let structural = analyzeStructuralDuplicates(program, 1);
    let hasCloneClass = structural.cloneClasses.some(group => group.items.length >= 2);

    // Assert
    expect(hasCloneClass).toBe(true);
  });

  it('should attach suggestedParams diff pairs', () => {
    // Arrange
    const sources = new Map<string, string>();

    sources.set('/virtual/dup/one.ts', createFunctionSource('createUser', 1));
    sources.set('/virtual/dup/two.ts', createFunctionSource('createOrder', 1));

    // Act
    const program = createProgramFromMap(sources);
    const structural = analyzeStructuralDuplicates(program, 1);
    const group = structural.cloneClasses.find(g => g.items.length >= 2);

    // Assert
    expect(group).toBeDefined();
    expect(group?.suggestedParams).toBeDefined();
    expect(group?.suggestedParams?.kind).toBe('identifier');
    expect(group?.suggestedParams?.pairs.some(p => p.left === 'createUser' && p.right === 'createOrder')).toBe(true);
  });

  it('should not create clone classes when shapes differ', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/dup/one.ts', createFunctionSource('alpha', 1));
    sources.set('/virtual/dup/two.ts', `export function gamma() {\n  return 42;\n}`);

    // Act
    let program = createProgramFromMap(sources);
    let duplication = analyzeStructuralDuplicates(program, 1);

    // Assert
    expect(duplication.cloneClasses.length).toBe(0);
  });

  it('should return no findings when input is empty', () => {
    // Arrange
    let files: ReadonlyArray<ParsedFile> = [];
    // Act
    let duplication = analyzeStructuralDuplicates(files, 1);

    // Assert
    expect(duplication.cloneClasses.length).toBe(0);
  });

  it('should label anonymous functions when headers are missing', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/dup/anon-one.ts', createAnonymousFunctionSource(1));
    sources.set('/virtual/dup/anon-two.ts', createAnonymousFunctionSource(1));

    // Act
    let program = createProgramFromMap(sources);
    let structural = analyzeStructuralDuplicates(program, 1);
    let headers = structural.cloneClasses.flatMap(group => group.items.map(item => item.header));

    // Assert
    expect(headers.some(header => header === 'anonymous')).toBe(true);
  });

  it('should group duplicates when more than two files match', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/dup/one.ts', createFunctionSource('alpha', 1));
    sources.set('/virtual/dup/two.ts', createFunctionSource('beta', 1));
    sources.set('/virtual/dup/three.ts', createFunctionSource('gamma', 1));

    // Act
    let program = createProgramFromMap(sources);
    let structural = analyzeStructuralDuplicates(program, 1);
    let groupSize = structural.cloneClasses.reduce((max, group) => Math.max(max, group.items.length), 0);

    // Assert
    expect(groupSize).toBeGreaterThanOrEqual(3);
  });

  it('should detect interface clone classes when structures match', () => {
    // Arrange
    const sources = new Map<string, string>();

    sources.set('/virtual/dup/iface-one.ts', 'export interface A { value: string; }');
    sources.set('/virtual/dup/iface-two.ts', 'export interface B { value: string; }');

    // Act
    const program = createProgramFromMap(sources);
    const structural = analyzeStructuralDuplicates(program, 1);
    const hasInterfaceGroup = structural.cloneClasses.some(group => group.items.some(item => item.kind === 'interface'));

    // Assert
    expect(hasInterfaceGroup).toBe(true);
  });
});
