import { describe, it, expect } from 'bun:test';

import { formatReport } from './report';
import type {
  FirebatReport,
  SourceSpan,
  DuplicateGroup,
  WasteFinding,
  BarrelPolicyFinding,
  UnknownProofFinding,
  LintDiagnostic,
  TypecheckItem,
  ForwardingFinding,
  NestingItem,
  EarlyReturnItem,
  DependencyFinding,
  CouplingHotspot,
  ImplicitStateFinding,
  TemporalCouplingFinding,
  InvariantBlindspotFinding,
  ModificationImpactFinding,
  VariableLifetimeFinding,
  DecisionSurfaceFinding,
  ImplementationOverheadFinding,
  ConceptScatterFinding,
  AbstractionFitnessFinding,
  GiantFileFinding,
  FirebatDetector,
  FormatFinding,
  FirebatCatalogCode,
} from './types';
import type { ExceptionHygieneFinding } from './features/exception-hygiene/types';

// ── Helpers ─────────────────────────────────────────────────────────

const mkFormat = (file: string): FormatFinding => ({
  code: 'FORMAT' as FirebatCatalogCode,
  kind: 'needs-formatting',
  file,
  span: span(),
});

const span = (line = 1, col = 0): SourceSpan => ({
  start: { line, column: col },
  end: { line: line + 1, column: 0 },
});

const cwd = process.cwd();
const testFile = `${cwd}/test-file.ts`;
const testFile2 = `${cwd}/test-file2.ts`;

const emptyDeps: ReadonlyArray<DependencyFinding> = [];

const allDetectors: ReadonlyArray<FirebatDetector> = [
  'waste', 'barrel-policy', 'unknown-proof', 'exception-hygiene',
  'format', 'lint', 'typecheck', 'dependencies', 'coupling',
  'nesting', 'early-return', 'forwarding',
  'implicit-state', 'temporal-coupling', 'invariant-blindspot',
  'modification-impact', 'variable-lifetime', 'decision-surface',
  'implementation-overhead', 'concept-scatter', 'abstraction-fitness', 'giant-file',
  'duplicates',
];

const makeReport = (
  detectors: ReadonlyArray<FirebatDetector>,
  analyses: Partial<FirebatReport['analyses']> = {},
): FirebatReport => ({
  meta: { engine: 'oxc', targetCount: 1, minSize: 0, maxForwardDepth: 0, detectors, detectorTimings: {}, errors: {} },
  analyses,
  catalog: {},
});

// ── Tests ───────────────────────────────────────────────────────────

