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

export const isExitStatement = (value: NodeValue): boolean => {
  if (!isOxcNode(value)) {
    return false;
  }

  return value.type === 'ReturnStatement' || value.type === 'ThrowStatement';
};

export const isSingleExitBlock = (value: NodeValue): boolean => {
  if (!isOxcNode(value)) {
    return false;
  }

  if (value.type === 'ReturnStatement' || value.type === 'ThrowStatement') {
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

  return isExitStatement(onlyNode as NodeValue);
};

export const isSingleContinueOrBreakBlock = (value: NodeValue): boolean => {
  if (!isOxcNode(value)) {
    return false;
  }

  if (value.type === 'ContinueStatement' || value.type === 'BreakStatement') {
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

  if (!isOxcNode(onlyNode)) {
    return false;
  }

  return onlyNode.type === 'ContinueStatement' || onlyNode.type === 'BreakStatement';
};

export const countStatements = (node: NodeValue): number => {
  if (!isOxcNode(node)) {
    return 0;
  }

  if (node.type !== 'BlockStatement') {
    return 1;
  }

  if (!isNodeRecord(node)) {
    return 0;
  }

  const body = node.body;

  return Array.isArray(body) ? body.length : 0;
};

export const endsWithReturnOrThrow = (node: NodeValue): boolean => {
  if (!isOxcNode(node)) {
    return false;
  }

  if (node.type === 'ReturnStatement' || node.type === 'ThrowStatement') {
    return true;
  }

  if (node.type !== 'BlockStatement') {
    return false;
  }

  if (!isNodeRecord(node)) {
    return false;
  }

  const body = node.body;

  if (!Array.isArray(body) || body.length === 0) {
    return false;
  }

  const last = body[body.length - 1];

  return isExitStatement(last as NodeValue);
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
  let guardClauseCount = 0;
  const suggestions: string[] = [];

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

        if (isSingleExitBlock(consequentValue as NodeValue)) {
          hasGuardClauses = true;
          guardClauseCount += 1;
        }
      } else {
        // P2-1: invertible-if-else
        const consequentValue = value.consequent as NodeValue;
        const alternateNode = alternateValue as NodeValue;
        const consequentCount = countStatements(consequentValue);
        const alternateCount = countStatements(alternateNode);

        if (consequentCount > 0 && alternateCount > 0) {
          const shortCount = consequentCount <= alternateCount ? consequentCount : alternateCount;
          const longCount = consequentCount <= alternateCount ? alternateCount : consequentCount;
          const shortNode = consequentCount <= alternateCount ? consequentValue : alternateNode;

          if (shortCount <= 3 && endsWithReturnOrThrow(shortNode) && longCount >= shortCount * 2) {
            suggestions.push(`invertible-if-else: consequent=${consequentCount}, alternate=${alternateCount}`);
          }
        }
      }
    }

    if (nodeType === 'IfStatement' && depth > 0 && isNodeRecord(value)) {
      const alternateValue = value.alternate;

      if (alternateValue === null || alternateValue === undefined) {
        const consequentValue = value.consequent;

        if (isSingleContinueOrBreakBlock(consequentValue as NodeValue)) {
          // P2-3: loop guard clause (continue/break)
          hasGuardClauses = true;
          guardClauseCount += 1;
          suggestions.push('loop-guard-clause');
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
      guardClauseCount,
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
