import type { AstNode, Fix, Fixer, Range, RuleContext, Variable } from '../types';

import { nodeArray } from '../utils';

const COMMA_TOKEN = ',';
const unusedImportsRule = {
  create(context: RuleContext) {
    const sourceCode = context.getSourceCode();

    const getDeclaredVariables = (node: AstNode): Variable[] | null => {
      if (typeof context.getDeclaredVariables !== 'function') {
        return null;
      }

      return context.getDeclaredVariables(node) ?? [];
    };

    const getVariableForSpecifier = (variables: Variable[], specifier: AstNode): Variable | null => {
      const local = specifier.local;

      if (!local?.range) {
        return null;
      }

      return (
        variables.find(
          variable =>
            Array.isArray(variable.identifiers) &&
            variable.identifiers.some(
              identifier =>
                Array.isArray(identifier?.range) &&
                identifier.range[0] === local.range?.[0] &&
                identifier.range[1] === local.range?.[1],
            ),
        ) ?? null
      );
    };

    const isVariableUsed = (variable: Variable): boolean => Array.isArray(variable?.references) && variable.references.length > 0;

    const getSpecifierName = (specifier: AstNode): string => specifier.local?.name ?? 'import';

    const isTypeOnlyImport = (node: AstNode): boolean => {
      if (node.importKind === 'type') {
        return true;
      }

      const specifiers = nodeArray(node.specifiers);

      for (const spec of specifiers) {
        if (spec.importKind === 'type') {
          return true;
        }
      }

      return false;
    };

    const buildSpecifierRemovalRange = (specifier: AstNode): Range | null => {
      const text = typeof sourceCode.getText === 'function' ? sourceCode.getText() : sourceCode.text;
      const start0 = specifier.range?.[0];
      const end0 = specifier.range?.[1];

      if (typeof start0 !== 'number' || typeof end0 !== 'number') {
        return null;
      }

      if (typeof sourceCode.getTokenBefore !== 'function' || typeof sourceCode.getTokenAfter !== 'function') {
        return null;
      }

      const tokenBefore = sourceCode.getTokenBefore(specifier);
      const tokenAfter = sourceCode.getTokenAfter(specifier);

      // Only allow simple single-line removals to avoid whitespace/comment edge-cases.
      const hasNewlineInRange = (start: number, end: number): boolean => {
        const slice = new Set(text.slice(start, end));

        return slice.has('\n') || slice.has('\r');
      };

      if (tokenAfter?.value === COMMA_TOKEN) {
        const commaEnd = tokenAfter.range?.[1];

        if (typeof commaEnd !== 'number') {
          return null;
        }

        if (hasNewlineInRange(start0, commaEnd)) {
          return null;
        }

        // Extend to include trailing spaces/tabs after the comma (same line only).
        let end = commaEnd;

        while (end < text.length) {
          const ch = text[end];

          if (ch === ' ' || ch === '\t') {
            end += 1;

            continue;
          }

          if (ch === '\n' || ch === '\r') {
            return null;
          }

          break;
        }

        return [start0, end];
      }

      if (tokenBefore?.value === COMMA_TOKEN) {
        const commaStart = tokenBefore.range?.[0];

        if (typeof commaStart !== 'number') {
          return null;
        }

        if (hasNewlineInRange(commaStart, end0)) {
          return null;
        }

        // Extend backwards to include spaces/tabs before the comma (same line only).
        let start = commaStart;

        while (start > 0) {
          const ch = text[start - 1];

          if (ch === ' ' || ch === '\t') {
            start -= 1;

            continue;
          }

          if (ch === '\n' || ch === '\r') {
            return null;
          }

          break;
        }

        return [start, end0];
      }

      if (hasNewlineInRange(start0, end0)) {
        return null;
      }

      return [start0, end0];
    };

    const reportUnusedSpecifier = (specifier: AstNode): void => {
      context.report({
        node: specifier,
        messageId: 'unusedImport',
        data: { name: getSpecifierName(specifier) },
        fix(fixer: Fixer): Fix | null {
          const range = buildSpecifierRemovalRange(specifier);

          if (!range) {
            return null;
          }

          return fixer.removeRange(range);
        },
      });
    };

    return {
      ImportDeclaration(node: AstNode) {
        const specifiers = nodeArray(node.specifiers);

        if (specifiers.length === 0) {
          return;
        }

        // We intentionally do not autofix type-only imports because usage can be ambiguous
        // depending on host variable-reference semantics.
        const allowAutofix = !isTypeOnlyImport(node);
        const variables = getDeclaredVariables(node);

        if (!variables || variables.length === 0) {
          return;
        }

        const unusedSpecifiers: AstNode[] = [];

        for (const specifier of specifiers) {
          const variable = getVariableForSpecifier(variables, specifier);

          if (!variable) {
            continue;
          }

          if (!isVariableUsed(variable)) {
            unusedSpecifiers.push(specifier);
          }
        }

        if (unusedSpecifiers.length === 0) {
          return;
        }

        if (unusedSpecifiers.length === specifiers.length) {
          context.report({
            node,
            messageId: 'unusedImportDeclaration',
            fix(fixer: Fixer): Fix | null {
              if (!allowAutofix) {
                return null;
              }

              if (!Array.isArray(node.range) || node.range.length !== 2) {
                return null;
              }

              return fixer.remove(node);
            },
          });

          return;
        }

        // To keep autofix behavior deterministic and safe, only autofix when exactly one
        // specifier is unused. Multiple per-specifier fixes can overlap and become order-
        // dependent (or be silently skipped by some fix runners).
        if (allowAutofix && unusedSpecifiers.length === 1) {
          const only = unusedSpecifiers[0];

          if (only) {
            reportUnusedSpecifier(only);

            return;
          }

          return;
        }

        for (const specifier of unusedSpecifiers) {
          context.report({
            node: specifier,
            messageId: 'unusedImport',
            data: { name: getSpecifierName(specifier) },
          });
        }
      },
    };
  },
  meta: {
    fixable: 'code',
    messages: {
      unusedImport: 'Unused import {{name}}.',
      unusedImportDeclaration: 'Unused import declaration.',
    },
    schema: [],
    type: 'problem',
  },
};

export { unusedImportsRule };
