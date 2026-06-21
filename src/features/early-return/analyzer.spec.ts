import { describe, expect, it } from 'bun:test';

import type { DetectionCase, NoFindingCase } from '../../../test/integration/shared/early-return-cases';

import { expectDetection, expectNoFinding } from '../../../test/integration/shared/early-return-cases';
import { parseProgram as parse } from '../../../test/integration/shared/test-kit';
import { analyzeEarlyReturn, __testing__ } from './analyzer';

const { countConsecutiveTrailingIfs, countStatements, endsWithReturnOrThrow, isExitBlock, isExitStatement, isLoopGuardBlock } =
  __testing__;

const node = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra });

interface PredicateCase {
  readonly label: string;
  readonly value: unknown;
  readonly expected: boolean;
}

interface CountCase {
  readonly label: string;
  readonly stmts: unknown[];
  readonly expected: number;
}

interface NodeCountCase {
  readonly label: string;
  readonly value: unknown;
  readonly expected: number;
}

describe('early-return/analyzer helpers', () => {
  const isExitStatementCases: PredicateCase[] = [
    { label: 'node is not return-or-throw', value: node('ExpressionStatement'), expected: false },
    { label: 'node is ReturnStatement', value: node('ReturnStatement'), expected: true },
    { label: 'node is ThrowStatement', value: node('ThrowStatement'), expected: true },
  ];

  it.each(isExitStatementCases)('isExitStatement should return $expected when $label', ({ value, expected }) => {
    // Act
    const result = isExitStatement(value as any);

    // Assert
    expect(result).toBe(expected);
  });

  const isExitBlockCases: PredicateCase[] = [
    { label: 'value is ReturnStatement', value: node('ReturnStatement'), expected: true },
    { label: 'value is ThrowStatement', value: node('ThrowStatement'), expected: true },
    { label: 'value is not a block or exit statement', value: node('ExpressionStatement'), expected: false },
    { label: 'block body is empty', value: node('BlockStatement', { body: [] }), expected: false },
    {
      label: 'multi-statement block ends with return',
      value: node('BlockStatement', { body: [node('ExpressionStatement'), node('ReturnStatement')] }),
      expected: true,
    },
    {
      label: 'block body ends with non-exit statement',
      value: node('BlockStatement', { body: [node('ExpressionStatement')] }),
      expected: false,
    },
    {
      label: 'block body contains only ReturnStatement',
      value: node('BlockStatement', { body: [node('ReturnStatement')] }),
      expected: true,
    },
    {
      label: 'block body contains only ThrowStatement',
      value: node('BlockStatement', { body: [node('ThrowStatement')] }),
      expected: true,
    },
  ];

  it.each(isExitBlockCases)('isExitBlock should return $expected when $label', ({ value, expected }) => {
    // Act
    const result = isExitBlock(value as any);

    // Assert
    expect(result).toBe(expected);
  });

  const isLoopGuardBlockCases: PredicateCase[] = [
    { label: 'value is ContinueStatement', value: node('ContinueStatement'), expected: true },
    { label: 'value is BreakStatement', value: node('BreakStatement'), expected: true },
    { label: 'value is ReturnStatement', value: node('ReturnStatement'), expected: true },
    { label: 'value is ThrowStatement', value: node('ThrowStatement'), expected: true },
    { label: 'block body is empty', value: node('BlockStatement', { body: [] }), expected: false },
    {
      label: 'multi-statement block ends with continue',
      value: node('BlockStatement', { body: [node('ExpressionStatement'), node('ContinueStatement')] }),
      expected: true,
    },
    {
      label: 'multi-statement block ends with return',
      value: node('BlockStatement', { body: [node('ExpressionStatement'), node('ReturnStatement')] }),
      expected: true,
    },
    {
      label: 'block body ends with non-guard statement',
      value: node('BlockStatement', { body: [node('ExpressionStatement')] }),
      expected: false,
    },
    {
      label: 'block body contains only ContinueStatement',
      value: node('BlockStatement', { body: [node('ContinueStatement')] }),
      expected: true,
    },
    {
      label: 'block body contains only BreakStatement',
      value: node('BlockStatement', { body: [node('BreakStatement')] }),
      expected: true,
    },
  ];

  it.each(isLoopGuardBlockCases)('isLoopGuardBlock should return $expected when $label', ({ value, expected }) => {
    // Act
    const result = isLoopGuardBlock(value as any);

    // Assert
    expect(result).toBe(expected);
  });

  const countConsecutiveTrailingIfsCases: CountCase[] = [
    { label: 'array is empty', stmts: [], expected: 0 },
    {
      label: 'last stmt is IfStatement (no alternate) preceded by non-if',
      stmts: [node('ExpressionStatement'), node('IfStatement')],
      expected: 1,
    },
    {
      label: 'last 2 stmts are IfStatement (no alternate) preceded by non-if',
      stmts: [node('ExpressionStatement'), node('IfStatement'), node('IfStatement')],
      expected: 2,
    },
    {
      label: 'all 3 stmts are IfStatement (no alternate)',
      stmts: [node('IfStatement'), node('IfStatement'), node('IfStatement')],
      expected: 3,
    },
    {
      label: 'IfStatements are non-consecutive (interrupted by ExprStmt)',
      stmts: [node('IfStatement'), node('ExpressionStatement'), node('IfStatement')],
      expected: 1,
    },
    {
      label: 'a trailing ReturnStatement is skipped and preceding IfStatements counted',
      stmts: [node('IfStatement'), node('IfStatement'), node('ReturnStatement')],
      expected: 2,
    },
    {
      label: 'an IfStatement with alternate breaks the chain',
      stmts: [node('IfStatement', { alternate: node('BlockStatement', { body: [] }) }), node('IfStatement')],
      expected: 1,
    },
  ];

  it.each(countConsecutiveTrailingIfsCases)(
    'countConsecutiveTrailingIfs should return $expected when $label',
    ({ stmts, expected }) => {
      // Act
      const result = countConsecutiveTrailingIfs(stmts as any[]);

      // Assert
      expect(result).toBe(expected);
    },
  );

  const elseIfChainNode = node('IfStatement', {
    consequent: node('BlockStatement', { body: [node('ExpressionStatement'), node('ReturnStatement')] }),
    alternate: node('IfStatement', {
      consequent: node('BlockStatement', { body: [node('ReturnStatement')] }),
      alternate: node('BlockStatement', {
        body: [node('ExpressionStatement'), node('ExpressionStatement'), node('ReturnStatement')],
      }),
    }),
  });
  const countStatementsCases: NodeCountCase[] = [
    { label: 'node is not a block statement', value: node('ReturnStatement'), expected: 1 },
    { label: 'block body is missing', value: node('BlockStatement'), expected: 0 },
    { label: 'block body is not an array', value: node('BlockStatement', { body: node('ReturnStatement') }), expected: 0 },
    {
      label: 'node is a block statement with array body',
      value: node('BlockStatement', { body: [node('ExpressionStatement'), node('ReturnStatement')] }),
      expected: 2,
    },
    { label: 'else-if chain is counted without +1 per IfStatement branch', value: elseIfChainNode, expected: 6 },
  ];

  it.each(countStatementsCases)('countStatements should return $expected when $label', ({ value, expected }) => {
    // Act
    const result = countStatements(value as any);

    // Assert
    expect(result).toBe(expected);
  });

  const endsWithReturnOrThrowCases: PredicateCase[] = [
    { label: 'node is not an oxc node', value: 123, expected: false },
    { label: 'node is ReturnStatement', value: node('ReturnStatement'), expected: true },
    { label: 'node is ThrowStatement', value: node('ThrowStatement'), expected: true },
    { label: 'node is not a block statement or exit statement', value: node('ExpressionStatement'), expected: false },
    { label: 'block body is empty', value: node('BlockStatement', { body: [] }), expected: false },
    { label: 'block body is missing', value: node('BlockStatement'), expected: false },
    {
      label: 'block last statement is not a node',
      value: node('BlockStatement', { body: [node('ExpressionStatement'), 'not-a-node'] }),
      expected: false,
    },
    {
      label: 'block ends with ReturnStatement',
      value: node('BlockStatement', { body: [node('ExpressionStatement'), node('ReturnStatement')] }),
      expected: true,
    },
    {
      label: 'block ends with ThrowStatement',
      value: node('BlockStatement', { body: [node('ExpressionStatement'), node('ThrowStatement')] }),
      expected: true,
    },
    {
      label: 'block ends with non-exit statement even if earlier exit exists',
      value: node('BlockStatement', { body: [node('ReturnStatement'), node('ExpressionStatement')] }),
      expected: false,
    },
  ];

  it.each(endsWithReturnOrThrowCases)('endsWithReturnOrThrow should return $expected when $label', ({ value, expected }) => {
    // Act
    const result = endsWithReturnOrThrow(value as any);

    // Assert
    expect(result).toBe(expected);
  });
});

