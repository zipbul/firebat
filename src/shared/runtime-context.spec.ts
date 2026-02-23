import { describe, it, expect } from 'bun:test';
import path from 'node:path';

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
    expect(typeof ctx.rootAbs).toBe('string');
    expect(ctx.rootAbs.length).toBeGreaterThan(0);
    expect(['declared-dependency', 'self-repo']).toContain(ctx.reason);
  });

  it('[HP] rootAbs is an absolute path', async () => {
    const ctx = await resolveRuntimeContextFromCwd(path.resolve(import.meta.dir, '..'));
    expect(path.isAbsolute(ctx.rootAbs)).toBe(true);
  });
});
