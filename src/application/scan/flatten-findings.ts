/**
 * flatten-findings.ts — FirebatReport.analyses → Finding[] 변환
 *
 * 역할:
 *   1. 카테고리별 배열을 단일 flat list로 변환
 *   2. file-type / items-type 분해 (duplicates, circular-dep → per-item Finding)
 *   3. content-hash ID 생성 (category + code + file + line + kind)
 *   4. 필드 정규화 (code/catalogCode → code, label 통합)
 *   5. detail 분리 (fixer 전용 가변 데이터)
 */

import { createHash } from 'node:crypto';

import type { Finding, FirebatAnalyses } from '../../types';

// ── Hash helpers ─────────────────────────────────────────────────────────────

const hashHex12 = (s: string): string => createHash('sha1').update(s).digest('hex').slice(0, 12);

const makeFindingId = (category: string, seed: string): string => `${category}-${hashHex12(seed)}`;

const makeGroupId = (category: string, seed: string): string => `${category}-${hashHex12(seed)}`;

// ── Label builders ───────────────────────────────────────────────────────────

/**
 * label 조합 전략: 기존 필드에서 최대 정보밀도 문자열 생성.
 * function name + code excerpt + cause 를 한 줄에 담는다.
 */

const extractLine = (finding: Record<string, unknown>): number => {
  const span = finding.span as { start?: { line?: number } } | undefined;

  return span?.start?.line ?? 0;
};

const labelWaste = (f: Record<string, unknown>): string => {
  const label = String(f.label ?? '');

  return label || `${String(f.kind ?? 'dead-store')}`;
};

const labelBarrel = (f: Record<string, unknown>): string => {
  const evidence = String(f.evidence ?? '');

  return evidence || String(f.kind ?? 'barrel');
};

const labelNesting = (f: Record<string, unknown>): string => {
  const header = String(f.header ?? '');
  const metrics = f.metrics as Record<string, unknown> | undefined;
  const cc = metrics?.cognitiveComplexity;
  const depth = metrics?.depth;

  if (header && cc !== undefined) {
    return `${header} (CC: ${cc}, depth: ${depth ?? '?'})`;
  }

  return header || String(f.kind ?? 'nesting');
};

const labelEarlyReturn = (f: Record<string, unknown>): string => {
  const header = String(f.header ?? '');

  return header ? `${String(f.kind ?? 'early-return')} in ${header}` : String(f.kind ?? 'early-return');
};

const labelCollapsibleIf = (f: Record<string, unknown>): string => {
  const header = String(f.header ?? '');

  return header ? `${String(f.kind ?? 'collapsible-if')} in ${header}` : String(f.kind ?? 'collapsible-if');
};

const labelErrorFlow = (f: Record<string, unknown>): string => {
  const evidence = String(f.evidence ?? '');

  return evidence || String(f.kind ?? 'error-flow');
};

const labelUnknownProof = (f: Record<string, unknown>): string => {
  const symbol = f.symbol ? String(f.symbol) : '';
  const evidence = String(f.evidence ?? '');

  if (symbol && evidence) {
    return `${symbol}: ${evidence}`;
  }

  return symbol || evidence || String(f.kind ?? 'unknown');
};

const labelIndirection = (f: Record<string, unknown>): string => {
  const header = String(f.header ?? '');
  const depth = f.depth;

  return header ? `${header}${depth ? ` (depth: ${depth})` : ''}` : String(f.kind ?? 'indirection');
};

const labelCoupling = (f: Record<string, unknown>): string => {
  const module = String(f.module ?? f.file ?? '');
  const signals = f.signals as string[] | undefined;
  const score = f.score;

  if (module && signals?.length) {
    return `${module} (${signals.join(', ')}${score !== undefined ? `, score: ${score}` : ''})`;
  }

  return module || String(f.kind ?? 'coupling');
};

