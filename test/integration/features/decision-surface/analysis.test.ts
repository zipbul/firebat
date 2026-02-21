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

describe('integration/decision-surface', () => {
  it('should report decision surface axes when independent condition variables do not overlap', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('decision-surface-1', {
      'src/a.ts': [
        'export function process(user: { vip: boolean }, order: { amount: number }, config: { strict: boolean }) {',
        '  if (user.vip) return 1;',
        '  if (order.amount > 1000) return 2;',
        '  if (config.strict) return 3;',
        '  return 0;',
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
            detectors: ['decision-surface' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['decision-surface'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);

      const item = (list ?? [])[0];

      expectBaseFinding(item);
      expect(typeof item.axes).toBe('number');
      expect(item.axes).toBe(3);
      expect(typeof item.combinatorialPaths).toBe('number');
      expect(item.combinatorialPaths).toBe(8);
    } finally {
      await project.dispose();
    }
  });

  it('should report combinatorial paths when multiple independent boolean conditions exist', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('decision-surface-2', {
      'src/a.ts': [
        'export function f(a: boolean, b: boolean, c: boolean, d: boolean) {',
        '  if (a) return 1;',
        '  if (b) return 2;',
        '  if (c) return 3;',
        '  if (d) return 4;',
        '  return 0;',
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
            detectors: ['decision-surface' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['decision-surface'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);

      const item = (list ?? [])[0];

      expectBaseFinding(item);
      expect(item.axes).toBe(4);
      expect(item.combinatorialPaths).toBe(16);
    } finally {
      await project.dispose();
    }
  });

  it('should report repeated checks on the same axis when a property is tested multiple times', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('decision-surface-3', {
      'src/a.ts': [
        'export function f(user: { role: string }, order: { status: string }) {',
        '  if (user.role === "admin") return 1;',
        '  if (order.status === "ok") return 2;',
        '  if (user.role === "staff") return 3;',
        '  return 0;',
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
            detectors: ['decision-surface' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['decision-surface'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);

      const item = (list ?? [])[0];

      expectBaseFinding(item);
      expect(item.axes).toBe(2);
      expect(item.combinatorialPaths).toBe(4);

      // user.role is checked twice -> repeated checks must be visible.
      expect(typeof item.repeatedChecks).toBe('number');
      expect(item.repeatedChecks).toBeGreaterThanOrEqual(1);
    } finally {
      await project.dispose();
    }
  });

  it('should support config threshold maxAxes when configuration is present', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('decision-surface-4', {
      '.firebatrc.jsonc': '{\n  "features": { "decision-surface": { "maxAxes": 1 } }\n}',
      'src/a.ts': [
        'export function f(a: boolean, b: boolean) {',
        '  if (a) return 1;',
        '  if (b) return 2;',
        '  return 0;',
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
            detectors: ['decision-surface' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['decision-surface'];

      expect(Array.isArray(list)).toBe(true);
    } finally {
      await project.dispose();
    }
  });

  it('should not emit natural-language fields in decision-surface findings', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('decision-surface-5', {
      'src/a.ts': 'export const f = (a: boolean) => (a ? 1 : 2);',
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
            detectors: ['decision-surface' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['decision-surface'];

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

  it('should not report decision surface when axes do not exceed maxAxes threshold', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('decision-surface-neg-1', {
      '.firebatrc.jsonc': '{\n  "features": { "decision-surface": { "maxAxes": 10 } }\n}',
      'src/a.ts': [
        'export function f(a: boolean, b: boolean) {',
        '  if (a) return 1;',
        '  if (b) return 2;',
        '  return 0;',
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
            detectors: ['decision-surface' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['decision-surface'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBe(0);
    } finally {
      await project.dispose();
    }
  });
});
