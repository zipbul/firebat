/**
 * flatten-findings.ts — FirebatReport.analyses → Finding[] 변환
 *
 * 역할:
 *   1. 카테고리별 배열을 단일 flat list로 변환
 *   2. file-type / items-type 분해 (duplicates, circular-dep → per-item Finding)
 *   3. content-hash ID 생성 (안정적 identity 필드만 사용)
 *   4. 필드 정규화 (code/catalogCode → code, label 통합)
 *   5. detail 분리 (fixer 전용 가변 데이터 — span 포함)
 *   6. enclosing function name 주입 (header 없는 카테고리용)
 */

import type { Node } from 'oxc-parser';

import { buildLineOffsets, getLineColumn } from '@zipbul/gildash';
import { createHash } from 'node:crypto';

import type { ParsedFile } from '../../engine/types';
import type { Finding, FirebatAnalyses } from '../../types';

import { collectFunctionNodesWithParent, getNodeHeader } from '../../engine/ast';
import { itemFileString } from './finding-item-fields';

// ── Function range map (file → enclosing function lookup) ────────────────────

interface FunctionRange {
  readonly name: string;
  readonly startLine: number;
  readonly endLine: number;
}

export type FunctionRangeMap = ReadonlyMap<string, ReadonlyArray<FunctionRange>>;

/**
 * program의 각 파일에서 function 선언을 수집하여 line 범위로 정규화.
 * enclosing function lookup에 사용.
 *
 * @param toProjectRelative ParsedFile.filePath를 project-relative로 정규화
 */
export const buildFunctionRangeMap = (
  program: ReadonlyArray<ParsedFile>,
  toProjectRelative: (filePath: string) => string,
): FunctionRangeMap => {
  const map = new Map<string, FunctionRange[]>();

  for (const file of program) {
    if (file.errors.length > 0) {
      continue;
    }

    const offsets = buildLineOffsets(file.sourceText);
    const functions = collectFunctionNodesWithParent(file.program);
    const ranges: FunctionRange[] = [];

    for (const { node, parent } of functions) {
      const name = getNodeHeader(node as Node, parent as Node | null);

      if (name === 'anonymous' || name.length === 0) {
        continue;
      }

      const startLine = getLineColumn(offsets, node.start).line;
      const endLine = getLineColumn(offsets, node.end).line;

      ranges.push({ name, startLine, endLine });
    }

    map.set(toProjectRelative(file.filePath), ranges);
  }

  return map;
};

/**
 * file의 line에 포함되는 가장 작은 (innermost) enclosing function name을 반환.
 * 없으면 null.
 */
const findEnclosingFunction = (map: FunctionRangeMap | undefined, file: string, line: number): string | null => {
  if (!map || line <= 0) {
    return null;
  }

  const ranges = map.get(file);

  if (!ranges) {
    return null;
  }

  let best: FunctionRange | null = null;

  for (const range of ranges) {
    if (range.startLine <= line && line <= range.endLine) {
      if (!best || range.endLine - range.startLine < best.endLine - best.startLine) {
        best = range;
      }
    }
  }

  return best?.name ?? null;
};

// ── Hash helpers ─────────────────────────────────────────────────────────────

const hashHex12 = (s: string): string => createHash('sha1').update(s).digest('hex').slice(0, 12);

// finding id와 group id는 동일한 content-hash 규약(`${category}-${12hex}`)을 공유한다 — 단일 변경지점.
const makeContentId = (category: string, seed: string): string => `${category}-${hashHex12(seed)}`;

// ── Span helpers ─────────────────────────────────────────────────────────────

const extractLine = (finding: Record<string, unknown>): number => {
  return (finding.span as { start?: { line?: number } } | undefined)?.start?.line ?? 0;
};

/**
 * identity-relevant span portion (start.line + start.column + end.line + end.column).
 * JSON.stringify(finding)보다 안정적 — enricher가 필드 순서/추가 필드 변경해도 ID 유지.
 */
const spanIdentity = (finding: Record<string, unknown>): string => {
  const span = finding.span as
    | { start?: { line?: number; column?: number }; end?: { line?: number; column?: number } }
    | undefined;

  if (!span) {
    return '0:0:0:0';
  }

  const sl = span.start?.line ?? 0;
  const sc = span.start?.column ?? 0;
  const el = span.end?.line ?? 0;
  const ec = span.end?.column ?? 0;

  return `${sl}:${sc}:${el}:${ec}`;
};

// ── Label builders ───────────────────────────────────────────────────────────

/**
 * label은 kind + enclosing function name + 핵심 정보 조합.
 * header가 이미 있는 카테고리는 header를 사용, 없으면 functionName parameter를 활용.
 */

type LabelFn = (f: Record<string, unknown>, functionName: string | null) => string;

const withFunc = (core: string, functionName: string | null): string => (functionName ? `${core} in ${functionName}()` : core);

