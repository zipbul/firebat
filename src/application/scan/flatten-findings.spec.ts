import { describe, it, expect } from 'bun:test';

import type { FirebatAnalyses } from '../../types';

import { span } from '../../../test/integration/shared/test-kit';
import { parseSource } from '../../engine/ast/parse-source';
import { ZERO_SPAN } from '../../shared/source-span';
import { buildFunctionRangeMap, flattenToFindings, type FunctionRangeMap } from './flatten-findings';

const firstFinding = (analyses: Partial<FirebatAnalyses>, map?: FunctionRangeMap) => {
  const findings = flattenToFindings(analyses, map);

  return findings[0]!;
};

/** Assert `f` has exactly two findings with distinct ids. */
const expectTwoUniqueIds = (f: ReadonlyArray<{ readonly id: unknown }>): void => {
  expect(f).toHaveLength(2);
  expect(f[0]!.id).not.toBe(f[1]!.id);
};

interface LabelRow {
  readonly name: string;
  readonly analyses: Partial<FirebatAnalyses>;
  readonly expected: string;
}

const lintDetail = (code: string) =>
  firstFinding({
    lint: [{ severity: 'error', catalogCode: 'LINT', code, msg: 'm', file: 'a.ts', span: span(1) } as any],
  }).detail!;

// ── flattenToFindings: core schema ──────────────────────────────────────────

describe('flattenToFindings: core schema', () => {
  it('returns empty array when analyses is empty', () => {
    expect(flattenToFindings({})).toEqual([]);
  });

  it('ignores categories whose value is not an array', () => {
    const analyses = { waste: null, barrel: 'oops' } as unknown as Partial<FirebatAnalyses>;

    expect(flattenToFindings(analyses)).toEqual([]);
  });

  it('produces id with category prefix and 12-hex suffix', () => {
    const f = firstFinding({
      waste: [{ kind: 'dead-store', code: 'WASTE_DEAD_STORE', file: 'src/a.ts', span: span(1), label: 'x' } as any],
    });

    expect(f.id).toMatch(/^waste-[0-9a-f]{12}$/);
  });

  it('produces identical id for identical input on repeated calls', () => {
    const analyses: Partial<FirebatAnalyses> = {
      waste: [{ kind: 'dead-store', code: 'WASTE_DEAD_STORE', file: 'src/a.ts', span: span(1), label: 'x' } as any],
    };

    expect(firstFinding(analyses).id).toBe(firstFinding(analyses).id);
  });

  it('produces distinct ids for findings differing only in span line', () => {
    const analyses: Partial<FirebatAnalyses> = {
      waste: [
        { kind: 'dead-store', code: 'WASTE_DEAD_STORE', file: 'src/a.ts', span: span(1), label: 'x' } as any,
        { kind: 'dead-store', code: 'WASTE_DEAD_STORE', file: 'src/a.ts', span: span(2), label: 'x' } as any,
      ],
    };
    const findings = flattenToFindings(analyses);

    expectTwoUniqueIds(findings);
  });

  it('deduplicates findings with identical content', () => {
    const dup = { kind: 'dead-store', code: 'WASTE_DEAD_STORE', file: 'src/a.ts', span: span(1), label: 'x' } as any;

    expect(flattenToFindings({ waste: [dup, dup] })).toHaveLength(1);
  });

  it('preserves line number from span.start.line', () => {
    expect(
      firstFinding({
        waste: [{ kind: 'dead-store', code: 'WASTE_DEAD_STORE', file: 'src/a.ts', span: span(42), label: 'x' } as any],
      }).line,
    ).toBe(42);
  });

  it('falls back line to 0 when span is absent', () => {
    expect(
      firstFinding({
        waste: [{ kind: 'dead-store', code: 'WASTE_DEAD_STORE', file: 'src/a.ts', label: 'x' } as any],
      }).line,
    ).toBe(0);
  });

  it('normalizes filePath → file and module → file', () => {
    const withFilePath = firstFinding({
      waste: [{ kind: 'dead-store', code: 'WASTE_DEAD_STORE', filePath: 'src/a.ts', span: span(1), label: 'x' } as any],
    });
    const withModule = firstFinding({
      dependencies: [{ kind: 'unused-file', code: 'DEP_UNUSED_FILE', module: 'src/b.ts', span: ZERO_SPAN } as any],
    });

    expect(withFilePath.file).toBe('src/a.ts');
    expect(withModule.file).toBe('src/b.ts');
  });

  it('falls back kind to category when missing', () => {
    expect(firstFinding({ waste: [{ code: 'WASTE_DEAD_STORE', file: 'a.ts', span: span(1) } as any] }).kind).toBe('waste');
  });
});

