import type { ExceptionHygieneFinding } from './features/exception-hygiene/types';

export type OutputFormat = 'text' | 'json';

export type { FirebatConfig } from './shared/firebat-config';

export type MinSizeOption = number | 'auto';

export type FirebatDetector =
  | 'exact-duplicates'
  | 'waste'
  | 'barrel-policy'
  | 'unknown-proof'
  | 'exception-hygiene'
  | 'format'
  | 'lint'
  | 'typecheck'
  | 'dependencies'
  | 'coupling'
  | 'structural-duplicates'
  | 'nesting'
  | 'early-return'
  | 'noop'
  | 'forwarding'
  // Phase 1 detectors (IMPROVE.md)
  | 'implicit-state'
  | 'temporal-coupling'
  | 'symmetry-breaking'
  | 'invariant-blindspot'
  | 'modification-trap'
  | 'modification-impact'
  | 'variable-lifetime'
  | 'decision-surface'
  | 'implementation-overhead'
  | 'concept-scatter'
  | 'abstraction-fitness'
  | 'giant-file';

export type FirebatCatalogCode =
  // waste (3)
  | 'WASTE_DEAD_STORE'
  | 'WASTE_DEAD_STORE_OVERWRITE'
  | 'WASTE_MEMORY_RETENTION'
  // noop (5)
  | 'NOOP_EXPRESSION'
  | 'NOOP_SELF_ASSIGNMENT'
  | 'NOOP_CONSTANT_CONDITION'
  | 'NOOP_EMPTY_CATCH'
  | 'NOOP_EMPTY_FUNCTION_BODY'
  // barrel-policy (6)
  | 'BARREL_EXPORT_STAR'
  | 'BARREL_DEEP_IMPORT'
  | 'BARREL_INDEX_DEEP_IMPORT'
  | 'BARREL_MISSING_INDEX'
  | 'BARREL_INVALID_INDEX_STMT'
  | 'BARREL_SIDE_EFFECT_IMPORT'
  // nesting (4)
  | 'NESTING_DEEP'
  | 'NESTING_HIGH_CC'
  | 'NESTING_ACCIDENTAL_QUADRATIC'
  | 'NESTING_CALLBACK_DEPTH'
  // early-return (2)
  | 'EARLY_RETURN_INVERTIBLE'
  | 'EARLY_RETURN_MISSING_GUARD'
  // exception-hygiene (17)
  | 'EH_THROW_NON_ERROR'
  | 'EH_ASYNC_PROMISE_EXECUTOR'
  | 'EH_MISSING_ERROR_CAUSE'
  | 'EH_USELESS_CATCH'
  | 'EH_UNSAFE_FINALLY'
  | 'EH_RETURN_IN_FINALLY'
  | 'EH_CATCH_OR_RETURN'
  | 'EH_PREFER_CATCH'
  | 'EH_PREFER_AWAIT_TO_THEN'
  | 'EH_FLOATING_PROMISES'
  | 'EH_MISUSED_PROMISES'
  | 'EH_RETURN_AWAIT_POLICY'
  | 'EH_SILENT_CATCH'
  | 'EH_CATCH_TRANSFORM'
  | 'EH_REDUNDANT_NESTED_CATCH'
  | 'EH_OVERSCOPED_TRY'
  | 'EH_EXCEPTION_CONTROL_FLOW'
  // unknown-proof (6)
  | 'UNKNOWN_TYPE_ASSERTION'
  | 'UNKNOWN_DOUBLE_ASSERTION'
  | 'UNKNOWN_UNNARROWED'
  | 'UNKNOWN_UNVALIDATED'
  | 'UNKNOWN_INFERRED'
  | 'UNKNOWN_ANY_INFERRED'
  // forwarding (3)
  | 'FWD_THIN_WRAPPER'
  | 'FWD_FORWARD_CHAIN'
  | 'FWD_CROSS_FILE_CHAIN'
  // coupling (5)
  | 'COUPLING_GOD_MODULE'
  | 'COUPLING_BIDIRECTIONAL'
  | 'COUPLING_OFF_MAIN_SEQ'
  | 'COUPLING_UNSTABLE'
  | 'COUPLING_RIGID'
  // dependencies (3)
  | 'DEP_LAYER_VIOLATION'
  | 'DEP_DEAD_EXPORT'
  | 'DEP_TEST_ONLY_EXPORT'
  // duplicates (3)
  | 'EXACT_DUP_TYPE_1'
  | 'STRUCT_DUP_TYPE_2_SHAPE'
  | 'STRUCT_DUP_TYPE_3_NORMALIZED'
  // diagnostics (7)
  | 'DIAG_GOD_FUNCTION'
  | 'DIAG_CIRCULAR_DEPENDENCY'
  | 'DIAG_GOD_MODULE'
  | 'DIAG_DATA_CLUMP'
  | 'DIAG_SHOTGUN_SURGERY'
  | 'DIAG_OVER_INDIRECTION'
  | 'DIAG_MIXED_ABSTRACTION'
  // Phase 1 detectors (12)
  | 'IMPLICIT_STATE'
  | 'TEMPORAL_COUPLING'
  | 'SYMMETRY_BREAK'
  | 'INVARIANT_BLINDSPOT'
  | 'MOD_TRAP'
  | 'MOD_IMPACT'
  | 'VAR_LIFETIME'
  | 'DECISION_SURFACE'
  | 'IMPL_OVERHEAD'
  | 'CONCEPT_SCATTER'
  | 'ABSTRACTION_FITNESS'
  | 'GIANT_FILE'
  // external tools (3)
  | 'LINT'
  | 'FORMAT'
  | 'TYPECHECK';

