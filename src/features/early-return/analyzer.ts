import type { Node } from 'oxc-parser';

import type { NodeValue, ParsedFile } from '../../engine/types';
import type { EarlyReturnItem, EarlyReturnKind } from '../../types';

import { resolveFunctionBody, shouldIncreaseDepth } from '../../engine/cfg/control-flow-utils';
import { collectFunctionItems } from '../../engine/function-items';
import { getFunctionSpan } from '../../engine/function-span';
import {
  getNodeHeader,
  isFunctionNode,
  isNodeRecord,
  isOxcNode,
  isOxcNodeArray,
  visitOxcChildren,
} from '../../engine/ast/oxc-ast-utils';

const createEmptyEarlyReturn = (): ReadonlyArray<EarlyReturnItem> => [];

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
    // For else-if chains: when alternate is an IfStatement, recursively
    // count all statements across the entire chain to get a true total.
    if (node.type === 'IfStatement' && isNodeRecord(node)) {
      const consequentCount = countStatements(node.consequent as NodeValue);
      const alternateCount = node.alternate != null ? countStatements(node.alternate as NodeValue) : 0;

      return consequentCount + alternateCount + 1; // +1 for the if-statement itself
    }

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
  let kind: EarlyReturnKind | null = null;

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
            kind = 'invertible-if-else';
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

  if (score === 0) {
    return null;
  }

  if (kind === null) {
    kind = 'missing-guard';
  }

  if (hasGuardClauses === false && maxDepth < 2 && earlyReturnCount === 0) {
    return null;
  }

  return {
    kind,
    file: filePath,
    header,
    span,
    metrics: {
      returns: earlyReturnCount,
      hasGuards: hasGuardClauses,
      guards: guardClauseCount,
    },
    score,
  };
};

const analyzeEarlyReturn = (files: ReadonlyArray<ParsedFile>): ReadonlyArray<EarlyReturnItem> => {
  if (files.length === 0) {
    return createEmptyEarlyReturn();
  }

  return collectFunctionItems(files, analyzeFunctionNode).filter((item): item is EarlyReturnItem => item !== null);
};

export { analyzeEarlyReturn, createEmptyEarlyReturn };
