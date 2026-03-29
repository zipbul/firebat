import { describe, expect, it } from 'bun:test';

import { parseSource } from '../../engine/ast/parse-source';
import {
  analyzeEarlyReturn,
  countConsecutiveTrailingIfs,
  countStatements,
  endsWithReturnOrThrow,
  isExitBlock,
  isExitStatement,
  isLoopGuardBlock,
} from './analyzer';

const node = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra });

describe('early-return/analyzer helpers', () => {
  describe('isExitStatement', () => {
    it('should return false when node is not return-or-throw', () => {
      // Arrange
      const value = node('ExpressionStatement');
      // Act
      const result = isExitStatement(value as any);

      // Assert
      expect(result).toBe(false);
    });

    it('should return true when node is ReturnStatement', () => {
      // Arrange
      const value = node('ReturnStatement');
      // Act
      const result = isExitStatement(value as any);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true when node is ThrowStatement', () => {
      // Arrange
      const value = node('ThrowStatement');
      // Act
      const result = isExitStatement(value as any);

      // Assert
      expect(result).toBe(true);
    });
  });

  describe('isExitBlock', () => {
    it('should return true when value is ReturnStatement', () => {
      // Arrange
      const value = node('ReturnStatement');
      // Act
      const result = isExitBlock(value as any);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true when value is ThrowStatement', () => {
      // Arrange
      const value = node('ThrowStatement');
      // Act
      const result = isExitBlock(value as any);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when value is not a block or exit statement', () => {
      // Arrange
      const value = node('ExpressionStatement');
      // Act
      const result = isExitBlock(value as any);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when block body is empty', () => {
      // Arrange
      const emptyBlock = node('BlockStatement', { body: [] });
      // Act
      const result = isExitBlock(emptyBlock as any);

      // Assert
      expect(result).toBe(false);
    });

    it('should return true when multi-statement block ends with return', () => {
      // Arrange
      const multiBlock = node('BlockStatement', { body: [node('ExpressionStatement'), node('ReturnStatement')] });
      // Act
      const result = isExitBlock(multiBlock as any);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when block body ends with non-exit statement', () => {
      // Arrange
      const nonExitBlock = node('BlockStatement', { body: [node('ExpressionStatement')] });
      // Act
      const result = isExitBlock(nonExitBlock as any);

      // Assert
      expect(result).toBe(false);
    });

    it('should return true when block body contains only ReturnStatement', () => {
      // Arrange
      const value = node('BlockStatement', { body: [node('ReturnStatement')] });
      // Act
      const result = isExitBlock(value as any);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true when block body contains only ThrowStatement', () => {
      // Arrange
      const value = node('BlockStatement', { body: [node('ThrowStatement')] });
      // Act
      const result = isExitBlock(value as any);

      // Assert
      expect(result).toBe(true);
    });
  });

  describe('isLoopGuardBlock', () => {
    it('should return true when value is ContinueStatement', () => {
      // Arrange
      const value = node('ContinueStatement');
      // Act
      const result = isLoopGuardBlock(value as any);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true when value is BreakStatement', () => {
      // Arrange
      const value = node('BreakStatement');
      // Act
      const result = isLoopGuardBlock(value as any);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true when value is ReturnStatement', () => {
      // Arrange
      const value = node('ReturnStatement');
      // Act
      const result = isLoopGuardBlock(value as any);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true when value is ThrowStatement', () => {
      // Arrange
      const value = node('ThrowStatement');
      // Act
      const result = isLoopGuardBlock(value as any);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when block body is empty', () => {
      // Arrange
      const emptyBlock = node('BlockStatement', { body: [] });
      // Act
      const result = isLoopGuardBlock(emptyBlock as any);

      // Assert
      expect(result).toBe(false);
    });

    it('should return true when multi-statement block ends with continue', () => {
      // Arrange
      const multiBlock = node('BlockStatement', { body: [node('ExpressionStatement'), node('ContinueStatement')] });
      // Act
      const result = isLoopGuardBlock(multiBlock as any);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true when multi-statement block ends with return', () => {
      // Arrange
      const multiBlock = node('BlockStatement', { body: [node('ExpressionStatement'), node('ReturnStatement')] });
      // Act
      const result = isLoopGuardBlock(multiBlock as any);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when block body ends with non-guard statement', () => {
      // Arrange
      const nonBreakBlock = node('BlockStatement', { body: [node('ExpressionStatement')] });
      // Act
      const result = isLoopGuardBlock(nonBreakBlock as any);

      // Assert
      expect(result).toBe(false);
    });

    it('should return true when block body contains only ContinueStatement', () => {
      // Arrange
      const value = node('BlockStatement', { body: [node('ContinueStatement')] });
      // Act
      const result = isLoopGuardBlock(value as any);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true when block body contains only BreakStatement', () => {
      // Arrange
      const value = node('BlockStatement', { body: [node('BreakStatement')] });
      // Act
      const result = isLoopGuardBlock(value as any);

      // Assert
      expect(result).toBe(true);
    });
  });

  describe('countConsecutiveTrailingIfs', () => {
    it('should return 0 when array is empty', () => {
      // Arrange
      const stmts: any[] = [];
      // Act
      const result = countConsecutiveTrailingIfs(stmts);

      // Assert
      expect(result).toBe(0);
    });

    it('should return 1 when last stmt is IfStatement (no alternate) preceded by non-if', () => {
      // Arrange
      const stmts = [node('ExpressionStatement'), node('IfStatement')] as any[];
      // Act
      const result = countConsecutiveTrailingIfs(stmts);

      // Assert
      expect(result).toBe(1);
    });

    it('should return 2 when last 2 stmts are IfStatement (no alternate) preceded by non-if', () => {
      // Arrange
      const stmts = [node('ExpressionStatement'), node('IfStatement'), node('IfStatement')] as any[];
      // Act
      const result = countConsecutiveTrailingIfs(stmts);

      // Assert
      expect(result).toBe(2);
    });

    it('should return 3 when all 3 stmts are IfStatement (no alternate)', () => {
      // Arrange
      const stmts = [node('IfStatement'), node('IfStatement'), node('IfStatement')] as any[];
      // Act
      const result = countConsecutiveTrailingIfs(stmts);

      // Assert
      expect(result).toBe(3);
    });

    it('should return 1 when IfStatements are non-consecutive (interrupted by ExprStmt)', () => {
      // Arrange
      const stmts = [node('IfStatement'), node('ExpressionStatement'), node('IfStatement')] as any[];
      // Act
      const result = countConsecutiveTrailingIfs(stmts);

      // Assert
      expect(result).toBe(1);
    });

    it('should skip a trailing ReturnStatement and count preceding IfStatements', () => {
      // Arrange
      const stmts = [node('IfStatement'), node('IfStatement'), node('ReturnStatement')] as any[];
      // Act
      const result = countConsecutiveTrailingIfs(stmts);

      // Assert
      expect(result).toBe(2);
    });

    it('should not count IfStatement with alternate', () => {
      // Arrange — if-else followed by bare if
      const stmts = [node('IfStatement', { alternate: node('BlockStatement', { body: [] }) }), node('IfStatement')] as any[];
      // Act
      const result = countConsecutiveTrailingIfs(stmts);

      // Assert — only the last if (no alternate) is counted, then the if-else breaks the chain
      expect(result).toBe(1);
    });
  });

  describe('countStatements', () => {
    it('should return 1 when node is not a block statement', () => {
      // Arrange
      const value = node('ReturnStatement');
      // Act
      const result = countStatements(value as any);

      // Assert
      expect(result).toBe(1);
    });

    it('should return 0 when block body is missing or not an array', () => {
      // Arrange
      const missingBody = node('BlockStatement');
      const nonArrayBody = node('BlockStatement', { body: node('ReturnStatement') });
      // Act
      const missingResult = countStatements(missingBody as any);
      const nonArrayResult = countStatements(nonArrayBody as any);

      // Assert
      expect(missingResult).toBe(0);
      expect(nonArrayResult).toBe(0);
    });

    it('should return body length when node is a block statement with array body', () => {
      // Arrange
      const value = node('BlockStatement', { body: [node('ExpressionStatement'), node('ReturnStatement')] });
      // Act
      const result = countStatements(value as any);

      // Assert
      expect(result).toBe(2);
    });

    it('should count else-if chain without adding +1 per IfStatement branch', () => {
      // Arrange: if { 2 stmts } else if { 1 stmt } else { 3 stmts }
      const elseIfNode = node('IfStatement', {
        consequent: node('BlockStatement', { body: [node('ExpressionStatement'), node('ReturnStatement')] }),
        alternate: node('IfStatement', {
          consequent: node('BlockStatement', { body: [node('ReturnStatement')] }),
          alternate: node('BlockStatement', {
            body: [node('ExpressionStatement'), node('ExpressionStatement'), node('ReturnStatement')],
          }),
        }),
      });
      // Act
      const result = countStatements(elseIfNode as any);

      // Assert — should be 2 + 1 + 3 = 6 (no +1 per IfStatement branch)
      expect(result).toBe(6);
    });
  });

  describe('endsWithReturnOrThrow', () => {
    it('should return false when node is not an oxc node', () => {
      // Arrange
      const value = 123;
      // Act
      const result = endsWithReturnOrThrow(value as any);

      // Assert
      expect(result).toBe(false);
    });

    it('should return true when node is ReturnStatement', () => {
      // Arrange
      const value = node('ReturnStatement');
      // Act
      const result = endsWithReturnOrThrow(value as any);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true when node is ThrowStatement', () => {
      // Arrange
      const value = node('ThrowStatement');
      // Act
      const result = endsWithReturnOrThrow(value as any);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when node is not a block statement or exit statement', () => {
      // Arrange
      const value = node('ExpressionStatement');
      // Act
      const result = endsWithReturnOrThrow(value as any);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when block body is empty or invalid', () => {
      // Arrange
      const empty = node('BlockStatement', { body: [] });
      const missing = node('BlockStatement');
      const invalidLast = node('BlockStatement', { body: [node('ExpressionStatement'), 'not-a-node'] });
      // Act
      const emptyResult = endsWithReturnOrThrow(empty as any);
      const missingResult = endsWithReturnOrThrow(missing as any);
      const invalidLastResult = endsWithReturnOrThrow(invalidLast as any);

      // Assert
      expect(emptyResult).toBe(false);
      expect(missingResult).toBe(false);
      expect(invalidLastResult).toBe(false);
    });

    it('should return true when block ends with ReturnStatement', () => {
      // Arrange
      const value = node('BlockStatement', { body: [node('ExpressionStatement'), node('ReturnStatement')] });
      // Act
      const result = endsWithReturnOrThrow(value as any);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true when block ends with ThrowStatement', () => {
      // Arrange
      const value = node('BlockStatement', { body: [node('ExpressionStatement'), node('ThrowStatement')] });
      // Act
      const result = endsWithReturnOrThrow(value as any);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when block ends with non-exit statement even if earlier exit exists', () => {
      // Arrange
      const value = node('BlockStatement', { body: [node('ReturnStatement'), node('ExpressionStatement')] });
      // Act
      const result = endsWithReturnOrThrow(value as any);

      // Assert
      expect(result).toBe(false);
    });
  });
});

