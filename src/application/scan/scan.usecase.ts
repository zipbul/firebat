// MUST: MUST-1
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import type { ErrorFlowFindingKind } from '../../features/error-flow';
import type { FirebatCliOptions } from '../../interfaces';
import type { FirebatLogger } from '../../shared/logger';
import type {
  BarrelFindingKind,
  CouplingKind,
  DuplicateCloneType,
  EarlyReturnKind,
  FirebatCatalogCode,
  FirebatReport,
  IndirectionFindingKind,
  LivenessPressureFinding,
  MutationDensityFinding,
  NestingKind,
  ScopeNarrowingFinding,
  UnknownProofFindingKind,
  VariableLifetimeFinding,
  WasteKind,
} from '../../types';

import { computeAutoMinSize } from '../../engine/auto-min-size';
import { analyzeBarrel, createEmptyBarrel } from '../../features/barrel';
import { analyzeCollapsibleIf, createEmptyCollapsibleIf } from '../../features/collapsible-if';
import { analyzeCoupling, createEmptyCoupling } from '../../features/coupling';
import { analyzeDependencies, createEmptyDependencies } from '../../features/dependencies';
import { analyzeDuplicates, createEmptyDuplicates } from '../../features/duplicates';
import { analyzeEarlyReturn, createEmptyEarlyReturn } from '../../features/early-return';
import { analyzeErrorFlow, createEmptyErrorFlow } from '../../features/error-flow';
import { analyzeFormat, createEmptyFormat } from '../../features/format';
import { analyzeGiantFile, createEmptyGiantFile } from '../../features/giant-file';
import { analyzeIndirection, createEmptyIndirection } from '../../features/indirection';
import { analyzeLint, createEmptyLint } from '../../features/lint';
import { analyzeNesting, createEmptyNesting, DEFAULT_NESTING_OPTIONS } from '../../features/nesting';
import { analyzeTemporalCoupling, createEmptyTemporalCoupling } from '../../features/temporal-coupling';
import { analyzeTypecheck, createEmptyTypecheck } from '../../features/typecheck';
import { analyzeUnknownProof, createEmptyUnknownProof } from '../../features/unknown-proof';
import { analyzeVariableLifetime, createEmptyVariableLifetime } from '../../features/variable-lifetime';
import { detectWaste } from '../../features/waste';
import { getDb } from '../../infrastructure/sqlite/firebat.db';
import { loadFirebatConfigFile } from '../../shared/firebat-config.loader';
import { resolveRuntimeContextFromCwd } from '../../shared/runtime-context';
import { computeToolVersion } from '../../shared/tool-version';
import { createFirebatProgram } from '../../shared/ts-program';
import { createArtifactStore } from '../../store/artifact';
import { createGildash } from '../../store/gildash';
import { computeProjectKey, computeScanArtifactKey } from './cache-keys';
import { computeCacheNamespace } from './cache-namespace';
import { aggregateDiagnostics, FIREBAT_CODE_CATALOG } from './diagnostic-aggregator';
import { computeInputsDigest } from './inputs-digest';
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

  const needsSemantic = options.detectors.includes('unknown-proof') || options.detectors.includes('error-flow') || options.detectors.includes('typecheck');
  const tIndex0 = nowMs();
  let gildash: Awaited<ReturnType<typeof createGildash>>;
  let semanticAvailable = false;

  if (needsSemantic) {
    try {
      gildash = await createGildash({ projectRoot: ctx.rootAbs, watchMode: false, semantic: true });
      semanticAvailable = true;
    } catch {
      logger.warn('Semantic init failed, falling back to AST-only');

      gildash = await createGildash({ projectRoot: ctx.rootAbs, watchMode: false });
    }
  } else {
    gildash = await createGildash({ projectRoot: ctx.rootAbs, watchMode: false });
  }

  // Warmup: trigger tsc TypeChecker to parse @zipbul/gildash .d.ts dependency tree once.
  // Without this, the first getResolvedTypesAtPositions call on any file importing gildash pays ~30s cold-start cost.
  // Use edit.usecases.ts which imports createGildash — forces tsc to resolve the full Gildash type tree.
  // Warmup: trigger tsc TypeChecker to parse @zipbul/gildash .d.ts dependency tree once.
  // Without this, the first semantic type resolution on a file importing gildash pays ~30s cold-start.
  // Position 3512 is the `createGildash` call site — forces full Gildash type tree resolution.

  logger.info('Indexing complete (gildash)', {
    targetCount: options.targets.length,
    semantic: semanticAvailable,
    durationMs: Math.round(nowMs() - tIndex0),
  });

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

  const artifactKey = computeScanArtifactKey({
    detectors: options.detectors,
    minSize: options.minSize === 'auto' ? 'auto' : String(options.minSize),
    maxForwardDepth: options.maxForwardDepth,
    ...(options.detectors.includes('barrel') ? { barrelIgnoreGlobs: options.barrelIgnoreGlobs ?? [] } : {}),
    ...(options.detectors.includes('dependencies') || options.detectors.includes('coupling')
      ? {
          dependenciesLayers: options.dependenciesLayers,
          dependenciesAllowedDependencies: options.dependenciesAllowedDependencies,
        }
      : {}),
    ...(options.detectors.includes('coupling') && options.couplingConfig
      ? { couplingConfig: options.couplingConfig as Record<string, unknown> }
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

  type BarrelResult = ReturnType<typeof createEmptyBarrel>;

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
    gildash,
  });

  logger.info('Parse complete', { parsedCount: program.length, durationMs: Math.round(nowMs() - tProgram0) });

  const resolvedMinSize = options.minSize === 'auto' ? computeAutoMinSize(program) : Math.max(0, Math.round(options.minSize));

  logger.debug('Min size resolved', { resolvedMinSize, inputMinSize: String(options.minSize) });

  const tDetectors0 = nowMs();

  logger.info('Running detectors', { detectorCount: options.detectors.length });

  const detectorTimings: Record<string, number> = {};
  let waste: ReturnType<typeof detectWaste> = [];

  if (options.detectors.includes('waste')) {
    const t0 = nowMs();
    const detectorKey = 'waste';

    logger.debug('detector: start', { detector: detectorKey });

    waste = detectWaste(program);
    detectorTimings.waste = nowMs() - t0;

    logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(detectorTimings.waste) });
  }

  const barrelPromise = options.detectors.includes('barrel')
    ? (async (): Promise<BarrelResult> => {
        const t0 = nowMs();
        const detectorKey = 'barrel';

        logger.debug('detector: start', { detector: detectorKey });

        const r = await analyzeBarrel(program, {
          rootAbs: ctx.rootAbs,
          gildash,
          ...(options.barrelIgnoreGlobs !== undefined ? { ignoreGlobs: options.barrelIgnoreGlobs } : {}),
        });
        const durationMs = nowMs() - t0;

        detectorTimings[detectorKey] = durationMs;

        logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(durationMs) });

        return r;
      })()
    : Promise.resolve(createEmptyBarrel());
  let unknownProofResult: UnknownProofResult = createEmptyUnknownProof();

  if (options.detectors.includes('unknown-proof')) {
    const t0 = nowMs();
    const detectorKey = 'unknown-proof';

    logger.info('detector: start', { detector: detectorKey });

    try {
      unknownProofResult = analyzeUnknownProof(program, {
        rootAbs: ctx.rootAbs,
        ...(semanticAvailable ? { gildash } : {}),
      });
      detectorTimings[detectorKey] = nowMs() - t0;

      logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(detectorTimings[detectorKey]!) });
    } catch (err) {
      detectorTimings[detectorKey] = nowMs() - t0;

      const message = err instanceof Error ? err.message : String(err);

      metaErrors[detectorKey] = message;

      const partial = (err as { partial?: unknown })?.partial;

      if (Array.isArray(partial)) {
        unknownProofResult = partial as UnknownProofResult;
      }
    }
  }

  const typecheckPromise: Promise<TypecheckResult | null> = options.detectors.includes('typecheck')
    ? (async (): Promise<TypecheckResult | null> => {
        const t0 = nowMs();
        const detectorKey = 'typecheck';

        logger.info('detector: start', { detector: detectorKey });

        try {
          const r = await analyzeTypecheck(program, { rootAbs: ctx.rootAbs, logger, ...(semanticAvailable ? { gildash } : {}) });

          detectorTimings.typecheck = nowMs() - t0;

          logger.debug('detector: complete', {
            detector: detectorKey,
            durationMs: Math.round(detectorTimings.typecheck),
          });

          return r;
        } catch (err) {
          detectorTimings.typecheck = nowMs() - t0;

          const message = err instanceof Error ? err.message : String(err);

          metaErrors.typecheck = message;

          logger.debug('detector: failed', {
            detector: detectorKey,
            durationMs: Math.round(detectorTimings.typecheck),
            message: metaErrors.typecheck,
          });

          return null;
        }
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
      readFileFn: (p: string) => readFileSync(p, 'utf8'),
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

    coupling = analyzeCoupling(dependencies, options.couplingConfig);
    detectorTimings.coupling = nowMs() - t0;

    logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(detectorTimings.coupling) });
  } else {
    coupling = createEmptyCoupling();
  }

  const nestingCfg = config?.features?.nesting;
  const resolvedNestingOptions = {
    maxCognitiveComplexity:
      (typeof nestingCfg === 'object' && nestingCfg !== null ? nestingCfg.maxCognitiveComplexity : undefined) ??
      DEFAULT_NESTING_OPTIONS.maxCognitiveComplexity,
    maxCallbackDepth:
      (typeof nestingCfg === 'object' && nestingCfg !== null ? nestingCfg.maxCallbackDepth : undefined) ??
      DEFAULT_NESTING_OPTIONS.maxCallbackDepth,
    maxPromiseChainDepth:
      (typeof nestingCfg === 'object' && nestingCfg !== null ? nestingCfg.maxPromiseChainDepth : undefined) ??
      DEFAULT_NESTING_OPTIONS.maxPromiseChainDepth,
    maxNestingDepth:
      (typeof nestingCfg === 'object' && nestingCfg !== null ? nestingCfg.maxNestingDepth : undefined) ??
      DEFAULT_NESTING_OPTIONS.maxNestingDepth,
    minDensityLoc:
      (typeof nestingCfg === 'object' && nestingCfg !== null ? nestingCfg.minDensityLoc : undefined) ??
      DEFAULT_NESTING_OPTIONS.minDensityLoc,
    maxDensity:
      (typeof nestingCfg === 'object' && nestingCfg !== null ? nestingCfg.maxDensity : undefined) ??
      DEFAULT_NESTING_OPTIONS.maxDensity,
  };
  let nesting: ReturnType<typeof analyzeNesting>;

  if (options.detectors.includes('nesting')) {
    const t0 = nowMs();
    const detectorKey = 'nesting';

    logger.debug('detector: start', { detector: detectorKey });

    nesting = analyzeNesting(program, resolvedNestingOptions);
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

  let collapsibleIf: ReturnType<typeof analyzeCollapsibleIf>;

  if (options.detectors.includes('collapsible-if')) {
    const t0 = nowMs();
    const detectorKey = 'collapsible-if';

    logger.debug('detector: start', { detector: detectorKey });

    collapsibleIf = analyzeCollapsibleIf(program);

    const durationMs = nowMs() - t0;

    detectorTimings[detectorKey] = durationMs;

    logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(durationMs) });
  } else {
    collapsibleIf = createEmptyCollapsibleIf();
  }

  let errorFlow: Awaited<ReturnType<typeof analyzeErrorFlow>>;

  if (options.detectors.includes('error-flow')) {
    const t0 = nowMs();
    const detectorKey = 'error-flow';

    logger.debug('detector: start', { detector: detectorKey });

    try {
      errorFlow = await analyzeErrorFlow(program, semanticAvailable ? { gildash } : {});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      metaErrors[detectorKey] = message;

      const partial = (err as { partial?: unknown })?.partial;

      if (Array.isArray(partial)) {
        errorFlow = partial as ReadonlyArray<import('../../features/error-flow').ErrorFlowFinding>;
      } else {
        errorFlow = createEmptyErrorFlow();
      }
    }

    const durationMs = nowMs() - t0;

    detectorTimings[detectorKey] = durationMs;

    logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(durationMs) });
  } else {
    errorFlow = createEmptyErrorFlow();
  }

  let indirection: Awaited<ReturnType<typeof analyzeIndirection>>;

  if (options.detectors.includes('indirection')) {
    const t0 = nowMs();
    const detectorKey = 'indirection';

    logger.debug('detector: start', { detector: detectorKey });

    indirection = await analyzeIndirection(
      gildash,
      program,
      { maxForwardDepth: options.maxForwardDepth, crossFileMinDepth: options.crossFileMinDepth ?? 2 },
      ctx.rootAbs,
    );
    detectorTimings.indirection = nowMs() - t0;

    logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(detectorTimings.indirection) });
  } else {
    indirection = createEmptyIndirection();
  }

  const [barrel, lint, typecheck, format] = await Promise.all([
    barrelPromise,
    lintPromise ?? Promise.resolve(createEmptyLint()),
    typecheckPromise,
    formatPromise ?? Promise.resolve(createEmptyFormat()),
  ]);
  const unknownProof = unknownProofResult;

  logger.info('Analysis complete', { durationMs: Math.round(nowMs() - tDetectors0) });

  const defaultFeatureOptions = {
    giantFileMaxLines: 1000,
    variableLifetimeMaxLifetimeLines: 30,
    variableLifetimeMaxLiveVariables: 7,
    variableLifetimeMinFunctionLines: 40,
    variableLifetimeMaxMutationCount: Infinity,
  };
  const { 'giant-file': giantFileCfg, 'variable-lifetime': variableLifetimeCfg } = config?.features ?? {};
  const resolvedGiantFileMaxLines =
    (typeof giantFileCfg === 'object' && giantFileCfg !== null ? giantFileCfg.maxLines : undefined) ??
    defaultFeatureOptions.giantFileMaxLines;
  const resolvedVariableLifetimeMaxLifetimeLines =
    (typeof variableLifetimeCfg === 'object' && variableLifetimeCfg !== null
      ? variableLifetimeCfg.maxLifetimeLines
      : undefined) ?? defaultFeatureOptions.variableLifetimeMaxLifetimeLines;
  const resolvedMaxLiveVariables =
    (typeof variableLifetimeCfg === 'object' && variableLifetimeCfg !== null
      ? variableLifetimeCfg.maxLiveVariables
      : undefined) ?? defaultFeatureOptions.variableLifetimeMaxLiveVariables;
  const resolvedMinFunctionLines =
    (typeof variableLifetimeCfg === 'object' && variableLifetimeCfg !== null
      ? variableLifetimeCfg.minFunctionLines
      : undefined) ?? defaultFeatureOptions.variableLifetimeMinFunctionLines;
  const resolvedMaxMutationCount =
    (typeof variableLifetimeCfg === 'object' && variableLifetimeCfg !== null
      ? variableLifetimeCfg.maxMutationCount
      : undefined) ?? defaultFeatureOptions.variableLifetimeMaxMutationCount;
  let giantFile: ReturnType<typeof analyzeGiantFile> = createEmptyGiantFile();

  if (options.detectors.includes('giant-file')) {
    const t0 = nowMs();
    const detectorKey = 'giant-file';

    logger.debug('detector: start', { detector: detectorKey });

    giantFile = analyzeGiantFile(program, { maxLines: Number(resolvedGiantFileMaxLines) });
    detectorTimings[detectorKey] = nowMs() - t0;

    logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(detectorTimings[detectorKey] ?? 0) });
  }

  let variableLifetime: ReturnType<typeof analyzeVariableLifetime> = createEmptyVariableLifetime();

  if (options.detectors.includes('variable-lifetime')) {
    const t0 = nowMs();
    const detectorKey = 'variable-lifetime';

    logger.debug('detector: start', { detector: detectorKey });

    variableLifetime = analyzeVariableLifetime(program, {
      maxLifetimeLines: Number(resolvedVariableLifetimeMaxLifetimeLines),
      maxLiveVariables: Number(resolvedMaxLiveVariables),
      minFunctionLines: Number(resolvedMinFunctionLines),
      maxMutationCount: resolvedMaxMutationCount,
    });
    detectorTimings[detectorKey] = nowMs() - t0;

    logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(detectorTimings[detectorKey] ?? 0) });
  }

  let temporalCoupling: ReturnType<typeof analyzeTemporalCoupling> = createEmptyTemporalCoupling();

  if (options.detectors.includes('temporal-coupling')) {
    const t0 = nowMs();
    const detectorKey = 'temporal-coupling';

    logger.debug('detector: start', { detector: detectorKey });

    temporalCoupling = analyzeTemporalCoupling(program, { gildash });
    detectorTimings[detectorKey] = nowMs() - t0;

    logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(detectorTimings[detectorKey] ?? 0) });
  }

  let duplicatesUnified: ReturnType<typeof analyzeDuplicates> = createEmptyDuplicates();

  if (options.detectors.includes('duplicates')) {
    const t0 = nowMs();
    const detectorKey = 'duplicates';

    logger.debug('detector: start', { detector: detectorKey });

    duplicatesUnified = analyzeDuplicates(program, { minSize: resolvedMinSize });
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
      };
    });
  };

  const enrichBarrel = (items: ReadonlyArray<any>): ReadonlyArray<any> => {
    const kindToCode: Readonly<Record<BarrelFindingKind, FirebatCatalogCode>> = {
      'export-star': 'BARREL_EXPORT_STAR',
      'deep-import': 'BARREL_DEEP_IMPORT',
      'index-deep-import': 'BARREL_INDEX_DEEP_IMPORT',
      'missing-index': 'BARREL_MISSING_INDEX',
      'invalid-index-statement': 'BARREL_INVALID_INDEX_STMT',
      'barrel-side-effect-import': 'BARREL_SIDE_EFFECT_IMPORT',
      'cross-module-reexport': 'BARREL_CROSS_MODULE_REEXPORT',
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
      'promise-chain-depth': 'NESTING_PROMISE_CHAIN',
      'complexity-density': 'NESTING_COMPLEXITY_DENSITY',
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
      'wrapping-if': 'EARLY_RETURN_WRAPPING_IF',
      'invertible-if-else': 'EARLY_RETURN_INVERTIBLE',
      'cascade-guard': 'EARLY_RETURN_CASCADE_GUARD',
      'implicit-else': 'EARLY_RETURN_IMPLICIT_ELSE',
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

  const enrichCollapsibleIf = (items: ReadonlyArray<any>): ReadonlyArray<any> => {
    const kindToCode = {
      'collapsible-if': 'COLLAPSIBLE_IF',
      'collapsible-else-if': 'COLLAPSIBLE_ELSE_IF',
    } as const satisfies Record<string, FirebatCatalogCode>;

    return items.map(item => {
      const filePath = String(item?.filePath ?? item?.file ?? '');
      const kind = String(item?.kind ?? 'collapsible-if');
      const code = kindToCode[kind as keyof typeof kindToCode] ?? 'COLLAPSIBLE_IF';

      return {
        ...item,
        code,
        file: filePath.length > 0 ? toProjectRelative(filePath) : filePath,
      };
    });
  };

  const enrichErrorFlow = (items: ReadonlyArray<any>): ReadonlyArray<any> => {
    const kindToCode: Record<Exclude<ErrorFlowFindingKind, 'tool-unavailable'>, FirebatCatalogCode> = {
      'throw-non-error': 'EF_THROW_NON_ERROR',
      'promise-constructor-hygiene': 'EF_PROMISE_CONSTRUCTOR_HYGIENE',
      'missing-error-cause': 'EF_MISSING_ERROR_CAUSE',
      'useless-catch': 'EF_USELESS_CATCH',
      'unsafe-finally': 'EF_UNSAFE_FINALLY',
      'return-await-in-try': 'EF_RETURN_AWAIT_IN_TRY',
      'prefer-catch': 'EF_PREFER_DOT_CATCH_CATCH',
      'prefer-await-to-then': 'EF_PREFER_DOT_CATCH_AWAIT',
      'no-return-wrap': 'EF_PREFER_DOT_CATCH_NO_WRAP',
      'floating-promises': 'EF_UNOBSERVED_PROMISE_FLOATING',
      'catch-or-return': 'EF_UNOBSERVED_PROMISE_CATCH_OR_RETURN',
      'misused-promises': 'EF_UNOBSERVED_PROMISE_MISUSED',
      'unobserved-variable': 'EF_UNOBSERVED_PROMISE_VARIABLE',
      'always-return': 'EF_UNOBSERVED_PROMISE_ALWAYS_RETURN',
      'no-callback-in-promise': 'EF_UNOBSERVED_PROMISE_CALLBACK_IN_PROMISE',
    };

    return items
      .filter((item: any) => item?.kind !== 'tool-unavailable')
      .map(item => {
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
      'unknown-type': 'UNKNOWN_UNNARROWED',
      'unknown-inferred': 'UNKNOWN_INFERRED',
      'any-inferred': 'UNKNOWN_ANY_INFERRED',
      'any-cast': 'UNKNOWN_ANY_CAST',
      'double-cast': 'UNKNOWN_DOUBLE_CAST',
    };

    return items
      .filter((item: any) => item?.kind !== 'tool-unavailable')
      .map(item => {
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

  const enrichIndirection = (items: ReadonlyArray<any>): ReadonlyArray<any> => {
    const kindToCode: Readonly<Record<IndirectionFindingKind, FirebatCatalogCode>> = {
      'thin-wrapper': 'IND_THIN_WRAPPER',
      'forward-chain': 'IND_FORWARD_CHAIN',
      'cross-file-forwarding-chain': 'IND_CROSS_FILE_CHAIN',
      'type-remap': 'IND_TYPE_REMAP',
      'interface-rewrap': 'IND_INTERFACE_REWRAP',
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

  const enrichDependencies = (value: any): ReadonlyArray<any> => {
    const zeroSpan = { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } };
    const deadExports = Array.isArray(value?.deadExports) ? value.deadExports : [];
    const layerViolations = Array.isArray(value?.layerViolations) ? value.layerViolations : [];
    const cycles = Array.isArray(value?.cycles) ? value.cycles : [];
    const cuts = Array.isArray(value?.edgeCutHints) ? value.edgeCutHints : Array.isArray(value?.cuts) ? value.cuts : [];
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
      const bestCut = cuts.find((h: any) => pathModules.includes(h?.from) && pathModules.includes(h?.to));

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

    const unusedFiles = Array.isArray(value?.unusedFiles) ? value.unusedFiles : [];

    for (const u of unusedFiles) {
      const module = String(u?.module ?? '');

      findings.push({
        kind: 'unused-file',
        code: 'DEP_UNUSED_FILE',
        file: module,
        span: zeroSpan,
        module,
      });
    }

    const unusedDeps = Array.isArray(value?.unusedDeps) ? value.unusedDeps : [];

    for (const u of unusedDeps) {
      const kind = String(u?.kind ?? 'unused-dependency');
      const code = kind === 'unlisted-dependency' ? 'DEP_UNLISTED_DEPENDENCY' : 'DEP_UNUSED_DEPENDENCY';

      findings.push({
        kind,
        code,
        file: String(u?.files?.[0] ?? ''),
        span: zeroSpan,
        packageName: String(u?.packageName ?? ''),
        files: Array.isArray(u?.files) ? u.files : [],
      });
    }

    const unresolvedImports = Array.isArray(value?.unresolvedImports) ? value.unresolvedImports : [];

    for (const u of unresolvedImports) {
      const module = String(u?.module ?? '');

      findings.push({
        kind: 'unresolved-import',
        code: 'DEP_UNRESOLVED_IMPORT',
        file: module,
        span: zeroSpan,
        module,
        specifier: String(u?.specifier ?? ''),
      });
    }

    const duplicateExports = Array.isArray(value?.duplicateExports) ? value.duplicateExports : [];

    for (const d of duplicateExports) {
      const modules = Array.isArray(d?.modules) ? d.modules : [];

      findings.push({
        kind: 'duplicate-export',
        code: 'DEP_DUPLICATE_EXPORT',
        file: String(modules[0] ?? ''),
        span: zeroSpan,
        name: String(d?.name ?? ''),
        modules,
      });
    }

    const unusedMembers = Array.isArray(value?.unusedMembers) ? value.unusedMembers : [];
    const memberKindToCode: Record<string, FirebatCatalogCode> = {
      'unused-enum-member': 'DEP_UNUSED_ENUM_MEMBER',
      'unused-ns-export': 'DEP_UNUSED_NS_EXPORT',
      'unused-ns-member': 'DEP_UNUSED_NS_MEMBER',
    };

    for (const m of unusedMembers) {
      const kind = String(m?.kind ?? 'unused-enum-member');
      const code = memberKindToCode[kind] ?? 'DEP_UNUSED_ENUM_MEMBER';

      findings.push({
        kind,
        code,
        file: String(m?.module ?? ''),
        span: zeroSpan,
        module: String(m?.module ?? ''),
        symbolName: String(m?.symbolName ?? ''),
        memberName: String(m?.memberName ?? ''),
      });
    }

    return findings;
  };

  const enrichDuplicateGroups = (groups: ReadonlyArray<any>): ReadonlyArray<any> => {
    const kindToCode: Readonly<Record<DuplicateCloneType, FirebatCatalogCode>> = {
      exact: 'DUP_EXACT',
      shape: 'DUP_SHAPE',
      normalized: 'DUP_NORMALIZED',
      'near-miss': 'DUP_NEAR_MISS',
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

  const zeroSpan = { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } };

  const enrichPhase1 = <T extends { readonly file?: string; readonly filePath?: string; readonly span?: unknown }>(
    items: ReadonlyArray<T>,
    code: FirebatCatalogCode,
  ): ReadonlyArray<T & { readonly code: FirebatCatalogCode; readonly file: string; readonly span: unknown }> =>
    items.map(item => {
      const filePath = String(item.file ?? item.filePath ?? '');

      return {
        ...item,
        code,
        file: filePath.length > 0 ? toProjectRelative(filePath) : filePath,
        span: item.span ?? zeroSpan,
      };
    });

  const enrichVariableLifetime = (
    findings: ReadonlyArray<VariableLifetimeFinding | ScopeNarrowingFinding | LivenessPressureFinding | MutationDensityFinding>,
  ): ReadonlyArray<VariableLifetimeFinding | ScopeNarrowingFinding | LivenessPressureFinding | MutationDensityFinding> =>
    findings.map(f => ({
      ...f,
      code: (f.kind === 'scope-narrowing'
        ? 'LIFETIME_SCOPE_NARROWING'
        : f.kind === 'liveness-pressure'
          ? 'LIFETIME_LIVENESS_PRESSURE'
          : f.kind === 'mutation-density'
            ? 'LIFETIME_MUTATION_DENSITY'
            : 'VAR_LIFETIME') as FirebatCatalogCode,
      file: f.file.length > 0 ? toProjectRelative(f.file) : f.file,
      span: f.span,
    }));

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
            const subCode = (sub as Record<string, unknown>)?.code ?? (sub as Record<string, unknown>)?.catalogCode;

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
    ...(selectedDetectors.has('waste') ? { waste: enrichWaste(waste) } : {}),
    ...(selectedDetectors.has('barrel') ? { barrel: enrichBarrel(barrel) } : {}),
    ...(selectedDetectors.has('unknown-proof') ? { 'unknown-proof': enrichUnknownProof(unknownProof) } : {}),
    ...(selectedDetectors.has('error-flow') ? { 'error-flow': enrichErrorFlow(errorFlow) } : {}),
    ...(selectedDetectors.has('format') && format !== null ? { format: enrichFormat(format) } : {}),
    ...(selectedDetectors.has('lint') && lint !== null ? { lint: enrichLint(lint) } : {}),
    ...(selectedDetectors.has('typecheck') && typecheck !== null ? { typecheck: enrichTypecheck(typecheck) } : {}),
    ...(selectedDetectors.has('dependencies') ? { dependencies: enrichDependencies(dependencies) } : {}),
    ...(selectedDetectors.has('coupling') ? { coupling: enrichCoupling(coupling) } : {}),
    ...(selectedDetectors.has('nesting') ? { nesting: enrichNesting(nesting) } : {}),
    ...(selectedDetectors.has('early-return') ? { 'early-return': enrichEarlyReturn(earlyReturn) } : {}),
    ...(selectedDetectors.has('collapsible-if') ? { 'collapsible-if': enrichCollapsibleIf(collapsibleIf) } : {}),
    ...(selectedDetectors.has('indirection') ? { indirection: enrichIndirection(indirection) } : {}),
    ...(selectedDetectors.has('giant-file') ? { 'giant-file': enrichPhase1(giantFile, 'GIANT_FILE') } : {}),
    ...(selectedDetectors.has('variable-lifetime')
      ? { 'variable-lifetime': enrichVariableLifetime(variableLifetime) }
      : {}),
    ...(selectedDetectors.has('temporal-coupling')
      ? { 'temporal-coupling': enrichPhase1(temporalCoupling, 'TEMPORAL_COUPLING') }
      : {}),
    ...(selectedDetectors.has('duplicates') ? { duplicates: enrichDuplicateGroups(duplicatesUnified) } : {}),
  };
  const diagnostics = aggregateDiagnostics({ analyses: analyses as Readonly<Record<string, unknown>> });
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

  await gildash.close({ cleanup: false });

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
