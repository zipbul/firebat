import type { ErrorFlowFinding } from './features/error-flow/types';

export type { FirebatConfig } from './shared/firebat-config';

export type MinSizeOption = number | 'auto';

export type FirebatDetector =
  | 'waste'
  | 'barrel'
  | 'unknown-proof'
  | 'error-flow'
  | 'format'
  | 'lint'
  | 'typecheck'
  | 'dependencies'
  | 'coupling'
  | 'nesting'
  | 'early-return'
  | 'collapsible-if'
  | 'indirection'
  // Phase 1 detectors (IMPROVE.md)
  | 'temporal-coupling'
  | 'variable-lifetime'
  | 'giant-file'
  // Unified duplicates detector
  | 'duplicates';

/** 하위호환 별칭 — 기존 config 파일에서 사용하던 detector 이름을 현재 이름으로 매핑 */
export const DETECTOR_ALIASES: Readonly<Record<string, FirebatDetector>> = {
  'exact-duplicates': 'duplicates',
  'structural-duplicates': 'duplicates',
  'modification-trap': 'duplicates',
  'exception-hygiene': 'error-flow',
  'barrel-policy': 'barrel',
};

export type FirebatCatalogCode =
  // waste (2)
  | 'WASTE_DEAD_STORE'
  | 'WASTE_DEAD_STORE_OVERWRITE'
  // barrel (7)
  | 'BARREL_EXPORT_STAR'
  | 'BARREL_DEEP_IMPORT'
  | 'BARREL_INDEX_DEEP_IMPORT'
  | 'BARREL_MISSING_INDEX'
  | 'BARREL_INVALID_INDEX_STMT'
  | 'BARREL_SIDE_EFFECT_IMPORT'
  | 'BARREL_CROSS_MODULE_REEXPORT'
  // nesting (6)
  | 'NESTING_DEEP'
  | 'NESTING_HIGH_CC'
  | 'NESTING_ACCIDENTAL_QUADRATIC'
  | 'NESTING_CALLBACK_DEPTH'
  | 'NESTING_PROMISE_CHAIN'
  | 'NESTING_COMPLEXITY_DENSITY'
  // early-return (4)
  | 'EARLY_RETURN_WRAPPING_IF'
  | 'EARLY_RETURN_INVERTIBLE'
  | 'EARLY_RETURN_CASCADE_GUARD'
  | 'EARLY_RETURN_IMPLICIT_ELSE'
  // collapsible-if (2)
  | 'COLLAPSIBLE_IF'
  | 'COLLAPSIBLE_ELSE_IF'
  // error-flow (15)
  | 'EF_THROW_NON_ERROR'
  | 'EF_PROMISE_CONSTRUCTOR_HYGIENE'
  | 'EF_MISSING_ERROR_CAUSE'
  | 'EF_USELESS_CATCH'
  | 'EF_UNSAFE_FINALLY'
  | 'EF_RETURN_AWAIT_IN_TRY'
  | 'EF_PREFER_DOT_CATCH_CATCH'
  | 'EF_PREFER_DOT_CATCH_AWAIT'
  | 'EF_PREFER_DOT_CATCH_NO_WRAP'
  | 'EF_UNOBSERVED_PROMISE_FLOATING'
  | 'EF_UNOBSERVED_PROMISE_CATCH_OR_RETURN'
  | 'EF_UNOBSERVED_PROMISE_MISUSED'
  | 'EF_UNOBSERVED_PROMISE_VARIABLE'
  | 'EF_UNOBSERVED_PROMISE_ALWAYS_RETURN'
  | 'EF_UNOBSERVED_PROMISE_CALLBACK_IN_PROMISE'
  // unknown-proof (5)
  | 'UNKNOWN_UNNARROWED'
  | 'UNKNOWN_INFERRED'
  | 'UNKNOWN_ANY_INFERRED'
  | 'UNKNOWN_ANY_CAST'
  | 'UNKNOWN_DOUBLE_CAST'
  // indirection (5)
  | 'IND_THIN_WRAPPER'
  | 'IND_FORWARD_CHAIN'
  | 'IND_CROSS_FILE_CHAIN'
  | 'IND_TYPE_REMAP'
  | 'IND_INTERFACE_REWRAP'
  // coupling (5)
  | 'COUPLING_GOD_MODULE'
  | 'COUPLING_BIDIRECTIONAL'
  | 'COUPLING_OFF_MAIN_SEQ'
  | 'COUPLING_UNSTABLE'
  | 'COUPLING_RIGID'
  // dependencies (11)
  | 'DEP_LAYER_VIOLATION'
  | 'DEP_DEAD_EXPORT'
  | 'DEP_TEST_ONLY_EXPORT'
  | 'DEP_UNUSED_FILE'
  | 'DEP_UNUSED_DEPENDENCY'
  | 'DEP_UNLISTED_DEPENDENCY'
  | 'DEP_UNRESOLVED_IMPORT'
  | 'DEP_DUPLICATE_EXPORT'
  | 'DEP_UNUSED_ENUM_MEMBER'
  | 'DEP_UNUSED_NS_EXPORT'
  | 'DEP_UNUSED_NS_MEMBER'
  // duplicates (4)
  | 'DUP_EXACT'
  | 'DUP_SHAPE'
  | 'DUP_NORMALIZED'
  | 'DUP_NEAR_MISS'
  // diagnostics (7)
  | 'DIAG_GOD_FUNCTION'
  | 'DIAG_CIRCULAR_DEPENDENCY'
  | 'DIAG_GOD_MODULE'
  | 'DIAG_DATA_CLUMP'
  | 'DIAG_SHOTGUN_SURGERY'
  | 'DIAG_OVER_INDIRECTION'
  | 'DIAG_MIXED_ABSTRACTION'
  // Phase 1 detectors (12)
  | 'TEMPORAL_COUPLING'
  | 'SYMMETRY_BREAK'
  | 'VAR_LIFETIME'
  | 'LIFETIME_SCOPE_NARROWING'
  | 'LIFETIME_LIVENESS_PRESSURE'
  | 'LIFETIME_MUTATION_DENSITY'
  | 'GIANT_FILE'
  // external tools (3)
  | 'LINT'
  | 'FORMAT'
  | 'TYPECHECK';

