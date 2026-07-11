import type { Function as OxcFunction, Node } from 'oxc-parser';

import { isFunctionNode } from '../ast/oxc-ast-utils';

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

/**
 * BlockStatement면 본문 문장 수, 그 외 단일 문장은 1로 센다.
 * 중첩-감소 분석기들이 공유하는 "블록 문장 수 세기" 결정의 단일 변경지점.
 */
const countBlockStatements = (node: Node): number => {
  if (node.type !== 'BlockStatement') {
    return 1;
  }

  const body = node.body;

  return Array.isArray(body) ? body.length : 0;
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

export { countBlockStatements, resolveFunctionBody, shouldIncreaseDepth };
