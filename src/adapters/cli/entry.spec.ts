import { mock, describe, it, expect, afterAll } from 'bun:test';
import * as nodePath from 'node:path';

const __origScanUsecase = { ...require(nodePath.resolve(import.meta.dir, '../../application/scan/scan.usecase.ts')) };
const __origRootResolver = { ...require(nodePath.resolve(import.meta.dir, '../../shared/root-resolver.ts')) };
const __origTargetDiscovery = { ...require(nodePath.resolve(import.meta.dir, '../../shared/target-discovery.ts')) };
const __origConfigLoader = { ...require(nodePath.resolve(import.meta.dir, '../../shared/firebat-config.loader.ts')) };
const __origReport = { ...require(nodePath.resolve(import.meta.dir, '../../report.ts')) };
const __origLogging = { ...require(nodePath.resolve(import.meta.dir, '../../shared/logger.ts')) };
const __origPrettyLogger = { ...require(nodePath.resolve(import.meta.dir, '../../shared/logger.ts')) };
// ── D15 gating test state (barrel-surgery) ──────────────────────────────────
// scanUseCase / loadFirebatConfigFile are mocked below so the D15 gating
// tests can (a) observe the resolved FirebatCliOptions.detectors that reach
// scanUseCase and (b) vary the loaded config's `features.barrel` value per
// test. Defaults below match the original static mocks exactly when the
// override var is left unset, so every pre-existing test in this file is
// unaffected.
let __d15CapturedOptions: { detectors: ReadonlyArray<string> } | undefined;
let __d15ConfigOverride: { config: unknown; resolvedPath: string | undefined } | null = null;

// Typed getter (not a direct variable read): TS's control-flow narrowing pins
// `__d15CapturedOptions` to the literal `undefined` across the `await runCli(...)`
// call below (the mutating assignment lives in a sibling closure — scanUseCase's
// mock — so TS never widens the narrowed type back to the declared union), which
// makes later `?.detectors` reads resolve against `never` (TS2339). A function
// call's return type is always its declared type regardless of caller-side
// narrowing, so routing reads through this getter sidesteps the bug.
const getD15CapturedOptions = (): { detectors: ReadonlyArray<string> } | undefined => __d15CapturedOptions;

// Heavy dependencies mocked to prevent side-effects and slow load
void mock.module(nodePath.resolve(import.meta.dir, '../../application/scan/scan.usecase.ts'), () => ({
  scanUseCase: mock(async (options: { detectors: ReadonlyArray<string> }) => {
    __d15CapturedOptions = options;

    return { analyses: {}, catalog: {}, findings: [], meta: {} };
  }),
}));

void mock.module(nodePath.resolve(import.meta.dir, '../../shared/root-resolver.ts'), () => ({
  resolveFirebatRootFromCwd: mock(async () => ({ rootAbs: '/project' })),
}));

void mock.module(nodePath.resolve(import.meta.dir, '../../shared/target-discovery.ts'), () => ({
  resolveTargets: mock(async () => []),
}));

void mock.module(nodePath.resolve(import.meta.dir, '../../shared/firebat-config.loader.ts'), () => ({
  loadFirebatConfigFile: mock(async () => __d15ConfigOverride ?? { config: null, resolvedPath: undefined }),
  resolveDefaultFirebatRcPath: mock((rootAbs: string) => nodePath.join(rootAbs, '.firebatrc.jsonc')),
}));

void mock.module(nodePath.resolve(import.meta.dir, '../../report.ts'), () => ({
  formatReport: mock((_r: unknown) => '[]'),
}));

void mock.module(nodePath.resolve(import.meta.dir, '../../shared/logger.ts'), () => ({
  appendFirebatLog: mock(async () => undefined),
}));

