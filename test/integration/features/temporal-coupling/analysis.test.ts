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
  expect(typeof item.span?.end?.line).toBe('number');
};

describe('integration/temporal-coupling', () => {
  it('should report temporal coupling when a module-scope let is written in init and read in query', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-temporal-1', {
      'src/a.ts': [
        'let db: number | null = null;',
        'export function initDb() { db = 1; }',
        'export function queryUsers() { return db; }',
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
            detectors: ['temporal-coupling' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['temporal-coupling'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);

      for (const item of list ?? []) {
        expectBaseFinding(item);
      }
    } finally {
      await project.dispose();
    }
  });

  it('should report temporal coupling when a module-scope var is assigned in one exported function and read in another', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-temporal-2', {
      'src/a.ts': [
        'var token: string | undefined;',
        'export function setToken(v: string) { token = v; }',
        'export function getToken() { return token?.toUpperCase(); }',
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
            detectors: ['temporal-coupling' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['temporal-coupling'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);

      for (const item of list ?? []) {
        expectBaseFinding(item);
      }
    } finally {
      await project.dispose();
    }
  });

  it('should report temporal coupling when a class method relies on an init guard set by another method', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-temporal-3', {
      'src/a.ts': [
        'export class Service {',
        '  private initialized = false;',
        '  init() { this.initialized = true; }',
        '  query() { if (!this.initialized) throw new Error("not ready"); return 1; }',
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
            detectors: ['temporal-coupling' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['temporal-coupling'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);

      for (const item of list ?? []) {
        expectBaseFinding(item);
      }
    } finally {
      await project.dispose();
    }
  });

  it('should report multiple temporal couplings when one writer feeds multiple readers', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-temporal-4', {
      'src/a.ts': [
        'let conn: object | null = null;',
        'export function connect() { conn = {}; }',
        'export function q1() { return conn; }',
        'export function q2() { return conn; }',
        'export function q3() { return conn; }',
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
            detectors: ['temporal-coupling' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['temporal-coupling'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThanOrEqual(2);
    } finally {
      await project.dispose();
    }
  });

  it('should report temporal coupling even when the write is a compound assignment', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-temporal-5', {
      'src/a.ts': [
        'let counter = 0;',
        'export function bump() { counter += 1; }',
        'export function read() { return counter; }',
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
            detectors: ['temporal-coupling' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['temporal-coupling'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);
    } finally {
      await project.dispose();
    }
  });

  it('should not report temporal coupling when state is function-scoped and not shared across exports', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-temporal-neg-1', {
      'src/a.ts': [
        'export function f() {',
        '  let x = 0;',
        '  x += 1;',
        '  return x;',
        '}',
        'export function g() {',
        '  return 1;',
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
            detectors: ['temporal-coupling' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['temporal-coupling'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBe(0);
    } finally {
      await project.dispose();
    }
  });
});
