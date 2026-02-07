// MUST: MUST-1
import type { FirebatCliOptions } from '../../interfaces';
import type { FirebatReport } from '../../types';

import { analyzeApiDrift, createEmptyApiDrift } from '../../features/api-drift';
import { analyzeBarrelPolicy, createEmptyBarrelPolicy } from '../../features/barrel-policy';
import { analyzeCoupling, createEmptyCoupling } from '../../features/coupling';
import { analyzeDependencies, createEmptyDependencies } from '../../features/dependencies';
import { analyzeStructuralDuplicates, createEmptyStructuralDuplicates } from '../../features/structural-duplicates';
import { analyzeEarlyReturn, createEmptyEarlyReturn } from '../../features/early-return';
import { analyzeForwarding, createEmptyForwarding } from '../../features/forwarding';
import { analyzeFormat, createEmptyFormat } from '../../features/format';
import { analyzeLint, createEmptyLint } from '../../features/lint';
import { analyzeNesting, createEmptyNesting } from '../../features/nesting';
import { analyzeNoop, createEmptyNoop } from '../../features/noop';
import { analyzeTypecheck, createEmptyTypecheck } from '../../features/typecheck';
import { analyzeUnknownProof, createEmptyUnknownProof } from '../../features/unknown-proof';
import { detectExactDuplicates } from '../../features/exact-duplicates';
import { detectWaste } from '../../features/waste';
import { computeAutoMinSize } from '../../engine/auto-min-size';
import { initHasher } from '../../engine/hasher';
import { createFirebatProgram } from '../../ts-program';
import { getOrmDb } from '../../infrastructure/sqlite/firebat.db';
import { resolveRuntimeContextFromCwd } from '../../runtime-context';
import { computeToolVersion } from '../../tool-version';
import { createSqliteArtifactRepository } from '../../infrastructure/sqlite/artifact.repository';
import { createSqliteFileIndexRepository } from '../../infrastructure/sqlite/file-index.repository';
import { createInMemoryArtifactRepository } from '../../infrastructure/memory/artifact.repository';
import { createInMemoryFileIndexRepository } from '../../infrastructure/memory/file-index.repository';
import { createHybridArtifactRepository } from '../../infrastructure/hybrid/artifact.repository';
import { createHybridFileIndexRepository } from '../../infrastructure/hybrid/file-index.repository';
import { indexTargets } from '../indexing/file-indexer';
import { computeInputsDigest } from './inputs-digest';
import { computeProjectKey, computeScanArtifactKey } from './cache-keys';
import { computeCacheNamespace } from './cache-namespace';
import { computeProjectInputsDigest } from './project-inputs-digest';