void mock.module(nodePath.resolve(import.meta.dir, '../../shared/logger.ts'), () => ({
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
  resolveBarrelIgnoreGlobsFromFeatures,
  resolveDependenciesLayersFromFeatures,
  resolveDependenciesAllowedDependenciesFromFeatures,
  resolveDependenciesGlobsFromFeatures,
  resolveMinSizeFromFeatures,
  resolveMaxForwardDepthFromFeatures,
} = __testing__;

describe('resolveEnabledDetectorsFromFeatures', () => {
  it('should return all detectors when features is undefined', () => {
    const result = resolveEnabledDetectorsFromFeatures(undefined);

    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('duplicates');
    expect(result).toContain('waste');
    expect(result).toContain('lint');
  });

  it('should exclude detectors set to false', () => {
    const result = resolveEnabledDetectorsFromFeatures({
      duplicates: false,
      waste: false,
    } as never);

    expect(result).not.toContain('duplicates');
    expect(result).not.toContain('waste');
    expect(result).toContain('lint');
  });

  it('should include all detectors when no feature is false', () => {
    const result = resolveEnabledDetectorsFromFeatures({} as never);

    expect(result).toContain('duplicates');
  });
});

describe('resolveBarrelIgnoreGlobsFromFeatures', () => {
  it('should return undefined when features is undefined', () => {
    expect(resolveBarrelIgnoreGlobsFromFeatures(undefined)).toBeUndefined();
  });

  it('should return ignoreGlobs array when configured', () => {
    const result = resolveBarrelIgnoreGlobsFromFeatures({
      barrel: { ignoreGlobs: ['**/node_modules/**'] },
    } as never);

    expect(result).toEqual(['**/node_modules/**']);
  });

  it('should return undefined when barrel is false', () => {
    expect(resolveBarrelIgnoreGlobsFromFeatures({ barrel: false } as never)).toBeUndefined();
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

describe('resolveDependenciesGlobsFromFeatures', () => {
  it('should return undefined when features is undefined', () => {
    expect(resolveDependenciesGlobsFromFeatures(undefined, 'entry')).toBeUndefined();
    expect(resolveDependenciesGlobsFromFeatures(undefined, 'ignore')).toBeUndefined();
  });

  it('should return the entry globs when valid', () => {
    const result = resolveDependenciesGlobsFromFeatures({ dependencies: { entry: ['src/main.ts'] } } as never, 'entry');

    expect(result).toEqual(['src/main.ts']);
  });

  it('should return the ignore globs when valid', () => {
    const result = resolveDependenciesGlobsFromFeatures({ dependencies: { ignore: ['**/*.gen.ts'] } } as never, 'ignore');

    expect(result).toEqual(['**/*.gen.ts']);
  });

  it('should return undefined when the field is a non-string-array', () => {
    const result = resolveDependenciesGlobsFromFeatures({ dependencies: { entry: [123] } } as never, 'entry');

    expect(result).toBeUndefined();
  });

  it('should return the ignoreDependencies globs when valid', () => {
    const result = resolveDependenciesGlobsFromFeatures(
      { dependencies: { ignoreDependencies: ['@commitlint/*'] } } as never,
      'ignoreDependencies',
    );

    expect(result).toEqual(['@commitlint/*']);
  });
});

describe('resolveMinSizeFromFeatures', () => {
  it('should return undefined when features is undefined', () => {
    expect(resolveMinSizeFromFeatures(undefined)).toBeUndefined();
  });

  it('should return minSize from duplicates config', () => {
    const result = resolveMinSizeFromFeatures({
      duplicates: { minSize: 20 },
    } as never);

    expect(result).toBe(20);
  });

  it('should return undefined when duplicates config has no minSize', () => {
    const result = resolveMinSizeFromFeatures({
      duplicates: {},
    } as never);

    expect(result).toBeUndefined();
  });

  it('should return minSize when duplicates config provides it', () => {
    const result = resolveMinSizeFromFeatures({
      duplicates: { minSize: 15 },
    } as never);

    expect(result).toBe(15);
  });
});

describe('resolveMaxForwardDepthFromFeatures', () => {
  it('should return undefined when features is undefined', () => {
    expect(resolveMaxForwardDepthFromFeatures(undefined)).toBeUndefined();
  });

  it('should return undefined when indirection is boolean', () => {
    expect(resolveMaxForwardDepthFromFeatures({ indirection: true } as never)).toBeUndefined();
    expect(resolveMaxForwardDepthFromFeatures({ indirection: false } as never)).toBeUndefined();
  });

  it('should return maxForwardDepth from indirection config', () => {
    const result = resolveMaxForwardDepthFromFeatures({ indirection: { maxForwardDepth: 5 } } as never);

    expect(result).toBe(5);
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

// ── barrel-surgery (settled definition) — C2: D15 four-state declaration gating ──
// PLAN-barrel-surgery.md D15: declared ⇔ features.barrel is true/object, OR
// (features.barrel ABSENT and the user passes --only barrel explicitly).
// Explicit `false` always wins, even under --only. Today's code treats
// "absent" as active (barrel is in DEFAULT_DETECTORS, resolveEnabledDetectorsFromFeatures
// only disables on `=== false`) and lets an explicit --only unconditionally
// win over config (mergeConfigIntoOptions skips the config-derived detector
// list whenever `explicit.detectors` is true) — so two of these four states
// are RED until Phase 2 gating lands; the other two already hold today.
describe('D15 — barrel four-state declaration gating (post-surgery contract)', () => {
  it('features.barrel absent, no --only → barrel is NOT enabled (RED today: absent currently means active)', async () => {
    __d15CapturedOptions = undefined;
    __d15ConfigOverride = { config: null, resolvedPath: undefined };

    await runCli([]);

    expect(getD15CapturedOptions()).toBeDefined();
    expect(getD15CapturedOptions()?.detectors.includes('barrel')).toBe(false);
  });

  it('features.barrel absent + explicit --only barrel → barrel IS enabled', async () => {
    __d15CapturedOptions = undefined;
    __d15ConfigOverride = { config: null, resolvedPath: undefined };

    await runCli(['--only', 'barrel']);

    expect(getD15CapturedOptions()).toBeDefined();
    expect(getD15CapturedOptions()?.detectors).toEqual(['barrel']);
  });

  it('features.barrel === true → barrel IS enabled', async () => {
    __d15CapturedOptions = undefined;
    __d15ConfigOverride = { config: { features: { barrel: true } } as never, resolvedPath: undefined };

    await runCli([]);

    expect(getD15CapturedOptions()).toBeDefined();
    expect(getD15CapturedOptions()?.detectors.includes('barrel')).toBe(true);
  });

  it('features.barrel === false + explicit --only barrel → barrel is NOT enabled (RED today: --only always wins)', async () => {
    __d15CapturedOptions = undefined;
    __d15ConfigOverride = { config: { features: { barrel: false } } as never, resolvedPath: undefined };

    await runCli(['--only', 'barrel']);

    expect(getD15CapturedOptions()).toBeDefined();
    expect(getD15CapturedOptions()?.detectors.includes('barrel')).toBe(false);
  });
});

afterAll(() => {
  mock.restore();
  void mock.module(nodePath.resolve(import.meta.dir, '../../application/scan/scan.usecase.ts'), () => __origScanUsecase);
  void mock.module(nodePath.resolve(import.meta.dir, '../../shared/root-resolver.ts'), () => __origRootResolver);
  void mock.module(nodePath.resolve(import.meta.dir, '../../shared/target-discovery.ts'), () => __origTargetDiscovery);
  void mock.module(nodePath.resolve(import.meta.dir, '../../shared/firebat-config.loader.ts'), () => __origConfigLoader);
  void mock.module(nodePath.resolve(import.meta.dir, '../../report.ts'), () => __origReport);
  void mock.module(nodePath.resolve(import.meta.dir, '../../shared/logger.ts'), () => __origLogging);
  void mock.module(nodePath.resolve(import.meta.dir, '../../shared/logger.ts'), () => __origPrettyLogger);
});
