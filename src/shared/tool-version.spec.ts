import { describe, it, expect } from 'bun:test';

import { expectNonEmptyString } from '../../test/integration/shared/test-kit';
import { computeToolVersion } from './tool-version';

describe('computeToolVersion', () => {
  it('returns a non-empty string', () => {
    const version = computeToolVersion();

    expectNonEmptyString(version);
  });

  it('returns a semver-like string (x.y.z format)', () => {
    const version = computeToolVersion();

    expect(/^\d+\.\d+\.\d+/.test(version)).toBe(true);
  });
});