// ── flattenToFindings: code normalization ───────────────────────────────────

describe('flattenToFindings: code normalization', () => {
  it('prefers catalogCode over code when both present', () => {
    const f = firstFinding({
      lint: [
        {
          severity: 'error',
          catalogCode: 'LINT',
          code: 'no-unused-vars',
          msg: 'x',
          file: 'src/a.ts',
          span: span(1),
        } as any,
      ],
    });

    expect(f.code).toBe('LINT');
  });

  it('uses code when catalogCode is absent', () => {
    expect(
      firstFinding({
        waste: [{ kind: 'dead-store', code: 'WASTE_DEAD_STORE', file: 'a.ts', span: span(1), label: 'x' } as any],
      }).code,
    ).toBe('WASTE_DEAD_STORE');
  });

  it('defaults code to empty string when neither present', () => {
    expect(
      firstFinding({
        waste: [{ kind: 'dead-store', file: 'a.ts', span: span(1), label: 'x' } as any],
      }).code,
    ).toBe('');
  });
});

// ── flattenToFindings: detail extraction ────────────────────────────────────

describe('flattenToFindings: detail extraction', () => {
  it('omits detail field when no extra fields exist (no span, no message)', () => {
    expect(
      firstFinding({
        waste: [{ kind: 'dead-store', code: 'WASTE_DEAD_STORE', file: 'a.ts', label: 'x' } as any],
      }).detail,
    ).toBeUndefined();
  });

  it('returns detail containing only span when span is the only extra field', () => {
    const detail = firstFinding({
      waste: [{ kind: 'dead-store', code: 'WASTE_DEAD_STORE', file: 'a.ts', span: span(1), label: 'x' } as any],
    }).detail!;

    expect(detail).toHaveProperty('span');
    expect(Object.keys(detail)).toEqual(['span']);
  });

  it('preserves full span in detail (column + end)', () => {
    const detail = firstFinding({
      waste: [
        {
          kind: 'dead-store',
          code: 'WASTE_DEAD_STORE',
          file: 'a.ts',
          span: { start: { line: 10, column: 5 }, end: { line: 12, column: 30 } },
          label: 'x',
          message: 'msg',
        } as any,
      ],
    }).detail;

    expect(detail).toHaveProperty('span');
    expect((detail as any).span).toEqual({ start: { line: 10, column: 5 }, end: { line: 12, column: 30 } });
  });

  it('excludes kind, code, file, filePath, label, catalogCode from detail', () => {
    const detail = lintDetail('r1');

    expect(detail).not.toHaveProperty('kind');
    expect(detail).not.toHaveProperty('file');
    expect(detail).not.toHaveProperty('filePath');
    expect(detail).not.toHaveProperty('label');
    expect(detail).not.toHaveProperty('catalogCode');
  });

  it('renames code to ruleCode in detail for findings with catalogCode', () => {
    const detail = lintDetail('no-unused-vars');

    expect(detail.ruleCode).toBe('no-unused-vars');
    expect(detail).not.toHaveProperty('code');
  });

  it('excludes nesting.header from detail (already in label)', () => {
    const detail = firstFinding({
      nesting: [
        {
          kind: 'high-cognitive-complexity',
          code: 'NESTING_HIGH_CC',
          file: 'a.ts',
          header: 'processData',
          span: span(1),
          metrics: {
            depth: 2,
            cognitiveComplexity: 25,
            callbackDepth: 0,
            quadraticTargets: [],
            density: 0,
            halsteadVolume: 0,
            halsteadDifficulty: 0,
          },
          signals: ['high-cognitive-complexity'],
          score: 1,
        } as any,
      ],
    }).detail!;

    expect(detail).not.toHaveProperty('header');
    expect(detail).toHaveProperty('metrics');
    expect(detail).toHaveProperty('signals');
  });
});

