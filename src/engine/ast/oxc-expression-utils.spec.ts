import { describe, it, expect } from 'bun:test';

import { evalStaticLiteralValue, evalStaticNullish, evalStaticTruthiness, unwrapExpression } from './oxc-expression-utils';
import { parseSource } from './parse-source';

/** Parse `expr;` and return the expression node of the ExpressionStatement */
const exprOf = (src: string) => {
  const program = parseSource('test.ts', `(${src});`).program;

  return (((program as { body: unknown[] }).body[0] as { expression?: unknown }).expression ?? null) as Parameters<
    typeof unwrapExpression
  >[0];
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
    const stmt = (program as { body: unknown[] }).body[0] as {
      expression: unknown;
    };
    const node = stmt.expression as Parameters<typeof unwrapExpression>[0];
    const result = unwrapExpression(node);

    expect((result as { type: string }).type).toBe('Identifier');
  });

  it('[ED] returns null for non-OXC input (null)', () => {
    expect(unwrapExpression(null as never)).toBeNull();
  });

  it('[ED] returns null for undefined input', () => {
    expect(unwrapExpression(undefined)).toBeNull();
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

describe('evalStaticNullish', () => {
  it('[HP] returns true for null literal', () => {
    expect(evalStaticNullish(exprOf('null'))).toBe(true);
  });

  it('[HP] returns true for void 0 (void operator → undefined)', () => {
    expect(evalStaticNullish(exprOf('void 0'))).toBe(true);
  });

  it('[HP] returns false for number literal 0 (falsy but non-nullish)', () => {
    expect(evalStaticNullish(exprOf('0'))).toBe(false);
  });

  it('[HP] returns false for empty string literal', () => {
    expect(evalStaticNullish(exprOf('""'))).toBe(false);
  });

  it('[HP] returns false for boolean false literal', () => {
    expect(evalStaticNullish(exprOf('false'))).toBe(false);
  });

  it('[HP] returns false for numeric literal', () => {
    expect(evalStaticNullish(exprOf('42'))).toBe(false);
  });

  it('[HP] returns false for non-empty string literal', () => {
    expect(evalStaticNullish(exprOf('"hello"'))).toBe(false);
  });

  it('[HP] returns false for boolean true literal', () => {
    expect(evalStaticNullish(exprOf('true'))).toBe(false);
  });

  it('[NE] returns null for identifier (uncertain)', () => {
    expect(evalStaticNullish(exprOf('x'))).toBeNull();
  });
});

describe('evalStaticLiteralValue', () => {
  it('[HP] returns the number value for a numeric literal', () => {
    expect(evalStaticLiteralValue(exprOf('42'))).toBe(42);
  });

  it('[HP] returns the string value for a string literal', () => {
    expect(evalStaticLiteralValue(exprOf('"hello"'))).toBe('hello');
  });

  it('[HP] returns true for boolean literal true', () => {
    expect(evalStaticLiteralValue(exprOf('true'))).toBe(true);
  });

  it('[HP] returns false for boolean literal false', () => {
    expect(evalStaticLiteralValue(exprOf('false'))).toBe(false);
  });

  it('[HP] returns null for null literal', () => {
    expect(evalStaticLiteralValue(exprOf('null'))).toBeNull();
  });

  it('[HP] returns 0 for numeric literal 0', () => {
    expect(evalStaticLiteralValue(exprOf('0'))).toBe(0);
  });

  it('[NE] returns undefined for a non-literal node (identifier)', () => {
    expect(evalStaticLiteralValue(exprOf('x'))).toBeUndefined();
  });

  it('[NE] returns undefined for a non-literal node (binary expression)', () => {
    expect(evalStaticLiteralValue(exprOf('1 + 2'))).toBeUndefined();
  });
});
