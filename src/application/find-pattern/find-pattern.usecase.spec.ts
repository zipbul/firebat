import { mock, afterAll, describe, it, expect } from 'bun:test';
import * as path from 'node:path';

const mockFindPattern = {
  findPatternInFiles: async (_input: unknown) => [] as unknown[],
};
const mockResolveTargets = {
  resolveTargets: async (_cwd: string, targets?: ReadonlyArray<string>) => (targets ?? []) as string[],
};

const __origFindPattern = { ...require(path.resolve(import.meta.dir, '../../tooling/ast-grep/find-pattern.ts')) };
const __origTargetDiscovery = { ...require(path.resolve(import.meta.dir, '../../target-discovery.ts')) };

mock.module(path.resolve(import.meta.dir, '../../tooling/ast-grep/find-pattern.ts'), () => mockFindPattern);
mock.module(path.resolve(import.meta.dir, '../../target-discovery.ts'), () => mockResolveTargets);
import { findPatternUseCase } from './find-pattern.usecase';
import { createNoopLogger } from '../../ports/logger';

const logger = createNoopLogger('error');

describe('findPatternUseCase', () => {
  it('should return empty array when targets resolve to empty', async () => {
    const result = await findPatternUseCase({ targets: [], logger });

    expect(result).toEqual([]);
  });

  it('should return empty array when no targets provided', async () => {
    const result = await findPatternUseCase({ logger });

    expect(result).toEqual([]);
  });

  it('should accept rule option without throwing', async () => {
    const result = await findPatternUseCase({ targets: [], rule: { pattern: 'console.log($A)' }, logger });

    expect(Array.isArray(result)).toBe(true);
  });

  it('should accept matcher option without throwing', async () => {
    const result = await findPatternUseCase({ targets: [], matcher: 'console.log($A)', logger });

    expect(Array.isArray(result)).toBe(true);
  });

  it('should accept ruleName option without throwing', async () => {
    const result = await findPatternUseCase({ targets: [], ruleName: 'no-console', logger });

    expect(Array.isArray(result)).toBe(true);
  });
});

afterAll(() => {
  mock.restore();
  mock.module(path.resolve(import.meta.dir, '../../tooling/ast-grep/find-pattern.ts'), () => __origFindPattern);
  mock.module(path.resolve(import.meta.dir, '../../target-discovery.ts'), () => __origTargetDiscovery);
});
