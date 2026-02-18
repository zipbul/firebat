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

describe('integration/modification-trap', () => {
  it('should report modification trap when enum-backed switches are duplicated across files', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-mod-trap-1', {
      'src/types.ts': 'export enum Status { A="A", B="B" }',
      'src/a.ts': [
        "import { Status } from './types';",
        'export function f(s: Status) {',
        '  switch (s) { case Status.A: return 1; case Status.B: return 2; default: return 0; }',
        '}',
      ].join('\n'),
      'src/b.ts': [
        "import { Status } from './types';",
        'export function g(s: Status) {',
        '  switch (s) { case Status.A: return 10; case Status.B: return 20; default: return 0; }',
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
            detectors: ['modification-trap' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['modification-trap'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);

      for (const item of list ?? []) {
        expectBaseFinding(item);
      }
    } finally {
      await project.dispose();
    }
  });

  it('should report modification trap when string-literal switches share overlapping cases across files', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-mod-trap-2', {
      'src/a.ts': [
        'export function f(s: string) {',
        '  switch (s) { case "A": return 1; case "B": return 2; case "C": return 3; default: return 0; }',
        '}',
      ].join('\n'),
      'src/b.ts': [
        'export function g(s: string) {',
        '  switch (s) { case "A": return 10; case "B": return 20; case "C": return 30; default: return 0; }',
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
            detectors: ['modification-trap' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['modification-trap'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);
    } finally {
      await project.dispose();
    }
  });

  it('should report modification trap when a union literal requires updating multiple distributed switches', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-mod-trap-3', {
      'src/types.ts': 'export type Status = "A" | "B";',
      'src/a.ts': 'import type { Status } from "./types"; export const f = (s: Status) => (s === "A" ? 1 : 2);',
      'src/b.ts':
        'import type { Status } from "./types"; export const g = (s: Status) => { switch (s) { case "A": return 1; case "B": return 2; } };',
      'src/c.ts':
        'import type { Status } from "./types"; export const h = (s: Status) => { if (s === "A") return 1; if (s === "B") return 2; return 0; };',
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
            detectors: ['modification-trap' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['modification-trap'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);
    } finally {
      await project.dispose();
    }
  });

  it('should report modification trap when changing a shared type cascades into many downstream imports', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-mod-trap-4', {
      'src/types.ts': 'export interface User { id: string; name: string }',
      'src/a.ts': "import type { User } from './types'; export const a = (u: User) => u.id;",
      'src/b.ts': "import type { User } from './types'; export const b = (u: User) => u.name;",
      'src/c.ts': "import type { User } from './types'; export const c = (u: User) => u.name;",
      'src/d.ts': "import type { User } from './types'; export const d = (u: User) => u.name;",
      'src/e.ts': "import type { User } from './types'; export const e = (u: User) => u.name;",
      'src/f.ts': "import type { User } from './types'; export const f = (u: User) => u.name;",
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
            detectors: ['modification-trap' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['modification-trap'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);
    } finally {
      await project.dispose();
    }
  });

  it('should not emit natural-language fields in modification-trap findings', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-mod-trap-5', {
      'src/a.ts': 'export const f = (x: number) => x;',
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
            detectors: ['modification-trap' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['modification-trap'];

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

  it('should not report modification trap when the switch pattern exists in only one file', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-mod-trap-neg-1', {
      'src/types.ts': 'export enum Status { A="A", B="B" }',
      'src/a.ts': [
        "import { Status } from './types';",
        'export function f(s: Status) {',
        '  switch (s) { case Status.A: return 1; case Status.B: return 2; default: return 0; }',
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
            detectors: ['modification-trap' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['modification-trap'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBe(0);
    } finally {
      await project.dispose();
    }
  });
});
