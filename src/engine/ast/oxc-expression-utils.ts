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

export { evalStaticTruthiness, unwrapExpression };
