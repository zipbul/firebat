import * as path from 'node:path';
import { table as renderTable } from 'table';

import type { FirebatReport, OutputFormat } from './types';

const toPos = (line: number, column: number): string => `${line}:${column}`;

// ── Color helpers (stdout TTY-aware) ────────────────────────────────
const isStdoutTty = (): boolean => {
  return Boolean(process.stdout?.isTTY);
};

const A = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
  white: '\x1b[37m',
} as const;
let _color = true;

const cc = (text: string, code: string): string => (_color ? `${code}${text}${A.reset}` : text);

const THIN = '┄'.repeat(60);

// ── Summary row helpers ─────────────────────────────────────────────
interface SummaryRow {
  readonly label: string;
  readonly count: number;
  readonly filesCount: number;
  readonly emoji: string;
}

interface SummaryTableRow extends SummaryRow {
  readonly timingKey: string;
}

const formatNumber = (value: number): string => {
  return new Intl.NumberFormat('en-US').format(value);
};

const statusBadge = (count: number): string => {
  if (count === 0) {
    return '✓ clean';
  }

  return formatNumber(count);
};

const formatDuration = (ms: number | undefined): string => {
  if (ms === undefined) {
    return '—';
  }

  const v = ms;

  if (!Number.isFinite(v)) {
    return '—';
  }

  if (v === 0) {
    return '0ms';
  }

  const formatUnit = (value: number, unit: string, decimals: number): string => {
    const fixed = value.toFixed(decimals);
    const trimmed = fixed.replace(/\.?0+$/, '');

    return `${trimmed}${unit}`;
  };

  if (v >= 60_000) {
    return formatUnit(v / 60_000, 'm', 2);
  }

  if (v >= 1000) {
    return formatUnit(v / 1000, 's', 2);
  }

  if (v >= 1) {
    return formatUnit(v, 'ms', v < 10 ? 2 : v < 100 ? 1 : 0);
  }

  if (v >= 0.001) {
    return formatUnit(v * 1000, 'us', v * 1000 < 10 ? 2 : v * 1000 < 100 ? 1 : 0);
  }

  return formatUnit(v * 1_000_000, 'ns', v * 1_000_000 < 10 ? 2 : v * 1_000_000 < 100 ? 1 : 0);
};

const formatSummaryTable = (
  rows: ReadonlyArray<SummaryTableRow>,
  timings: Readonly<Record<string, number>> | undefined,
): string[] => {
  const output = renderTable(
    [
      ['🔎 Detector', '📌 Findings', '📄 Files', '⏱ Time'],
      ...rows.map(r => [r.label, statusBadge(r.count), formatNumber(r.filesCount), formatDuration(timings?.[r.timingKey])]),
    ],
    {
      drawVerticalLine: () => false,
      drawHorizontalLine: () => true,
      columns: [
        { alignment: 'left', paddingLeft: 0, paddingRight: 3 },
        { alignment: 'right', paddingLeft: 3, paddingRight: 3 },
        { alignment: 'right', paddingLeft: 3, paddingRight: 3 },
        { alignment: 'right', paddingLeft: 3, paddingRight: 3 },
      ],
    },
  );

  return output
    .trimEnd()
    .split('\n')
    .map(line => `  ${line}`);
};

const sumTimingsMs = (timings: Readonly<Record<string, number>> | undefined): number | undefined => {
  if (timings === undefined) {
    return undefined;
  }

  let total = 0;
  let hasAny = false;

  for (const v of Object.values(timings)) {
    if (!Number.isFinite(v)) {
      continue;
    }

    total += v;

    hasAny = true;
  }

  return hasAny ? total : undefined;
};

// ── Section builder ─────────────────────────────────────────────────
const sectionHeader = (_emoji: string, title: string, subtitle?: string): string => {
  const sub = subtitle ? cc(` ${subtitle}`, A.dim) : '';

  return `\n${cc(THIN, A.dim)}\n  ${cc(title, `${A.bold}${A.white}`)}${sub}\n`;
};

