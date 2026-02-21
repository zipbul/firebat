import { describe, expect, it } from 'bun:test';

import { scanUseCase } from '../../../../src/application/scan/scan.usecase';
import { createScanLogger, createScanProjectFixtureWithFiles, withCwd } from '../../shared/scan-fixture';

const expectBaseFinding = (item: any): void => {
  expect(item).toBeDefined();
  expect(typeof item.kind).toBe('string');
  expect(typeof item.file).toBe('string');
  expect(item.file.endsWith('.ts')).toBe(true);
  expect(item.span).toBeDefined();
};

describe('integration/implementation-overhead', () => {
  it('should report overhead ratio when implementation complexity is large vs interface complexity', async () => {
    // Arrange
    const impl = Array.from({ length: 50 }, (_, i) => `  const v${i} = ${i};`).join('\n');
    const project = await createScanProjectFixtureWithFiles('implementation-overhead-1', {
      'src/a.ts': [
        'export function processPayment(config: { a: number }, input: { b: number }): { ok: boolean; id: string } {',
        impl,
        '  if (config.a > input.b) return { ok: true, id: "x" };',
        '  return { ok: false, id: "y" };',
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
            detectors: ['implementation-overhead' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['implementation-overhead'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);

      const item = (list ?? [])[0];

      expectBaseFinding(item);
      expect(typeof item.interfaceComplexity).toBe('number');
      expect(typeof item.implementationComplexity).toBe('number');
      expect(typeof item.ratio).toBe('number');
      expect(item.ratio).toBeGreaterThan(0);

      // Contract: ratio must match derived complexities.
      const expected = item.implementationComplexity / Math.max(1, item.interfaceComplexity);

      expect(Math.abs(item.ratio - expected)).toBeLessThan(0.0001);
    } finally {
      await project.dispose();
    }
  });

  it('should include interface and implementation complexity components when reporting ratio', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('implementation-overhead-2', {
      'src/a.ts':
        'export function f(a: { x: number; y: number }, b: number): { ok: boolean } { const c = a.x + b; if (c) { return { ok: true }; } return { ok: false }; }',
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
            detectors: ['implementation-overhead' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['implementation-overhead'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);
      expect(typeof list?.[0]?.interfaceComplexity).toBe('number');
      expect(typeof list?.[0]?.implementationComplexity).toBe('number');
      expect(typeof list?.[0]?.ratio).toBe('number');
    } finally {
      await project.dispose();
    }
  });

  it('should support config threshold minRatio when configuration is present', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('implementation-overhead-3', {
      '.firebatrc.jsonc': '{\n  "features": { "implementation-overhead": { "minRatio": 1.0 } }\n}',
      'src/a.ts': 'export function f(a: number): number { let x = a; x++; x++; x++; return x; }',
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
            detectors: ['implementation-overhead' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['implementation-overhead'];

      expect(Array.isArray(list)).toBe(true);
    } finally {
      await project.dispose();
    }
  });

  it('should report high-overhead functions when one function dominates the project distribution', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('implementation-overhead-4', {
      'src/a.ts': 'export function a(x: number) { return x + 1; }',
      'src/b.ts': 'export function b(x: number) { return x + 1; }',
      'src/c.ts': 'export function c(x: number) { return x + 1; }',
      'src/d.ts': 'export function d(x: number) { return x + 1; }',
      'src/e.ts': 'export function e(x: number) { return x + 1; }',
      'src/f.ts':
        'export function f(config: { a: number; b: number }, input: { c: number }): number { let sum = 0; for (let i=0;i<100;i++) { sum += i + config.a + config.b + input.c; } return sum; }',
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
            detectors: ['implementation-overhead' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['implementation-overhead'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);
    } finally {
      await project.dispose();
    }
  });

  it('should not emit natural-language fields in implementation-overhead findings', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('implementation-overhead-5', {
      'src/a.ts': 'export const x = 1;',
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
            detectors: ['implementation-overhead' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['implementation-overhead'];

      expect(Array.isArray(list)).toBe(true);

      for (const item of list ?? []) {
        expectBaseFinding(item);
        expect(item.message).toBeUndefined();
        expect(item.why).toBeUndefined();
        expect(item.suggestedRefactor).toBeUndefined();
      }
    } finally {
      await project.dispose();
    }
  });

  it('should not report implementation overhead when ratio does not exceed minRatio threshold', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('implementation-overhead-neg-1', {
      '.firebatrc.jsonc': '{\n  "features": { "implementation-overhead": { "minRatio": 999 } }\n}',
      'src/a.ts': 'export function f(a: number) { return a + 1; }',
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
            detectors: ['implementation-overhead' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['implementation-overhead'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBe(0);
    } finally {
      await project.dispose();
    }
  });
});
