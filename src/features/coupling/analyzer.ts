import type { CouplingHotspot, DependencyAnalysis } from '../../types';

import { sortCouplingHotspots } from '../../engine/sort-utils';

const createEmptyCoupling = (): ReadonlyArray<CouplingHotspot> => [];

const analyzeCoupling = (dependencies: DependencyAnalysis): ReadonlyArray<CouplingHotspot> => {
  const adjacency = dependencies.adjacency ?? {};
  const exportStats = dependencies.exportStats ?? {};
  const modules = Object.keys(adjacency).sort((a, b) => a.localeCompare(b));

  if (modules.length === 0) {
    return createEmptyCoupling();
  }

  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();

  for (const module of modules) {
    inDegree.set(module, 0);
  }

  for (const [from, targets] of Object.entries(adjacency)) {
    const uniqueTargets = Array.from(new Set(targets));

    outDegree.set(from, uniqueTargets.length);

    for (const to of uniqueTargets) {
      inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
    }
  }

  const totalModules = modules.length;
  const godModuleThreshold = Math.max(10, Math.ceil(totalModules * 0.1));
  const rigidThreshold = Math.max(10, Math.ceil(totalModules * 0.15));
  const bidirectionalModules = new Set<string>();

  for (const cycle of dependencies.cycles) {
    const nodes =
      cycle.path.length > 1 && cycle.path[0] === cycle.path[cycle.path.length - 1] ? cycle.path.slice(0, -1) : cycle.path;
    const unique = Array.from(new Set(nodes));

    if (unique.length === 2) {
      bidirectionalModules.add(unique[0] ?? '');
      bidirectionalModules.add(unique[1] ?? '');
    }
  }

  const computeAbstractness = (module: string): number => {
    const stat = exportStats[module];

    if (!stat || stat.total <= 0) {
      return 0;
    }

    return stat.abstract / stat.total;
  };

  const clamp01 = (value: number): number => {
    if (Number.isNaN(value) || !Number.isFinite(value)) {
      return 0;
    }

    return Math.max(0, Math.min(1, value));
  };

  const computeSeverity = (params: {
    distance: number;
    instability: number;
    fanIn: number;
    fanOut: number;
    signals: ReadonlyArray<string>;
  }): number => {
    const candidates: number[] = [params.distance];

    if (params.signals.includes('unstable-module')) {
      candidates.push(0.7 + 0.3 * clamp01(params.instability));
    }

    if (params.signals.includes('rigid-module')) {
      candidates.push(0.7 + 0.3 * clamp01(1 - params.instability));
    }

    if (params.signals.includes('god-module')) {
      candidates.push(0.95);
    }

    if (params.signals.includes('bidirectional-coupling')) {
      candidates.push(0.85);
    }

    return Math.max(...candidates.map(clamp01));
  };

  const kindToCode: Record<string, string> = {
    'god-module': 'COUPLING_GOD_MODULE',
    'bidirectional-coupling': 'COUPLING_BIDIRECTIONAL',
    'off-main-sequence': 'COUPLING_OFF_MAIN_SEQ',
    'unstable-module': 'COUPLING_UNSTABLE',
    'rigid-module': 'COUPLING_RIGID',
  };

  const pickKind = (signals: ReadonlyArray<string>): string => {
    const s = new Set(signals);

    if (s.has('god-module')) {
      return 'god-module';
    }

    if (s.has('bidirectional-coupling')) {
      return 'bidirectional-coupling';
    }

    if (s.has('off-main-sequence')) {
      return 'off-main-sequence';
    }

    if (s.has('unstable-module')) {
      return 'unstable-module';
    }

    if (s.has('rigid-module')) {
      return 'rigid-module';
    }

    return signals[0] ?? 'coupling';
  };

  const hotspotsRaw = modules
    .map(module => {
      const fanIn = inDegree.get(module) ?? 0;
      const fanOut = outDegree.get(module) ?? 0;
      const denom = fanIn + fanOut;
      const instability = denom > 0 ? fanOut / denom : 0;
      const abstractness = computeAbstractness(module);
      const distance = Math.abs(abstractness + instability - 1);
      const signals: string[] = [];

      if (distance > 0.7) {
        signals.push('off-main-sequence');
      }

      if (instability > 0.8 && fanOut > 5) {
        signals.push('unstable-module');
      }

      if (instability < 0.2 && fanIn > rigidThreshold) {
        signals.push('rigid-module');
      }

      if (fanIn > godModuleThreshold && fanOut > godModuleThreshold) {
        signals.push('god-module');
      }

      if (bidirectionalModules.has(module)) {
        signals.push('bidirectional-coupling');
      }

      if (signals.length === 0) {
        return null;
      }

      const metrics = {
        fanIn,
        fanOut,
        instability: clamp01(instability),
        abstractness: clamp01(abstractness),
        distance: clamp01(distance),
      };
      const severity = computeSeverity({
        distance: metrics.distance,
        instability: metrics.instability,
        fanIn,
        fanOut,
        signals,
      });
      const score = Math.round(severity * 100);
      const kind = pickKind(signals);

      const codeVal = kindToCode[kind] as import('../../types').FirebatCatalogCode | undefined;

      return {
        ...(codeVal !== undefined ? { code: codeVal } : {}),
        module,
        score,
        signals: [...signals].sort(),
        metrics,
        why: signals.join(', '),
        suggestedRefactor: '',
      } satisfies CouplingHotspot;
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);
  const hotspots = sortCouplingHotspots(hotspotsRaw);

  return hotspots.length === 0 ? createEmptyCoupling() : hotspots;
};

export { analyzeCoupling, createEmptyCoupling };
