import type { Node } from 'oxc-parser';

import type { NodeValue } from '../types';

import { isOxcNode } from './oxc-ast-utils';

const unwrapExpression = (node: NodeValue): Node | null => {
  let current = isOxcNode(node) ? node : null;

  while (current !== null) {
    const nodeType = current.type;

    if (nodeType === 'ParenthesizedExpression') {
      const expression = current.expression;

      current = isOxcNode(expression) ? expression : null;

      continue;
    }

    if (nodeType === 'ChainExpression') {
      const expression = current.expression;

      current = isOxcNode(expression) ? expression : null;

      continue;
    }

    break;
  }

  return current;
};

const evalStaticTruthiness = (node: NodeValue): boolean | null => {
  const unwrapped = unwrapExpression(node);

  if (unwrapped === null) {
    return null;
  }

  if (unwrapped.type === 'Literal') {
    const value = unwrapped.value;

    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'number') {
      return value !== 0;
    }

    if (typeof value === 'bigint') {
      return value !== 0n;
    }

    if (typeof value === 'string') {
      return value.length > 0;
    }

    if (value === null) {
      return false;
    }

    return null;
  }

  if (unwrapped.type === 'UnaryExpression') {
    const operator = typeof unwrapped.operator === 'string' ? unwrapped.operator : '';
    const argument = unwrapped.argument;

    if (operator === 'void') {
      return false;
    }

    if (operator === '!') {
      const inner = evalStaticTruthiness(argument);

      return inner === null ? null : !inner;
    }
  }

  return null;
};

/**
 * Returns the primitive literal value of a node if it can be determined statically,
 * or null if the value is dynamic or unknown. Unwraps parenthesized expressions.
 */
const evalStaticLiteralValue = (node: NodeValue): string | number | boolean | bigint | null | undefined => {
  const unwrapped = unwrapExpression(node);

  if (unwrapped === null) {
    return undefined;
  }

  if (unwrapped.type === 'Literal') {
    const value = unwrapped.value;

    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      return value;
    }
  }

  return undefined;
};

/**
 * Returns true if the expression is statically known to be null/undefined (nullish),
 * false if it is statically known to be non-nullish, or null if unknown.
 * This is distinct from truthiness: `false` is falsy but non-nullish.
 */
const evalStaticNullish = (node: NodeValue): boolean | null => {
  const unwrapped = unwrapExpression(node);

  if (unwrapped === null) {
    return null;
  }

  // `null` literal
  if (unwrapped.type === 'Literal') {
    const value = unwrapped.value;

    if (value === null) {
      return true;
    }

    // All other literals (number, string, boolean, bigint) are non-nullish
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'bigint') {
      return false;
    }

    return null;
  }

  // `void <expr>` → undefined → nullish
  if (unwrapped.type === 'UnaryExpression') {
    const operator = typeof unwrapped.operator === 'string' ? unwrapped.operator : '';

    if (operator === 'void') {
      return true;
    }
  }

  // Object/array/function expressions are always non-nullish
  if (
    unwrapped.type === 'ObjectExpression' ||
    unwrapped.type === 'ArrayExpression' ||
    unwrapped.type === 'ArrowFunctionExpression' ||
    unwrapped.type === 'FunctionExpression'
  ) {
    return false;
  }

  return null;
};

export { evalStaticLiteralValue, evalStaticNullish, evalStaticTruthiness, unwrapExpression };