export type FirebatItemKind = 'function' | 'method' | 'type' | 'interface' | 'node';

export type WasteKind = 'dead-store' | 'dead-store-overwrite' | 'memory-retention';

export interface SourcePosition {
  readonly line: number;
  readonly column: number;
}

export interface SourceSpan {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export interface ItemFinding {
  readonly code: FirebatCatalogCode;
  readonly file: string;
  readonly span: SourceSpan;
}

export interface GroupFinding {
  readonly code: FirebatCatalogCode;
  readonly items: ReadonlyArray<{
    readonly file: string;
    readonly span: SourceSpan;
  }>;
}

export type NoopKind =
  | 'expression-noop'
  | 'self-assignment'
  | 'constant-condition'
  | 'empty-catch'
  | 'empty-function-body';

export type CouplingKind =
  | 'god-module'
  | 'bidirectional-coupling'
  | 'off-main-sequence'
  | 'unstable-module'
  | 'rigid-module';

export type FirebatTraceNodeKind = 'file' | 'symbol' | 'type' | 'reference' | 'unknown';

export interface FirebatTraceNode {
  readonly id: string;
  readonly kind: FirebatTraceNodeKind;
  readonly label: string;
  readonly filePath?: string;
  readonly span?: SourceSpan;
}

export type FirebatTraceEdgeKind = 'references' | 'imports' | 'exports' | 'calls' | 'type-of' | 'unknown';

export interface FirebatTraceEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: FirebatTraceEdgeKind;
  readonly label?: string;
}

export interface FirebatTraceGraph {
  readonly nodes: ReadonlyArray<FirebatTraceNode>;
  readonly edges: ReadonlyArray<FirebatTraceEdge>;
}

export interface FirebatTraceEvidenceSpan {
  readonly filePath: string;
  readonly span: SourceSpan;
  readonly text?: string;
}

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

export type DuplicateCloneType = 'type-1' | 'type-2' | 'type-2-shape' | 'type-3-normalized';

