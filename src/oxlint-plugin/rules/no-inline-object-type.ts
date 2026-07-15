import type { AstNode, RuleContext } from '../types';

import { isJsonObject } from '../utils';

interface NoInlineObjectTypeOptions {
  allowEmpty?: boolean;
}

const noInlineObjectTypeRule = {
  create(context: RuleContext) {
    const raw = context.options[0];
    const options: NoInlineObjectTypeOptions = isJsonObject(raw)
      ? {
          allowEmpty: raw.allowEmpty === true,
        }
      : {};
    const allowEmpty = options.allowEmpty === true;

    return {
      TSTypeLiteral(node: AstNode) {
        if (allowEmpty && Array.isArray(node.members) && node.members.length === 0) {
          return;
        }

        context.report({
          messageId: 'inlineObjectType',
          node,
        });
      },
    };
  },
  meta: {
    messages: {
      inlineObjectType: 'Do not use inline object types. Define a named `type` or `interface`.',
    },
    schema: [],
    type: 'problem',
  },
};

export { noInlineObjectTypeRule };
