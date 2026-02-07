import * as path from 'node:path';

import type {
  ApiDriftGroup,
  BarrelPolicyFinding,
  CouplingHotspot,
  DependencyAnalysis,
  DependencyEdgeCutHint,
  DependencyFanStat,
  DuplicateGroup,
  EarlyReturnItem,
  ForwardingFinding,
  FirebatReport,
  FormatAnalysis,
  LintAnalysis,
  NestingItem,
  NoopFinding,
  OutputFormat,
  TypecheckItem,
  UnknownProofFinding,
  WasteFinding,
} from './types';

const toPos = (line: number, column: number): string => `${line}:${column}`;

const formatDuplicateGroupText = (group: DuplicateGroup): string => {
  const lines: string[] = [];

  lines.push(`[duplicates] ${group.items.length} item(s)`);

  for (const item of group.items) {
    const rel = path.relative(process.cwd(), item.filePath);
    const start = toPos(item.span.start.line, item.span.start.column);

    lines.push(`  - ${item.kind}: ${item.header} @ ${rel}:${start} (size: ${item.size})`);
  }

  return lines.join('\n');
};

const formatDuplicateGroupTextWithLabel = (label: string, group: DuplicateGroup): string => {
  const lines: string[] = [];

  lines.push(`[${label}] ${group.items.length} item(s)`);

  for (const item of group.items) {
    const rel = path.relative(process.cwd(), item.filePath);
    const start = toPos(item.span.start.line, item.span.start.column);

    lines.push(`  - ${item.kind}: ${item.header} @ ${rel}:${start} (size: ${item.size})`);
  }

  return lines.join('\n');
};

const formatWasteText = (finding: WasteFinding): string => {
  const rel = path.relative(process.cwd(), finding.filePath);
  const start = toPos(finding.span.start.line, finding.span.start.column);

  return `[waste] ${finding.kind}: ${finding.label} @ ${rel}:${start}`;
};

const formatBarrelPolicyFindingText = (finding: BarrelPolicyFinding): string => {
  const rel = path.relative(process.cwd(), finding.filePath);
  const start = toPos(finding.span.start.line, finding.span.start.column);
  const evidence = typeof finding.evidence === 'string' && finding.evidence.length > 0 ? ` evidence=${finding.evidence}` : '';

  return `  - ${finding.kind}: ${finding.message} @ ${rel}:${start}${evidence}`;
};

const formatDependencyFanStatText = (stat: DependencyFanStat): string => `  - ${stat.module}: ${stat.count}`;

const formatDependencyEdgeCutHintText = (hint: DependencyEdgeCutHint): string => {
  const score = typeof hint.score === 'number' ? hint.score : 0;
  const reason = typeof hint.reason === 'string' ? hint.reason : '';

  if (reason.length > 0) {
    return `  - ${hint.from} -> ${hint.to} (score=${score}, reason=${reason})`;
  }

  return `  - ${hint.from} -> ${hint.to} (score=${score})`;
};

const formatDependenciesText = (analysis: DependencyAnalysis): string => {
  const lines: string[] = [];

  lines.push(
    `[dependencies] cycles=${analysis.cycles.length} fanInTop=${analysis.fanInTop.length} fanOutTop=${analysis.fanOutTop.length} edgeCutHints=${analysis.edgeCutHints.length}`,
  );

  if (analysis.cycles.length > 0) {
    lines.push('');
    lines.push('[dependencies] cycles');

    for (const cycle of analysis.cycles) {
      lines.push(`  - ${cycle.path.join(' -> ')}`);
    }
  }

  if (analysis.fanInTop.length > 0) {
    lines.push('');
    lines.push('[dependencies] fan-in top');

    for (const stat of analysis.fanInTop) {
      lines.push(formatDependencyFanStatText(stat));
    }
  }

  if (analysis.fanOutTop.length > 0) {
    lines.push('');
    lines.push('[dependencies] fan-out top');

    for (const stat of analysis.fanOutTop) {
      lines.push(formatDependencyFanStatText(stat));
    }
  }

  if (analysis.edgeCutHints.length > 0) {
    lines.push('');
    lines.push('[dependencies] edge cut hints');

    for (const hint of analysis.edgeCutHints) {
      lines.push(formatDependencyEdgeCutHintText(hint));
    }
  }

  return lines.join('\n');
};

