// MUST: MUST-1
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import type { FirebatCliOptions } from '../..';
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
  VariableLifetimeFinding,
  WasteKind,
} from '../..';
import type { ErrorFlowFindingKind } from '../../features/error-flow';
import type { FirebatLogger } from '../../shared';

import { computeAutoMinSize } from '../../engine';
import { getGildashSemanticContext, setGildashSemanticContext } from '../../engine/dataflow/gildash-binding-source';
import { analyzeBarrel, createEmptyBarrel } from '../../features/barrel';
import { analyzeCollapsibleIf, createEmptyCollapsibleIf } from '../../features/collapsible-if';
import { analyzeCoupling, createEmptyCoupling, pickCouplingKind } from '../../features/coupling';
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
import { analyzeVariableLifetime, createEmptyVariableLifetime } from '../../features/variable-lifetime';
import { detectWaste } from '../../features/waste';
import { getDb } from '../../infrastructure/sqlite/firebat.db';
import {
  createFirebatProgram,
  featureOptions,
  loadFirebatConfigFile,
  computeToolVersion,
  resolveRuntimeContextFromCwd,
} from '../../shared';
import { toErrorMessage } from '../../shared/error-message';
import { ZERO_SPAN } from '../../shared/source-span';
import { toProjectRelative as toProjectRelativePath } from '../../shared/to-project-relative';
import { createArtifactStore, createGildash } from '../../store';
import { computeProjectKey, computeScanArtifactKey } from './cache-keys';
import { computeCacheNamespace } from './cache-namespace';
import { aggregateDiagnostics, FIREBAT_CODE_CATALOG } from './diagnostic-aggregator';
import { itemFileString } from './finding-item-fields';
import { buildFunctionRangeMap, flattenToFindings } from './flatten-findings';
import { computeInputsDigest } from './inputs-digest';
import { computeProjectInputsDigest } from './project-inputs-digest';

const nowMs = (): number => {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
};

interface DetectorRunCtx {
  readonly logger: FirebatLogger;
  readonly timings: Record<string, number>;
}

/**
 * 단일 detector 실행의 공통 골격: 비활성 시 빈 결과 반환, 활성 시 start/complete 로깅과
 * 소요시간 기록을 감싼다. 각 detector IIFE에 흩어져 있던 동일한 결정(타이밍·로깅 규약)의
 * 단일 변경지점.
 */
// start 로깅 후 시작 시각을 돌려준다. sync/async runner 공용.
const beginDetector = (ctx: DetectorRunCtx, detector: string): number => {
  ctx.logger.debug('detector: start', { detector });

  return nowMs();
};

// 소요시간을 기록하고 complete를 로깅한다. sync/async runner 공용.
const finishDetector = (ctx: DetectorRunCtx, detector: string, t0: number): void => {
  const durationMs = nowMs() - t0;

  ctx.timings[detector] = durationMs;

  ctx.logger.debug('detector: complete', { detector, durationMs: Math.round(durationMs) });
};

const runDetector = <T>(ctx: DetectorRunCtx, detector: string, enabled: boolean, empty: () => T, run: () => T): T => {
  if (!enabled) {
    return empty();
  }

  const t0 = beginDetector(ctx, detector);
  const result = run();

  finishDetector(ctx, detector, t0);

  return result;
};

/** runDetector의 async 변형: run이 Promise를 반환하며 타이밍은 완료 후 기록한다. */
const runDetectorAsync = async <T>(
  ctx: DetectorRunCtx,
  detector: string,
  enabled: boolean,
  empty: () => T,
  run: () => Promise<T>,
): Promise<T> => {
  if (!enabled) {
    return empty();
  }

  const t0 = beginDetector(ctx, detector);
  const result = await run();

  finishDetector(ctx, detector, t0);

  return result;
};

