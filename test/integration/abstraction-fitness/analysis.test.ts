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

describe('integration/abstraction-fitness', () => {
  it('should report abstraction fitness below threshold when cohesion is lower than coupling', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('abstraction-fitness-1', {
      'src/order/a.ts': "import { pay } from '../payment/p'; export const a = () => pay();",
      'src/order/b.ts': "import { pay } from '../payment/p'; export const b = () => pay();",
      'src/payment/p.ts': 'export const pay = () => 0;',
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
            detectors: ['abstraction-fitness' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['abstraction-fitness'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);

      const item = (list ?? [])[0];

      expectBaseFinding(item);
      expect(typeof item.internalCohesion).toBe('number');
      expect(typeof item.externalCoupling).toBe('number');
      expect(typeof item.fitness).toBe('number');
    } finally {
      await project.dispose();
    }
  });

  it('should include cohesion, coupling, and fitness score components when reporting findings', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('abstraction-fitness-2', {
      'src/a.ts': 'export const a = () => 1;',
      'src/b.ts': "import { a } from './a'; export const b = () => a();",
      'src/c.ts': "import { b } from './b'; export const c = () => b();",
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
            detectors: ['abstraction-fitness' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['abstraction-fitness'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);
      expect(typeof list?.[0]?.internalCohesion).toBe('number');
      expect(typeof list?.[0]?.externalCoupling).toBe('number');
      expect(typeof list?.[0]?.fitness).toBe('number');
    } finally {
      await project.dispose();
    }
  });

  it('should support config threshold minFitnessScore when configuration is present', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('abstraction-fitness-3', {
      '.firebatrc.jsonc': '{\n  "features": { "abstraction-fitness": { "minFitnessScore": 100 } }\n}',
      'src/a.ts': 'export const a = () => 1;',
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
            detectors: ['abstraction-fitness' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['abstraction-fitness'];

      expect(Array.isArray(list)).toBe(true);
    } finally {
      await project.dispose();
    }
  });

  it('should identify modules that reference external symbols more than internal ones', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('abstraction-fitness-4', {
      'src/mod/a.ts': 'export const a = () => 0;',
      'src/mod/b.ts': "import { x } from '../other/x'; export const b = () => x();",
      'src/mod/c.ts': "import { x } from '../other/x'; export const c = () => x();",
      'src/other/x.ts': 'export const x = () => 0;',
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
            detectors: ['abstraction-fitness' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['abstraction-fitness'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);
    } finally {
      await project.dispose();
    }
  });

  it('should not emit natural-language fields in abstraction-fitness findings', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('abstraction-fitness-5', {
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
            detectors: ['abstraction-fitness' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['abstraction-fitness'];

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

  it('should not report abstraction fitness when fitness meets or exceeds minFitnessScore threshold', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('abstraction-fitness-neg-1', {
      '.firebatrc.jsonc': '{\n  "features": { "abstraction-fitness": { "minFitnessScore": 0 } }\n}',
      'src/a.ts': 'export const a = () => 1;',
      'src/b.ts': 'export const b = () => 2;',
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
            detectors: ['abstraction-fitness' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['abstraction-fitness'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBe(0);
    } finally {
      await project.dispose();
    }
  });
});
