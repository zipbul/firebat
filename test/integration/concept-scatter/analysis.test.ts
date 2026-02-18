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

describe('integration/concept-scatter', () => {
  it('should report concept scatter index when a concept spans many files and layers', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('concept-scatter-1', {
      'src/adapters/payment.ts': 'export const createPayment = () => 0;',
      'src/application/payment.ts': 'export const processPayment = () => 0;',
      'src/ports/payment.ts': 'export interface PaymentPort { pay(): void }',
      'src/infrastructure/payment.ts': 'export const paymentGateway = () => 0;',
      'src/infrastructure/payment2.ts': 'export const paymentRepo = () => 0;',
      'src/infrastructure/payment3.ts': 'export const paymentCache = () => 0;',
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
            detectors: ['concept-scatter' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['concept-scatter'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);

      const item = (list ?? [])[0];

      expectBaseFinding(item);
      expect(typeof item.concept).toBe('string');
      expect(typeof item.scatterIndex).toBe('number');
    } finally {
      await project.dispose();
    }
  });

  it('should extract concepts from identifiers and report scatter per concept', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('concept-scatter-2', {
      'src/a.ts': 'export const createUser = () => 0; export class UserService { run() {} }',
      'src/b.ts': 'export const deleteUser = () => 0; export class UserRepo { run() {} }',
      'src/c.ts': 'export const updateUser = () => 0; export class UserController { run() {} }',
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
            detectors: ['concept-scatter' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['concept-scatter'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);
      expect(typeof list?.[0]?.concept).toBe('string');
      expect(typeof list?.[0]?.scatterIndex).toBe('number');
      expect(list?.[0]?.files).toBeDefined();
      expect(list?.[0]?.layers).toBeDefined();
    } finally {
      await project.dispose();
    }
  });

  it('should support config threshold maxScatterIndex when configuration is present', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('concept-scatter-3', {
      '.firebatrc.jsonc': '{\n  "features": { "concept-scatter": { "maxScatterIndex": 1 } }\n}',
      'src/a.ts': 'export const createUser = () => 0;',
      'src/b.ts': 'export const updateUser = () => 0;',
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
            detectors: ['concept-scatter' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['concept-scatter'];

      expect(Array.isArray(list)).toBe(true);
    } finally {
      await project.dispose();
    }
  });

  it('should report high scatter when the same concept appears across many modules', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('concept-scatter-4', {
      'src/a.ts': 'export const PaymentGateway = () => 0;',
      'src/b.ts': 'export const PaymentService = () => 0;',
      'src/c.ts': 'export const PaymentController = () => 0;',
      'src/d.ts': 'export const PaymentPort = () => 0;',
      'src/e.ts': 'export const PaymentInfra = () => 0;',
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
            detectors: ['concept-scatter' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );

      // Assert
      expect(Array.isArray((report as any)?.analyses?.['concept-scatter'])).toBe(true);
      expect(((report as any)?.analyses?.['concept-scatter'] ?? []).length).toBeGreaterThan(0);
    } finally {
      await project.dispose();
    }
  });

  it('should not emit natural-language fields in concept-scatter findings', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('concept-scatter-5', {
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
            detectors: ['concept-scatter' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['concept-scatter'];

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

  it('should not report concept scatter when scatterIndex does not exceed maxScatterIndex threshold', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('concept-scatter-neg-1', {
      '.firebatrc.jsonc': '{\n  "features": { "concept-scatter": { "maxScatterIndex": 999 } }\n}',
      'src/a.ts': 'export const createUser = () => 0;',
      'src/b.ts': 'export const updateUser = () => 0;',
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
            detectors: ['concept-scatter' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['concept-scatter'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBe(0);
    } finally {
      await project.dispose();
    }
  });
});