const resolveToolRcPath = async (rootAbs: string, basename: string): Promise<string | undefined> => {
  const candidate = path.join(rootAbs, basename);
  let exists: boolean;

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

type FirebatConfig = Awaited<ReturnType<typeof loadFirebatConfigFile>>['config'];

const loadConfig = async (
  rootAbs: string,
  configPath: string | undefined,
  logger: FirebatLogger,
): Promise<{ config: FirebatConfig | null; configError: string | null }> => {
  try {
    const loaded = await loadFirebatConfigFile({
      rootAbs,
      ...(configPath ? { configPath } : {}),
    });

    if (loaded.exists) {
      logger.trace('Config loaded', { resolvedPath: loaded.resolvedPath });
    }

    return { config: loaded.config, configError: null };
  } catch (err) {
    return { config: null, configError: toErrorMessage(err) };
  }
};

interface CreateGildashInstanceParams {
  readonly rootAbs: string;
  readonly needsSemantic: boolean;
  readonly exclude: FirebatCliOptions['exclude'];
  readonly logger: FirebatLogger;
}

interface CreateGildashInstanceResult {
  readonly gildash: Awaited<ReturnType<typeof createGildash>>;
  readonly semanticAvailable: boolean;
}

const createGildashInstance = async (params: CreateGildashInstanceParams): Promise<CreateGildashInstanceResult> => {
  const gildashIgnore = params.exclude ? { ignorePatterns: [...params.exclude] } : {};

  if (!params.needsSemantic) {
    const gildash = await createGildash({ projectRoot: params.rootAbs, watchMode: false, ...gildashIgnore });

    return { gildash, semanticAvailable: false };
  }

  try {
    const gildash = await createGildash({ projectRoot: params.rootAbs, watchMode: false, semantic: true, ...gildashIgnore });

    return { gildash, semanticAvailable: true };
  } catch {
    params.logger.warn('Semantic init failed, falling back to AST-only');

    const gildash = await createGildash({ projectRoot: params.rootAbs, watchMode: false, ...gildashIgnore });

    return { gildash, semanticAvailable: false };
  }
};

// ── Module-scope enrich helpers ────────────────────────────────────────────────

type ToProjectRelative = (filePath: string) => string;

const WASTE_KIND_TO_CODE: Readonly<Record<WasteKind, FirebatCatalogCode>> = {
  'dead-store': 'WASTE_DEAD_STORE',
  'dead-store-overwrite': 'WASTE_DEAD_STORE_OVERWRITE',
  'redundant-binding': 'WASTE_REDUNDANT_BINDING',
} as const;
const BARREL_KIND_TO_CODE: Readonly<Record<BarrelFindingKind, FirebatCatalogCode>> = {
  'export-star': 'BARREL_EXPORT_STAR',
  'deep-import': 'BARREL_DEEP_IMPORT',
  'index-deep-import': 'BARREL_INDEX_DEEP_IMPORT',
  'missing-index': 'BARREL_MISSING_INDEX',
  'invalid-index-statement': 'BARREL_INVALID_INDEX_STMT',
  'barrel-side-effect-import': 'BARREL_SIDE_EFFECT_IMPORT',
  'cross-module-reexport': 'BARREL_CROSS_MODULE_REEXPORT',
} as const;
const NESTING_KIND_TO_CODE: Readonly<Record<NestingKind, FirebatCatalogCode>> = {
  'deep-nesting': 'NESTING_DEEP',
  'high-cognitive-complexity': 'NESTING_HIGH_CC',
  'accidental-quadratic': 'NESTING_ACCIDENTAL_QUADRATIC',
  'callback-depth': 'NESTING_CALLBACK_DEPTH',
  'promise-chain-depth': 'NESTING_PROMISE_CHAIN',
  'complexity-density': 'NESTING_COMPLEXITY_DENSITY',
} as const;
const EARLY_RETURN_KIND_TO_CODE: Readonly<Record<EarlyReturnKind, FirebatCatalogCode>> = {
  'wrapping-if': 'EARLY_RETURN_WRAPPING_IF',
  'invertible-if-else': 'EARLY_RETURN_INVERTIBLE',
  'cascade-guard': 'EARLY_RETURN_CASCADE_GUARD',
  'implicit-else': 'EARLY_RETURN_IMPLICIT_ELSE',
} as const;
const COLLAPSIBLE_IF_KIND_TO_CODE = {
  'collapsible-if': 'COLLAPSIBLE_IF',
  'collapsible-else-if': 'COLLAPSIBLE_ELSE_IF',
} as const satisfies Record<string, FirebatCatalogCode>;
const ERROR_FLOW_KIND_TO_CODE: Record<Exclude<ErrorFlowFindingKind, 'tool-unavailable'>, FirebatCatalogCode> = {
  'throw-non-error': 'EF_THROW_NON_ERROR',
  'promise-constructor-hygiene': 'EF_PROMISE_CONSTRUCTOR_HYGIENE',
  'missing-error-cause': 'EF_MISSING_ERROR_CAUSE',
  'unsafe-finally': 'EF_UNSAFE_FINALLY',
  'return-await-in-try': 'EF_RETURN_AWAIT_IN_TRY',
  'floating-promises': 'EF_UNOBSERVED_PROMISE_FLOATING',
  'catch-or-return': 'EF_UNOBSERVED_PROMISE_CATCH_OR_RETURN',
  'misused-promises': 'EF_UNOBSERVED_PROMISE_MISUSED',
  'unobserved-variable': 'EF_UNOBSERVED_PROMISE_VARIABLE',
  'no-callback-in-promise': 'EF_UNOBSERVED_PROMISE_CALLBACK_IN_PROMISE',
  'empty-catch': 'EF_EMPTY_CATCH',
};
const INDIRECTION_KIND_TO_CODE: Readonly<Record<IndirectionFindingKind, FirebatCatalogCode>> = {
  'thin-wrapper': 'IND_THIN_WRAPPER',
  'forward-chain': 'IND_FORWARD_CHAIN',
  'cross-file-forwarding-chain': 'IND_CROSS_FILE_CHAIN',
  'type-remap': 'IND_TYPE_REMAP',
  'interface-rewrap': 'IND_INTERFACE_REWRAP',
} as const;
const COUPLING_KIND_TO_CODE: Readonly<Record<CouplingKind, FirebatCatalogCode>> = {
  'god-module': 'COUPLING_GOD_MODULE',
  'bidirectional-coupling': 'COUPLING_BIDIRECTIONAL',
  'off-main-sequence': 'COUPLING_OFF_MAIN_SEQ',
  'unstable-module': 'COUPLING_UNSTABLE',
  'rigid-module': 'COUPLING_RIGID',
} as const;
const DEP_MEMBER_KIND_TO_CODE: Record<string, FirebatCatalogCode> = {
  'unused-enum-member': 'DEP_UNUSED_ENUM_MEMBER',
  'unused-ns-export': 'DEP_UNUSED_NS_EXPORT',
  'unused-ns-member': 'DEP_UNUSED_NS_MEMBER',
};
const DUPLICATE_KIND_TO_CODE: Readonly<Record<DuplicateCloneType, FirebatCatalogCode>> = {
  exact: 'DUP_EXACT',
  shape: 'DUP_SHAPE',
  normalized: 'DUP_NORMALIZED',
  fragment: 'DUP_FRAGMENT',
} as const;
const VARIABLE_LIFETIME_KIND_TO_CODE: Readonly<Record<string, FirebatCatalogCode>> = {
  'scope-narrowing': 'LIFETIME_SCOPE_NARROWING',
  'liveness-pressure': 'LIFETIME_LIVENESS_PRESSURE',
  'mutation-density': 'LIFETIME_MUTATION_DENSITY',
};

const enrichFilePath = (toProjectRelative: ToProjectRelative, filePath: string): string =>
  filePath.length > 0 ? toProjectRelative(filePath) : filePath;

// detector item에서 파일 경로를 꺼내는 단일 규약: filePath 우선, 없으면 file.
const pickFilePath = (item: any): string => String(item?.filePath ?? item?.file ?? '');

const enrichWaste = (items: ReadonlyArray<any>, toProjectRelative: ToProjectRelative): ReadonlyArray<any> =>
  items.map(item => {
    const kind = String(item?.kind ?? '');
    const filePath = pickFilePath(item);

    return {
      kind,
      code: (WASTE_KIND_TO_CODE as Record<string, FirebatCatalogCode | undefined>)[kind],
      file: enrichFilePath(toProjectRelative, filePath),
      span: item?.span,
      label: item?.label,
    };
  });

const enrichBarrel = (items: ReadonlyArray<any>, toProjectRelative: ToProjectRelative): ReadonlyArray<any> =>
  items.map(item => {
    const kind = String(item?.kind ?? '');
    const filePath = pickFilePath(item);

    return {
      kind,
      code: (BARREL_KIND_TO_CODE as Record<string, FirebatCatalogCode | undefined>)[kind],
      file: enrichFilePath(toProjectRelative, filePath),
      span: item?.span,
      evidence: item?.evidence,
    };
  });

const enrichNesting = (items: ReadonlyArray<any>, toProjectRelative: ToProjectRelative): ReadonlyArray<any> =>
  items.map(item => {
    const kind = String(item?.kind ?? '');
    const filePath = pickFilePath(item);

    return {
      ...item,
      code: (NESTING_KIND_TO_CODE as Record<string, FirebatCatalogCode | undefined>)[kind],
      file: enrichFilePath(toProjectRelative, filePath),
    };
  });

const enrichEarlyReturn = (items: ReadonlyArray<any>, toProjectRelative: ToProjectRelative): ReadonlyArray<any> =>
  items.map(item => {
    const kind = String(item?.kind ?? '');
    const filePath = pickFilePath(item);

    return {
      ...item,
      code: (EARLY_RETURN_KIND_TO_CODE as Record<string, FirebatCatalogCode | undefined>)[kind],
      file: enrichFilePath(toProjectRelative, filePath),
    };
  });

const enrichCollapsibleIf = (items: ReadonlyArray<any>, toProjectRelative: ToProjectRelative): ReadonlyArray<any> =>
  items.map(item => {
    const filePath = pickFilePath(item);
    const kind = String(item?.kind ?? 'collapsible-if');
    const code = COLLAPSIBLE_IF_KIND_TO_CODE[kind as keyof typeof COLLAPSIBLE_IF_KIND_TO_CODE] ?? 'COLLAPSIBLE_IF';

    return {
      ...item,
      code,
      file: enrichFilePath(toProjectRelative, filePath),
    };
  });

const enrichErrorFlow = (items: ReadonlyArray<any>, toProjectRelative: ToProjectRelative): ReadonlyArray<any> =>
  items
    .filter((item: any) => item?.kind !== 'tool-unavailable')
    .map(item => {
      const kind = String(item?.kind ?? '');
      const filePath = pickFilePath(item);

      return {
        kind,
        code: (ERROR_FLOW_KIND_TO_CODE as Record<string, FirebatCatalogCode | undefined>)[kind],
        file: enrichFilePath(toProjectRelative, filePath),
        span: item?.span,
        evidence: item?.evidence,
      };
    });

const enrichIndirection = (items: ReadonlyArray<any>, toProjectRelative: ToProjectRelative): ReadonlyArray<any> =>
  items.map(item => {
    const kind = String(item?.kind ?? '');
    const filePath = pickFilePath(item);

    return {
      kind,
      code: (INDIRECTION_KIND_TO_CODE as Record<string, FirebatCatalogCode | undefined>)[kind],
      file: enrichFilePath(toProjectRelative, filePath),
      span: item?.span,
      header: item?.header,
      depth: item?.depth,
      evidence: item?.evidence,
    };
  });

const enrichCoupling = (items: ReadonlyArray<any>): ReadonlyArray<any> =>
  items.map(item => {
    const module = String(item?.module ?? '');
    const signals = Array.isArray(item?.signals) ? (item.signals as string[]) : [];
    const kind = pickCouplingKind(signals);

    return {
      kind,
      code: (COUPLING_KIND_TO_CODE as Record<string, FirebatCatalogCode | undefined>)[kind],
      file: module,
      span: ZERO_SPAN,
      module,
      score: item?.score,
      signals,
      metrics: item?.metrics,
    };
  });

const mapLayerViolations = (layerViolations: any[]): any[] =>
  layerViolations.map((v: any) => {
    const from = String(v?.from ?? '');

    return {
      kind: 'layer-violation',
      code: 'DEP_LAYER_VIOLATION',
      file: from,
      span: ZERO_SPAN,
      from,
      to: String(v?.to ?? ''),
      fromLayer: String(v?.fromLayer ?? ''),
      toLayer: String(v?.toLayer ?? ''),
    };
  });

const mapDeadExports = (deadExports: any[]): any[] =>
  deadExports.map((d: any) => {
    const kind = String(d?.kind ?? 'dead-export');
    const module = String(d?.module ?? '');

    return {
      kind,
      code: kind === 'test-only-export' ? 'DEP_TEST_ONLY_EXPORT' : 'DEP_DEAD_EXPORT',
      file: module,
      span: ZERO_SPAN,
      module,
      name: String(d?.exportName ?? d?.name ?? ''),
    };
  });

const mapCycles = (cycles: any[], cuts: any[], toProjectRelative: ToProjectRelative): any[] =>
  cycles.map((c: any) => {
    const pathModules = Array.isArray(c?.path) ? c.path : [];
    const bestCut = cuts.find((h: any) => pathModules.includes(h?.from) && pathModules.includes(h?.to));

    return Object.assign(
      {
        kind: `circular-dependency`,
        code: `DIAG_CIRCULAR_DEPENDENCY`,
        items: pathModules.map((mod: string) => ({ file: toProjectRelative(mod), span: ZERO_SPAN })),
      },
      bestCut ? { cut: { from: bestCut.from, to: bestCut.to, score: bestCut.score } } : {},
    );
  });

const mapUnusedFiles = (unusedFiles: any[]): any[] =>
  unusedFiles.map((u: any) => {
    const module = String(u?.module ?? '');

    return { kind: 'unused-file', code: 'DEP_UNUSED_FILE', file: module, span: ZERO_SPAN, module };
  });

const mapUnusedDeps = (unusedDeps: any[]): any[] =>
  unusedDeps.map((u: any) => {
    const kind = String(u?.kind ?? 'unused-dependency');

    return {
      kind,
      code: kind === 'unlisted-dependency' ? 'DEP_UNLISTED_DEPENDENCY' : 'DEP_UNUSED_DEPENDENCY',
      file: String(u?.files?.[0] ?? ''),
      span: ZERO_SPAN,
      packageName: String(u?.packageName ?? ''),
      files: Array.isArray(u?.files) ? u.files : [],
    };
  });

const mapUnresolvedImports = (unresolvedImports: any[]): any[] =>
  unresolvedImports.map((u: any) => {
    const module = String(u?.module ?? '');

    return {
      kind: 'unresolved-import',
      code: 'DEP_UNRESOLVED_IMPORT',
      file: module,
      span: ZERO_SPAN,
      module,
      specifier: String(u?.specifier ?? ''),
    };
  });

const mapDuplicateExports = (duplicateExports: any[]): any[] =>
  duplicateExports.map((d: any) => {
    const modules = Array.isArray(d?.modules) ? d.modules : [];

    return {
      kind: 'duplicate-export',
      code: 'DEP_DUPLICATE_EXPORT',
      file: String(modules[0] ?? ''),
      span: ZERO_SPAN,
      name: String(d?.name ?? ''),
      modules,
    };
  });

const mapUnusedMembers = (unusedMembers: any[]): any[] =>
  unusedMembers.map((m: any) => {
    const kind = String(m?.kind ?? 'unused-enum-member');

    return {
      kind,
      code: DEP_MEMBER_KIND_TO_CODE[kind] ?? 'DEP_UNUSED_ENUM_MEMBER',
      file: String(m?.module ?? ''),
      span: ZERO_SPAN,
      module: String(m?.module ?? ''),
      symbolName: String(m?.symbolName ?? ''),
      memberName: String(m?.memberName ?? ''),
    };
  });

const enrichDependencies = (value: any, toProjectRelative: ToProjectRelative): ReadonlyArray<any> => {
  const cuts = Array.isArray(value?.edgeCutHints) ? value.edgeCutHints : Array.isArray(value?.cuts) ? value.cuts : [];

  return [
    ...mapLayerViolations(Array.isArray(value?.layerViolations) ? value.layerViolations : []),
    ...mapDeadExports(Array.isArray(value?.deadExports) ? value.deadExports : []),
    ...mapCycles(Array.isArray(value?.cycles) ? value.cycles : [], cuts, toProjectRelative),
    ...mapUnusedFiles(Array.isArray(value?.unusedFiles) ? value.unusedFiles : []),
    ...mapUnusedDeps(Array.isArray(value?.unusedDeps) ? value.unusedDeps : []),
    ...mapUnresolvedImports(Array.isArray(value?.unresolvedImports) ? value.unresolvedImports : []),
    ...mapDuplicateExports(Array.isArray(value?.duplicateExports) ? value.duplicateExports : []),
    ...mapUnusedMembers(Array.isArray(value?.unusedMembers) ? value.unusedMembers : []),
  ];
};

const enrichDuplicateItem = (item: any, toProjectRelative: ToProjectRelative): any => {
  const filePath = pickFilePath(item);

  return {
    kind: item?.kind,
    header: item?.header,
    file: enrichFilePath(toProjectRelative, filePath),
    span: item?.span,
  };
};

const enrichDuplicateGroups = (groups: ReadonlyArray<any>, toProjectRelative: ToProjectRelative): ReadonlyArray<any> =>
  groups.map(group => {
    const kind = String(group?.cloneType ?? group?.kind ?? '');
    const items = Array.isArray(group?.items) ? group.items : [];

    return {
      kind,
      code: (DUPLICATE_KIND_TO_CODE as Record<string, FirebatCatalogCode | undefined>)[kind],
      items: items.map((item: any) => enrichDuplicateItem(item, toProjectRelative)),
      ...(group?.suggestedParams !== undefined ? { params: group.suggestedParams } : {}),
    };
  });

const enrichPhase1 = <T extends { readonly file?: string; readonly filePath?: string; readonly span?: unknown }>(
  items: ReadonlyArray<T>,
  code: FirebatCatalogCode,
  toProjectRelative: ToProjectRelative,
): ReadonlyArray<T & { readonly code: FirebatCatalogCode; readonly file: string; readonly span: unknown }> =>
  items.map(item => {
    const filePath = itemFileString(item);

    return {
      ...item,
      code,
      file: enrichFilePath(toProjectRelative, filePath),
      span: item.span ?? ZERO_SPAN,
    };
  });

const enrichVariableLifetime = (
  findings: ReadonlyArray<VariableLifetimeFinding | ScopeNarrowingFinding | LivenessPressureFinding | MutationDensityFinding>,
  toProjectRelative: ToProjectRelative,
): ReadonlyArray<VariableLifetimeFinding | ScopeNarrowingFinding | LivenessPressureFinding | MutationDensityFinding> =>
  findings.map(f => ({
    ...f,
    code: (VARIABLE_LIFETIME_KIND_TO_CODE[f.kind] ?? 'VAR_LIFETIME') as FirebatCatalogCode,
    file: enrichFilePath(toProjectRelative, f.file),
    span: f.span,
  }));

const enrichFormat = (files: ReadonlyArray<string>, toProjectRelative: ToProjectRelative): ReadonlyArray<any> =>
  files.map(filePath => ({
    kind: 'needs-formatting' as const,
    code: 'FORMAT' as FirebatCatalogCode,
    file: enrichFilePath(toProjectRelative, filePath),
    span: ZERO_SPAN,
  }));

// tool 진단(lint/typecheck) item에 catalogCode를 찍는 단일 변환.
const withCatalogCode = (items: ReadonlyArray<any>, catalogCode: FirebatCatalogCode): ReadonlyArray<any> =>
  items.map(item => ({ ...item, catalogCode }));

const enrichLint = (items: ReadonlyArray<any>): ReadonlyArray<any> => withCatalogCode(items, 'LINT');

const enrichTypecheck = (items: ReadonlyArray<any>): ReadonlyArray<any> => withCatalogCode(items, 'TYPECHECK');

// code/catalogCode 값이 알려진 카탈로그 코드면 집합에 기록하는 단일 결정.
const addKnownCode = (value: unknown, seenCodes: Set<FirebatCatalogCode>): void => {
  if (typeof value === 'string' && value in FIREBAT_CODE_CATALOG) {
    seenCodes.add(value as FirebatCatalogCode);
  }
};

const collectItemCodes = (item: any, seenCodes: Set<FirebatCatalogCode>): void => {
  addKnownCode(item?.code ?? item?.catalogCode, seenCodes);

  const nested = item?.items;

  if (!Array.isArray(nested)) {
    return;
  }

  for (const sub of nested) {
    addKnownCode((sub as Record<string, unknown>)?.code ?? (sub as Record<string, unknown>)?.catalogCode, seenCodes);
  }
};

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
      collectItemCodes(item, seenCodes);
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

// ── End module-scope helpers ────────────────────────────────────────────────────

interface ScanUseCaseDeps {
  readonly logger: FirebatLogger;
}

const scanUseCase = async (options: FirebatCliOptions, deps: ScanUseCaseDeps): Promise<FirebatReport> => {
  const logger = deps.logger;
  const metaErrors: Record<string, string> = {};

  logger.info('Scanning', {
    targetCount: options.targets.length,
    detectorCount: options.detectors.length,
    fixMode: true,
  });
  logger.trace('Detectors selected', { detectors: options.detectors.join(',') });

  const tCtx0 = nowMs();
  const ctx = await resolveRuntimeContextFromCwd();

  logger.trace('Runtime context resolved', { rootAbs: ctx.rootAbs, durationMs: Math.round(nowMs() - tCtx0) });

  const { config, configError } = await loadConfig(ctx.rootAbs, options.configPath, logger);

  if (configError !== null) {
    metaErrors.config = configError;
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

  // Semantic layer is required for binding identity resolution used by
  // dataflow detectors (waste / variable-lifetime) as well as type-aware
  // detectors. variable-collector's buildDeclScopeMap routes through
  // gildash's getFileBindings (tsc-authoritative), which requires the
  // semantic layer to be active.
  const needsSemantic =
    options.detectors.includes('error-flow') ||
    options.detectors.includes('typecheck') ||
    options.detectors.includes('waste') ||
    options.detectors.includes('variable-lifetime');
  const tIndex0 = nowMs();
  const { gildash, semanticAvailable } = await createGildashInstance({
    rootAbs: ctx.rootAbs,
    needsSemantic,
    exclude: options.exclude,
    logger,
  });

  // Warmup: trigger tsc TypeChecker to parse @zipbul/gildash .d.ts dependency tree once.
  // Without this, the first semantic type resolution on a file importing gildash pays ~30s cold-start.
  // Position 3512 is the `createGildash` call site — forces full Gildash type tree resolution.

  logger.info('Indexing complete (gildash)', {
    targetCount: options.targets.length,
    semantic: semanticAvailable,
    durationMs: Math.round(nowMs() - tIndex0),
  });

  // Register the semantic-enabled Gildash as the authoritative binding source
  // for dataflow detectors (waste / variable-lifetime). Save any pre-existing
  // context (e.g. a test preload's instance) so it is restored — and this
  // scan's Gildash closed — on EVERY exit path, including the cache-hit early
  // return and any thrown error. The try/finally below guarantees that.
  const previousBindingContext = getGildashSemanticContext();

  if (semanticAvailable) {
    setGildashSemanticContext(gildash);
  }

  // Inline try/finally (not a wrapping nested function): early `return`s inside
  // the body still run the finally, and no closure is created that would capture
  // outer locals like `metaErrors`.
  try {
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

    const allowCache = false;

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

    type BarrelResult = ReturnType<typeof createEmptyBarrel>;

    type TypecheckResult = ReturnType<typeof createEmptyTypecheck>;

    logger.info('Fix mode: running fixable tools before parse', {
      format: shouldRunFormat,
      lint: shouldRunLint,
    });

    const tFix0 = nowMs();
    const [oxfmtConfigPath, oxlintConfigPath] = await Promise.all([
      resolveToolRcPath(ctx.rootAbs, '.oxfmtrc.jsonc'),
      resolveToolRcPath(ctx.rootAbs, '.oxlintrc.jsonc'),
    ]);
    const [fixedFormat, fixedLint] = await Promise.all([
      shouldRunFormat
        ? analyzeFormat({
            targets: options.targets,
            fix: true,
            cwd: ctx.rootAbs,
            resolveMode: 'project-only',
            ...(oxfmtConfigPath !== undefined ? { configPath: oxfmtConfigPath } : {}),
            logger,
          }).catch(err => {
            metaErrors.format = toErrorMessage(err);

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
            metaErrors.lint = toErrorMessage(err);

            return null;
          })
        : Promise.resolve(createEmptyLint()),
    ]);
    const fixTimings: Record<string, number> = {};
    const fixDur = Math.round(nowMs() - tFix0);

    if (shouldRunFormat) {
      fixTimings.format = nowMs() - tFix0;
    }

    if (shouldRunLint) {
      fixTimings.lint = nowMs() - tFix0;
    }

    logger.info('Fix mode: tools complete', { durationMs: fixDur });

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
    const detectorRunCtx: DetectorRunCtx = { logger, timings: detectorTimings };
    const waste: ReturnType<typeof detectWaste> = runDetector(
      detectorRunCtx,
      'waste',
      options.detectors.includes('waste'),
      () => [],
      () => detectWaste(program),
    );
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
    const typecheckPromise: Promise<TypecheckResult | null> = options.detectors.includes('typecheck')
      ? (async (): Promise<TypecheckResult | null> => {
          const t0 = nowMs();
          const detectorKey = 'typecheck';

          logger.info('detector: start', { detector: detectorKey });

          try {
            const r = await analyzeTypecheck(program, {
              rootAbs: ctx.rootAbs,
              logger,
              ...(semanticAvailable ? { gildash } : {}),
            });

            detectorTimings.typecheck = nowMs() - t0;

            logger.debug('detector: complete', {
              detector: detectorKey,
              durationMs: Math.round(detectorTimings.typecheck),
            });

            return r;
          } catch (err) {
            detectorTimings.typecheck = nowMs() - t0;

            metaErrors.typecheck = toErrorMessage(err);

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
    const dependencies: Awaited<ReturnType<typeof analyzeDependencies>> = await runDetectorAsync(
      detectorRunCtx,
      'dependencies',
      shouldRunDependencies,
      createEmptyDependencies,
      () =>
        analyzeDependencies(gildash, {
          rootAbs: ctx.rootAbs,
          readFileFn: (p: string) => readFileSync(p, 'utf8'),
          ...(options.dependenciesLayers !== undefined ? { layers: options.dependenciesLayers } : {}),
          ...(options.dependenciesAllowedDependencies !== undefined
            ? { allowedDependencies: options.dependenciesAllowedDependencies }
            : {}),
        }),
    );
    const coupling: ReturnType<typeof analyzeCoupling> = runDetector(
      detectorRunCtx,
      'coupling',
      options.detectors.includes('coupling'),
      createEmptyCoupling,
      () => analyzeCoupling(dependencies, options.couplingConfig),
    );
    const nesting: ReturnType<typeof analyzeNesting> = runDetector(
      detectorRunCtx,
      'nesting',
      options.detectors.includes('nesting'),
      createEmptyNesting,
      () => {
        const nestingCfgObj = featureOptions(config?.features?.nesting);
        const resolvedNestingOptions = {
          maxCognitiveComplexity: nestingCfgObj?.maxCognitiveComplexity ?? DEFAULT_NESTING_OPTIONS.maxCognitiveComplexity,
          maxCallbackDepth: nestingCfgObj?.maxCallbackDepth ?? DEFAULT_NESTING_OPTIONS.maxCallbackDepth,
          maxPromiseChainDepth: nestingCfgObj?.maxPromiseChainDepth ?? DEFAULT_NESTING_OPTIONS.maxPromiseChainDepth,
          maxNestingDepth: nestingCfgObj?.maxNestingDepth ?? DEFAULT_NESTING_OPTIONS.maxNestingDepth,
          minDensityLoc: nestingCfgObj?.minDensityLoc ?? DEFAULT_NESTING_OPTIONS.minDensityLoc,
          maxDensity: nestingCfgObj?.maxDensity ?? DEFAULT_NESTING_OPTIONS.maxDensity,
        };

        return analyzeNesting(program, resolvedNestingOptions);
      },
    );
    const earlyReturn: ReturnType<typeof analyzeEarlyReturn> = runDetector(
      detectorRunCtx,
      'early-return',
      options.detectors.includes('early-return'),
      createEmptyEarlyReturn,
      () => analyzeEarlyReturn(program),
    );
    const collapsibleIf: ReturnType<typeof analyzeCollapsibleIf> = runDetector(
      detectorRunCtx,
      'collapsible-if',
      options.detectors.includes('collapsible-if'),
      createEmptyCollapsibleIf,
      () => analyzeCollapsibleIf(program),
    );
    const errorFlow: Awaited<ReturnType<typeof analyzeErrorFlow>> = await (async () => {
      if (!options.detectors.includes('error-flow')) {
        return createEmptyErrorFlow();
      }

      const t0 = nowMs();

      logger.debug('detector: start', { detector: 'error-flow' });

      try {
        const result = analyzeErrorFlow(program, { gildash });

        finishDetector(detectorRunCtx, 'error-flow', t0);

        return result;
      } catch (err) {
        metaErrors['error-flow'] = toErrorMessage(err);

        finishDetector(detectorRunCtx, 'error-flow', t0);

        const partial = (err as { partial?: unknown })?.partial;

        return Array.isArray(partial)
          ? (partial as ReadonlyArray<import('../../types').ErrorFlowFinding>)
          : createEmptyErrorFlow();
      }
    })();
    const indirection: Awaited<ReturnType<typeof analyzeIndirection>> = await runDetectorAsync(
      detectorRunCtx,
      'indirection',
      options.detectors.includes('indirection'),
      createEmptyIndirection,
      () =>
        analyzeIndirection(
          gildash,
          program,
          { maxForwardDepth: options.maxForwardDepth, crossFileMinDepth: options.crossFileMinDepth ?? 2 },
          ctx.rootAbs,
        ),
    );
    const [barrel, typecheck] = await Promise.all([barrelPromise, typecheckPromise]);
    const lint = fixedLint;
    const format = fixedFormat;

    logger.info('Analysis complete', { durationMs: Math.round(nowMs() - tDetectors0) });

    const giantFile: ReturnType<typeof analyzeGiantFile> = runDetector(
      detectorRunCtx,
      'giant-file',
      options.detectors.includes('giant-file'),
      createEmptyGiantFile,
      () => {
        const { 'giant-file': giantFileCfg } = config?.features ?? {};
        const resolvedGiantFileMaxLines = featureOptions(giantFileCfg)?.maxLines ?? 1000;

        return analyzeGiantFile(program, { maxLines: Number(resolvedGiantFileMaxLines) });
      },
    );
    const variableLifetime: ReturnType<typeof analyzeVariableLifetime> = runDetector(
      detectorRunCtx,
      'variable-lifetime',
      options.detectors.includes('variable-lifetime'),
      createEmptyVariableLifetime,
      () => {
        const { 'variable-lifetime': variableLifetimeCfg } = config?.features ?? {};
        const vlCfgObj = featureOptions(variableLifetimeCfg);

        return analyzeVariableLifetime(program, {
          maxLifetimeLines: Number(vlCfgObj?.maxLifetimeLines ?? 30),
          maxLiveVariables: Number(vlCfgObj?.maxLiveVariables ?? 7),
          minFunctionLines: Number(vlCfgObj?.minFunctionLines ?? 40),
          maxMutationCount: vlCfgObj?.maxMutationCount ?? Infinity,
        });
      },
    );
    const temporalCoupling: ReturnType<typeof analyzeTemporalCoupling> = runDetector(
      detectorRunCtx,
      'temporal-coupling',
      options.detectors.includes('temporal-coupling'),
      createEmptyTemporalCoupling,
      () => analyzeTemporalCoupling(program, { gildash }),
    );
    const duplicatesUnified: ReturnType<typeof analyzeDuplicates> = runDetector(
      detectorRunCtx,
      'duplicates',
      options.detectors.includes('duplicates'),
      createEmptyDuplicates,
      () => analyzeDuplicates(program, { minSize: resolvedMinSize }),
    );
    const selectedDetectors = new Set(options.detectors);

    const toProjectRelative = (filePath: string): string => toProjectRelativePath(ctx.rootAbs, filePath);

    const analyses: FirebatReport['analyses'] = {
      ...(selectedDetectors.has('waste') ? { waste: enrichWaste(waste, toProjectRelative) } : {}),
      ...(selectedDetectors.has('barrel') ? { barrel: enrichBarrel(barrel, toProjectRelative) } : {}),
      ...(selectedDetectors.has('error-flow') ? { 'error-flow': enrichErrorFlow(errorFlow, toProjectRelative) } : {}),
      ...(selectedDetectors.has('format') && format !== null ? { format: enrichFormat(format, toProjectRelative) } : {}),
      ...(selectedDetectors.has('lint') && lint !== null ? { lint: enrichLint(lint) } : {}),
      ...(selectedDetectors.has('typecheck') && typecheck !== null ? { typecheck: enrichTypecheck(typecheck) } : {}),
      ...(selectedDetectors.has('dependencies') ? { dependencies: enrichDependencies(dependencies, toProjectRelative) } : {}),
      ...(selectedDetectors.has('coupling') ? { coupling: enrichCoupling(coupling) } : {}),
      ...(selectedDetectors.has('nesting') ? { nesting: enrichNesting(nesting, toProjectRelative) } : {}),
      ...(selectedDetectors.has('early-return') ? { 'early-return': enrichEarlyReturn(earlyReturn, toProjectRelative) } : {}),
      ...(selectedDetectors.has('collapsible-if')
        ? { 'collapsible-if': enrichCollapsibleIf(collapsibleIf, toProjectRelative) }
        : {}),
      ...(selectedDetectors.has('indirection') ? { indirection: enrichIndirection(indirection, toProjectRelative) } : {}),
      ...(selectedDetectors.has('giant-file') ? { 'giant-file': enrichPhase1(giantFile, 'GIANT_FILE', toProjectRelative) } : {}),
      ...(selectedDetectors.has('variable-lifetime')
        ? { 'variable-lifetime': enrichVariableLifetime(variableLifetime, toProjectRelative) }
        : {}),
      ...(selectedDetectors.has('temporal-coupling')
        ? { 'temporal-coupling': enrichPhase1(temporalCoupling, 'TEMPORAL_COUPLING', toProjectRelative) }
        : {}),
      ...(selectedDetectors.has('duplicates') ? { duplicates: enrichDuplicateGroups(duplicatesUnified, toProjectRelative) } : {}),
    };
    const diagnostics = aggregateDiagnostics({ analyses: analyses as Readonly<Record<string, unknown>> });
    const catalog = buildCatalog({ analyses, diagnostics });
    const functionRangeMap = buildFunctionRangeMap(program, toProjectRelative);
    const findings = flattenToFindings(analyses, functionRangeMap);
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
      findings,
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
  } finally {
    setGildashSemanticContext(previousBindingContext);
    await gildash.close({ cleanup: false });
  }
};

export { resolveToolRcPath, scanUseCase };
