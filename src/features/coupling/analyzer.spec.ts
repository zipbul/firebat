import { describe, it, expect } from 'bun:test';

import type { DependencyAnalysis } from '../../types';
import { analyzeCoupling, createEmptyCoupling } from './analyzer';

const noCycles: DependencyAnalysis['cycles'] = [];

const emptyDeps = (): DependencyAnalysis => ({
  adjacency: {},
  exportStats: {},
  cycles: noCycles,
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
    };
    const result = analyzeCoupling(deps);
    expect(result.every(h => h.module !== 'A')).toBe(true);
  });

  it('[HP] detects unstable-module (instability > 0.8 and fanOut > 5)', () => {
    // A imports 6 modules and nothing imports A → instability = 6/6 = 1.0 > 0.8, fanOut = 6 > 5
    const adjacency: Record<string, string[]> = { A: [] };

    for (let i = 1; i <= 6; i++) {
      adjacency['A']!.push(`dep${i}`);
      adjacency[`dep${i}`] = [];
    }

    const deps: DependencyAnalysis = {
      adjacency,
      exportStats: {},
      cycles: noCycles,
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
      adjacency['hub']!.push(`down${i}`);
      adjacency[`down${i}`] = [];
    }

    const deps: DependencyAnalysis = {
      adjacency,
      exportStats: {},
      cycles: noCycles,
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
    };
    const result = analyzeCoupling(deps);
    const modules = result.map(h => h.module);
    expect(modules).toContain('A');
    expect(modules).toContain('B');
    result.filter(h => h.module === 'A' || h.module === 'B').forEach(h => {
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
    };
    const result = analyzeCoupling(deps);
    const hubHotspot = result.find(h => h.module === 'hub');
    expect(hubHotspot).toBeDefined();
    expect(hubHotspot?.signals).toContain('rigid-module');
  });
});
