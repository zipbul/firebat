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

const isIterationMethod = (name: string): boolean => {
  return (
    name === 'forEach' ||
    name === 'map' ||
    name === 'filter' ||
    name === 'reduce' ||
    name === 'reduceRight' ||
    name === 'find' ||
    name === 'some' ||
    name === 'every'
  );
};

const getMemberObjectIdentifier = (node: NodeValue): string | null => {
  if (!isOxcNode(node) || !isNodeRecord(node) || node.type !== 'MemberExpression') {
    return null;
  }

  const obj = node.object;
  const prop = node.property;

  if (!isOxcNode(obj) || !isNodeRecord(obj) || obj.type !== 'Identifier') {
    return null;
  }

  if (!isOxcNode(prop) || !isNodeRecord(prop) || prop.type !== 'Identifier') {
    return null;
  }

  return obj.name;
};

const getIterationTarget = (node: NodeValue): string | null => {
  if (!isOxcNode(node) || !isNodeRecord(node)) {
    return null;
  }

  if (node.type === 'ForOfStatement' || node.type === 'ForInStatement') {
    const right = node.right;

    if (isOxcNode(right) && isNodeRecord(right) && right.type === 'Identifier') {
      return right.name;
    }

    return null;
  }

  if (node.type === 'ForStatement') {
    const test = node.test;

    if (!isOxcNode(test) || !isNodeRecord(test) || test.type !== 'BinaryExpression') {
      return null;
    }

    const right = test.right;

    if (!isOxcNode(right) || !isNodeRecord(right) || right.type !== 'MemberExpression') {
      return null;
    }

    const objName = getMemberObjectIdentifier(right);
    const prop = right.property;
    const propName = isOxcNode(prop) && isNodeRecord(prop) && prop.type === 'Identifier' ? prop.name : null;

    if (objName && propName === 'length') {
      return objName;
    }

    return null;
  }

  if (node.type === 'CallExpression') {
    const callee = node.callee;

    if (!isOxcNode(callee) || !isNodeRecord(callee) || callee.type !== 'MemberExpression') {
      return null;
    }

    const prop = callee.property;
    const propName = isOxcNode(prop) && isNodeRecord(prop) && prop.type === 'Identifier' ? prop.name : null;

    if (!propName || !isIterationMethod(propName)) {
      return null;
    }

    return getMemberObjectIdentifier(callee);
  }

  return null;
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
  let cognitiveComplexity = 0;
  const iterationStack: string[] = [];
  const accidentalQuadraticTargets = new Set<string>();

  const hasNestedIterationOnTarget = (value: NodeValue, target: string): boolean => {
    let found = false;

    const scan = (candidate: NodeValue): void => {
      if (found) {
        return;
      }

      if (isOxcNodeArray(candidate)) {
        for (const entry of candidate) {
          scan(entry);
        }

        return;
      }

      if (!isOxcNode(candidate)) {
        return;
      }

      // Keep scan bounded: do not enter further nested function bodies.
      if (candidate !== value && isFunctionNode(candidate)) {
        return;
      }

      const innerTarget = getIterationTarget(candidate);

      if (innerTarget === target) {
        found = true;

        return;
      }

      if (!isNodeRecord(candidate)) {
        return;
      }

      visitOxcChildren(candidate, entry => {
        scan(entry);
      });
    };

    scan(value);

    return found;
  };

  const maybeReportCallbackQuadratic = (node: NodeValue, target: string): void => {
    if (!isOxcNode(node) || !isNodeRecord(node) || node.type !== 'CallExpression') {
      return;
    }

    const args = Array.isArray(node.arguments) ? (node.arguments as ReadonlyArray<NodeValue>) : [];
    const callback = args[0];

    if (!isOxcNode(callback) || !isFunctionNode(callback) || !isNodeRecord(callback)) {
      return;
    }

    const callbackBody = resolveFunctionBody(callback as unknown as Node);

    if (callbackBody === null || callbackBody === undefined) {
      return;
    }

    if (hasNestedIterationOnTarget(callbackBody as NodeValue, target)) {
      accidentalQuadraticTargets.add(target);
    }
  };

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
      cognitiveComplexity += 1 + depth;
    }

    const iterationTarget = getIterationTarget(value);
    const isIteration = iterationTarget !== null;
    const pushIteration = (): void => {
      if (iterationTarget === null) {
        return;
      }

      if (iterationStack.includes(iterationTarget)) {
        accidentalQuadraticTargets.add(iterationTarget);
      }

      iterationStack.push(iterationTarget);
    };
    const popIteration = (): void => {
      if (!isIteration) {
        return;
      }

      iterationStack.pop();
    };

    if (!isNodeRecord(value)) {
      return;
    }

    if (isIteration) {
      pushIteration();

      if (iterationTarget !== null) {
        maybeReportCallbackQuadratic(value, iterationTarget);
      }
    }

    visitOxcChildren(value, entry => {
      visit(entry, nextDepth);
    });

    if (isIteration) {
      popIteration();
    }
  };

  visit(bodyValue as NodeValue, 0);

  const header = getNodeHeader(functionNode, parent);
  const span = getFunctionSpan(functionNode, sourceText);
  const nestingScore = Math.max(0, cognitiveComplexity);
  const nestingSuggestions: string[] = [];

  if (maxDepth >= 3) {
    nestingSuggestions.push('consider guard clauses to reduce nesting');
  }

  if (cognitiveComplexity >= 15) {
    nestingSuggestions.push('consider simplifying; cognitive complexity is high');
  }

  if (maxDepth >= 4) {
    nestingSuggestions.push('reduce nesting depth to improve readability');
  }

  if (accidentalQuadraticTargets.size > 0) {
    nestingSuggestions.push(
      `accidental-quadratic: nested iteration over ${Array.from(accidentalQuadraticTargets)
        .sort()
        .map(t => `\`${t}\``)
        .join(', ')}`,
    );
  }

  return {
    filePath,
    header,
    span,
    metrics: {
      depth: maxDepth,
      cognitiveComplexity,
      accidentalQuadraticTargets: Array.from(accidentalQuadraticTargets).sort(),
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