const formatCouplingHotspotText = (hotspot: CouplingHotspot): string => {
  const signals = hotspot.signals.join(',');

  return `  - ${hotspot.module}: score=${hotspot.score} signals=${signals}`;
};

const formatCouplingText = (hotspots: ReadonlyArray<CouplingHotspot>): string => {
  const lines: string[] = [];

  lines.push(`[coupling] hotspots=${hotspots.length}`);

  if (hotspots.length === 0) {
    return lines.join('\n');
  }

  for (const hotspot of hotspots) {
    lines.push(formatCouplingHotspotText(hotspot));
  }

  return lines.join('\n');
};

const formatNestingItemText = (item: NestingItem): string => {
  const rel = path.relative(process.cwd(), item.filePath);
  const start = toPos(item.span.start.line, item.span.start.column);
  const suggestions = item.suggestions.join('; ');

  if (suggestions.length > 0) {
    return `  - ${item.header} @ ${rel}:${start} depth=${item.metrics.depth} decisionPoints=${item.metrics.decisionPoints} score=${item.score} suggestions=${suggestions}`;
  }

  return `  - ${item.header} @ ${rel}:${start} depth=${item.metrics.depth} decisionPoints=${item.metrics.decisionPoints} score=${item.score}`;
};

const formatEarlyReturnItemText = (item: EarlyReturnItem): string => {
  const rel = path.relative(process.cwd(), item.filePath);
  const start = toPos(item.span.start.line, item.span.start.column);
  const suggestions = item.suggestions.join('; ');
  const guard = item.metrics.hasGuardClauses ? 'true' : 'false';

  if (suggestions.length > 0) {
    return `  - ${item.header} @ ${rel}:${start} earlyReturns=${item.metrics.earlyReturnCount} guardClauses=${guard} score=${item.score} suggestions=${suggestions}`;
  }

  return `  - ${item.header} @ ${rel}:${start} earlyReturns=${item.metrics.earlyReturnCount} guardClauses=${guard} score=${item.score}`;
};

const formatNoopFindingText = (finding: NoopFinding): string => {
  const rel = path.relative(process.cwd(), finding.filePath);
  const start = toPos(finding.span.start.line, finding.span.start.column);

  return `  - ${finding.kind} @ ${rel}:${start} confidence=${finding.confidence} evidence=${finding.evidence}`;
};

const formatForwardingFindingText = (finding: ForwardingFinding): string => {
  const rel = path.relative(process.cwd(), finding.filePath);
  const start = toPos(finding.span.start.line, finding.span.start.column);

  return `  - ${finding.kind}: ${finding.header} @ ${rel}:${start} depth=${finding.depth} evidence=${finding.evidence}`;
};

const formatApiDriftGroupText = (group: ApiDriftGroup): string => {
  const shape = group.standardCandidate;
  const outliers = group.outliers.map(outlier => outlier.shape);
  const outlierSummary = outliers
    .map(outlier => `(${outlier.paramsCount},${outlier.optionalCount},${outlier.returnKind},${outlier.async ? 'async' : 'sync'})`)
    .join(' ');

  return `  - ${group.label}: standard=(${shape.paramsCount},${shape.optionalCount},${shape.returnKind},${shape.async ? 'async' : 'sync'}) outliers=${group.outliers.length}${outlierSummary.length > 0 ? ` ${outlierSummary}` : ''}`;
};

const formatTypecheckItemText = (item: TypecheckItem): string => {
  const rel = item.filePath.length > 0 ? path.relative(process.cwd(), item.filePath) : '<unknown>';
  const start = toPos(item.span.start.line, item.span.start.column);

  return `  - ${item.severity} ${item.code}: ${item.message} @ ${rel}:${start}`;
};

const formatLintText = (analysis: LintAnalysis): string => {
  const total = analysis.diagnostics.length;
  const errors = analysis.diagnostics.filter(d => d.severity === 'error').length;

  return `[lint] tool=${analysis.tool} status=${analysis.status} diagnostics=${total} errors=${errors}`;
};

const formatFormatText = (analysis: FormatAnalysis): string => {
  const exitCode = typeof analysis.exitCode === 'number' ? analysis.exitCode : 0;
  return `[format] tool=${analysis.tool} status=${analysis.status} exitCode=${exitCode}`;
};

