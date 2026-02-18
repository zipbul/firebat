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

  const getFile = (value: unknown): string => {
    const v = value as any;

    if (typeof v?.file === 'string') {
      return v.file;
    }

    if (typeof v?.filePath === 'string') {
      return v.filePath;
    }

    return '';
  };

  const duplicates = analyses['exact-duplicates'] ?? [];
  const waste = analyses.waste ?? [];
  const barrelPolicy = analyses['barrel-policy'] ?? [];
  const unknownProof = analyses['unknown-proof'] ?? [];
  const exceptionHygiene = analyses['exception-hygiene'] ?? [];
  const lint = analyses.lint ?? [];
  const format = analyses.format ?? [];
  const typecheck = analyses.typecheck ?? [];
  const structDups = analyses['structural-duplicates'] ?? [];
  const earlyReturn = analyses['early-return'] ?? [];
  const apiDrift = analyses['api-drift'] ?? [];
  const deps =
    analyses.dependencies ??
    ({
      cycles: [],
      adjacency: {},
      exportStats: {},
      fanIn: [],
      fanOut: [],
      cuts: [],
      layerViolations: [],
      deadExports: [],
    } as const);
  const depsLegacy = deps as typeof deps & {
    readonly fanInTop?: ReadonlyArray<unknown>;
    readonly fanOutTop?: ReadonlyArray<unknown>;
    readonly edgeCutHints?: ReadonlyArray<unknown>;
  };
  const depsFanIn: ReadonlyArray<unknown> = depsLegacy.fanInTop ?? deps.fanIn;
  const depsFanOut: ReadonlyArray<unknown> = depsLegacy.fanOutTop ?? deps.fanOut;
  const depsCuts: ReadonlyArray<unknown> = depsLegacy.edgeCutHints ?? deps.cuts;
  const coupling = analyses.coupling ?? [];
  const nesting = analyses.nesting ?? [];
  const noop = analyses.noop ?? [];
  const forwarding = analyses.forwarding ?? [];
  const lintErrors = lint.filter(d => d.severity === 'error').length;
  const typecheckErrors = typecheck.filter(i => i.severity === 'error').length;
  const formatFindings = format.length;

  const humanizeDetectorKey = (key: string): string => {
    const acronyms = new Set(['api']);

    return key
      .split('-')
      .filter(Boolean)
      .map(part => {
        const lower = part.toLowerCase();
        if (acronyms.has(lower)) {
          return lower.toUpperCase();
        }

        return `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`;
      })
      .join(' ');
  };

  // ── Summary Dashboard ───────────────────────────────────────────
  const extractModule = (value: unknown): string => {
    const v = value as Readonly<Record<string, unknown>>;
    return typeof v.module === 'string' ? v.module : '';
  };

  const extractFromTo = (value: unknown): readonly [string, string] => {
    const v = value as Readonly<Record<string, unknown>>;
    const from = typeof v.from === 'string' ? v.from : '';
    const to = typeof v.to === 'string' ? v.to : '';
    return [from, to];
  };

  const defaultSummaryRow = (timingKey: string): SummaryTableRow => {
    const label = humanizeDetectorKey(timingKey);
    const v = analyses[timingKey as keyof typeof analyses] as unknown;

    if (!Array.isArray(v)) {
      return {
        emoji: '🔎',
        label,
        count: 0,
        filesCount: 0,
        timingKey,
      };
    }

    const items: ReadonlyArray<unknown> = v;
    const count = items.length;
    const filesCount =
      count === 0 ? 0 : new Set(items.map(item => getFile(item)).filter(Boolean) as ReadonlyArray<string>).size;

    return {
      emoji: '🔎',
      label,
      count,
      filesCount,
      timingKey,
    };
  };

  const summaryRowFor = (timingKey: string): SummaryTableRow => {
    switch (timingKey) {
      case 'exact-duplicates':
        return {
          emoji: '🔁',
          label: 'Exact Duplicates',
          count: duplicates.length,
          filesCount: duplicates.length === 0 ? 0 : new Set(duplicates.flatMap(g => g.items.map(i => getFile(i)))).size,
          timingKey,
        };
      case 'waste':
        return {
          emoji: '🗑️',
          label: 'Waste',
          count: waste.length,
          filesCount: waste.length === 0 ? 0 : new Set(waste.map(f => getFile(f))).size,
          timingKey,
        };
      case 'barrel-policy':
        return {
          emoji: '📦',
          label: 'Barrel Policy',
          count: barrelPolicy.length,
          filesCount: barrelPolicy.length === 0 ? 0 : new Set(barrelPolicy.map(f => getFile(f))).size,
          timingKey,
        };
      case 'unknown-proof':
        return {
          emoji: '🛡️',
          label: 'Unknown Proof',
          count: unknownProof.length,
          filesCount: unknownProof.length === 0 ? 0 : new Set(unknownProof.map(f => getFile(f))).size,
          timingKey,
        };
      case 'format':
        return {
          emoji: '🎨',
          label: 'Format',
          count: formatFindings,
          filesCount: formatFindings === 0 ? 0 : new Set(format).size,
          timingKey,
        };
      case 'lint':
        return {
          emoji: '🔍',
          label: 'Lint',
          count: lintErrors,
          filesCount: lintErrors === 0 ? 0 : new Set(lint.map(d => d.file).filter(Boolean) as string[]).size,
          timingKey,
        };
      case 'typecheck':
        return {
          emoji: '🏷️',
          label: 'Typecheck',
          count: typecheckErrors,
          filesCount: typecheckErrors === 0 ? 0 : new Set(typecheck.map(i => i.file)).size,
          timingKey,
        };
      case 'forwarding':
        return {
          emoji: '↗️',
          label: 'Forwarding',
          count: forwarding.length,
          filesCount: forwarding.length === 0 ? 0 : new Set(forwarding.map(f => getFile(f))).size,
          timingKey,
        };
      case 'structural-duplicates':
        return {
          emoji: '🧬',
          label: 'Structural Dupes',
          count: structDups.length,
          filesCount: structDups.length === 0 ? 0 : new Set(structDups.flatMap(g => g.items.map(i => getFile(i)))).size,
          timingKey,
        };
      case 'nesting':
        return {
          emoji: '🪹',
          label: 'Nesting',
          count: nesting.length,
          filesCount: nesting.length === 0 ? 0 : new Set(nesting.map(i => getFile(i))).size,
          timingKey,
        };
      case 'early-return':
        return {
          emoji: '↩️',
          label: 'Early Return',
          count: earlyReturn.length,
          filesCount: earlyReturn.length === 0 ? 0 : new Set(earlyReturn.map(i => getFile(i))).size,
          timingKey,
        };
      case 'exception-hygiene':
        return {
          emoji: '🧯',
          label: 'Exception Hygiene',
          count: exceptionHygiene.length,
          filesCount: exceptionHygiene.length === 0 ? 0 : new Set(exceptionHygiene.map(f => getFile(f))).size,
          timingKey,
        };
      case 'noop':
        return {
          emoji: '💤',
          label: 'Noop',
          count: noop.length,
          filesCount: noop.length === 0 ? 0 : new Set(noop.map(f => getFile(f))).size,
          timingKey,
        };
      case 'dependencies':
        return {
          emoji: '🔗',
          label: 'Dep Cycles',
          count: deps.cycles.length,
          filesCount:
            deps.cycles.length === 0
              ? 0
              : new Set([
                  ...deps.cycles.flatMap(c => c.path),
                  ...depsFanIn.map(s => extractModule(s)).filter(Boolean),
                  ...depsFanOut.map(s => extractModule(s)).filter(Boolean),
                  ...depsCuts.flatMap(h => extractFromTo(h)).filter(Boolean),
                ]).size,
          timingKey,
        };
      case 'coupling':
        return {
          emoji: '🔥',
          label: 'Coupling Hotspots',
          count: coupling.length,
          filesCount: coupling.length === 0 ? 0 : new Set(coupling.map(h => h.module)).size,
          timingKey,
        };
      case 'api-drift':
        return {
          emoji: '📐',
          label: 'API Drift',
          count: apiDrift.length,
          filesCount:
            apiDrift.length === 0
              ? 0
              : new Set(apiDrift.flatMap(g => g.outliers.map(o => o.filePath))).size,
          timingKey,
        };
      default:
        return defaultSummaryRow(timingKey);
    }
  };

  const summaryRows: SummaryTableRow[] = report.meta.detectors.map(d => summaryRowFor(d));

  // ── Detail Sections (only shown when findings > 0) ──────────────

  if (selectedDetectors.has('exact-duplicates') && duplicates.length > 0) {
    lines.push(sectionHeader('🔁', 'Exact Duplicates', `${duplicates.length} groups`));

    for (const group of duplicates) {
      lines.push(`    ${cc(`${group.items.length} items`, A.yellow)}`);

      for (const item of group.items) {
        const rel = path.relative(process.cwd(), getFile(item));
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
      const rel = path.relative(process.cwd(), getFile(finding));
      const start = toPos(finding.span.start.line, finding.span.start.column);
      const label = typeof (finding as any).label === 'string' ? (finding as any).label : '';
      const suffix = label.length > 0 ? cc(` (${label})`, A.dim) : '';

      lines.push(`    ${cc('·', A.dim)} ${(finding as any).kind ?? 'waste'}${suffix} ${cc(`@ ${rel}:${start}`, A.dim)}`);
    }
  }

  if (selectedDetectors.has('barrel-policy') && barrelPolicy.length > 0) {
    lines.push(sectionHeader('📦', 'Barrel Policy', `${barrelPolicy.length} findings`));

    for (const finding of barrelPolicy) {
      const rel = path.relative(process.cwd(), getFile(finding));
      const start = toPos(finding.span.start.line, finding.span.start.column);
      const evidence =
        typeof finding.evidence === 'string' && finding.evidence.length > 0 ? cc(` (${finding.evidence})`, A.dim) : '';

      lines.push(`    ${cc('·', A.dim)} ${finding.kind}${cc(` @ ${rel}:${start}`, A.dim)}${evidence}`);
    }
  }

  if (selectedDetectors.has('unknown-proof') && unknownProof.length > 0) {
    lines.push(sectionHeader('🛡️', 'Unknown Proof', `${unknownProof.length} findings`));

    for (const finding of unknownProof) {
      const rel = path.relative(process.cwd(), getFile(finding));
      const start = toPos(finding.span.start.line, finding.span.start.column);
      const symbol = typeof finding.symbol === 'string' && finding.symbol.length > 0 ? ` ${finding.symbol}` : '';

      lines.push(`    ${cc('·', A.dim)} ${finding.kind}:${symbol} ${cc(`@ ${rel}:${start}`, A.dim)}`);
    }
  }

  if (selectedDetectors.has('format') && format.length > 0) {
    lines.push(sectionHeader('🎨', 'Format', `${format.length} files`));
    lines.push(`    ${format.length} file${format.length === 1 ? '' : 's'} need formatting`);
  }

  if (selectedDetectors.has('lint') && lint.length > 0) {
    lines.push(sectionHeader('🔍', 'Lint', `${lint.length} diagnostics`));

    for (const d of lint) {
      const sev = d.severity === 'error' ? cc('error', A.red) : cc('warn', A.yellow);
      const rel = typeof d.file === 'string' && d.file.length > 0 ? path.relative(process.cwd(), d.file) : '';
      const start = toPos(d.span.start.line, d.span.start.column);

      lines.push(`    ${sev} ${d.code ?? ''}: ${d.msg} ${cc(`@ ${rel}:${start}`, A.dim)}`);
    }
  }

  if (selectedDetectors.has('typecheck') && typecheck.length > 0) {
    lines.push(sectionHeader('🏷️', 'Typecheck', `${typecheck.length} items`));

    for (const item of typecheck) {
      const rel = item.file.length > 0 ? path.relative(process.cwd(), item.file) : '<unknown>';
      const start = toPos(item.span.start.line, item.span.start.column);
      const sev = item.severity === 'error' ? cc('error', A.red) : cc('warn', A.yellow);

      lines.push(`    ${sev} ${item.code}: ${item.msg} ${cc(`@ ${rel}:${start}`, A.dim)}`);

      if (item.codeFrame.length > 0) {
        for (const frameLine of item.codeFrame.split('\n')) {
          lines.push(`        ${cc(frameLine, A.dim)}`);
        }
      }
    }
  }

  if (selectedDetectors.has('forwarding') && forwarding.length > 0) {
    lines.push(sectionHeader('↗️', 'Forwarding', `${forwarding.length} findings`));

    for (const finding of forwarding) {
      const rel = path.relative(process.cwd(), getFile(finding));
      const start = toPos(finding.span.start.line, finding.span.start.column);
      const name = finding.header !== 'anonymous' ? `${finding.header} ` : '';

      lines.push(`    ${cc('·', A.dim)} ${finding.kind}: ${name}${cc(`@ ${rel}:${start}`, A.dim)}`);
    }
  }

  if (selectedDetectors.has('structural-duplicates') && structDups.length > 0) {
    lines.push(sectionHeader('🧬', 'Structural Duplicates', `${structDups.length} classes`));

    for (const group of structDups) {
      lines.push(`    ${cc(`${group.items.length} items`, A.yellow)}`);

      for (const item of group.items) {
        const rel = path.relative(process.cwd(), getFile(item));
        const start = toPos(item.span.start.line, item.span.start.column);
        const kindPrefix = item.kind !== 'node' ? `${item.kind}: ` : '';
        const name = item.header !== 'anonymous' ? `${kindPrefix}${item.header} ` : '';

        lines.push(`      ${cc('·', A.dim)} ${name}${cc(`@ ${rel}:${start}`, A.dim)}`);
      }
    }
  }

  if (selectedDetectors.has('nesting') && nesting.length > 0) {
    lines.push(sectionHeader('🪹', 'Nesting', `${nesting.length} items`));

    for (const item of nesting) {
      const rel = path.relative(process.cwd(), getFile(item));
      const start = toPos(item.span.start.line, item.span.start.column);
      const name = item.header !== 'anonymous' ? `${item.header} ` : '';
      const kind = typeof item.kind === 'string' && item.kind.length > 0 ? cc(` (${item.kind})`, A.dim) : '';

      lines.push(`    ${cc('·', A.dim)} ${name}${cc(`@ ${rel}:${start}`, A.dim)}${kind}`);
    }
  }

  if (selectedDetectors.has('early-return') && earlyReturn.length > 0) {
    lines.push(sectionHeader('↩️', 'Early Return', `${earlyReturn.length} items`));

    for (const item of earlyReturn) {
      const rel = path.relative(process.cwd(), getFile(item));
      const start = toPos(item.span.start.line, item.span.start.column);
      const name = item.header !== 'anonymous' ? `${item.header} ` : '';
      const kind = typeof item.kind === 'string' && item.kind.length > 0 ? cc(` (${item.kind})`, A.dim) : '';

      lines.push(`    ${cc('·', A.dim)} ${name}${cc(`@ ${rel}:${start}`, A.dim)}${kind}`);
    }
  }

  if (selectedDetectors.has('exception-hygiene') && exceptionHygiene.length > 0) {
    lines.push(sectionHeader('🧯', 'Exception Hygiene', `${exceptionHygiene.length} findings`));

    for (const finding of exceptionHygiene) {
      const rel = path.relative(process.cwd(), getFile(finding));
      const start = toPos(finding.span.start.line, finding.span.start.column);
      const evidence =
        typeof finding.evidence === 'string' && finding.evidence.length > 0 ? cc(` (${finding.evidence})`, A.dim) : '';

      lines.push(`    ${cc('·', A.dim)} ${finding.kind} ${cc(`@ ${rel}:${start}`, A.dim)}${evidence}`);
    }
  }

  if (selectedDetectors.has('noop') && noop.length > 0) {
    lines.push(sectionHeader('💤', 'Noop', `${noop.length} findings`));

    for (const finding of noop) {
      const rel = path.relative(process.cwd(), getFile(finding));
      const start = toPos(finding.span.start.line, finding.span.start.column);

      lines.push(`    ${cc('·', A.dim)} ${finding.kind}: ${cc(`@ ${rel}:${start}`, A.dim)} ${cc(finding.evidence, A.dim)}`);
    }
  }

  if (
    selectedDetectors.has('dependencies') &&
    (deps.cycles.length > 0 || depsCuts.length > 0 || deps.layerViolations.length > 0 || deps.deadExports.length > 0)
  ) {
    lines.push(
      sectionHeader(
        '🔗',
        'Dependencies',
        `${deps.cycles.length} cycles · ${depsCuts.length} cut hints · ${deps.layerViolations.length} layer violations · ${deps.deadExports.length} dead exports`,
      ),
    );

    if (deps.deadExports.length > 0) {
      lines.push(`    ${cc('dead exports:', A.yellow)}`);

      for (const finding of deps.deadExports) {
        lines.push(`      ${cc('·', A.dim)} ${finding.kind}: ${finding.module}#${(finding as any).name ?? ''}`);
      }
    }

    if (deps.layerViolations.length > 0) {
      lines.push(`    ${cc('layer violations:', A.yellow)}`);

      for (const finding of deps.layerViolations) {
        lines.push(
          `      ${cc('·', A.dim)} ${finding.fromLayer} → ${finding.toLayer} ${cc(`(${finding.from} → ${finding.to})`, A.dim)}`,
        );
      }
    }

    if (deps.cycles.length > 0) {
      lines.push(`    ${cc('cycles:', A.yellow)}`);

      for (const cycle of deps.cycles) {
        lines.push(`      ${cc('·', A.dim)} ${cycle.path.join(' → ')}`);
      }
    }

    if (depsCuts.length > 0) {
      lines.push(`    ${cc('edge cut hints:', A.yellow)}`);

      for (const hint of depsCuts as any[]) {
        lines.push(`      ${cc('·', A.dim)} ${hint.from} → ${hint.to}`);
      }
    }
  }

  if (selectedDetectors.has('coupling') && coupling.length > 0) {
    lines.push(sectionHeader('🔥', 'Coupling Hotspots', `${coupling.length} modules`));

    for (const hotspot of coupling) {
      const signals = hotspot.signals.join(', ');

      lines.push(`    ${cc('·', A.dim)} ${hotspot.module} ${cc(`score=${hotspot.score}`, A.yellow)} ${cc(signals, A.dim)}`);
    }
  }

  if (selectedDetectors.has('api-drift') && apiDrift.length > 0) {
    lines.push(sectionHeader('📐', 'API Drift', `${apiDrift.length} groups`));

    for (const group of apiDrift) {
      const shape = (group as any).standard;
      const standard = `(${shape.params ?? shape.paramsCount},${shape.optionals ?? shape.optionalCount},${shape.returnKind},${shape.async ? 'async' : 'sync'})`;

      lines.push(`    ${cc('·', A.dim)} ${group.label}: standard=${standard} outliers=${group.outliers.length}`);

      for (const outlier of group.outliers) {
        const outlierFile = getFile(outlier);

        if (outlierFile.length > 0) {
          const rel = path.relative(process.cwd(), outlierFile);
          const start = toPos(outlier.span.start.line, outlier.span.start.column);
          const oShape = `(${(outlier.shape as any).params ?? (outlier.shape as any).paramsCount},${(outlier.shape as any).optionals ?? (outlier.shape as any).optionalCount},${outlier.shape.returnKind},${outlier.shape.async ? 'async' : 'sync'})`;

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
