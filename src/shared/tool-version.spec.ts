import { describe, it, expect } from 'bun:test';

import { computeToolVersion } from './tool-version';

describe('computeToolVersion', () => {
  it('returns a non-empty string', () => {
    const version = computeToolVersion();
    expect(typeof version).toBe('string');
    expect(version.length).toBeGreaterThan(0);
  });

  it('returns a semver-like string (x.y.z format)', () => {
    const version = computeToolVersion();
    expect(/^\d+\.\d+\.\d+/.test(version)).toBe(true);
  });
});
