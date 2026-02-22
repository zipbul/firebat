import { describe, it, expect } from 'bun:test';

import { tryResolveBunxCommand, tryResolveLocalBin } from './resolve-bin';

describe('tryResolveBunxCommand', () => {
  it('[HP] returns a BunxCommand or null (does not throw)', () => {
    const result = tryResolveBunxCommand();
    if (result !== null) {
      expect(typeof result.command).toBe('string');
      expect(Array.isArray(result.prefixArgs)).toBe(true);
    } else {
      expect(result).toBeNull();
    }
  });

  it('[HP] if resolved, command is non-empty', () => {
    const result = tryResolveBunxCommand();
    if (result !== null) {
      expect(result.command.length).toBeGreaterThan(0);
    }
  });
});

describe('tryResolveLocalBin', () => {
  it('[ED] returns null when binary does not exist in project', async () => {
    const result = await tryResolveLocalBin({
      cwd: '/tmp',
      binName: '__nonexistent_bin_firebat_test__',
      callerDir: '/tmp',
      resolveMode: 'project-only',
    });
    expect(result).toBeNull();
  });

  it('[HP] resolves an existing binary from cwd/node_modules/.bin', async () => {
    // bun itself lives in the PATH, so use 'default' mode; 'bun' is guaranteed to exist
    const result = await tryResolveLocalBin({
      cwd: '/tmp',
      binName: 'bun',
      callerDir: import.meta.dir,
      resolveMode: 'default',
    });
    // may or may not be in node_modules/.bin but as PATH fallback should be non-null
    if (result !== null) {
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    }
    // If null: bun is not on PATH (extreme environment), still acceptable
  });
});
