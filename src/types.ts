export type OutputFormat = 'text' | 'json';

export type { FirebatConfig } from './firebat-config';

export type MinSizeOption = number | 'auto';

export type FirebatDetector =
  | 'duplicates'
  | 'waste'
  | 'typecheck'
  | 'dependencies'
  | 'coupling'
  | 'duplication'
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
  readonly size: number;
}

export interface DuplicateGroup {
  readonly fingerprint: string;
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

export interface DuplicationAnalysis {
  readonly cloneClasses: ReadonlyArray<DuplicateGroup>;
}

export interface NestingMetrics {
  readonly depth: number;
  readonly decisionPoints: number;
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
  readonly filePath: string;
  readonly span: SourceSpan;
}

export type TypecheckSeverity = 'error' | 'warning';

export type TypecheckStatus = 'ok' | 'unavailable' | 'failed';

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
  readonly tool: 'tsc';
  readonly exitCode: number | null;
  readonly items: ReadonlyArray<TypecheckItem>;
}

export interface FirebatMeta {
  readonly engine: 'oxc';
  readonly version: string;
  readonly targetCount: number;
  readonly minSize: number;
  readonly maxForwardDepth: number;
  readonly detectors: ReadonlyArray<FirebatDetector>;
}

export interface FirebatAnalyses {
  readonly duplicates: ReadonlyArray<DuplicateGroup>;
  readonly waste: ReadonlyArray<WasteFinding>;
  readonly typecheck: TypecheckAnalysis;
  readonly dependencies: DependencyAnalysis;
  readonly coupling: CouplingAnalysis;
  readonly duplication: DuplicationAnalysis;
  readonly nesting: NestingAnalysis;
  readonly earlyReturn: EarlyReturnAnalysis;
  readonly noop: NoopAnalysis;
  readonly apiDrift: ApiDriftAnalysis;
  readonly forwarding: ForwardingAnalysis;
}

export interface FirebatReport {
  readonly meta: FirebatMeta;
  readonly analyses: FirebatAnalyses;
}

export interface NodeHeader {
  readonly kind: FirebatItemKind;
  readonly header: string;
}
