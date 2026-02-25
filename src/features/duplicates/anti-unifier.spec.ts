import { describe, expect, it } from 'bun:test';
import { parseSync } from 'oxc-parser';

import { collectFunctionNodes } from '../../engine/ast/oxc-ast-utils';
import { antiUnify, classifyDiff } from './anti-unifier';

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

const parseFunctions = (source: string) => {
  const { program } = parseSync('test.ts', source);
  return collectFunctionNodes(program);
};

const firstTwo = (source: string) => {
  const fns = parseFunctions(source);
  if (fns.length < 2) throw new Error('함수 2개 이상 필요');
  return [fns[0]!, fns[1]!] as const;
};

// ─── antiUnify ────────────────────────────────────────────────────────────────

describe('antiUnify', () => {
  it('동일 함수 → variables 빈 배열, similarity 1.0', () => {
    const [fn] = parseFunctions(`
      function greet(name: string) {
        const msg = "hello " + name;
        return msg;
      }
    `);
    const result = antiUnify(fn!, fn!);
    expect(result.variables).toHaveLength(0);
    expect(result.similarity).toBe(1.0);
    expect(result.sharedSize).toBe(result.leftSize);
    expect(result.sharedSize).toBe(result.rightSize);
  });

  it('Identifier만 다른 두 함수 → kind="identifier" 변수만 생성', () => {
    const [a, b] = firstTwo(`
      function addFoo(foo: number, bar: number) {
        return foo + bar;
      }
      function addBaz(baz: number, qux: number) {
        return baz + qux;
      }
    `);
    const result = antiUnify(a, b);
    expect(result.variables.length).toBeGreaterThan(0);
    for (const v of result.variables) {
      expect(v.kind).toBe('identifier');
    }
    expect(result.similarity).toBeGreaterThan(0.5);
  });

  it('Literal만 다른 두 함수 → kind="literal" 변수만 생성', () => {
    const [a, b] = firstTwo(`
      function getVal() {
        return 42;
      }
      function getVal() {
        return 99;
      }
    `);
    const result = antiUnify(a, b);
    expect(result.variables.length).toBeGreaterThan(0);
    for (const v of result.variables) {
      expect(v.kind).toBe('literal');
    }
    expect(result.similarity).toBeGreaterThan(0.5);
  });

  it('Statement 추가된 함수 → kind="structural" 변수 포함', () => {
    const [a, b] = firstTwo(`
      function base() {
        const x = 1;
        return x;
      }
      function extended() {
        const x = 1;
        console.log(x);
        return x;
      }
    `);
    const result = antiUnify(a, b);
    const structuralVars = result.variables.filter((v) => v.kind === 'structural');
    expect(structuralVars.length).toBeGreaterThan(0);
    expect(result.similarity).toBeGreaterThan(0);
    expect(result.similarity).toBeLessThan(1);
  });

  it('완전히 다른 두 함수 → similarity ≈ 0, variables 다수', () => {
    const [a, b] = firstTwo(`
      function mathOp(x: number) {
        return x * x + 1;
      }
      function strOp(s: string) {
        for (let i = 0; i < s.length; i++) {
          console.log(s[i]);
        }
      }
    `);
    const result = antiUnify(a, b);
    expect(result.variables.length).toBeGreaterThan(0);
    expect(result.similarity).toBeLessThan(0.5);
  });

  it('중첩 구조 차이 (if 내부 조건 다름) → 정확한 location dotpath', () => {
    const [a, b] = firstTwo(`
      function checkA(val: number) {
        if (val > 0) {
          return "positive";
        }
        return "non-positive";
      }
      function checkB(val: number) {
        if (val < 0) {
          return "negative";
        }
        return "non-negative";
      }
    `);
    const result = antiUnify(a, b);
    expect(result.variables.length).toBeGreaterThan(0);
    // location이 비어있지 않아야 함
    for (const v of result.variables) {
      expect(typeof v.location).toBe('string');
    }
  });

  it('variable id가 1부터 순차적으로 증가', () => {
    const [a, b] = firstTwo(`
      function f1(x: number) { return x + 1; }
      function f2(y: number) { return y + 2; }
    `);
    const result = antiUnify(a, b);
    for (let i = 0; i < result.variables.length; i++) {
      expect(result.variables[i]!.id).toBe(i + 1);
    }
  });

  it('leftSize/rightSize가 countOxcSize와 일치', () => {
    const [a, b] = firstTwo(`
      function short() { return 1; }
      function longer() { const x = 1; const y = 2; return x + y; }
    `);
    const result = antiUnify(a, b);
    expect(result.leftSize).toBeGreaterThan(0);
    expect(result.rightSize).toBeGreaterThan(0);
    expect(result.rightSize).toBeGreaterThan(result.leftSize);
  });

  it('similarity 범위는 [0, 1]', () => {
    const [a, b] = firstTwo(`
      function fa(x: number) { return x; }
      function fb() { while(true) { break; } }
    `);
    const result = antiUnify(a, b);
    expect(result.similarity).toBeGreaterThanOrEqual(0);
    expect(result.similarity).toBeLessThanOrEqual(1);
  });

  it('string literal만 다른 switch-case → literal-variant', () => {
    const [a, b] = firstTwo(`
      function handleA(action: string) {
        switch (action) {
          case "start": return 1;
          case "stop": return 2;
          default: return 0;
        }
      }
      function handleB(action: string) {
        switch (action) {
          case "begin": return 1;
          case "end": return 2;
          default: return 0;
        }
      }
    `);
    const result = antiUnify(a, b);
    const literalVars = result.variables.filter((v) => v.kind === 'literal');
    expect(literalVars.length).toBeGreaterThan(0);
  });
});