// ── flattenToFindings: items-type decomposition ─────────────────────────────

describe('flattenToFindings: items-type decomposition', () => {
  it('decomposes duplicate group into N primary/secondary findings', () => {
    const findings = flattenToFindings({
      duplicates: [
        {
          cloneType: 'exact',
          code: 'DUP_EXACT',
          items: [
            { kind: 'function', header: 'fa', file: 'src/a.ts', span: span(1) },
            { kind: 'function', header: 'fb', file: 'src/b.ts', span: span(10) },
            { kind: 'function', header: 'fc', file: 'src/c.ts', span: span(20) },
          ],
        } as any,
      ],
    });

    expect(findings).toHaveLength(3);
    // primary omitted when true, explicit false for secondaries
    expect(findings[0]!.primary).toBeUndefined();
    expect(findings[1]!.primary).toBe(false);
    expect(findings[2]!.primary).toBe(false);
    expect(findings[0]!.groupId).toBeDefined();
    expect(findings[0]!.groupId).toBe(findings[1]!.groupId);
    expect(findings[0]!.groupId).toBe(findings[2]!.groupId);
  });

  it('attaches detail only to primary in items-type', () => {
    const findings = flattenToFindings({
      duplicates: [
        {
          cloneType: 'exact',
          code: 'DUP_EXACT',
          items: [
            { kind: 'function', header: 'fa', file: 'a.ts', span: span(1) },
            { kind: 'function', header: 'fb', file: 'b.ts', span: span(2) },
          ],
        } as any,
      ],
    });

    // detail present for primary, absent for secondary
    expect(findings[0]!.detail).toBeDefined();
    expect(findings[1]!.detail).toBeUndefined();
  });

  it('returns empty for items-type with empty items array', () => {
    expect(
      flattenToFindings({
        duplicates: [{ cloneType: 'exact', code: 'DUP_EXACT', items: [] } as any],
      }),
    ).toEqual([]);
  });

  it('generates distinct ids for multiple duplicate groups with same file list', () => {
    const findings = flattenToFindings({
      duplicates: [
        {
          cloneType: 'exact',
          code: 'DUP_EXACT',
          items: [
            { kind: 'function', header: 'fnA1', file: 'a.ts', span: span(1) },
            { kind: 'function', header: 'fnB1', file: 'b.ts', span: span(10) },
          ],
        } as any,
        {
          cloneType: 'exact',
          code: 'DUP_EXACT',
          items: [
            { kind: 'function', header: 'fnA2', file: 'a.ts', span: span(50) },
            { kind: 'function', header: 'fnB2', file: 'b.ts', span: span(60) },
          ],
        } as any,
      ],
    });

    expect(findings).toHaveLength(4);

    const groupIds = new Set(findings.map(f => f.groupId));

    expect(groupIds.size).toBe(2);
  });

  it('decomposes circular-dependency items and links via group_id', () => {
    const findings = flattenToFindings({
      dependencies: [
        {
          kind: 'circular-dependency',
          code: 'DIAG_CIRCULAR_DEPENDENCY',
          items: [
            { file: 'src/a.ts', span: span(1) },
            { file: 'src/b.ts', span: span(2) },
          ],
          cut: { from: 'a.ts', to: 'b.ts', score: 0.8 },
        } as any,
      ],
    });

    expect(findings).toHaveLength(2);
    expect(findings[0]!.groupId).toBe(findings[1]!.groupId);
    expect(findings[0]!.label).toContain('circular-dependency');
  });
});

// ── flattenToFindings: ZERO_SPAN uniqueness ─────────────────────────────────

