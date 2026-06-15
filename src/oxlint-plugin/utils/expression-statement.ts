import type { AstNode, NodeOrNull } from '../types';

/**
 * Runs `predicate` against the inner expression of an `ExpressionStatement`.
 * Returns `false` for any node that is not an `ExpressionStatement` carrying an
 * expression. This is the shared skeleton of the `isXExpressionStatement` guards.
 */
const matchExpressionStatement = (node: NodeOrNull, predicate: (expr: AstNode) => boolean): boolean => {
  if (node?.type !== 'ExpressionStatement') {
    return false;
  }

  const expr = node.expression;

  if (!expr) {
    return false;
  }

  return predicate(expr);
};

export { matchExpressionStatement };
