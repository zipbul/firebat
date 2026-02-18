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

describe('integration/modification-impact', () => {
  it('should report modification impact radius for a symbol with many callers and shared types', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-impact-1', {
      'src/types.ts': 'export interface User { id: string; name: string }',
      'src/repo.ts': 'import type { User } from "./types"; export interface Repo { save(u: User): void }',
      'src/service.ts': [
        'import type { Repo } from "./repo";',
        'import type { User } from "./types";',
        'export class UserService {',
        '  constructor(private readonly repo: Repo) {}',
        '  updateProfile(u: User) { this.repo.save(u); }',
        '}',
      ].join('\n'),
      'src/a.ts': "import { UserService } from './service'; export const a = (s: UserService, u: any) => s.updateProfile(u);",
      'src/b.ts': "import { UserService } from './service'; export const b = (s: UserService, u: any) => s.updateProfile(u);",
      'src/c.ts': "import { UserService } from './service'; export const c = (s: UserService, u: any) => s.updateProfile(u);",
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
            detectors: ['modification-impact' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['modification-impact'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);

      for (const item of list ?? []) {
        expectBaseFinding(item);
      }
    } finally {
      await project.dispose();
    }
  });

  it('should report impact radius with impacted file/symbol counts when call chains exist', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-impact-2', {
      'src/a.ts': 'export const f = () => 1;',
      'src/b.ts': 'import { f } from "./a"; export const g = () => f();',
      'src/c.ts': 'import { g } from "./b"; export const h = () => g();',
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
            detectors: ['modification-impact' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['modification-impact'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);
      expect(list?.[0]?.impactRadius).toBeDefined();
      expect(typeof list?.[0]?.impactRadius).toBe('number');
      expect(list?.[0]?.impactRadius).toBeGreaterThan(0);
    } finally {
      await project.dispose();
    }
  });

  it('should emit highRiskCallers for impact radius findings when callers cross layers', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-impact-3', {
      'src/application/service.ts': 'export const f = () => 1;',
      'src/adapters/cli/entry.ts': 'import { f } from "../../application/service"; export const run = () => f();',
      'src/infrastructure/db.ts': 'import { f } from "../application/service"; export const db = () => f();',
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
            detectors: ['modification-impact' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['modification-impact'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);
      expect(list?.[0]?.highRiskCallers).toBeDefined();
      expect(Array.isArray(list?.[0]?.highRiskCallers)).toBe(true);
    } finally {
      await project.dispose();
    }
  });

  it('should report impact radius for exported functions that are public surface hotspots', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-impact-4', {
      'src/api.ts': 'export const update = (x: number) => x;',
      'src/c1.ts': 'import { update } from "./api"; export const a = () => update(1);',
      'src/c2.ts': 'import { update } from "./api"; export const b = () => update(2);',
      'src/c3.ts': 'import { update } from "./api"; export const c = () => update(3);',
      'src/c4.ts': 'import { update } from "./api"; export const d = () => update(4);',
      'src/c5.ts': 'import { update } from "./api"; export const e = () => update(5);',
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
            detectors: ['modification-impact' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['modification-impact'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);
    } finally {
      await project.dispose();
    }
  });

  it('should not emit natural-language fields in modification-impact findings', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-impact-5', {
      'src/a.ts': 'export const f = () => 1;',
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
            detectors: ['modification-impact' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['modification-impact'];

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

  it('should not report modification impact radius when a symbol has a single local caller', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-impact-neg-1', {
      'src/a.ts': 'export const f = () => 1;',
      'src/b.ts': 'import { f } from "./a"; export const g = () => f();',
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
            detectors: ['modification-impact' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['modification-impact'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBe(0);
    } finally {
      await project.dispose();
    }
  });
});
