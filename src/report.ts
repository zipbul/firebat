import * as path from 'node:path';

import type {
  FirebatReport,
  OutputFormat,
} from './types';

const toPos = (line: number, column: number): string => `${line}:${column}`;

// ── Color helpers (stdout TTY-aware) ────────────────────────────────
const isStdoutTty = (): boolean => Boolean((process as any)?.stdout?.isTTY);

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
const cc = (text: string, code: string): string => _color ? `${code}${text}${A.reset}` : text;

const LINE = '─'.repeat(60);
const THIN = '┄'.repeat(60);

// ── Summary row helpers ─────────────────────────────────────────────
interface SummaryRow { readonly label: string; readonly count: number; readonly emoji: string }

const statusBadge = (count: number): string => {
  if (count === 0) return cc('✓ clean', A.green);
  return cc(`${count} finding${count === 1 ? '' : 's'}`, A.yellow);
};

const padLabel = (label: string, width: number): string => label.padEnd(width);

const formatSummaryTable = (rows: ReadonlyArray<SummaryRow>): string[] => {
  const out: string[] = [];
  const maxLabel = Math.max(...rows.map(r => r.label.length));
  for (const row of rows) {
    const badge = statusBadge(row.count);
    out.push(`  ${row.emoji}  ${padLabel(row.label, maxLabel)}  ${badge}`);
  }
  return out;
};

// ── Section builder ─────────────────────────────────────────────────
const sectionHeader = (emoji: string, title: string, subtitle?: string): string => {
  const sub = subtitle ? cc(` ${subtitle}`, A.dim) : '';
  return `\n${cc(THIN, A.dim)}\n  ${emoji}  ${cc(title, `${A.bold}${A.white}`)}${sub}\n`;
};

