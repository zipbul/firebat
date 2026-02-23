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

describe('integration/giant-file', () => {
  it('should report giant-file when a single file exceeds the configured maxLines threshold', async () => {
    // Arrange
    const lines = Array.from({ length: 2000 }, (_, i) => `export const x${i} = ${i};`).join('\n');
    const project = await createScanProjectFixtureWithFiles('giant-file-1', {
      '.firebatrc.jsonc': '{\n  "features": { "giant-file": { "maxLines": 1000 } }\n}',
      'src/a.ts': lines,
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
            detectors: ['giant-file' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['giant-file'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);

      const item = (list ?? [])[0];

      expectBaseFinding(item);
    } finally {
      await project.dispose();
    }
  });

  it('should report giant-file when file is large due to many small exports', async () => {
    // Arrange
    const lines = Array.from({ length: 1500 }, (_, i) => `export const f${i} = () => ${i};`).join('\n');
    const project = await createScanProjectFixtureWithFiles('giant-file-2', {
      'src/a.ts': lines,
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
            detectors: ['giant-file' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['giant-file'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);
    } finally {
      await project.dispose();
    }
  });

  it('should include metrics in giant-file findings when reported', async () => {
    // Arrange
    const lines = Array.from({ length: 1200 }, (_, i) => `export const x${i} = ${i};`).join('\n');
    const project = await createScanProjectFixtureWithFiles('giant-file-3', {
      'src/a.ts': lines,
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
            detectors: ['giant-file' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['giant-file'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);
      expect(list?.[0]?.metrics).toBeDefined();
      expect(typeof list?.[0]?.metrics).toBe('object');
    } finally {
      await project.dispose();
    }
  });

  it('should not emit natural-language fields in giant-file findings', async () => {
    // Arrange
    const lines = Array.from({ length: 1100 }, (_, i) => `export const x${i} = ${i};`).join('\n');
    const project = await createScanProjectFixtureWithFiles('giant-file-4', {
      'src/a.ts': lines,
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
            detectors: ['giant-file' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['giant-file'];

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

  it('should report giant-file findings with BaseFinding fields', async () => {
    // Arrange
    const lines = Array.from({ length: 1300 }, (_, i) => `export const x${i} = ${i};`).join('\n');
    const project = await createScanProjectFixtureWithFiles('giant-file-5', {
      'src/a.ts': lines,
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
            detectors: ['giant-file' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['giant-file'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);
      expect(typeof list?.[0]?.kind).toBe('string');
      expect(typeof list?.[0]?.file).toBe('string');
      expect(list?.[0]?.span).toBeDefined();
      expect(list?.[0]?.code).toBeDefined();
    } finally {
      await project.dispose();
    }
  });

  it('should not report giant-file when line count does not exceed maxLines threshold', async () => {
    // Arrange
    const lines = Array.from({ length: 50 }, (_, i) => `export const x${i} = ${i};`).join('\n');
    const project = await createScanProjectFixtureWithFiles('giant-file-neg-1', {
      '.firebatrc.jsonc': '{\n  "features": { "giant-file": { "maxLines": 1000 } }\n}',
      'src/a.ts': lines,
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
            detectors: ['giant-file' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['giant-file'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBe(0);
    } finally {
      await project.dispose();
    }
  });
});
