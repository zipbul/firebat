import type { AstNode, Fix, Fixer, JsonValue, NodeOrNull, RuleContext, TemplateElementValue } from '../types';

import { isJsonObject } from '../utils/json-options';

interface NoBracketNotationOptions {
  allow?: string[];
}

const toStringList = (value: JsonValue | undefined): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const out: string[] = [];

  for (const item of value) {
    if (typeof item === 'string') {
      out.push(item);
    }
  }

  return out;
};

const readOptions = (raw: JsonValue | undefined): NoBracketNotationOptions => {
  if (!isJsonObject(raw)) {
    return {};
  }

  return {
    allow: toStringList(raw.allow),
  };
};

const isTemplateElementValue = (value: AstNode['value'] | undefined): value is TemplateElementValue => {
  return typeof value === 'object' && value !== null;
};

const noBracketNotationRule = {
  create(context: RuleContext) {
    const sourceCode = context.getSourceCode();
    const options = readOptions(context.options[0]);
    const allow = new Set(options.allow ?? []);

    const isSafeDotProperty = (key: string): boolean => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key);

    const getStringLiteralValue = (node: NodeOrNull): string | null => {
      if (!node) {
        return null;
      }

      if (node.type === 'Literal' && typeof node.value === 'string') {
        return node.value;
      }

      if (node.type === 'TemplateLiteral' && Array.isArray(node.expressions) && node.expressions.length === 0) {
        const q = node.quasis?.[0];
        const qValue = q?.value;

        if (typeof qValue === 'string') {
          return qValue;
        }

        const cooked = isTemplateElementValue(qValue) ? qValue.cooked : null;

        return typeof cooked === 'string' ? cooked : null;
      }

      return null;
    };

    return {
      MemberExpression(node: AstNode) {
        if (node.computed !== true) {
          return;
        }

        const key = getStringLiteralValue(node.property);

        if (key === null || key.length === 0) {
          return;
        }

        if (allow.has(key)) {
          return;
        }

        context.report({
          messageId: 'bracketNotation',
          node,
          data: { key },
          fix(fixer: Fixer): Fix | null {
            // Only offer a fix when we can guarantee correctness.
            // We restrict to a simple Identifier receiver and a simple IdentifierName key.
            if (!isSafeDotProperty(key)) {
              return null;
            }

            const receiver = node.object;

            if (receiver?.type !== 'Identifier' || typeof receiver.name !== 'string') {
              return null;
            }

            const range = node.range;

            if (!Array.isArray(range) || range.length !== 2) {
              return null;
            }

            // Avoid fixing multiline patterns (formatting/comments become ambiguous).
            const text = typeof sourceCode.getText === 'function' ? sourceCode.getText() : sourceCode.text;
            const original = new Set(text.slice(range[0], range[1]));

            if (original.has('\n') || original.has('\r')) {
              return null;
            }

            return fixer.replaceTextRange([range[0], range[1]], `${receiver.name}.${key}`);
          },
        });
      },
    };
  },
  meta: {
    fixable: 'code',
    messages: {
      bracketNotation: "Do not use bracket notation for string keys (e.g. obj['{{key}}']). Use dot notation instead.",
    },
    schema: [
      {
        type: 'object',
        properties: {
          allow: {
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

export { noBracketNotationRule };
