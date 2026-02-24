// MUST: MUST-1
import * as path from 'node:path';

import type { FirebatCliOptions } from '../../interfaces';
import type { FirebatLogger } from '../../shared/logger';
import type {
  BarrelPolicyFindingKind,
  CouplingKind,
  DuplicateCloneType,
  EarlyReturnKind,
  FirebatCatalogCode,
  FirebatReport,
  ForwardingFindingKind,
  NestingKind,
  NoopKind,
  UnknownProofFindingKind,
  WasteKind,
} from '../../types';

import { computeAutoMinSize } from '../../engine/auto-min-size';
import { initHasher } from '../../engine/hasher';
import { analyzeAbstractionFitness, createEmptyAbstractionFitness } from '../../features/abstraction-fitness';
import { analyzeApiDrift, createEmptyApiDrift } from '../../features/api-drift';
import { analyzeBarrelPolicy, createEmptyBarrelPolicy } from '../../features/barrel-policy';
import { analyzeConceptScatter, createEmptyConceptScatter } from '../../features/concept-scatter';
import { analyzeCoupling, createEmptyCoupling } from '../../features/coupling';
import { analyzeDecisionSurface, createEmptyDecisionSurface } from '../../features/decision-surface';
import { analyzeDependencies, createEmptyDependencies } from '../../features/dependencies';
import { analyzeEarlyReturn, createEmptyEarlyReturn } from '../../features/early-return';
import { detectExactDuplicates } from '../../features/exact-duplicates';
import type { ExceptionHygieneFindingKind } from '../../features/exception-hygiene';
import { analyzeExceptionHygiene, createEmptyExceptionHygiene } from '../../features/exception-hygiene';
import { analyzeFormat, createEmptyFormat } from '../../features/format';
import { analyzeForwarding, createEmptyForwarding } from '../../features/forwarding';
import { analyzeGiantFile, createEmptyGiantFile } from '../../features/giant-file';
import { analyzeImplementationOverhead, createEmptyImplementationOverhead } from '../../features/implementation-overhead';
import { analyzeImplicitState, createEmptyImplicitState } from '../../features/implicit-state';
import { analyzeInvariantBlindspot, createEmptyInvariantBlindspot } from '../../features/invariant-blindspot';
import { analyzeLint, createEmptyLint } from '../../features/lint';
import { analyzeModificationImpact, createEmptyModificationImpact } from '../../features/modification-impact';
import { analyzeModificationTrap, createEmptyModificationTrap } from '../../features/modification-trap';
import { analyzeNesting, createEmptyNesting } from '../../features/nesting';
import { analyzeNoop, createEmptyNoop } from '../../features/noop';
import { analyzeStructuralDuplicates, createEmptyStructuralDuplicates } from '../../features/structural-duplicates';
import { analyzeSymmetryBreaking, createEmptySymmetryBreaking } from '../../features/symmetry-breaking';
import { analyzeTemporalCoupling, createEmptyTemporalCoupling } from '../../features/temporal-coupling';
import { analyzeTypecheck, createEmptyTypecheck } from '../../features/typecheck';
import { analyzeUnknownProof, createEmptyUnknownProof } from '../../features/unknown-proof';
import { analyzeVariableLifetime, createEmptyVariableLifetime } from '../../features/variable-lifetime';
import { detectWaste } from '../../features/waste';
import { loadFirebatConfigFile } from '../../shared/firebat-config.loader';
import { getDb } from '../../infrastructure/sqlite/firebat.db';
import { createArtifactStore } from '../../store/artifact';
import { createGildash } from '../../store/gildash';
import { resolveRuntimeContextFromCwd } from '../../shared/runtime-context';
import { computeToolVersion } from '../../shared/tool-version';
import { createFirebatProgram } from '../../shared/ts-program';
import { computeProjectKey, computeScanArtifactKey } from './cache-keys';
import { computeCacheNamespace } from './cache-namespace';
import { aggregateDiagnostics, FIREBAT_CODE_CATALOG } from './diagnostic-aggregator';
import { computeInputsDigest } from './inputs-digest';
import { shouldIncludeNoopEmptyCatch } from './noop-gating';
import { computeProjectInputsDigest } from './project-inputs-digest';

const nowMs = (): number => {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
};

const resolveToolRcPath = async (rootAbs: string, basename: string): Promise<string | undefined> => {
  const candidate = path.join(rootAbs, basename);
  let exists = false;

  try {
    const file = Bun.file(candidate);

    exists = await file.exists();
  } catch {
    return undefined;
  }

  if (!exists) {
    return undefined;
  }

  return candidate;
};

interface LoadCachedReportParams {
  readonly allowCache: boolean;
  readonly artifactRepository: ReturnType<typeof createArtifactStore>;
  readonly projectKey: string;
  readonly artifactKey: string;
  readonly inputsDigest: string;
  readonly logger: FirebatLogger;
}

const loadCachedReport = async (params: LoadCachedReportParams): Promise<FirebatReport | undefined> => {
  if (!params.allowCache) {
    return undefined;
  }

  const tCache0 = nowMs();
  const cached = params.artifactRepository.get<FirebatReport>({
    projectKey: params.projectKey,
    kind: 'firebat:report',
    artifactKey: params.artifactKey,
    inputsDigest: params.inputsDigest,
  });

  if (cached) {
    params.logger.info('Cache hit — skipping analysis', { durationMs: Math.round(nowMs() - tCache0) });

    return cached;
  }

  params.logger.info('Cache miss — running full analysis', { durationMs: Math.round(nowMs() - tCache0) });

  return undefined;
};

interface ScanUseCaseDeps {
  readonly logger: FirebatLogger;
}

