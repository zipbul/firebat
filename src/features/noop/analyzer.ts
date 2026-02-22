import type { Node } from 'oxc-parser';

import type { NodeValue, ParsedFile } from '../../engine/types';
import type { NoopFinding } from '../../types';

import { getNodeName, isNodeRecord, isOxcNode, walkOxcTree } from '../../engine/oxc-ast-utils';
import { normalizeFile } from '../../engine/normalize-file';
import { evalStaticTruthiness } from '../../engine/oxc-expression-utils';
import { getLineColumn } from '../../engine/source-position';

const INTENTIONAL_NOOP_NAMES = new Set(['noop', '_noop', 'noOp', 'NOOP']);

const isIntentionalNoop = (node: Node): boolean => {
  // FunctionDeclaration: check node.id name
  if (node.type === 'FunctionDeclaration' && isNodeRecord(node)) {
    const name = getNodeName(node.id);

    if (typeof name === 'string' && (INTENTIONAL_NOOP_NAMES.has(name) || name.startsWith('_noop'))) {
      return true;
    }
  }

  return false;
};

const createEmptyNoop = (): ReadonlyArray<NoopFinding> => [];

const getSpan = (node: Node, sourceText: string) => {
  const start = getLineColumn(sourceText, node.start);
  const end = getLineColumn(sourceText, node.end);

  return {
    start,
    end,
  };
};

const isNoopExpressionType = (nodeType: string): boolean => {
  return (
    nodeType === 'Literal' ||
    nodeType === 'Identifier' ||
    nodeType === 'ThisExpression' ||
    nodeType === 'ObjectExpression' ||
    nodeType === 'ArrayExpression' ||
    nodeType === 'FunctionExpression' ||
    nodeType === 'ArrowFunctionExpression' ||
    nodeType === 'ClassExpression'
  );
};

const isSameExpression = (left: Node, right: Node): boolean => {
  if (left.type !== right.type) {
    return false;
  }

  if (left.type === 'Identifier' && right.type === 'Identifier') {
    return left.name === right.name;
  }

  if (left.type === 'ThisExpression' && right.type === 'ThisExpression') {
    return true;
  }

  if (left.type === 'Literal' && right.type === 'Literal') {
    if (!isNodeRecord(left) || !isNodeRecord(right)) {
      return false;
    }

    return left.value === right.value;
  }

  if (left.type === 'MemberExpression' && right.type === 'MemberExpression') {
    if (!isNodeRecord(left) || !isNodeRecord(right)) {
      return false;
    }

    if (left.computed !== right.computed) {
      return false;
    }

    const leftObject = left.object;
    const rightObject = right.object;
    const leftProperty = left.property;
    const rightProperty = right.property;

    if (!isOxcNode(leftObject) || !isOxcNode(rightObject) || !isOxcNode(leftProperty) || !isOxcNode(rightProperty)) {
      return false;
    }

    return isSameExpression(leftObject, rightObject) && isSameExpression(leftProperty, rightProperty);
  }

  return false;
};

const collectNoopFindings = (program: NodeValue, sourceText: string, file: string): NoopFinding[] => {
  const findings: NoopFinding[] = [];

  // Pre-collect variable names that hold arrow/function expressions for intentional noop detection.
  const arrowNoopOffsets = new Set<number>();

  walkOxcTree(program, node => {
    if (node.type === 'VariableDeclarator' && isNodeRecord(node)) {
      const name = getNodeName(node.id);
      const init = node.init;

      if (
        typeof name === 'string' &&
        (INTENTIONAL_NOOP_NAMES.has(name) || name.startsWith('_noop')) &&
        isOxcNode(init) &&
        (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression')
      ) {
        arrowNoopOffsets.add(init.start);
      }
    }

    return true;
  });

  walkOxcTree(program, node => {
    if (node.type === 'ExpressionStatement' && isNodeRecord(node)) {
      const expression = node.expression;

      if (isOxcNode(expression) && isNoopExpressionType(expression.type)) {
        findings.push({
          kind: 'expression-noop',
          file,
          span: getSpan(node, sourceText),
          confidence: 0.9,
          evidence: `expression statement has no side effects (${expression.type})`,
        });
      }

      // self-assignment: x = x
      if (isOxcNode(expression) && expression.type === 'AssignmentExpression' && isNodeRecord(expression)) {
        const left = expression.left;
        const right = expression.right;

        if (
          isOxcNode(left) &&
          isOxcNode(right) &&
          isSameExpression(left, right) &&
          (expression.operator === '=' || expression.operator === undefined)
        ) {
          findings.push({
            kind: 'self-assignment',
            file,
            span: getSpan(node, sourceText),
            confidence: 0.9,
            evidence: 'left-hand side is assigned to itself',
          });
        }
      }
    }

    if (node.type === 'IfStatement' && isNodeRecord(node)) {
      const test = node.test;
      const truthiness = evalStaticTruthiness(test);

      if (truthiness !== null) {
        findings.push({
          kind: 'constant-condition',
          file,
          span: getSpan(node, sourceText),
          confidence: 0.8,
          evidence: `if condition is always ${truthiness ? 'truthy' : 'falsy'}`,
        });
      }
    }

    // empty-catch: catch block with empty body
    if (node.type === 'CatchClause' && isNodeRecord(node)) {
      const body = node.body;

      if (isOxcNode(body) && body.type === 'BlockStatement' && isNodeRecord(body)) {
        const bodyArr = Array.isArray(body.body) ? body.body : [];

        if (bodyArr.length === 0) {
          findings.push({
            kind: 'empty-catch',
            file,
            span: getSpan(node, sourceText),
            confidence: 0.8,
            evidence: 'catch block has an empty body',
          });
        }
      }
    }

    // empty-function-body: function/arrow with empty block body
    if (
      (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') &&
      isNodeRecord(node)
    ) {
      const body = node.body;

      if (isOxcNode(body) && body.type === 'BlockStatement' && isNodeRecord(body)) {
        const bodyArr = Array.isArray(body.body) ? body.body : [];

        if (bodyArr.length === 0 && !isIntentionalNoop(node) && !arrowNoopOffsets.has(node.start)) {
          findings.push({
            kind: 'empty-function-body',
            file,
            span: getSpan(node, sourceText),
            confidence: 0.6,
            evidence: 'function has an empty body',
          });
        }
      }
    }

    return true;
  });

  return findings;
};

const analyzeNoop = (files: ReadonlyArray<ParsedFile>): ReadonlyArray<NoopFinding> => {
  if (files.length === 0) {
    return createEmptyNoop();
  }

  const findings: NoopFinding[] = [];

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    findings.push(...collectNoopFindings(file.program, file.sourceText, normalizeFile(file.filePath)));
  }

  return findings;
};

export { analyzeNoop, createEmptyNoop };