export interface DuplicateGroup {
  readonly cloneType: DuplicateCloneType;
  readonly code?: FirebatCatalogCode;
  readonly items: ReadonlyArray<DuplicateItem>;
  readonly suggestedParams?: CloneDiff;
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

export type DependencyFinding =
  | DepLayerViolationFinding
  | DepDeadExportFinding
  | DepCycleFinding;

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

export interface CouplingAnalysis {
  readonly hotspots: ReadonlyArray<CouplingHotspot>;
}

export interface NestingMetrics {
  readonly depth: number;
  readonly cognitiveComplexity: number;
  readonly callbackDepth: number;
  readonly quadraticTargets: ReadonlyArray<string>;
}

export type NestingKind = 'deep-nesting' | 'high-cognitive-complexity' | 'accidental-quadratic' | 'callback-depth';

export interface NestingItem {
  readonly kind: NestingKind;
  readonly file: string;
  readonly code?: FirebatCatalogCode;
  readonly header: string;
  readonly span: SourceSpan;
  readonly metrics: NestingMetrics;
  readonly score: number;
}

export interface EarlyReturnMetrics {
  readonly returns: number;
  readonly hasGuards: boolean;
  readonly guards: number;
}

export type EarlyReturnKind = 'invertible-if-else' | 'missing-guard';

export interface EarlyReturnItem {
  readonly kind: EarlyReturnKind;
  readonly file: string;
  readonly code?: FirebatCatalogCode;
  readonly header: string;
  readonly span: SourceSpan;
  readonly metrics: EarlyReturnMetrics;
  readonly score: number;
}

export interface NoopFinding {
  readonly kind: NoopKind;
  readonly file: string;
  readonly span: SourceSpan;
  readonly code?: FirebatCatalogCode;
  readonly confidence: number;
  readonly evidence: string;
}

export type BarrelPolicyFindingKind =
  | 'export-star'
  | 'deep-import'
  | 'index-deep-import'
  | 'missing-index'
  | 'invalid-index-statement'
  | 'barrel-side-effect-import';

export interface BarrelPolicyFinding {
  readonly kind: BarrelPolicyFindingKind;
  readonly file: string;
  readonly span: SourceSpan;
  readonly code?: FirebatCatalogCode;
  readonly evidence?: string;
}

export type ForwardingFindingKind = 'thin-wrapper' | 'forward-chain' | 'cross-file-forwarding-chain';

export interface ForwardingFinding {
  readonly kind: ForwardingFindingKind;
  readonly filePath: string;
  readonly span: SourceSpan;
  readonly code?: FirebatCatalogCode;
  readonly header: string;
  readonly depth: number;
  readonly evidence: string;
}

export interface ForwardingParamsInfo {
  readonly params: ReadonlyArray<string>;
  readonly restParam: string | null;
}

export interface ForwardingAnalysis {
  readonly findings: ReadonlyArray<ForwardingFinding>;
}

export interface WasteFinding {
  readonly kind: WasteKind;
  readonly label: string;
  readonly message: string;
  readonly filePath: string;
  readonly span: SourceSpan;
  readonly code?: FirebatCatalogCode;
  readonly confidence?: number;
}

export type TypecheckSeverity = 'error' | 'warning';

export type TypecheckStatus = 'ok' | 'unavailable' | 'failed';

export type LintStatus = 'ok' | 'unavailable' | 'failed';

export type FormatStatus = 'ok' | 'unavailable' | 'needs-formatting' | 'failed';

export type LintSeverity = 'error' | 'warning' | 'info';

export interface LintDiagnostic {
  readonly file?: string;
  readonly msg: string;
  readonly code?: string;
  readonly severity: LintSeverity;
  readonly span: SourceSpan;
  readonly catalogCode?: FirebatCatalogCode;
}

export interface LintAnalysis {
  readonly status: LintStatus;
  readonly tool: 'oxlint';
  readonly exitCode?: number;
  readonly error?: string;
  readonly diagnostics: ReadonlyArray<LintDiagnostic>;
}

export interface FormatAnalysis {
  readonly status: FormatStatus;
  readonly tool: 'oxfmt';
  readonly exitCode?: number;
  readonly error?: string;
  readonly fileCount?: number;
}

export interface TypecheckRunResult {
  readonly exitCode: number | null;
  readonly combinedOutput: string;
  readonly status: TypecheckStatus;
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

export type UnknownProofStatus = 'ok' | 'unavailable' | 'failed';

export type UnknownProofFindingKind =
  | 'tool-unavailable'
  | 'type-assertion'
  | 'double-assertion'
  | 'unknown-type'
  | 'unvalidated-unknown'
  | 'unknown-inferred'
  | 'any-inferred';

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

export interface UnknownProofAnalysis {
  readonly status: UnknownProofStatus;
  readonly tool: 'tsgo';
  readonly error?: string;
  readonly findings: ReadonlyArray<UnknownProofFinding>;
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

export interface ImplicitStateFinding {
  readonly kind: 'implicit-state';
  readonly file: string;
  readonly span: SourceSpan;
  readonly code?: FirebatCatalogCode;
  readonly protocol: string;
  readonly key?: string;
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

export interface SymmetryBreakingFinding {
  readonly kind: 'symmetry-breaking';
  readonly file: string;
  readonly span: SourceSpan;
  readonly code?: FirebatCatalogCode;
  readonly group: string;
  readonly signature: string;
  readonly majorityCount: number;
  readonly outlierCount: number;
}

export interface InvariantBlindspotFinding {
  readonly kind: 'invariant-blindspot';
  readonly file: string;
  readonly span: SourceSpan;
  readonly code?: FirebatCatalogCode;
  readonly signal: string;
}

export interface ModificationTrapFinding {
  readonly kind: 'modification-trap';
  readonly file: string;
  readonly span: SourceSpan;
  readonly code?: FirebatCatalogCode;
  readonly pattern: string;
  readonly occurrences: number;
}

export interface ModificationImpactFinding {
  readonly kind: 'modification-impact';
  readonly file: string;
  readonly span: SourceSpan;
  readonly code?: FirebatCatalogCode;
  readonly impactRadius: number;
  readonly highRiskCallers: ReadonlyArray<string>;
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

export interface DecisionSurfaceFinding {
  readonly kind: 'decision-surface';
  readonly file: string;
  readonly span: SourceSpan;
  readonly code?: FirebatCatalogCode;
  readonly axes: number;
  readonly combinatorialPaths: number;
  readonly repeatedChecks: number;
}

export interface ImplementationOverheadFinding {
  readonly kind: 'implementation-overhead';
  readonly file: string;
  readonly span: SourceSpan;
  readonly code?: FirebatCatalogCode;
  readonly interfaceComplexity: number;
  readonly implementationComplexity: number;
  readonly ratio: number;
}

export interface ConceptScatterFinding {
  readonly kind: 'concept-scatter';
  readonly file: string;
  readonly span: SourceSpan;
  readonly code?: FirebatCatalogCode;
  readonly concept: string;
  readonly scatterIndex: number;
  readonly files: ReadonlyArray<string>;
  readonly layers: ReadonlyArray<string>;
}

export interface AbstractionFitnessFinding {
  readonly kind: 'abstraction-fitness';
  readonly file: string;
  readonly span: SourceSpan;
  readonly code?: FirebatCatalogCode;
  readonly module: string;
  readonly internalCohesion: number;
  readonly externalCoupling: number;
  readonly fitness: number;
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
  readonly 'exact-duplicates': ReadonlyArray<DuplicateGroup>;
  readonly waste: ReadonlyArray<WasteFinding>;
  readonly 'barrel-policy': ReadonlyArray<BarrelPolicyFinding>;
  readonly 'unknown-proof': ReadonlyArray<UnknownProofFinding>;
  readonly 'exception-hygiene': ReadonlyArray<ExceptionHygieneFinding>;
  readonly format: ReadonlyArray<FormatFinding>;
  readonly lint: ReadonlyArray<LintDiagnostic>;
  readonly typecheck: ReadonlyArray<TypecheckItem>;
  readonly dependencies: ReadonlyArray<DependencyFinding>;
  readonly coupling: ReadonlyArray<CouplingHotspot>;
  readonly 'structural-duplicates': ReadonlyArray<DuplicateGroup>;
  readonly nesting: ReadonlyArray<NestingItem>;
  readonly 'early-return': ReadonlyArray<EarlyReturnItem>;
  readonly noop: ReadonlyArray<NoopFinding>;
  readonly forwarding: ReadonlyArray<ForwardingFinding>;

