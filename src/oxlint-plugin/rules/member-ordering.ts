import type { AstNode, JsonValue, NodeOrNull, RuleContext } from '../types';

import { isJsonObject, nodeArray, toStringList } from '../utils';

interface MemberOrderingOptions {
  default?: string[];
}

const readOptions = (raw: JsonValue | undefined): MemberOrderingOptions => {
  if (!isJsonObject(raw)) {
    return {};
  }

  const parsedDefault = toStringList(raw.default);

  return parsedDefault ? { default: parsedDefault } : {};
};

const memberOrderingRule = {
  create(context: RuleContext) {
    const configured = readOptions(context.options[0]);
    const order =
      Array.isArray(configured.default) && configured.default.length > 0
        ? configured.default
        : [
            'signature',

            'public-static-field',
            'protected-static-field',
            'private-static-field',

            'public-abstract-field',
            'public-decorated-field',
            'public-instance-field',

            'protected-abstract-field',
            'protected-decorated-field',
            'protected-instance-field',

            'private-decorated-field',
            'private-instance-field',

            'public-constructor',
            'protected-constructor',
            'private-constructor',

            'public-static-method',
            'protected-static-method',
            'private-static-method',

            'public-abstract-method',
            'public-decorated-method',
            'public-instance-method',

            'protected-abstract-method',
            'protected-decorated-method',
            'protected-instance-method',

            'private-decorated-method',
            'private-instance-method',
          ];
    const rank = new Map(order.map((k, i) => [k, i]));

    const getAccessibility = (node: NodeOrNull): string => {
      const acc = node?.accessibility;

      if (acc === 'protected' || acc === 'private' || acc === 'public') {
        return acc;
      }

      return 'public';
    };

    const isDecorated = (node: NodeOrNull): boolean => Array.isArray(node?.decorators) && node.decorators.length > 0;

    const isField = (node: NodeOrNull): boolean => node?.type === 'PropertyDefinition' || node?.type === 'TSPropertySignature';

    const isMethod = (node: NodeOrNull): boolean => node?.type === 'MethodDefinition' || node?.type === 'TSMethodSignature';

    const isConstructor = (node: NodeOrNull): boolean => node?.type === 'MethodDefinition' && node.kind === 'constructor';

    const isAccessor = (node: NodeOrNull): boolean => node?.type === 'MethodDefinition' && node.kind === 'set';

    const isSignature = (node: NodeOrNull): boolean =>
      node?.type === 'TSIndexSignature' || node?.type === 'TSCallSignatureDeclaration';

    const groupKeyForMember = (node: NodeOrNull): string | null => {
      if (isSignature(node)) {
        return 'signature';
      }

      // TS-ESLint's member-ordering has additional groups for accessors.
      // The project config doesn't specify them, so we ignore accessors.
      if (isAccessor(node)) {
        return null;
      }

      const acc = getAccessibility(node);
      const isStatic = node?.static === true;
      const isAbstract = node?.abstract === true;
      const decorated = isDecorated(node);

      if (isConstructor(node)) {
        return `${acc}-constructor`;
      }

      if (isField(node)) {
        if (isStatic) {
          return `${acc}-static-field`;
        }

        if (isAbstract) {
          return `${acc}-abstract-field`;
        }

        if (decorated) {
          return `${acc}-decorated-field`;
        }

        return `${acc}-instance-field`;
      }

      if (isMethod(node)) {
        if (isStatic) {
          return `${acc}-static-method`;
        }

        if (isAbstract) {
          return `${acc}-abstract-method`;
        }

        if (decorated) {
          return `${acc}-decorated-method`;
        }

        return `${acc}-instance-method`;
      }

      // Unknown members are ignored (don't affect ordering).
      return null;
    };

    return {
      ClassBody(node: AstNode) {
        const body = nodeArray(node.body);

        if (body.length < 2) {
          return;
        }

        let lastRank = -1;

        for (const member of body) {
          const key = groupKeyForMember(member);

          if (key == null) {
            continue;
          }

          const r = rank.get(key);

          if (r == null) {
            continue;
          }

          if (r < lastRank) {
            context.report({
              messageId: 'invalidOrder',
              node: member,
              data: { key },
            });
          } else {
            lastRank = r;
          }
        }
      },
    };
  },
  meta: {
    messages: {
      invalidOrder: 'Class member is out of order (group: {{key}}).',
    },
    schema: [
      {
        type: 'object',
        properties: {
          default: {
            type: 'array',
            items: {
              type: 'string',
            },
          },
        },
        additionalProperties: true,
      },
    ],
    type: 'suggestion',
  },
};

export { memberOrderingRule };
