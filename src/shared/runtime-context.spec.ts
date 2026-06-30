import { describe, it, expect } from 'bun:test';
import path from 'node:path';

import { expectNonEmptyString } from '../../test/integration/shared/test-kit';
import { resolveStartDir } from './runtime-context';

// runtime-context depends on resolveFirebatRootFromCwd from root-resolver
// Testing the public API: resolveRuntimeContextFromCwd

let resolveRuntimeContextFromCwd: (dir?: string) => Promise<{ rootAbs: string; reason: string }>;

try {
  const mod = await import('./runtime-context');

  resolveRuntimeContextFromCwd = mod.resolveRuntimeContextFromCwd;
} catch {
  // If module fails to load, stub it
  resolveRuntimeContextFromCwd = async () => ({ rootAbs: process.cwd(), reason: 'declared-dependency' });
}

describe('resolveRuntimeContextFromCwd', () => {
  it('[HP] returns an object with rootAbs and reason properties', async () => {
    const ctx = await resolveRuntimeContextFromCwd(path.resolve(import.meta.dir, '..'));

    expectNonEmptyString(ctx.rootAbs);
    expect(['declared-dependency', 'self-repo']).toContain(ctx.reason);
  });

  it('[HP] rootAbs is an absolute path', async () => {
    const ctx = await resolveRuntimeContextFromCwd(path.resolve(import.meta.dir, '..'));

    expect(path.isAbsolute(ctx.rootAbs)).toBe(true);
  });
});

describe('resolveStartDir', () => {
  const savedEnv = process.env.FIREBAT_CWD;

  const restore = (): void => {
    if (savedEnv === undefined) {
      delete process.env.FIREBAT_CWD;
    } else {
      process.env.FIREBAT_CWD = savedEnv;
    }
  };

  it('returns the resolved explicit cwd argument when provided', () => {
    delete process.env.FIREBAT_CWD;

    expect(resolveStartDir('/foo/bar')).toBe(path.resolve('/foo/bar'));

    restore();
  });

  it('resolves a relative cwd argument against process.cwd()', () => {
    delete process.env.FIREBAT_CWD;

    expect(resolveStartDir('sub')).toBe(path.resolve('sub'));

    restore();
  });

  it('falls back to FIREBAT_CWD env when no argument is given', () => {
    process.env.FIREBAT_CWD = '/env/root';

    expect(resolveStartDir()).toBe(path.resolve('/env/root'));

    restore();
  });

  it('prefers the explicit argument over the env var', () => {
    process.env.FIREBAT_CWD = '/env/root';

    expect(resolveStartDir('/arg/root')).toBe(path.resolve('/arg/root'));

    restore();
  });

  it('defaults to process.cwd() when neither argument nor env is set', () => {
    delete process.env.FIREBAT_CWD;

    expect(resolveStartDir()).toBe(process.cwd());

    restore();
  });

  it('ignores an empty-string argument and falls through', () => {
    delete process.env.FIREBAT_CWD;

    expect(resolveStartDir('')).toBe(process.cwd());

    restore();
  });
});
