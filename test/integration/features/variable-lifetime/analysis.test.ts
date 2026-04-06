import { describe, expect, it } from 'bun:test';

import { scanUseCase } from '../../../../src/test-api';
import { createScanLogger, createScanProjectFixtureWithFiles, withCwd } from '../../shared/scan-fixture';

const expectBaseFinding = (item: any): void => {
  expect(item).toBeDefined();
  expect(typeof item.kind).toBe('string');
  expect(typeof item.file).toBe('string');
  expect(item.file.endsWith('.ts')).toBe(true);
  expect(item.span).toBeDefined();
};

describe('integration/variable-lifetime', () => {
  it('should report long-lived variables when definition-to-last-use spans many lines', async () => {
    // Arrange
    const filler = Array.from({ length: 90 }, (_, i) => `  const x${i} = ${i};`).join('\n');
    const project = await createScanProjectFixtureWithFiles('p1-var-life-1', {
      'src/a.ts': ['export function f() {', '  const config = { a: 1 };', filler, '  return config.a;', '}'].join('\n'),
    });

    try {
      // Act
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [...project.targetsAbs],
            minSize: 0,
            maxForwardDepth: 0,
            detectors: ['variable-lifetime' as any],
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['variable-lifetime'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);

      for (const item of list ?? []) {
        expectBaseFinding(item);
      }
    } finally {
      await project.dispose();
    }
  });

  it('should report context burden when multiple long-lived variables exist', async () => {
    // Arrange
    const filler = Array.from({ length: 60 }, (_, i) => `  const x${i} = ${i};`).join('\n');
    const project = await createScanProjectFixtureWithFiles('p1-var-life-2', {
      'src/a.ts': ['export function f() {', '  const a = 1;', '  const b = 2;', filler, '  return a + b;', '}'].join('\n'),
    });

    try {
      // Act
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [...project.targetsAbs],
            minSize: 0,
            maxForwardDepth: 0,
            detectors: ['variable-lifetime' as any],
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['variable-lifetime'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);
      expect(list?.[0]?.contextBurden).toBeDefined();
      expect(typeof list?.[0]?.contextBurden).toBe('number');
      expect(list?.[0]?.contextBurden).toBeGreaterThan(0);
    } finally {
      await project.dispose();
    }
  });

  it('should report multiple variables when several lifetimes exceed the threshold', async () => {
    // Arrange
    const filler = Array.from({ length: 80 }, (_, i) => `  const y${i} = ${i};`).join('\n');
    const project = await createScanProjectFixtureWithFiles('p1-var-life-3', {
      'src/a.ts': ['export function f() {', '  const a = 1;', '  const b = 2;', filler, '  return a + b;', '}'].join('\n'),
    });

    try {
      // Act
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [...project.targetsAbs],
            minSize: 0,
            maxForwardDepth: 0,
            detectors: ['variable-lifetime' as any],
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['variable-lifetime'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThanOrEqual(2);
    } finally {
      await project.dispose();
    }
  });

  it('should support config threshold maxLifetimeLines when configuration is present', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-var-life-4', {
      '.firebatrc.jsonc': '{\n  "features": { "variable-lifetime": { "maxLifetimeLines": 5 } }\n}',
      'src/a.ts': [
        'export function f() {',
        '  const a = 1;',
        '  const x = 0;',
        '  const y = 1;',
        '  const z = 2;',
        '  return a + x + y + z;',
        '}',
      ].join('\n'),
    });

    try {
      // Act
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [...project.targetsAbs],
            minSize: 0,
            maxForwardDepth: 0,
            detectors: ['variable-lifetime' as any],
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['variable-lifetime'];

      expect(Array.isArray(list)).toBe(true);
    } finally {
      await project.dispose();
    }
  });

  it('should not emit natural-language fields in variable-lifetime findings', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-var-life-5', {
      'src/a.ts': 'export const f = () => 1;',
    });

    try {
      // Act
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [...project.targetsAbs],
            minSize: 0,
            maxForwardDepth: 0,
            detectors: ['variable-lifetime' as any],
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['variable-lifetime'];

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

  it('should not report variable lifetime when definition-to-last-use is short', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-var-life-neg-1', {
      'src/a.ts': ['export function f() {', '  const a = 1;', '  return a + 1;', '}'].join('\n'),
    });

    try {
      // Act
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [...project.targetsAbs],
            minSize: 0,
            maxForwardDepth: 0,
            detectors: ['variable-lifetime' as any],
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['variable-lifetime'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBe(0);
    } finally {
      await project.dispose();
    }
  });

  it('should emit liveness-pressure finding when maxLiveVariables and minFunctionLines are configured', async () => {
    // Arrange: 8 vars all live at return, 50-line function; config sets maxLiveVariables:7, minFunctionLines:10
    const filler = Array.from({ length: 45 }, (_, i) => `  const pad${i} = ${i};`).join('\n');
    const project = await createScanProjectFixtureWithFiles('p1-var-life-liveness-1', {
      '.firebatrc.jsonc':
        '{\n  "features": { "variable-lifetime": { "maxLifetimeLines": 999, "maxLiveVariables": 7, "minFunctionLines": 10 } }\n}',
      'src/a.ts': [
        'export function bigFn() {',
        '  const a = 1;',
        '  const b = 2;',
        '  const c = 3;',
        '  const d = 4;',
        '  const e = 5;',
        '  const f = 6;',
        '  const g = 7;',
        '  const h = 8;',
        filler,
        '  return a + b + c + d + e + f + g + h;',
        '}',
      ].join('\n'),
    });

    try {
      // Act
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [...project.targetsAbs],
            minSize: 0,
            maxForwardDepth: 0,
            detectors: ['variable-lifetime' as any],
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['variable-lifetime'];

      expect(Array.isArray(list)).toBe(true);

      const pressureFindings = (list ?? []).filter((item: any) => item.kind === 'liveness-pressure');

      expect(pressureFindings.length).toBeGreaterThanOrEqual(1);
      expect(pressureFindings[0]?.maxLiveVariables).toBeGreaterThanOrEqual(7);
      expect(typeof pressureFindings[0]?.functionLineCount).toBe('number');
      expect(pressureFindings[0]?.functionLineCount).toBeGreaterThanOrEqual(10);
      expect(typeof pressureFindings[0]?.hotSpotLine).toBe('number');
    } finally {
      await project.dispose();
    }
  });

  it('should not emit liveness-pressure finding when maxLiveVariables is set very high in config', async () => {
    // Arrange: 8 vars all live at return, 50-line function; config sets maxLiveVariables to 999 → no fire
    const filler = Array.from({ length: 45 }, (_, i) => `  const pad${i} = ${i};`).join('\n');
    const project = await createScanProjectFixtureWithFiles('p1-var-life-liveness-2', {
      '.firebatrc.jsonc':
        '{\n  "features": { "variable-lifetime": { "maxLifetimeLines": 999, "maxLiveVariables": 999, "minFunctionLines": 10 } }\n}',
      'src/a.ts': [
        'export function bigFnHighThreshold() {',
        '  const a = 1;',
        '  const b = 2;',
        '  const c = 3;',
        '  const d = 4;',
        '  const e = 5;',
        '  const f = 6;',
        '  const g = 7;',
        '  const h = 8;',
        filler,
        '  return a + b + c + d + e + f + g + h;',
        '}',
      ].join('\n'),
    });

    try {
      // Act
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [...project.targetsAbs],
            minSize: 0,
            maxForwardDepth: 0,
            detectors: ['variable-lifetime' as any],
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert — no liveness-pressure because maxLiveVariables threshold (999) is above actual live count
      const list = (report as any)?.analyses?.['variable-lifetime'];

      expect(Array.isArray(list)).toBe(true);

      const pressureFindings = (list ?? []).filter((item: any) => item.kind === 'liveness-pressure');

      expect(pressureFindings.length).toBe(0);
    } finally {
      await project.dispose();
    }
  });
});
