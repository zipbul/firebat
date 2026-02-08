import type { Node } from 'oxc-parser';

import type { NodeValue, ParsedFile } from '../../engine/types';
import type { NestingAnalysis, NestingItem } from '../../types';

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

const createEmptyNesting = (): NestingAnalysis => ({
  items: [],
});

const isDecisionPoint = (nodeType: string): boolean => {
  return (
    nodeType === 'IfStatement' ||
    nodeType === 'ForStatement' ||
    nodeType === 'ForInStatement' ||
    nodeType === 'ForOfStatement' ||
    nodeType === 'WhileStatement' ||
    nodeType === 'DoWhileStatement' ||
    nodeType === 'SwitchStatement' ||
    nodeType === 'ConditionalExpression' ||
    nodeType === 'LogicalExpression' ||
    nodeType === 'CatchClause'
  );
};

const analyzeFunctionNode = (
  functionNode: Node,
  filePath: string,
  sourceText: string,
  parent: Node | null,
): NestingItem | null => {
  const bodyValue = resolveFunctionBody(functionNode);

  if (bodyValue === null || bodyValue === undefined) {
    return null;
  }

  let maxDepth = 0;
  let decisionPoints = 0;

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

    if (isDecisionPoint(nodeType)) {
      decisionPoints += 1;
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
  const nestingScore = Math.max(0, maxDepth * 3 + decisionPoints);
  const nestingSuggestions: string[] = [];

  if (maxDepth >= 3) {
    nestingSuggestions.push('consider guard clauses to reduce nesting');
  }

  if (decisionPoints >= 6) {
    nestingSuggestions.push('consider extracting smaller functions around decision points');
  }

  if (maxDepth >= 4) {
    nestingSuggestions.push('reduce nesting depth to improve readability');
  }

  return {
    filePath,
    header,
    span,
    metrics: {
      depth: maxDepth,
    },
    score: nestingScore,
    suggestions: nestingSuggestions,
  };
};

const analyzeNesting = (files: ReadonlyArray<ParsedFile>): NestingAnalysis => {
  if (files.length === 0) {
    return createEmptyNesting();
  }

  return {
    items: collectFunctionItems(files, analyzeFunctionNode).filter(item => item.suggestions.length > 0),
  };
};

export { analyzeNesting, createEmptyNesting };
