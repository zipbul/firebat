import type { AstNode, NodeOrNull, RuleContext } from '../types';

import { hasBlankLineBetween, insertBlankLine } from '../utils/blank-line';
import { matchExpressionStatement } from '../utils/expression-statement';
import { isIdentifierNamed } from '../utils/identifier';
import { isFunctionVariableDeclaration } from '../utils/is-function-variable-declaration';
import { createStatementBodyVisitor } from '../utils/statement-body-visitor';

const blankLinesBetweenStatementGroupsRule = {
  create(context: RuleContext) {
    const sourceCode = context.getSourceCode();

    const unwrapExpression = (expr: NodeOrNull): NodeOrNull => {
      let current = expr;

      while (current) {
        if (current.type === 'AwaitExpression') {
          current = current.argument;

          continue;
        }

        if (current.type === 'ChainExpression') {
          current = current.expression;

          continue;
        }

        if (current.type === 'UnaryExpression' && current.operator === 'void') {
          current = current.argument;

          continue;
        }

        break;
      }

      return current;
    };

    const isTestBlockCallExpressionStatement = (node: NodeOrNull): boolean => {
      if (node?.type !== 'ExpressionStatement') {
        return false;
      }

      const expr = node.expression;

      if (!expr) {
        return false;
      }

      const unwrapped = unwrapExpression(expr);

      if (unwrapped?.type !== 'CallExpression') {
        return false;
      }

      const { callee } = unwrapped;

      if (isIdentifierNamed(callee, 'it')) {
        return true;
      }

      if (isIdentifierNamed(callee, 'describe')) {
        return true;
      }

      return false;
    };

    const getMemberExpressionRootObject = (node: NodeOrNull): NodeOrNull => {
      let current = node;

      while (current?.type === 'MemberExpression') {
        current = current.object;
      }

      return current;
    };

    const isThisMemberExpression = (node: NodeOrNull): boolean => getMemberExpressionRootObject(node)?.type === 'ThisExpression';

    const isThisDotIdentifier = (node: NodeOrNull, name: string): boolean =>
      node?.type === 'MemberExpression' && node.object?.type === 'ThisExpression' && isIdentifierNamed(node.property, name);

    const isLoggingCallExpression = (expr: NodeOrNull): boolean => {
      const unwrapped = unwrapExpression(expr);

      if (unwrapped?.type !== 'CallExpression') {
        return false;
      }

      const called = unwrapped.callee;

      if (called?.type !== 'MemberExpression') {
        return false;
      }

      const obj = called.object;

      if (isIdentifierNamed(obj, 'console')) {
        return true;
      }

      if (isIdentifierNamed(obj, 'logger')) {
        return true;
      }

      if (isThisDotIdentifier(obj, 'logger')) {
        return true;
      }

      return false;
    };

    const isCallExpressionStatement = (node: NodeOrNull): boolean =>
      matchExpressionStatement(node, expr => {
        if (isLoggingCallExpression(expr)) {
          return false;
        }

        const unwrapped = unwrapExpression(expr);

        if (!unwrapped) {
          return false;
        }

        if (unwrapped.type === 'CallExpression') {
          return true;
        }

        if (unwrapped.type === 'NewExpression') {
          return true;
        }

        return false;
      });

    const isAssignmentExpressionStatement = (node: NodeOrNull): boolean =>
      matchExpressionStatement(node, expr => expr.type === 'AssignmentExpression' && expr.operator === '=');

    const isThisAssignmentExpressionStatement = (node: NodeOrNull): boolean =>
      matchExpressionStatement(
        node,
        expr => expr.type === 'AssignmentExpression' && expr.operator === '=' && isThisMemberExpression(expr.left),
      );

    const isMutationExpressionStatement = (node: NodeOrNull): boolean =>
      matchExpressionStatement(node, expr => {
        if (expr.type === 'UpdateExpression') {
          return true;
        }

        if (expr.type === 'AssignmentExpression' && expr.operator !== '=') {
          return true;
        }

        return false;
      });

    const isThisMutationExpressionStatement = (node: NodeOrNull): boolean =>
      matchExpressionStatement(node, expr => {
        if (expr.type === 'UpdateExpression') {
          return isThisMemberExpression(expr.argument);
        }

        if (expr.type === 'AssignmentExpression' && expr.operator !== '=') {
          return isThisMemberExpression(expr.left);
        }

        return false;
      });

    const isDeleteExpressionStatement = (node: NodeOrNull): boolean =>
      matchExpressionStatement(node, expr => expr.type === 'UnaryExpression' && expr.operator === 'delete');

    const isThisDeleteExpressionStatement = (node: NodeOrNull): boolean =>
      matchExpressionStatement(
        node,
        expr => expr.type === 'UnaryExpression' && expr.operator === 'delete' && isThisMemberExpression(expr.argument),
      );

    const isUseStrictExpressionStatement = (node: NodeOrNull): boolean =>
      matchExpressionStatement(node, expr => expr.type === 'Literal' && expr.value === 'use strict');

    const isDirectiveExpressionStatement = (node: NodeOrNull): boolean =>
      matchExpressionStatement(node, expr => expr.type === 'Literal' && typeof expr.value === 'string');

    const isTypeAliasDeclaration = (node: NodeOrNull): boolean => node?.type === 'TSTypeAliasDeclaration';

    const isInterfaceDeclaration = (node: NodeOrNull): boolean => node?.type === 'TSInterfaceDeclaration';

    const isFunctionDeclaration = (node: NodeOrNull): boolean => node?.type === 'FunctionDeclaration';

    const isClassDeclaration = (node: NodeOrNull): boolean => node?.type === 'ClassDeclaration';

    const isStatementThatStartsNewGroup = (node: NodeOrNull): boolean => node?.type === 'TryStatement';

    const statementGroupId = (node: NodeOrNull): string => {
      if (!node) {
        return 'other';
      }

      if (isDirectiveExpressionStatement(node)) {
        return 'directive';
      }

      if (isUseStrictExpressionStatement(node)) {
        return 'use-strict';
      }

      if (node.type === 'ImportDeclaration') {
        return 'import';
      }

      if (node.type === 'ExportAllDeclaration') {
        return 'export';
      }

      if (isTypeAliasDeclaration(node)) {
        return 'type';
      }

      if (isInterfaceDeclaration(node)) {
        return 'interface';
      }

      if (isFunctionDeclaration(node)) {
        return 'function';
      }

      if (isClassDeclaration(node)) {
        return 'class';
      }

      if (isTestBlockCallExpressionStatement(node)) {
        return 'test';
      }

      if (isThisAssignmentExpressionStatement(node)) {
        return 'this-assign';
      }

      if (isThisMutationExpressionStatement(node)) {
        return 'this-mutation';
      }

      if (isThisDeleteExpressionStatement(node)) {
        return 'this-delete';
      }

      if (isAssignmentExpressionStatement(node)) {
        return 'assign';
      }

      if (isMutationExpressionStatement(node)) {
        return 'mutation';
      }

      if (isDeleteExpressionStatement(node)) {
        return 'delete';
      }

      if (isCallExpressionStatement(node)) {
        return 'call';
      }

      if (node.type === 'VariableDeclaration') {
        if (isFunctionVariableDeclaration(node)) {
          return 'function';
        }

        return 'var';
      }

      if (isStatementThatStartsNewGroup(node)) {
        return 'control';
      }

      return 'other';
    };

    const requiresBlankLineEvenWithinGroup = (group: string): boolean =>
      group === 'test' || group === 'type' || group === 'interface' || group === 'function' || group === 'class';

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

        const prevGroup = statementGroupId(prev);
        const nextGroup = statementGroupId(next);
        const hasBlankLine = hasBlankLineBetween(sourceCode, prev, next);
        const needBlankLine = prevGroup !== nextGroup || (prevGroup === nextGroup && requiresBlankLineEvenWithinGroup(prevGroup));

        if (!needBlankLine) {
          // NOTE: Do not remove blank lines. This rule only enforces required blank lines.
          // Other rules (e.g., padding-line-between-statements) handle the rest.
          continue;
        }

        if (!hasBlankLine) {
          context.report({
            fix(fixer) {
              return insertBlankLine(sourceCode, prev, next, fixer);
            },
            messageId: 'expectedBlankLine',
            node: next,
          });
        }
      }
    };

    return createStatementBodyVisitor(checkBody);
  },
  meta: {
    fixable: 'whitespace',
    messages: {
      expectedBlankLine: 'Expected a blank line between statement groups.',
      unexpectedBlankLine: 'Unexpected blank line within a statement group.',
    },
    schema: [],
    type: 'layout',
  },
};

export { blankLinesBetweenStatementGroupsRule };
