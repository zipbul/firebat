import { mock, describe, it, expect, afterAll } from 'bun:test';
import * as nodePath from 'node:path';

const __origScanUsecase = { ...require(nodePath.resolve(import.meta.dir, '../../application/scan/scan.usecase.ts')) };
const __origRuntimeContext = { ...require(nodePath.resolve(import.meta.dir, '../../shared/runtime-context.ts')) };
const __origTargetDiscovery = { ...require(nodePath.resolve(import.meta.dir, '../../shared/target-discovery.ts')) };
const __origConfigLoader = { ...require(nodePath.resolve(import.meta.dir, '../../shared/firebat-config.loader.ts')) };
const __origPrettyLogger = { ...require(nodePath.resolve(import.meta.dir, '../../infrastructure/logging/pretty-console-logger.ts')) };

// Heavy dependencies mocked to avoid side-effects
mock.module(nodePath.resolve(import.meta.dir, '../../application/scan/scan.usecase.ts'), () => ({
  scanUseCase: mock(async () => ({ analyses: {}, summary: {} })),
}));

mock.module(nodePath.resolve(import.meta.dir, '../../shared/runtime-context.ts'), () => ({
  resolveRuntimeContextFromCwd: mock(async () => ({ rootAbs: '/project' })),
}));

mock.module(nodePath.resolve(import.meta.dir, '../../shared/target-discovery.ts'), () => ({
  resolveTargets: mock(async () => []),
}));

mock.module(nodePath.resolve(import.meta.dir, '../../shared/firebat-config.loader.ts'), () => ({
  loadFirebatConfigFile: mock(async () => ({ config: null, resolvedPath: undefined })),
}));

mock.module(nodePath.resolve(import.meta.dir, '../../infrastructure/logging/pretty-console-logger.ts'), () => ({
  createPrettyConsoleLogger: mock(() => ({
    level: 'error',
    log: mock(() => undefined),
    error: mock(() => undefined),
    warn: mock(() => undefined),
    info: mock(() => undefined),
    debug: mock(() => undefined),
    trace: mock(() => undefined),
  })),
}));

import { __testing__, runMcpServer } from './server';

const {
  filterAnalysesByFilePatterns,
  extractFindingFilePaths,
  asDetectors,
  resolveEnabledDetectorsFromFeatures,
  resolveMinSizeFromFeatures,
  resolveMaxForwardDepthFromFeatures,
  toMcpLevel,
} = __testing__;

describe('extractFindingFilePaths', () => {
  it('should return file field as array', () => {
    expect(extractFindingFilePaths({ file: '/src/a.ts' })).toEqual(['/src/a.ts']);
  });

  it('should return filePath field as array', () => {
    expect(extractFindingFilePaths({ filePath: '/src/b.ts' })).toEqual(['/src/b.ts']);
  });

  it('should return module field as array', () => {
    expect(extractFindingFilePaths({ module: '/src/c.ts' })).toEqual(['/src/c.ts']);
  });

  it('should extract paths from items array', () => {
    const finding = { items: [{ filePath: '/a.ts' }, { file: '/b.ts' }] };
    const result = extractFindingFilePaths(finding);

    expect(result).toContain('/a.ts');
    expect(result).toContain('/b.ts');
  });

  it('should extract paths from outliers array', () => {
    const finding = { outliers: [{ filePath: '/x.ts' }, { filePath: '/y.ts' }] };
    const result = extractFindingFilePaths(finding);

    expect(result).toContain('/x.ts');
    expect(result).toContain('/y.ts');
  });

  it('should return empty array for unknown shape', () => {
    expect(extractFindingFilePaths({ something: 'else' })).toEqual([]);
  });

  it('should ignore empty string values', () => {
    expect(extractFindingFilePaths({ file: '' })).toEqual([]);
  });
});

