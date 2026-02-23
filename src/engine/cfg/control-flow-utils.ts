import type { Node } from 'oxc-parser';

import type { NodeValue } from '../types';

import { isFunctionNode, isNodeRecord } from '../ast/oxc-ast-utils';

const resolveFunctionBody = (functionNode: Node): NodeValue | null => {
  if (!isFunctionNode(functionNode)) {
    return null;
  }

  if (!isNodeRecord(functionNode)) {
    return null;
  }

  const bodyValue = functionNode.body as NodeValue | undefined;

  if (bodyValue === null || bodyValue === undefined) {
    return null;
  }

  return bodyValue;
};

const shouldIncreaseDepth = (nodeType: string): boolean => {
  return (
    nodeType === 'IfStatement' ||
    nodeType === 'ForStatement' ||
    nodeType === 'ForInStatement' ||
    nodeType === 'ForOfStatement' ||
    nodeType === 'WhileStatement' ||
    nodeType === 'DoWhileStatement' ||
    nodeType === 'SwitchStatement' ||
    nodeType === 'TryStatement' ||
    nodeType === 'CatchClause' ||
    nodeType === 'WithStatement'
  );
};

export { resolveFunctionBody, shouldIncreaseDepth };
