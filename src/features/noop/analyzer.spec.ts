import { describe, it, expect } from 'bun:test';

import { parseSource } from '../../engine/parse-source';
import { analyzeNoop, createEmptyNoop } from './analyzer';

const file = (sourceText: string) => parseSource('test.ts', sourceText);

describe('createEmptyNoop', () => {
  it('returns an empty array', () => {
    expect(createEmptyNoop()).toEqual([]);
  });
});

describe('analyzeNoop', () => {
  it('[ED] returns [] when files array is empty', () => {
    expect(analyzeNoop([])).toEqual([]);
  });

  it('[ED] skips files that have parse errors', () => {
    const broken = file('const = ;'); // syntax error
    expect(broken.errors.length).toBeGreaterThan(0);
    expect(analyzeNoop([broken])).toEqual([]);
  });

  it('[HP] detects expression-noop for standalone literal', () => {
    const findings = analyzeNoop([file('1;')]);
    expect(findings.some(f => f.kind === 'expression-noop')).toBe(true);
  });

  it('[HP] detects self-assignment (x = x)', () => {
    const findings = analyzeNoop([file('let x = 0; x = x;')]);
    expect(findings.some(f => f.kind === 'self-assignment')).toBe(true);
  });

  it('[HP] detects constant-condition (if true)', () => {
    const findings = analyzeNoop([file('if (true) { doSomething(); }')]);
    expect(findings.some(f => f.kind === 'constant-condition')).toBe(true);
  });

  it('[HP] detects constant-condition (if false)', () => {
    const findings = analyzeNoop([file('if (false) { doSomething(); }')]);
    expect(findings.some(f => f.kind === 'constant-condition')).toBe(true);
  });

  it('[HP] detects empty-catch block', () => {
    const findings = analyzeNoop([file('try { x(); } catch (e) {}')]);
    expect(findings.some(f => f.kind === 'empty-catch')).toBe(true);
  });

  it('[HP] detects empty-function-body for function declaration', () => {
    const findings = analyzeNoop([file('function f() {}')]);
    expect(findings.some(f => f.kind === 'empty-function-body')).toBe(true);
  });

  it('[NE] non-empty function body does not trigger empty-function-body', () => {
    const findings = analyzeNoop([file('function f() { return 1; }')]);
    expect(findings.every(f => f.kind !== 'empty-function-body')).toBe(true);
  });

  it('[HP] detects self-assignment for member expression (a.b = a.b)', () => {
    const findings = analyzeNoop([file('let obj = { x: 0 }; obj.x = obj.x;')]);
    expect(findings.some(f => f.kind === 'self-assignment')).toBe(true);
  });

  it('[HP] detects self-assignment for this.x = this.x', () => {
    const findings = analyzeNoop([file('class C { m() { this.x = this.x; } }')]);
    expect(findings.some(f => f.kind === 'self-assignment')).toBe(true);
  });

  it('[HP] detects empty-function-body for arrow function', () => {
    const findings = analyzeNoop([file('const f = () => {};')]);
    expect(findings.some(f => f.kind === 'empty-function-body')).toBe(true);
  });

  it('[CO] accumulates multiple noop findings in one file', () => {
    const src = [
      'function f() {}',       // empty-function-body
      'try { g(); } catch(e) {}', // empty-catch
    ].join('\n');
    const findings = analyzeNoop([file(src)]);
    const kinds = findings.map(f => f.kind);
    expect(kinds).toContain('empty-function-body');
    expect(kinds).toContain('empty-catch');
  });
});
