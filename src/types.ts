export type MinSizeOption = number | 'auto';

export type FirebatDetector =
  | 'waste'
  | 'barrel'
  | 'error-flow'
  | 'dependencies'
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
  | 'WASTE_REDUNDANT_BINDING'
  // barrel (5)
  | 'BARREL_EXPORT_STAR'
  | 'BARREL_DEEP_IMPORT'
  | 'BARREL_MISSING_INDEX'
  | 'BARREL_INVALID_INDEX_STMT'
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
  // error-flow (10)
  | 'EF_THROW_NON_ERROR'
  | 'EF_PROMISE_CONSTRUCTOR_HYGIENE'
  | 'EF_MISSING_ERROR_CAUSE'
  | 'EF_UNSAFE_FINALLY'
  | 'EF_RETURN_AWAIT_IN_TRY'
  | 'EF_UNOBSERVED_PROMISE_FLOATING'
  | 'EF_UNOBSERVED_PROMISE_CATCH_OR_RETURN'
  | 'EF_UNOBSERVED_PROMISE_MISUSED'
  | 'EF_UNOBSERVED_PROMISE_VARIABLE'
  | 'EF_EMPTY_CATCH'
  // indirection (5)
  | 'IND_THIN_WRAPPER'
  | 'IND_FORWARD_CHAIN'
  | 'IND_CROSS_FILE_CHAIN'
  | 'IND_TYPE_REMAP'
  | 'IND_INTERFACE_REWRAP'
  // dependencies (11)
  | 'DEP_LAYER_VIOLATION'
  | 'DEP_DEAD_EXPORT'
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
  | 'DUP_FRAGMENT'
  | 'DUP_SHAPE'
  | 'DUP_NORMALIZED'
  // diagnostics (6)
  | 'DIAG_GOD_FUNCTION'
  | 'DIAG_CIRCULAR_DEPENDENCY'
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
  | 'GIANT_FILE';

export type FirebatItemKind = 'function' | 'method' | 'type' | 'interface' | 'node';

export type WasteKind = 'dead-store' | 'dead-store-overwrite' | 'redundant-binding';

interface SourcePosition {
  readonly line: number;
  readonly column: number;
}

