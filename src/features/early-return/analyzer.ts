import type { Node } from 'oxc-parser';

import type { NodeValue, ParsedFile } from '../../engine/types';
import type { EarlyReturnAnalysis, EarlyReturnItem } from '../../types';

import { resolveFunctionBody, shouldIncreaseDepth } from '../../engine/control-flow-utils';
import { collectFunctionItems } from '../../engine/function-items';
import { getFunctionSpan } from '../../engine/function-span';
import {
  getNodeHeader,
  isFunctionNode,
  isNodeRecord,
  isOxcNode,
  isOxcNodeArray,
  visitOxcChildren,
} from '../../engine/oxc-ast-utils';

const createEmptyEarlyReturn = (): EarlyReturnAnalysis => ({
  items: [],
});

const isReturnStatement = (value: NodeValue): boolean => {
  if (!isOxcNode(value)) {
    return false;
  }

  return value.type === 'ReturnStatement';
};

const isSingleReturnBlock = (value: NodeValue): boolean => {
  if (!isOxcNode(value)) {
    return false;
  }

  if (value.type === 'ReturnStatement') {
    return true;
  }

  if (value.type !== 'BlockStatement') {
    return false;
  }

  if (!isNodeRecord(value)) {
    return false;
  }

  const body = value.body;

  if (!Array.isArray(body) || body.length !== 1) {
    return false;
  }

  const onlyNode = body[0];

  return isReturnStatement(onlyNode as NodeValue);
};

const analyzeFunctionNode = (
  functionNode: Node,
  filePath: string,
  sourceText: string,
  parent: Node | null,
): EarlyReturnItem | null => {
  const bodyValue = resolveFunctionBody(functionNode);

  if (bodyValue === null || bodyValue === undefined) {
    return null;
  }

  let maxDepth = 0;
  let earlyReturnCount = 0;
  let hasGuardClauses = false;

  const visit = (value: NodeValue, depth: number): void => {
    if (isOxcNodeArray(value)) {
      for (const entry of value) {
        visit(entry, depth);
      }

      return;
    }

    if (!isOxcNode(value)) {
      return;
    }

    if (value !== functionNode && isFunctionNode(value)) {
      return;
    }

    const nodeType = value.type;
    const nextDepth = shouldIncreaseDepth(nodeType) ? depth + 1 : depth;

    if (nextDepth > maxDepth) {
      maxDepth = nextDepth;
    }

    if (nodeType === 'ReturnStatement') {
      earlyReturnCount += 1;
    }

    if (nodeType === 'IfStatement' && depth === 0 && isNodeRecord(value)) {
      const alternateValue = value.alternate;

      if (alternateValue === null || alternateValue === undefined) {
        const consequentValue = value.consequent;

        if (isSingleReturnBlock(consequentValue as NodeValue)) {
          hasGuardClauses = true;
        }
      }
    }

    if (!isNodeRecord(value)) {
      return;
    }

    visitOxcChildren(value, entry => {
      visit(entry, nextDepth);
    });
  };

  visit(bodyValue as NodeValue, 0);

  const header = getNodeHeader(functionNode, parent);
  const span = getFunctionSpan(functionNode, sourceText);
  const score = Math.max(0, earlyReturnCount + (hasGuardClauses ? 0 : 1));
  const suggestions: string[] = [];

  if (!hasGuardClauses && maxDepth >= 2) {
    suggestions.push('introduce early returns to flatten control flow');
  }

  if (earlyReturnCount >= 4) {
    suggestions.push('simplify branching to reduce early return count');
  }

  return {
    filePath,
    header,
    span,
    metrics: {
      earlyReturnCount,
      hasGuardClauses,
    },
    score,
    suggestions,
  };
};

const analyzeEarlyReturn = (files: ReadonlyArray<ParsedFile>): EarlyReturnAnalysis => {
  return {
    items: collectFunctionItems(files, analyzeFunctionNode).filter(item => item.suggestions.length > 0),
  };
};

export { analyzeEarlyReturn, createEmptyEarlyReturn };
