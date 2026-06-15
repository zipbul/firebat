import { describe, it, expect } from 'bun:test';

import type { DependencyAnalysis } from '../../types';

import { analyzeCoupling, createEmptyCoupling } from './analyzer';

type Adjacency = Record<string, string[]>;

const noCycles: DependencyAnalysis['cycles'] = [];

const emptyDeps = (): DependencyAnalysis => ({
  adjacency: {},
  exportStats: {},
  cycles: noCycles,
  fanIn: [],
  fanOut: [],
  cuts: [],
  layerViolations: [],
  deadExports: [],
  unusedFiles: [],
  unusedDeps: [],
  unresolvedImports: [],
  duplicateExports: [],
  unusedMembers: [],
});

const makeDeps = (overrides: Partial<DependencyAnalysis>): DependencyAnalysis => ({
  ...emptyDeps(),
  ...overrides,
});

// Analyze a graph and return the hotspot for `module` (undefined when it is not a hotspot).
const hotspotFor = (overrides: Partial<DependencyAnalysis>, module: string) => {
  return analyzeCoupling(makeDeps(overrides)).find(h => h.module === module);
};

const range = (count: number): number[] => Array.from({ length: count }, (_, i) => i + 1);

// hub imports `downstream` modules and is imported by `upstream` modules.
const hubAdjacency = (upstream: number, downstream: number): Adjacency => {
  const adjacency: Adjacency = { hub: range(downstream).map(i => `down${i}`) };

  range(downstream).forEach(i => {
    adjacency[`down${i}`] = [];
  });

  range(upstream).forEach(i => {
    adjacency[`up${i}`] = ['hub'];
  });

  return adjacency;
};

// A imports `fanOut` leaf modules and is imported by nobody (instability = 1).
const fanOutAdjacency = (fanOut: number): Adjacency => {
  const adjacency: Adjacency = { A: range(fanOut).map(i => `dep${i}`) };

  range(fanOut).forEach(i => {
    adjacency[`dep${i}`] = [];
  });

  return adjacency;
};

// `importers` modules import target; target imports `fanOut` leaf modules.
const fanInAdjacency = (target: string, importers: number, fanOut: number): Adjacency => {
  const adjacency: Adjacency = { [target]: range(fanOut).map(i => `o${i}`) };

  range(importers).forEach(i => {
    adjacency[`importer${i}`] = [target];
  });

  range(fanOut).forEach(i => {
    adjacency[`o${i}`] = [];
  });

  return adjacency;
};

describe('createEmptyCoupling', () => {
  it('returns an empty array', () => {
    expect(createEmptyCoupling()).toEqual([]);
  });
});