const formatText = (report: FirebatReport): string => {
  _color = isStdoutTty();

  const lines: string[] = [];
  const selectedDetectors = new Set(report.meta.detectors);

  const duplicates = report.analyses['exact-duplicates'] ?? [];
  const waste = report.analyses['waste'] ?? [];
  const barrelPolicy = report.analyses['barrel-policy'] ?? { findings: [] };
  const unknownProof = report.analyses['unknown-proof'] ?? { status: 'ok' as const, tool: 'tsgo' as const, findings: [] };
  const lint = report.analyses['lint'] ?? { status: 'ok' as const, tool: 'oxlint' as const, diagnostics: [] };
  const format = report.analyses['format'] ?? { status: 'ok' as const, tool: 'oxfmt' as const };
  const typecheck = report.analyses['typecheck'] ?? { status: 'ok' as const, tool: 'tsgo' as const, exitCode: 0, items: [] };
  const deps = report.analyses['dependencies'] ?? { cycles: [], fanInTop: [], fanOutTop: [], edgeCutHints: [] };
  const coupling = report.analyses['coupling'] ?? { hotspots: [] };
  const structDups = report.analyses['structural-duplicates'] ?? { cloneClasses: [] };
  const nesting = report.analyses['nesting'] ?? { items: [] };
  const earlyReturn = report.analyses['early-return'] ?? { items: [] };
  const noop = report.analyses['noop'] ?? { findings: [] };
  const apiDrift = report.analyses['api-drift'] ?? { groups: [] };
  const forwarding = report.analyses['forwarding'] ?? { findings: [] };

  const lintErrors = lint.diagnostics.filter(d => d.severity === 'error').length;
  const typecheckErrors = typecheck.items.filter(i => i.severity === 'error').length;
  const formatFindings = format.status === 'needs-formatting' || format.status === 'failed' ? 1 : 0;

  // ── Header ──────────────────────────────────────────────────────
  lines.push('');
  lines.push(`  ${cc('🔥 firebat', `${A.bold}${A.cyan}`)}  ${cc(`v${report.meta.version}`, A.dim)}`);
  lines.push(`  ${cc(`${report.meta.targetCount} files · minSize ${report.meta.minSize} · engine ${report.meta.engine}`, A.dim)}`);
  lines.push(cc(LINE, A.dim));

  // ── Summary Dashboard ───────────────────────────────────────────
  const summaryRows: SummaryRow[] = [];

  if (selectedDetectors.has('exact-duplicates'))
    summaryRows.push({ emoji: '🔁', label: 'Exact Duplicates', count: duplicates.length });
  if (selectedDetectors.has('waste'))
    summaryRows.push({ emoji: '🗑️', label: 'Waste', count: waste.length });
  if (selectedDetectors.has('barrel-policy'))
    summaryRows.push({ emoji: '📦', label: 'Barrel Policy', count: barrelPolicy.findings.length });
  if (selectedDetectors.has('unknown-proof'))
    summaryRows.push({ emoji: '🛡️', label: 'Unknown-proof', count: unknownProof.findings.length });
  if (selectedDetectors.has('format'))
    summaryRows.push({ emoji: '🎨', label: 'Format', count: formatFindings });
  if (selectedDetectors.has('lint'))
    summaryRows.push({ emoji: '🔍', label: 'Lint', count: lintErrors });
  if (selectedDetectors.has('typecheck'))
    summaryRows.push({ emoji: '🏷️', label: 'Typecheck', count: typecheckErrors });
  if (selectedDetectors.has('forwarding'))
    summaryRows.push({ emoji: '↗️', label: 'Forwarding', count: forwarding.findings.length });
  if (selectedDetectors.has('structural-duplicates'))
    summaryRows.push({ emoji: '🧬', label: 'Structural Dupes', count: structDups.cloneClasses.length });
  if (selectedDetectors.has('nesting'))
    summaryRows.push({ emoji: '🪹', label: 'Nesting', count: nesting.items.length });
  if (selectedDetectors.has('early-return'))
    summaryRows.push({ emoji: '↩️', label: 'Early Return', count: earlyReturn.items.length });
  if (selectedDetectors.has('noop'))
    summaryRows.push({ emoji: '💤', label: 'Noop', count: noop.findings.length });
  if (selectedDetectors.has('dependencies'))
    summaryRows.push({ emoji: '🔗', label: 'Dep Cycles', count: deps.cycles.length });
  if (selectedDetectors.has('coupling'))
    summaryRows.push({ emoji: '🔥', label: 'Coupling Hotspots', count: coupling.hotspots.length });
  if (selectedDetectors.has('api-drift'))
    summaryRows.push({ emoji: '📐', label: 'API Drift', count: apiDrift.groups.length });

  lines.push(...formatSummaryTable(summaryRows));
  lines.push(cc(LINE, A.dim));

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
      const evidence = typeof finding.evidence === 'string' && finding.evidence.length > 0 ? cc(` (${finding.evidence})`, A.dim) : '';
      lines.push(`    ${cc('·', A.dim)} ${finding.kind}: ${finding.message} ${cc(`@ ${rel}:${start}`, A.dim)}${evidence}`);
    }
  }

  if (selectedDetectors.has('unknown-proof') && unknownProof.findings.length > 0) {
    lines.push(sectionHeader('🛡️', 'Unknown-proof', `${unknownProof.findings.length} findings`));
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

  if (selectedDetectors.has('noop') && noop.findings.length > 0) {
    lines.push(sectionHeader('💤', 'Noop', `${noop.findings.length} findings`));
    for (const finding of noop.findings) {
      const rel = path.relative(process.cwd(), finding.filePath);
      const start = toPos(finding.span.start.line, finding.span.start.column);
      lines.push(`    ${cc('·', A.dim)} ${finding.kind}: ${cc(`@ ${rel}:${start}`, A.dim)} ${cc(finding.evidence, A.dim)}`);
    }
  }

  if (selectedDetectors.has('dependencies') && (deps.cycles.length > 0 || deps.edgeCutHints.length > 0)) {
    lines.push(sectionHeader('🔗', 'Dependencies', `${deps.cycles.length} cycles · ${deps.edgeCutHints.length} cut hints`));
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

  lines.push('');
  return lines.join('\n');
};

const formatReport = (report: FirebatReport, format: OutputFormat): string => {
  if (format === 'json') {
    return JSON.stringify(report, null, 2);
  }

  return formatText(report);
};

export { formatReport };
