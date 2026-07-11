import { normalizePath } from '@zipbul/gildash';

import { hashString } from '../../engine/hasher';
import { CACHE_SCHEMA_VERSION } from './cache-namespace';

// Object.entries 결과를 키(첫 원소) 기준으로 정렬하는 단일 비교자.
// 캐시 키 직렬화의 결정성을 위한 "엔트리 키 정렬" 변경지점.
const byEntryKey = (a: readonly [string, unknown], b: readonly [string, unknown]): number => a[0].localeCompare(b[0]);

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
  readonly barrelIgnoreGlobs?: ReadonlyArray<string>;
  readonly dependenciesLayers?: ReadonlyArray<{ readonly name: string; readonly glob: string }>;
  readonly dependenciesAllowedDependencies?: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly dependenciesEntry?: ReadonlyArray<string>;
  readonly dependenciesIgnore?: ReadonlyArray<string>;
  readonly dependenciesIgnoreDeps?: ReadonlyArray<string>;
  readonly couplingConfig?: Record<string, unknown>;
}

const computeScanArtifactKey = (input: ComputeScanArtifactKeyInput): string => {
  const normalizedDetectors = [...input.detectors].sort();
  const normalizedBarrelIgnoreGlobs = input.barrelIgnoreGlobs ? [...input.barrelIgnoreGlobs].sort() : [];
  const normalizedDependenciesLayers = input.dependenciesLayers
    ? [...input.dependenciesLayers]
        .map(layer => ({ name: layer.name, glob: layer.glob }))
        .sort((a, b) => (a.name === b.name ? a.glob.localeCompare(b.glob) : a.name.localeCompare(b.name)))
    : [];
  const normalizedAllowedDepsEntries = input.dependenciesAllowedDependencies
    ? Object.entries(input.dependenciesAllowedDependencies)
        .map(([key, value]) => [key, [...value].sort()] as const)
        .sort(byEntryKey)
    : [];
  const normalizedDependenciesEntry = input.dependenciesEntry ? [...input.dependenciesEntry].sort() : [];
  const normalizedDependenciesIgnore = input.dependenciesIgnore ? [...input.dependenciesIgnore].sort() : [];
  const normalizedDependenciesIgnoreDeps = input.dependenciesIgnoreDeps ? [...input.dependenciesIgnoreDeps].sort() : [];

  return hashString(
    [
      'scan',
      `detectors=${normalizedDetectors.join(',')}`,
      `minSize=${input.minSize}`,
      `maxForwardDepth=${String(input.maxForwardDepth)}`,
      `barrelIgnoreGlobs=${normalizedBarrelIgnoreGlobs.join(',')}`,
      `dependenciesLayers=${JSON.stringify(normalizedDependenciesLayers)}`,
      `dependenciesAllowedDependencies=${JSON.stringify(normalizedAllowedDepsEntries)}`,
      `dependenciesEntry=${normalizedDependenciesEntry.join(',')}`,
      `dependenciesIgnore=${normalizedDependenciesIgnore.join(',')}`,
      `dependenciesIgnoreDeps=${normalizedDependenciesIgnoreDeps.join(',')}`,
      `couplingConfig=${input.couplingConfig ? JSON.stringify(Object.entries(input.couplingConfig).sort(byEntryKey)) : ''}`,
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
