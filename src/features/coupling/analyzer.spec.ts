import { describe, it, expect } from 'bun:test';

import type { DependencyAnalysis } from '../../types';

import { analyzeCoupling, createEmptyCoupling } from './analyzer';

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
});

describe('createEmptyCoupling', () => {
  it('returns an empty array', () => {
    expect(createEmptyCoupling()).toEqual([]);
  });
});

describe('analyzeCoupling', () => {
  it('[ED] returns [] when adjacency is empty', () => {
    expect(analyzeCoupling(emptyDeps())).toEqual([]);
  });

  it('[NE] module on main-sequence (distance < 0.7, sub-threshold degrees) is absent from results', () => {
    // A: fanIn=1 (C→A), fanOut=1 (A→B) → instability=0.5, abstractness=0
    // distance = |0 + 0.5 - 1| = 0.5 < 0.7 → no off-main-sequence
    // fanOut=1 ≤ 5 → no unstable; fanIn=1, fanOut=1 both << threshold → no god/rigid
    const deps: DependencyAnalysis = {
      adjacency: { C: ['A'], A: ['B'], B: [] },
      exportStats: {},
      cycles: noCycles,
      fanIn: [],
      fanOut: [],
      cuts: [],
      layerViolations: [],
      deadExports: [],
    };
    const result = analyzeCoupling(deps);

    expect(result.every(h => h.module !== 'A')).toBe(true);
  });

  it('[HP] detects unstable-module (instability > 0.8 and fanOut > 5)', () => {
    // A imports 6 modules and nothing imports A → instability = 6/6 = 1.0 > 0.8, fanOut = 6 > 5
    const adjacency: Record<string, string[]> = { A: [] };

    for (let i = 1; i <= 6; i++) {
      adjacency.A!.push(`dep${i}`);

      adjacency[`dep${i}`] = [];
    }

    const deps: DependencyAnalysis = {
      adjacency,
      exportStats: {},
      cycles: noCycles,
      fanIn: [],
      fanOut: [],
      cuts: [],
      layerViolations: [],
      deadExports: [],
    };
    const result = analyzeCoupling(deps);
    const aHotspot = result.find(h => h.module === 'A');

    expect(aHotspot).toBeDefined();
    expect(aHotspot?.signals).toContain('unstable-module');
  });

  it('[HP] detects god-module (fanIn > threshold AND fanOut > threshold)', () => {
    // 23 modules: hub has 11 upstream importers and imports 11 downstream modules
    // totalModules=23, godThreshold=max(10, ceil(23*0.1))=max(10,3)=10
    // hub: fanIn=11>10, fanOut=11>10 → god-module signal
    const adjacency: Record<string, string[]> = { hub: [] };

    for (let i = 1; i <= 11; i++) {
      adjacency[`up${i}`] = ['hub'];

      adjacency.hub!.push(`down${i}`);

      adjacency[`down${i}`] = [];
    }

    const deps: DependencyAnalysis = {
      adjacency,
      exportStats: {},
      cycles: noCycles,
      fanIn: [],
      fanOut: [],
      cuts: [],
      layerViolations: [],
      deadExports: [],
    };
    const result = analyzeCoupling(deps);
    const hubHotspot = result.find(h => h.module === 'hub');

    expect(hubHotspot).toBeDefined();
    expect(hubHotspot?.signals).toContain('god-module');
  });

  it('[HP] detects bidirectional-coupling from a 2-node cycle', () => {
    // A ↔ B cycle
    const deps: DependencyAnalysis = {
      adjacency: { A: ['B'], B: ['A'] },
      exportStats: {},
      cycles: [{ path: ['A', 'B', 'A'] }] as DependencyAnalysis['cycles'],
      fanIn: [],
      fanOut: [],
      cuts: [],
      layerViolations: [],
      deadExports: [],
    };
    const result = analyzeCoupling(deps);
    const modules = result.map(h => h.module);

    expect(modules).toContain('A');
    expect(modules).toContain('B');
    result
      .filter(h => h.module === 'A' || h.module === 'B')
      .forEach(h => {
        expect(h.signals).toContain('bidirectional-coupling');
      });
  });

  it('[HP] detects off-main-sequence for isolated module (abstractness=0, instability=0)', () => {
    // Isolated S: fanIn=0, fanOut=0, abstractness=0, instability=0 (denom=0)
    // distance = |0 + 0 - 1| = 1 > 0.7 → off-main-sequence
    const deps: DependencyAnalysis = {
      adjacency: { S: [] },
      exportStats: { S: { total: 0, abstract: 0 } },
      cycles: noCycles,
      fanIn: [],
      fanOut: [],
      cuts: [],
      layerViolations: [],
      deadExports: [],
    };
    const result = analyzeCoupling(deps);
    const sHotspot = result.find(h => h.module === 'S');

    expect(sHotspot).toBeDefined();
    expect(sHotspot?.signals).toContain('off-main-sequence');
  });

  it('[HP] detects rigid-module (fanIn > rigidThreshold, instability < 0.2)', () => {
    // 100 modules: 16 importers for hub, hub exports nothing
    // totalModules=17 (hub + 16 importers), rigidThreshold=max(10, ceil(17*0.15))=max(10,3)=10
    // hub: fanIn=16>10, fanOut=0, instability=0/(16+0)=0<0.2 → rigid-module
    const adjacency: Record<string, string[]> = { hub: [] };

    for (let i = 1; i <= 16; i++) {
      adjacency[`importer${i}`] = ['hub'];
    }

    const deps: DependencyAnalysis = {
      adjacency,
      exportStats: {},
      cycles: noCycles,
      fanIn: [],
      fanOut: [],
      cuts: [],
      layerViolations: [],
      deadExports: [],
    };
    const result = analyzeCoupling(deps);
    const hubHotspot = result.find(h => h.module === 'hub');

    expect(hubHotspot).toBeDefined();
    expect(hubHotspot?.signals).toContain('rigid-module');
  });

  it('[SC] score equals Math.round(distance * 100)', () => {
    // A imports 6 modules and nothing imports A → instability = 6/6 = 1.0
    // abstractness = 0 → distance = |0 + 1 - 1| = 0
    // score should be Math.round(0 * 100) = 0
    const adjacency: Record<string, string[]> = { A: [] };

    for (let i = 1; i <= 6; i++) {
      adjacency.A!.push(`dep${i}`);

      adjacency[`dep${i}`] = [];
    }

    const deps: DependencyAnalysis = {
      adjacency,
      exportStats: {},
      cycles: noCycles,
      fanIn: [],
      fanOut: [],
      cuts: [],
      layerViolations: [],
      deadExports: [],
    };
    const result = analyzeCoupling(deps);
    const aHotspot = result.find(h => h.module === 'A');

    expect(aHotspot).toBeDefined();
    // distance = |abstractness + instability - 1| = |0 + 1 - 1| = 0
    expect(aHotspot?.metrics.distance).toBe(0);
    expect(aHotspot?.score).toBe(0);
  });

  it('[HP] fan-in-only sink module (target only, no adjacency key) is evaluated for hotspot', () => {
    // hub is imported by many but never imports anything — appears only as target,
    // never as adjacency key. Previously skipped because `modules` came from Object.keys(adjacency).
    const adjacency: Record<string, string[]> = {};

    for (let i = 1; i <= 16; i++) {
      adjacency[`importer${i}`] = ['hub'];
    }

    const deps: DependencyAnalysis = {
      adjacency,
      exportStats: {},
      cycles: noCycles,
      fanIn: [],
      fanOut: [],
      cuts: [],
      layerViolations: [],
      deadExports: [],
    };
    const result = analyzeCoupling(deps);
    const hubHotspot = result.find(h => h.module === 'hub');

    expect(hubHotspot).toBeDefined();
    // hub has fanIn=16, fanOut=0 → instability=0, abstractness=0
    // distance = |0 + 0 - 1| = 1 → off-main-sequence; also rigid candidate
    expect(hubHotspot?.metrics.fanIn).toBe(16);
    expect(hubHotspot?.metrics.fanOut).toBe(0);
  });

  it('[SC] off-main-sequence score reflects distance metric', () => {
    // Isolated S: fanIn=0, fanOut=0, instability=0, abstractness=0
    // distance = |0 + 0 - 1| = 1 → score = 100
    const deps: DependencyAnalysis = {
      adjacency: { S: [] },
      exportStats: { S: { total: 0, abstract: 0 } },
      cycles: noCycles,
      fanIn: [],
      fanOut: [],
      cuts: [],
      layerViolations: [],
      deadExports: [],
    };
    const result = analyzeCoupling(deps);
    const sHotspot = result.find(h => h.module === 'S');

    expect(sHotspot).toBeDefined();
    expect(sHotspot?.metrics.distance).toBe(1);
    expect(sHotspot?.score).toBe(100);
  });

  // ─── Boundary tests for each signal threshold ────────────────────────────

  it('[BD] unstable-module — instability == 0.8 → no finding (strict > 0.8 required)', () => {
    // 5 deps gives fanOut=5; need fanOut > unstableFanOut(=5) so threshold isn't met.
    // Force fanOut just at the boundary to verify the strict-greater-than guard.
    const adjacency: Record<string, string[]> = { A: [] };

    for (let i = 1; i <= 5; i++) {
      adjacency.A!.push(`dep${i}`);
      adjacency[`dep${i}`] = [];
    }

    const deps: DependencyAnalysis = {
      adjacency,
      exportStats: {},
      cycles: noCycles,
      fanIn: [],
      fanOut: [],
      cuts: [],
      layerViolations: [],
      deadExports: [],
    };
    const result = analyzeCoupling(deps);
    const aHotspot = result.find(h => h.module === 'A');

    expect(aHotspot?.signals ?? []).not.toContain('unstable-module');
  });

  it('[BD] unstable-module — fanOut == 6 + instability > 0.8 → finding (just over threshold)', () => {
    const adjacency: Record<string, string[]> = { A: [] };

    for (let i = 1; i <= 6; i++) {
      adjacency.A!.push(`dep${i}`);
      adjacency[`dep${i}`] = [];
    }

    const deps: DependencyAnalysis = {
      adjacency,
      exportStats: {},
      cycles: noCycles,
      fanIn: [],
      fanOut: [],
      cuts: [],
      layerViolations: [],
      deadExports: [],
    };
    const result = analyzeCoupling(deps);
    const aHotspot = result.find(h => h.module === 'A');

    expect(aHotspot?.signals).toContain('unstable-module');
  });

  it('[BD] god-module — fanIn and fanOut both exactly at threshold → no finding (strict >)', () => {
    // totalModules = 21 → godModuleThreshold = max(10, ceil(21*0.1)) = max(10,3) = 10
    // Set hub's fanIn = 10 and fanOut = 10 exactly. Strict-greater-than check should
    // exclude god-module here.
    const adjacency: Record<string, string[]> = { hub: [] };

    for (let i = 1; i <= 10; i++) {
      adjacency[`up${i}`] = ['hub'];
      adjacency.hub!.push(`down${i}`);
      adjacency[`down${i}`] = [];
    }

    const deps: DependencyAnalysis = {
      adjacency,
      exportStats: {},
      cycles: noCycles,
      fanIn: [],
      fanOut: [],
      cuts: [],
      layerViolations: [],
      deadExports: [],
    };
    const result = analyzeCoupling(deps);
    const hubHotspot = result.find(h => h.module === 'hub');

    expect(hubHotspot?.signals ?? []).not.toContain('god-module');
  });

  it('[BD] off-main-sequence — distance exactly at threshold → no finding (strict >)', () => {
    // Default distanceThreshold = 0.7. Construct (A=0, I=0.3) → distance = |0+0.3-1| = 0.7.
    // 3 modules import A (fanIn=3) and A imports nothing (fanOut=0)? Need instability=0.3.
    // instability = fanOut/(fanIn+fanOut) = 0.3 → fanOut/fanIn+fanOut = 0.3.
    // Use A imports 3, 7 modules import A: instability = 3/10 = 0.3.
    const adjacency: Record<string, string[]> = { A: ['dep1', 'dep2', 'dep3'] };

    for (let i = 1; i <= 7; i++) {
      adjacency[`up${i}`] = ['A'];
    }

    for (let i = 1; i <= 3; i++) {
      adjacency[`dep${i}`] = [];
    }

    const deps: DependencyAnalysis = {
      adjacency,
      exportStats: {},
      cycles: noCycles,
      fanIn: [],
      fanOut: [],
      cuts: [],
      layerViolations: [],
      deadExports: [],
    };
    const result = analyzeCoupling(deps);
    const aHotspot = result.find(h => h.module === 'A');

    expect(aHotspot?.signals ?? []).not.toContain('off-main-sequence');
  });

  it('[BD] rigid-module — instability exactly at 0.2 → no finding (strict <)', () => {
    // instability = 0.2 → fanOut/(fanIn+fanOut) = 0.2. Use fanIn=12, fanOut=3.
    // rigidThreshold for 16 modules = max(10, ceil(16*0.15)) = max(10,3) = 10. fanIn=12 > 10 ✓.
    const adjacency: Record<string, string[]> = { hub: ['o1', 'o2', 'o3'] };

    for (let i = 1; i <= 12; i++) {
      adjacency[`importer${i}`] = ['hub'];
    }

    for (let i = 1; i <= 3; i++) {
      adjacency[`o${i}`] = [];
    }

    const deps: DependencyAnalysis = {
      adjacency,
      exportStats: {},
      cycles: noCycles,
      fanIn: [],
      fanOut: [],
      cuts: [],
      layerViolations: [],
      deadExports: [],
    };
    const result = analyzeCoupling(deps);
    const hubHotspot = result.find(h => h.module === 'hub');

    // instability = 3 / (12 + 3) = 0.2 exactly — strict `< rigidInstability(0.2)` fails.
    expect(hubHotspot?.signals ?? []).not.toContain('rigid-module');
  });

  it('[BD] cycle with 3 nodes (length-3 cycle) → no bidirectional-coupling (only 2-cycles count)', () => {
    const deps: DependencyAnalysis = {
      adjacency: { A: ['B'], B: ['C'], C: ['A'] },
      exportStats: {},
      cycles: [{ path: ['A', 'B', 'C', 'A'] }] as DependencyAnalysis['cycles'],
      fanIn: [],
      fanOut: [],
      cuts: [],
      layerViolations: [],
      deadExports: [],
    };
    const result = analyzeCoupling(deps);

    expect(result.every(h => !h.signals.includes('bidirectional-coupling'))).toBe(true);
  });

  it('[BD] empty adjacency → returns empty result', () => {
    const deps: DependencyAnalysis = {
      adjacency: {},
      exportStats: {},
      cycles: noCycles,
      fanIn: [],
      fanOut: [],
      cuts: [],
      layerViolations: [],
      deadExports: [],
    };

    expect(analyzeCoupling(deps)).toEqual([]);
  });
});
