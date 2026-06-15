import type { AstNode, JsonValue, NodeOrNull, RuleContext } from '../types';

import { isJsonObject, toStringList } from '../utils/json-options';

interface NoUmbrellaTypesOptions {
  forbiddenAliases?: string[];
  forbiddenGlobals?: string[];
}

const readOptions = (raw: JsonValue | undefined): NoUmbrellaTypesOptions => {
  if (!isJsonObject(raw)) {
    return {};
  }

  const forbiddenAliases = toStringList(raw.forbiddenAliases);
  const forbiddenGlobals = toStringList(raw.forbiddenGlobals);
  const out: NoUmbrellaTypesOptions = {};

  if (forbiddenAliases) {
    out.forbiddenAliases = forbiddenAliases;
  }

  if (forbiddenGlobals) {
    out.forbiddenGlobals = forbiddenGlobals;
  }

  return out;
};

const DEFAULT_FORBIDDEN_ALIASES = ['AnyValue', 'AnyFunction', 'DeepPartial'];
const DEFAULT_FORBIDDEN_GLOBALS = ['Function', 'Object'];
const noUmbrellaTypesRule = {
  create(context: RuleContext) {
    const options = readOptions(context.options[0]);
    const forbiddenAliases = new Set(options.forbiddenAliases ?? DEFAULT_FORBIDDEN_ALIASES);
    const forbiddenGlobals = new Set(options.forbiddenGlobals ?? DEFAULT_FORBIDDEN_GLOBALS);

    const getIdentifierName = (node: NodeOrNull): string | null => (node?.type === 'Identifier' ? (node.name ?? null) : null);

    const reportIdentifier = (node: AstNode, messageId: string): void => {
      context.report({
        messageId,
        node,
      });
    };

    const checkNamedDeclaration = (node: AstNode): void => {
      const name = getIdentifierName(node.id);

      if (name !== null && forbiddenAliases.has(name)) {
        reportIdentifier(node.id ?? node, 'forbiddenAlias');
      }
    };

    return {
      TSTypeAliasDeclaration: checkNamedDeclaration,
      TSInterfaceDeclaration: checkNamedDeclaration,
      TSTypeReference(node: AstNode) {
        const name = getIdentifierName(node.typeName);

        if (name === null) {
          return;
        }

        if (forbiddenAliases.has(name)) {
          reportIdentifier(node.typeName ?? node, 'forbiddenAlias');

          return;
        }

        if (forbiddenGlobals.has(name)) {
          reportIdentifier(node.typeName ?? node, 'forbiddenGlobal');
        }
      },
      TSObjectKeyword(node: AstNode) {
        context.report({
          messageId: 'objectKeyword',
          node,
        });
      },
    };
  },
  meta: {
    messages: {
      forbiddenAlias: 'Do not use umbrella types (e.g. `AnyValue` / `AnyFunction`). Define a concrete type.',
      forbiddenGlobal: 'Do not use overly-broad global types (e.g. `Function` / `Object`). Define a concrete type.',
      objectKeyword: 'Do not use the `object` type keyword. Define a concrete type.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          forbiddenAliases: {
            type: 'array',
            items: { type: 'string' },
          },
          forbiddenGlobals: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        additionalProperties: false,
      },
    ],
    type: 'problem',
  },
};

export { noUmbrellaTypesRule };