const labelWaste: LabelFn = (f, fn) => {
  const base = String(f.label ?? f.kind ?? 'dead-store');

  return withFunc(base, fn);
};

const labelBarrel: LabelFn = (f, _fn) => {
  const evidence = String(f.evidence ?? '');

  return evidence || String(f.kind ?? 'barrel');
};

const labelNesting: LabelFn = (f, _fn) => {
  const header = String(f.header ?? '');
  const metrics = f.metrics as Record<string, unknown> | undefined;
  const cc = metrics?.cognitiveComplexity;
  const depth = metrics?.depth;

  if (header && cc !== undefined) {
    return `${header} (CC: ${cc}, depth: ${depth ?? '?'})`;
  }

  return header || String(f.kind ?? 'nesting');
};

// kind + header 조합 라벨 ("<kind> in <header>"). defaultKind만 카테고리별로 다름.
const headerKindLabel =
  (defaultKind: string): LabelFn =>
  (f, _fn) => {
    const header = String(f.header ?? '');
    const kind = String(f.kind ?? defaultKind);

    return header ? `${kind} in ${header}` : kind;
  };

const labelEarlyReturn: LabelFn = headerKindLabel('early-return');
const labelCollapsibleIf: LabelFn = headerKindLabel('collapsible-if');

const labelErrorFlow: LabelFn = (f, fn) => {
  const evidence = String(f.evidence ?? '');
  const base = evidence || String(f.kind ?? 'error-flow');

  return withFunc(base, fn);
};

const labelIndirection: LabelFn = (f, _fn) => {
  const header = String(f.header ?? '');
  const depth = f.depth;

  return header ? `${header}${depth ? ` (depth: ${depth})` : ''}` : String(f.kind ?? 'indirection');
};