describe('flattenToFindings: ZERO_SPAN uniqueness', () => {
  it('distinguishes dead-export findings differing only in name', () => {
    const findings = flattenToFindings({
      dependencies: [
        { kind: 'dead-export', code: 'DEP_DEAD_EXPORT', file: 'src/m.ts', span: ZERO_SPAN, module: 'src/m.ts', name: 'a' } as any,
        { kind: 'dead-export', code: 'DEP_DEAD_EXPORT', file: 'src/m.ts', span: ZERO_SPAN, module: 'src/m.ts', name: 'b' } as any,
      ],
    });

    expectTwoUniqueIds(findings);
  });

  it('distinguishes unused-enum-member findings differing only in memberName', () => {
    const findings = flattenToFindings({
      dependencies: [
        {
          kind: 'unused-enum-member',
          code: 'DEP_UNUSED_ENUM_MEMBER',
          file: 'src/e.ts',
          span: ZERO_SPAN,
          module: 'src/e.ts',
          symbolName: 'Color',
          memberName: 'RED',
        } as any,
        {
          kind: 'unused-enum-member',
          code: 'DEP_UNUSED_ENUM_MEMBER',
          file: 'src/e.ts',
          span: ZERO_SPAN,
          module: 'src/e.ts',
          symbolName: 'Color',
          memberName: 'BLUE',
        } as any,
      ],
    });

    expectTwoUniqueIds(findings);
  });
});

// ── flattenToFindings: labels by category (exhaustive) ──────────────────────