  // Phase 1 detectors (IMPROVE.md)
  readonly 'implicit-state': ReadonlyArray<ImplicitStateFinding>;
  readonly 'temporal-coupling': ReadonlyArray<TemporalCouplingFinding>;
  readonly 'symmetry-breaking': ReadonlyArray<SymmetryBreakingFinding>;
  readonly 'invariant-blindspot': ReadonlyArray<InvariantBlindspotFinding>;
  readonly 'modification-trap': ReadonlyArray<ModificationTrapFinding>;
  readonly 'modification-impact': ReadonlyArray<ModificationImpactFinding>;
  readonly 'variable-lifetime': ReadonlyArray<VariableLifetimeFinding>;
  readonly 'decision-surface': ReadonlyArray<DecisionSurfaceFinding>;
  readonly 'implementation-overhead': ReadonlyArray<ImplementationOverheadFinding>;
  readonly 'concept-scatter': ReadonlyArray<ConceptScatterFinding>;
  readonly 'abstraction-fitness': ReadonlyArray<AbstractionFitnessFinding>;
  readonly 'giant-file': ReadonlyArray<GiantFileFinding>;
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
  readonly catalog: Readonly<Partial<Record<FirebatCatalogCode, CatalogEntry>>>;
}

export const countBlockers = (analyses: Partial<FirebatAnalyses>): number => {
  return Object.values(analyses).reduce((sum, arr) => sum + (arr?.length ?? 0), 0);
};

export const toJsonReport = (report: FirebatReport): FirebatJsonReport => ({
  detectors: report.meta.detectors,
  ...(report.meta.errors !== undefined && Object.keys(report.meta.errors).length > 0
    ? { errors: report.meta.errors }
    : {}),
  blockers: countBlockers(report.analyses),
  analyses: report.analyses,
  catalog: report.catalog,
});

export interface NodeHeader {
  readonly kind: FirebatItemKind;
  readonly header: string;
}