describe('analyzeEarlyReturn', () => {
  const noFindingCases: NoFindingCase[] = [
    {
      label: 'empty function returns no findings',
      source: 'export function empty() {}',
    },
    {
      label: 'score < 2 (1-stmt wrapping-if) returns no findings',
      source: `
export function tiny(x: boolean) {
  if (x) {
    doA();
  }
}
`,
    },
    {
      label: 'nested function returns are isolated',
      source: `
export function outer() {
  const inner = () => { return 1; };
  return inner();
}
`,
    },
    {
      label: 'cascade-guard middle branch without exit returns no findings',
      source: `
export function f(a: boolean, b: boolean) {
  if (a) {
    return 'a';
  } else if (b) {
    console.log('b');
  } else {
    doA();
    doB();
    doC();
    doD();
    doE();
  }
}
`,
    },
    {
      label: 'else-if chain alternate skipped for invertible (no false positive)',
      source: `
export function f(a: boolean, b: boolean) {
  if (a) {
    return 'early';
  } else if (b) {
    doA();
    doB();
  } else {
    doC();
    doD();
    doE();
  }
}
`,
    },
    {
      label: 'implicit-else ratio not met (4 < 3*2) returns no findings',
      source: `
export function f(x: boolean) {
  if (x) {
    doA();
    doB();
    doC();
    return 'done';
  }
  logA();
  logB();
  return null;
}
`,
    },
    {
      label: 'implicit-else remaining > 3 stmts returns no findings',
      source: `
export function f(x: boolean) {
  if (x) {
    doA();
    doB();
    doC();
    doD();
    doE();
    doF();
    doG();
    doH();
    return 'done';
  }
  logA();
  logB();
  logC();
  return null;
}
`,
    },
    {
      label: 'implicit-else consequent has no exit returns no findings',
      source: `
export function f(x: boolean) {
  if (x) {
    doA();
    doB();
    doC();
    doD();
  }
  return null;
}
`,
    },
    {
      label: 'implicit-else function remaining without exit returns no findings',
      source: `
export function f(x: boolean) {
  if (x) {
    doA();
    doB();
    doC();
    doD();
    doE();
    return 'done';
  }
  logError();
}
`,
    },
    {
      label: 'tail-less cascade-guard middle branch without exit is not detected',
      source: `
export function f(a: boolean, b: boolean, c: boolean) {
  if (a) {
    return 'a';
  } else if (b) {
    console.log('b');
  } else if (c) {
    return 'c';
  }
  return 'default';
}
`,
    },
  ];

  it.each(noFindingCases)('should return no findings when $label', expectNoFinding);

  it('analyzeEarlyReturn - empty files array - returns empty', () => {
    // Arrange & Act
    const result = analyzeEarlyReturn([]);

    // Assert
    expect(result).toEqual([]);
  });

  const detectionCases: DetectionCase[] = [
    {
      label: 'wrapping-if: function body wrapping (5 stmts) returns score 5',
      source: `
export function process(data: unknown) {
  if (isValid(data)) {
    doA();
    doB();
    doC();
    doD();
    doE();
  }
}
`,
      expected: { kind: 'wrapping-if', score: 5, metrics: { depthReduction: 1, statementsAffected: 5 } },
    },
    {
      label: 'wrapping-if: tail-if (last stmt with preceding code, 4 stmts) returns score 4',
      source: `
export function process(data: unknown) {
  const x = prepare(data);
  if (x > 0) {
    doA();
    doB();
    doC();
    doD();
  }
}
`,
      expected: { kind: 'wrapping-if', score: 4 },
    },
    {
      label: 'wrapping-if: loop body wrapping (6 stmts) returns score 6',
      source: `
export function processAll(items: string[]) {
  for (const item of items) {
    if (item.length > 0) {
      doA(item);
      doB(item);
      doC(item);
      doD(item);
      doE(item);
      doF(item);
    }
  }
}
`,
      expected: { kind: 'wrapping-if', score: 6, metrics: { depthReduction: 1, statementsAffected: 6 } },
    },
    {
      label: 'invertible-if-else: short 1 stmt + long 6 stmts returns score 6',
      source: `
export function process(x: string | null): string {
  if (x === null) {
    return 'default';
  } else {
    const a = x.trim();
    const b = a.toUpperCase();
    const c = b.replace(/x/g, '');
    console.log(c);
    doSomething(c);
    return c;
  }
}
`,
      expected: { kind: 'invertible-if-else', score: 6, metrics: { depthReduction: 1, statementsAffected: 6 } },
    },
    {
      label: 'cascade-guard: 3-branch chain, final 4 stmts returns score 12',
      source: `
export function handle(x: number): string {
  if (x < 0) {
    return 'neg';
  } else if (x === 0) {
    return 'zero';
  } else if (x > 100) {
    return 'big';
  } else {
    const a = String(x);
    const b = a.padStart(2, '0');
    const c = b + '!';
    return c;
  }
}
`,
      expected: { kind: 'cascade-guard', score: 12, metrics: { depthReduction: 3, statementsAffected: 4 } },
    },
    {
      label: 'cascade-guard: loop continue chain (2-branch, final 5 stmts) returns score 10',
      source: `
export function processItems(items: Array<{ type: string; value: string }>) {
  for (const item of items) {
    if (item.type === 'skip') {
      continue;
    } else if (item.type === 'done') {
      break;
    } else {
      doA(item);
      doB(item);
      doC(item);
      doD(item);
      doE(item);
    }
  }
}
`,
      expected: { kind: 'cascade-guard', score: 10, metrics: { depthReduction: 2, statementsAffected: 5 } },
    },
    {
      label: 'wrapping-if + invertible coexist reports higher impact kind with summed score',
      source: `
export function mixed(a: boolean, b: string | null): string {
  if (b === null) {
    return 'none';
  } else {
    const x = b.trim();
    const y = x.toUpperCase();
    const z = y + '!';
    return z;
  }
  if (a) {
    doA();
    doB();
    doC();
  }
}
`,
      expected: { kind: 'invertible-if-else', score: 7 },
    },
    {
      label: 'class method wrapping-if detects pattern',
      source: `
export class Handler {
  handle(data: unknown) {
    if (data !== null) {
      doA(data);
      doB(data);
      doC(data);
    }
  }
}
`,
      expected: { kind: 'wrapping-if', score: 3 },
    },
    {
      label: 'async function detects pattern normally',
      source: `
export async function fetchAll(urls: string[]) {
  for (const url of urls) {
    if (url.startsWith('http')) {
      const res = await fetch(url);
      const text = await res.text();
      console.log(text);
    }
  }
}
`,
      expected: { kind: 'wrapping-if' },
    },
    {
      label: 'invertible-if-else where else branch is the short side',
      source: `
export function f(x: boolean) {
  if (x) {
    const a = 1;
    const b = 2;
    const c = 3;
    const d = 4;
    const e = 5;
    return a + b + c + d + e;
  } else {
    return 0;
  }
}
`,
      expected: { kind: 'invertible-if-else', metrics: { statementsAffected: 6 } },
    },
    {
      label: 'invertible-if-else in loop with break exit',
      source: `
export function f(items: string[]) {
  for (const item of items) {
    if (item === 'stop') {
      break;
    } else {
      doA(item);
      doB(item);
      doC(item);
      doD(item);
    }
  }
}
`,
      expected: { kind: 'invertible-if-else' },
    },
    {
      label: 'score exactly 2 passes threshold',
      source: `
export function f(x: boolean) {
  if (x) {
    doA();
    doB();
  }
}
`,
      expected: { score: 2 },
    },
    {
      label: 'implicit-else: function body if(exit) + 1 stmt remaining returns implicit-else',
      source: `
export function process(data: { isValid: boolean }) {
  if (data.isValid) {
    doA();
    doB();
    doC();
    doD();
    doE();
    return 'result';
  }
  return null;
}
`,
      expected: { kind: 'implicit-else', metrics: { depthReduction: 1, statementsAffected: 6 } },
    },
    {
      label: 'implicit-else: loop body if(continue) + 1 stmt remaining returns implicit-else',
      source: `
export function processAll(items: string[]) {
  for (const item of items) {
    if (item.length > 5) {
      processA(item);
      processB(item);
      processC(item);
      processD(item);
      continue;
    }
    handleShort(item);
  }
}
`,
      expected: { kind: 'implicit-else', metrics: { statementsAffected: 5 } },
    },
    {
      label: 'implicit-else: remaining 2 stmts (short) + consequent 6 stmts (long) returns implicit-else',
      source: `
export function process(data: { isValid: boolean }) {
  if (data.isValid) {
    doA();
    doB();
    doC();
    doD();
    doE();
    return 'ok';
  }
  logError();
  return null;
}
`,
      expected: { kind: 'implicit-else', metrics: { statementsAffected: 6 } },
    },
    {
      label: 'implicit-else: has else branch returns invertible-if-else',
      source: `
export function f(x: boolean) {
  if (x) {
    doA();
    doB();
    doC();
    doD();
    doE();
    return 'done';
  } else {
    return null;
  }
}
`,
      expected: { kind: 'invertible-if-else' },
    },
    {
      label: 'tail-less cascade-guard: 3-branch chain without final else returns cascade-guard',
      source: `
export function handle(x: number): string {
  if (x < 0) {
    return 'neg';
  } else if (x === 0) {
    return 'zero';
  } else if (x > 100) {
    return 'big';
  }
  return 'normal';
}
`,
      expected: { kind: 'cascade-guard', metrics: { depthReduction: 1, statementsAffected: 3 } },
    },
    {
      label: 'tail-less cascade-guard: 2-branch chain without final else returns cascade-guard',
      source: `
export function validate(x: string): string {
  if (x === '') {
    return 'empty';
  } else if (x.length > 100) {
    return 'too-long';
  }
  return x;
}
`,
      expected: { kind: 'cascade-guard', score: 2, metrics: { depthReduction: 1, statementsAffected: 2 } },
    },
    {
      label: 'tail-less cascade-guard: throw-ending branches returns cascade-guard',
      source: `
export function validate(x: number): number {
  if (x < 0) {
    throw new Error('negative');
  } else if (x > 100) {
    throw new Error('too big');
  }
  return x;
}
`,
      expected: { kind: 'cascade-guard', metrics: { depthReduction: 1, statementsAffected: 2 } },
    },
    {
      label: 'tail-less cascade-guard: loop context with continue returns cascade-guard',
      source: `
export function processItems(items: Array<{ type: string; value: string }>) {
  for (const item of items) {
    if (item.type === 'skip') {
      continue;
    } else if (item.type === 'done') {
      break;
    }
    process(item);
  }
}
`,
      expected: { kind: 'cascade-guard', metrics: { depthReduction: 1 } },
    },
    {
      label: 'wrapping-if + cascade-guard coexist with summed score',
      source: `
export function f(x: boolean, y: number): string {
  if (x) {
    doSetup();
    if (y < 0) {
      return 'neg';
    } else if (y === 0) {
      return 'zero';
    } else {
      doA();
      doB();
      doC();
    }
  }
}
`,
      expected: { score: 8, metrics: { depthReduction: 3, statementsAffected: 5 } },
    },
  ];

  it.each(detectionCases)('should detect early-return when $label', expectDetection);

  it('analyzeEarlyReturn - invertible-if-else: loop continue + long side - exposes opportunity spans', () => {
    // Arrange
    const files = parse(`
export function filterItems(items: string[]) {
  for (const item of items) {
    if (item.length === 0) {
      continue;
    } else {
      const a = item.trim();
      const b = a.toUpperCase();
      const c = b.replace(/x/g, '');
      console.log(c);
      process(c);
      doMore(c);
    }
  }
}
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('invertible-if-else');
    expect(result[0]?.opportunitySpans).toBeDefined();
    expect(result[0]?.opportunitySpans?.length).toBeGreaterThan(0);
  });

  it('analyzeEarlyReturn - maxDepth is tracked', () => {
    // Arrange
    const files = parse(`
export function deep(x: boolean, y: boolean) {
  if (x) {
    if (y) {
      doA();
      doB();
      doC();
    }
  }
}
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]?.metrics.maxDepth).toBeGreaterThanOrEqual(2);
  });

  it('analyzeEarlyReturn - wrapping-if + tail-less cascade-guard coexist with summed score', () => {
    // Arrange — outer wrapping-if (3 stmts) + inner tail-less cascade-guard (2-branch, no final else)
    const files = parse(`
export function f(x: boolean, y: number): string {
  if (x) {
    if (y < 0) {
      return 'neg';
    } else if (y === 0) {
      return 'zero';
    }
    doA();
    return 'ok';
  }
}
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert — wrapping-if detects the outer if (3 stmts inside: tail-less-chain + doA + return)
    //          tail-less cascade-guard (depthReduction=1, statementsAffected=2, score=2)
    expect(result).toHaveLength(1);
    expect(result[0]?.score).toBeGreaterThanOrEqual(4);
    expect(result[0]?.metrics.depthReduction).toBeGreaterThanOrEqual(2);
  });
});
