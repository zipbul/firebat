import { mock, describe, it, expect, afterAll } from 'bun:test';
import * as nodePath from 'node:path';

const __origScanUsecase = { ...require(nodePath.resolve(import.meta.dir, '../../application/scan/scan.usecase.ts')) };
const __origRootResolver = { ...require(nodePath.resolve(import.meta.dir, '../../shared/root-resolver.ts')) };
const __origTargetDiscovery = { ...require(nodePath.resolve(import.meta.dir, '../../shared/target-discovery.ts')) };
const __origConfigLoader = { ...require(nodePath.resolve(import.meta.dir, '../../shared/firebat-config.loader.ts')) };
const __origReport = { ...require(nodePath.resolve(import.meta.dir, '../../report.ts')) };
const __origLogging = { ...require(nodePath.resolve(import.meta.dir, '../../shared/logger.ts')) };
const __origPrettyLogger = { ...require(nodePath.resolve(import.meta.dir, '../../shared/logger.ts')) };

// Heavy dependencies mocked to prevent side-effects and slow load
mock.module(nodePath.resolve(import.meta.dir, '../../application/scan/scan.usecase.ts'), () => ({
  scanUseCase: mock(async () => ({ analyses: {}, summary: {} })),
}));

mock.module(nodePath.resolve(import.meta.dir, '../../shared/root-resolver.ts'), () => ({
  resolveFirebatRootFromCwd: mock(async () => ({ rootAbs: '/project' })),
}));

mock.module(nodePath.resolve(import.meta.dir, '../../shared/target-discovery.ts'), () => ({
  resolveTargets: mock(async () => []),
}));

mock.module(nodePath.resolve(import.meta.dir, '../../shared/firebat-config.loader.ts'), () => ({
  loadFirebatConfigFile: mock(async () => ({ config: null, resolvedPath: undefined })),
  resolveDefaultFirebatRcPath: mock((rootAbs: string) => nodePath.join(rootAbs, '.firebatrc.jsonc')),
}));

mock.module(nodePath.resolve(import.meta.dir, '../../report.ts'), () => ({
  formatReport: mock((_r: unknown, _f: unknown) => '[]'),
}));

mock.module(nodePath.resolve(import.meta.dir, '../../shared/logger.ts'), () => ({
  appendFirebatLog: mock(async () => undefined),
}));

mock.module(nodePath.resolve(import.meta.dir, '../../shared/logger.ts'), () => ({
  createPrettyConsoleLogger: mock(() => ({
    error: mock(() => undefined),
    info: mock(() => undefined),
    debug: mock(() => undefined),
    trace: mock(() => undefined),
    warn: mock(() => undefined),
  })),
}));

import { __testing__, runCli } from './entry';

const {
  resolveEnabledDetectorsFromFeatures,
  resolveUnknownProofBoundaryGlobsFromFeatures,
  resolveBarrelPolicyIgnoreGlobsFromFeatures,
  resolveDependenciesLayersFromFeatures,
  resolveDependenciesAllowedDependenciesFromFeatures,
  resolveMinSizeFromFeatures,
  resolveMaxForwardDepthFromFeatures,
  resolveWasteMemoryRetentionThresholdFromFeatures,
} = __testing__;

describe('resolveEnabledDetectorsFromFeatures', () => {
  it('should return all detectors when features is undefined', () => {
    const result = resolveEnabledDetectorsFromFeatures(undefined);

    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('exact-duplicates');
    expect(result).toContain('waste');
    expect(result).toContain('lint');
  });

  it('should exclude detectors set to false', () => {
    const result = resolveEnabledDetectorsFromFeatures({
      'exact-duplicates': false,
      waste: false,
    } as never);

    expect(result).not.toContain('exact-duplicates');
    expect(result).not.toContain('waste');
    expect(result).toContain('lint');
  });

  it('should include all detectors when no feature is false', () => {
    const result = resolveEnabledDetectorsFromFeatures({} as never);

    expect(result).toContain('exact-duplicates');
  });
});

describe('resolveUnknownProofBoundaryGlobsFromFeatures', () => {
  it('should return undefined when features is undefined', () => {
    expect(resolveUnknownProofBoundaryGlobsFromFeatures(undefined)).toBeUndefined();
  });

  it('should return undefined when unknown-proof is true (boolean)', () => {
    expect(resolveUnknownProofBoundaryGlobsFromFeatures({ 'unknown-proof': true } as never)).toBeUndefined();
  });

  it('should return boundaryGlobs array when properly configured', () => {
    const result = resolveUnknownProofBoundaryGlobsFromFeatures({
      'unknown-proof': { boundaryGlobs: ['src/**', 'lib/**'] },
    } as never);

    expect(result).toEqual(['src/**', 'lib/**']);
  });

  it('should return undefined when boundaryGlobs contains non-strings', () => {
    const result = resolveUnknownProofBoundaryGlobsFromFeatures({
      'unknown-proof': { boundaryGlobs: [123, 'src/**'] },
    } as never);

    expect(result).toBeUndefined();
  });
});

describe('resolveBarrelPolicyIgnoreGlobsFromFeatures', () => {
  it('should return undefined when features is undefined', () => {
    expect(resolveBarrelPolicyIgnoreGlobsFromFeatures(undefined)).toBeUndefined();
  });

  it('should return ignoreGlobs array when configured', () => {
    const result = resolveBarrelPolicyIgnoreGlobsFromFeatures({
      'barrel-policy': { ignoreGlobs: ['**/node_modules/**'] },
    } as never);

    expect(result).toEqual(['**/node_modules/**']);
  });

  it('should return undefined when barrel-policy is false', () => {
    expect(resolveBarrelPolicyIgnoreGlobsFromFeatures({ 'barrel-policy': false } as never)).toBeUndefined();
  });
});

