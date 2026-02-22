import { describe, expect, it } from 'bun:test';

import type { CouplingHotspot, DependencyFanStat } from '../types';

import { sortCouplingHotspots, sortDependencyFanStats } from './sort-utils';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const makeHotspot = (module: string, score: number): CouplingHotspot => ({
  module,
  score,
  signals: [],
  metrics: {
    afferentCoupling: 0,
    efferentCoupling: 0,
    instability: 0,
    distance: 0,
  } as unknown as CouplingHotspot['metrics'],
  why: '',
  suggestedRefactor: '',
});

const makeFan = (module: string, count: number): DependencyFanStat => ({
  module,
  count,
});

// ── sortCouplingHotspots ───────────────────────────────────────────────────────

describe('sortCouplingHotspots', () => {
  it('should sort by score descending when scores differ', () => {
    // Arrange
    const items = [makeHotspot('a', 10), makeHotspot('b', 90), makeHotspot('c', 50)];

    // Act
    const result = sortCouplingHotspots(items);

    // Assert
    expect(result.map(h => h.score)).toEqual([90, 50, 10]);
  });

  it('should sort by module name ascending when scores are equal', () => {
    // Arrange
    const items = [makeHotspot('zoo', 5), makeHotspot('alpha', 5), makeHotspot('beta', 5)];

    // Act
    const result = sortCouplingHotspots(items);

    // Assert
    expect(result.map(h => h.module)).toEqual(['alpha', 'beta', 'zoo']);
  });

  it('should return empty array when input is empty', () => {
    // Arrange & Act
    const result = sortCouplingHotspots([]);

    // Assert
    expect(result).toEqual([]);
  });

  it('should return a one-element array unchanged', () => {
    // Arrange
    const item = makeHotspot('only', 42);

    // Act
    const result = sortCouplingHotspots([item]);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]?.module).toBe('only');
  });

  it('should produce correct descending order for three elements in arbitrary input order', () => {
    // Arrange — provide in ascending order (reversed from expected)
    const items = [makeHotspot('a', 1), makeHotspot('b', 2), makeHotspot('c', 3)];

    // Act
    const result = sortCouplingHotspots(items);

    // Assert
    expect(result.map(h => h.score)).toEqual([3, 2, 1]);
  });

  it('should handle items with identical score and identical module without error', () => {
    // Arrange
    const items = [makeHotspot('x', 7), makeHotspot('x', 7)];

    // Act & Assert
    expect(() => sortCouplingHotspots(items)).not.toThrow();
    expect(sortCouplingHotspots(items)).toHaveLength(2);
  });

  it('should return the same result on two successive calls with the same input', () => {
    // Arrange
    const items = [makeHotspot('b', 5), makeHotspot('a', 10)];

    // Act
    const first = sortCouplingHotspots(items);
    const second = sortCouplingHotspots(items);

    // Assert
    expect(first.map(h => h.module)).toEqual(second.map(h => h.module));
  });

  it('should not mutate the original input array', () => {
    // Arrange
    const items = [makeHotspot('b', 5), makeHotspot('a', 10)];
    const originalModules = items.map(h => h.module);

    // Act
    sortCouplingHotspots(items);

    // Assert
    expect(items.map(h => h.module)).toEqual(originalModules);
  });
});

// ── sortDependencyFanStats ────────────────────────────────────────────────────

describe('sortDependencyFanStats', () => {
  it('should sort by count descending when counts differ', () => {
    // Arrange
    const items = [makeFan('a', 3), makeFan('b', 10), makeFan('c', 1)];

    // Act
    const result = sortDependencyFanStats(items);

    // Assert
    expect(result.map(f => f.count)).toEqual([10, 3, 1]);
  });

  it('should sort by module name ascending when counts are equal', () => {
    // Arrange
    const items = [makeFan('zig', 4), makeFan('ant', 4), makeFan('moo', 4)];

    // Act
    const result = sortDependencyFanStats(items);

    // Assert
    expect(result.map(f => f.module)).toEqual(['ant', 'moo', 'zig']);
  });

  it('should return empty array when input is empty', () => {
    // Arrange & Act
    const result = sortDependencyFanStats([]);

    // Assert
    expect(result).toEqual([]);
  });

  it('should return a one-element array unchanged', () => {
    // Arrange
    const item = makeFan('solo', 99);

    // Act
    const result = sortDependencyFanStats([item]);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]?.module).toBe('solo');
  });

  it('should produce correct descending order for three elements in arbitrary input order', () => {
    // Arrange
    const items = [makeFan('x', 2), makeFan('y', 8), makeFan('z', 5)];

    // Act
    const result = sortDependencyFanStats(items);

    // Assert
    expect(result.map(f => f.count)).toEqual([8, 5, 2]);
  });

  it('should not mutate the original input array', () => {
    // Arrange
    const items = [makeFan('b', 5), makeFan('a', 10)];
    const originalModules = items.map(f => f.module);

    // Act
    sortDependencyFanStats(items);

    // Assert
    expect(items.map(f => f.module)).toEqual(originalModules);
  });
});