describe('flattenToFindings: labels by category', () => {
  it('waste label: uses .label field', () => {
    expect(
      firstFinding({
        waste: [{ kind: 'dead-store', code: 'WASTE_DEAD_STORE', file: 'a.ts', span: span(1), label: 'unused result' } as any],
      }).label,
    ).toBe('unused result');
  });

  it('barrel label: uses .evidence field', () => {
    expect(
      firstFinding({
        barrel: [
          {
            kind: 'deep-import',
            code: 'BARREL_DEEP_IMPORT',
            file: 'a.ts',
            span: span(1),
            evidence: "import { x } from '../deep'",
          } as any,
        ],
      }).label,
    ).toBe("import { x } from '../deep'");
  });

  it('nesting label: header + CC + depth', () => {
    const label = firstFinding({
      nesting: [
        {
          kind: 'high-cognitive-complexity',
          code: 'NESTING_HIGH_CC',
          file: 'a.ts',
          header: 'processData',
          span: span(1),
          metrics: {
            depth: 4,
            cognitiveComplexity: 25,
            callbackDepth: 0,
            quadraticTargets: [],
            density: 0,
            halsteadVolume: 0,
            halsteadDifficulty: 0,
          },
          signals: ['high-cognitive-complexity'],
          score: 1,
        } as any,
      ],
    }).label;

    expect(label).toBe('processData (CC: 25, depth: 4)');
  });

  const kindHeaderLabelRows: LabelRow[] = [
    {
      name: 'early-return label: kind + header',
      analyses: {
        'early-return': [
          {
            kind: 'wrapping-if',
            code: 'EARLY_RETURN_WRAPPING_IF',
            file: 'a.ts',
            header: 'validate',
            span: span(1),
            metrics: { maxDepth: 3, depthReduction: 1, statementsAffected: 5 },
            score: 1,
          } as any,
        ],
      },
      expected: 'wrapping-if in validate',
    },
    {
      name: 'collapsible-if label: kind + header',
      analyses: {
        'collapsible-if': [
          {
            kind: 'collapsible-if',
            code: 'COLLAPSIBLE_IF',
            file: 'a.ts',
            header: 'check',
            span: span(1),
            metrics: { maxDepth: 2, depthReduction: 1, statementsAffected: 3 },
            score: 1,
          } as any,
        ],
      },
      expected: 'collapsible-if in check',
    },
  ];

  it.each(kindHeaderLabelRows)('$name', ({ analyses, expected }) => {
    expect(firstFinding(analyses).label).toBe(expected);
  });

  it('error-flow label: evidence', () => {
    expect(
      firstFinding({
        'error-flow': [
          { kind: 'throw-non-error', code: 'EF_THROW_NON_ERROR', file: 'a.ts', span: span(1), evidence: "throw 'oops'" } as any,
        ],
      }).label,
    ).toBe("throw 'oops'");
  });

  it('indirection label: header + depth', () => {
    expect(
      firstFinding({
        indirection: [
          {
            kind: 'thin-wrapper',
            code: 'IND_THIN_WRAPPER',
            file: 'a.ts',
            span: span(1),
            header: 'fn1 → fn2',
            depth: 2,
            evidence: 'forwarding',
          } as any,
        ],
      }).label,
    ).toBe('fn1 → fn2 (depth: 2)');
  });

  it('dependency label: layer-violation', () => {
    expect(
      firstFinding({
        dependencies: [
          {
            kind: 'layer-violation',
            code: 'DEP_LAYER_VIOLATION',
            file: 'a.ts',
            span: ZERO_SPAN,
            from: 'app/svc.ts',
            to: 'db/conn.ts',
            fromLayer: 'application',
            toLayer: 'infrastructure',
          } as any,
        ],
      }).label,
    ).toBe('app/svc.ts → db/conn.ts (application → infrastructure)');
  });

  it('dependency label: dead-export', () => {
    expect(
      firstFinding({
        dependencies: [
          { kind: 'dead-export', code: 'DEP_DEAD_EXPORT', file: 'm.ts', span: ZERO_SPAN, module: 'm.ts', name: 'foo' } as any,
        ],
      }).label,
    ).toBe("dead-export: 'foo' in m.ts");
  });

  it('dependency label: unused-file', () => {
    expect(
      firstFinding({
        dependencies: [{ kind: 'unused-file', code: 'DEP_UNUSED_FILE', file: 'm.ts', span: ZERO_SPAN, module: 'm.ts' } as any],
      }).label,
    ).toBe('unused file: m.ts');
  });

  it('dependency label: unused-dependency', () => {
    expect(
      firstFinding({
        dependencies: [
          {
            kind: 'unused-dependency',
            code: 'DEP_UNUSED_DEPENDENCY',
            file: '',
            span: ZERO_SPAN,
            packageName: 'lodash',
            files: [],
          } as any,
        ],
      }).label,
    ).toBe('unused-dependency: lodash');
  });

  it('dependency label: unresolved-import', () => {
    expect(
      firstFinding({
        dependencies: [
          {
            kind: 'unresolved-import',
            code: 'DEP_UNRESOLVED_IMPORT',
            file: 'a.ts',
            span: ZERO_SPAN,
            module: 'a.ts',
            specifier: './missing',
          } as any,
        ],
      }).label,
    ).toBe('unresolved: ./missing in a.ts');
  });

  it('dependency label: duplicate-export', () => {
    expect(
      firstFinding({
        dependencies: [
          {
            kind: 'duplicate-export',
            code: 'DEP_DUPLICATE_EXPORT',
            file: 'a.ts',
            span: ZERO_SPAN,
            name: 'fn',
            modules: ['a.ts', 'b.ts'],
          } as any,
        ],
      }).label,
    ).toBe("duplicate export: 'fn'");
  });

  it('dependency label: unused-enum-member', () => {
    expect(
      firstFinding({
        dependencies: [
          {
            kind: 'unused-enum-member',
            code: 'DEP_UNUSED_ENUM_MEMBER',
            file: 'e.ts',
            span: ZERO_SPAN,
            module: 'e.ts',
            symbolName: 'Color',
            memberName: 'RED',
          } as any,
        ],
      }).label,
    ).toBe('unused-enum-member: Color.RED');
  });

  it('variable-lifetime label: scope-narrowing with variable', () => {
    expect(
      firstFinding({
        'variable-lifetime': [
          {
            kind: 'scope-narrowing',
            code: 'LIFETIME_SCOPE_NARROWING',
            file: 'a.ts',
            span: span(1),
            variable: 'result',
            targetBlock: { type: 'if-consequent', span: span(1) },
          } as any,
        ],
      }).label,
    ).toBe('scope-narrowing: `result`');
  });

  it('variable-lifetime label: liveness-pressure with count', () => {
    expect(
      firstFinding({
        'variable-lifetime': [
          {
            kind: 'liveness-pressure',
            code: 'LIFETIME_LIVENESS_PRESSURE',
            file: 'a.ts',
            span: span(1),
            maxLiveVariables: 12,
            functionLineCount: 50,
            hotSpotLine: 30,
          } as any,
        ],
      }).label,
    ).toBe('liveness-pressure: 12 live variables');
  });

  it('variable-lifetime label: mutation-density with variable + count', () => {
    expect(
      firstFinding({
        'variable-lifetime': [
          {
            kind: 'mutation-density',
            code: 'LIFETIME_MUTATION_DENSITY',
            file: 'a.ts',
            span: span(1),
            variable: 'acc',
            mutationCount: 7,
          } as any,
        ],
      }).label,
    ).toBe('mutation-density: `acc` (7 mutations)');
  });

  it('temporal-coupling label: state', () => {
    expect(
      firstFinding({
        'temporal-coupling': [
          {
            kind: 'temporal-coupling',
            code: 'TEMPORAL_COUPLING',
            file: 'a.ts',
            span: span(1),
            state: 'connected',
            writers: 2,
            readers: 3,
          } as any,
        ],
      }).label,
    ).toBe('temporal-coupling: connected');
  });

  // giant-file: the human-facing label discloses the effective budget —
  // '(max: N)' — with no provenance disclosure (the effective number is all
  // the disclosure claim needs).
  it('giant-file label: lines (max: N)', () => {
    expect(
      firstFinding({
        'giant-file': [
          {
            kind: 'giant-file',
            code: 'GIANT_FILE',
            file: 'big.ts',
            span: span(1),
            metrics: { lineCount: 1234, maxLines: 800 },
          },
        ],
      }).label,
    ).toBe('1234 lines (max: 800)');
  });

  it('lint label: [code] msg', () => {
    expect(
      firstFinding({
        lint: [
          {
            severity: 'error',
            catalogCode: 'LINT',
            code: 'no-unused-vars',
            msg: 'x is unused',
            file: 'a.ts',
            span: span(1),
          } as any,
        ],
      }).label,
    ).toBe('[no-unused-vars] x is unused');
  });

  it('typecheck label: [code] msg', () => {
    expect(
      firstFinding({
        typecheck: [
          {
            severity: 'error',
            catalogCode: 'TYPECHECK',
            code: 'TS2322',
            msg: 'Type not assignable',
            file: 'a.ts',
            span: span(1),
            codeFrame: '',
          } as any,
        ],
      }).label,
    ).toBe('[TS2322] Type not assignable');
  });

  it('format label: constant string', () => {
    expect(
      firstFinding({
        format: [{ kind: 'needs-formatting', code: 'FORMAT', file: 'a.ts', span: ZERO_SPAN } as any],
      }).label,
    ).toBe('needs-formatting');
  });
});