const scanUseCase = async (options: FirebatCliOptions): Promise<FirebatReport> => {
  await initHasher();

  const ctx = await resolveRuntimeContextFromCwd();
  const toolVersion = computeToolVersion();
  const projectKey = computeProjectKey({ toolVersion, cwd: ctx.rootAbs });
  const orm = await getOrmDb({ rootAbs: ctx.rootAbs });
  const artifactRepository = createHybridArtifactRepository({
    memory: createInMemoryArtifactRepository(),
    sqlite: createSqliteArtifactRepository(orm),
  });
  const fileIndexRepository = createHybridFileIndexRepository({
    memory: createInMemoryFileIndexRepository(),
    sqlite: createSqliteFileIndexRepository(orm),
  });

  await indexTargets({
    projectKey,
    targets: options.targets,
    repository: fileIndexRepository,
    concurrency: 8,
  });

  const cacheNamespace = await computeCacheNamespace({ toolVersion });
  const projectInputsDigest = await computeProjectInputsDigest({
    projectKey,
    rootAbs: ctx.rootAbs,
    fileIndexRepository,
  });

  const inputsDigest = await computeInputsDigest({
    projectKey,
    targets: options.targets,
    fileIndexRepository,
    extraParts: [`ns:${cacheNamespace}`, `project:${projectInputsDigest}`],
  });
  const artifactKey = computeScanArtifactKey({
    detectors: options.detectors,
    minSize: options.minSize === 'auto' ? 'auto' : String(options.minSize),
    maxForwardDepth: options.maxForwardDepth,
    ...(options.detectors.includes('unknown-proof')
      ? { unknownProofBoundaryGlobs: options.unknownProofBoundaryGlobs ?? [] }
      : {}),
    ...(options.detectors.includes('barrel-policy')
      ? { barrelPolicyIgnoreGlobs: options.barrelPolicyIgnoreGlobs ?? [] }
      : {}),
  });

  const allowCache = options.fix === false;

  if (allowCache) {
    const cached = await artifactRepository.getArtifact<FirebatReport>({
      projectKey,
      kind: 'firebat:report',
      artifactKey,
      inputsDigest,
    });

    if (cached) {
      return cached;
    }
  }

  // Note: in fix mode, prefer to run fixable tools before parsing the program
  // so the report reflects post-fix state.
  const shouldRunFormat = options.detectors.includes('format');
  const shouldRunLint = options.detectors.includes('lint');

  let formatPromise: Promise<ReturnType<typeof createEmptyFormat>> | Promise<any> | null = null;
  let lintPromise: Promise<ReturnType<typeof createEmptyLint>> | Promise<any> | null = null;

  if (options.fix) {
    const [format, lint] = await Promise.all([
      shouldRunFormat
        ? analyzeFormat({
            targets: options.targets,
            fix: true,
            ...(options.configPath !== undefined ? { configPath: options.configPath } : {}),
          })
        : Promise.resolve(createEmptyFormat()),
      shouldRunLint ? analyzeLint({ targets: options.targets, fix: true }) : Promise.resolve(createEmptyLint()),
    ]);

    formatPromise = Promise.resolve(format);
    lintPromise = Promise.resolve(lint);
  } else {
    if (shouldRunFormat) {
      formatPromise = analyzeFormat({
        targets: options.targets,
        fix: false,
        ...(options.configPath !== undefined ? { configPath: options.configPath } : {}),
      });
    }

    if (shouldRunLint) {
      lintPromise = analyzeLint({ targets: options.targets, fix: false });
    }
  }

  const program = await createFirebatProgram({
    targets: options.targets,
  });
  const resolvedMinSize =
    options.minSize === 'auto' ? computeAutoMinSize(program) : Math.max(0, Math.round(options.minSize));
  const exactDuplicates = options.detectors.includes('exact-duplicates') ? detectExactDuplicates(program, resolvedMinSize) : [];
  const waste = options.detectors.includes('waste') ? detectWaste(program) : [];
  const barrelPolicyPromise = options.detectors.includes('barrel-policy')
    ? analyzeBarrelPolicy(program, {
        rootAbs: ctx.rootAbs,
        ...(options.barrelPolicyIgnoreGlobs !== undefined ? { ignoreGlobs: options.barrelPolicyIgnoreGlobs } : {}),
      })
    : Promise.resolve(createEmptyBarrelPolicy());
  const unknownProofPromise = options.detectors.includes('unknown-proof')
    ? analyzeUnknownProof(program, {
        rootAbs: ctx.rootAbs,
        ...(options.unknownProofBoundaryGlobs !== undefined ? { boundaryGlobs: options.unknownProofBoundaryGlobs } : {}),
      })
    : Promise.resolve(createEmptyUnknownProof());

  const typecheckPromise = options.detectors.includes('typecheck') ? analyzeTypecheck(program) : Promise.resolve(createEmptyTypecheck());
  const shouldRunDependencies = options.detectors.includes('dependencies') || options.detectors.includes('coupling');
  const dependencies = shouldRunDependencies ? analyzeDependencies(program) : createEmptyDependencies();
  const coupling = options.detectors.includes('coupling') ? analyzeCoupling(dependencies) : createEmptyCoupling();
  const structuralDuplicates = options.detectors.includes('structural-duplicates')
    ? analyzeStructuralDuplicates(program, resolvedMinSize)
    : createEmptyStructuralDuplicates();
  const nesting = options.detectors.includes('nesting') ? analyzeNesting(program) : createEmptyNesting();
  const earlyReturn = options.detectors.includes('early-return') ? analyzeEarlyReturn(program) : createEmptyEarlyReturn();
  const noop = options.detectors.includes('noop') ? analyzeNoop(program) : createEmptyNoop();
  const apiDrift = options.detectors.includes('api-drift') ? analyzeApiDrift(program) : createEmptyApiDrift();
  const forwarding = options.detectors.includes('forwarding')
    ? analyzeForwarding(program, options.maxForwardDepth)
    : createEmptyForwarding();

  const [barrelPolicy, unknownProof, lint, typecheck, format] = await Promise.all([
    barrelPolicyPromise,
    unknownProofPromise,
    lintPromise ?? Promise.resolve(createEmptyLint()),
    typecheckPromise,
    formatPromise ?? Promise.resolve(createEmptyFormat()),
  ]);

  const report: FirebatReport = {
    meta: {
      engine: 'oxc',
      version: toolVersion,
      targetCount: program.length,
      minSize: resolvedMinSize,
      maxForwardDepth: options.maxForwardDepth,
      detectors: options.detectors,
    },
    analyses: {
      'exact-duplicates': exactDuplicates,
      waste,
      barrelPolicy,
      unknownProof,
      format,
      lint,
      typecheck,
      dependencies,
      coupling,
      'structural-duplicates': structuralDuplicates,
      nesting,
      earlyReturn,
      noop,
      apiDrift,
      forwarding,
    },
  };

  if (allowCache) {
    await artifactRepository.setArtifact({
      projectKey,
      kind: 'firebat:report',
      artifactKey,
      inputsDigest,
      value: report,
    });
  }

  return report;
};


export { scanUseCase };