describe('resolveDependenciesLayersFromFeatures', () => {
  it('should return undefined when features is undefined', () => {
    expect(resolveDependenciesLayersFromFeatures(undefined)).toBeUndefined();
  });

  it('should return layers array when configured', () => {
    const layers = [{ name: 'domain', glob: 'src/domain/**' }];
    const result = resolveDependenciesLayersFromFeatures({ dependencies: { layers } } as never);

    expect(result).toEqual(layers);
  });

  it('should return undefined when layers contains invalid entries', () => {
    const result = resolveDependenciesLayersFromFeatures({
      dependencies: { layers: [{ name: 123, glob: 'src/**' }] },
    } as never);

    expect(result).toBeUndefined();
  });
});

describe('resolveDependenciesAllowedDependenciesFromFeatures', () => {
  it('should return undefined when features is undefined', () => {
    expect(resolveDependenciesAllowedDependenciesFromFeatures(undefined)).toBeUndefined();
  });

  it('should return allowed dependencies map when valid', () => {
    const allowed = { domain: ['infra', 'utils'] };
    const result = resolveDependenciesAllowedDependenciesFromFeatures({
      dependencies: { allowedDependencies: allowed },
    } as never);

    expect(result).toEqual(allowed);
  });

  it('should return undefined when allowed dependencies has non-string-array values', () => {
    const result = resolveDependenciesAllowedDependenciesFromFeatures({
      dependencies: { allowedDependencies: { domain: [123] } },
    } as never);

    expect(result).toBeUndefined();
  });
});

describe('resolveMinSizeFromFeatures', () => {
  it('should return undefined when features is undefined', () => {
    expect(resolveMinSizeFromFeatures(undefined)).toBeUndefined();
  });

  it('should return minSize from exact-duplicates config', () => {
    const result = resolveMinSizeFromFeatures({
      'exact-duplicates': { minSize: 20 },
    } as never);

    expect(result).toBe(20);
  });

  it('should throw when exact and structural minSize conflict', () => {
    expect(() =>
      resolveMinSizeFromFeatures({
        'exact-duplicates': { minSize: 10 },
        'structural-duplicates': { minSize: 20 },
      } as never),
    ).toThrow('must match');
  });

  it('should return minSize from structural-duplicates when exact is not set', () => {
    const result = resolveMinSizeFromFeatures({
      'structural-duplicates': { minSize: 15 },
    } as never);

    expect(result).toBe(15);
  });
});

describe('resolveMaxForwardDepthFromFeatures', () => {
  it('should return undefined when features is undefined', () => {
    expect(resolveMaxForwardDepthFromFeatures(undefined)).toBeUndefined();
  });

  it('should return undefined when forwarding is boolean', () => {
    expect(resolveMaxForwardDepthFromFeatures({ forwarding: true } as never)).toBeUndefined();
    expect(resolveMaxForwardDepthFromFeatures({ forwarding: false } as never)).toBeUndefined();
  });

  it('should return maxForwardDepth from forwarding config', () => {
    const result = resolveMaxForwardDepthFromFeatures({ forwarding: { maxForwardDepth: 5 } } as never);

    expect(result).toBe(5);
  });
});

describe('resolveWasteMemoryRetentionThresholdFromFeatures', () => {
  it('should return undefined when features is undefined', () => {
    expect(resolveWasteMemoryRetentionThresholdFromFeatures(undefined)).toBeUndefined();
  });

  it('should return undefined when waste is not an object', () => {
    expect(resolveWasteMemoryRetentionThresholdFromFeatures({ waste: true } as never)).toBeUndefined();
  });

  it('should return rounded threshold when valid', () => {
    const result = resolveWasteMemoryRetentionThresholdFromFeatures({
      waste: { memoryRetentionThreshold: 3.7 },
    } as never);

    expect(result).toBe(4);
  });

  it('should clamp negative threshold to 0', () => {
    const result = resolveWasteMemoryRetentionThresholdFromFeatures({
      waste: { memoryRetentionThreshold: -5 },
    } as never);

    expect(result).toBe(0);
  });

  it('should return undefined for non-finite threshold', () => {
    const result = resolveWasteMemoryRetentionThresholdFromFeatures({
      waste: { memoryRetentionThreshold: Infinity },
    } as never);

    expect(result).toBeUndefined();
  });
});

describe('runCli', () => {
  it('should be a function', () => {
    expect(typeof runCli).toBe('function');
  });

  it('should return 0 for --help', async () => {
    const result = await runCli(['--help']);

    expect(result).toBe(0);
  });
});

afterAll(() => {
  mock.restore();
  mock.module(nodePath.resolve(import.meta.dir, '../../application/scan/scan.usecase.ts'), () => __origScanUsecase);
  mock.module(nodePath.resolve(import.meta.dir, '../../shared/root-resolver.ts'), () => __origRootResolver);
  mock.module(nodePath.resolve(import.meta.dir, '../../shared/target-discovery.ts'), () => __origTargetDiscovery);
  mock.module(nodePath.resolve(import.meta.dir, '../../shared/firebat-config.loader.ts'), () => __origConfigLoader);
  mock.module(nodePath.resolve(import.meta.dir, '../../report.ts'), () => __origReport);
  mock.module(nodePath.resolve(import.meta.dir, '../../shared/logger.ts'), () => __origLogging);
  mock.module(nodePath.resolve(import.meta.dir, '../../shared/logger.ts'), () => __origPrettyLogger);
});

