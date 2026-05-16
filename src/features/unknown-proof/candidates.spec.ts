import { describe, expect, it } from 'bun:test';

import type { ParsedFile } from '../../engine/types';

import { parseSource } from '../../engine/ast/parse-source';
import { collectBindingCandidates, collectExpressionCandidates } from './candidates';

const toFile = (filePath: string, code: string): ParsedFile => parseSource(filePath, code) as ParsedFile;

describe('features/unknown-proof/candidates — collectBindingCandidates', () => {
  it('collectBindingCandidates - empty program - returns empty map', () => {
    const result = collectBindingCandidates({ program: [] });

    expect(result.size).toBe(0);
  });

  it('collectBindingCandidates - variable with CallExpression init - records initCalleeEndOffset at end of callee', () => {
    const source = `const x = fetch("url");`;
    const f = toFile('/call.ts', source);
    const result = collectBindingCandidates({ program: [f] });
    const candidates = result.get('/call.ts') ?? [];
    const xCandidate = candidates.find(c => c.name === 'x');

    expect(xCandidate).toBeDefined();
    expect(xCandidate!.isCatchParam).toBe(false);
    // `fetch` ends right before the `(` opening the argument list — that exact offset
    // is what unknown-proof anchors its semantic checks to.
    expect(xCandidate!.initCalleeEndOffset).toBe(source.indexOf('('));
  });

  it('collectBindingCandidates - variable with await CallExpression init - records initCalleeEndOffset at end of callee', () => {
    const source = `async function run() { const x = await fetch("url"); }`;
    const f = toFile('/await-call.ts', source);
    const result = collectBindingCandidates({ program: [f] });
    const candidates = result.get('/await-call.ts') ?? [];
    const xCandidate = candidates.find(c => c.name === 'x');

    expect(xCandidate).toBeDefined();
    // `fetch` ends right before `(` of the fetch call (not `run(` earlier in the source).
    const fetchCallParen = source.indexOf('fetch(') + 'fetch'.length;

    expect(xCandidate!.initCalleeEndOffset).toBe(fetchCallParen);
  });

  it('collectBindingCandidates - catch param - records isCatchParam true and catchBodyRange', () => {
    const f = toFile('/catch.ts', `try {} catch (e) { console.log(e); }`);
    const result = collectBindingCandidates({ program: [f] });
    const candidates = result.get('/catch.ts') ?? [];
    const eCandidate = candidates.find(c => c.name === 'e');

    expect(eCandidate).toBeDefined();
    expect(eCandidate!.isCatchParam).toBe(true);
    expect(eCandidate!.initCalleeEndOffset).toBeUndefined();
    expect(eCandidate!.catchBodyRange).toBeDefined();
    expect(typeof eCandidate!.catchBodyRange!.start).toBe('number');
    expect(typeof eCandidate!.catchBodyRange!.end).toBe('number');
  });

  it('collectBindingCandidates - variable with explicit annotation - records hasExplicitAnnotation', () => {
    const f = toFile('/annotated.ts', `const x: unknown = getValue();`);
    const result = collectBindingCandidates({ program: [f] });
    const candidates = result.get('/annotated.ts') ?? [];
    const xCandidate = candidates.find(c => c.name === 'x');

    expect(xCandidate).toBeDefined();
    expect(xCandidate!.hasExplicitAnnotation).toBe(true);
  });

  it('collectBindingCandidates - variable without annotation - hasExplicitAnnotation is undefined', () => {
    const f = toFile('/no-annotation.ts', `const x = getValue();`);
    const result = collectBindingCandidates({ program: [f] });
    const candidates = result.get('/no-annotation.ts') ?? [];
    const xCandidate = candidates.find(c => c.name === 'x');

    expect(xCandidate).toBeDefined();
    expect(xCandidate!.hasExplicitAnnotation).toBeUndefined();
  });

  it('collectBindingCandidates - function param with annotation - records hasExplicitAnnotation', () => {
    const f = toFile('/annotated-param.ts', `function foo(bar: any) {}`);
    const result = collectBindingCandidates({ program: [f] });
    const candidates = result.get('/annotated-param.ts') ?? [];
    const barCandidate = candidates.find(c => c.name === 'bar');

    expect(barCandidate).toBeDefined();
    expect(barCandidate!.hasExplicitAnnotation).toBe(true);
  });

  it('collectBindingCandidates - function param without annotation - hasExplicitAnnotation is undefined', () => {
    const f = toFile('/unannotated-param.ts', `function foo(bar) {}`);
    const result = collectBindingCandidates({ program: [f] });
    const candidates = result.get('/unannotated-param.ts') ?? [];
    const barCandidate = candidates.find(c => c.name === 'bar');

    expect(barCandidate).toBeDefined();
    expect(barCandidate!.hasExplicitAnnotation).toBeUndefined();
  });

  it('collectBindingCandidates - destructured param without annotation - hasExplicitAnnotation is undefined', () => {
    // Regression catch: previously `param.type !== 'Identifier'` was wrongly
    // aliased to "annotated", which flagged every ObjectPattern/ArrayPattern
    // param as annotated regardless of actual typeAnnotation.
    const f = toFile('/destruct-param.ts', `function foo({ x, y }) {}`);
    const result = collectBindingCandidates({ program: [f] });
    const candidates = result.get('/destruct-param.ts') ?? [];
    const xCandidate = candidates.find(c => c.name === 'x');
    const yCandidate = candidates.find(c => c.name === 'y');

    expect(xCandidate).toBeDefined();
    expect(yCandidate).toBeDefined();
    expect(xCandidate!.hasExplicitAnnotation).toBeUndefined();
    expect(yCandidate!.hasExplicitAnnotation).toBeUndefined();
  });

  it('collectBindingCandidates - array-pattern param without annotation - hasExplicitAnnotation is undefined', () => {
    const f = toFile('/array-param.ts', `function foo([a, b]) {}`);
    const result = collectBindingCandidates({ program: [f] });
    const candidates = result.get('/array-param.ts') ?? [];
    const aCandidate = candidates.find(c => c.name === 'a');

    expect(aCandidate).toBeDefined();
    expect(aCandidate!.hasExplicitAnnotation).toBeUndefined();
  });

  it('collectBindingCandidates - destructured declarator without annotation - hasExplicitAnnotation is undefined', () => {
    // Regression catch for VariableDeclarator handler — same `type !== 'Identifier'`
    // mistake was present at handleVariableDeclarator.
    const f = toFile('/destruct-decl.ts', `const { a, b } = obj;`);
    const result = collectBindingCandidates({ program: [f] });
    const candidates = result.get('/destruct-decl.ts') ?? [];
    const aCandidate = candidates.find(c => c.name === 'a');

    expect(aCandidate).toBeDefined();
    expect(aCandidate!.hasExplicitAnnotation).toBeUndefined();
  });

  it('collectBindingCandidates - destructured param WITH annotation - hasExplicitAnnotation is true', () => {
    const f = toFile('/annotated-destruct-param.ts', `function foo({ x }: { x: string }) {}`);
    const result = collectBindingCandidates({ program: [f] });
    const candidates = result.get('/annotated-destruct-param.ts') ?? [];
    const xCandidate = candidates.find(c => c.name === 'x');

    expect(xCandidate).toBeDefined();
    expect(xCandidate!.hasExplicitAnnotation).toBe(true);
  });

  it('collectBindingCandidates - function param - records no initCalleeEndOffset', () => {
    const f = toFile('/param.ts', `function foo(bar: string) {}`);
    const result = collectBindingCandidates({ program: [f] });
    const candidates = result.get('/param.ts') ?? [];
    const barCandidate = candidates.find(c => c.name === 'bar');

    expect(barCandidate).toBeDefined();
    expect(barCandidate!.isCatchParam).toBe(false);
    expect(barCandidate!.initCalleeEndOffset).toBeUndefined();
  });

  it('collectBindingCandidates - literal init - records no initCalleeEndOffset', () => {
    const f = toFile('/literal.ts', `const x = 42;`);
    const result = collectBindingCandidates({ program: [f] });
    const candidates = result.get('/literal.ts') ?? [];
    const xCandidate = candidates.find(c => c.name === 'x');

    expect(xCandidate).toBeDefined();
    expect(xCandidate!.initCalleeEndOffset).toBeUndefined();
  });

  it('collectBindingCandidates - variable reference init - records no initCalleeEndOffset', () => {
    const f = toFile('/ref.ts', `const a = 1; const b = a;`);
    const result = collectBindingCandidates({ program: [f] });
    const candidates = result.get('/ref.ts') ?? [];
    const bCandidate = candidates.find(c => c.name === 'b');

    expect(bCandidate).toBeDefined();
    expect(bCandidate!.initCalleeEndOffset).toBeUndefined();
  });

  it('collectBindingCandidates - candidate has name, offset, span fields', () => {
    const f = toFile('/fields.ts', `const x = 1;`);
    const result = collectBindingCandidates({ program: [f] });
    const candidates = result.get('/fields.ts') ?? [];
    const candidate = candidates[0];

    expect(candidate).toBeDefined();
    expect(typeof candidate!.name).toBe('string');
    expect(typeof candidate!.offset).toBe('number');
    expect(candidate!.span).toBeDefined();
    expect(typeof candidate!.span.start.line).toBe('number');
  });

  it('collectBindingCandidates - variable inside function - records scopeRange', () => {
    const f = toFile('/scope.ts', `function foo() { const x = bar(); }`);
    const result = collectBindingCandidates({ program: [f] });
    const candidates = result.get('/scope.ts') ?? [];
    const xCandidate = candidates.find(c => c.name === 'x');

    expect(xCandidate).toBeDefined();
    expect(xCandidate!.scopeRange).toBeDefined();
    expect(typeof xCandidate!.scopeRange!.start).toBe('number');
    expect(typeof xCandidate!.scopeRange!.end).toBe('number');
  });

  it('collectBindingCandidates - variable inside arrow function - records scopeRange', () => {
    const f = toFile('/arrow-scope.ts', `const fn = () => { const y = 1; };`);
    const result = collectBindingCandidates({ program: [f] });
    const candidates = result.get('/arrow-scope.ts') ?? [];
    const yCandidate = candidates.find(c => c.name === 'y');

    expect(yCandidate).toBeDefined();
    expect(yCandidate!.scopeRange).toBeDefined();
  });

  it('collectBindingCandidates - top-level variable - scopeRange is module scope', () => {
    const code = `const x = 1;`;
    const f = toFile('/top-level.ts', code);
    const result = collectBindingCandidates({ program: [f] });
    const candidates = result.get('/top-level.ts') ?? [];
    const xCandidate = candidates.find(c => c.name === 'x');

    expect(xCandidate).toBeDefined();
    expect(xCandidate!.scopeRange).toBeDefined();
    expect(xCandidate!.scopeRange.start).toBe(0);
    expect(xCandidate!.scopeRange.end).toBe(code.length);
  });

  it('collectBindingCandidates - nested functions - picks narrowest scope', () => {
    const f = toFile('/nested.ts', `function outer() { function inner() { const z = 1; } }`);
    const result = collectBindingCandidates({ program: [f] });
    const candidates = result.get('/nested.ts') ?? [];
    const zCandidate = candidates.find(c => c.name === 'z');

    expect(zCandidate).toBeDefined();
    expect(zCandidate!.scopeRange).toBeDefined();

    // inner body is narrower than outer body
    const innerBody = f.sourceText.indexOf('{ const z');

    expect(zCandidate!.scopeRange!.start).toBeGreaterThanOrEqual(innerBody);
  });

  it('collectBindingCandidates - function param - records scopeRange from own body', () => {
    const code = `function foo(bar) { return bar; }`;
    const f = toFile('/param-scope.ts', code);
    const result = collectBindingCandidates({ program: [f] });
    const candidates = result.get('/param-scope.ts') ?? [];
    const barCandidate = candidates.find(c => c.name === 'bar');

    expect(barCandidate).toBeDefined();
    expect(barCandidate!.scopeRange).toBeDefined();

    // Param's scope should be the function body
    const bodyStart = code.indexOf('{ return');

    expect(barCandidate!.scopeRange.start).toBe(bodyStart);
  });

  it('collectBindingCandidates - de-duplicates by offset', () => {
    const f = toFile('/dedup.ts', `const x = 1;`);
    const result = collectBindingCandidates({ program: [f] });
    const candidates = result.get('/dedup.ts') ?? [];
    const offsets = candidates.map(c => c.offset);
    const uniqueOffsets = new Set(offsets);

    expect(offsets.length).toBe(uniqueOffsets.size);
  });
});