describe('formatReport', () => {
  // ── JSON branch ─────────────────────────────────────────────────

  describe('json format', () => {
    it('should return valid JSON string when format is json', () => {
      const report = makeReport(['waste'], { waste: [] });
      const out = formatReport(report, 'json');

      expect(() => JSON.parse(out)).not.toThrow();
    });

    it('should output detectors at root level and omit meta key when format is json', () => {
      const report = makeReport(['waste'], {
        waste: [{ kind: 'dead-store', label: 'x', message: '', filePath: testFile, span: span(), confidence: 1 }],
      });
      const parsed = JSON.parse(formatReport(report, 'json'));

      expect(Array.isArray(parsed.detectors)).toBe(true);
      expect(parsed.detectors).toContain('waste');
      expect('meta' in parsed).toBe(false);
      expect(Array.isArray(parsed.analyses.waste)).toBe(true);
    });

    it('should preserve catalog in JSON output', () => {
      const report: FirebatReport = {
        ...makeReport(['waste'], { waste: [] }),
        catalog: { WASTE_DEAD_STORE: { cause: 'unused', think: ['remove'] } },
      };
      const parsed = JSON.parse(formatReport(report, 'json'));

      expect(parsed.catalog.WASTE_DEAD_STORE.cause).toBe('unused');
    });

    it('should include errors at root when meta.errors is non-empty', () => {
      const report: FirebatReport = {
        ...makeReport(['waste'], { waste: [] }),
        meta: { ...makeReport(['waste']).meta, errors: { 'src/a.ts': 'parse error' } },
      };
      const parsed = JSON.parse(formatReport(report, 'json'));

      expect(parsed.errors).toBeDefined();
      expect(parsed.errors['src/a.ts']).toBe('parse error');
    });

    it('should omit errors key when meta.errors is undefined', () => {
      const report: FirebatReport = {
        ...makeReport(['waste'], { waste: [] }),
        meta: (({ errors: _e, ...rest }) => rest)(makeReport(['waste']).meta),
      };
      const parsed = JSON.parse(formatReport(report, 'json'));

      expect('errors' in parsed).toBe(false);
    });

    it('should omit errors key when meta.errors is empty object', () => {
      const report = makeReport(['waste'], { waste: [] });
      const parsed = JSON.parse(formatReport(report, 'json'));

      expect('errors' in parsed).toBe(false);
    });

    it('should include errors at root when meta.errors has exactly one key', () => {
      const report: FirebatReport = {
        ...makeReport(['waste'], { waste: [] }),
        meta: { ...makeReport(['waste']).meta, errors: { 'src/only.ts': 'err' } },
      };
      const parsed = JSON.parse(formatReport(report, 'json'));

      expect(parsed.errors).toBeDefined();
      expect(Object.keys(parsed.errors).length).toBe(1);
    });
  });

  // ── Text summary (empty) ────────────────────────────────────────

  describe('text summary', () => {
    it('should render summary table with all 23 detectors when all detectors selected and no findings', () => {
      const report = makeReport([...allDetectors], { dependencies: [] });
      const out = formatReport(report, 'text');

      expect(out).toContain('Summary');
      expect(out).toContain('Duplicates (unified)');
      expect(out).toContain('Waste');
      expect(out).toContain('Barrel Policy');
      expect(out).toContain('Unknown Proof');
      expect(out).toContain('Exception Hygiene');
      expect(out).toContain('Format');
      expect(out).toContain('Lint');
      expect(out).toContain('Typecheck');
      expect(out).toContain('Dependencies');
      expect(out).toContain('Coupling Hotspots');
      expect(out).toContain('Nesting');
      expect(out).toContain('Early Return');
      expect(out).toContain('Forwarding');
      expect(out).toContain('Implicit State');
      expect(out).toContain('Temporal Coupling');
      expect(out).toContain('Invariant Blindspot');
      expect(out).toContain('Modification Impact');
      expect(out).toContain('Variable Lifetime');
      expect(out).toContain('Decision Surface');
      expect(out).toContain('Implementation Overhead');
      expect(out).toContain('Concept Scatter');
      expect(out).toContain('Abstraction Fitness');
      expect(out).toContain('Giant File');
    });

    it('should show clean badge for detectors with zero findings when no findings exist', () => {
      const out = formatReport(makeReport(['waste'], { waste: [] }), 'text');

      expect(out).toContain('clean');
    });

    it('should only render selected detectors in summary when subset of detectors selected', () => {
      const out = formatReport(makeReport(['waste', 'lint'], { waste: [], lint: [] }), 'text');

      expect(out).toContain('Waste');
      expect(out).toContain('Lint');
      expect(out).not.toContain('Duplicates (unified)');
      expect(out).not.toContain('Nesting');
    });

    it('should include Blockers count in summary when blocking findings exist', () => {
      const findings: WasteFinding[] = [
        { kind: 'dead-store', label: 'x', message: '', filePath: testFile, span: span(), confidence: 1 },
        { kind: 'dead-store', label: 'y', message: '', filePath: testFile2, span: span(), confidence: 1 },
      ];
      const out = formatReport(makeReport(['waste'], { waste: findings }), 'text');

      expect(out).toContain('Blockers');
      expect(out).toContain('2');
    });

    it('should count only errors for lint summary when lint has mixed severities', () => {
      const diags: LintDiagnostic[] = [
        { severity: 'error', code: 'a', msg: 'err', file: testFile, span: span() },
        { severity: 'warning', code: 'b', msg: 'warn', file: testFile, span: span() },
        { severity: 'warning', code: 'c', msg: 'warn2', file: testFile, span: span() },
      ];
      const out = formatReport(makeReport(['lint'], { lint: diags }), 'text');
      // Summary should show count=1 (only error), but body shows all 3
      const bodyMatch = out.match(/3 diagnostics/);

      expect(bodyMatch).not.toBeNull();
    });

    it('should count only errors for typecheck summary when typecheck has mixed severities', () => {
      const items: TypecheckItem[] = [
        { severity: 'error', code: 'TS2322', msg: 'err', file: testFile, span: span(), codeFrame: '' },
        { severity: 'warning', code: 'TS6133', msg: 'warn', file: testFile, span: span(), codeFrame: '' },
      ];
      const out = formatReport(makeReport(['typecheck'], { typecheck: items }), 'text');
      // Body shows total count
      const bodyMatch = out.match(/2 items/);

      expect(bodyMatch).not.toBeNull();
    });

    it('should show total DependencyFinding count in dependencies summary', () => {
      const deps: ReadonlyArray<DependencyFinding> = [
        { kind: 'layer-violation', code: 'DEP_LAYER_VIOLATION', file: 'src/a.ts', span: span(), from: 'a', to: 'b', fromLayer: 'x', toLayer: 'y' },
        { kind: 'circular-dependency', code: 'DIAG_CIRCULAR_DEPENDENCY', items: [{ file: 'src/a.ts', span: span() }, { file: 'src/b.ts', span: span() }] },
        { kind: 'dead-export', code: 'DEP_DEAD_EXPORT', file: 'src/c.ts', span: span(), module: 'c', name: 'd' },
      ];
      const out = formatReport(makeReport(['dependencies'], { dependencies: deps }), 'text');

      // Summary row should show 3 total (3 findings)
      expect(out).toContain('3');
    });

    it('should not start with a newline when findings exist', () => {
      // Arrange
      const finding: WasteFinding = { kind: 'dead-store', label: 'x', message: '', filePath: testFile, span: span() };
      const report = makeReport(['waste'], { waste: [finding] });

      // Act
      const out = formatReport(report, 'text');

      // Assert
      expect(out.startsWith('\n')).toBe(false);
    });

    it('should not start with a newline when no findings exist', () => {
      // Arrange
      const report = makeReport(['waste'], { waste: [] });

      // Act
      const out = formatReport(report, 'text');

      // Assert
      expect(out.startsWith('\n')).toBe(false);
    });
  });

  // ── Duplicates (unified) body ───────────────────────────────────

  describe('duplicates body', () => {
    it('should render body with group items and file when findings exist', () => {
      const group: DuplicateGroup = {
        cloneType: 'type-1',
        findingKind: 'exact-clone',
        items: [
          { kind: 'function', header: 'fnA', filePath: testFile, span: span(10, 5) },
          { kind: 'function', header: 'fnB', filePath: testFile2, span: span(20, 3) },
        ],
      };
      const out = formatReport(makeReport(['duplicates'], { duplicates: [group] }), 'text');

      expect(out).toContain('Duplicates (unified)');
      expect(out).toContain('1 groups');
      expect(out).toContain('2 items');
      expect(out).toContain('function: fnA');
      expect(out).toContain('function: fnB');
      expect(out).toContain('10:5');
      expect(out).toContain('20:3');
    });

    it('should omit kind prefix when item kind is node', () => {
      const group: DuplicateGroup = {
        cloneType: 'type-1',
        findingKind: 'exact-clone',
        items: [{ kind: 'node', header: 'someNode', filePath: testFile, span: span() }],
      };
      const out = formatReport(makeReport(['duplicates'], { duplicates: [group] }), 'text');

      expect(out).not.toContain('node:');
      expect(out).toContain('someNode');
    });

    it('should omit name when item header is anonymous', () => {
      const group: DuplicateGroup = {
        cloneType: 'type-1',
        findingKind: 'exact-clone',
        items: [{ kind: 'function', header: 'anonymous', filePath: testFile, span: span() }],
      };
      const out = formatReport(makeReport(['duplicates'], { duplicates: [group] }), 'text');

      expect(out).not.toContain('anonymous');
    });

    it('should render multiple groups when multiple duplicate groups exist', () => {
      const groups: DuplicateGroup[] = [
        { cloneType: 'type-1', findingKind: 'exact-clone', items: [{ kind: 'function', header: 'a', filePath: testFile, span: span() }] },
        { cloneType: 'type-1', findingKind: 'exact-clone', items: [{ kind: 'function', header: 'b', filePath: testFile2, span: span() }] },
      ];
      const out = formatReport(makeReport(['duplicates'], { duplicates: groups }), 'text');

      expect(out).toContain('2 groups');
    });

    it('should render structural-clone groups with findingKind label', () => {
      const group: DuplicateGroup = {
        cloneType: 'type-2',
        findingKind: 'structural-clone',
        items: [
          { kind: 'function', header: 'funcA', filePath: testFile, span: span(1, 0) },
          { kind: 'function', header: 'funcB', filePath: testFile2, span: span(5, 0) },
        ],
      };
      const out = formatReport(makeReport(['duplicates'], { duplicates: [group] }), 'text');

      expect(out).toContain('Duplicates (unified)');
      expect(out).toContain('1 groups');
      expect(out).toContain('structural-clone');
      expect(out).toContain('function: funcA');
      expect(out).toContain('function: funcB');
    });

    it('should omit kind prefix when item kind is node for structural-clone', () => {
      const group: DuplicateGroup = {
        cloneType: 'type-2',
        findingKind: 'structural-clone',
        items: [{ kind: 'node', header: 'someExpr', filePath: testFile, span: span() }],
      };
      const out = formatReport(makeReport(['duplicates'], { duplicates: [group] }), 'text');

      expect(out).not.toContain('node:');
      expect(out).toContain('someExpr');
    });
  });

  // ── Waste body ──────────────────────────────────────────────────

  describe('waste body', () => {
    it('should render body with kind and label when findings exist', () => {
      const finding: WasteFinding = { kind: 'dead-store', label: 'unusedVar', message: '', filePath: testFile, span: span(5, 2), confidence: 1 };
      const out = formatReport(makeReport(['waste'], { waste: [finding] }), 'text');

      expect(out).toContain('Waste');
      expect(out).toContain('1 findings');
      expect(out).toContain('dead-store');
      expect(out).toContain('unusedVar');
      expect(out).toContain('5:2');
    });

    it('should omit label suffix when waste label is empty', () => {
      const finding: WasteFinding = { kind: 'dead-store', label: '', message: '', filePath: testFile, span: span() };
      const out = formatReport(makeReport(['waste'], { waste: [finding] }), 'text');

      expect(out).toContain('dead-store');
      expect(out).not.toContain('()');
    });
  });

  // ── Barrel Policy body ──────────────────────────────────────────

  describe('barrel-policy body', () => {
    it('should render body with kind and evidence when findings exist', () => {
      const finding: BarrelPolicyFinding = { kind: 'deep-import', file: testFile, span: span(3, 0), evidence: 'suggest: ./utils' };
      const out = formatReport(makeReport(['barrel-policy'], { 'barrel-policy': [finding] }), 'text');

      expect(out).toContain('Barrel Policy');
      expect(out).toContain('1 findings');
      expect(out).toContain('deep-import');
      expect(out).toContain('suggest: ./utils');
      expect(out).toContain('3:0');
    });

    it('should omit evidence when barrel-policy evidence is undefined', () => {
      const finding: BarrelPolicyFinding = { kind: 'export-star', file: testFile, span: span() };
      const out = formatReport(makeReport(['barrel-policy'], { 'barrel-policy': [finding] }), 'text');

      expect(out).toContain('export-star');
    });

    it('should omit evidence when barrel-policy evidence is empty string', () => {
      const finding: BarrelPolicyFinding = { kind: 'export-star', file: testFile, span: span(), evidence: '' };
      const out = formatReport(makeReport(['barrel-policy'], { 'barrel-policy': [finding] }), 'text');

      expect(out).toContain('export-star');
    });
  });

  // ── Unknown Proof body ──────────────────────────────────────────

  describe('unknown-proof body', () => {
    it('should render body with kind and symbol when findings exist', () => {
      const finding: UnknownProofFinding = { kind: 'type-assertion', message: '', filePath: testFile, span: span(7, 1), symbol: 'myVar' };
      const out = formatReport(makeReport(['unknown-proof'], { 'unknown-proof': [finding] }), 'text');

      expect(out).toContain('Unknown Proof');
      expect(out).toContain('type-assertion');
      expect(out).toContain('myVar');
      expect(out).toContain('7:1');
    });

    it('should omit symbol when unknown-proof symbol is undefined', () => {
      const finding: UnknownProofFinding = { kind: 'any-inferred', message: '', filePath: testFile, span: span() };
      const out = formatReport(makeReport(['unknown-proof'], { 'unknown-proof': [finding] }), 'text');

      expect(out).toContain('any-inferred');
    });

    it('should omit symbol when unknown-proof symbol is empty string', () => {
      const finding: UnknownProofFinding = { kind: 'any-inferred', message: '', filePath: testFile, span: span(), symbol: '' };
      const out = formatReport(makeReport(['unknown-proof'], { 'unknown-proof': [finding] }), 'text');

      expect(out).toContain('any-inferred');
    });
  });

  // ── Exception Hygiene body ──────────────────────────────────────

  describe('exception-hygiene body', () => {
    it('should render body with kind and evidence when findings exist', () => {
      const finding: ExceptionHygieneFinding = { kind: 'throw-non-error', file: testFile, span: span(12, 4), evidence: 'string literal' };
      const out = formatReport(makeReport(['exception-hygiene'], { 'exception-hygiene': [finding] }), 'text');

      expect(out).toContain('Exception Hygiene');
      expect(out).toContain('1 findings');
      expect(out).toContain('throw-non-error');
      expect(out).toContain('string literal');
    });

    it('should omit evidence when exception-hygiene evidence is empty', () => {
      const finding: ExceptionHygieneFinding = { kind: 'empty-catch' as any, file: testFile, span: span(), evidence: '' };
      const out = formatReport(makeReport(['exception-hygiene'], { 'exception-hygiene': [finding] }), 'text');

      expect(out).toContain('empty-catch');
    });
  });

  // ── Format body ─────────────────────────────────────────────────

  describe('format body', () => {
    it('should render singular form when single file needs formatting', () => {
      const out = formatReport(makeReport(['format'], { format: [mkFormat(testFile)] }), 'text');

      expect(out).toContain('Format');
      expect(out).toContain('1 file need formatting');
    });

    it('should render plural form when multiple files need formatting', () => {
      const out = formatReport(makeReport(['format'], { format: [mkFormat(testFile), mkFormat(testFile2)] }), 'text');

      expect(out).toContain('2 files need formatting');
    });

    it('should not render body when format array is empty', () => {
      const out = formatReport(makeReport(['format'], { format: [] }), 'text');

      expect(out).not.toContain('need formatting');
    });

    it('should list individual file names in format section when findings exist', () => {
      const findings: FormatFinding[] = [
        { code: 'FMT_NEEDS_FORMATTING' as any, kind: 'needs-formatting', file: testFile, span: span() },
        { code: 'FMT_NEEDS_FORMATTING' as any, kind: 'needs-formatting', file: testFile2, span: span() },
      ];
      const out = formatReport(makeReport(['format'], { format: findings }), 'text');

      expect(out).toContain('test-file.ts');
      expect(out).toContain('test-file2.ts');
    });

    it('should omit file list when format findings are empty', () => {
      const out = formatReport(makeReport(['format'], { format: [] }), 'text');

      expect(out).not.toContain('test-file.ts');
    });
  });

  // ── Lint body ───────────────────────────────────────────────────

  describe('lint body', () => {
    it('should render body with error severity, code, and msg when error diagnostic exists', () => {
      const diag: LintDiagnostic = { severity: 'error', code: 'no-unused-vars', msg: 'x is unused', file: testFile, span: span(4, 6) };
      const out = formatReport(makeReport(['lint'], { lint: [diag] }), 'text');

      expect(out).toContain('Lint');
      expect(out).toContain('1 diagnostics');
      expect(out).toContain('error');
      expect(out).toContain('no-unused-vars');
      expect(out).toContain('x is unused');
      expect(out).toContain('4:6');
    });

    it('should render warn severity for lint warnings', () => {
      const diag: LintDiagnostic = { severity: 'warning', code: 'prefer-const', msg: 'use const', file: testFile, span: span() };
      const out = formatReport(makeReport(['lint'], { lint: [diag] }), 'text');

      expect(out).toContain('warn');
    });

    it('should handle lint diagnostic when file is undefined', () => {
      const diag: LintDiagnostic = { severity: 'error', code: 'parse-err', msg: 'bad syntax', span: span() };
      const out = formatReport(makeReport(['lint'], { lint: [diag] }), 'text');

      expect(out).toContain('parse-err');
      expect(out).toContain('bad syntax');
    });

    it('should handle lint diagnostic when code is undefined', () => {
      const diag: LintDiagnostic = { severity: 'error', msg: 'some error', file: testFile, span: span() };
      const out = formatReport(makeReport(['lint'], { lint: [diag] }), 'text');

      expect(out).toContain('some error');
    });
  });

  // ── Typecheck body ──────────────────────────────────────────────

  describe('typecheck body', () => {
    it('should render body with error severity, code, msg, and codeFrame when error exists', () => {
      const item: TypecheckItem = { severity: 'error', code: 'TS2322', msg: 'Type mismatch', file: testFile, span: span(15, 8), codeFrame: 'let x: number = "oops";' };
      const out = formatReport(makeReport(['typecheck'], { typecheck: [item] }), 'text');

      expect(out).toContain('Typecheck');
      expect(out).toContain('error');
      expect(out).toContain('TS2322');
      expect(out).toContain('Type mismatch');
      expect(out).toContain('15:8');
      expect(out).toContain('let x: number = "oops"');
    });

    it('should render warn for typecheck warnings', () => {
      const item: TypecheckItem = { severity: 'warning', code: 'TS6133', msg: 'unused var', file: testFile, span: span(), codeFrame: '' };
      const out = formatReport(makeReport(['typecheck'], { typecheck: [item] }), 'text');

      expect(out).toContain('warn');
    });

    it('should omit codeFrame lines when typecheck codeFrame is empty', () => {
      const item: TypecheckItem = { severity: 'error', code: 'TS2322', msg: 'err', file: testFile, span: span(), codeFrame: '' };
      const out = formatReport(makeReport(['typecheck'], { typecheck: [item] }), 'text');
      const lines = out.split('\n');
      const tsLineIdx = lines.findIndex(l => l.includes('TS2322'));

      expect(tsLineIdx).toBeGreaterThan(-1);
      // Next non-empty line should not be an indented codeFrame
      const nextLine = lines[tsLineIdx + 1] ?? '';

      expect(nextLine.startsWith('        ')).toBe(false);
    });

    it('should render unknown for typecheck item with empty file', () => {
      const item: TypecheckItem = { severity: 'error', code: 'TS0', msg: 'x', file: '', span: span(), codeFrame: '' };
      const out = formatReport(makeReport(['typecheck'], { typecheck: [item] }), 'text');

      expect(out).toContain('<unknown>');
    });

    it('should render multi-line codeFrame when codeFrame has newlines', () => {
      const item: TypecheckItem = { severity: 'error', code: 'TS2322', msg: 'err', file: testFile, span: span(), codeFrame: 'line1\nline2' };
      const out = formatReport(makeReport(['typecheck'], { typecheck: [item] }), 'text');

      expect(out).toContain('line1');
      expect(out).toContain('line2');
    });
  });

  // ── Forwarding body ─────────────────────────────────────────────

  describe('forwarding body', () => {
    it('should render body with kind and header when findings exist', () => {
      const finding: ForwardingFinding = { kind: 'thin-wrapper', filePath: testFile, span: span(30, 0), header: 'wrapFn', depth: 2, evidence: 'direct forward' };
      const out = formatReport(makeReport(['forwarding'], { forwarding: [finding] }), 'text');

      expect(out).toContain('Forwarding');
      expect(out).toContain('1 findings');
      expect(out).toContain('thin-wrapper');
      expect(out).toContain('wrapFn');
      expect(out).toContain('30:0');
    });

    it('should omit name when forwarding header is anonymous', () => {
      const finding: ForwardingFinding = { kind: 'thin-wrapper', filePath: testFile, span: span(), header: 'anonymous', depth: 1, evidence: '' };
      const out = formatReport(makeReport(['forwarding'], { forwarding: [finding] }), 'text');

      expect(out).not.toContain('anonymous');
    });
  });

  // ── Nesting body ────────────────────────────────────────────────

  describe('nesting body', () => {
    it('should render body with header and kind when findings exist', () => {
      const item: NestingItem = { kind: 'deep-nesting', file: testFile, header: 'processData', span: span(8, 2), metrics: { depth: 5, cognitiveComplexity: 12, callbackDepth: 0, quadraticTargets: [] }, score: 5 };
      const out = formatReport(makeReport(['nesting'], { nesting: [item] }), 'text');

      expect(out).toContain('Nesting');
      expect(out).toContain('processData');
      expect(out).toContain('deep-nesting');
      expect(out).toContain('8:2');
    });

    it('should omit name when nesting header is anonymous', () => {
      const item: NestingItem = { kind: 'deep-nesting', file: testFile, header: 'anonymous', span: span(), metrics: { depth: 5, cognitiveComplexity: 12, callbackDepth: 0, quadraticTargets: [] }, score: 5 };
      const out = formatReport(makeReport(['nesting'], { nesting: [item] }), 'text');

      expect(out).not.toContain('anonymous');
    });

    it('should omit kind suffix when nesting kind is empty', () => {
      const item = { kind: '', file: testFile, header: 'fn', span: span(), metrics: { depth: 5, cognitiveComplexity: 12, callbackDepth: 0, quadraticTargets: [] }, score: 5 } as unknown as NestingItem;
      const out = formatReport(makeReport(['nesting'], { nesting: [item] }), 'text');

      expect(out).toContain('fn');
    });
  });

  // ── Early Return body ───────────────────────────────────────────

  describe('early-return body', () => {
    it('should render body with header and kind when findings exist', () => {
      const item: EarlyReturnItem = { kind: 'invertible-if-else', file: testFile, header: 'handleReq', span: span(22, 0), metrics: { returns: 3, hasGuards: false, guards: 0 }, score: 3 };
      const out = formatReport(makeReport(['early-return'], { 'early-return': [item] }), 'text');

      expect(out).toContain('Early Return');
      expect(out).toContain('handleReq');
      expect(out).toContain('invertible-if-else');
    });

    it('should omit name when early-return header is anonymous', () => {
      const item: EarlyReturnItem = { kind: 'missing-guard', file: testFile, header: 'anonymous', span: span(), metrics: { returns: 1, hasGuards: false, guards: 0 }, score: 1 };
      const out = formatReport(makeReport(['early-return'], { 'early-return': [item] }), 'text');

      expect(out).not.toContain('anonymous');
    });

    it('should omit kind suffix when early-return kind is empty', () => {
      const item = { kind: '', file: testFile, header: 'fn', span: span(), metrics: { returns: 1, hasGuards: false, guards: 0 }, score: 1 } as unknown as EarlyReturnItem;
      const out = formatReport(makeReport(['early-return'], { 'early-return': [item] }), 'text');

      expect(out).toContain('fn');
    });
  });

  // ── Dependencies body ───────────────────────────────────────────

  describe('dependencies body', () => {
    it('should render dead exports sub-section when dead-export findings exist', () => {
      const deps: ReadonlyArray<DependencyFinding> = [
        { kind: 'dead-export', code: 'DEP_DEAD_EXPORT', file: 'src/utils.ts', span: span(), module: 'src/utils.ts', name: 'helperFn' },
      ];
      const out = formatReport(makeReport(['dependencies'], { dependencies: deps }), 'text');

      expect(out).toContain('Dependencies');
      expect(out).toContain('dead exports');
      expect(out).toContain('dead-export');
      expect(out).toContain('src/utils.ts#helperFn');
    });

    it('should render layer violations sub-section when layer-violation findings exist', () => {
      const deps: ReadonlyArray<DependencyFinding> = [
        { kind: 'layer-violation', code: 'DEP_LAYER_VIOLATION', file: 'src/a.ts', span: span(), from: 'src/a.ts', to: 'src/b.ts', fromLayer: 'adapters', toLayer: 'engine' },
      ];
      const out = formatReport(makeReport(['dependencies'], { dependencies: deps }), 'text');

      expect(out).toContain('layer violations');
      expect(out).toContain('adapters');
      expect(out).toContain('engine');
    });

    it('should render cycles sub-section when cycle findings exist', () => {
      const deps: ReadonlyArray<DependencyFinding> = [
        { kind: 'circular-dependency', code: 'DIAG_CIRCULAR_DEPENDENCY', items: [{ file: 'src/a.ts', span: span() }, { file: 'src/b.ts', span: span() }, { file: 'src/a.ts', span: span() }] },
      ];
      const out = formatReport(makeReport(['dependencies'], { dependencies: deps }), 'text');

      expect(out).toContain('cycles');
      expect(out).toContain('src/a.ts');
      expect(out).toContain('src/b.ts');
    });

    it('should render cut hint inside cycle when cycle has cut property', () => {
      const deps: ReadonlyArray<DependencyFinding> = [
        { kind: 'circular-dependency', code: 'DIAG_CIRCULAR_DEPENDENCY', items: [{ file: 'src/x.ts', span: span() }, { file: 'src/y.ts', span: span() }], cut: { from: 'src/x.ts', to: 'src/y.ts' } },
      ];
      const out = formatReport(makeReport(['dependencies'], { dependencies: deps }), 'text');

      expect(out).toContain('cut:');
      expect(out).toContain('src/x.ts');
      expect(out).toContain('src/y.ts');
    });

    it('should not render dependencies body when findings array is empty', () => {
      const out = formatReport(makeReport(['dependencies'], { dependencies: emptyDeps }), 'text');
      const lines = out.split('\n');
      const hasDepsBody = lines.some(l =>
        l.includes('dead exports:') || l.includes('cycles:') || l.includes('layer violations:'),
      );

      expect(hasDepsBody).toBe(false);
    });

    it('should render all three sub-sections when all three finding kinds are present', () => {
      const deps: ReadonlyArray<DependencyFinding> = [
        { kind: 'circular-dependency', code: 'DIAG_CIRCULAR_DEPENDENCY', items: [{ file: 'src/a.ts', span: span() }, { file: 'src/b.ts', span: span() }], cut: { from: 'a', to: 'b' } },
        { kind: 'layer-violation', code: 'DEP_LAYER_VIOLATION', file: 'src/b.ts', span: span(), from: 'a', to: 'b', fromLayer: 'x', toLayer: 'y' },
        { kind: 'dead-export', code: 'DEP_DEAD_EXPORT', file: 'src/c.ts', span: span(), module: 'c', name: 'd' },
      ];
      const out = formatReport(makeReport(['dependencies'], { dependencies: deps }), 'text');

      expect(out).toContain('dead exports:');
      expect(out).toContain('layer violations:');
      expect(out).toContain('cycles:');
      expect(out).toContain('cut:');
    });
  });

  // ── Coupling body ───────────────────────────────────────────────

  describe('coupling body', () => {
    it('should render body with module, score, and signals when findings exist', () => {
      const hotspot: CouplingHotspot = { module: 'src/core.ts', score: 42, signals: ['high-fan-out', 'high-instability'], metrics: { fanIn: 1, fanOut: 20, instability: 0.95, abstractness: 0, distance: 0.95 }, why: '', suggestedRefactor: '' };
      const out = formatReport(makeReport(['coupling'], { coupling: [hotspot] }), 'text');

      expect(out).toContain('Coupling Hotspots');
      expect(out).toContain('1 modules');
      expect(out).toContain('src/core.ts');
      expect(out).toContain('score=42');
      expect(out).toContain('high-fan-out, high-instability');
    });
  });

  // ── Implicit State body ─────────────────────────────────────────

  describe('implicit-state body', () => {
    it('should render body with protocol when findings exist', () => {
      const finding: ImplicitStateFinding = { kind: 'implicit-state', file: testFile, span: span(2, 0), protocol: 'process.env' };
      const out = formatReport(makeReport(['implicit-state'], { 'implicit-state': [finding] }), 'text');

      expect(out).toContain('Implicit State');
      expect(out).toContain('1 findings');
      expect(out).toContain('process.env');
      expect(out).toContain('2:0');
    });

    it('should render key when key is present', () => {
      const finding = { kind: 'implicit-state', file: testFile, span: span(), protocol: 'process.env', key: 'DATABASE_URL' } as ImplicitStateFinding & { key: string };
      const out = formatReport(makeReport(['implicit-state'], { 'implicit-state': [finding] }), 'text');

      expect(out).toContain('key=DATABASE_URL');
    });

    it('should omit key when key is absent', () => {
      const finding: ImplicitStateFinding = { kind: 'implicit-state', file: testFile, span: span(), protocol: 'process.env' };
      const out = formatReport(makeReport(['implicit-state'], { 'implicit-state': [finding] }), 'text');

      expect(out).not.toContain('key=');
    });
  });

  // ── Temporal Coupling body ──────────────────────────────────────

  describe('temporal-coupling body', () => {
    it('should render body with state, writers, and readers when findings exist', () => {
      const finding: TemporalCouplingFinding = { kind: 'temporal-coupling', file: testFile, span: span(5, 0), state: 'dbConn', writers: 3, readers: 7 };
      const out = formatReport(makeReport(['temporal-coupling'], { 'temporal-coupling': [finding] }), 'text');

      expect(out).toContain('Temporal Coupling');
      expect(out).toContain('1 findings');
      expect(out).toContain('dbConn');
      expect(out).toContain('writers=3');
      expect(out).toContain('readers=7');
    });
  });

  // ── Invariant Blindspot body ────────────────────────────────────

  describe('invariant-blindspot body', () => {
    it('should render body with signal when findings exist', () => {
      const finding: InvariantBlindspotFinding = { kind: 'invariant-blindspot', file: testFile, span: span(14, 3), signal: 'unchecked-array-length' };
      const out = formatReport(makeReport(['invariant-blindspot'], { 'invariant-blindspot': [finding] }), 'text');

      expect(out).toContain('Invariant Blindspot');
      expect(out).toContain('1 findings');
      expect(out).toContain('unchecked-array-length');
      expect(out).toContain('14:3');
    });
  });

  // ── Modification Impact body ────────────────────────────────────

  describe('modification-impact body', () => {
    it('should render body with radius and callers when highRiskCallers populated', () => {
      const finding: ModificationImpactFinding = { kind: 'modification-impact', file: testFile, span: span(25, 0), impactRadius: 7, highRiskCallers: ['callerA', 'callerB'] };
      const out = formatReport(makeReport(['modification-impact'], { 'modification-impact': [finding] }), 'text');

      expect(out).toContain('Modification Impact');
      expect(out).toContain('1 findings');
      expect(out).toContain('radius=7');
      expect(out).toContain('callers=callerA,callerB');
    });

    it('should omit callers when highRiskCallers is empty', () => {
      const finding: ModificationImpactFinding = { kind: 'modification-impact', file: testFile, span: span(), impactRadius: 3, highRiskCallers: [] };
      const out = formatReport(makeReport(['modification-impact'], { 'modification-impact': [finding] }), 'text');

      expect(out).toContain('radius=3');
      expect(out).not.toContain('callers=');
    });
  });

  // ── Variable Lifetime body ──────────────────────────────────────

  describe('variable-lifetime body', () => {
    it('should render body with variable, lifetimeLines, and contextBurden when findings exist', () => {
      const finding: VariableLifetimeFinding = { kind: 'variable-lifetime', file: testFile, span: span(10, 6), variable: 'config', lifetimeLines: 80, contextBurden: 5 };
      const out = formatReport(makeReport(['variable-lifetime'], { 'variable-lifetime': [finding] }), 'text');

      expect(out).toContain('Variable Lifetime');
      expect(out).toContain('1 findings');
      expect(out).toContain('config');
      expect(out).toContain('lifetime=80L');
      expect(out).toContain('burden=5');
    });
  });

  // ── Decision Surface body ───────────────────────────────────────

  describe('decision-surface body', () => {
    it('should render body with axes, paths, and repeats when findings exist', () => {
      const finding: DecisionSurfaceFinding = { kind: 'decision-surface', file: testFile, span: span(33, 0), axes: 4, combinatorialPaths: 16, repeatedChecks: 2 };
      const out = formatReport(makeReport(['decision-surface'], { 'decision-surface': [finding] }), 'text');

      expect(out).toContain('Decision Surface');
      expect(out).toContain('1 findings');
      expect(out).toContain('axes=4');
      expect(out).toContain('paths=16');
      expect(out).toContain('repeats=2');
    });
  });

  // ── Implementation Overhead body ────────────────────────────────

  describe('implementation-overhead body', () => {
    it('should render body with ratio, impl, and iface when findings exist', () => {
      const finding: ImplementationOverheadFinding = { kind: 'implementation-overhead', file: testFile, span: span(40, 0), interfaceComplexity: 3, implementationComplexity: 21, ratio: 7 };
      const out = formatReport(makeReport(['implementation-overhead'], { 'implementation-overhead': [finding] }), 'text');

      expect(out).toContain('Implementation Overhead');
      expect(out).toContain('1 findings');
      expect(out).toContain('ratio=7.0');
      expect(out).toContain('impl=21');
      expect(out).toContain('iface=3');
    });
  });

  // ── Concept Scatter body ────────────────────────────────────────

  describe('concept-scatter body', () => {
    it('should render body with concept, scatter, files, and layers when findings exist', () => {
      const finding: ConceptScatterFinding = { kind: 'concept-scatter', file: testFile, span: span(50, 0), concept: 'logging', scatterIndex: 0.8, files: ['a.ts', 'b.ts', 'c.ts'], layers: ['adapters', 'engine'] };
      const out = formatReport(makeReport(['concept-scatter'], { 'concept-scatter': [finding] }), 'text');

      expect(out).toContain('Concept Scatter');
      expect(out).toContain('1 findings');
      expect(out).toContain('logging');
      expect(out).toContain('scatter=0.8');
      expect(out).toContain('files=3');
      expect(out).toContain('layers=2');
    });
  });

  // ── Abstraction Fitness body ────────────────────────────────────

  describe('abstraction-fitness body', () => {
    it('should render body with module, fitness, cohesion, and coupling when findings exist', () => {
      const finding: AbstractionFitnessFinding = { kind: 'abstraction-fitness', file: testFile, span: span(60, 0), module: 'src/engine/parser.ts', internalCohesion: 0.35, externalCoupling: 0.85, fitness: 0.2 };
      const out = formatReport(makeReport(['abstraction-fitness'], { 'abstraction-fitness': [finding] }), 'text');

      expect(out).toContain('Abstraction Fitness');
      expect(out).toContain('1 findings');
      expect(out).toContain('src/engine/parser.ts');
      expect(out).toContain('fitness=0.20');
      expect(out).toContain('cohesion=0.35');
      expect(out).toContain('coupling=0.85');
    });
  });

  // ── Giant File body ─────────────────────────────────────────────

  describe('giant-file body', () => {
    it('should render body with file and metrics when findings exist', () => {
      const finding: GiantFileFinding = { kind: 'giant-file', file: testFile, span: span(), code: 'GIANT_FILE', metrics: { lineCount: 2500, maxLines: 1000 } };
      const out = formatReport(makeReport(['giant-file'], { 'giant-file': [finding] }), 'text');

      expect(out).toContain('Giant File');
      expect(out).toContain('1 findings');
      expect(out).toContain('2500/1000 lines');
    });

    it('should render file path without metrics info when metrics is absent', () => {
      const finding = { kind: 'giant-file', file: testFile, span: span(), code: 'GIANT_FILE' } as unknown as GiantFileFinding;
      const out = formatReport(makeReport(['giant-file'], { 'giant-file': [finding] }), 'text');

      expect(out).toContain('Giant File');
      expect(out).not.toContain('lines');
    });
  });

  // ── Cross-cutting concerns ──────────────────────────────────────

  describe('cross-cutting', () => {
    it('should not render body section when detector is not in selected detectors', () => {
      const finding: InvariantBlindspotFinding = { kind: 'invariant-blindspot', file: testFile, span: span(), signal: 'test' };
      // detectors list does NOT include invariant-blindspot
      const out = formatReport(makeReport(['waste'], { 'invariant-blindspot': [finding] }), 'text');

      expect(out).not.toContain('Invariant Blindspot');
    });

    it('should not render body section when detector selected but array is empty', () => {
      const out = formatReport(makeReport(['waste'], { waste: [] }), 'text');
      const lines = out.split('\n');
      const wasteBody = lines.some(l => l.includes('findings'));

      expect(wasteBody).toBe(false);
    });

    it('should render multiple findings for a single detector when array has multiple items', () => {
      const findings: InvariantBlindspotFinding[] = [
        { kind: 'invariant-blindspot', file: testFile, span: span(1, 0), signal: 'signal-a' },
        { kind: 'invariant-blindspot', file: testFile2, span: span(2, 0), signal: 'signal-b' },
      ];
      const out = formatReport(makeReport(['invariant-blindspot'], { 'invariant-blindspot': findings }), 'text');

      expect(out).toContain('2 findings');
      expect(out).toContain('signal-a');
      expect(out).toContain('signal-b');
    });

    it('should render summary section when detectors are selected', () => {
      const finding: WasteFinding = { kind: 'dead-store', label: 'x', message: '', filePath: testFile, span: span() };
      const out = formatReport(makeReport(['waste'], { waste: [finding] }), 'text');

      expect(out).toContain('Summary');
    });

    it('should use default summary row for Phase 1 detectors not in summaryRowFor switch', () => {
      const finding: ImplicitStateFinding = { kind: 'implicit-state', file: testFile, span: span(), protocol: 'process.env' };
      const out = formatReport(makeReport(['implicit-state'], { 'implicit-state': [finding] }), 'text');

      // Should still render "Implicit State" in summary via humanizeDetectorKey default
      expect(out).toContain('Implicit State');
    });

    it('should handle analyses with missing detector data gracefully when detector selected', () => {
      // Selected but no data in analyses → should show clean in summary, no body
      const out = formatReport(makeReport(['waste', 'nesting'], {}), 'text');

      expect(out).toContain('Waste');
      expect(out).toContain('Nesting');
      expect(out).toContain('clean');
    });
  });
});