const labelDependency: LabelFn = (f, _fn) => {
  const kind = String(f.kind ?? '');

  switch (kind) {
    case 'layer-violation':
      return `${String(f.from ?? '')} → ${String(f.to ?? '')} (${String(f.fromLayer ?? '')} → ${String(f.toLayer ?? '')})`;
    case 'dead-export':
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

const labelVariableLifetime: LabelFn = (f, fn) => {
  const kind = String(f.kind ?? '');
  const variable = f.variable ? String(f.variable) : '';
  let base: string;

  switch (kind) {
    case 'scope-narrowing':
      base = variable ? `scope-narrowing: \`${variable}\`` : 'scope-narrowing';
      break;
    case 'liveness-pressure': {
      const max = f.maxLiveVariables;

      base = max !== undefined ? `liveness-pressure: ${max} live variables` : 'liveness-pressure';

      break;
    }
    case 'mutation-density': {
      const count = f.mutationCount;

      base = variable ? `mutation-density: \`${variable}\` (${count ?? '?'} mutations)` : 'mutation-density';

      break;
    }
    default:
      base = variable ? `${kind}: \`${variable}\`` : kind || 'variable-lifetime';
  }

  return withFunc(base, fn);
};

const labelTemporalCoupling: LabelFn = (f, fn) => {
  const state = String(f.state ?? '');

  return withFunc(state ? `temporal-coupling: ${state}` : 'temporal-coupling', fn);
};

const labelGiantFile: LabelFn = (f, _fn) => {
  const metrics = f.metrics as Record<string, unknown> | undefined;

  if (metrics?.lineCount !== undefined && metrics?.maxLines !== undefined) {
    return `${metrics.lineCount} lines (max: ${metrics.maxLines})`;
  }

  return 'giant-file';
};

// tool 진단 라벨 ("[<code>] <msg>"). fallback 라벨만 카테고리별로 다름.
const diagnosticLabel =
  (fallback: string): LabelFn =>
  (f, _fn) => {
    const msg = String(f.msg ?? '');
    const code = f.code ? String(f.code) : '';

    return code ? `[${code}] ${msg}` : msg || fallback;
  };

const labelLint: LabelFn = diagnosticLabel('lint');
const labelTypecheck: LabelFn = diagnosticLabel('typecheck');

const labelFormat: LabelFn = (_f, _fn) => 'needs-formatting';

const labelDuplicateItem = (item: Record<string, unknown>, cloneType: string): string => {
  const header = String(item.header ?? '');

  return header ? `${cloneType}: ${header}` : cloneType;
};

// ── Label router ─────────────────────────────────────────────────────────────

const LABEL_BY_CATEGORY: Readonly<Record<string, LabelFn>> = {
  waste: labelWaste,
  barrel: labelBarrel,
  nesting: labelNesting,
  'early-return': labelEarlyReturn,
  'collapsible-if': labelCollapsibleIf,
  'error-flow': labelErrorFlow,
  indirection: labelIndirection,
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
 * detail: fixer 전용 가변 데이터.
 * span은 보존 (B1) — fixer가 정확한 위치 참조에 필요.
 */
const COMMON_KEYS = new Set(['kind', 'code', 'file', 'filePath', 'label', 'catalogCode']);

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

    detail[key] = value;
    hasContent = true;
  }

  return hasContent ? detail : null;
};

// ── Normalizers ──────────────────────────────────────────────────────────────

export const normalizeCode = (finding: Record<string, unknown>): string => {
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

/**
 * Hash seed: 전체 finding 내용 기반.
 * 이유: ZERO_SPAN 카테고리(dead-export, unused-enum-member 등)는 span이
 * 모두 0:0:0:0이므로, identity는 name/symbolName/memberName/packageName 등
 * 카테고리별 식별자 필드에 있다. 이들을 일일이 열거하기보다
 * 전체 finding을 JSON 직렬화하는 게 uniqueness 보장에 안전하다.
 *
 * 안정성: 같은 코드베이스 + 같은 enricher 버전이면 동일 finding → 동일 hash.
 * enricher 코드가 변경되면 hash도 변경되지만, 이는 단일 firebat 세션 내에서는
 * 발생하지 않으므로 Phase 1↔Phase 2 간 ID 비교에는 영향 없음.
 */
const makeFindingSeed = (category: string, code: string, file: string, finding: Record<string, unknown>, kind: string): string =>
  `${category}|${code}|${file}|${kind}|${JSON.stringify(finding)}`;

const flattenFileFinding = (
  category: string,
  finding: Record<string, unknown>,
  labelFn: LabelFn,
  functionMap: FunctionRangeMap | undefined,
): Finding => {
  const code = normalizeCode(finding);
  const file = normalizeFile(finding);
  const line = extractLine(finding);
  const kind = String(finding.kind ?? category);
  const functionName = findEnclosingFunction(functionMap, file, line);
  const label = labelFn(finding, functionName);
  const seed = makeFindingSeed(category, code, file, finding, kind);
  const detail = extractDetail(finding, category);

  return {
    id: makeContentId(category, seed),
    category,
    code,
    file,
    line,
    kind,
    label,
    // groupId 생략 = null (file-type), primary 생략 = true (기본값)
    ...(detail !== null ? { detail } : {}),
  };
};

const flattenItemsFinding = (
  category: string,
  finding: Record<string, unknown>,
  labelFn: LabelFn,
  functionMap: FunctionRangeMap | undefined,
): Finding[] => {
  const items = finding.items as ReadonlyArray<Record<string, unknown>> | undefined;

  if (!items?.length) {
    return [];
  }

  const code = normalizeCode(finding);
  const kind = String(finding.kind ?? finding.cloneType ?? category);
  // Group seed: 전체 finding JSON 사용 — 같은 file 조합이지만 서로 다른 코드 블록인
  // duplicate 그룹을 구분. uniqueness 보장.
  const groupSeed = `${category}|${code}|${kind}|${JSON.stringify(finding)}`;
  const groupId = makeContentId(category, groupSeed);
  const results: Finding[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const isPrimary = i === 0;
    const file = itemFileString(item);
    const line = extractLine(item);
    const itemSeed = `${groupSeed}|${file}|${spanIdentity(item)}|i${i}`;
    const functionName = findEnclosingFunction(functionMap, file, line);
    // items에는 parent의 kind가 없으므로 주입
    const label = category === 'duplicates' ? labelDuplicateItem(item, kind) : labelFn({ ...item, kind }, functionName);
    const primaryDetail = isPrimary ? extractDetail(finding, category) : null;

    results.push({
      id: makeContentId(category, itemSeed),
      category,
      code,
      file,
      line,
      kind,
      label,
      groupId,
      ...(isPrimary ? {} : { primary: false as const }),
      ...(primaryDetail !== null ? { detail: primaryDetail } : {}),
    });
  }

  return results;
};

const isItemsFinding = (finding: Record<string, unknown>): boolean =>
  Array.isArray(finding.items) && !finding.file && !finding.filePath;

// ── Public API ───────────────────────────────────────────────────────────────

export const flattenToFindings = (analyses: Partial<FirebatAnalyses>, functionMap?: FunctionRangeMap): Finding[] => {
  const findings: Finding[] = [];
  const seenIds = new Set<string>();

  // id 기준 중복 제거 후 수집하는 단일 규약.
  const pushUnique = (f: Finding): void => {
    if (!seenIds.has(f.id)) {
      seenIds.add(f.id);
      findings.push(f);
    }
  };

  for (const [category, items] of Object.entries(analyses)) {
    if (!Array.isArray(items)) {
      continue;
    }

    const labelFn: LabelFn = LABEL_BY_CATEGORY[category] ?? ((f: Record<string, unknown>) => String(f.kind ?? category));

    for (const rawFinding of items) {
      const finding = rawFinding as Record<string, unknown>;

      if (isItemsFinding(finding)) {
        for (const f of flattenItemsFinding(category, finding, labelFn, functionMap)) {
          pushUnique(f);
        }
      } else {
        pushUnique(flattenFileFinding(category, finding, labelFn, functionMap));
      }
    }
  }

  return findings;
};