describe('features/unknown-proof/candidates — collectExpressionCandidates', () => {
  it('collectExpressionCandidates - empty program - returns empty map', () => {
    const result = collectExpressionCandidates({ program: [] });

    expect(result.size).toBe(0);
  });

  it('collectExpressionCandidates - as any cast - returns any-cast candidate', () => {
    const f = toFile('/any-cast.ts', `const x = response as any;`);
    const result = collectExpressionCandidates({ program: [f] });
    const candidates = result.get('/any-cast.ts') ?? [];

    expect(candidates.length).toBe(1);
    expect(candidates[0]!.kind).toBe('any-cast');
    expect(candidates[0]!.sourceSnippet).toContain('as any');
  });

  it('collectExpressionCandidates - double cast as unknown as T - returns double-cast candidate', () => {
    const f = toFile('/double-cast.ts', `const x = data as unknown as User;`);
    const result = collectExpressionCandidates({ program: [f] });
    const candidates = result.get('/double-cast.ts') ?? [];

    expect(candidates.length).toBe(1);
    expect(candidates[0]!.kind).toBe('double-cast');
    expect(candidates[0]!.sourceSnippet).toContain('as unknown as');
  });

  it('collectExpressionCandidates - non-null assertion (x!) - returns non-null-assertion candidate', () => {
    const f = toFile('/non-null.ts', `function f(m: Map<string, number>) { return m.get('k')!; }`);
    const result = collectExpressionCandidates({ program: [f] });
    const candidates = result.get('/non-null.ts') ?? [];

    expect(candidates.length).toBe(1);
    expect(candidates[0]!.kind).toBe('non-null-assertion');
    expect(candidates[0]!.sourceSnippet).toContain("m.get('k')!");
  });

  it('collectExpressionCandidates - multiple non-null assertions - returns one candidate per assertion', () => {
    const f = toFile(
      '/multi-non-null.ts',
      `function f(m: Map<string, number>, n: Map<string, number>) { return m.get('k')! + n.get('j')!; }`,
    );
    const result = collectExpressionCandidates({ program: [f] });
    const candidates = result.get('/multi-non-null.ts') ?? [];

    expect(candidates.filter(c => c.kind === 'non-null-assertion').length).toBe(2);
  });

  it('collectExpressionCandidates - non-null assertion on plain identifier - returns candidate', () => {
    const f = toFile('/x-bang.ts', `function f(x: string | null) { return x!.length; }`);
    const result = collectExpressionCandidates({ program: [f] });
    const candidates = result.get('/x-bang.ts') ?? [];

    expect(candidates.some(c => c.kind === 'non-null-assertion')).toBe(true);
  });

  it('collectExpressionCandidates - double cast as any as T - returns double-cast candidate', () => {
    const f = toFile('/double-cast-any.ts', `const x = data as any as User;`);
    const result = collectExpressionCandidates({ program: [f] });
    const candidates = result.get('/double-cast-any.ts') ?? [];

    expect(candidates.length).toBe(1);
    expect(candidates[0]!.kind).toBe('double-cast');
  });

  it('collectExpressionCandidates - normal type assertion - returns empty', () => {
    const f = toFile('/normal-cast.ts', `const x = value as string;`);
    const result = collectExpressionCandidates({ program: [f] });
    const candidates = result.get('/normal-cast.ts') ?? [];

    expect(candidates.length).toBe(0);
  });

  it('collectExpressionCandidates - no assertions - returns empty map', () => {
    const f = toFile('/clean.ts', `const x: number = 42;`);
    const result = collectExpressionCandidates({ program: [f] });

    expect(result.size).toBe(0);
  });

  it('collectExpressionCandidates - candidate has span with line and column', () => {
    const f = toFile('/span.ts', `const x = data as any;`);
    const result = collectExpressionCandidates({ program: [f] });
    const candidates = result.get('/span.ts') ?? [];

    expect(candidates.length).toBe(1);
    expect(typeof candidates[0]!.span.start.line).toBe('number');
    expect(typeof candidates[0]!.span.start.column).toBe('number');
  });
});