export interface SourceSpan {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export type ErrorFlowFindingKind =
  | 'tool-unavailable'
  | 'throw-non-error'
  | 'promise-constructor-hygiene'
  | 'missing-error-cause'
  | 'unsafe-finally'
  | 'return-await-in-try'
  | 'floating-promises'
  | 'catch-or-return'
  | 'misused-promises'
  | 'unobserved-variable'
  | 'empty-catch';

export interface ErrorFlowFinding {
  readonly kind: ErrorFlowFindingKind;
  readonly file: string;
  readonly span: SourceSpan;
  readonly code?: FirebatCatalogCode;
  readonly evidence: string;
}

export interface DuplicateItem {
  readonly kind: FirebatItemKind;
  readonly header: string;
  readonly filePath: string;
  readonly span: SourceSpan;
}

/** 문장열 클론을 하나의 헬퍼로 추출하기 위한 결정적 계획 (자동수정 아님, 가이드). */
export interface ExtractionPlan {
  /** 헬퍼 파라미터가 될 외부 지역변수 (런이 읽지만 런 밖에서 선언된 것). */
  readonly params: ReadonlyArray<string>;
  /** 헬퍼 반환값 (런 안에서 선언돼 밖에서 쓰이는 단일 바인딩) 또는 void. */
  readonly returns: string | null;
  /** 런이 this를 참조하면 헬퍼는 메서드여야 함. */
  readonly usesThis: boolean;
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

export type DuplicateCloneType = 'exact' | 'shape' | 'normalized' | 'fragment';

export type DuplicateFindingKind = 'exact-clone' | 'structural-clone' | 'literal-variant' | 'type-variant' | 'fragment-clone';

export interface DuplicateGroup {
  readonly cloneType: DuplicateCloneType;
  readonly findingKind: DuplicateFindingKind;
  readonly code?: FirebatCatalogCode;
  readonly items: ReadonlyArray<DuplicateItem>;
  readonly suggestedParams?: CloneDiff;
  /** 문장열 클론을 헬퍼로 추출하는 계획 (fragment-clone 한정). */
  readonly suggestedExtraction?: ExtractionPlan;
}

interface DependencyCycle {
  readonly path: ReadonlyArray<string>;
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
  readonly kind: 'dead-export';
  readonly module: string;
  readonly name: string;
  /** The exported symbol's source location (from the gildash symbol index). */
  readonly span: SourceSpan;
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
  /** Source location of the first surface's symbol (matches `modules[0]`). */
  readonly span: SourceSpan;
}

export interface DependencyUnusedMemberFinding {
  readonly kind: 'unused-enum-member' | 'unused-ns-export' | 'unused-ns-member';
  readonly module: string;
  readonly symbolName: string;
  readonly memberName: string;
  /** The member symbol's source location (from the gildash symbol index). */
  readonly span: SourceSpan;
}

export interface DependencyAnalysis {
  readonly cycles: ReadonlyArray<DependencyCycle>;
  /** Dependency graph adjacency list (module -> direct imports). Keys/values are project-relative paths. */
  readonly adjacency: Readonly<Record<string, ReadonlyArray<string>>>;
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
interface DepLayerViolationFinding {
  readonly code: FirebatCatalogCode;
  readonly kind: 'layer-violation';
  readonly file: string;
  readonly span: SourceSpan;
  readonly from: string;
  readonly to: string;
  readonly fromLayer: string;
  readonly toLayer: string;
}

interface DepDeadExportFinding {
  readonly code: FirebatCatalogCode;
  readonly kind: 'dead-export';
  readonly file: string;
  readonly span: SourceSpan;
  readonly module: string;
  readonly name: string;
}

interface DepCycleFinding {
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

interface DepUnusedFileFinding {
  readonly code: FirebatCatalogCode;
  readonly kind: 'unused-file';
  readonly file: string;
  readonly span: SourceSpan;
  readonly module: string;
}

interface DepUnusedDepFinding {
  readonly code: FirebatCatalogCode;
  readonly kind: 'unused-dependency' | 'unlisted-dependency';
  readonly file: string;
  readonly span: SourceSpan;
  readonly packageName: string;
  readonly files: ReadonlyArray<string>;
}

interface DepUnresolvedImportFinding {
  readonly code: FirebatCatalogCode;
  readonly kind: 'unresolved-import';
  readonly file: string;
  readonly span: SourceSpan;
  readonly module: string;
  readonly specifier: string;
}

interface DepDuplicateExportFinding {
  readonly code: FirebatCatalogCode;
  readonly kind: 'duplicate-export';
  readonly file: string;
  readonly span: SourceSpan;
  readonly name: string;
  readonly modules: ReadonlyArray<string>;
}

interface DepUnusedMemberFinding {
  readonly code: FirebatCatalogCode;
  readonly kind: 'unused-enum-member' | 'unused-ns-export' | 'unused-ns-member';
  readonly file: string;
  readonly span: SourceSpan;
  readonly module: string;
  readonly symbolName: string;
  readonly memberName: string;
}

type DependencyFinding =
  | DepLayerViolationFinding
  | DepDeadExportFinding
  | DepCycleFinding
  | DepUnusedFileFinding
  | DepUnusedDepFinding
  | DepUnresolvedImportFinding
  | DepDuplicateExportFinding
  | DepUnusedMemberFinding;

interface NestingMetrics {
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

/** Metrics shared by nesting-reduction opportunities (early-return, collapsible-if, deep-nesting reduction). */
export interface NestingReductionMetrics {
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
  readonly metrics: NestingReductionMetrics;
  readonly score: number;
}

export interface CollapsibleIfItem {
  readonly kind: 'collapsible-if' | 'collapsible-else-if';
  readonly file: string;
  readonly code?: FirebatCatalogCode;
  readonly header: string;
  readonly span: SourceSpan;
  readonly opportunitySpans?: ReadonlyArray<SourceSpan>;
  readonly metrics: NestingReductionMetrics;
  readonly score: number;
}

export type BarrelFindingKind =
  | 'export-star'
  | 'deep-import'
  | 'missing-index'
  | 'invalid-index-statement'
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

export interface CatalogEntry {
  readonly cause: string;
  readonly think: ReadonlyArray<string>;
}

interface FirebatMeta {
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

interface GiantFileMetrics {
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
  readonly 'error-flow': ReadonlyArray<ErrorFlowFinding>;
  readonly dependencies: ReadonlyArray<DependencyFinding>;
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
  readonly findings: ReadonlyArray<Finding>;
}

// ── Flat Finding schema (agent-optimized scan output) ────────────────────────

/**
 * Agent-optimized finding shape.
 *
 * Optional fields convention (absent = default):
 *   - groupId absent → no group (file-type finding)
 *   - primary absent → true (is primary)
 *   - detail absent → null (no fixer-only data)
 */
export interface Finding {
  readonly id: string;
  readonly category: string;
  readonly code: string;
  readonly file: string;
  readonly line: number;
  readonly kind: string;
  readonly label: string;
  readonly groupId?: string;
  readonly primary?: false;
  readonly detail?: Readonly<Record<string, unknown>>;
}

interface ScanJsonResult {
  readonly meta: {
    readonly detectors: ReadonlyArray<FirebatDetector>;
    readonly errors?: Readonly<Record<string, string>>;
  };
  readonly total: number;
  readonly findings: ReadonlyArray<Finding>;
  /** Remedy guidance for every catalog code present in `findings` — the consumer-facing channel. */
  readonly catalog: FirebatReport['catalog'];
}

export const toScanResult = (report: FirebatReport): ScanJsonResult => ({
  meta: {
    detectors: report.meta.detectors,
    ...(report.meta.errors !== undefined && Object.keys(report.meta.errors).length > 0 ? { errors: report.meta.errors } : {}),
  },
  total: report.findings.length,
  findings: report.findings,
  catalog: report.catalog,
});

export interface NodeHeader {
  readonly kind: FirebatItemKind;
  readonly header: string;
}
