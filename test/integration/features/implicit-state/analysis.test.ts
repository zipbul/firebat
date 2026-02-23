import { describe, expect, it } from 'bun:test';

import { scanUseCase } from '../../../../src/test-api';
import { createScanLogger, createScanProjectFixtureWithFiles, withCwd } from '../../shared/scan-fixture';

const expectBaseFinding = (item: any): void => {
  expect(item).toBeDefined();
  expect(typeof item.kind).toBe('string');
  expect(typeof item.file).toBe('string');
  expect(item.file.endsWith('.ts')).toBe(true);
  expect(item.span).toBeDefined();
  expect(typeof item.span?.start?.line).toBe('number');
  expect(typeof item.span?.start?.column).toBe('number');
  expect(typeof item.span?.end?.line).toBe('number');
  expect(typeof item.span?.end?.column).toBe('number');
};

describe('integration/implicit-state', () => {
  it('should report implicit state protocol when multiple files reference the same process.env key', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-implicit-1', {
      'src/a.ts': 'export const a = process.env.DATABASE_URL;',
      'src/b.ts': 'export const b = process.env.DATABASE_URL;',
      'src/c.ts': 'export const c = process.env.DATABASE_URL;',
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
            detectors: ['implicit-state' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['implicit-state'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);

      for (const item of list ?? []) {
        expectBaseFinding(item);
        expect(item.message).toBeUndefined();
        expect(item.why).toBeUndefined();
        expect(item.suggestedRefactor).toBeUndefined();
      }

      const files = new Set<string>((list ?? []).map((i: any) => String(i.file)));

      expect(files.size).toBeGreaterThanOrEqual(2);
    } finally {
      await project.dispose();
    }
  });

  it('should report implicit state protocol for module-scope mutable state used across exported functions', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-implicit-2', {
      'src/a.ts': [
        'let cache: Record<string, number> = {};',
        'export function put(k: string, v: number) { cache[k] = v; }',
        'export function get(k: string) { return cache[k]; }',
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
            detectors: ['implicit-state' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['implicit-state'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);

      for (const item of list ?? []) {
        expectBaseFinding(item);
      }
    } finally {
      await project.dispose();
    }
  });

  it('should report implicit state protocol for singleton getInstance usage across files', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-implicit-3', {
      'src/singleton.ts': 'export class S { static instance = new S(); static getInstance() { return this.instance; } }',
      'src/a.ts': "import { S } from './singleton'; export const a = S.getInstance();",
      'src/b.ts': "import { S } from './singleton'; export const b = S.getInstance();",
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
            detectors: ['implicit-state' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['implicit-state'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);

      for (const item of list ?? []) {
        expectBaseFinding(item);
      }
    } finally {
      await project.dispose();
    }
  });

  it('should report implicit state protocol for stringly-typed event channels shared across files', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-implicit-4', {
      'src/emitter.ts': ['export const emit = (name: string) => name;', 'export const on = (name: string) => name;'].join('\n'),
      'src/a.ts': "import { emit } from './emitter'; export const a = emit('user:created');",
      'src/b.ts': "import { on } from './emitter'; export const b = on('user:created');",
      'src/c.ts': "import { on } from './emitter'; export const c = on('user:created');",
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
            detectors: ['implicit-state' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['implicit-state'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);

      for (const item of list ?? []) {
        expectBaseFinding(item);
      }
    } finally {
      await project.dispose();
    }
  });

  it('should report implicit state protocol when multiple env keys are mixed without a single source of truth', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-implicit-5', {
      'src/a.ts': 'export const a = process.env.A + process.env.B;',
      'src/b.ts': 'export const b = process.env.B + process.env.C;',
      'src/c.ts': 'export const c = process.env.A + process.env.C;',
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
            detectors: ['implicit-state' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['implicit-state'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThanOrEqual(1);

      for (const item of list ?? []) {
        expectBaseFinding(item);
      }
    } finally {
      await project.dispose();
    }
  });

  it('should not report implicit state protocol when an env key is referenced in only one file', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-implicit-neg-1', {
      'src/a.ts': 'export const a = process.env.DATABASE_URL;',
      'src/b.ts': 'export const b = 1;',
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
            detectors: ['implicit-state' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['implicit-state'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBe(0);
    } finally {
      await project.dispose();
    }
  });
});
