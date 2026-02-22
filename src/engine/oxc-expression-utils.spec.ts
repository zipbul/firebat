import { describe, it, expect } from 'bun:test';

import { parseSource } from './parse-source';
import { evalStaticTruthiness, unwrapExpression } from './oxc-expression-utils';

/** Parse `expr;` and return the expression node of the ExpressionStatement */
const exprOf = (src: string) => {
  const program = parseSource('test.ts', `(${src});`).program;
  const stmt = ((program as { body: unknown[] }).body)[0] as {
    type: string;
    expression?: unknown;
  };
  return (stmt.expression ?? null) as Parameters<typeof unwrapExpression>[0];
};

describe('unwrapExpression', () => {
  it('[HP] returns the node itself for a plain Identifier', () => {
    const node = exprOf('x');
    const result = unwrapExpression(node);
    expect(result).not.toBeNull();
    expect((result as { type: string }).type).toBe('Identifier');
  });

  it('[HP] unwraps a single ParenthesizedExpression', () => {
    // (x) → Identifier
    const program = parseSource('test.ts', 'x;').program;
    const stmt = ((program as { body: unknown[] }).body)[0] as {
      expression: unknown;
    };
    const node = stmt.expression as Parameters<typeof unwrapExpression>[0];
    const result = unwrapExpression(node);
    expect((result as { type: string }).type).toBe('Identifier');
  });

  it('[ED] returns null for non-OXC input (null)', () => {
    expect(unwrapExpression(null as never)).toBeNull();
  });

  it('[ED] returns null for non-OXC input (number)', () => {
    expect(unwrapExpression(42 as never)).toBeNull();
  });
});

describe('evalStaticTruthiness', () => {
  it('[HP] returns true for boolean literal true', () => {
    expect(evalStaticTruthiness(exprOf('true'))).toBe(true);
  });

  it('[HP] returns false for boolean literal false', () => {
    expect(evalStaticTruthiness(exprOf('false'))).toBe(false);
  });

  it('[HP] returns false for number literal 0', () => {
    expect(evalStaticTruthiness(exprOf('0'))).toBe(false);
  });

  it('[HP] returns true for number literal 1', () => {
    expect(evalStaticTruthiness(exprOf('1'))).toBe(true);
  });

  it('[HP] returns true for non-empty string literal', () => {
    expect(evalStaticTruthiness(exprOf('"hello"'))).toBe(true);
  });

  it('[HP] returns false for empty string literal', () => {
    expect(evalStaticTruthiness(exprOf('""'))).toBe(false);
  });

  it('[HP] returns false for null literal', () => {
    expect(evalStaticTruthiness(exprOf('null'))).toBe(false);
  });

  it('[HP] returns false for void 0 (UnaryExpression void)', () => {
    expect(evalStaticTruthiness(exprOf('void 0'))).toBe(false);
  });

  it('[HP] returns false for !true (UnaryExpression !)', () => {
    expect(evalStaticTruthiness(exprOf('!true'))).toBe(false);
  });

  it('[HP] returns true for !false', () => {
    expect(evalStaticTruthiness(exprOf('!false'))).toBe(true);
  });

  it('[NE] returns null for identifier (non-static)', () => {
    expect(evalStaticTruthiness(exprOf('x'))).toBeNull();
  });

  it('[NE] returns null for non-OXC input', () => {
    expect(evalStaticTruthiness(null as never)).toBeNull();
  });
});