const formatUnknownProofFindingText = (finding: UnknownProofFinding): string => {
  const rel = path.relative(process.cwd(), finding.filePath);
  const start = toPos(finding.span.start.line, finding.span.start.column);
  const symbol = typeof finding.symbol === 'string' && finding.symbol.length > 0 ? ` symbol=${finding.symbol}` : '';
  const typeText = typeof finding.typeText === 'string' && finding.typeText.length > 0 ? ` type=${finding.typeText}` : '';
  const evidence = typeof finding.evidence === 'string' && finding.evidence.length > 0 ? ` evidence=${finding.evidence}` : '';

  return `  - ${finding.kind}: ${finding.message} @ ${rel}:${start}${symbol}${typeText}${evidence}`;
};

const formatText = (report: FirebatReport): string => {
  const lines: string[] = [];
  const detectors = report.meta.detectors.join(',');
  const duplicates = report.analyses['exact-duplicates'];
  const waste = report.analyses.waste;
  const barrelPolicyFindings = report.analyses.barrelPolicy.findings.length;
  const unknownProof = report.analyses.unknownProof;
  const lint = report.analyses.lint;
  const format = report.analyses.format;
  const selectedDetectors = new Set(report.meta.detectors);
  const typecheckItems = report.analyses.typecheck.items;
  const typecheckErrors = typecheckItems.filter(item => item.severity === 'error').length;
  const typecheckWarnings = typecheckItems.filter(item => item.severity === 'warning').length;
  const lintErrors = lint.diagnostics.filter(d => d.severity === 'error').length;
  const unknownProofFindings = unknownProof.findings.length;

  lines.push(
    `[firebat] engine=${report.meta.engine} version=${report.meta.version} detectors=${detectors} minSize=${report.meta.minSize} duplicates=${duplicates.length} waste=${waste.length} barrelPolicyFindings=${barrelPolicyFindings} formatStatus=${format.status} unknownProofFindings=${unknownProofFindings} lintErrors=${lintErrors} typecheckErrors=${typecheckErrors} typecheckWarnings=${typecheckWarnings}`,
  );

  if (selectedDetectors.has('unknown-proof')) {
    const defaultBoundaryGlobs = 'global';
    lines.push(`[unknown-proof] status=${unknownProof.status} tool=${unknownProof.tool} findings=${unknownProof.findings.length}`);
    lines.push(
      `[unknown-proof] rules=no-type-assertion; no-explicit-unknown-outside-boundary; boundary-unknown-must-narrow-before-propagation; no-inferred-unknown/any-outside-boundary(tsgo)`
    );
    lines.push(
      `[unknown-proof] boundaryGlobs=config.features["unknown-proof"].boundaryGlobs (default=${defaultBoundaryGlobs})`
    );

    if (typeof unknownProof.error === 'string' && unknownProof.error.length > 0) {
      lines.push(`[unknown-proof] error=${unknownProof.error}`);
    }
  }

  if (selectedDetectors.has('lint')) {
    lines.push(formatLintText(report.analyses.lint));
  }

  if (selectedDetectors.has('format')) {
    lines.push(formatFormatText(report.analyses.format));
  }

  if (selectedDetectors.has('barrel-policy')) {
    lines.push(`[barrel-policy] findings=${report.analyses.barrelPolicy.findings.length}`);
  }

  if (selectedDetectors.has('typecheck')) {
    lines.push(`[typecheck] items=${typecheckItems.length} status=${report.analyses.typecheck.status} tool=${report.analyses.typecheck.tool}`);
  }

  if (selectedDetectors.has('dependencies')) {
    lines.push(
      `[dependencies] cycles=${report.analyses.dependencies.cycles.length} fanInTop=${report.analyses.dependencies.fanInTop.length} fanOutTop=${report.analyses.dependencies.fanOutTop.length} edgeCutHints=${report.analyses.dependencies.edgeCutHints.length}`,
    );
  }

  if (selectedDetectors.has('coupling')) {
    lines.push(`[coupling] hotspots=${report.analyses.coupling.hotspots.length}`);
  }

  if (selectedDetectors.has('structural-duplicates')) {
    lines.push(`[structural-duplicates] cloneClasses=${report.analyses['structural-duplicates'].cloneClasses.length}`);
  }

  if (selectedDetectors.has('nesting')) {
    lines.push(`[nesting] items=${report.analyses.nesting.items.length}`);
  }

  if (selectedDetectors.has('early-return')) {
    lines.push(`[early-return] items=${report.analyses.earlyReturn.items.length}`);
  }

  if (selectedDetectors.has('noop')) {
    lines.push(`[noop] findings=${report.analyses.noop.findings.length}`);
  }

  if (selectedDetectors.has('forwarding')) {
    lines.push(`[forwarding] findings=${report.analyses.forwarding.findings.length} maxDepth=${report.meta.maxForwardDepth}`);
  }

  if (selectedDetectors.has('api-drift')) {
    lines.push(`[api-drift] groups=${report.analyses.apiDrift.groups.length}`);
  }

  for (const group of duplicates) {
    lines.push('');
    lines.push(formatDuplicateGroupText(group));
  }

  for (const finding of waste) {
    lines.push('');
    lines.push(formatWasteText(finding));
  }

  if (selectedDetectors.has('barrel-policy')) {
    const findings = report.analyses.barrelPolicy.findings;

    lines.push('');
    lines.push(`[barrel-policy] findings=${findings.length}`);

    for (const finding of findings) {
      lines.push(formatBarrelPolicyFindingText(finding));
    }
  }

  if (selectedDetectors.has('unknown-proof')) {
    const findings = report.analyses.unknownProof.findings;
    const byKind = new Map<string, number>();

    for (const f of findings) {
      byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1);
    }

    const kindSummary = [...byKind.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');

    lines.push('');
    lines.push(
      `[unknown-proof] findings=${findings.length} status=${report.analyses.unknownProof.status}${kindSummary.length > 0 ? ` kinds=${kindSummary}` : ''}`,
    );

    for (const finding of findings) {
      lines.push(formatUnknownProofFindingText(finding));
    }
  }

  if (selectedDetectors.has('typecheck')) {
    lines.push('');
    lines.push(`[typecheck] items=${typecheckItems.length}`);

    for (const item of typecheckItems) {
      lines.push(formatTypecheckItemText(item));

      if (item.codeFrame.length > 0) {
        lines.push(item.codeFrame.split('\n').map(line => `      ${line}`).join('\n'));
      }
    }
  }

  if (selectedDetectors.has('dependencies')) {
    lines.push('');
    lines.push(formatDependenciesText(report.analyses.dependencies));
  }

  if (selectedDetectors.has('coupling')) {
    lines.push('');
    lines.push(formatCouplingText(report.analyses.coupling.hotspots));
  }

  if (selectedDetectors.has('structural-duplicates')) {
    const cloneClasses = report.analyses['structural-duplicates'].cloneClasses;

    lines.push('');
    lines.push(`[structural-duplicates] cloneClasses=${cloneClasses.length}`);

    for (const group of cloneClasses) {
      lines.push('');
      lines.push(formatDuplicateGroupTextWithLabel('structural-duplicates', group));
    }
  }

  if (selectedDetectors.has('nesting')) {
    const items = report.analyses.nesting.items;

    lines.push('');
    lines.push(`[nesting] items=${items.length}`);

    for (const item of items) {
      lines.push(formatNestingItemText(item));
    }
  }

  if (selectedDetectors.has('early-return')) {
    const items = report.analyses.earlyReturn.items;

    lines.push('');
    lines.push(`[early-return] items=${items.length}`);

    for (const item of items) {
      lines.push(formatEarlyReturnItemText(item));
    }
  }

  if (selectedDetectors.has('noop')) {
    const findings = report.analyses.noop.findings;

    lines.push('');
    lines.push(`[noop] findings=${findings.length}`);

    for (const finding of findings) {
      lines.push(formatNoopFindingText(finding));
    }
  }

  if (selectedDetectors.has('api-drift')) {
    const groups = report.analyses.apiDrift.groups;

    lines.push('');
    lines.push(`[api-drift] groups=${groups.length}`);

    for (const group of groups) {
      lines.push(formatApiDriftGroupText(group));
    }
  }

  if (selectedDetectors.has('forwarding')) {
    const findings = report.analyses.forwarding.findings;

    lines.push('');
    lines.push(`[forwarding] findings=${findings.length}`);

    for (const finding of findings) {
      lines.push(formatForwardingFindingText(finding));
    }
  }

  return lines.join('\n');
};

const formatReport = (report: FirebatReport, format: OutputFormat): string => {
  if (format === 'json') {
    return JSON.stringify(report, null, 2);
  }

  return formatText(report);
};

export { formatReport };
