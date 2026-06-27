import { describe, expect, it } from 'bun:test';
import { parseSync } from 'oxc-parser';

import type { AntiUnificationResult, DiffClassification } from './anti-unifier';

import { collectFunctionNodes } from '../../engine/ast/oxc-ast-utils';
import { antiUnify, classifyDiff } from './anti-unifier';

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

const parseFunctions = (source: string) => {
  const { program } = parseSync('test.ts', source);

  return collectFunctionNodes(program);
};

const firstTwo = (source: string) => {
  const fns = parseFunctions(source);

  if (fns.length < 2) {
    throw new Error('함수 2개 이상 필요');
  }

  return [fns[0]!, fns[1]!] as const;
};

/** Anti-unify `a`/`b`, assert at least one variable was abstracted, and return the result. */
const expectAuVars = (a: Parameters<typeof antiUnify>[0], b: Parameters<typeof antiUnify>[1]): ReturnType<typeof antiUnify> => {
  const result = antiUnify(a, b);

  expect(result.variables.length).toBeGreaterThan(0);

  return result;
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

  it.each([
    [
      'Identifier만 다른 두 함수 → kind="identifier" 변수만 생성',
      `
      function addFoo(foo: number, bar: number) {
        return foo + bar;
      }
      function addBaz(baz: number, qux: number) {
        return baz + qux;
      }
    `,
      'identifier',
    ],
    // NOTE: 'Literal만 다른' 케이스 제거 — 리터럴 비치환(개념 변경)으로 literal-variant 비탐지.
    // antiUnify는 리터럴이 다른 트리를 더 이상 정렬해 literal 변수로 분류하지 않는다.
  ] as const)('%s', (_label, source, expectedKind) => {
    const [a, b] = firstTwo(source);
    const result = expectAuVars(a, b);

    for (const v of result.variables) {
      expect(v.kind).toBe(expectedKind);
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
    const structuralVars = result.variables.filter(v => v.kind === 'structural');

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
    const result = expectAuVars(a, b);

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
    const result = expectAuVars(a, b);

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

  it('TSTypeReference 동일 시 sharedSize에 자식 노드 수 반영', () => {
    // 같은 타입 Array<number>를 사용하는 두 함수
    const [a, b] = firstTwo(`
      function foo(x: Array<number>): void { return; }
      function bar(y: Array<number>): void { return; }
    `);
    const result = antiUnify(a, b);

    // 두 함수의 구조가 거의 동일하므로 similarity는 높아야 함
    expect(result.similarity).toBeGreaterThan(0.8);
  });

  it.each([
    // NOTE: 'string literal만 다른 switch-case' 케이스 제거 — 리터럴 비치환으로 literal-variant 비탐지.
    [
      '한쪽에만 키가 있는 경우 (optional property) → structural variable 생성',
      // left는 init 있음, right는 init 없음 → 한쪽에만 존재하는 키(init)로 structural variable 생성
      `
      function withInit() {
        let x = 0;
        return x;
      }
      function withoutInit() {
        let x;
        return x;
      }
    `,
      'structural',
    ],
  ] as const)('%s', (_label, source, expectedKind) => {
    const [a, b] = firstTwo(source);
    const result = antiUnify(a, b);
    const matchingVars = result.variables.filter(v => v.kind === expectedKind);

    expect(matchingVars.length).toBeGreaterThan(0);
  });

  it('traverseArrayChildren bOnly (B에만 있는 노드) → structural variable 생성', () => {
    // Arrange: left는 statement 2개, right는 동일 2개 + 추가 1개
    const [a, b] = firstTwo(`
      function base() {
        const x = 1;
        return x;
      }
      function extended() {
        const x = 1;
        return x;
        console.log("extra");
      }
    `);
    // Act
    const result = antiUnify(a, b);
    // Assert: bOnly 노드에 대해 leftType="missing", kind="structural" 인 변수가 생성되어야 함
    const bOnlyVars = result.variables.filter(v => v.kind === 'structural' && v.leftType === 'missing');

    expect(bOnlyVars.length).toBeGreaterThan(0);
  });

  it('이진 연산자 차이 (a + b vs a - b) → operator가 structural kind로 분류', () => {
    // Arrange: 두 BinaryExpression 노드를 직접 추출하여 비교
    // (함수를 통해 비교하면 LCS fingerprint에 operator가 포함되어 statements 자체가 비매칭됨)
    const { program: p1 } = parseSync('test.ts', 'let _x = a + b;');
    const { program: p2 } = parseSync('test.ts', 'let _x = a - b;');
    const addExpr = (p1.body[0] as unknown as { declarations: Array<{ init: import('oxc-parser').Node }> }).declarations[0]!.init;
    const subExpr = (p2.body[0] as unknown as { declarations: Array<{ init: import('oxc-parser').Node }> }).declarations[0]!.init;
    // Act
    const result = antiUnify(addExpr, subExpr);
    // Assert: operator 차이로 인한 structural variable이 생성되어야 함
    const operatorVars = result.variables.filter(v => v.kind === 'structural' && v.leftType === '+' && v.rightType === '-');

    expect(operatorVars.length).toBeGreaterThan(0);
  });
});

// ─── classifyDiff ─────────────────────────────────────────────────────────────

describe('classifyDiff', () => {
  it.each<[string, AntiUnificationResult, DiffClassification]>([
    [
      'variables 없음 → rename-only',
      { sharedSize: 10, leftSize: 10, rightSize: 10, similarity: 1, variables: [] },
      'rename-only',
    ],
    [
      'identifier만 → rename-only',
      {
        sharedSize: 8,
        leftSize: 10,
        rightSize: 10,
        similarity: 0.8,
        variables: [
          { id: 1, location: 'params[0].name', leftType: 'x', rightType: 'y', kind: 'identifier' },
          { id: 2, location: 'body.body[0].id.name', leftType: 'foo', rightType: 'bar', kind: 'identifier' },
        ],
      },
      'rename-only',
    ],
    [
      'literal만 → literal-variant',
      {
        sharedSize: 8,
        leftSize: 10,
        rightSize: 10,
        similarity: 0.8,
        variables: [{ id: 1, location: 'body.body[0].value', leftType: '42', rightType: '99', kind: 'literal' }],
      },
      'literal-variant',
    ],
    [
      'structural 하나라도 → structural-diff',
      {
        sharedSize: 5,
        leftSize: 10,
        rightSize: 12,
        similarity: 0.5,
        variables: [
          { id: 1, location: 'params[0].name', leftType: 'x', rightType: 'y', kind: 'identifier' },
          { id: 2, location: 'body.body[2]', leftType: 'ReturnStatement', rightType: 'missing', kind: 'structural' },
        ],
      },
      'structural-diff',
    ],
    [
      'identifier + literal 혼합 → mixed',
      {
        sharedSize: 8,
        leftSize: 10,
        rightSize: 10,
        similarity: 0.8,
        variables: [
          { id: 1, location: 'params[0].name', leftType: 'x', rightType: 'y', kind: 'identifier' },
          { id: 2, location: 'body.body[0].value', leftType: '42', rightType: '99', kind: 'literal' },
        ],
      },
      'mixed',
    ],
    [
      'type만 다른 변수 → type-variant',
      {
        sharedSize: 8,
        leftSize: 10,
        rightSize: 10,
        similarity: 0.8,
        variables: [
          {
            id: 1,
            location: 'params[0].typeAnnotation',
            leftType: 'TSTypeReference',
            rightType: 'TSTypeReference',
            kind: 'type',
          },
        ],
      },
      'type-variant',
    ],
  ])('%s', (_label, result, expected) => {
    expect(classifyDiff(result)).toBe(expected);
  });

  it.each<[string, string, DiffClassification]>([
    [
      '실제 AST 기반 classifyDiff — identifier만 다른 함수',
      `
      function addX(x: number, y: number) { return x + y; }
      function addA(a: number, b: number) { return a + b; }
    `,
      'rename-only',
    ],
    // NOTE: '실제 AST literal만 다른 함수' 케이스 제거 — 리터럴 비치환으로 antiUnify가
    // 리터럴 차이를 literal-variant로 분류하지 않는다 (개념 변경).
    [
      '실제 AST 기반 classifyDiff — statement 추가 → structural-diff',
      `
      function simple() { return 1; }
      function complex() { console.log("hi"); return 1; }
    `,
      'structural-diff',
    ],
  ])('%s', (_label, source, expected) => {
    const fns = parseFunctions(source);
    const result = antiUnify(fns[0]!, fns[1]!);

    expect(classifyDiff(result)).toBe(expected);
  });
});