describe('analyzeCoupling', () => {
  it('[ED] returns [] when adjacency is empty', () => {
    expect(analyzeCoupling(emptyDeps())).toEqual([]);
  });

  it('[ED] empty adjacency object → returns empty result', () => {
    expect(analyzeCoupling(makeDeps({ adjacency: {} }))).toEqual([]);
  });

  it('[NE] module on main-sequence (distance < 0.7, sub-threshold degrees) is absent from results', () => {
    // A: fanIn=1 (C→A), fanOut=1 (A→B) → instability=0.5, abstractness=0
    // distance = |0 + 0.5 - 1| = 0.5 < 0.7 → no off-main-sequence
    // fanOut=1 ≤ 5 → no unstable; fanIn=1, fanOut=1 both << threshold → no god/rigid
    const deps = makeDeps({ adjacency: { C: ['A'], A: ['B'], B: [] } });
    const result = analyzeCoupling(deps);

    expect(result.every(h => h.module !== 'A')).toBe(true);
  });

  interface SignalCase {
    readonly label: string;
    readonly adjacency: Adjacency;
    readonly exportStats: DependencyAnalysis['exportStats'];
    readonly module: string;
    readonly signal: string;
  }

  // Each row: build a graph, find the target module, assert the expected signal is present.
  const signalPresentCases: SignalCase[] = [
    {
      // A imports 6 modules and nothing imports A → instability = 6/6 = 1.0 > 0.8, fanOut = 6 > 5
      label: 'unstable-module (instability > 0.8 and fanOut > 5)',
      adjacency: fanOutAdjacency(6),
      exportStats: {},
      module: 'A',
      signal: 'unstable-module',
    },
    {
      // unstable boundary: fanOut == 6 (just over 5) + instability = 1.0 > 0.8 → finding
      label: 'unstable-module — fanOut == 6 + instability > 0.8 → finding (just over threshold)',
      adjacency: fanOutAdjacency(6),
      exportStats: {},
      module: 'A',
      signal: 'unstable-module',
    },
    {
      // 23 modules: hub has 11 upstream importers and imports 11 downstream modules
      // totalModules=23, godThreshold=max(10, ceil(23*0.1))=10; hub fanIn=11>10, fanOut=11>10 → god
      label: 'god-module (fanIn > threshold AND fanOut > threshold)',
      adjacency: hubAdjacency(11, 11),
      exportStats: {},
      module: 'hub',
      signal: 'god-module',
    },
    {
      // Isolated S: fanIn=0, fanOut=0, abstractness=0, instability=0 (denom=0)
      // distance = |0 + 0 - 1| = 1 > 0.7 → off-main-sequence
      label: 'off-main-sequence for isolated module (abstractness=0, instability=0)',
      adjacency: { S: [] },
      exportStats: { S: { total: 0, abstract: 0 } },
      module: 'S',
      signal: 'off-main-sequence',
    },
    {
      // totalModules=17 (hub + 16 importers), rigidThreshold=max(10, ceil(17*0.15))=10
      // hub: fanIn=16>10, fanOut=0, instability=0<0.2 → rigid-module
      label: 'rigid-module (fanIn > rigidThreshold, instability < 0.2)',
      adjacency: fanInAdjacency('hub', 16, 0),
      exportStats: {},
      module: 'hub',
      signal: 'rigid-module',
    },
  ];

  it.each(signalPresentCases)('[HP] detects $label', ({ adjacency, exportStats, module, signal }) => {
    const hotspot = hotspotFor({ adjacency, exportStats }, module);

    expect(hotspot).toBeDefined();
    expect(hotspot?.signals).toContain(signal);
  });

  // Each row: build a graph at/over a boundary, assert the signal is NOT present (strict comparison).
  const signalAbsentCases: SignalCase[] = [
    {
      // 5 deps → fanOut=5; need fanOut > unstableFanOut(=5), so threshold isn't met.
      label: 'unstable-module — instability == boundary → no finding (strict > fanOut required)',
      adjacency: fanOutAdjacency(5),
      exportStats: {},
      module: 'A',
      signal: 'unstable-module',
    },
    {
      // totalModules=21 → godThreshold=max(10, ceil(21*0.1))=10; hub fanIn=10, fanOut=10 exactly → strict > fails
      label: 'god-module — fanIn and fanOut both exactly at threshold → no finding (strict >)',
      adjacency: hubAdjacency(10, 10),
      exportStats: {},
      module: 'hub',
      signal: 'god-module',
    },
    {
      // A imports 3, 7 modules import A → instability = 3/10 = 0.3, abstractness=0
      // distance = |0 + 0.3 - 1| = 0.7 == distanceThreshold → strict > fails
      label: 'off-main-sequence — distance exactly at threshold → no finding (strict >)',
      adjacency: fanInAdjacency('A', 7, 3),
      exportStats: {},
      module: 'A',
      signal: 'off-main-sequence',
    },
    {
      // fanIn=12, fanOut=3 → instability = 3/15 = 0.2 exactly; rigidThreshold(16 modules)=10, fanIn>10
      // strict `< rigidInstability(0.2)` fails → no rigid-module
      label: 'rigid-module — instability exactly at 0.2 → no finding (strict <)',
      adjacency: fanInAdjacency('hub', 12, 3),
      exportStats: {},
      module: 'hub',
      signal: 'rigid-module',
    },
  ];

  it.each(signalAbsentCases)('[BD] $label', ({ adjacency, exportStats, module, signal }) => {
    const result = analyzeCoupling(makeDeps({ adjacency, exportStats }));
    // Gather every signal attached to `module` (empty when it is not a hotspot at all);
    // flatMap keeps this unconditional — no optional chaining or nullish fallback.
    const signalsForModule = result.filter(h => h.module === module).flatMap(h => h.signals);

    expect(signalsForModule).not.toContain(signal);
  });

  it('[HP] detects bidirectional-coupling from a 2-node cycle', () => {
    // A ↔ B cycle
    const deps = makeDeps({
      adjacency: { A: ['B'], B: ['A'] },
      cycles: [{ path: ['A', 'B', 'A'] }] as DependencyAnalysis['cycles'],
    });
    const result = analyzeCoupling(deps);
    const signalsForA = result.filter(h => h.module === 'A').flatMap(h => h.signals);
    const signalsForB = result.filter(h => h.module === 'B').flatMap(h => h.signals);

    expect(result.map(h => h.module)).toContain('A');
    expect(result.map(h => h.module)).toContain('B');
    expect(signalsForA).toContain('bidirectional-coupling');
    expect(signalsForB).toContain('bidirectional-coupling');
  });

  it('[BD] cycle with 3 nodes (length-3 cycle) → no bidirectional-coupling (only 2-cycles count)', () => {
    const deps = makeDeps({
      adjacency: { A: ['B'], B: ['C'], C: ['A'] },
      cycles: [{ path: ['A', 'B', 'C', 'A'] }] as DependencyAnalysis['cycles'],
    });
    const result = analyzeCoupling(deps);

    expect(result.every(h => !h.signals.includes('bidirectional-coupling'))).toBe(true);
  });

  interface ScoreCase {
    readonly label: string;
    readonly adjacency: Adjacency;
    readonly exportStats: DependencyAnalysis['exportStats'];
    readonly module: string;
    readonly distance: number;
    readonly score: number;
  }

  // score is defined as Math.round(distance * 100); each row pins a distinct distance→score point.
  const scoreCases: ScoreCase[] = [
    {
      // A imports 6 modules and nothing imports A → instability = 1.0, abstractness = 0
      // distance = |0 + 1 - 1| = 0 → score = Math.round(0 * 100) = 0
      label: 'score equals Math.round(distance * 100) at distance 0',
      adjacency: fanOutAdjacency(6),
      exportStats: {},
      module: 'A',
      distance: 0,
      score: 0,
    },
    {
      // Isolated S: fanIn=0, fanOut=0, instability=0, abstractness=0
      // distance = |0 + 0 - 1| = 1 → off-main-sequence score = Math.round(1 * 100) = 100
      label: 'off-main-sequence score reflects distance metric at distance 1',
      adjacency: { S: [] },
      exportStats: { S: { total: 0, abstract: 0 } },
      module: 'S',
      distance: 1,
      score: 100,
    },
  ];

  it.each(scoreCases)('[SC] $label', ({ adjacency, exportStats, module, distance, score }) => {
    const hotspot = hotspotFor({ adjacency, exportStats }, module);

    expect(hotspot).toBeDefined();
    expect(hotspot?.metrics.distance).toBe(distance);
    expect(hotspot?.score).toBe(score);
  });

  it('[HP] fan-in-only sink module (target only, no adjacency key) is evaluated for hotspot', () => {
    // hub is imported by many but never imports anything — appears only as a target,
    // never as an adjacency key. Previously skipped because `modules` came from Object.keys(adjacency).
    const adjacency: Adjacency = Object.fromEntries(range(16).map(i => [`importer${i}`, ['hub']]));
    const hubHotspot = hotspotFor({ adjacency }, 'hub');

    expect(hubHotspot).toBeDefined();
    // hub has fanIn=16, fanOut=0 → instability=0, abstractness=0
    // distance = |0 + 0 - 1| = 1 → off-main-sequence; also rigid candidate
    expect(hubHotspot?.metrics.fanIn).toBe(16);
    expect(hubHotspot?.metrics.fanOut).toBe(0);
  });
});