const labelDependency = (f: Record<string, unknown>): string => {
  const kind = String(f.kind ?? '');

  switch (kind) {
    case 'layer-violation':
      return `${String(f.from ?? '')} → ${String(f.to ?? '')} (${String(f.fromLayer ?? '')} → ${String(f.toLayer ?? '')})`;
    case 'dead-export':
    case 'test-only-export':
      return `${kind}: '${String(f.name ?? '')}' in ${String(f.module ?? f.file ?? '')}`;
    case 'unused-file':
      return `unused file: ${String(f.module ?? f.file ?? '')}`;
    case 'unused-dependency':
    case 'unlisted-dependency':
      return `${kind}: ${String(f.packageName ?? '')}`;
    case 'unresolved-import':
      return `unresolved: ${String(f.specifier ?? '')} in ${String(f.module ?? f.file ?? '')}`;
    case 'duplicate-export':
      return `duplicate export: '${String(f.name ?? '')}'`;
    case 'unused-enum-member':
    case 'unused-ns-export':
    case 'unused-ns-member':
      return `${kind}: ${String(f.symbolName ?? '')}.${String(f.memberName ?? '')}`;
    case 'circular-dependency':
      return `circular-dependency: ${String(f.file ?? '')}`;
    default:
      return kind || String(f.file ?? '');
  }
};

const labelVariableLifetime = (f: Record<string, unknown>): string => {
  const kind = String(f.kind ?? '');
  const variable = f.variable ? String(f.variable) : '';

  switch (kind) {
    case 'scope-narrowing':
      return variable ? `scope-narrowing: \`${variable}\`` : 'scope-narrowing';
    case 'liveness-pressure': {
      const max = f.maxLiveVariables;

      return max !== undefined ? `liveness-pressure: ${max} live variables` : 'liveness-pressure';
    }
    case 'mutation-density': {
      const count = f.mutationCount;

      return variable
        ? `mutation-density: \`${variable}\` (${count ?? '?'} mutations)`
        : 'mutation-density';
    }
    default:
      return variable ? `${kind}: \`${variable}\`` : kind || 'variable-lifetime';
  }
};

const labelTemporalCoupling = (f: Record<string, unknown>): string => {
  const state = String(f.state ?? '');

  return state ? `temporal-coupling: ${state}` : 'temporal-coupling';
};

const labelGiantFile = (f: Record<string, unknown>): string => {
  const metrics = f.metrics as Record<string, unknown> | undefined;

  if (metrics?.lineCount !== undefined && metrics?.maxLines !== undefined) {
    return `${metrics.lineCount} lines (max: ${metrics.maxLines})`;
  }

  return 'giant-file';
};

const labelLint = (f: Record<string, unknown>): string => {
  const msg = String(f.msg ?? '');
  const code = f.code ? String(f.code) : '';

  return code ? `[${code}] ${msg}` : msg || 'lint';
};

const labelTypecheck = (f: Record<string, unknown>): string => {
  const msg = String(f.msg ?? '');
  const code = f.code ? String(f.code) : '';

  return code ? `[${code}] ${msg}` : msg || 'typecheck';
};

const labelFormat = (_f: Record<string, unknown>): string => 'needs-formatting';

const labelDuplicateItem = (item: Record<string, unknown>, cloneType: string): string => {
  const header = String(item.header ?? '');

  return header ? `${cloneType}: ${header}` : cloneType;
};

// ── Label router ─────────────────────────────────────────────────────────────

type LabelFn = (f: Record<string, unknown>) => string;

const LABEL_BY_CATEGORY: Readonly<Record<string, LabelFn>> = {
  waste: labelWaste,
  barrel: labelBarrel,
  nesting: labelNesting,
  'early-return': labelEarlyReturn,
  'collapsible-if': labelCollapsibleIf,
  'error-flow': labelErrorFlow,
  'unknown-proof': labelUnknownProof,
  indirection: labelIndirection,
  coupling: labelCoupling,
  dependencies: labelDependency,
  'variable-lifetime': labelVariableLifetime,
  'temporal-coupling': labelTemporalCoupling,
  'giant-file': labelGiantFile,
  lint: labelLint,
  typecheck: labelTypecheck,
  format: labelFormat,
};

// ── Detail extractors ────────────────────────────────────────────────────────

/**
 * detail: fixer 전용 가변 데이터. planner에게 불필요한 필드만 포함.
 * 공통 필드 (kind, code, file, span)는 제외.
 */

const COMMON_KEYS = new Set(['kind', 'code', 'file', 'filePath', 'span', 'label', 'catalogCode']);

