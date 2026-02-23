import { describe, it, expect } from 'bun:test';

import { parseSource } from '../engine/ast/parse-source';
import { getNodeHeader } from './node-header';

const functionNodeOf = (src: string) => {
  const program = parseSource('test.ts', src).program;
  const body = (program as { body: unknown[] }).body;
  return body[0] as Parameters<typeof getNodeHeader>[0];
};

describe('getNodeHeader', () => {
  it('[HP] returns kind=node for all inputs', () => {
    const node = functionNodeOf('function f() {}');
    const result = getNodeHeader(node);
    expect(result.kind).toBe('node');
  });

  it('[HP] returns header string equal to function name', () => {
    const node = functionNodeOf('function myFunc() {}');
    const result = getNodeHeader(node);
    expect(result.header).toBe('myFunc');
  });

  it('[HP] returns anonymous when function has no name', () => {
    // ExpressionStatement node
    const program = parseSource('test.ts', '(function(){})();').program;
    // Get the inner function expression
    const stmt = ((program as { body: unknown[] }).body)[0] as {
      expression: { callee: unknown };
    };
    const fn = stmt.expression.callee as Parameters<typeof getNodeHeader>[0];
    const result = getNodeHeader(fn);
    expect(result.header).toBe('anonymous');
  });
});
