import { describe, it, expect } from 'bun:test';
import { firstBodyNode } from "../../../test/integration/shared/test-kit";

import { parseSource } from '../ast/parse-source';
import { resolveFunctionBody, shouldIncreaseDepth } from './control-flow-utils';

const functionNodeOf = (src: string) => firstBodyNode<Parameters<typeof resolveFunctionBody>[0]>(src);

describe('shouldIncreaseDepth', () => {
  const depthIncreasingTypes = [
    'IfStatement',
    'ForStatement',
    'ForInStatement',
    'ForOfStatement',
    'WhileStatement',
    'DoWhileStatement',
    'SwitchStatement',
    'TryStatement',
    'CatchClause',
    'WithStatement',
  ];

  for (const nodeType of depthIncreasingTypes) {
    it(`returns true for ${nodeType}`, () => {
      expect(shouldIncreaseDepth(nodeType)).toBe(true);
    });
  }

  it('returns false for non-nesting node types', () => {
    expect(shouldIncreaseDepth('BlockStatement')).toBe(false);
    expect(shouldIncreaseDepth('ExpressionStatement')).toBe(false);
    expect(shouldIncreaseDepth('ReturnStatement')).toBe(false);
  });
});

describe('resolveFunctionBody', () => {
  it('[HP] returns the body node for a function declaration', () => {
    const node = functionNodeOf('function f() { return 1; }');
    const body = resolveFunctionBody(node);

    expect(body).not.toBeNull();
    expect((body as { type: string }).type).toBe('BlockStatement');
  });

  it('[NE] returns null for a non-function node (VariableDeclaration)', () => {
    const program = parseSource('test.ts', 'const x = 1;').program;
    const stmt = (program as { body: unknown[] }).body[0] as Parameters<typeof resolveFunctionBody>[0];

    expect(resolveFunctionBody(stmt)).toBeNull();
  });
});
