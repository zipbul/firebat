import { describe, it, expect } from 'bun:test';

import { computeProjectKey, computeScanArtifactKey, computeTraceArtifactKey } from './cache-keys';

describe('computeProjectKey', () => {
  it('[HP] returns a non-empty hash string', () => {
    const key = computeProjectKey({ toolVersion: '1.0.0' });
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
  });

  it('[HP] different toolVersions produce different keys', () => {
    const a = computeProjectKey({ toolVersion: '1.0.0' });
    const b = computeProjectKey({ toolVersion: '2.0.0' });
    expect(a).not.toBe(b);
  });

  it('[HP] different cwd produces different keys', () => {
    const a = computeProjectKey({ toolVersion: '1.0.0', cwd: '/a' });
    const b = computeProjectKey({ toolVersion: '1.0.0', cwd: '/b' });
    expect(a).not.toBe(b);
  });

  it('[HP] same inputs produce same key (deterministic)', () => {
    const a = computeProjectKey({ toolVersion: '1.0.0', cwd: '/root' });
    const b = computeProjectKey({ toolVersion: '1.0.0', cwd: '/root' });
    expect(a).toBe(b);
  });
});

describe('computeScanArtifactKey', () => {
  const base = { detectors: ['lint', 'waste'], minSize: '10', maxForwardDepth: 3 };

  it('[HP] returns a non-empty hash string', () => {
    const key = computeScanArtifactKey(base);
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
  });

  it('[HP] detector order does not affect key (sorted internally)', () => {
    const a = computeScanArtifactKey({ ...base, detectors: ['lint', 'waste'] });
    const b = computeScanArtifactKey({ ...base, detectors: ['waste', 'lint'] });
    expect(a).toBe(b);
  });

  it('[HP] different detectors produce different keys', () => {
    const a = computeScanArtifactKey({ ...base, detectors: ['lint'] });
    const b = computeScanArtifactKey({ ...base, detectors: ['waste'] });
    expect(a).not.toBe(b);
  });

  it('[HP] same inputs produce same key (deterministic)', () => {
    expect(computeScanArtifactKey(base)).toBe(computeScanArtifactKey(base));
  });

  it('[HP] boundary globs are sorted', () => {
    const a = computeScanArtifactKey({ ...base, unknownProofBoundaryGlobs: ['b/**', 'a/**'] });
    const b = computeScanArtifactKey({ ...base, unknownProofBoundaryGlobs: ['a/**', 'b/**'] });
    expect(a).toBe(b);
  });

  it('[HP] dependenciesLayers are normalized and sorted', () => {
    const a = computeScanArtifactKey({
      ...base,
      dependenciesLayers: [
        { name: 'z', glob: 'src/**' },
        { name: 'a', glob: 'lib/**' },
      ],
    });
    const b = computeScanArtifactKey({
      ...base,
      dependenciesLayers: [
        { name: 'a', glob: 'lib/**' },
        { name: 'z', glob: 'src/**' },
      ],
    });
    expect(a).toBe(b);
  });
});

describe('computeTraceArtifactKey', () => {
  it('[HP] returns a non-empty hash string', () => {
    const key = computeTraceArtifactKey({ entryFile: 'src/index.ts', symbol: 'myFunc' });
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
  });

  it('[HP] different symbols produce different keys', () => {
    const a = computeTraceArtifactKey({ entryFile: 'src/index.ts', symbol: 'a' });
    const b = computeTraceArtifactKey({ entryFile: 'src/index.ts', symbol: 'b' });
    expect(a).not.toBe(b);
  });

  it('[HP] same inputs produce same key (deterministic)', () => {
    const input = { entryFile: 'src/index.ts', symbol: 'fn' };
    expect(computeTraceArtifactKey(input)).toBe(computeTraceArtifactKey(input));
  });
});