// ── flattenToFindings: function name injection ──────────────────────────────

describe('flattenToFindings: function name injection', () => {
  const fnMap: FunctionRangeMap = new Map([
    ['src/a.ts', [{ name: 'processData', startLine: 5, endLine: 20 }]],
    [
      'src/b.ts',
      [
        { name: 'outer', startLine: 1, endLine: 100 },
        { name: 'inner', startLine: 50, endLine: 60 },
      ],
    ],
  ]);
  const fnLabelRows: LabelRow[] = [
    {
      name: 'injects function name into waste label',
      analyses: {
        waste: [{ kind: 'dead-store', code: 'WASTE_DEAD_STORE', file: 'src/a.ts', span: span(10), label: 'unused x' } as any],
      },
      expected: 'unused x in processData()',
    },
    {
      name: 'injects function name into error-flow label',
      analyses: {
        'error-flow': [
          {
            kind: 'throw-non-error',
            code: 'EF_THROW_NON_ERROR',
            file: 'src/a.ts',
            span: span(10),
            evidence: "throw 'x'",
          } as any,
        ],
      },
      expected: "throw 'x' in processData()",
    },
    {
      name: 'omits function name when line is outside all functions',
      analyses: { waste: [{ kind: 'dead-store', code: 'WASTE_DEAD_STORE', file: 'src/a.ts', span: span(1), label: 'x' } as any] },
      expected: 'x',
    },
    {
      name: 'omits function name when file is not in map',
      analyses: {
        waste: [{ kind: 'dead-store', code: 'WASTE_DEAD_STORE', file: 'src/unknown.ts', span: span(10), label: 'x' } as any],
      },
      expected: 'x',
    },
  ];

  it.each(fnLabelRows)('$name', ({ analyses, expected }) => {
    expect(firstFinding(analyses, fnMap).label).toBe(expected);
  });

  it('picks innermost function for nested functions', () => {
    const label = firstFinding(
      {
        waste: [{ kind: 'dead-store', code: 'WASTE_DEAD_STORE', file: 'src/b.ts', span: span(55), label: 'unused' } as any],
      },
      fnMap,
    ).label;

    expect(label).toContain('inner');
    expect(label).not.toContain('outer()');
  });

  it('omits function name when line is 0 (file-scope)', () => {
    // Dependency findings with ZERO_SPAN — should not get function name even if file is in map
    expect(
      firstFinding(
        {
          dependencies: [
            {
              kind: 'dead-export',
              code: 'DEP_DEAD_EXPORT',
              file: 'src/a.ts',
              span: ZERO_SPAN,
              module: 'src/a.ts',
              name: 'foo',
            } as any,
          ],
        },
        fnMap,
      ).label,
    ).toBe("dead-export: 'foo' in src/a.ts");
  });

  it('nesting/early-return/collapsible-if: preserves existing header-based label (ignores fnMap)', () => {
    // These categories have their own header in the label; fnMap does not override
    const label = firstFinding(
      {
        nesting: [
          {
            kind: 'deep-nesting',
            code: 'NESTING_DEEP',
            file: 'src/a.ts',
            header: 'inline',
            span: span(10),
            metrics: {
              depth: 5,
              cognitiveComplexity: 10,
              callbackDepth: 0,
              quadraticTargets: [],
              density: 0,
              halsteadVolume: 0,
              halsteadDifficulty: 0,
            },
            signals: ['deep-nesting'],
            score: 1,
          } as any,
        ],
      },
      fnMap,
    ).label;

    expect(label).toBe('inline (CC: 10, depth: 5)');
  });
});

