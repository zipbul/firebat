export type OutputFormat = 'text' | 'json';

export type { FirebatConfig } from './firebat-config';

export type MinSizeOption = number | 'auto';

export type FirebatDetector =
  | 'exact-duplicates'
  | 'waste'
  | 'barrel-policy'
  | 'unknown-proof'
  | 'format'
  | 'lint'
  | 'typecheck'
  | 'dependencies'
  | 'coupling'
  | 'structural-duplicates'
  | 'nesting'
  | 'early-return'
  | 'noop'
  | 'api-drift'
  | 'forwarding';

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

export interface DuplicateGroup {
  readonly items: ReadonlyArray<DuplicateItem>;
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

export interface DependencyAnalysis {
  readonly cycles: ReadonlyArray<DependencyCycle>;
  readonly fanInTop: ReadonlyArray<DependencyFanStat>;
  readonly fanOutTop: ReadonlyArray<DependencyFanStat>;
  readonly edgeCutHints: ReadonlyArray<DependencyEdgeCutHint>;
}

export interface CouplingHotspot {
  readonly module: string;
  readonly score: number;
  readonly signals: ReadonlyArray<string>;
}

export interface CouplingAnalysis {
  readonly hotspots: ReadonlyArray<CouplingHotspot>;
}

export interface StructuralDuplicatesAnalysis {
  readonly cloneClasses: ReadonlyArray<DuplicateGroup>;
}

export interface NestingMetrics {
  readonly depth: number;
}

export interface NestingItem {
  readonly filePath: string;
  readonly header: string;
  readonly span: SourceSpan;
  readonly metrics: NestingMetrics;
  readonly score: number;
  readonly suggestions: ReadonlyArray<string>;
}

export interface NestingAnalysis {
  readonly items: ReadonlyArray<NestingItem>;
}

export interface EarlyReturnMetrics {
  readonly earlyReturnCount: number;
  readonly hasGuardClauses: boolean;
}

export interface EarlyReturnItem {
  readonly filePath: string;
  readonly header: string;
  readonly span: SourceSpan;
  readonly metrics: EarlyReturnMetrics;
  readonly score: number;
  readonly suggestions: ReadonlyArray<string>;
}

export interface EarlyReturnAnalysis {
  readonly items: ReadonlyArray<EarlyReturnItem>;
}

export interface NoopFinding {
  readonly kind: string;
  readonly filePath: string;
  readonly span: SourceSpan;
  readonly confidence: number;
  readonly evidence: string;
}

export interface NoopAnalysis {
  readonly findings: ReadonlyArray<NoopFinding>;
}

export type BarrelPolicyFindingKind =
  | 'export-star'
  | 'deep-import'
  | 'index-deep-import'
  | 'missing-index'
  | 'invalid-index-statement';

export interface BarrelPolicyFinding {
  readonly kind: BarrelPolicyFindingKind;
  readonly message: string;
  readonly filePath: string;
  readonly span: SourceSpan;
  readonly evidence?: string;
}

export interface BarrelPolicyAnalysis {
  readonly findings: ReadonlyArray<BarrelPolicyFinding>;
}

export type ForwardingFindingKind = 'thin-wrapper' | 'forward-chain';

export interface ForwardingFinding {
  readonly kind: ForwardingFindingKind;
  readonly filePath: string;
  readonly span: SourceSpan;
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

export interface ApiDriftShape {
  readonly paramsCount: number;
  readonly optionalCount: number;
  readonly returnKind: string;
  readonly async: boolean;
}

export interface ApiDriftOutlier {
  readonly shape: ApiDriftShape;
  readonly filePath: string;
  readonly span: SourceSpan;
}

export interface ApiDriftGroup {
  readonly label: string;
  readonly standardCandidate: ApiDriftShape;
  readonly outliers: ReadonlyArray<ApiDriftOutlier>;
}

export interface ApiDriftAnalysis {
  readonly groups: ReadonlyArray<ApiDriftGroup>;
}

export interface WasteFinding {
  readonly kind: WasteKind;
  readonly label: string;
  readonly message: string;
  readonly filePath: string;
  readonly span: SourceSpan;
}

export type TypecheckSeverity = 'error' | 'warning';

export type TypecheckStatus = 'ok' | 'unavailable' | 'failed';

export type LintStatus = 'ok' | 'unavailable' | 'failed';

export type FormatStatus = 'ok' | 'unavailable' | 'needs-formatting' | 'failed';

export type LintSeverity = 'error' | 'warning' | 'info';

export interface LintDiagnostic {
  readonly filePath?: string;
  readonly message: string;
  readonly code?: string;
  readonly severity: LintSeverity;
  readonly span: SourceSpan;
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
  readonly message: string;
  readonly filePath: string;
  readonly span: SourceSpan;
  readonly lineText: string;
  readonly codeFrame: string;
}

export interface TypecheckAnalysis {
  readonly status: TypecheckStatus;
  readonly tool: 'tsgo';
  readonly exitCode: number | null;
  readonly error?: string;
  readonly items: ReadonlyArray<TypecheckItem>;
}

export type UnknownProofStatus = 'ok' | 'unavailable' | 'failed';

export type UnknownProofFindingKind =
  | 'tool-unavailable'
  | 'type-assertion'
  | 'unknown-type'
  | 'unvalidated-unknown'
  | 'unknown-inferred'
  | 'any-inferred';

export interface UnknownProofFinding {
  readonly kind: UnknownProofFindingKind;
  readonly message: string;
  readonly filePath: string;
  readonly span: SourceSpan;
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

export interface FirebatMeta {
  readonly engine: 'oxc';
  readonly version: string;
  readonly targetCount: number;
  readonly minSize: number;
  readonly maxForwardDepth: number;
  readonly detectors: ReadonlyArray<FirebatDetector>;
  readonly detectorTimings?: Readonly<Record<string, number>>;
}

export interface FirebatAnalyses {
  readonly 'exact-duplicates': ReadonlyArray<DuplicateGroup>;
  readonly waste: ReadonlyArray<WasteFinding>;
  readonly 'barrel-policy': BarrelPolicyAnalysis;
  readonly 'unknown-proof': UnknownProofAnalysis;
  readonly format: FormatAnalysis;
  readonly lint: LintAnalysis;
  readonly typecheck: TypecheckAnalysis;
  readonly dependencies: DependencyAnalysis;
  readonly coupling: CouplingAnalysis;
  readonly 'structural-duplicates': StructuralDuplicatesAnalysis;
  readonly nesting: NestingAnalysis;
  readonly 'early-return': EarlyReturnAnalysis;
  readonly noop: NoopAnalysis;
  readonly 'api-drift': ApiDriftAnalysis;
  readonly forwarding: ForwardingAnalysis;
}

export interface FirebatReport {
  readonly meta: FirebatMeta;
  readonly analyses: Partial<FirebatAnalyses>;
}

export interface NodeHeader {
  readonly kind: FirebatItemKind;
  readonly header: string;
}