export type FirebatItemKind = 'function' | 'method' | 'type' | 'interface' | 'node';

export type WasteKind = 'dead-store' | 'dead-store-overwrite';

export interface SourcePosition {
  readonly line: number;
  readonly column: number;
}

export interface SourceSpan {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export type CouplingKind = 'god-module' | 'bidirectional-coupling' | 'off-main-sequence' | 'unstable-module' | 'rigid-module';

export interface DuplicateItem {
  readonly kind: FirebatItemKind;
  readonly header: string;
  readonly filePath: string;
  readonly span: SourceSpan;
}

export interface CloneDiffPair {
  readonly left: string;
  readonly right: string;
  readonly location: string;
}

export interface CloneDiff {
  readonly kind: 'identifier' | 'literal' | 'type';
  readonly pairs: ReadonlyArray<CloneDiffPair>;
}

export type DuplicateCloneType = 'exact' | 'shape' | 'normalized' | 'near-miss';

export type DuplicateFindingKind =
  | 'exact-clone'
  | 'structural-clone'
  | 'near-miss-clone'
  | 'literal-variant'
  | 'type-variant'
  | 'pattern-outlier';

export interface DuplicateGroup {
  readonly cloneType: DuplicateCloneType;
  readonly findingKind: DuplicateFindingKind;
  readonly code?: FirebatCatalogCode;
  readonly items: ReadonlyArray<DuplicateItem>;
  readonly suggestedParams?: CloneDiff;
  readonly similarity?: number;
}

export interface DependencyCycle {
  readonly path: ReadonlyArray<string>;
}

export interface DependencyFanStat {
  readonly module: string;
  readonly count: number;
}

export interface DependencyEdgeCutHint {
  readonly from: string;
  readonly to: string;
  readonly score?: number;
  readonly reason?: string;
}

export interface DependencyLayerViolation {
  readonly kind: 'layer-violation';
  readonly message: string;
  readonly from: string;
  readonly to: string;
  readonly fromLayer: string;
  readonly toLayer: string;
}

export interface DependencyDeadExportFinding {
  readonly kind: 'dead-export' | 'test-only-export';
  readonly module: string;
  readonly name: string;
  /** Symbol kind from gildash (function, class, type, interface, enum, etc.) */
  readonly symbolKind?: string;
}

export interface DependencyUnusedFileFinding {
  readonly kind: 'unused-file';
  readonly module: string;
}

export interface DependencyUnusedDepFinding {
  readonly kind: 'unused-dependency' | 'unlisted-dependency';
  readonly packageName: string;
  readonly files: ReadonlyArray<string>;
}

export interface DependencyUnresolvedImportFinding {
  readonly kind: 'unresolved-import';
  readonly module: string;
  readonly specifier: string;
}

export interface DependencyDuplicateExportFinding {
  readonly kind: 'duplicate-export';
  readonly name: string;
  readonly modules: ReadonlyArray<string>;
}

export interface DependencyUnusedMemberFinding {
  readonly kind: 'unused-enum-member' | 'unused-ns-export' | 'unused-ns-member';
  readonly module: string;
  readonly symbolName: string;
  readonly memberName: string;
}

export interface DependencyExportStats {
  readonly total: number;
  readonly abstract: number;
}

export interface DependencyAnalysis {
  readonly cycles: ReadonlyArray<DependencyCycle>;
  /** Dependency graph adjacency list (module -> direct imports). Keys/values are project-relative paths. */
  readonly adjacency: Readonly<Record<string, ReadonlyArray<string>>>;
  /** Export counts used for coupling abstractness calculation. Keys are project-relative module paths. */
  readonly exportStats: Readonly<Record<string, DependencyExportStats>>;
  readonly fanIn: ReadonlyArray<DependencyFanStat>;
  readonly fanOut: ReadonlyArray<DependencyFanStat>;
  readonly cuts: ReadonlyArray<DependencyEdgeCutHint>;
  readonly layerViolations: ReadonlyArray<DependencyLayerViolation>;
  readonly deadExports: ReadonlyArray<DependencyDeadExportFinding>;
  readonly unusedFiles: ReadonlyArray<DependencyUnusedFileFinding>;
  readonly unusedDeps: ReadonlyArray<DependencyUnusedDepFinding>;
  readonly unresolvedImports: ReadonlyArray<DependencyUnresolvedImportFinding>;
  readonly duplicateExports: ReadonlyArray<DependencyDuplicateExportFinding>;
  readonly unusedMembers: ReadonlyArray<DependencyUnusedMemberFinding>;
}

// Enriched dependency finding types (post-enrich, array form)
export interface DepLayerViolationFinding {
  readonly code: FirebatCatalogCode;
  readonly kind: 'layer-violation';
  readonly file: string;
  readonly span: SourceSpan;
  readonly from: string;
  readonly to: string;
  readonly fromLayer: string;
  readonly toLayer: string;
}

export interface DepDeadExportFinding {
  readonly code: FirebatCatalogCode;
  readonly kind: 'dead-export' | 'test-only-export';
  readonly file: string;
  readonly span: SourceSpan;
  readonly module: string;
  readonly name: string;
}

export interface DepCycleFinding {
  readonly code: FirebatCatalogCode;
  readonly kind: 'circular-dependency';
  readonly items: ReadonlyArray<{
    readonly file: string;
    readonly span: SourceSpan;
  }>;
  readonly cut?: {
    readonly from: string;
    readonly to: string;
    readonly score?: number;
  };
}

export interface DepUnusedFileFinding {
  readonly code: FirebatCatalogCode;
  readonly kind: 'unused-file';
  readonly file: string;
  readonly span: SourceSpan;
  readonly module: string;
}

export interface DepUnusedDepFinding {
  readonly code: FirebatCatalogCode;
  readonly kind: 'unused-dependency' | 'unlisted-dependency';
  readonly file: string;
  readonly span: SourceSpan;
  readonly packageName: string;
  readonly files: ReadonlyArray<string>;
}

export interface DepUnresolvedImportFinding {
  readonly code: FirebatCatalogCode;
  readonly kind: 'unresolved-import';
  readonly file: string;
  readonly span: SourceSpan;
  readonly module: string;
  readonly specifier: string;
}

export interface DepDuplicateExportFinding {
  readonly code: FirebatCatalogCode;
  readonly kind: 'duplicate-export';
  readonly file: string;
  readonly span: SourceSpan;
  readonly name: string;
  readonly modules: ReadonlyArray<string>;
}

export interface DepUnusedMemberFinding {
  readonly code: FirebatCatalogCode;
  readonly kind: 'unused-enum-member' | 'unused-ns-export' | 'unused-ns-member';
  readonly file: string;
  readonly span: SourceSpan;
  readonly module: string;
  readonly symbolName: string;
  readonly memberName: string;
}

export type DependencyFinding =
  | DepLayerViolationFinding
  | DepDeadExportFinding
  | DepCycleFinding
  | DepUnusedFileFinding
  | DepUnusedDepFinding
  | DepUnresolvedImportFinding
  | DepDuplicateExportFinding
  | DepUnusedMemberFinding;

export interface FormatFinding {
  readonly code: FirebatCatalogCode;
  readonly kind: 'needs-formatting';
  readonly file: string;
  readonly span: SourceSpan;
}

export interface CouplingMetrics {
  readonly fanIn: number;
  readonly fanOut: number;
  readonly instability: number;
  readonly abstractness: number;
  readonly distance: number;
}

export interface CouplingHotspot {
  readonly module: string;
  readonly score: number;
  readonly code?: FirebatCatalogCode;
  readonly signals: ReadonlyArray<string>;
  readonly metrics: CouplingMetrics;
  readonly why: string;
  readonly suggestedRefactor: string;
}

export interface NestingMetrics {
  readonly depth: number;
  readonly cognitiveComplexity: number;
  readonly callbackDepth: number;
  readonly promiseChainDepth?: number | undefined;
  readonly quadraticTargets: ReadonlyArray<string>;
  readonly density: number;
  readonly halsteadVolume: number;
  readonly halsteadDifficulty: number;
}

export type NestingKind =
  | 'deep-nesting'
  | 'high-cognitive-complexity'
  | 'accidental-quadratic'
  | 'callback-depth'
  | 'promise-chain-depth'
  | 'complexity-density';

export interface NestingItem {
  readonly kind: NestingKind;
  readonly signals: ReadonlyArray<NestingKind>;
  readonly file: string;
  readonly code?: FirebatCatalogCode;
  readonly header: string;
  readonly span: SourceSpan;
  readonly metrics: NestingMetrics;
  readonly score: number;
}

export interface EarlyReturnMetrics {
  readonly maxDepth: number;
  readonly depthReduction: number;
  readonly statementsAffected: number;
}

export type EarlyReturnKind = 'wrapping-if' | 'invertible-if-else' | 'cascade-guard' | 'implicit-else';

export interface EarlyReturnItem {
  readonly kind: EarlyReturnKind;
  readonly file: string;
  readonly code?: FirebatCatalogCode;
  readonly header: string;
  readonly span: SourceSpan;
  readonly opportunitySpans?: ReadonlyArray<SourceSpan>;
  readonly metrics: EarlyReturnMetrics;
  readonly score: number;
}

export interface CollapsibleIfMetrics {
  readonly maxDepth: number;
  readonly depthReduction: number;
  readonly statementsAffected: number;
}

export interface CollapsibleIfItem {
  readonly kind: 'collapsible-if' | 'collapsible-else-if';
  readonly file: string;
  readonly code?: FirebatCatalogCode;
  readonly header: string;
  readonly span: SourceSpan;
  readonly opportunitySpans?: ReadonlyArray<SourceSpan>;
  readonly metrics: CollapsibleIfMetrics;
  readonly score: number;
}

export type BarrelFindingKind =
  | 'export-star'
  | 'deep-import'
  | 'index-deep-import'
  | 'missing-index'
  | 'invalid-index-statement'
  | 'barrel-side-effect-import'
  | 'cross-module-reexport';

export interface BarrelFinding {
  readonly kind: BarrelFindingKind;
  readonly file: string;
  readonly span: SourceSpan;
  readonly code?: FirebatCatalogCode;
  readonly evidence?: string;
}

export type IndirectionFindingKind =
  | 'thin-wrapper'
  | 'forward-chain'
  | 'cross-file-forwarding-chain'
  | 'type-remap'
  | 'interface-rewrap';

export interface IndirectionFinding {
  readonly kind: IndirectionFindingKind;
  readonly filePath: string;
  readonly span: SourceSpan;
  readonly code?: FirebatCatalogCode;
  readonly header: string;
  readonly depth: number;
  readonly evidence: string;
}

export interface IndirectionParamsInfo {
  readonly params: ReadonlyArray<string>;
  readonly restParam: string | null;
}

export interface WasteFinding {
  readonly kind: WasteKind;
  readonly label: string;
  readonly message: string;
  readonly filePath: string;
  readonly span: SourceSpan;
  readonly code?: FirebatCatalogCode;
}

export type TypecheckSeverity = 'error' | 'warning';

export type LintSeverity = 'error' | 'warning' | 'info';

export interface LintDiagnostic {
  readonly file?: string;
  readonly msg: string;
  readonly code?: string;
  readonly severity: LintSeverity;
  readonly span: SourceSpan;
  readonly catalogCode?: FirebatCatalogCode;
}

export interface TypecheckItem {
  readonly severity: TypecheckSeverity;
  readonly code: string;
  readonly msg: string;
  readonly file: string;
  readonly span: SourceSpan;
  readonly codeFrame: string;
  readonly catalogCode?: FirebatCatalogCode;
}

export type UnknownProofFindingKind =
  | 'tool-unavailable'
  | 'unknown-type'
  | 'unknown-inferred'
  | 'any-inferred'
  | 'any-cast'
  | 'double-cast';

export interface UnknownProofFinding {
  readonly kind: UnknownProofFindingKind;
  readonly message: string;
  readonly filePath: string;
  readonly span: SourceSpan;
  readonly code?: FirebatCatalogCode;
  readonly symbol?: string;
  readonly evidence?: string;
  readonly typeText?: string;
}

export interface CatalogEntry {
  readonly cause: string;
  readonly think: ReadonlyArray<string>;
}

export interface FirebatMeta {
  readonly engine: 'oxc';
  readonly targetCount: number;
  readonly minSize: number;
  readonly maxForwardDepth: number;
  readonly detectors: ReadonlyArray<FirebatDetector>;
  readonly detectorTimings?: Readonly<Record<string, number>>;
  readonly errors?: Readonly<Record<string, string>>;
}

export interface TemporalCouplingFinding {
  readonly kind: 'temporal-coupling';
  readonly file: string;
  readonly span: SourceSpan;
  readonly code?: FirebatCatalogCode;
  readonly state: string;
  readonly writers: number;
  readonly readers: number;
}

export interface VariableLifetimeFinding {
  readonly kind: 'variable-lifetime';
  readonly file: string;
  readonly span: SourceSpan;
  readonly code?: FirebatCatalogCode;
  readonly variable: string;
  readonly lifetimeLines: number;
  readonly contextBurden: number;
}

export interface ScopeNarrowingFinding {
  readonly kind: 'scope-narrowing';
  readonly file: string;
  readonly span: SourceSpan;
  readonly code?: FirebatCatalogCode;
  readonly variable: string;
  readonly targetBlock: {
    readonly type: 'if-consequent' | 'if-alternate' | 'switch-case' | 'try-block' | 'catch-block';
    readonly span: SourceSpan;
  };
}

export interface LivenessPressureFinding {
  readonly kind: 'liveness-pressure';
  readonly file: string;
  readonly span: SourceSpan;
  readonly code?: FirebatCatalogCode;
  readonly maxLiveVariables: number;
  readonly functionLineCount: number;
  readonly hotSpotLine: number;
}

export interface MutationDensityFinding {
  readonly kind: 'mutation-density';
  readonly file: string;
  readonly span: SourceSpan;
  readonly code?: FirebatCatalogCode;
  readonly variable: string;
  readonly mutationCount: number;
}

export interface GiantFileMetrics {
  readonly lineCount: number;
  readonly maxLines: number;
}

export interface GiantFileFinding {
  readonly kind: 'giant-file';
  readonly file: string;
  readonly span: SourceSpan;
  readonly code?: FirebatCatalogCode;
  readonly metrics: GiantFileMetrics;
}

export interface FirebatAnalyses {
  readonly waste: ReadonlyArray<WasteFinding>;
  readonly barrel: ReadonlyArray<BarrelFinding>;
  readonly 'unknown-proof': ReadonlyArray<UnknownProofFinding>;
  readonly 'error-flow': ReadonlyArray<ErrorFlowFinding>;
  readonly format: ReadonlyArray<FormatFinding>;
  readonly lint: ReadonlyArray<LintDiagnostic>;
  readonly typecheck: ReadonlyArray<TypecheckItem>;
  readonly dependencies: ReadonlyArray<DependencyFinding>;
  readonly coupling: ReadonlyArray<CouplingHotspot>;
  readonly nesting: ReadonlyArray<NestingItem>;
  readonly 'early-return': ReadonlyArray<EarlyReturnItem>;
  readonly 'collapsible-if': ReadonlyArray<CollapsibleIfItem>;
  readonly indirection: ReadonlyArray<IndirectionFinding>;

