import type { GildashSources } from '../../shared/gildash-test-kit';

import { analyzeCoupling, analyzeDependencies } from '../../../../src/test-api';
import { withTempGildash } from '../../shared/gildash-test-kit';

type Hotspot = ReturnType<typeof analyzeCoupling>[number];

/**
 * Build `count` newline-joined relative import statements targeting
 * `./<target>0..count-1`. Collapses the `Array.from(...).join('\n')` fan-in /
 * fan-out fixture idiom repeated across the coupling sibling specs.
 */
export const relativeImports = (target: string, count: number): string => {
  return Array.from({ length: count }, (_, index) => `import './${target}${index}';`).join('\n');
};

/**
 * Build a temp gildash from `sources`, run the dependency graph + coupling
 * analysis, and return all coupling hotspots. Collapses the
 * `withTempGildash → analyzeDependencies → analyzeCoupling` preamble that every
 * coupling sibling spec (root, distance, instability, god-module) restates
 * verbatim.
 */
export const analyzeCouplingFromSources = async (sources: GildashSources): Promise<Hotspot[]> => {
  return withTempGildash(sources, async (gildash, tmpDir) => {
    const dependencies = await analyzeDependencies(gildash, { rootAbs: tmpDir });

    return [...analyzeCoupling(dependencies)];
  });
};

/**
 * Run {@link analyzeCouplingFromSources} and locate the single hotspot whose
 * module path contains `moduleSubstring`. Returns both the matched hotspot and
 * the full hotspot list so callers can assert on either.
 */
export const findCouplingHotspot = async (
  sources: GildashSources,
  moduleSubstring: string,
): Promise<{ readonly hotspot: Hotspot | undefined; readonly hotspots: Hotspot[] }> => {
  const hotspots = await analyzeCouplingFromSources(sources);
  const hotspot = hotspots.find(entry => entry.module.includes(moduleSubstring));

  return { hotspot, hotspots };
};
