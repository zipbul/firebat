import type { AstNode, AstNodeValue, RuleContext } from '../types';

import { addNonEmptyString, isNonEmptyString } from '../../shared';
import { getProgramBody, isAstNodeValue } from '../utils';

function isIdentifier(node: AstNode | null | undefined): node is AstNode {
  return node?.type === 'Identifier' && typeof node.name === 'string';
}

function getIdentifierName(node: AstNode | null | undefined): string | null {
  return isIdentifier(node) ? (node.name ?? null) : null;
}

function getExportedNameFromSpecifier(specifier: AstNode): string | null {
  const exported = specifier.exported ?? specifier.local ?? specifier.imported;

  if (Array.isArray(exported)) {
    return null;
  }

  if (isAstNodeValue(exported)) {
    const exportedName = getIdentifierName(exported);

    if (typeof exportedName === 'string' && exportedName.length > 0) {
      return exportedName;
    }

    if (exported.type === 'Literal' && typeof exported.value === 'string') {
      return exported.value;
    }
  }

  return null;
}

function isTypeOnlyDeclaration(node: AstNode): boolean {
  return node.type === 'TSEnumDeclaration';
}

function getClassDeclarationName(node: AstNode): string | null {
  const id = node.id;

  if (isAstNodeValue(id)) {
    return getIdentifierName(id);
  }

  return null;
}

function getDeclarationNode(value: AstNodeValue | null | undefined): AstNode | null {
  return isAstNodeValue(value) ? value : null;
}

const singleExportedClassRule = {
  create(context: RuleContext) {
    return {
      Program(node: AstNode) {
        const body = getProgramBody(node);
        const classDeclarations = new Set<string>();

        for (const stmt of body) {
          if (stmt.type !== 'ClassDeclaration') {
            continue;
          }

          addNonEmptyString(classDeclarations, getClassDeclarationName(stmt));
        }

        const exportedClassNames: string[] = [];
        let hasOtherExports = false;

        for (const stmt of body) {
          if (stmt.type === 'ExportNamedDeclaration') {
            const declarationNode = getDeclarationNode(stmt.declaration);

            if (declarationNode) {
              if (declarationNode.type === 'ClassDeclaration') {
                const className = getClassDeclarationName(declarationNode);

                if (typeof className === 'string' && className.length > 0) {
                  exportedClassNames.push(className);
                } else {
                  // Anonymous exported class still counts as an exported class.
                  exportedClassNames.push('<anonymous>');
                }

                continue;
              }

              // Any non-class export (including type-only exports) counts as a mixed export when a class is exported.
              if (isTypeOnlyDeclaration(declarationNode)) {
                hasOtherExports = true;

                continue;
              }

              hasOtherExports = true;

              continue;
            }

            const specifiers = stmt.specifiers;

            if (Array.isArray(specifiers) && specifiers.length > 0) {
              const exportedNames = specifiers.map(getExportedNameFromSpecifier).filter(isNonEmptyString);
              const onlyExportedName = exportedNames[0];

              if (exportedNames.length === 1 && typeof onlyExportedName === 'string' && classDeclarations.has(onlyExportedName)) {
                exportedClassNames.push(onlyExportedName);
              } else {
                hasOtherExports = true;
              }
            }
          } else if (stmt.type === 'ExportDefaultDeclaration') {
            const declarationNode = getDeclarationNode(stmt.declaration);

            if (declarationNode) {
              if (declarationNode.type === 'ClassDeclaration') {
                const className = getClassDeclarationName(declarationNode);

                exportedClassNames.push(className ?? '<anonymous>');
              } else {
                hasOtherExports = true;
              }
            } else {
              hasOtherExports = true;
            }
          } else if (stmt.type === 'ExportAllDeclaration') {
            hasOtherExports = true;
          }
        }

        if (exportedClassNames.length === 0) {
          return;
        }

        const uniqueExportedClassNames = Array.from(new Set(exportedClassNames));

        if (uniqueExportedClassNames.length !== 1) {
          context.report({
            messageId: 'multiple',
            node,
          });

          return;
        }

        if (hasOtherExports) {
          context.report({
            messageId: 'mixed',
            node,
          });
        }
      },
    };
  },
  meta: {
    messages: {
      mixed: 'If a file exports a class, it must export only that single class (no other exports).',
      multiple: 'If a file exports classes, it must export exactly one class.',
    },
    schema: [],
    type: 'problem',
  },
};

export { singleExportedClassRule };