const scanUseCase = async (options: FirebatCliOptions, deps: ScanUseCaseDeps): Promise<FirebatReport> => {
  const logger = deps.logger;
  const metaErrors: Record<string, string> = {};

  logger.info('Scanning', {
    targetCount: options.targets.length,
    detectorCount: options.detectors.length,
    fixMode: options.fix,
  });
  logger.trace('Detectors selected', { detectors: options.detectors.join(',') });

  const tHasher0 = nowMs();

  await initHasher();

  logger.trace('Hasher initialized', { durationMs: Math.round(nowMs() - tHasher0) });

  const tCtx0 = nowMs();
  const ctx = await resolveRuntimeContextFromCwd();

  logger.trace('Runtime context resolved', { rootAbs: ctx.rootAbs, durationMs: Math.round(nowMs() - tCtx0) });

  let config: Awaited<ReturnType<typeof loadFirebatConfigFile>>['config'] | null = null;

  try {
    const loaded = await loadFirebatConfigFile({
      rootAbs: ctx.rootAbs,
      ...(options.configPath ? { configPath: options.configPath } : {}),
    });

    config = loaded.config;

    if (loaded.exists) {
      logger.trace('Config loaded', { resolvedPath: loaded.resolvedPath });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    metaErrors.config = message;
    config = null;
  }

  const toolVersion = computeToolVersion();

  logger.trace('Tool version', { version: toolVersion });

  const projectKey = computeProjectKey({ toolVersion, cwd: ctx.rootAbs });

  logger.trace('Project key computed', { projectKey });

  const tDb0 = nowMs();
  const db = await getDb({ rootAbs: ctx.rootAbs, logger });

  logger.trace('DB ready', { durationMs: Math.round(nowMs() - tDb0) });

  const artifactRepository = createArtifactStore(db);

  logger.trace('Repositories created');

  const tIndex0 = nowMs();
  const gildash = await createGildash({ projectRoot: ctx.rootAbs, watchMode: false });
  logger.info('Indexing complete (gildash)', { targetCount: options.targets.length, durationMs: Math.round(nowMs() - tIndex0) });

  const tNamespace0 = nowMs();
  const cacheNamespace = await computeCacheNamespace({ toolVersion });

  logger.trace('Cache namespace computed', { cacheNamespace, durationMs: Math.round(nowMs() - tNamespace0) });

  const tProjectDigest0 = nowMs();
  const projectInputsDigest = await computeProjectInputsDigest({
    rootAbs: ctx.rootAbs,
    gildash,
  });

  logger.trace('Project inputs digest computed', { projectInputsDigest, durationMs: Math.round(nowMs() - tProjectDigest0) });

  const tInputsDigest0 = nowMs();
  const inputsDigest = await computeInputsDigest({
    targets: options.targets,
    gildash,
    extraParts: [`ns:${cacheNamespace}`, `project:${projectInputsDigest}`],
  });

  logger.trace('Inputs digest computed', { inputsDigest, durationMs: Math.round(nowMs() - tInputsDigest0) });

  await gildash.close({ cleanup: false });

  const artifactKey = computeScanArtifactKey({
    detectors: options.detectors,
    minSize: options.minSize === 'auto' ? 'auto' : String(options.minSize),
    maxForwardDepth: options.maxForwardDepth,
    ...(options.detectors.includes('waste') ? { wasteMemoryRetentionThreshold: options.wasteMemoryRetentionThreshold } : {}),
    ...(options.detectors.includes('unknown-proof')
      ? { unknownProofBoundaryGlobs: options.unknownProofBoundaryGlobs ?? [] }
      : {}),
    ...(options.detectors.includes('barrel-policy') ? { barrelPolicyIgnoreGlobs: options.barrelPolicyIgnoreGlobs ?? [] } : {}),
    ...(options.detectors.includes('dependencies') || options.detectors.includes('coupling')
      ? {
          dependenciesLayers: options.dependenciesLayers,
          dependenciesAllowedDependencies: options.dependenciesAllowedDependencies,
        }
      : {}),
  });

  logger.trace('Artifact key computed', { artifactKey });

  const allowCache = options.fix === false;

  logger.debug('Cache strategy', { allowCache });

  const cached = await loadCachedReport({
    allowCache,
    artifactRepository,
    projectKey,
    artifactKey,
    inputsDigest,
    logger,
  });

  if (cached !== undefined) {
    return cached;
  }

  // Note: in fix mode, prefer to run fixable tools before parsing the program
  // so the report reflects post-fix state.
  const shouldRunFormat = options.detectors.includes('format');
  const shouldRunLint = options.detectors.includes('lint');

  logger.debug('Fix mode tools', { shouldRunFormat, shouldRunLint });

  type FormatResult = ReturnType<typeof createEmptyFormat>;

  type LintResult = ReturnType<typeof createEmptyLint>;

  type BarrelPolicyResult = ReturnType<typeof createEmptyBarrelPolicy>;

  type UnknownProofResult = ReturnType<typeof createEmptyUnknownProof>;

  type TypecheckResult = ReturnType<typeof createEmptyTypecheck>;

  let formatPromise: Promise<FormatResult | null> | null = null;
  let lintPromise: Promise<LintResult | null> | null = null;
  const fixTimings: Record<string, number> = {};

  if (options.fix) {
    logger.info('Fix mode: running fixable tools before parse', {
      format: shouldRunFormat,
      lint: shouldRunLint,
    });

    const tFix0 = nowMs();
    const [oxfmtConfigPath, oxlintConfigPath] = await Promise.all([
      resolveToolRcPath(ctx.rootAbs, '.oxfmtrc.jsonc'),
      resolveToolRcPath(ctx.rootAbs, '.oxlintrc.jsonc'),
    ]);
    const [format, lint] = await Promise.all([
      shouldRunFormat
        ? analyzeFormat({
            targets: options.targets,
            fix: true,
            cwd: ctx.rootAbs,
            resolveMode: 'project-only',
            ...(oxfmtConfigPath !== undefined ? { configPath: oxfmtConfigPath } : {}),
            logger,
          }).catch(err => {
            const message = err instanceof Error ? err.message : String(err);

            metaErrors.format = message;

            return null;
          })
        : Promise.resolve(createEmptyFormat()),
      shouldRunLint
        ? analyzeLint({
            targets: options.targets,
            fix: true,
            cwd: ctx.rootAbs,
            resolveMode: 'project-only',
            ...(oxlintConfigPath !== undefined ? { configPath: oxlintConfigPath } : {}),
            logger,
          }).catch(err => {
            const message = err instanceof Error ? err.message : String(err);

            metaErrors.lint = message;

            return null;
          })
        : Promise.resolve(createEmptyLint()),
    ]);

    formatPromise = Promise.resolve(format);
    lintPromise = Promise.resolve(lint);

    const fixDur = Math.round(nowMs() - tFix0);

    if (shouldRunFormat) {
      fixTimings.format = nowMs() - tFix0;
    }

    if (shouldRunLint) {
      fixTimings.lint = nowMs() - tFix0;
    }

    logger.info('Fix mode: tools complete', { durationMs: fixDur });
  } else {
    if (shouldRunFormat) {
      const tFormat0 = nowMs();

      logger.debug('format: start', { mode: 'check', targetCount: options.targets.length });

      formatPromise = resolveToolRcPath(ctx.rootAbs, '.oxfmtrc.jsonc')
        .then(oxfmtConfigPath =>
          analyzeFormat({
            targets: options.targets,
            fix: false,
            cwd: ctx.rootAbs,
            resolveMode: 'project-only',
            ...(oxfmtConfigPath !== undefined ? { configPath: oxfmtConfigPath } : {}),
            logger,
          }),
        )
        .then(r => {
          fixTimings.format = nowMs() - tFormat0;

          logger.debug('format: complete', { durationMs: Math.round(fixTimings.format) });

          return r;
        })
        .catch(err => {
          const message = err instanceof Error ? err.message : String(err);

          metaErrors.format = message;

          fixTimings.format = nowMs() - tFormat0;

          logger.debug('format: failed', { durationMs: Math.round(fixTimings.format), message });

          return null;
        });
    }

    if (shouldRunLint) {
      const tLint0 = nowMs();

      logger.debug('lint: start', { fix: false, targetCount: options.targets.length });

      lintPromise = resolveToolRcPath(ctx.rootAbs, '.oxlintrc.jsonc')
        .then(oxlintConfigPath =>
          analyzeLint({
            targets: options.targets,
            fix: false,
            cwd: ctx.rootAbs,
            resolveMode: 'project-only',
            ...(oxlintConfigPath !== undefined ? { configPath: oxlintConfigPath } : {}),
            logger,
          }),
        )
        .then(r => {
          fixTimings.lint = nowMs() - tLint0;

          logger.debug('lint: complete', { durationMs: Math.round(fixTimings.lint) });

          return r;
        })
        .catch(err => {
          const message = err instanceof Error ? err.message : String(err);

          metaErrors.lint = message;

          fixTimings.lint = nowMs() - tLint0;

          logger.debug('lint: failed', { durationMs: Math.round(fixTimings.lint), message });

          return null;
        });
    }
  }

  const tProgram0 = nowMs();
  const program = await createFirebatProgram({
    targets: options.targets,
    logger,
  });

  logger.info('Parse complete', { parsedCount: program.length, durationMs: Math.round(nowMs() - tProgram0) });

  const resolvedMinSize = options.minSize === 'auto' ? computeAutoMinSize(program) : Math.max(0, Math.round(options.minSize));

  logger.debug('Min size resolved', { resolvedMinSize, inputMinSize: String(options.minSize) });

  const tDetectors0 = nowMs();

  logger.info('Running detectors', { detectorCount: options.detectors.length });

  const detectorTimings: Record<string, number> = {};
  let exactDuplicates: ReturnType<typeof detectExactDuplicates> = [];

  if (options.detectors.includes('exact-duplicates')) {
    const t0 = nowMs();
    const detectorKey = 'exact-duplicates';

    logger.debug('detector: start', { detector: detectorKey });

    exactDuplicates = detectExactDuplicates(program, resolvedMinSize);

    const durationMs = nowMs() - t0;

    detectorTimings[detectorKey] = durationMs;

    logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(durationMs) });
  }

  let waste: ReturnType<typeof detectWaste> = [];

  if (options.detectors.includes('waste')) {
    const t0 = nowMs();
    const detectorKey = 'waste';

    logger.debug('detector: start', { detector: detectorKey });

    waste = detectWaste(
      program,
      options.wasteMemoryRetentionThreshold !== undefined
        ? { memoryRetentionThreshold: options.wasteMemoryRetentionThreshold }
        : {},
    );
    detectorTimings.waste = nowMs() - t0;

    logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(detectorTimings.waste) });
  }

  const barrelPolicyPromise = options.detectors.includes('barrel-policy')
    ? ((): Promise<BarrelPolicyResult> => {
        const t0 = nowMs();
        const detectorKey = 'barrel-policy';

        logger.debug('detector: start', { detector: detectorKey });

        return analyzeBarrelPolicy(program, {
          rootAbs: ctx.rootAbs,
          ...(options.barrelPolicyIgnoreGlobs !== undefined ? { ignoreGlobs: options.barrelPolicyIgnoreGlobs } : {}),
        }).then(r => {
          const durationMs = nowMs() - t0;

          detectorTimings[detectorKey] = durationMs;

          logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(durationMs) });

          return r;
        });
      })()
    : Promise.resolve(createEmptyBarrelPolicy());
  const unknownProofPromise = options.detectors.includes('unknown-proof')
    ? ((): Promise<UnknownProofResult> => {
        const t0 = nowMs();
        const detectorKey = 'unknown-proof';

        logger.info('detector: start', { detector: detectorKey });

        return analyzeUnknownProof(program, {
          rootAbs: ctx.rootAbs,
          ...(options.unknownProofBoundaryGlobs !== undefined ? { boundaryGlobs: options.unknownProofBoundaryGlobs } : {}),
          logger,
        })
          .then(r => {
            const durationMs = nowMs() - t0;

            detectorTimings[detectorKey] = durationMs;

            logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(durationMs) });

            return r;
          })
          .catch(err => {
            const durationMs = nowMs() - t0;

            detectorTimings[detectorKey] = durationMs;

            const message = err instanceof Error ? err.message : String(err);

            metaErrors[detectorKey] = message;

            const partial = (err as any)?.partial;

            if (Array.isArray(partial)) {
              return partial as UnknownProofResult;
            }

            return createEmptyUnknownProof();
          });
      })()
    : Promise.resolve(createEmptyUnknownProof());
  const typecheckPromise: Promise<TypecheckResult | null> = options.detectors.includes('typecheck')
    ? ((): Promise<TypecheckResult | null> => {
        const t0 = nowMs();
        const detectorKey = 'typecheck';

        logger.info('detector: start', { detector: detectorKey });

        return analyzeTypecheck(program, { rootAbs: ctx.rootAbs, logger })
          .then(r => {
            detectorTimings.typecheck = nowMs() - t0;

            logger.debug('detector: complete', {
              detector: detectorKey,
              durationMs: Math.round(detectorTimings.typecheck),
            });

            return r;
          })
          .catch(err => {
            detectorTimings.typecheck = nowMs() - t0;

            const message = err instanceof Error ? err.message : String(err);

            metaErrors.typecheck = message.includes('tsgo') ? message : `tsgo: ${message}`;

            logger.debug('detector: failed', {
              detector: detectorKey,
              durationMs: Math.round(detectorTimings.typecheck),
              message: metaErrors.typecheck,
            });

            return null;
          });
      })()
    : Promise.resolve(createEmptyTypecheck());
  const shouldRunDependencies = options.detectors.includes('dependencies') || options.detectors.includes('coupling');
  let dependencies: Awaited<ReturnType<typeof analyzeDependencies>>;

  if (shouldRunDependencies) {
    const t0 = nowMs();
    const detectorKey = 'dependencies';

    logger.debug('detector: start', { detector: detectorKey });

    dependencies = await analyzeDependencies(gildash, {
      rootAbs: ctx.rootAbs,
      ...(options.dependenciesLayers !== undefined ? { layers: options.dependenciesLayers } : {}),
      ...(options.dependenciesAllowedDependencies !== undefined
        ? { allowedDependencies: options.dependenciesAllowedDependencies }
        : {}),
    });
    detectorTimings.dependencies = nowMs() - t0;

    logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(detectorTimings.dependencies) });
  } else {
    dependencies = createEmptyDependencies();
  }

  let coupling: ReturnType<typeof analyzeCoupling>;

  if (options.detectors.includes('coupling')) {
    const t0 = nowMs();
    const detectorKey = 'coupling';

    logger.debug('detector: start', { detector: detectorKey });

    coupling = analyzeCoupling(dependencies);
    detectorTimings.coupling = nowMs() - t0;

    logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(detectorTimings.coupling) });
  } else {
    coupling = createEmptyCoupling();
  }

  let structuralDuplicates: ReturnType<typeof analyzeStructuralDuplicates>;

  if (options.detectors.includes('structural-duplicates')) {
    const t0 = nowMs();
    const detectorKey = 'structural-duplicates';

    logger.debug('detector: start', { detector: detectorKey });

    structuralDuplicates = analyzeStructuralDuplicates(program, resolvedMinSize);

    const durationMs = nowMs() - t0;

    detectorTimings[detectorKey] = durationMs;

    logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(durationMs) });
  } else {
    structuralDuplicates = createEmptyStructuralDuplicates();
  }

  let nesting: ReturnType<typeof analyzeNesting>;

  if (options.detectors.includes('nesting')) {
    const t0 = nowMs();
    const detectorKey = 'nesting';

    logger.debug('detector: start', { detector: detectorKey });

    nesting = analyzeNesting(program);
    detectorTimings.nesting = nowMs() - t0;

    logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(detectorTimings.nesting) });
  } else {
    nesting = createEmptyNesting();
  }

  let earlyReturn: ReturnType<typeof analyzeEarlyReturn>;

  if (options.detectors.includes('early-return')) {
    const t0 = nowMs();
    const detectorKey = 'early-return';

    logger.debug('detector: start', { detector: detectorKey });

    earlyReturn = analyzeEarlyReturn(program);

    const durationMs = nowMs() - t0;

    detectorTimings[detectorKey] = durationMs;

    logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(durationMs) });
  } else {
    earlyReturn = createEmptyEarlyReturn();
  }

  let exceptionHygiene: ReturnType<typeof analyzeExceptionHygiene>;
  let exceptionHygieneStatus: 'ok' | 'failed' = 'ok';

  if (options.detectors.includes('exception-hygiene')) {
    const t0 = nowMs();
    const detectorKey = 'exception-hygiene';

    logger.debug('detector: start', { detector: detectorKey });

    try {
      exceptionHygiene = analyzeExceptionHygiene(program);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      metaErrors[detectorKey] = message;
      exceptionHygieneStatus = 'failed';
      exceptionHygiene = createEmptyExceptionHygiene();
    }

    const durationMs = nowMs() - t0;

    detectorTimings[detectorKey] = durationMs;

    logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(durationMs) });
  } else {
    exceptionHygiene = createEmptyExceptionHygiene();
  }

  const includeNoopEmptyCatch = shouldIncludeNoopEmptyCatch({
    exceptionHygieneSelected: options.detectors.includes('exception-hygiene'),
    exceptionHygieneStatus,
  });
  let noop: ReturnType<typeof analyzeNoop>;

  if (options.detectors.includes('noop')) {
    const t0 = nowMs();
    const detectorKey = 'noop';

    logger.debug('detector: start', { detector: detectorKey });

    noop = analyzeNoop(program);

    if (!includeNoopEmptyCatch) {
      noop = noop.filter(f => f.kind !== 'empty-catch');
    }

    detectorTimings.noop = nowMs() - t0;

    logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(detectorTimings.noop) });
  } else {
    noop = createEmptyNoop();
  }

  const apiDriftPromise = options.detectors.includes('api-drift')
    ? ((): Promise<Awaited<ReturnType<typeof analyzeApiDrift>>> => {
        const t0 = nowMs();
        const detectorKey = 'api-drift';

        logger.debug('detector: start', { detector: detectorKey });

        return analyzeApiDrift(program, { rootAbs: ctx.rootAbs, logger }).then(r => {
          const durationMs = nowMs() - t0;

          detectorTimings[detectorKey] = durationMs;

          logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(durationMs) });

          return r;
        });
      })()
    : Promise.resolve(createEmptyApiDrift());
  let forwarding: ReturnType<typeof analyzeForwarding>;

  if (options.detectors.includes('forwarding')) {
    const t0 = nowMs();
    const detectorKey = 'forwarding';

    logger.debug('detector: start', { detector: detectorKey });

    forwarding = analyzeForwarding(program, options.maxForwardDepth);
    detectorTimings.forwarding = nowMs() - t0;

    logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(detectorTimings.forwarding) });
  } else {
    forwarding = createEmptyForwarding();
  }

  const [barrelPolicy, unknownProof, lint, typecheck, format, apiDrift] = await Promise.all([
    barrelPolicyPromise,
    unknownProofPromise,
    lintPromise ?? Promise.resolve(createEmptyLint()),
    typecheckPromise,
    formatPromise ?? Promise.resolve(createEmptyFormat()),
    apiDriftPromise,
  ]);

  logger.info('Analysis complete', { durationMs: Math.round(nowMs() - tDetectors0) });

  const defaultFeatureOptions = {
    giantFileMaxLines: 1000,
    decisionSurfaceMaxAxes: 2,
    variableLifetimeMaxLifetimeLines: 30,
    implementationOverheadMinRatio: 1.0,
    conceptScatterMaxScatterIndex: 2,
    abstractionFitnessMinFitnessScore: 0,
  };
  const resolvedGiantFileMaxLines =
    (config as any)?.features?.['giant-file']?.maxLines ?? defaultFeatureOptions.giantFileMaxLines;
  const resolvedDecisionSurfaceMaxAxes =
    (config as any)?.features?.['decision-surface']?.maxAxes ?? defaultFeatureOptions.decisionSurfaceMaxAxes;
  const resolvedVariableLifetimeMaxLifetimeLines =
    (config as any)?.features?.['variable-lifetime']?.maxLifetimeLines ?? defaultFeatureOptions.variableLifetimeMaxLifetimeLines;
  const resolvedImplementationOverheadMinRatio =
    (config as any)?.features?.['implementation-overhead']?.minRatio ?? defaultFeatureOptions.implementationOverheadMinRatio;
  const resolvedConceptScatterMaxScatterIndex =
    (config as any)?.features?.['concept-scatter']?.maxScatterIndex ?? defaultFeatureOptions.conceptScatterMaxScatterIndex;
  const resolvedAbstractionFitnessMinFitnessScore =
    (config as any)?.features?.['abstraction-fitness']?.minFitnessScore ??
    defaultFeatureOptions.abstractionFitnessMinFitnessScore;
  let giantFile: ReturnType<typeof analyzeGiantFile> = createEmptyGiantFile();

  if (options.detectors.includes('giant-file')) {
    const t0 = nowMs();
    const detectorKey = 'giant-file';

    logger.debug('detector: start', { detector: detectorKey });

    giantFile = analyzeGiantFile(program, { maxLines: Number(resolvedGiantFileMaxLines) });
    detectorTimings[detectorKey] = nowMs() - t0;

    logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(detectorTimings[detectorKey] ?? 0) });
  }

  let decisionSurface: ReturnType<typeof analyzeDecisionSurface> = createEmptyDecisionSurface();

  if (options.detectors.includes('decision-surface')) {
    const t0 = nowMs();
    const detectorKey = 'decision-surface';

    logger.debug('detector: start', { detector: detectorKey });

    decisionSurface = analyzeDecisionSurface(program, { maxAxes: Number(resolvedDecisionSurfaceMaxAxes) });
    detectorTimings[detectorKey] = nowMs() - t0;

    logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(detectorTimings[detectorKey] ?? 0) });
  }

  let variableLifetime: ReturnType<typeof analyzeVariableLifetime> = createEmptyVariableLifetime();

  if (options.detectors.includes('variable-lifetime')) {
    const t0 = nowMs();
    const detectorKey = 'variable-lifetime';

    logger.debug('detector: start', { detector: detectorKey });

    variableLifetime = analyzeVariableLifetime(program, { maxLifetimeLines: Number(resolvedVariableLifetimeMaxLifetimeLines) });
    detectorTimings[detectorKey] = nowMs() - t0;

    logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(detectorTimings[detectorKey] ?? 0) });
  }

  let implementationOverhead: ReturnType<typeof analyzeImplementationOverhead> = createEmptyImplementationOverhead();

  if (options.detectors.includes('implementation-overhead')) {
    const t0 = nowMs();
    const detectorKey = 'implementation-overhead';

    logger.debug('detector: start', { detector: detectorKey });

    implementationOverhead = analyzeImplementationOverhead(program, { minRatio: Number(resolvedImplementationOverheadMinRatio) });
    detectorTimings[detectorKey] = nowMs() - t0;

    logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(detectorTimings[detectorKey] ?? 0) });
  }

  let implicitState: ReturnType<typeof analyzeImplicitState> = createEmptyImplicitState();

  if (options.detectors.includes('implicit-state')) {
    const t0 = nowMs();
    const detectorKey = 'implicit-state';

    logger.debug('detector: start', { detector: detectorKey });

    implicitState = analyzeImplicitState(program);
    detectorTimings[detectorKey] = nowMs() - t0;

    logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(detectorTimings[detectorKey] ?? 0) });
  }

  let temporalCoupling: ReturnType<typeof analyzeTemporalCoupling> = createEmptyTemporalCoupling();

  if (options.detectors.includes('temporal-coupling')) {
    const t0 = nowMs();
    const detectorKey = 'temporal-coupling';

    logger.debug('detector: start', { detector: detectorKey });

    temporalCoupling = analyzeTemporalCoupling(program);
    detectorTimings[detectorKey] = nowMs() - t0;

    logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(detectorTimings[detectorKey] ?? 0) });
  }

  let symmetryBreaking: ReturnType<typeof analyzeSymmetryBreaking> = createEmptySymmetryBreaking();

  if (options.detectors.includes('symmetry-breaking')) {
    const t0 = nowMs();
    const detectorKey = 'symmetry-breaking';

    logger.debug('detector: start', { detector: detectorKey });

    symmetryBreaking = analyzeSymmetryBreaking(program);
    detectorTimings[detectorKey] = nowMs() - t0;

    logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(detectorTimings[detectorKey] ?? 0) });
  }

  let invariantBlindspot: ReturnType<typeof analyzeInvariantBlindspot> = createEmptyInvariantBlindspot();

  if (options.detectors.includes('invariant-blindspot')) {
    const t0 = nowMs();
    const detectorKey = 'invariant-blindspot';

    logger.debug('detector: start', { detector: detectorKey });

    invariantBlindspot = analyzeInvariantBlindspot(program);
    detectorTimings[detectorKey] = nowMs() - t0;

    logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(detectorTimings[detectorKey] ?? 0) });
  }

  let modificationTrap: ReturnType<typeof analyzeModificationTrap> = createEmptyModificationTrap();

  if (options.detectors.includes('modification-trap')) {
    const t0 = nowMs();
    const detectorKey = 'modification-trap';

    logger.debug('detector: start', { detector: detectorKey });

    modificationTrap = analyzeModificationTrap(program);
    detectorTimings[detectorKey] = nowMs() - t0;

    logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(detectorTimings[detectorKey] ?? 0) });
  }

  let modificationImpact: ReturnType<typeof analyzeModificationImpact> = createEmptyModificationImpact();

  if (options.detectors.includes('modification-impact')) {
    const t0 = nowMs();
    const detectorKey = 'modification-impact';

    logger.debug('detector: start', { detector: detectorKey });

    modificationImpact = analyzeModificationImpact(program);
    detectorTimings[detectorKey] = nowMs() - t0;

    logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(detectorTimings[detectorKey] ?? 0) });
  }

  let conceptScatter: ReturnType<typeof analyzeConceptScatter> = createEmptyConceptScatter();

  if (options.detectors.includes('concept-scatter')) {
    const t0 = nowMs();
    const detectorKey = 'concept-scatter';

    logger.debug('detector: start', { detector: detectorKey });

    conceptScatter = analyzeConceptScatter(program, { maxScatterIndex: Number(resolvedConceptScatterMaxScatterIndex) });
    detectorTimings[detectorKey] = nowMs() - t0;

    logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(detectorTimings[detectorKey] ?? 0) });
  }

  let abstractionFitness: ReturnType<typeof analyzeAbstractionFitness> = createEmptyAbstractionFitness();

  if (options.detectors.includes('abstraction-fitness')) {
    const t0 = nowMs();
    const detectorKey = 'abstraction-fitness';

    logger.debug('detector: start', { detector: detectorKey });

    abstractionFitness = analyzeAbstractionFitness(program, {
      minFitnessScore: Number(resolvedAbstractionFitnessMinFitnessScore),
    });
    detectorTimings[detectorKey] = nowMs() - t0;

    logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(detectorTimings[detectorKey] ?? 0) });
  }

  const selectedDetectors = new Set(options.detectors);

  const toProjectRelative = (filePath: string): string => {
    const rel = path.relative(ctx.rootAbs, filePath);
    const normalized = rel.replaceAll('\\', '/');

    return normalized.length > 0 ? normalized : filePath.replaceAll('\\', '/');
  };

  const enrichWaste = (items: ReadonlyArray<any>): ReadonlyArray<any> => {
    const kindToCode: Readonly<Record<WasteKind, FirebatCatalogCode>> = {
      'dead-store': 'WASTE_DEAD_STORE',
      'dead-store-overwrite': 'WASTE_DEAD_STORE_OVERWRITE',
      'memory-retention': 'WASTE_MEMORY_RETENTION',
    } as const;

    return items.map(item => {
      const kind = String(item?.kind ?? '');
      const filePath = String(item?.filePath ?? item?.file ?? '');

      return {
        kind,
        code: (kindToCode as Record<string, FirebatCatalogCode | undefined>)[kind],
        file: filePath.length > 0 ? toProjectRelative(filePath) : filePath,
        span: item?.span,
        label: item?.label,
        confidence: item?.confidence,
      };
    });
  };

  const enrichNoop = (items: ReadonlyArray<any>): ReadonlyArray<any> => {
    const kindToCode: Readonly<Record<NoopKind, FirebatCatalogCode>> = {
      'expression-noop': 'NOOP_EXPRESSION',
      'self-assignment': 'NOOP_SELF_ASSIGNMENT',
      'constant-condition': 'NOOP_CONSTANT_CONDITION',
      'empty-catch': 'NOOP_EMPTY_CATCH',
      'empty-function-body': 'NOOP_EMPTY_FUNCTION_BODY',
    } as const;

    return items.map(item => {
      const kind = String(item?.kind ?? '');
      const filePath = String(item?.filePath ?? item?.file ?? '');

      return {
        kind,
        code: (kindToCode as Record<string, FirebatCatalogCode | undefined>)[kind],
        file: filePath.length > 0 ? toProjectRelative(filePath) : filePath,
        span: item?.span,
        confidence: item?.confidence,
        evidence: item?.evidence,
      };
    });
  };

  const enrichBarrelPolicy = (items: ReadonlyArray<any>): ReadonlyArray<any> => {
    const kindToCode: Readonly<Record<BarrelPolicyFindingKind, FirebatCatalogCode>> = {
      'export-star': 'BARREL_EXPORT_STAR',
      'deep-import': 'BARREL_DEEP_IMPORT',
      'index-deep-import': 'BARREL_INDEX_DEEP_IMPORT',
      'missing-index': 'BARREL_MISSING_INDEX',
      'invalid-index-statement': 'BARREL_INVALID_INDEX_STMT',
      'barrel-side-effect-import': 'BARREL_SIDE_EFFECT_IMPORT',
    } as const;

    return items.map(item => {
      const kind = String(item?.kind ?? '');
      const filePath = String(item?.filePath ?? item?.file ?? '');

      return {
        kind,
        code: (kindToCode as Record<string, FirebatCatalogCode | undefined>)[kind],
        file: filePath.length > 0 ? toProjectRelative(filePath) : filePath,
        span: item?.span,
        evidence: item?.evidence,
      };
    });
  };

  const enrichNesting = (items: ReadonlyArray<any>): ReadonlyArray<any> => {
    const kindToCode: Readonly<Record<NestingKind, FirebatCatalogCode>> = {
      'deep-nesting': 'NESTING_DEEP',
      'high-cognitive-complexity': 'NESTING_HIGH_CC',
      'accidental-quadratic': 'NESTING_ACCIDENTAL_QUADRATIC',
      'callback-depth': 'NESTING_CALLBACK_DEPTH',
    } as const;

    return items.map(item => {
      const kind = String(item?.kind ?? '');
      const filePath = String(item?.filePath ?? item?.file ?? '');

      return {
        ...item,
        code: (kindToCode as Record<string, FirebatCatalogCode | undefined>)[kind],
        file: filePath.length > 0 ? toProjectRelative(filePath) : filePath,
      };
    });
  };

  const enrichEarlyReturn = (items: ReadonlyArray<any>): ReadonlyArray<any> => {
    const kindToCode: Readonly<Record<EarlyReturnKind, FirebatCatalogCode>> = {
      'invertible-if-else': 'EARLY_RETURN_INVERTIBLE',
      'missing-guard': 'EARLY_RETURN_MISSING_GUARD',
    } as const;

    return items.map(item => {
      const kind = String(item?.kind ?? '');
      const filePath = String(item?.filePath ?? item?.file ?? '');

      return {
        ...item,
        code: (kindToCode as Record<string, FirebatCatalogCode | undefined>)[kind],
        file: filePath.length > 0 ? toProjectRelative(filePath) : filePath,
      };
    });
  };

  const enrichExceptionHygiene = (items: ReadonlyArray<any>): ReadonlyArray<any> => {
    const kindToCode: Record<Exclude<ExceptionHygieneFindingKind, 'tool-unavailable'>, FirebatCatalogCode> = {
      'throw-non-error': 'EH_THROW_NON_ERROR',
      'async-promise-executor': 'EH_ASYNC_PROMISE_EXECUTOR',
      'missing-error-cause': 'EH_MISSING_ERROR_CAUSE',
      'useless-catch': 'EH_USELESS_CATCH',
      'unsafe-finally': 'EH_UNSAFE_FINALLY',
      'return-in-finally': 'EH_RETURN_IN_FINALLY',
      'catch-or-return': 'EH_CATCH_OR_RETURN',
      'prefer-catch': 'EH_PREFER_CATCH',
      'prefer-await-to-then': 'EH_PREFER_AWAIT_TO_THEN',
      'floating-promises': 'EH_FLOATING_PROMISES',
      'misused-promises': 'EH_MISUSED_PROMISES',
      'return-await-policy': 'EH_RETURN_AWAIT_POLICY',
      'silent-catch': 'EH_SILENT_CATCH',
      'catch-transform-hygiene': 'EH_CATCH_TRANSFORM',
      'redundant-nested-catch': 'EH_REDUNDANT_NESTED_CATCH',
      'overscoped-try': 'EH_OVERSCOPED_TRY',
      'exception-control-flow': 'EH_EXCEPTION_CONTROL_FLOW',
    };

    return items.filter((item: any) => item?.kind !== 'tool-unavailable').map(item => {
      const kind = String(item?.kind ?? '');
      const filePath = String(item?.filePath ?? item?.file ?? '');

      return {
        kind,
        code: (kindToCode as Record<string, FirebatCatalogCode | undefined>)[kind],
        file: filePath.length > 0 ? toProjectRelative(filePath) : filePath,
        span: item?.span,
        evidence: item?.evidence,
      };
    });
  };

  const enrichUnknownProof = (items: ReadonlyArray<any>): ReadonlyArray<any> => {
    const kindToCode: Record<Exclude<UnknownProofFindingKind, 'tool-unavailable'>, FirebatCatalogCode> = {
      'type-assertion': 'UNKNOWN_TYPE_ASSERTION',
      'double-assertion': 'UNKNOWN_DOUBLE_ASSERTION',
      'unknown-type': 'UNKNOWN_UNNARROWED',
      'unvalidated-unknown': 'UNKNOWN_UNVALIDATED',
      'unknown-inferred': 'UNKNOWN_INFERRED',
      'any-inferred': 'UNKNOWN_ANY_INFERRED',
    };

    return items.filter((item: any) => item?.kind !== 'tool-unavailable').map(item => {
      const kind = String(item?.kind ?? '');
      const filePath = String(item?.filePath ?? item?.file ?? '');

      return {
        kind,
        code: (kindToCode as Record<string, FirebatCatalogCode | undefined>)[kind],
        file: filePath.length > 0 ? toProjectRelative(filePath) : filePath,
        span: item?.span,
        symbol: item?.symbol,
        evidence: item?.evidence,
        typeText: item?.typeText,
      };
    });
  };

  const enrichForwarding = (items: ReadonlyArray<any>): ReadonlyArray<any> => {
    const kindToCode: Readonly<Record<ForwardingFindingKind, FirebatCatalogCode>> = {
      'thin-wrapper': 'FWD_THIN_WRAPPER',
      'forward-chain': 'FWD_FORWARD_CHAIN',
      'cross-file-forwarding-chain': 'FWD_CROSS_FILE_CHAIN',
    } as const;

    return items.map(item => {
      const kind = String(item?.kind ?? '');
      const filePath = String(item?.filePath ?? item?.file ?? '');

      return {
        kind,
        code: (kindToCode as Record<string, FirebatCatalogCode | undefined>)[kind],
        file: filePath.length > 0 ? toProjectRelative(filePath) : filePath,
        span: item?.span,
        header: item?.header,
        depth: item?.depth,
        evidence: item?.evidence,
      };
    });
  };

  const enrichCoupling = (items: ReadonlyArray<any>): ReadonlyArray<any> => {
    const kindToCode: Readonly<Record<CouplingKind, FirebatCatalogCode>> = {
      'god-module': 'COUPLING_GOD_MODULE',
      'bidirectional-coupling': 'COUPLING_BIDIRECTIONAL',
      'off-main-sequence': 'COUPLING_OFF_MAIN_SEQ',
      'unstable-module': 'COUPLING_UNSTABLE',
      'rigid-module': 'COUPLING_RIGID',
    } as const;

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

    const zeroSpan = { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } };

    return items.map(item => {
      const module = String(item?.module ?? '');
      const signals = Array.isArray(item?.signals) ? (item.signals as string[]) : [];
      const kind = pickKind(signals);

      return {
        kind,
        code: (kindToCode as Record<string, FirebatCatalogCode | undefined>)[kind],
        file: module,
        span: zeroSpan,
        module,
        score: item?.score,
        signals,
        metrics: item?.metrics,
      };
    });
  };

  const enrichApiDrift = (groups: ReadonlyArray<any>): ReadonlyArray<any> => {
    const zeroSpan = { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } };
    const kindToCode = { signature: 'API_DRIFT_SIGNATURE' } as const satisfies Record<string, FirebatCatalogCode>;

    const normalizeShape = (shape: any) => {
      return {
        params: Number(shape?.paramsCount ?? shape?.params ?? 0),
        optionals: Number(shape?.optionalCount ?? shape?.optionals ?? 0),
        returnKind: String(shape?.returnKind ?? ''),
        async: Boolean(shape?.async),
      };
    };

    return groups.map(group => {
      const standard = normalizeShape(group?.standardCandidate ?? group?.standard);
      const outliers = Array.isArray(group?.outliers) ? group.outliers : [];

      return {
        label: String(group?.label ?? ''),
        standard,
        outliers: outliers.map((o: any) => {
          const filePath = String(o?.filePath ?? o?.file ?? '');
          const kind = 'signature';

          return {
            kind,
            code: (kindToCode as Record<string, FirebatCatalogCode | undefined>)[kind],
            file: filePath.length > 0 ? toProjectRelative(filePath) : filePath,
            span: o?.span ?? zeroSpan,
            shape: normalizeShape(o?.shape),
          };
        }),
      };
    });
  };

  const enrichDependencies = (value: any): ReadonlyArray<any> => {
    const zeroSpan = { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } };

    const deadExports = Array.isArray(value?.deadExports) ? value.deadExports : [];
    const layerViolations = Array.isArray(value?.layerViolations) ? value.layerViolations : [];
    const cycles = Array.isArray(value?.cycles) ? value.cycles : [];
    const cuts = Array.isArray(value?.edgeCutHints)
      ? value.edgeCutHints
      : Array.isArray(value?.cuts)
        ? value.cuts
        : [];

    const findings: any[] = [];

    for (const v of layerViolations) {
      const from = String(v?.from ?? '');

      findings.push({
        kind: 'layer-violation',
        code: 'DEP_LAYER_VIOLATION',
        file: from,
        span: zeroSpan,
        from,
        to: String(v?.to ?? ''),
        fromLayer: String(v?.fromLayer ?? ''),
        toLayer: String(v?.toLayer ?? ''),
      });
    }

    for (const d of deadExports) {
      const kind = String(d?.kind ?? 'dead-export');
      const module = String(d?.module ?? '');
      const code = kind === 'test-only-export' ? 'DEP_TEST_ONLY_EXPORT' : 'DEP_DEAD_EXPORT';

      findings.push({
        kind,
        code,
        file: module,
        span: zeroSpan,
        module,
        name: String(d?.exportName ?? d?.name ?? ''),
      });
    }

    for (const c of cycles) {
      const pathModules = Array.isArray(c?.path) ? c.path : [];
      const bestCut = cuts.find((h: any) =>
        pathModules.includes(h?.from) && pathModules.includes(h?.to),
      );

      findings.push({
        kind: 'circular-dependency',
        code: 'DIAG_CIRCULAR_DEPENDENCY',
        items: pathModules.map((mod: string) => ({
          file: toProjectRelative(mod),
          span: zeroSpan,
        })),
        ...(bestCut ? { cut: { from: bestCut.from, to: bestCut.to, score: bestCut.score } } : {}),
      });
    }

    return findings;
  };

  const enrichExactDuplicateGroups = (groups: ReadonlyArray<any>): ReadonlyArray<any> => {
    const kindToCode: Readonly<Record<'type-1', FirebatCatalogCode>> = {
      'type-1': 'EXACT_DUP_TYPE_1',
    } as const;

    return groups.map(group => {
      const kind = String(group?.cloneType ?? group?.kind ?? '');
      const items = Array.isArray(group?.items) ? group.items : [];

      return {
        kind,
        code: (kindToCode as Record<string, FirebatCatalogCode | undefined>)[kind],
        items: items.map((item: any) => {
          const filePath = String(item?.filePath ?? item?.file ?? '');

          return {
            kind: item?.kind,
            header: item?.header,
            file: filePath.length > 0 ? toProjectRelative(filePath) : filePath,
            span: item?.span,
          };
        }),
        ...(group?.suggestedParams !== undefined ? { params: group.suggestedParams } : {}),
      };
    });
  };

  const enrichDuplicateGroups = (groups: ReadonlyArray<any>): ReadonlyArray<any> => {
    const kindToCode: Readonly<Record<Exclude<DuplicateCloneType, 'type-2'>, FirebatCatalogCode>> = {
      'type-1': 'EXACT_DUP_TYPE_1',
      'type-2-shape': 'STRUCT_DUP_TYPE_2_SHAPE',
      'type-3-normalized': 'STRUCT_DUP_TYPE_3_NORMALIZED',
    } as const;

    return groups.map(group => {
      const kind = String(group?.cloneType ?? group?.kind ?? '');
      const items = Array.isArray(group?.items) ? group.items : [];

      return {
        kind,
        code: (kindToCode as Record<string, FirebatCatalogCode | undefined>)[kind],
        items: items.map((item: any) => {
          const filePath = String(item?.filePath ?? item?.file ?? '');

          return {
            kind: item?.kind,
            header: item?.header,
            file: filePath.length > 0 ? toProjectRelative(filePath) : filePath,
            span: item?.span,
          };
        }),
        ...(group?.suggestedParams !== undefined ? { suggestedParams: group.suggestedParams } : {}),
      };
    });
  };

  const zeroSpan = { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } };

  const enrichPhase1 = <T extends { readonly file?: string; readonly filePath?: string; readonly span?: unknown }>(
    items: ReadonlyArray<T>,
    code: FirebatCatalogCode,
  ): ReadonlyArray<T & { readonly code: FirebatCatalogCode; readonly file: string; readonly span: unknown }> =>
    items.map(item => {
      const filePath = String((item as any)?.file ?? (item as any)?.filePath ?? '');

      return {
        ...item,
        code,
        file: filePath.length > 0 ? toProjectRelative(filePath) : filePath,
        span: (item as any)?.span ?? zeroSpan,
      };
    });

  const enrichFormat = (files: ReadonlyArray<string>): ReadonlyArray<any> =>
    files.map(filePath => ({
      kind: 'needs-formatting' as const,
      code: 'FORMAT' as FirebatCatalogCode,
      file: filePath.length > 0 ? toProjectRelative(filePath) : filePath,
      span: zeroSpan,
    }));

  const enrichLint = (items: ReadonlyArray<any>): ReadonlyArray<any> =>
    items.map(item => ({
      ...item,
      catalogCode: 'LINT' as FirebatCatalogCode,
    }));

  const enrichTypecheck = (items: ReadonlyArray<any>): ReadonlyArray<any> =>
    items.map(item => ({
      ...item,
      catalogCode: 'TYPECHECK' as FirebatCatalogCode,
    }));

  const buildCatalog = (input: {
    readonly analyses: FirebatReport['analyses'];
    readonly diagnostics: ReturnType<typeof aggregateDiagnostics>;
  }): FirebatReport['catalog'] => {
    const seenCodes = new Set<FirebatCatalogCode>();

    for (const [, value] of Object.entries(input.analyses)) {
      if (!Array.isArray(value)) {
        continue;
      }

      for (const item of value as ReadonlyArray<any>) {
        const code = item?.code ?? item?.catalogCode;

        if (typeof code === 'string' && code in FIREBAT_CODE_CATALOG) {
          seenCodes.add(code as FirebatCatalogCode);
        }

        const nested = item?.outliers ?? item?.items;

        if (Array.isArray(nested)) {
          for (const sub of nested) {
            const subCode = (sub as any)?.code ?? (sub as any)?.catalogCode;

            if (typeof subCode === 'string' && subCode in FIREBAT_CODE_CATALOG) {
              seenCodes.add(subCode as FirebatCatalogCode);
            }
          }
        }
      }
    }

    const catalog: Partial<Record<FirebatCatalogCode, any>> = { ...input.diagnostics.catalog };

    for (const code of seenCodes) {
      if (!(code in catalog)) {
        catalog[code] = FIREBAT_CODE_CATALOG[code];
      }
    }

    return catalog;
  };

  const analyses: FirebatReport['analyses'] = {
    ...(selectedDetectors.has('exact-duplicates')
      ? { 'exact-duplicates': enrichExactDuplicateGroups(exactDuplicates as any) }
      : {}),
    ...(selectedDetectors.has('waste') ? { waste: enrichWaste(waste) } : {}),
    ...(selectedDetectors.has('barrel-policy') ? { 'barrel-policy': enrichBarrelPolicy(barrelPolicy as any) } : {}),
    ...(selectedDetectors.has('unknown-proof') ? { 'unknown-proof': enrichUnknownProof(unknownProof as any) } : {}),
    ...(selectedDetectors.has('exception-hygiene')
      ? { 'exception-hygiene': enrichExceptionHygiene(exceptionHygiene as any) }
      : {}),
    ...(selectedDetectors.has('format') && format !== null ? { format: enrichFormat(format) } : {}),
    ...(selectedDetectors.has('lint') && lint !== null ? { lint: enrichLint(lint) } : {}),
    ...(selectedDetectors.has('typecheck') && typecheck !== null ? { typecheck: enrichTypecheck(typecheck) } : {}),
    ...(selectedDetectors.has('dependencies') ? { dependencies: enrichDependencies(dependencies as any) } : {}),
    ...(selectedDetectors.has('coupling') ? { coupling: enrichCoupling(coupling as any) } : {}),
    ...(selectedDetectors.has('structural-duplicates')
      ? { 'structural-duplicates': enrichDuplicateGroups(structuralDuplicates as any) }
      : {}),
    ...(selectedDetectors.has('nesting') ? { nesting: enrichNesting(nesting as any) } : {}),
    ...(selectedDetectors.has('early-return') ? { 'early-return': enrichEarlyReturn(earlyReturn as any) } : {}),
    ...(selectedDetectors.has('noop') ? { noop: enrichNoop(noop as any) } : {}),
    ...(selectedDetectors.has('api-drift') ? { 'api-drift': enrichApiDrift(apiDrift as any) } : {}),
    ...(selectedDetectors.has('forwarding') ? { forwarding: enrichForwarding(forwarding as any) } : {}),
    ...(selectedDetectors.has('giant-file') ? { 'giant-file': enrichPhase1(giantFile as any, 'GIANT_FILE') } : {}),
    ...(selectedDetectors.has('decision-surface') ? { 'decision-surface': enrichPhase1(decisionSurface as any, 'DECISION_SURFACE') } : {}),
    ...(selectedDetectors.has('variable-lifetime') ? { 'variable-lifetime': enrichPhase1(variableLifetime as any, 'VAR_LIFETIME') } : {}),
    ...(selectedDetectors.has('implementation-overhead') ? { 'implementation-overhead': enrichPhase1(implementationOverhead as any, 'IMPL_OVERHEAD') } : {}),
    ...(selectedDetectors.has('implicit-state') ? { 'implicit-state': enrichPhase1(implicitState as any, 'IMPLICIT_STATE') } : {}),
    ...(selectedDetectors.has('temporal-coupling') ? { 'temporal-coupling': enrichPhase1(temporalCoupling as any, 'TEMPORAL_COUPLING') } : {}),
    ...(selectedDetectors.has('symmetry-breaking') ? { 'symmetry-breaking': enrichPhase1(symmetryBreaking as any, 'SYMMETRY_BREAK') } : {}),
    ...(selectedDetectors.has('invariant-blindspot') ? { 'invariant-blindspot': enrichPhase1(invariantBlindspot as any, 'INVARIANT_BLINDSPOT') } : {}),
    ...(selectedDetectors.has('modification-trap') ? { 'modification-trap': enrichPhase1(modificationTrap as any, 'MOD_TRAP') } : {}),
    ...(selectedDetectors.has('modification-impact') ? { 'modification-impact': enrichPhase1(modificationImpact as any, 'MOD_IMPACT') } : {}),
    ...(selectedDetectors.has('concept-scatter') ? { 'concept-scatter': enrichPhase1(conceptScatter as any, 'CONCEPT_SCATTER') } : {}),
    ...(selectedDetectors.has('abstraction-fitness') ? { 'abstraction-fitness': enrichPhase1(abstractionFitness as any, 'ABSTRACTION_FITNESS') } : {}),
  };
  const diagnostics = aggregateDiagnostics({ analyses: analyses as any });
  const catalog = buildCatalog({ analyses, diagnostics });
  const report: FirebatReport = {
    meta: {
      engine: 'oxc',
      targetCount: program.length,
      minSize: resolvedMinSize,
      maxForwardDepth: options.maxForwardDepth,
      detectors: options.detectors,
      detectorTimings: { ...detectorTimings, ...fixTimings },
      ...(Object.keys(metaErrors).length > 0 ? { errors: metaErrors } : {}),
    },
    analyses,
    catalog,
  };

  if (allowCache) {
    const tSave0 = nowMs();

    artifactRepository.set({
      projectKey,
      kind: 'firebat:report',
      artifactKey,
      inputsDigest,
      value: report,
    });

    logger.trace('Report cached', { durationMs: Math.round(nowMs() - tSave0) });
  }

  return report;
};

export { resolveToolRcPath, scanUseCase };
