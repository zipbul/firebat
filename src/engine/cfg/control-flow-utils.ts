import type { Function as OxcFunction, Node } from 'oxc-parser';

import { isFunctionNode } from '../ast';

const resolveFunctionBody = (functionNode: Node): Node | null => {
  if (!isFunctionNode(functionNode)) {
    return null;
  }

  const body = (functionNode as OxcFunction).body;

  if (body === null || body === undefined) {
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
