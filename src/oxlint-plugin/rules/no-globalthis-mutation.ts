import type { AstNode, NodeOrNull, RuleContext } from '../types';

import { isIdentifierNamed } from '../utils/identifier';

const noGlobalThisMutationRule = {
  create(context: RuleContext) {
    const isGlobalThisMember = (node: NodeOrNull): boolean => {
      if (node?.type !== 'MemberExpression') {
        return false;
      }

      if (isIdentifierNamed(node.object, 'globalThis')) {
        return true;
      }

      // Check for nested access: globalThis.prop.sub -> object is (globalThis.prop)
      return isGlobalThisMember(node.object);
    };

    const isObjectStaticCall = (callExpr: NodeOrNull, methodName: string): boolean => {
      const callee = callExpr?.callee;

      if (callee?.type !== 'MemberExpression' || callee.computed === true) {
        return false;
      }

      if (!isIdentifierNamed(callee.object, 'Object')) {
        return false;
      }

      return isIdentifierNamed(callee.property, methodName);
    };

    return {
      UnaryExpression(node: AstNode) {
        if (node.operator === 'delete' && isGlobalThisMember(node.argument)) {
          context.report({ messageId: 'globalThisMutation', node });
        }
      },
      AssignmentExpression(node: AstNode) {
        const left = node.left;

        if (isGlobalThisMember(left)) {
          context.report({ messageId: 'globalThisMutation', node });
        }
      },
      UpdateExpression(node: AstNode) {
        const arg = node.argument;

        if (isGlobalThisMember(arg)) {
          context.report({ messageId: 'globalThisMutation', node });
        }
      },
      CallExpression(node: AstNode) {
        if (
          !isObjectStaticCall(node, 'defineProperty') &&
          !isObjectStaticCall(node, 'defineProperties') &&
          !isObjectStaticCall(node, 'assign') &&
          !isObjectStaticCall(node, 'setPrototypeOf')
        ) {
          return;
        }

        const first = node.arguments?.[0];

        if (isIdentifierNamed(first, 'globalThis')) {
          context.report({ messageId: 'globalThisMutation', node });
        }
      },
    };
  },
  meta: {
    messages: {
      globalThisMutation: 'Do not mutate `globalThis`.',
    },
    schema: [],
    type: 'problem',
  },
};

export { noGlobalThisMutationRule };
