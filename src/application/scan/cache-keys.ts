import { hashString } from '../../engine/hasher';
import { CACHE_SCHEMA_VERSION } from './cache-namespace';

const normalizePath = (filePath: string): string => filePath.replaceAll('\\', '/');

interface ComputeProjectKeyInput {
  readonly toolVersion: string;
  readonly cwd?: string;
}

const computeProjectKey = (input: ComputeProjectKeyInput): string => {
  const cwd = input.cwd ?? process.cwd();

  return hashString(`firebat|schema=${String(CACHE_SCHEMA_VERSION)}|${input.toolVersion}|${normalizePath(cwd)}|${Bun.version}`);
};

interface ComputeScanArtifactKeyInput {
  readonly detectors: ReadonlyArray<string>;
  readonly minSize: string;
  readonly maxForwardDepth: number;
  readonly wasteMemoryRetentionThreshold?: number;
  readonly unknownProofBoundaryGlobs?: ReadonlyArray<string>;
  readonly barrelPolicyIgnoreGlobs?: ReadonlyArray<string>;
  readonly dependenciesLayers?: ReadonlyArray<{ readonly name: string; readonly glob: string }>;
  readonly dependenciesAllowedDependencies?: Readonly<Record<string, ReadonlyArray<string>>>;
}

const computeScanArtifactKey = (input: ComputeScanArtifactKeyInput): string => {
  const normalizedDetectors = [...input.detectors].sort();
  const normalizedUnknownProofBoundaryGlobs = input.unknownProofBoundaryGlobs ? [...input.unknownProofBoundaryGlobs].sort() : [];
  const normalizedBarrelPolicyIgnoreGlobs = input.barrelPolicyIgnoreGlobs ? [...input.barrelPolicyIgnoreGlobs].sort() : [];
  const normalizedDependenciesLayers = input.dependenciesLayers
    ? [...input.dependenciesLayers]
        .map(layer => ({ name: layer.name, glob: layer.glob }))
        .sort((a, b) => (a.name === b.name ? a.glob.localeCompare(b.glob) : a.name.localeCompare(b.name)))
    : [];
  const normalizedAllowedDepsEntries = input.dependenciesAllowedDependencies
    ? Object.entries(input.dependenciesAllowedDependencies)
        .map(([key, value]) => [key, [...value].sort()] as const)
        .sort((a, b) => a[0].localeCompare(b[0]))
    : [];

  return hashString(
    [
      'scan',
      `detectors=${normalizedDetectors.join(',')}`,
      `minSize=${input.minSize}`,
      `maxForwardDepth=${String(input.maxForwardDepth)}`,
      `wasteMemoryRetentionThreshold=${String(input.wasteMemoryRetentionThreshold ?? '')}`,
      `unknownProofBoundaryGlobs=${normalizedUnknownProofBoundaryGlobs.join(',')}`,
      `barrelPolicyIgnoreGlobs=${normalizedBarrelPolicyIgnoreGlobs.join(',')}`,
      `dependenciesLayers=${JSON.stringify(normalizedDependenciesLayers)}`,
      `dependenciesAllowedDependencies=${JSON.stringify(normalizedAllowedDepsEntries)}`,
    ].join('|'),
  );
};

interface ComputeTraceArtifactKeyInput {
  readonly entryFile: string;
  readonly symbol: string;
  readonly tsconfigPath?: string;
  readonly maxDepth?: number;
}

const computeTraceArtifactKey = (input: ComputeTraceArtifactKeyInput): string => {
  const normalizedEntry = normalizePath(input.entryFile);
  const normalizedTsconfig = input.tsconfigPath !== undefined ? normalizePath(input.tsconfigPath) : '';

  return hashString(
    [
      'traceSymbol',
      `entryFile=${normalizedEntry}`,
      `symbol=${input.symbol}`,
      `tsconfigPath=${normalizedTsconfig}`,
      `maxDepth=${String(input.maxDepth ?? '')}`,
    ].join('|'),
  );
};

export { computeProjectKey, computeScanArtifactKey, computeTraceArtifactKey };
