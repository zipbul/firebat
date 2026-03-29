import type { Node } from 'oxc-parser';

import { isFunctionNode } from '../ast/oxc-ast-utils';

const resolveFunctionBody = (functionNode: Node): Node | null => {
  if (!isFunctionNode(functionNode)) {
    return null;
  }

  const body = (functionNode as unknown as Record<string, unknown>).body;

  if (body === null || body === undefined || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }

  return body as Node;
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
