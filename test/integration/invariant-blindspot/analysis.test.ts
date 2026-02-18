import { describe, expect, it } from 'bun:test';

import { scanUseCase } from '../../../src/application/scan/scan.usecase';
import { createScanLogger, createScanProjectFixtureWithFiles, withCwd } from '../shared/scan-fixture';

const expectBaseFinding = (item: any): void => {
  expect(item).toBeDefined();
  expect(typeof item.kind).toBe('string');
  expect(typeof item.file).toBe('string');
  expect(item.file.endsWith('.ts')).toBe(true);
  expect(item.span).toBeDefined();
};

describe('integration/invariant-blindspot', () => {
  it('should report invariant blindspot when assert() encodes a runtime-only precondition', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-invariant-1', {
      'src/a.ts': ['export function f(items: number[]) {', '  console.assert(items.length > 0);', '  return items[0];', '}'].join(
        '\n',
      ),
    });

    try {
      // Act
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [...project.targetsAbs],
            format: 'json',
            minSize: 0,
            maxForwardDepth: 0,
            exitOnFindings: false,
            detectors: ['invariant-blindspot' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['invariant-blindspot'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);

      for (const item of list ?? []) {
        expectBaseFinding(item);
      }
    } finally {
      await project.dispose();
    }
  });

  it('should report invariant blindspot when a throw guards an assumption not represented in types', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-invariant-2', {
      'src/a.ts': [
        'export function f(x: number | null) {',
        '  if (x === null) throw new Error("x required");',
        '  return x + 1;',
        '}',
      ].join('\n'),
    });

    try {
      // Act
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [...project.targetsAbs],
            format: 'json',
            minSize: 0,
            maxForwardDepth: 0,
            exitOnFindings: false,
            detectors: ['invariant-blindspot' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['invariant-blindspot'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);
    } finally {
      await project.dispose();
    }
  });

  it('should report invariant blindspot when comments contain must/always/never/before constraints', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-invariant-3', {
      'src/a.ts': ['// must call init() before query()', 'export const init = () => 0;', 'export const query = () => 1;'].join(
        '\n',
      ),
    });

    try {
      // Act
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [...project.targetsAbs],
            format: 'json',
            minSize: 0,
            maxForwardDepth: 0,
            exitOnFindings: false,
            detectors: ['invariant-blindspot' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['invariant-blindspot'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);
    } finally {
      await project.dispose();
    }
  });

  it('should report invariant blindspot when array bounds checks are assumed before indexing', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-invariant-4', {
      'src/a.ts': [
        'export function f(xs: string[]) {',
        '  if (xs.length === 0) throw new Error("empty");',
        '  return xs[0].length;',
        '}',
      ].join('\n'),
    });

    try {
      // Act
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [...project.targetsAbs],
            format: 'json',
            minSize: 0,
            maxForwardDepth: 0,
            exitOnFindings: false,
            detectors: ['invariant-blindspot' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['invariant-blindspot'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);
    } finally {
      await project.dispose();
    }
  });

  it('should report invariant blindspot when a default case throws but type does not encode completeness', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-invariant-5', {
      'src/a.ts': [
        'type S = "A" | "B";',
        'export function f(s: S) {',
        '  switch (s) {',
        '    case "A": return 1;',
        '    case "B": return 2;',
        '    default: throw new Error("exhaustive");',
        '  }',
        '}',
      ].join('\n'),
    });

    try {
      // Act
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [...project.targetsAbs],
            format: 'json',
            minSize: 0,
            maxForwardDepth: 0,
            exitOnFindings: false,
            detectors: ['invariant-blindspot' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['invariant-blindspot'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);
    } finally {
      await project.dispose();
    }
  });

  it('should not report invariant blindspot when there is no runtime-only invariant signal', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-invariant-neg-1', {
      'src/a.ts': 'export const add = (a: number, b: number) => a + b;',
    });

    try {
      // Act
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [...project.targetsAbs],
            format: 'json',
            minSize: 0,
            maxForwardDepth: 0,
            exitOnFindings: false,
            detectors: ['invariant-blindspot' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['invariant-blindspot'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBe(0);
    } finally {
      await project.dispose();
    }
  });
});
