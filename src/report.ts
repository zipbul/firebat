import * as path from 'node:path';
import { table as renderTable } from 'table';

import type { FirebatReport, OutputFormat, DependencyFinding } from './types';
import { toJsonReport, countBlockers } from './types';

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
  const depsRaw = analyses.dependencies;
  const depsFindings: ReadonlyArray<DependencyFinding> = Array.isArray(depsRaw) ? depsRaw : [];
  const depsDead = depsFindings.filter((f): f is Extract<DependencyFinding, { kind: 'dead-export' | 'test-only-export' }> => f.kind === 'dead-export' || f.kind === 'test-only-export');
  const depsLayerViolations = depsFindings.filter((f): f is Extract<DependencyFinding, { kind: 'layer-violation' }> => f.kind === 'layer-violation');
  const depsCycleFindings = depsFindings.filter((f): f is Extract<DependencyFinding, { kind: 'circular-dependency' }> => f.kind === 'circular-dependency');
  const coupling = analyses.coupling ?? [];
  const nesting = analyses.nesting ?? [];
  const forwarding = analyses.forwarding ?? [];
  const implicitState = analyses['implicit-state'] ?? [];
  const temporalCoupling = analyses['temporal-coupling'] ?? [];
  const symmetryBreaking = analyses['symmetry-breaking'] ?? [];
  const invariantBlindspot = analyses['invariant-blindspot'] ?? [];
  const modificationTrap = analyses['modification-trap'] ?? [];
  const modificationImpact = analyses['modification-impact'] ?? [];
  const variableLifetime = analyses['variable-lifetime'] ?? [];
  const decisionSurface = analyses['decision-surface'] ?? [];
  const implementationOverhead = analyses['implementation-overhead'] ?? [];
  const conceptScatter = analyses['concept-scatter'] ?? [];
  const abstractionFitness = analyses['abstraction-fitness'] ?? [];
  const giantFile = analyses['giant-file'] ?? [];
  const duplicatesUnified = analyses.duplicates ?? [];
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
      case 'format': {
        return {
          emoji: '🎨',
          label: 'Format',
          count: formatFindings,
          filesCount: formatFindings === 0 ? 0 : new Set(format.map(f => f.file)).size,
          timingKey,
        };
      }
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
          label: 'Structural Duplicates',
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
      case 'dependencies':
        return {
          emoji: '🔗',
          label: 'Dependencies',
          count: depsFindings.length,
          filesCount:
            depsFindings.length === 0
              ? 0
              : new Set(
                  depsFindings.flatMap(f =>
                    'items' in f ? f.items.map(i => i.file) : [f.file],
                  ),
                ).size,
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
      case 'duplicates':
        return {
          emoji: '🔀',
          label: 'Duplicates (unified)',
          count: duplicatesUnified.length,
          filesCount: duplicatesUnified.length === 0 ? 0 : new Set(duplicatesUnified.flatMap(g => g.items.map(i => getFile(i)))).size,
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

    for (const f of format) {
      const rel = typeof f === 'string' ? path.relative(process.cwd(), f) : path.relative(process.cwd(), f.file);

      lines.push(`      ${cc('·', A.dim)} ${rel}`);
    }
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

  if (
    selectedDetectors.has('dependencies') &&
    (depsDead.length > 0 || depsLayerViolations.length > 0 || depsCycleFindings.length > 0)
  ) {
    lines.push(
      sectionHeader(
        '🔗',
        'Dependencies',
        `${depsCycleFindings.length} cycles · ${depsLayerViolations.length} layer violations · ${depsDead.length} dead exports`,
      ),
    );

    if (depsDead.length > 0) {
      lines.push(`    ${cc('dead exports:', A.yellow)}`);

      for (const finding of depsDead) {
        lines.push(`      ${cc('·', A.dim)} ${finding.kind}: ${finding.module}#${finding.name}`);
      }
    }

    if (depsLayerViolations.length > 0) {
      lines.push(`    ${cc('layer violations:', A.yellow)}`);

      for (const finding of depsLayerViolations) {
        lines.push(
          `      ${cc('·', A.dim)} ${finding.fromLayer} → ${finding.toLayer} ${cc(`(${finding.from} → ${finding.to})`, A.dim)}`,
        );
      }
    }

    if (depsCycleFindings.length > 0) {
      lines.push(`    ${cc('cycles:', A.yellow)}`);

      for (const cycle of depsCycleFindings) {
        const cyclePath = cycle.items.map(i => i.file).join(' → ');

        lines.push(`      ${cc('·', A.dim)} ${cyclePath}`);

        if (cycle.cut) {
          lines.push(`        ${cc('cut:', A.dim)} ${cycle.cut.from} → ${cycle.cut.to}`);
        }
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

  if (selectedDetectors.has('implicit-state') && implicitState.length > 0) {
    lines.push(sectionHeader('🧠', 'Implicit State', `${implicitState.length} findings`));

    for (const f of implicitState) {
      const rel = path.relative(process.cwd(), getFile(f));
      const start = toPos(f.span.start.line, f.span.start.column);
      const key = typeof (f as any).key === 'string' && (f as any).key.length > 0 ? ` key=${(f as any).key}` : '';

      lines.push(`    ${cc('·', A.dim)} ${f.protocol}${key} ${cc(`@ ${rel}:${start}`, A.dim)}`);
    }
  }

  if (selectedDetectors.has('temporal-coupling') && temporalCoupling.length > 0) {
    lines.push(sectionHeader('⏱️', 'Temporal Coupling', `${temporalCoupling.length} findings`));

    for (const f of temporalCoupling) {
      const rel = path.relative(process.cwd(), getFile(f));
      const start = toPos(f.span.start.line, f.span.start.column);

      lines.push(`    ${cc('·', A.dim)} ${f.state} ${cc(`writers=${f.writers} readers=${f.readers}`, A.yellow)} ${cc(`@ ${rel}:${start}`, A.dim)}`);
    }
  }

  if (selectedDetectors.has('symmetry-breaking') && symmetryBreaking.length > 0) {
    lines.push(sectionHeader('⚖️', 'Symmetry Breaking', `${symmetryBreaking.length} findings`));

    for (const f of symmetryBreaking) {
      const rel = path.relative(process.cwd(), getFile(f));
      const start = toPos(f.span.start.line, f.span.start.column);

      lines.push(`    ${cc('·', A.dim)} ${f.group}: ${f.signature} ${cc(`majority=${f.majorityCount} outliers=${f.outlierCount}`, A.yellow)} ${cc(`@ ${rel}:${start}`, A.dim)}`);
    }
  }

  if (selectedDetectors.has('invariant-blindspot') && invariantBlindspot.length > 0) {
    lines.push(sectionHeader('🎯', 'Invariant Blindspot', `${invariantBlindspot.length} findings`));

    for (const f of invariantBlindspot) {
      const rel = path.relative(process.cwd(), getFile(f));
      const start = toPos(f.span.start.line, f.span.start.column);

      lines.push(`    ${cc('·', A.dim)} ${f.signal} ${cc(`@ ${rel}:${start}`, A.dim)}`);
    }
  }

  if (selectedDetectors.has('modification-trap') && modificationTrap.length > 0) {
    lines.push(sectionHeader('🪤', 'Modification Trap', `${modificationTrap.length} findings`));

    for (const f of modificationTrap) {
      const rel = path.relative(process.cwd(), getFile(f));
      const start = toPos(f.span.start.line, f.span.start.column);

      lines.push(`    ${cc('·', A.dim)} ${f.pattern} ${cc(`occurrences=${f.occurrences}`, A.yellow)} ${cc(`@ ${rel}:${start}`, A.dim)}`);
    }
  }

  if (selectedDetectors.has('modification-impact') && modificationImpact.length > 0) {
    lines.push(sectionHeader('💥', 'Modification Impact', `${modificationImpact.length} findings`));

    for (const f of modificationImpact) {
      const rel = path.relative(process.cwd(), getFile(f));
      const start = toPos(f.span.start.line, f.span.start.column);
      const callers = f.highRiskCallers.length > 0 ? cc(` callers=${f.highRiskCallers.join(',')}`, A.dim) : '';

      lines.push(`    ${cc('·', A.dim)} radius=${f.impactRadius}${callers} ${cc(`@ ${rel}:${start}`, A.dim)}`);
    }
  }

  if (selectedDetectors.has('variable-lifetime') && variableLifetime.length > 0) {
    lines.push(sectionHeader('⏳', 'Variable Lifetime', `${variableLifetime.length} findings`));

    for (const f of variableLifetime) {
      const rel = path.relative(process.cwd(), getFile(f));
      const start = toPos(f.span.start.line, f.span.start.column);

      lines.push(`    ${cc('·', A.dim)} ${f.variable} ${cc(`lifetime=${f.lifetimeLines}L burden=${f.contextBurden}`, A.yellow)} ${cc(`@ ${rel}:${start}`, A.dim)}`);
    }
  }

  if (selectedDetectors.has('decision-surface') && decisionSurface.length > 0) {
    lines.push(sectionHeader('🔀', 'Decision Surface', `${decisionSurface.length} findings`));

    for (const f of decisionSurface) {
      const rel = path.relative(process.cwd(), getFile(f));
      const start = toPos(f.span.start.line, f.span.start.column);

      lines.push(`    ${cc('·', A.dim)} axes=${f.axes} paths=${f.combinatorialPaths} repeats=${f.repeatedChecks} ${cc(`@ ${rel}:${start}`, A.dim)}`);
    }
  }

  if (selectedDetectors.has('implementation-overhead') && implementationOverhead.length > 0) {
    lines.push(sectionHeader('⚙️', 'Implementation Overhead', `${implementationOverhead.length} findings`));

    for (const f of implementationOverhead) {
      const rel = path.relative(process.cwd(), getFile(f));
      const start = toPos(f.span.start.line, f.span.start.column);

      lines.push(`    ${cc('·', A.dim)} ratio=${f.ratio.toFixed(1)} impl=${f.implementationComplexity} iface=${f.interfaceComplexity} ${cc(`@ ${rel}:${start}`, A.dim)}`);
    }
  }

  if (selectedDetectors.has('concept-scatter') && conceptScatter.length > 0) {
    lines.push(sectionHeader('🌐', 'Concept Scatter', `${conceptScatter.length} findings`));

    for (const f of conceptScatter) {
      const rel = path.relative(process.cwd(), getFile(f));
      const start = toPos(f.span.start.line, f.span.start.column);

      lines.push(`    ${cc('·', A.dim)} ${f.concept} ${cc(`scatter=${f.scatterIndex} files=${f.files.length} layers=${f.layers.length}`, A.yellow)} ${cc(`@ ${rel}:${start}`, A.dim)}`);
    }
  }

  if (selectedDetectors.has('abstraction-fitness') && abstractionFitness.length > 0) {
    lines.push(sectionHeader('🏋️', 'Abstraction Fitness', `${abstractionFitness.length} findings`));

    for (const f of abstractionFitness) {
      const rel = path.relative(process.cwd(), getFile(f));
      const start = toPos(f.span.start.line, f.span.start.column);

      lines.push(`    ${cc('·', A.dim)} ${f.module} ${cc(`fitness=${f.fitness.toFixed(2)} cohesion=${f.internalCohesion.toFixed(2)} coupling=${f.externalCoupling.toFixed(2)}`, A.yellow)} ${cc(`@ ${rel}:${start}`, A.dim)}`);
    }
  }

  if (selectedDetectors.has('giant-file') && giantFile.length > 0) {
    lines.push(sectionHeader('📏', 'Giant File', `${giantFile.length} findings`));

    for (const f of giantFile) {
      const rel = path.relative(process.cwd(), getFile(f));
      const metrics = (f as any).metrics;
      const lineInfo = metrics ? `${metrics.lineCount}/${metrics.maxLines} lines` : '';

      lines.push(`    ${cc('·', A.dim)} ${rel} ${cc(lineInfo, A.yellow)}`);
    }
  }

  if (selectedDetectors.has('duplicates') && duplicatesUnified.length > 0) {
    lines.push(sectionHeader('🔀', 'Duplicates (unified)', `${duplicatesUnified.length} groups`));

    for (const group of duplicatesUnified) {
      const findingLabel = group.findingKind ?? group.cloneType;
      const simLabel = group.similarity !== undefined ? ` sim=${group.similarity.toFixed(2)}` : '';
      lines.push(`    ${cc(`${group.items.length} items`, A.yellow)} ${cc(`[${findingLabel}${simLabel}]`, A.dim)}`);

      for (const item of group.items) {
        const rel = path.relative(process.cwd(), getFile(item));
        const start = toPos(item.span.start.line, item.span.start.column);
        const kindPrefix = item.kind !== 'node' ? `${item.kind}: ` : '';
        const name = item.header !== 'anonymous' ? `${kindPrefix}${item.header} ` : '';

        lines.push(`      ${cc('·', A.dim)} ${name}${cc(`@ ${rel}:${start}`, A.dim)}`);
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

    const blockers = countBlockers(report.analyses);

    lines.push('');
    lines.push(`  ${cc('⛔', A.dim)}  ${cc('Blockers', `${A.bold}${A.white}`)}  ${blockers > 0 ? cc(formatNumber(blockers), A.red) : cc('0', A.dim)}`);
  }

  lines.push('');

  return lines.join('\n').replace(/^\n/, '');
};

const formatReport = (report: FirebatReport, format: OutputFormat): string => {
  if (format === 'json') {
    return JSON.stringify(toJsonReport(report));
  }

  return formatText(report);
};

export { formatReport };