const formatText = (report: FirebatReport): string => {
  _color = isStdoutTty();

  const lines: string[] = [];
  const selectedDetectors = new Set(report.meta.detectors);
  const analyses = report.analyses;
  const {
    'exact-duplicates': duplicates = [],
    'barrel-policy': barrelPolicy = { findings: [] },
    'unknown-proof': unknownProof = { status: 'ok' as const, tool: 'tsgo' as const, findings: [] },
    'exception-hygiene': exceptionHygiene = { status: 'ok' as const, tool: 'oxc' as const, findings: [] },
    'structural-duplicates': structDups = { cloneClasses: [] },
    'early-return': earlyReturn = { items: [] },
    'api-drift': apiDrift = { groups: [] },
  } = analyses;
  const waste = analyses.waste ?? [];
  const lint = analyses.lint ?? { status: 'ok' as const, tool: 'oxlint' as const, diagnostics: [] };
  const format = analyses.format ?? { status: 'ok' as const, tool: 'oxfmt' as const };
  const typecheck = analyses.typecheck ?? { status: 'ok' as const, tool: 'tsgo' as const, exitCode: 0, items: [] };
  const deps =
    analyses.dependencies ??
    ({
      cycles: [],
      adjacency: {},
      exportStats: {},
      fanInTop: [],
      fanOutTop: [],
      edgeCutHints: [],
      layerViolations: [],
      deadExports: [],
    } as const);
  const coupling = analyses.coupling ?? { hotspots: [] };
  const nesting = analyses.nesting ?? { items: [] };
  const noop = analyses.noop ?? { findings: [] };
  const forwarding = analyses.forwarding ?? { findings: [] };
  const lintErrors = lint.diagnostics.filter(d => d.severity === 'error').length;
  const typecheckErrors = typecheck.items.filter(i => i.severity === 'error').length;
  const formatFindings = format.status === 'needs-formatting' || format.status === 'failed' ? 1 : 0;
  // ── Summary Dashboard ───────────────────────────────────────────
  const summaryRows: SummaryTableRow[] = [];

  if (selectedDetectors.has('exact-duplicates')) {
    summaryRows.push({
      emoji: '🔁',
      label: 'Exact Duplicates',
      count: duplicates.length,
      filesCount: duplicates.length === 0 ? 0 : new Set(duplicates.flatMap(g => g.items.map(i => i.filePath))).size,
      timingKey: 'exact-duplicates',
    });
  }

  if (selectedDetectors.has('waste')) {
    summaryRows.push({
      emoji: '🗑️',
      label: 'Waste',
      count: waste.length,
      filesCount: waste.length === 0 ? 0 : new Set(waste.map(f => f.filePath)).size,
      timingKey: 'waste',
    });
  }

  if (selectedDetectors.has('barrel-policy')) {
    summaryRows.push({
      emoji: '📦',
      label: 'Barrel Policy',
      count: barrelPolicy.findings.length,
      filesCount: barrelPolicy.findings.length === 0 ? 0 : new Set(barrelPolicy.findings.map(f => f.filePath)).size,
      timingKey: 'barrel-policy',
    });
  }

  if (selectedDetectors.has('unknown-proof')) {
    summaryRows.push({
      emoji: '🛡️',
      label: 'Unknown Proof',
      count: unknownProof.findings.length,
      filesCount: unknownProof.findings.length === 0 ? 0 : new Set(unknownProof.findings.map(f => f.filePath)).size,
      timingKey: 'unknown-proof',
    });
  }

  if (selectedDetectors.has('format')) {
    summaryRows.push({
      emoji: '🎨',
      label: 'Format',
      count: formatFindings,
      filesCount: formatFindings === 0 ? 0 : (format.fileCount ?? 0),
      timingKey: 'format',
    });
  }

  if (selectedDetectors.has('lint')) {
    summaryRows.push({
      emoji: '🔍',
      label: 'Lint',
      count: lintErrors,
      filesCount: lintErrors === 0 ? 0 : new Set(lint.diagnostics.map(d => d.filePath).filter(Boolean) as string[]).size,
      timingKey: 'lint',
    });
  }

  if (selectedDetectors.has('typecheck')) {
    summaryRows.push({
      emoji: '🏷️',
      label: 'Typecheck',
      count: typecheckErrors,
      filesCount: typecheckErrors === 0 ? 0 : new Set(typecheck.items.map(i => i.filePath)).size,
      timingKey: 'typecheck',
    });
  }

  if (selectedDetectors.has('forwarding')) {
    summaryRows.push({
      emoji: '↗️',
      label: 'Forwarding',
      count: forwarding.findings.length,
      filesCount: forwarding.findings.length === 0 ? 0 : new Set(forwarding.findings.map(f => f.filePath)).size,
      timingKey: 'forwarding',
    });
  }

  if (selectedDetectors.has('structural-duplicates')) {
    summaryRows.push({
      emoji: '🧬',
      label: 'Structural Dupes',
      count: structDups.cloneClasses.length,
      filesCount:
        structDups.cloneClasses.length === 0
          ? 0
          : new Set(structDups.cloneClasses.flatMap(g => g.items.map(i => i.filePath))).size,
      timingKey: 'structural-duplicates',
    });
  }

  if (selectedDetectors.has('nesting')) {
    summaryRows.push({
      emoji: '🪹',
      label: 'Nesting',
      count: nesting.items.length,
      filesCount: nesting.items.length === 0 ? 0 : new Set(nesting.items.map(i => i.filePath)).size,
      timingKey: 'nesting',
    });
  }

  if (selectedDetectors.has('early-return')) {
    summaryRows.push({
      emoji: '↩️',
      label: 'Early Return',
      count: earlyReturn.items.length,
      filesCount: earlyReturn.items.length === 0 ? 0 : new Set(earlyReturn.items.map(i => i.filePath)).size,
      timingKey: 'early-return',
    });
  }

  if (selectedDetectors.has('exception-hygiene')) {
    summaryRows.push({
      emoji: '🧯',
      label: 'Exception Hygiene',
      count: exceptionHygiene.findings.length,
      filesCount: exceptionHygiene.findings.length === 0 ? 0 : new Set(exceptionHygiene.findings.map(f => f.filePath)).size,
      timingKey: 'exception-hygiene',
    });
  }

  if (selectedDetectors.has('noop')) {
    summaryRows.push({
      emoji: '💤',
      label: 'Noop',
      count: noop.findings.length,
      filesCount: noop.findings.length === 0 ? 0 : new Set(noop.findings.map(f => f.filePath)).size,
      timingKey: 'noop',
    });
  }

  if (selectedDetectors.has('dependencies')) {
    summaryRows.push({
      emoji: '🔗',
      label: 'Dep Cycles',
      count: deps.cycles.length,
      filesCount:
        deps.cycles.length === 0
          ? 0
          : new Set([
              ...deps.cycles.flatMap(c => c.path),
              ...deps.fanInTop.map(s => s.module),
              ...deps.fanOutTop.map(s => s.module),
              ...deps.edgeCutHints.flatMap(h => [h.from, h.to]),
            ]).size,
      timingKey: 'dependencies',
    });
  }

  if (selectedDetectors.has('coupling')) {
    summaryRows.push({
      emoji: '🔥',
      label: 'Coupling Hotspots',
      count: coupling.hotspots.length,
      filesCount: coupling.hotspots.length === 0 ? 0 : new Set(coupling.hotspots.map(h => h.module)).size,
      timingKey: 'coupling',
    });
  }

  if (selectedDetectors.has('api-drift')) {
    summaryRows.push({
      emoji: '📐',
      label: 'API Drift',
      count: apiDrift.groups.length,
      filesCount: apiDrift.groups.length === 0 ? 0 : new Set(apiDrift.groups.flatMap(g => g.outliers.map(o => o.filePath))).size,
      timingKey: 'api-drift',
    });
  }

  // ── Detail Sections (only shown when findings > 0) ──────────────

  if (selectedDetectors.has('exact-duplicates') && duplicates.length > 0) {
    lines.push(sectionHeader('🔁', 'Exact Duplicates', `${duplicates.length} groups`));

    for (const group of duplicates) {
      lines.push(`    ${cc(`${group.items.length} items`, A.yellow)}`);

      for (const item of group.items) {
        const rel = path.relative(process.cwd(), item.filePath);
        const start = toPos(item.span.start.line, item.span.start.column);
        const kindPrefix = item.kind !== 'node' ? `${item.kind}: ` : '';
        const name = item.header !== 'anonymous' ? `${kindPrefix}${item.header} ` : '';

        lines.push(`      ${cc('·', A.dim)} ${name}${cc(`@ ${rel}:${start}`, A.dim)}`);
      }
    }
  }

  if (selectedDetectors.has('waste') && waste.length > 0) {
    lines.push(sectionHeader('🗑️', 'Waste', `${waste.length} findings`));

    for (const finding of waste) {
      const rel = path.relative(process.cwd(), finding.filePath);
      const start = toPos(finding.span.start.line, finding.span.start.column);

      lines.push(`    ${cc('·', A.dim)} ${finding.message} ${cc(`@ ${rel}:${start}`, A.dim)}`);
    }
  }

  if (selectedDetectors.has('barrel-policy') && barrelPolicy.findings.length > 0) {
    lines.push(sectionHeader('📦', 'Barrel Policy', `${barrelPolicy.findings.length} findings`));

    for (const finding of barrelPolicy.findings) {
      const rel = path.relative(process.cwd(), finding.filePath);
      const start = toPos(finding.span.start.line, finding.span.start.column);
      const evidence =
        typeof finding.evidence === 'string' && finding.evidence.length > 0 ? cc(` (${finding.evidence})`, A.dim) : '';

      lines.push(`    ${cc('·', A.dim)} ${finding.kind}: ${finding.message} ${cc(`@ ${rel}:${start}`, A.dim)}${evidence}`);
    }
  }

  if (selectedDetectors.has('unknown-proof') && unknownProof.findings.length > 0) {
    lines.push(sectionHeader('🛡️', 'Unknown Proof', `${unknownProof.findings.length} findings`));

    for (const finding of unknownProof.findings) {
      const rel = path.relative(process.cwd(), finding.filePath);
      const start = toPos(finding.span.start.line, finding.span.start.column);
      const symbol = typeof finding.symbol === 'string' && finding.symbol.length > 0 ? ` ${finding.symbol}` : '';

      lines.push(`    ${cc('·', A.dim)} ${finding.kind}:${symbol} ${finding.message} ${cc(`@ ${rel}:${start}`, A.dim)}`);
    }
  }

  if (selectedDetectors.has('format') && (format.status === 'needs-formatting' || format.status === 'failed')) {
    lines.push(sectionHeader('🎨', 'Format', `${format.status}`));

    if (typeof format.fileCount === 'number' && format.fileCount > 0) {
      lines.push(`    ${format.fileCount} file${format.fileCount === 1 ? '' : 's'} need formatting`);
    }
  }

  if (selectedDetectors.has('lint') && lint.diagnostics.length > 0) {
    lines.push(sectionHeader('🔍', 'Lint', `${lint.diagnostics.length} diagnostics`));

    for (const d of lint.diagnostics) {
      const sev = d.severity === 'error' ? cc('error', A.red) : cc('warn', A.yellow);
      const rel = d.filePath ? path.relative(process.cwd(), d.filePath) : '';
      const start = toPos(d.span.start.line, d.span.start.column);

      lines.push(`    ${sev} ${d.code ?? ''}: ${d.message} ${cc(`@ ${rel}:${start}`, A.dim)}`);
    }
  }

  if (selectedDetectors.has('typecheck') && typecheck.items.length > 0) {
    lines.push(sectionHeader('🏷️', 'Typecheck', `${typecheck.items.length} items`));

    for (const item of typecheck.items) {
      const rel = item.filePath.length > 0 ? path.relative(process.cwd(), item.filePath) : '<unknown>';
      const start = toPos(item.span.start.line, item.span.start.column);
      const sev = item.severity === 'error' ? cc('error', A.red) : cc('warn', A.yellow);

      lines.push(`    ${sev} ${item.code}: ${item.message} ${cc(`@ ${rel}:${start}`, A.dim)}`);

      if (item.codeFrame.length > 0) {
        for (const frameLine of item.codeFrame.split('\n')) {
          lines.push(`        ${cc(frameLine, A.dim)}`);
        }
      }
    }
  }

  if (selectedDetectors.has('forwarding') && forwarding.findings.length > 0) {
    lines.push(sectionHeader('↗️', 'Forwarding', `${forwarding.findings.length} findings`));

    for (const finding of forwarding.findings) {
      const rel = path.relative(process.cwd(), finding.filePath);
      const start = toPos(finding.span.start.line, finding.span.start.column);
      const name = finding.header !== 'anonymous' ? `${finding.header} ` : '';

      lines.push(`    ${cc('·', A.dim)} ${finding.kind}: ${name}${cc(`@ ${rel}:${start}`, A.dim)}`);
    }
  }

  if (selectedDetectors.has('structural-duplicates') && structDups.cloneClasses.length > 0) {
    lines.push(sectionHeader('🧬', 'Structural Duplicates', `${structDups.cloneClasses.length} classes`));

    for (const group of structDups.cloneClasses) {
      lines.push(`    ${cc(`${group.items.length} items`, A.yellow)}`);

      for (const item of group.items) {
        const rel = path.relative(process.cwd(), item.filePath);
        const start = toPos(item.span.start.line, item.span.start.column);
        const kindPrefix = item.kind !== 'node' ? `${item.kind}: ` : '';
        const name = item.header !== 'anonymous' ? `${kindPrefix}${item.header} ` : '';

        lines.push(`      ${cc('·', A.dim)} ${name}${cc(`@ ${rel}:${start}`, A.dim)}`);
      }
    }
  }

  if (selectedDetectors.has('nesting') && nesting.items.length > 0) {
    lines.push(sectionHeader('🪹', 'Nesting', `${nesting.items.length} items`));

    for (const item of nesting.items) {
      const rel = path.relative(process.cwd(), item.filePath);
      const start = toPos(item.span.start.line, item.span.start.column);
      const name = item.header !== 'anonymous' ? `${item.header} ` : '';
      const suggestions = item.suggestions.length > 0 ? cc(` → ${item.suggestions.join('; ')}`, A.dim) : '';

      lines.push(`    ${cc('·', A.dim)} ${name}${cc(`@ ${rel}:${start}`, A.dim)}${suggestions}`);
    }
  }

  if (selectedDetectors.has('early-return') && earlyReturn.items.length > 0) {
    lines.push(sectionHeader('↩️', 'Early Return', `${earlyReturn.items.length} items`));

    for (const item of earlyReturn.items) {
      const rel = path.relative(process.cwd(), item.filePath);
      const start = toPos(item.span.start.line, item.span.start.column);
      const name = item.header !== 'anonymous' ? `${item.header} ` : '';
      const suggestions = item.suggestions.length > 0 ? cc(` → ${item.suggestions.join('; ')}`, A.dim) : '';

      lines.push(`    ${cc('·', A.dim)} ${name}${cc(`@ ${rel}:${start}`, A.dim)}${suggestions}`);
    }
  }

  if (selectedDetectors.has('exception-hygiene') && exceptionHygiene.findings.length > 0) {
    lines.push(sectionHeader('🧯', 'Exception Hygiene', `${exceptionHygiene.findings.length} findings`));

    for (const finding of exceptionHygiene.findings) {
      const rel = path.relative(process.cwd(), finding.filePath);
      const start = toPos(finding.span.start.line, finding.span.start.column);
      const recipes = finding.recipes.length > 0 ? cc(` [${finding.recipes.join(', ')}]`, A.dim) : '';
      const evidence = finding.evidence.length > 0 ? cc(` (${finding.evidence})`, A.dim) : '';

      lines.push(
        `    ${cc('·', A.dim)} ${finding.kind}: ${finding.message} ${cc(`@ ${rel}:${start}`, A.dim)}${recipes}${evidence}`,
      );
    }
  }

  if (selectedDetectors.has('noop') && noop.findings.length > 0) {
    lines.push(sectionHeader('💤', 'Noop', `${noop.findings.length} findings`));

    for (const finding of noop.findings) {
      const rel = path.relative(process.cwd(), finding.filePath);
      const start = toPos(finding.span.start.line, finding.span.start.column);

      lines.push(`    ${cc('·', A.dim)} ${finding.kind}: ${cc(`@ ${rel}:${start}`, A.dim)} ${cc(finding.evidence, A.dim)}`);
    }
  }

  if (
    selectedDetectors.has('dependencies') &&
    (deps.cycles.length > 0 || deps.edgeCutHints.length > 0 || deps.layerViolations.length > 0 || deps.deadExports.length > 0)
  ) {
    lines.push(
      sectionHeader(
        '🔗',
        'Dependencies',
        `${deps.cycles.length} cycles · ${deps.edgeCutHints.length} cut hints · ${deps.layerViolations.length} layer violations · ${deps.deadExports.length} dead exports`,
      ),
    );

    if (deps.deadExports.length > 0) {
      lines.push(`    ${cc('dead exports:', A.yellow)}`);

      for (const finding of deps.deadExports) {
        lines.push(`      ${cc('·', A.dim)} ${finding.kind}: ${finding.module}#${finding.exportName}`);
      }
    }

    if (deps.layerViolations.length > 0) {
      lines.push(`    ${cc('layer violations:', A.yellow)}`);

      for (const finding of deps.layerViolations) {
        lines.push(`      ${cc('·', A.dim)} ${finding.message} ${cc(`(${finding.from} → ${finding.to})`, A.dim)}`);
      }
    }

    if (deps.cycles.length > 0) {
      lines.push(`    ${cc('cycles:', A.yellow)}`);

      for (const cycle of deps.cycles) {
        lines.push(`      ${cc('·', A.dim)} ${cycle.path.join(' → ')}`);
      }
    }

    if (deps.edgeCutHints.length > 0) {
      lines.push(`    ${cc('edge cut hints:', A.yellow)}`);

      for (const hint of deps.edgeCutHints) {
        const reason = typeof hint.reason === 'string' && hint.reason.length > 0 ? cc(` (${hint.reason})`, A.dim) : '';

        lines.push(`      ${cc('·', A.dim)} ${hint.from} → ${hint.to}${reason}`);
      }
    }
  }

  if (selectedDetectors.has('coupling') && coupling.hotspots.length > 0) {
    lines.push(sectionHeader('🔥', 'Coupling Hotspots', `${coupling.hotspots.length} modules`));

    for (const hotspot of coupling.hotspots) {
      const signals = hotspot.signals.join(', ');

      lines.push(`    ${cc('·', A.dim)} ${hotspot.module} ${cc(`score=${hotspot.score}`, A.yellow)} ${cc(signals, A.dim)}`);
    }
  }

  if (selectedDetectors.has('api-drift') && apiDrift.groups.length > 0) {
    lines.push(sectionHeader('📐', 'API Drift', `${apiDrift.groups.length} groups`));

    for (const group of apiDrift.groups) {
      const shape = group.standardCandidate;
      const standard = `(${shape.paramsCount},${shape.optionalCount},${shape.returnKind},${shape.async ? 'async' : 'sync'})`;

      lines.push(`    ${cc('·', A.dim)} ${group.label}: standard=${standard} outliers=${group.outliers.length}`);

      for (const outlier of group.outliers) {
        if (outlier.filePath.length > 0) {
          const rel = path.relative(process.cwd(), outlier.filePath);
          const start = toPos(outlier.span.start.line, outlier.span.start.column);
          const oShape = `(${outlier.shape.paramsCount},${outlier.shape.optionalCount},${outlier.shape.returnKind},${outlier.shape.async ? 'async' : 'sync'})`;

          lines.push(`        ${cc('↳', A.dim)} ${oShape} ${cc(`@ ${rel}:${start}`, A.dim)}`);
        }
      }
    }
  }

  // ── Tail Summary (repeat at end for long outputs) ──────────────
  if (summaryRows.length > 0) {
    const totalMs = sumTimingsMs(report.meta.detectorTimings);
    const totalText = totalMs !== undefined ? cc(` ${formatDuration(totalMs)}`, A.dim) : '';

    lines.push('');
    lines.push(cc(THIN, A.dim));
    lines.push('');
    lines.push(`  📊  ${cc('Summary', `${A.bold}${A.white}`)}${totalText}`);
    lines.push('');
    lines.push(...formatSummaryTable(summaryRows, report.meta.detectorTimings));
  }

  lines.push('');

  return lines.join('\n');
};

const formatReport = (report: FirebatReport, format: OutputFormat): string => {
  if (format === 'json') {
    return JSON.stringify(report);
  }

  return formatText(report);
};

export { formatReport };
