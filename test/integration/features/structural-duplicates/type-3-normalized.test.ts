import { describe, expect, it } from 'bun:test';

import { detectClones } from '../../../../src/test-api';
import { createProgramFromMap } from '../../shared/test-kit';

const expectHasCloneClassOf2 = (groups: ReturnType<typeof detectClones>): void => {
  const has = groups.some(group => group.items.length === 2);

  expect(has).toBe(true);
};

const expectNoCloneClasses = (groups: ReturnType<typeof detectClones>): void => {
  expect(groups.length).toBe(0);
};

describe('integration/structural-duplicates/type-3-normalized', () => {
  it('should detect clones when if-else is equivalent to ternary', () => {
    // Arrange
    const sources = new Map<string, string>();

    sources.set(
      '/virtual/normalized/if-else.ts',
      `export function alpha(cond: boolean, a: number, b: number) {\n  if (cond) {\n    return a;\n  } else {\n    return b;\n  }\n}`,
    );

    sources.set(
      '/virtual/normalized/ternary.ts',
      `export function beta(cond: boolean, a: number, b: number) {\n  return cond ? a : b;\n}`,
    );

    const program = createProgramFromMap(sources);
    // Act
    const shape = detectClones(program, 1, 'type-2-shape');
    const normalized = detectClones(program, 1, 'type-3-normalized');

    // Assert
    expectNoCloneClasses(shape);
    expectHasCloneClassOf2(normalized);
  });

  it('should detect clones when if-else expression statement is equivalent to ternary expression statement', () => {
    // Arrange
    const sources = new Map<string, string>();

    sources.set(
      '/virtual/normalized/if-else-expr.ts',
      `export function alpha(cond: boolean, a: number, b: number) {\n  if (cond) {\n    ping(a);\n  } else {\n    pong(b);\n  }\n}`,
    );

    sources.set(
      '/virtual/normalized/ternary-expr.ts',
      `export function beta(cond: boolean, a: number, b: number) {\n  cond ? ping(a) : pong(b);\n}`,
    );

    const program = createProgramFromMap(sources);
    // Act
    const shape = detectClones(program, 1, 'type-2-shape');
    const normalized = detectClones(program, 1, 'type-3-normalized');

    // Assert
    expectNoCloneClasses(shape);
    expectHasCloneClassOf2(normalized);
  });

  it('should detect clones when for-loop is equivalent to while-loop', () => {
    // Arrange
    const sources = new Map<string, string>();

    sources.set(
      '/virtual/normalized/for.ts',
      `export function alpha(limit: number) {\n  let sum = 0;\n  for (let i = 0; i < limit; i++) {\n    sum += i;\n  }\n  return sum;\n}`,
    );

    sources.set(
      '/virtual/normalized/while.ts',
      `export function beta(limit: number) {\n  let sum = 0;\n  let i = 0;\n  while (i < limit) {\n    sum += i;\n    i++;\n  }\n  return sum;\n}`,
    );

    const program = createProgramFromMap(sources);
    // Act
    const shape = detectClones(program, 1, 'type-2-shape');
    const normalized = detectClones(program, 1, 'type-3-normalized');

    // Assert
    expectNoCloneClasses(shape);
    expectHasCloneClassOf2(normalized);
  });

  it('should detect clones when forEach is equivalent to for-of when callback has no return', () => {
    // Arrange
    const sources = new Map<string, string>();

    sources.set(
      '/virtual/normalized/foreach.ts',
      `export function alpha(items: number[]) {\n  let sum = 0;\n  items.forEach(x => {\n    sum += x;\n  });\n  return sum;\n}`,
    );

    sources.set(
      '/virtual/normalized/for-of.ts',
      `export function beta(items: number[]) {\n  let sum = 0;\n  for (const x of items) {\n    sum += x;\n  }\n  return sum;\n}`,
    );

    const program = createProgramFromMap(sources);
    // Act
    const shape = detectClones(program, 1, 'type-2-shape');
    const normalized = detectClones(program, 1, 'type-3-normalized');

    // Assert
    expectNoCloneClasses(shape);
    expectHasCloneClassOf2(normalized);
  });

  it('should detect clones when optional chaining is equivalent to null-check conditional', () => {
    // Arrange
    const sources = new Map<string, string>();

    sources.set('/virtual/normalized/optional.ts', `export function alpha(obj: any) {\n  return obj?.value;\n}`);

    sources.set(
      '/virtual/normalized/conditional.ts',
      `export function beta(obj: any) {\n  return obj != null ? obj.value : undefined;\n}`,
    );

    const program = createProgramFromMap(sources);
    // Act
    const shape = detectClones(program, 1, 'type-2-shape');
    const normalized = detectClones(program, 1, 'type-3-normalized');

    // Assert
    expectNoCloneClasses(shape);
    expectHasCloneClassOf2(normalized);
  });

  it('should detect clones when template literal is equivalent to string concatenation', () => {
    // Arrange
    const sources = new Map<string, string>();

    sources.set('/virtual/normalized/template.ts', 'export function alpha(x: string) {\n  return `hello ${x}!`;\n}');

    sources.set('/virtual/normalized/concat.ts', "export function beta(x: string) {\n  return 'hello ' + x + '!';\n}");

    const program = createProgramFromMap(sources);
    // Act
    const shape = detectClones(program, 1, 'type-2-shape');
    const normalized = detectClones(program, 1, 'type-3-normalized');

    // Assert
    expectNoCloneClasses(shape);
    expectHasCloneClassOf2(normalized);
  });

  it('should detect clones when De Morgan normalization applies', () => {
    // Arrange
    const sources = new Map<string, string>();

    sources.set('/virtual/normalized/demorgan-a.ts', `export function alpha(a: boolean, b: boolean) {\n  return !(a && b);\n}`);

    sources.set('/virtual/normalized/demorgan-b.ts', `export function beta(a: boolean, b: boolean) {\n  return !a || !b;\n}`);

    const program = createProgramFromMap(sources);
    // Act
    const shape = detectClones(program, 1, 'type-2-shape');
    const normalized = detectClones(program, 1, 'type-3-normalized');

    // Assert
    expectNoCloneClasses(shape);
    expectHasCloneClassOf2(normalized);
  });

  it('should detect clones when ternary inversion normalization applies', () => {
    // Arrange
    const sources = new Map<string, string>();

    sources.set(
      '/virtual/normalized/ternary-invert-a.ts',
      `export function alpha(cond: boolean, a: number, b: number) {\n  return !cond ? a : b;\n}`,
    );

    sources.set(
      '/virtual/normalized/ternary-invert-b.ts',
      `export function beta(cond: boolean, a: number, b: number) {\n  return cond ? b : a;\n}`,
    );

    const program = createProgramFromMap(sources);
    // Act
    const shape = detectClones(program, 1, 'type-2-shape');
    const normalized = detectClones(program, 1, 'type-3-normalized');

    // Assert
    expectNoCloneClasses(shape);
    expectHasCloneClassOf2(normalized);
  });

  it('should detect clones when map/filter(Boolean) is equivalent to loop with conditional push', () => {
    // Arrange
    const sources = new Map<string, string>();

    sources.set(
      '/virtual/normalized/map-filter.ts',
      `export function alpha(items: number[]) {\n  items.map(x => x + 1).filter(Boolean);\n}`,
    );

    sources.set(
      '/virtual/normalized/loop-push.ts',
      `export function beta(items: number[]) {\n  for (const x of items) {\n    const mapped = x + 1;\n    if (mapped) {\n      consume(mapped);\n    }\n  }\n}`,
    );

    const program = createProgramFromMap(sources);
    // Act
    const shape = detectClones(program, 1, 'type-2-shape');
    const normalized = detectClones(program, 1, 'type-3-normalized');

    // Assert
    expectNoCloneClasses(shape);
    expectHasCloneClassOf2(normalized);
  });

  it('should not detect clones when forEach callback contains return', () => {
    // Arrange
    const sources = new Map<string, string>();

    sources.set(
      '/virtual/normalized/foreach-return.ts',
      `export function alpha(items: number[]) {\n  let sum = 0;\n  items.forEach(x => {\n    if (x === 0) {\n      return;\n    }\n    sum += x;\n  });\n  return sum;\n}`,
    );

    sources.set(
      '/virtual/normalized/for-of-sum.ts',
      `export function beta(items: number[]) {\n  let sum = 0;\n  for (const x of items) {\n    if (x === 0) {\n      continue;\n    }\n    sum += x;\n  }\n  return sum;\n}`,
    );

    const program = createProgramFromMap(sources);
    // Act
    const normalized = detectClones(program, 1, 'type-3-normalized');

    // Assert
    expectNoCloneClasses(normalized);
  });

  it('should not detect clones when optional chaining is not optional', () => {
    // Arrange
    const sources = new Map<string, string>();

    sources.set('/virtual/normalized/non-optional.ts', `export function alpha(obj: any) {\n  return obj.value;\n}`);

    sources.set(
      '/virtual/normalized/null-check.ts',
      `export function beta(obj: any) {\n  return obj != null ? obj.value : undefined;\n}`,
    );

    const program = createProgramFromMap(sources);
    // Act
    const normalized = detectClones(program, 1, 'type-3-normalized');

    // Assert
    expectNoCloneClasses(normalized);
  });
});
