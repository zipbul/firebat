// MUST: MUST-1
import * as path from 'node:path';

import type { FirebatCliOptions } from '../../interfaces';
import type { FirebatLogger } from '../../ports/logger';
import type { FirebatReport } from '../../types';

import { computeAutoMinSize } from '../../engine/auto-min-size';
import { initHasher } from '../../engine/hasher';
import { analyzeApiDrift, createEmptyApiDrift } from '../../features/api-drift';
import { analyzeBarrelPolicy, createEmptyBarrelPolicy } from '../../features/barrel-policy';
import { analyzeCoupling, createEmptyCoupling } from '../../features/coupling';
import { analyzeDependencies, createEmptyDependencies } from '../../features/dependencies';
import { analyzeEarlyReturn, createEmptyEarlyReturn } from '../../features/early-return';
import { detectExactDuplicates } from '../../features/exact-duplicates';
import { analyzeExceptionHygiene, createEmptyExceptionHygiene } from '../../features/exception-hygiene';
import { analyzeFormat, createEmptyFormat } from '../../features/format';
import { analyzeForwarding, createEmptyForwarding } from '../../features/forwarding';
import { analyzeLint, createEmptyLint } from '../../features/lint';
import { analyzeNesting, createEmptyNesting } from '../../features/nesting';
import { analyzeNoop, createEmptyNoop } from '../../features/noop';
import { analyzeStructuralDuplicates, createEmptyStructuralDuplicates } from '../../features/structural-duplicates';
import { analyzeTypecheck, createEmptyTypecheck } from '../../features/typecheck';
import { analyzeUnknownProof, createEmptyUnknownProof } from '../../features/unknown-proof';
import { detectWaste } from '../../features/waste';
import { createHybridArtifactRepository } from '../../infrastructure/hybrid/artifact.repository';
import { createHybridFileIndexRepository } from '../../infrastructure/hybrid/file-index.repository';
import { createInMemoryArtifactRepository } from '../../infrastructure/memory/artifact.repository';
import { createInMemoryFileIndexRepository } from '../../infrastructure/memory/file-index.repository';
import { createSqliteArtifactRepository } from '../../infrastructure/sqlite/artifact.repository';
import { createSqliteFileIndexRepository } from '../../infrastructure/sqlite/file-index.repository';
import { getOrmDb } from '../../infrastructure/sqlite/firebat.db';
import { resolveRuntimeContextFromCwd } from '../../runtime-context';
import { computeToolVersion } from '../../tool-version';
import { createFirebatProgram } from '../../ts-program';
import { indexTargets } from '../indexing/file-indexer';
import { computeProjectKey, computeScanArtifactKey } from './cache-keys';
import { computeCacheNamespace } from './cache-namespace';
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
  readonly artifactRepository: ReturnType<typeof createHybridArtifactRepository>;
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
  const cached = await params.artifactRepository.getArtifact<FirebatReport>({
    projectKey: params.projectKey,
    kind: 'firebat:report',
    artifactKey: params.artifactKey,
    inputsDigest: params.inputsDigest,
  });

  if (cached) {
    params.logger.info('Cache hit — skipping analysis', { durationMs: Math.round(nowMs() - tCache0) });
    params.logger.info('Analysis complete', { durationMs: 0 });

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

  const toolVersion = computeToolVersion();

  logger.trace('Tool version', { version: toolVersion });

  const projectKey = computeProjectKey({ toolVersion, cwd: ctx.rootAbs });

  logger.trace('Project key computed', { projectKey });

  const tDb0 = nowMs();
  const orm = await getOrmDb({ rootAbs: ctx.rootAbs, logger });

  logger.trace('ORM DB ready', { durationMs: Math.round(nowMs() - tDb0) });

  const artifactRepository = createHybridArtifactRepository({
    memory: createInMemoryArtifactRepository(),
    sqlite: createSqliteArtifactRepository(orm),
  });
  const fileIndexRepository = createHybridFileIndexRepository({
    memory: createInMemoryFileIndexRepository(),
    sqlite: createSqliteFileIndexRepository(orm),
  });

  logger.trace('Repositories created (hybrid: memory + sqlite)');

  const tIndex0 = nowMs();

  await indexTargets({
    projectKey,
    targets: options.targets,
    repository: fileIndexRepository,
    concurrency: 8,
    logger,
  });

  logger.info('Indexing complete', { targetCount: options.targets.length, durationMs: Math.round(nowMs() - tIndex0) });

  const tNamespace0 = nowMs();
  const cacheNamespace = await computeCacheNamespace({ toolVersion });

  logger.trace('Cache namespace computed', { cacheNamespace, durationMs: Math.round(nowMs() - tNamespace0) });

  const tProjectDigest0 = nowMs();
  const projectInputsDigest = await computeProjectInputsDigest({
    projectKey,
    rootAbs: ctx.rootAbs,
    fileIndexRepository,
  });

  logger.trace('Project inputs digest computed', { projectInputsDigest, durationMs: Math.round(nowMs() - tProjectDigest0) });

  const tInputsDigest0 = nowMs();
  const inputsDigest = await computeInputsDigest({
    projectKey,
    targets: options.targets,
    fileIndexRepository,
    extraParts: [`ns:${cacheNamespace}`, `project:${projectInputsDigest}`],
  });

  logger.trace('Inputs digest computed', { inputsDigest, durationMs: Math.round(nowMs() - tInputsDigest0) });

  const artifactKey = computeScanArtifactKey({
    detectors: options.detectors,
    minSize: options.minSize === 'auto' ? 'auto' : String(options.minSize),
    maxForwardDepth: options.maxForwardDepth,
    ...(options.detectors.includes('waste') ? { wasteMemoryRetentionThreshold: options.wasteMemoryRetentionThreshold } : {}),
    ...(options.detectors.includes('unknown-proof')
      ? { unknownProofBoundaryGlobs: options.unknownProofBoundaryGlobs ?? [] }
      : {}),
    ...(options.detectors.includes('barrel-policy') ? { barrelPolicyIgnoreGlobs: options.barrelPolicyIgnoreGlobs ?? [] } : {}),
    ...((options.detectors.includes('dependencies') || options.detectors.includes('coupling'))
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

  let formatPromise: Promise<FormatResult> | null = null;
  let lintPromise: Promise<LintResult> | null = null;
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
            ...(oxfmtConfigPath !== undefined ? { configPath: oxfmtConfigPath } : {}),
            logger,
          })
        : Promise.resolve(createEmptyFormat()),
      shouldRunLint
        ? analyzeLint({
            targets: options.targets,
            fix: true,
            cwd: ctx.rootAbs,
            ...(oxlintConfigPath !== undefined ? { configPath: oxlintConfigPath } : {}),
            logger,
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
            ...(oxfmtConfigPath !== undefined ? { configPath: oxfmtConfigPath } : {}),
            logger,
          }),
        )
        .then(r => {
          fixTimings.format = nowMs() - tFormat0;

          logger.debug('format: complete', { durationMs: Math.round(fixTimings.format) });

          return r;
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
            ...(oxlintConfigPath !== undefined ? { configPath: oxlintConfigPath } : {}),
            logger,
          }),
        )
        .then(r => {
          fixTimings.lint = nowMs() - tLint0;

          logger.debug('lint: complete', { durationMs: Math.round(fixTimings.lint) });

          return r;
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
        }).then(r => {
          const durationMs = nowMs() - t0;

          detectorTimings[detectorKey] = durationMs;

          logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(durationMs) });

          return r;
        });
      })()
    : Promise.resolve(createEmptyUnknownProof());
  const typecheckPromise = options.detectors.includes('typecheck')
    ? ((): Promise<TypecheckResult> => {
        const t0 = nowMs();
        const detectorKey = 'typecheck';

        logger.info('detector: start', { detector: detectorKey });

        return analyzeTypecheck(program, { rootAbs: ctx.rootAbs, logger }).then(r => {
          detectorTimings.typecheck = nowMs() - t0;

          logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(detectorTimings.typecheck) });

          return r;
        });
      })()
    : Promise.resolve(createEmptyTypecheck());
  const shouldRunDependencies = options.detectors.includes('dependencies') || options.detectors.includes('coupling');
  let dependencies: ReturnType<typeof analyzeDependencies>;

  if (shouldRunDependencies) {
    const t0 = nowMs();
    const detectorKey = 'dependencies';

    logger.debug('detector: start', { detector: detectorKey });

    dependencies = analyzeDependencies(program, {
      rootAbs: ctx.rootAbs,
      layers: options.dependenciesLayers,
      allowedDependencies: options.dependenciesAllowedDependencies,
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

  if (options.detectors.includes('exception-hygiene')) {
    const t0 = nowMs();
    const detectorKey = 'exception-hygiene';

    logger.debug('detector: start', { detector: detectorKey });

    exceptionHygiene = analyzeExceptionHygiene(program);

    const durationMs = nowMs() - t0;

    detectorTimings[detectorKey] = durationMs;

    logger.debug('detector: complete', { detector: detectorKey, durationMs: Math.round(durationMs) });
  } else {
    exceptionHygiene = createEmptyExceptionHygiene();
  }

  const includeNoopEmptyCatch = shouldIncludeNoopEmptyCatch({
    exceptionHygieneSelected: options.detectors.includes('exception-hygiene'),
    exceptionHygieneStatus: exceptionHygiene.status,
  });
  let noop: ReturnType<typeof analyzeNoop>;

  if (options.detectors.includes('noop')) {
    const t0 = nowMs();
    const detectorKey = 'noop';

    logger.debug('detector: start', { detector: detectorKey });

    noop = analyzeNoop(program);

    if (!includeNoopEmptyCatch) {
      noop = {
        ...noop,
        findings: noop.findings.filter(f => f.kind !== 'empty-catch'),
      };
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

  const selectedDetectors = new Set(options.detectors);
  const report: FirebatReport = {
    meta: {
      engine: 'oxc',
      targetCount: program.length,
      minSize: resolvedMinSize,
      maxForwardDepth: options.maxForwardDepth,
      detectors: options.detectors,
      detectorTimings: { ...detectorTimings, ...fixTimings },
    },
    analyses: {
      ...(selectedDetectors.has('exact-duplicates') ? { 'exact-duplicates': exactDuplicates } : {}),
      ...(selectedDetectors.has('waste') ? { waste: waste } : {}),
      ...(selectedDetectors.has('barrel-policy') ? { 'barrel-policy': barrelPolicy } : {}),
      ...(selectedDetectors.has('unknown-proof') ? { 'unknown-proof': unknownProof } : {}),
      ...(selectedDetectors.has('exception-hygiene') ? { 'exception-hygiene': exceptionHygiene } : {}),
      ...(selectedDetectors.has('format') ? { format: format } : {}),
      ...(selectedDetectors.has('lint') ? { lint: lint } : {}),
      ...(selectedDetectors.has('typecheck') ? { typecheck: typecheck } : {}),
      ...(selectedDetectors.has('dependencies') ? { dependencies: dependencies } : {}),
      ...(selectedDetectors.has('coupling') ? { coupling: coupling } : {}),
      ...(selectedDetectors.has('structural-duplicates') ? { 'structural-duplicates': structuralDuplicates } : {}),
      ...(selectedDetectors.has('nesting') ? { nesting: nesting } : {}),
      ...(selectedDetectors.has('early-return') ? { 'early-return': earlyReturn } : {}),
      ...(selectedDetectors.has('noop') ? { noop: noop } : {}),
      ...(selectedDetectors.has('api-drift') ? { 'api-drift': apiDrift } : {}),
      ...(selectedDetectors.has('forwarding') ? { forwarding: forwarding } : {}),
    },
  };

  if (allowCache) {
    const tSave0 = nowMs();

    await artifactRepository.setArtifact({
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