  // Phase 1 detectors (IMPROVE.md)
  readonly 'temporal-coupling': ReadonlyArray<TemporalCouplingFinding>;
  readonly 'variable-lifetime': ReadonlyArray<
    VariableLifetimeFinding | ScopeNarrowingFinding | LivenessPressureFinding | MutationDensityFinding
  >;
  readonly 'giant-file': ReadonlyArray<GiantFileFinding>;
  // Unified duplicates detector
  readonly duplicates: ReadonlyArray<DuplicateGroup>;
}

export interface FirebatReport {
  readonly meta: FirebatMeta;
  readonly analyses: Partial<FirebatAnalyses>;
  readonly catalog: Readonly<Partial<Record<FirebatCatalogCode, CatalogEntry>>>;
}

export interface FirebatJsonReport {
  readonly detectors: ReadonlyArray<FirebatDetector>;
  readonly errors?: Readonly<Record<string, string>>;
  readonly blockers: number;
  readonly analyses: Partial<FirebatAnalyses>;
}

export const countBlockers = (analyses: Partial<FirebatAnalyses>): number => {
  return Object.values(analyses).reduce((sum, arr) => sum + (arr?.length ?? 0), 0);
};

export const toJsonReport = (report: FirebatReport): FirebatJsonReport => ({
  detectors: report.meta.detectors,
  ...(report.meta.errors !== undefined && Object.keys(report.meta.errors).length > 0 ? { errors: report.meta.errors } : {}),
  blockers: countBlockers(report.analyses),
  analyses: report.analyses,
});

export interface NodeHeader {
  readonly kind: FirebatItemKind;
  readonly header: string;
}