describe('filterAnalysesByFilePatterns', () => {
  it('should return analyses unchanged when filePatterns is empty', () => {
    const analyses = { waste: [{ file: '/a.ts' }], lint: [] };
    const result = filterAnalysesByFilePatterns(analyses, []);

    expect(result).toBe(analyses);
  });

  it('should filter array findings by file pattern', () => {
    const analyses = {
      waste: [
        { file: 'src/a.ts' },
        { file: 'lib/b.ts' },
      ],
    };
    const result = filterAnalysesByFilePatterns(analyses, ['src/**']);

    expect((result['waste'] as unknown[]).length).toBe(1);
    expect((result['waste'] as { file: string }[])[0]!.file).toBe('src/a.ts');
  });

  it('should preserve findings with no file info', () => {
    const analyses = { lint: [{ message: 'no file' }] };
    const result = filterAnalysesByFilePatterns(analyses, ['src/**']);

    expect((result['lint'] as unknown[]).length).toBe(1);
  });

  it('should preserve non-array values as-is', () => {
    const analyses = { meta: { count: 5 } };
    const result = filterAnalysesByFilePatterns(analyses as never, ['src/**']);

    expect(result['meta']).toEqual({ count: 5 });
  });
});

describe('asDetectors', () => {
  it('should return all detectors when input is undefined', () => {
    const result = asDetectors(undefined);

    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('waste');
  });

  it('should return all detectors when input is empty', () => {
    const result = asDetectors([]);

    expect(result.length).toBeGreaterThan(0);
  });

  it('should filter to valid detectors', () => {
    const result = asDetectors(['waste', 'lint']);

    expect(result).toContain('waste');
    expect(result).toContain('lint');
    expect(result).not.toContain('exact-duplicates');
  });

  it('should return all detectors when no valid names match', () => {
    const result = asDetectors(['unknown-detector-xyz']);

    expect(result.length).toBeGreaterThan(0);
  });
});

describe('resolveEnabledDetectorsFromFeatures', () => {
  it('should return all when features is undefined', () => {
    const result = resolveEnabledDetectorsFromFeatures(undefined);

    expect(result).toContain('exact-duplicates');
    expect(result).toContain('waste');
  });

  it('should exclude detectors set to false', () => {
    const result = resolveEnabledDetectorsFromFeatures({ waste: false } as never);

    expect(result).not.toContain('waste');
    expect(result).toContain('lint');
  });
});

describe('resolveMinSizeFromFeatures', () => {
  it('should return undefined when features is undefined', () => {
    expect(resolveMinSizeFromFeatures(undefined)).toBeUndefined();
  });

  it('should return minSize from exact-duplicates', () => {
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
});

describe('resolveMaxForwardDepthFromFeatures', () => {
  it('should return undefined when features is undefined', () => {
    expect(resolveMaxForwardDepthFromFeatures(undefined)).toBeUndefined();
  });

  it('should return maxForwardDepth from forwarding config', () => {
    const result = resolveMaxForwardDepthFromFeatures({ forwarding: { maxForwardDepth: 3 } } as never);

    expect(result).toBe(3);
  });
});

describe('toMcpLevel', () => {
  it('should map error → error', () => {
    expect(toMcpLevel('error')).toBe('error');
  });

  it('should map warn → warning', () => {
    expect(toMcpLevel('warn')).toBe('warning');
  });

  it('should map info → info', () => {
    expect(toMcpLevel('info')).toBe('info');
  });

  it('should map debug → debug', () => {
    expect(toMcpLevel('debug')).toBe('debug');
  });

  it('should map trace → debug (MCP has no trace)', () => {
    expect(toMcpLevel('trace')).toBe('debug');
  });
});

describe('runMcpServer', () => {
  it('should be a function', () => {
    expect(typeof runMcpServer).toBe('function');
  });
});

afterAll(() => {
  mock.restore();
  mock.module(nodePath.resolve(import.meta.dir, '../../application/scan/scan.usecase.ts'), () => __origScanUsecase);
  mock.module(nodePath.resolve(import.meta.dir, '../../shared/runtime-context.ts'), () => __origRuntimeContext);
  mock.module(nodePath.resolve(import.meta.dir, '../../shared/target-discovery.ts'), () => __origTargetDiscovery);
  mock.module(nodePath.resolve(import.meta.dir, '../../shared/firebat-config.loader.ts'), () => __origConfigLoader);
  mock.module(nodePath.resolve(import.meta.dir, '../../infrastructure/logging/pretty-console-logger.ts'), () => __origPrettyLogger);
});