const extractDetail = (finding: Record<string, unknown>, category: string): Readonly<Record<string, unknown>> | null => {
  const detail: Record<string, unknown> = {};
  let hasContent = false;
  const hasCatalogCode = Boolean(finding.catalogCode);

  for (const [key, value] of Object.entries(finding)) {
    // lint/typecheck: code는 tool-specific (룰명/TS에러코드)이므로 detail에 보존
    if (key === 'code' && hasCatalogCode) {
      detail.ruleCode = value;
      hasContent = true;

      continue;
    }

    if (COMMON_KEYS.has(key)) {
      continue;
    }

    // 카테고리별로 planner에도 필요한 필드는 제외 (이미 label에 반영됨)
    if (category === 'nesting' && key === 'header') {
      continue;
    }

    if (category === 'coupling' && key === 'module') {
      continue;
    }

    detail[key] = value;
    hasContent = true;
  }

  return hasContent ? detail : null;
};

// ── Normalizers ──────────────────────────────────────────────────────────────

const normalizeCode = (finding: Record<string, unknown>): string => {
  // catalogCode가 있으면 우선 (lint/typecheck는 code에 룰명이 들어감)
  const catalogCode = String(finding.catalogCode ?? '');

  if (catalogCode) {
    return catalogCode;
  }

  return String(finding.code ?? '');
};

const normalizeFile = (finding: Record<string, unknown>): string =>
  String(finding.file ?? finding.filePath ?? finding.module ?? '');

// ── Core flatten ─────────────────────────────────────────────────────────────

const flattenFileFinding = (
  category: string,
  finding: Record<string, unknown>,
  labelFn: LabelFn,
): Finding => {
  const code = normalizeCode(finding);
  const file = normalizeFile(finding);
  const line = extractLine(finding);
  const kind = String(finding.kind ?? category);
  const label = labelFn(finding);

  const seed = `${category}|${code}|${file}|${line}|${kind}|${JSON.stringify(finding)}`;

  return {
    id: makeFindingId(category, seed),
    category,
    code,
    file,
    line,
    kind,
    label,
    group_id: null,
    primary: true,
    detail: extractDetail(finding, category),
  };
};

const flattenItemsFinding = (
  category: string,
  finding: Record<string, unknown>,
  labelFn: LabelFn,
): Finding[] => {
  const items = finding.items as ReadonlyArray<Record<string, unknown>> | undefined;

  if (!items?.length) {
    return [];
  }

  const code = normalizeCode(finding);
  const kind = String(finding.kind ?? finding.cloneType ?? category);
  const groupSeed = `${category}|${code}|${JSON.stringify(finding)}`;
  const groupId = makeGroupId(category, groupSeed);

  const results: Finding[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const isPrimary = i === 0;
    const file = String(item.file ?? item.filePath ?? '');
    const line = extractLine(item);
    const itemSeed = `${groupSeed}|i${i}`;

    // items에는 parent의 kind가 없으므로 주입
    const label = category === 'duplicates'
      ? labelDuplicateItem(item, kind)
      : labelFn({ ...item, kind });

    results.push({
      id: makeFindingId(category, itemSeed),
      category,
      code,
      file,
      line,
      kind,
      label,
      group_id: groupId,
      primary: isPrimary,
      detail: isPrimary ? extractDetail(finding, category) : null,
    });
  }

  return results;
};

const isItemsFinding = (finding: Record<string, unknown>): boolean =>
  Array.isArray(finding.items) && !finding.file && !finding.filePath;

// ── Public API ───────────────────────────────────────────────────────────────

export const flattenToFindings = (analyses: Partial<FirebatAnalyses>): Finding[] => {
  const findings: Finding[] = [];
  const seenIds = new Set<string>();

  for (const [category, items] of Object.entries(analyses)) {
    if (!Array.isArray(items)) {
      continue;
    }

    const labelFn = LABEL_BY_CATEGORY[category] ?? ((f: Record<string, unknown>) => String(f.kind ?? category));

    for (const rawFinding of items) {
      const finding = rawFinding as Record<string, unknown>;

      if (isItemsFinding(finding)) {
        for (const f of flattenItemsFinding(category, finding, labelFn)) {
          if (!seenIds.has(f.id)) {
            seenIds.add(f.id);
            findings.push(f);
          }
        }
      } else {
        const f = flattenFileFinding(category, finding, labelFn);

        if (!seenIds.has(f.id)) {
          seenIds.add(f.id);
          findings.push(f);
        }
      }
    }
  }

  return findings;
};
