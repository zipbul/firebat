import type { AstNode, AstNodeValue, NodeOrNull, RuleContext } from '../types';

import { addNonEmptyString } from '../../shared';

const isAstNode = (value: AstNodeValue): value is AstNode => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  if (!('type' in value)) {
    return false;
  }

  return typeof value.type === 'string';
};

const noUnmodifiedLoopConditionRule = {
  create(context: RuleContext) {
    const mutatingMethodNames = new Set([
      // Array mutators
      'copyWithin',
      'fill',
      'pop',
      'push',
      'reverse',
      'shift',
      'sort',
      'splice',
      'unshift',
      // Map / Set mutators
      'add',
      'clear',
      'delete',
      'set',
    ]);

    const getRootIdentifierName = (node: NodeOrNull): string | null => {
      if (!node) {
        return null;
      }

      if (node.type === 'Identifier') {
        const name = node.name;

        return typeof name === 'string' && name.length > 0 ? name : null;
      }

      if (node.type === 'MemberExpression') {
        return getRootIdentifierName(node.object);
      }

      if (node.type === 'ChainExpression') {
        return getRootIdentifierName(node.expression);
      }

      return null;
    };

    const collectTestIdentifiers = (node: NodeOrNull, out: Set<string>, seen: WeakSet<AstNode>): void => {
      if (!node) {
        return;
      }

      if (seen.has(node)) {
        return;
      }

      seen.add(node);

      if (node.type === 'Identifier') {
        addNonEmptyString(out, node.name);

        return;
      }

      if (node.type === 'MemberExpression') {
        // Only identifiers that refer to variables should be considered.
        // `obj.prop` has `prop` as an Identifier node but it's not a variable reference.
        collectTestIdentifiers(node.object, out, seen);

        if (node.computed === true) {
          collectTestIdentifiers(node.property, out, seen);
        }

        return;
      }

      for (const key of Object.keys(node)) {
        if (key === 'parent') {
          continue;
        }

        const value = node[key];

        if (value === null || value === undefined) {
          continue;
        }

        if (Array.isArray(value)) {
          for (const v of value) {
            if (isAstNode(v)) {
              collectTestIdentifiers(v, out, seen);
            }
          }
        } else if (isAstNode(value)) {
          collectTestIdentifiers(value, out, seen);
        }
      }
    };

    const collectMutatedIdentifiers = (node: NodeOrNull, out: Set<string>, seen: WeakSet<AstNode>): void => {
      if (!node) {
        return;
      }

      if (seen.has(node)) {
        return;
      }

      seen.add(node);

      if (node.type === 'UpdateExpression') {
        const name = getRootIdentifierName(node.argument);

        if (name !== null) {
          out.add(name);
        }
      }

      if (node.type === 'AssignmentExpression') {
        const name = getRootIdentifierName(node.left);

        if (name !== null) {
          out.add(name);
        }
      }

      if (node.type === 'CallExpression') {
        const callee = node.callee;

        if (callee?.type === 'MemberExpression' && callee.computed !== true) {
          const receiverName = getRootIdentifierName(callee.object);
          const methodName = callee.property?.type === 'Identifier' ? (callee.property.name ?? null) : null;

          if (receiverName !== null && methodName !== null && mutatingMethodNames.has(methodName)) {
            out.add(receiverName);
          }
        }
      }

      for (const key of Object.keys(node)) {
        if (key === 'parent') {
          continue;
        }

        const value = node[key];

        if (value === null || value === undefined) {
          continue;
        }

        if (Array.isArray(value)) {
          for (const v of value) {
            if (isAstNode(v)) {
              collectMutatedIdentifiers(v, out, seen);
            }
          }
        } else if (isAstNode(value)) {
          collectMutatedIdentifiers(value, out, seen);
        }
      }
    };

    const checkLoop = (node: AstNode, testNode: NodeOrNull, bodyNode: NodeOrNull, updateNode: NodeOrNull): void => {
      if (!testNode || !bodyNode) {
        return;
      }

      const testIds = new Set<string>();

      collectTestIdentifiers(testNode, testIds, new WeakSet<AstNode>());

      if (testIds.size === 0) {
        return;
      }

      const mutated = new Set<string>();

      collectMutatedIdentifiers(bodyNode, mutated, new WeakSet<AstNode>());

      if (updateNode !== null && updateNode !== undefined) {
        collectMutatedIdentifiers(updateNode, mutated, new WeakSet<AstNode>());
      }

      // If at least one identifier in the test is mutated, the condition can change.
      const anyModified = [...testIds].some(id => mutated.has(id));

      if (anyModified) {
        return;
      }

      context.report({
        messageId: 'unmodified',
        node,
        data: { names: [...testIds].join(', ') },
      });
    };

    const checkSimpleLoop = (node: AstNode): void => {
      const testNode = node.test ?? null;
      const bodyNode = Array.isArray(node.body) ? null : (node.body ?? null);

      checkLoop(node, testNode, bodyNode, null);
    };

    return {
      WhileStatement: checkSimpleLoop,
      DoWhileStatement: checkSimpleLoop,
      ForStatement(node: AstNode) {
        const testNode = node.test ?? null;
        const bodyNode = Array.isArray(node.body) ? null : (node.body ?? null);
        const updateNode = node.update ?? null;

        checkLoop(node, testNode, bodyNode, updateNode);
      },
    };
  },
  meta: {
    messages: {
      unmodified: 'Loop condition variable(s) not modified in loop: {{names}}.',
    },
    schema: [],
    type: 'problem',
  },
};

export { noUnmodifiedLoopConditionRule };