// ─── classifyDiff ─────────────────────────────────────────────────────────────

describe('classifyDiff', () => {
  it('variables 없음 → rename-only', () => {
    expect(
      classifyDiff({ sharedSize: 10, leftSize: 10, rightSize: 10, similarity: 1, variables: [] }),
    ).toBe('rename-only');
  });

  it('identifier만 → rename-only', () => {
    expect(
      classifyDiff({
        sharedSize: 8,
        leftSize: 10,
        rightSize: 10,
        similarity: 0.8,
        variables: [
          { id: 1, location: 'params[0].name', leftType: 'x', rightType: 'y', kind: 'identifier' },
          { id: 2, location: 'body.body[0].id.name', leftType: 'foo', rightType: 'bar', kind: 'identifier' },
        ],
      }),
    ).toBe('rename-only');
  });

  it('literal만 → literal-variant', () => {
    expect(
      classifyDiff({
        sharedSize: 8,
        leftSize: 10,
        rightSize: 10,
        similarity: 0.8,
        variables: [
          { id: 1, location: 'body.body[0].value', leftType: '42', rightType: '99', kind: 'literal' },
        ],
      }),
    ).toBe('literal-variant');
  });

  it('structural 하나라도 → structural-diff', () => {
    expect(
      classifyDiff({
        sharedSize: 5,
        leftSize: 10,
        rightSize: 12,
        similarity: 0.5,
        variables: [
          { id: 1, location: 'params[0].name', leftType: 'x', rightType: 'y', kind: 'identifier' },
          { id: 2, location: 'body.body[2]', leftType: 'ReturnStatement', rightType: 'missing', kind: 'structural' },
        ],
      }),
    ).toBe('structural-diff');
  });

  it('identifier + literal 혼합 → mixed', () => {
    expect(
      classifyDiff({
        sharedSize: 8,
        leftSize: 10,
        rightSize: 10,
        similarity: 0.8,
        variables: [
          { id: 1, location: 'params[0].name', leftType: 'x', rightType: 'y', kind: 'identifier' },
          { id: 2, location: 'body.body[0].value', leftType: '42', rightType: '99', kind: 'literal' },
        ],
      }),
    ).toBe('mixed');
  });

  it('type만 → mixed (rename-only도 literal-variant도 아님)', () => {
    expect(
      classifyDiff({
        sharedSize: 8,
        leftSize: 10,
        rightSize: 10,
        similarity: 0.8,
        variables: [
          { id: 1, location: 'params[0].typeAnnotation', leftType: 'TSTypeReference', rightType: 'TSTypeReference', kind: 'type' },
        ],
      }),
    ).toBe('mixed');
  });

  it('실제 AST 기반 classifyDiff — identifier만 다른 함수', () => {
    const fns = parseFunctions(`
      function addX(x: number, y: number) { return x + y; }
      function addA(a: number, b: number) { return a + b; }
    `);
    const result = antiUnify(fns[0]!, fns[1]!);
    expect(classifyDiff(result)).toBe('rename-only');
  });

  it('실제 AST 기반 classifyDiff — literal만 다른 함수', () => {
    const fns = parseFunctions(`
      function getConst() { return 100; }
      function getConst() { return 200; }
    `);
    const result = antiUnify(fns[0]!, fns[1]!);
    expect(classifyDiff(result)).toBe('literal-variant');
  });

  it('실제 AST 기반 classifyDiff — statement 추가 → structural-diff', () => {
    const fns = parseFunctions(`
      function simple() { return 1; }
      function complex() { console.log("hi"); return 1; }
    `);
    const result = antiUnify(fns[0]!, fns[1]!);
    expect(classifyDiff(result)).toBe('structural-diff');
  });
});