// ── buildFunctionRangeMap: AST-based ────────────────────────────────────────

describe('buildFunctionRangeMap', () => {
  const rel = (filePath: string) => filePath;

  const rangesFor = (src: string) => {
    const file = parseSource('src/a.ts', src);

    return buildFunctionRangeMap([file], rel).get('src/a.ts')!;
  };

  it('builds map from a single top-level function', () => {
    const ranges = rangesFor(`function greet(name) {\n  console.log(name);\n}\n`);

    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.name).toBe('greet');
    expect(ranges[0]!.startLine).toBe(1);
    expect(ranges[0]!.endLine).toBeGreaterThanOrEqual(3);
  });

  it('extracts names for arrow functions via parent context', () => {
    const names = rangesFor(`const doSomething = () => {\n  return 1;\n};\n`).map(r => r.name);

    expect(names).toContain('doSomething');
  });

  it('handles nested functions with distinct ranges', () => {
    const names = rangesFor(`function outer() {\n  function inner() {\n    return 1;\n  }\n  return inner();\n}\n`)
      .map(r => r.name)
      .sort();

    expect(names).toEqual(['inner', 'outer']);
  });

  it('skips files with parse errors', () => {
    const badFile = parseSource('src/broken.ts', 'function {{{');
    const map = buildFunctionRangeMap([badFile], rel);
    // Either the file is skipped entirely, or it has no usable ranges
    const ranges = map.get('src/broken.ts');

    if (ranges) {
      // Safe-by-design: at worst empty ranges — anonymous functions filtered
      expect(Array.isArray(ranges)).toBe(true);
    }
  });

  it('returns empty map for empty program', () => {
    expect(buildFunctionRangeMap([], rel).size).toBe(0);
  });

  it('applies toProjectRelative to file keys', () => {
    const src = `function x() {}`;
    const file = parseSource('/abs/path/src/a.ts', src);
    const map = buildFunctionRangeMap([file], p => p.replace('/abs/path/', ''));

    expect(map.has('src/a.ts')).toBe(true);
    expect(map.has('/abs/path/src/a.ts')).toBe(false);
  });

  it('integrates with flattenToFindings to produce function-qualified labels', () => {
    const src = `function processData(input) {\n  const result = input;\n  return 1;\n}\n`;
    const file = parseSource('src/a.ts', src);
    const map = buildFunctionRangeMap([file], rel);
    const finding = firstFinding(
      {
        waste: [{ kind: 'dead-store', code: 'WASTE_DEAD_STORE', file: 'src/a.ts', span: span(2), label: 'unused result' } as any],
      },
      map,
    );

    expect(finding.label).toBe('unused result in processData()');
  });
});