describe('analyzeEarlyReturn', () => {
  const parse = (source: string) => [parseSource('/virtual/test.ts', source)];

  it('analyzeEarlyReturn - empty function - returns no findings', () => {
    // Arrange
    const files = parse('export function empty() {}');
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert
    expect(result).toEqual([]);
  });

  it('analyzeEarlyReturn - wrapping-if: function body wrapping (5 stmts) - returns wrapping-if with score 5', () => {
    // Arrange
    const files = parse(`
export function process(data: unknown) {
  if (isValid(data)) {
    doA();
    doB();
    doC();
    doD();
    doE();
  }
}
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('wrapping-if');
    expect(result[0]?.score).toBe(5);
    expect(result[0]?.metrics.depthReduction).toBe(1);
    expect(result[0]?.metrics.statementsAffected).toBe(5);
  });

  it('analyzeEarlyReturn - wrapping-if: tail-if (last stmt with preceding code, 4 stmts) - returns wrapping-if with score 4', () => {
    // Arrange
    const files = parse(`
export function process(data: unknown) {
  const x = prepare(data);
  if (x > 0) {
    doA();
    doB();
    doC();
    doD();
  }
}
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('wrapping-if');
    expect(result[0]?.score).toBe(4);
  });

  it('analyzeEarlyReturn - wrapping-if: loop body wrapping (6 stmts) - returns wrapping-if with score 6', () => {
    // Arrange
    const files = parse(`
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
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('wrapping-if');
    expect(result[0]?.score).toBe(6);
    expect(result[0]?.metrics.depthReduction).toBe(1);
    expect(result[0]?.metrics.statementsAffected).toBe(6);
  });

  it('analyzeEarlyReturn - invertible-if-else: short 1 stmt + long 6 stmts - returns invertible-if-else with score 6', () => {
    // Arrange
    const files = parse(`
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
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('invertible-if-else');
    expect(result[0]?.score).toBe(6);
    expect(result[0]?.metrics.depthReduction).toBe(1);
    expect(result[0]?.metrics.statementsAffected).toBe(6);
  });

  it('analyzeEarlyReturn - invertible-if-else: loop continue + long side - returns invertible-if-else', () => {
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

  it('analyzeEarlyReturn - cascade-guard: 3-branch chain, final 4 stmts - returns cascade-guard with score 12', () => {
    // Arrange
    const files = parse(`
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
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('cascade-guard');
    expect(result[0]?.score).toBe(12);
    expect(result[0]?.metrics.depthReduction).toBe(3);
    expect(result[0]?.metrics.statementsAffected).toBe(4);
  });

  it('analyzeEarlyReturn - cascade-guard: loop continue chain (2-branch, final 5 stmts) - returns cascade-guard with score 10', () => {
    // Arrange
    const files = parse(`
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
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('cascade-guard');
    expect(result[0]?.score).toBe(10);
    expect(result[0]?.metrics.depthReduction).toBe(2);
    expect(result[0]?.metrics.statementsAffected).toBe(5);
  });

  it('analyzeEarlyReturn - wrapping-if + invertible coexist - reports higher impact kind with summed score', () => {
    // Arrange: wrapping-if (3 stmts) + invertible (4 stmts)
    const files = parse(`
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
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert
    expect(result).toHaveLength(1);
    // invertible contributes 1×4=4, wrapping-if contributes 1×3=3
    // primary kind is invertible-if-else (higher impact)
    expect(result[0]?.kind).toBe('invertible-if-else');
    expect(result[0]?.score).toBe(7);
  });

  it('analyzeEarlyReturn - score < 2 returns null (1-stmt wrapping-if)', () => {
    // Arrange — wrapping-if with only 1 statement → score=1 → filtered
    const files = parse(`
export function tiny(x: boolean) {
  if (x) {
    doA();
  }
}
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert
    expect(result).toEqual([]);
  });

  it('analyzeEarlyReturn - nested function returns are isolated', () => {
    // Arrange
    const files = parse(`
export function outer() {
  const inner = () => { return 1; };
  return inner();
}
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert
    // outer has no opportunities, inner has no opportunities → both null
    expect(result).toEqual([]);
  });

  it('analyzeEarlyReturn - class method wrapping-if - detects pattern', () => {
    // Arrange
    const files = parse(`
export class Handler {
  handle(data: unknown) {
    if (data !== null) {
      doA(data);
      doB(data);
      doC(data);
    }
  }
}
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('wrapping-if');
    expect(result[0]?.score).toBe(3);
  });

  it('analyzeEarlyReturn - async function - detects pattern normally', () => {
    // Arrange
    const files = parse(`
export async function fetchAll(urls: string[]) {
  for (const url of urls) {
    if (url.startsWith('http')) {
      const res = await fetch(url);
      const text = await res.text();
      console.log(text);
    }
  }
}
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('wrapping-if');
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

  it('analyzeEarlyReturn - empty files array - returns empty', () => {
    // Arrange & Act
    const result = analyzeEarlyReturn([]);

    // Assert
    expect(result).toEqual([]);
  });

  it('analyzeEarlyReturn - cascade-guard middle branch without exit - returns null for cascade', () => {
    // Arrange — middle branch (if(b)) has no exit, cascade-guard should fail
    const files = parse(`
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
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert — cascade-guard should not detect (middle branch has no exit)
    // invertible-if-else should also not detect (alternate is IfStatement, else-if chain skipped)
    expect(result).toEqual([]);
  });

  it('analyzeEarlyReturn - invertible-if-else where else branch is the short side', () => {
    // Arrange — else is the short side (1 stmt), consequent is the long side (6 stmts)
    const files = parse(`
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
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('invertible-if-else');
    expect(result[0]?.metrics.statementsAffected).toBe(6);
  });

  it('analyzeEarlyReturn - invertible-if-else in loop with break exit', () => {
    // Arrange — short side ends with break, insideLoop=true
    const files = parse(`
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
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('invertible-if-else');
  });

  it('analyzeEarlyReturn - else-if chain alternate skipped for invertible (no false positive)', () => {
    // Arrange — cascade fails (if(b) consequent has no exit), alternate is IfStatement → skip invertible
    const files = parse(`
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
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert — should NOT detect invertible-if-else (alternate is else-if chain)
    expect(result).toEqual([]);
  });

  it('analyzeEarlyReturn - score exactly 2 passes threshold', () => {
    // Arrange — wrapping-if with exactly 2 statements → score=1×2=2
    const files = parse(`
export function f(x: boolean) {
  if (x) {
    doA();
    doB();
  }
}
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert — score=2 passes threshold (>= 2)
    expect(result).toHaveLength(1);
    expect(result[0]?.score).toBe(2);
  });

  it('analyzeEarlyReturn - implicit-else: function body if(exit) + 1 stmt remaining - returns implicit-else', () => {
    // Arrange
    const files = parse(`
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
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('implicit-else');
    expect(result[0]?.metrics.statementsAffected).toBe(6);
    expect(result[0]?.metrics.depthReduction).toBe(1);
  });

  it('analyzeEarlyReturn - implicit-else: loop body if(continue) + 1 stmt remaining - returns implicit-else', () => {
    // Arrange
    const files = parse(`
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
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('implicit-else');
    expect(result[0]?.metrics.statementsAffected).toBe(5);
  });

  it('analyzeEarlyReturn - implicit-else: remaining 2 stmts (short side) + consequent 6 stmts (long side) - returns implicit-else', () => {
    // Arrange
    const files = parse(`
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
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('implicit-else');
    expect(result[0]?.metrics.statementsAffected).toBe(6);
  });

  it('analyzeEarlyReturn - implicit-else: ratio not met (4 < 3*2) - returns no findings', () => {
    // Arrange — consequent: 4 stmts, remaining: 3 stmts → 4 < 3*2=6
    const files = parse(`
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
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert
    expect(result).toEqual([]);
  });

  it('analyzeEarlyReturn - implicit-else: remaining > 3 stmts - returns no findings', () => {
    // Arrange — remaining: 4 stmts (exceeds limit of 3)
    const files = parse(`
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
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert
    expect(result).toEqual([]);
  });

  it('analyzeEarlyReturn - implicit-else: consequent has no exit - returns no findings', () => {
    // Arrange — consequent does NOT end with return/throw, and if is not the last stmt → no pattern
    const files = parse(`
export function f(x: boolean) {
  if (x) {
    doA();
    doB();
    doC();
    doD();
  }
  return null;
}
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert — consequent has no exit → implicit-else skipped; if is not last stmt → wrapping-if skipped
    expect(result).toEqual([]);
  });

  it('analyzeEarlyReturn - implicit-else: has else branch - returns no findings for implicit-else', () => {
    // Arrange — has explicit else → invertible-if-else territory
    const files = parse(`
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
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert — should be invertible-if-else, not implicit-else
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('invertible-if-else');
  });

  it('analyzeEarlyReturn - implicit-else: function remaining without exit - returns no findings', () => {
    // Arrange — in function context, remaining doesn't end with return/throw
    const files = parse(`
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
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert — remaining (logError()) doesn't end with exit → not detected
    expect(result).toEqual([]);
  });

  // ── tail-less cascade-guard ─────────────────────────────────────────

  it('analyzeEarlyReturn - tail-less cascade-guard: 3-branch chain without final else - returns cascade-guard', () => {
    // Arrange — all branches end with return, no final else
    const files = parse(`
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
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('cascade-guard');
    expect(result[0]?.metrics.depthReduction).toBe(1);
    expect(result[0]?.metrics.statementsAffected).toBe(3);
  });

  it('analyzeEarlyReturn - tail-less cascade-guard: 2-branch chain without final else - returns cascade-guard', () => {
    // Arrange
    const files = parse(`
export function validate(x: string): string {
  if (x === '') {
    return 'empty';
  } else if (x.length > 100) {
    return 'too-long';
  }
  return x;
}
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('cascade-guard');
    expect(result[0]?.metrics.depthReduction).toBe(1);
    expect(result[0]?.metrics.statementsAffected).toBe(2);
    expect(result[0]?.score).toBe(2); // 1 * 2 = 2, passes threshold (>= 2)
  });

  it('analyzeEarlyReturn - tail-less cascade-guard: throw-ending branches - returns cascade-guard', () => {
    // Arrange — all branches end with throw, no final else
    const files = parse(`
export function validate(x: number): number {
  if (x < 0) {
    throw new Error('negative');
  } else if (x > 100) {
    throw new Error('too big');
  }
  return x;
}
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('cascade-guard');
    expect(result[0]?.metrics.depthReduction).toBe(1);
    expect(result[0]?.metrics.statementsAffected).toBe(2);
  });

  it('analyzeEarlyReturn - tail-less cascade-guard: middle branch without exit - NOT detected', () => {
    // Arrange — middle branch (if(b)) has no exit in tail-less chain
    const files = parse(`
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
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert — while loop breaks at if(b) because isGuard=false
    expect(result).toEqual([]);
  });

  it('analyzeEarlyReturn - tail-less cascade-guard: loop context with continue - returns cascade-guard', () => {
    // Arrange
    const files = parse(`
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
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('cascade-guard');
    expect(result[0]?.metrics.depthReduction).toBe(1);
  });

  it('analyzeEarlyReturn - wrapping-if + cascade-guard coexist with summed score', () => {
    // Arrange — outer wrapping-if (2 stmts) + inner cascade-guard (2-branch, final 3 stmts)
    const files = parse(`
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
`);
    // Act
    const result = analyzeEarlyReturn(files);

    // Assert — wrapping-if (1×2=2) + cascade-guard (2×3=6) = 8
    expect(result).toHaveLength(1);
    expect(result[0]?.score).toBe(8);
    expect(result[0]?.metrics.depthReduction).toBe(3);
    expect(result[0]?.metrics.statementsAffected).toBe(5);
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
