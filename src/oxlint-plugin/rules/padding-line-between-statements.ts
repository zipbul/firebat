import type { AstNode, Fix, Fixer, JsonValue, NodeOrNull, PaddingRule, RuleContext } from '../types';

import {
  blankLineFix,
  createStatementBodyVisitor,
  hasBlankLineBetween,
  isFunctionVariableDeclaration,
  isJsonObject,
  toStringOrStringList,
} from '../utils';

const paddingLineBetweenStatementsRule = {
  create(context: RuleContext) {
    const sourceCode = context.getSourceCode();

    const removeBlankLines = (prev: NodeOrNull, next: NodeOrNull, fixer: Fixer): Fix | null => {
      const prevEnd = prev?.range?.[1];
      const nextStart = next?.range?.[0];

      if (typeof prevEnd !== 'number' || typeof nextStart !== 'number') {
        return null;
      }

      const betweenText = sourceCode.text.slice(prevEnd, nextStart);
      const lines = betweenText.split(/\r?\n/);

      if (lines.length < 3) {
        return null;
      }

      const newline = betweenText.includes('\r\n') ? '\r\n' : '\n';
      const first = lines[0];
      const last = lines.at(-1);
      const middle = lines.slice(1, -1).filter(line => line.trim() !== '');

      return fixer.replaceTextRange([prevEnd, nextStart], [first, ...middle, typeof last === 'string' ? last : ''].join(newline));
    };

    const defaultRules: PaddingRule[] = [
      { blankLine: 'always', prev: ['const', 'let', 'var'], next: 'function' },
      { blankLine: 'always', prev: 'function', next: ['const', 'let', 'var'] },
      { blankLine: 'always', prev: ['const', 'let', 'var'], next: ['if', 'for', 'while', 'do', 'switch', 'try'] },
      { blankLine: 'always', prev: ['if', 'for', 'while', 'do', 'switch', 'try'], next: ['const', 'let', 'var'] },
      { blankLine: 'always', prev: ['const', 'let', 'var'], next: 'expression' },
      { blankLine: 'always', prev: 'expression', next: ['const', 'let', 'var'] },
      { blankLine: 'always', prev: ['if', 'for', 'while', 'do', 'switch', 'try'], next: 'expression' },
      { blankLine: 'always', prev: 'expression', next: ['if', 'for', 'while', 'do', 'switch', 'try'] },
      {
        blankLine: 'always',
        prev: ['if', 'for', 'while', 'do', 'switch', 'try'],
        next: ['if', 'for', 'while', 'do', 'switch', 'try'],
      },
      { blankLine: 'never', prev: ['const', 'let', 'var'], next: ['const', 'let', 'var'] },
      { blankLine: 'always', prev: '*', next: 'return' },
    ];

    const toPaddingRule = (value: JsonValue): PaddingRule | null => {
      if (!isJsonObject(value)) {
        return null;
      }

      const blankLine = typeof value.blankLine === 'string' ? value.blankLine : null;
      const prev = toStringOrStringList(value.prev);
      const next = toStringOrStringList(value.next);

      if (blankLine === null || prev === null || next === null) {
        return null;
      }

      return { blankLine, prev, next };
    };

    const normalizeRuleList = (opts: JsonValue[]): PaddingRule[] => {
      if (opts.length === 0) {
        return defaultRules;
      }

      // oxlint passes options without the leading severity.
      // We accept an array of objects shaped like ESLint's padding-line-between-statements entries.
      const cleaned: PaddingRule[] = [];

      for (const item of opts) {
        const rule = toPaddingRule(item);

        if (rule) {
          cleaned.push(rule);
        }
      }

      return cleaned.length > 0 ? cleaned : defaultRules;
    };

    const ruleList = normalizeRuleList(context.options);

    const statementKind = (node: NodeOrNull): string => {
      if (!node) {
        return 'other';
      }

      if (node.type === 'FunctionDeclaration') {
        return 'function';
      }

      if (node.type === 'VariableDeclaration') {
        if (isFunctionVariableDeclaration(node)) {
          return 'function';
        }

        // "const" | "let" | "var"
        return node.kind ?? 'var';
      }

      if (node.type === 'ExpressionStatement') {
        return 'expression';
      }

      if (node.type === 'IfStatement') {
        return 'if';
      }

      // ESLint config groups for/while/do/switch/try. We treat for/of/in as "for".
      if (node.type === 'ForInStatement') {
        return 'for';
      }

      if (node.type === 'WhileStatement') {
        return 'while';
      }

      if (node.type === 'DoWhileStatement') {
        return 'do';
      }

      if (node.type === 'SwitchStatement') {
        return 'switch';
      }

      if (node.type === 'TryStatement') {
        return 'try';
      }

      if (node.type === 'ReturnStatement') {
        return 'return';
      }

      return 'other';
    };

    const matchesSelector = (selector: string, kind: string): boolean => {
      if (selector === '*') {
        return true;
      }

      return selector === kind;
    };

    const matchesAny = (selectors: string | string[], kind: string): boolean => {
      if (Array.isArray(selectors)) {
        return selectors.some(selector => typeof selector === 'string' && matchesSelector(selector, kind));
      }

      if (typeof selectors === 'string') {
        return matchesSelector(selectors, kind);
      }

      return false;
    };

    const getBlankLineMode = (prev: NodeOrNull, next: NodeOrNull): string | null => {
      const prevKind = statementKind(prev);
      const nextKind = statementKind(next);

      for (const rule of ruleList) {
        if (matchesAny(rule.prev, prevKind) && matchesAny(rule.next, nextKind)) {
          return rule.blankLine;
        }
      }

      return null;
    };

    const checkBody = (body: AstNode[] | undefined): void => {
      if (!Array.isArray(body)) {
        return;
      }

      for (let i = 1; i < body.length; i++) {
        const prev = body[i - 1];
        const next = body[i];

        if (!prev || !next) {
          continue;
        }

        const hasBlank = hasBlankLineBetween(sourceCode, prev, next);
        const mode = getBlankLineMode(prev, next);

        if (mode === 'always' && !hasBlank) {
          context.report({
            messageId: 'expectedBlankLine',
            node: next,
            fix: blankLineFix(sourceCode, prev, next),
          });
        }

        if (mode === 'never' && hasBlank) {
          context.report({
            messageId: 'unexpectedBlankLine',
            node: next,
            fix(fixer) {
              return removeBlankLines(prev, next, fixer);
            },
          });
        }
      }
    };

    return createStatementBodyVisitor(checkBody);
  },
  meta: {
    fixable: 'whitespace',
    messages: {
      expectedBlankLine: 'Expected a blank line between statements.',
      unexpectedBlankLine: 'Unexpected blank line between statements.',
    },
    schema: [
      {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            blankLine: { type: 'string' },
            prev: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
            next: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
          },
          additionalProperties: true,
        },
      },
    ],
    type: 'layout',
  },
};

export { paddingLineBetweenStatementsRule };