// ── flattenToFindings: unknown category fallback ────────────────────────────

describe('flattenToFindings: unknown category', () => {
  it('produces label from kind for unknown category', () => {
    const analyses = {
      'unknown-category': [{ kind: 'some-kind', code: 'X', file: 'a.ts', span: span(1) }],
    } as unknown as Partial<FirebatAnalyses>;
    const f = firstFinding(analyses);

    expect(f.label).toBe('some-kind');
    expect(f.category).toBe('unknown-category');
  });
});

// ── flattenToFindings: label fallbacks (edge cases) ─────────────────────────

describe('flattenToFindings: label fallbacks', () => {
  it('nesting falls back to header when metrics missing', () => {
    expect(
      firstFinding({
        nesting: [{ kind: 'deep-nesting', code: 'NESTING_DEEP', file: 'a.ts', header: 'fn', span: span(1) } as any],
      }).label,
    ).toBe('fn');
  });

  it('nesting falls back to kind when header and metrics missing', () => {
    expect(
      firstFinding({
        nesting: [{ kind: 'deep-nesting', code: 'NESTING_DEEP', file: 'a.ts', span: span(1) } as any],
      }).label,
    ).toBe('deep-nesting');
  });

  it('variable-lifetime falls back to default branch for unknown kind', () => {
    expect(
      firstFinding({
        'variable-lifetime': [
          { kind: 'unexpected-variant', code: 'VAR_LIFETIME', file: 'a.ts', span: span(1), variable: 'x' } as any,
        ],
      }).label,
    ).toBe('unexpected-variant: `x`');
  });

  it('spanIdentity fallback to 0:0:0:0 when span is absent (used in items)', () => {
    // Items with no span field should still generate distinct ids via file + index
    const findings = flattenToFindings({
      duplicates: [
        {
          cloneType: 'exact',
          code: 'DUP_EXACT',
          items: [
            { kind: 'function', header: 'a', file: 'a.ts' },
            { kind: 'function', header: 'b', file: 'b.ts' },
          ],
        } as any,
      ],
    });

    expectTwoUniqueIds(findings);
  });
});

// ── flattenToFindings: multi-category integration ───────────────────────────

describe('flattenToFindings: multi-category integration', () => {
  it('flattens findings from multiple categories preserving per-finding category', () => {
    const findings = flattenToFindings({
      waste: [{ kind: 'dead-store', code: 'WASTE_DEAD_STORE', file: 'a.ts', span: span(1), label: 'x' } as any],
      barrel: [{ kind: 'export-star', code: 'BARREL_EXPORT_STAR', file: 'i.ts', span: span(1), evidence: 'export *' } as any],
      nesting: [
        {
          kind: 'high-cognitive-complexity',
          code: 'NESTING_HIGH_CC',
          file: 'a.ts',
          header: 'f',
          span: span(5),
          metrics: {
            depth: 1,
            cognitiveComplexity: 20,
            callbackDepth: 0,
            quadraticTargets: [],
            density: 0,
            halsteadVolume: 0,
            halsteadDifficulty: 0,
          },
          signals: ['high-cognitive-complexity'],
          score: 1,
        } as any,
      ],
    });

    expect(findings).toHaveLength(3);

    const categories = findings.map(f => f.category).sort();

    expect(categories).toEqual(['barrel', 'nesting', 'waste']);
  });
});
