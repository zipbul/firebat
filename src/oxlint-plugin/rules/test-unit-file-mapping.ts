import { basename } from 'node:path';

import type { AstNode, RuleContext } from '../types';

import { getContextFilename } from '../utils/context-filename';
import { fileExists } from '../utils/context-fs';
import { isAstNodeValue } from '../utils/is-ast-node-value';

function isUnitSpecFile(filePath: string): boolean {
  return filePath.endsWith('.spec.ts');
}

function isIntegrationTestFile(filePath: string): boolean {
  return filePath.endsWith('.test.ts') && !filePath.endsWith('.e2e.test.ts');
}

function isE2ETestFile(filePath: string): boolean {
  return filePath.endsWith('.e2e.test.ts');
}

function isTypeDeclaration(node: AstNode): boolean {
  return node.type === 'TSTypeAliasDeclaration';
}

function getProgramBody(program: AstNode): AstNode[] {
  const body = program.body;

  if (Array.isArray(body)) {
    return body;
  }

  return [];
}

function isLogicful(program: AstNode): boolean {
  const body = getProgramBody(program);

  for (const stmt of body) {
    if (stmt.type === 'ImportDeclaration') {
      continue;
    }

    if (stmt.type === 'ExportAllDeclaration') {
      continue;
    }

    if (stmt.type === 'ExportNamedDeclaration') {
      const declaration = stmt.declaration;
      const declarationNode = isAstNodeValue(declaration) ? declaration : null;

      if (!declarationNode) {
        // export { X } / export { X as Y } / export * are treated as logicless.
        continue;
      }

      if (isTypeDeclaration(declarationNode)) {
        continue;
      }

      return true;
    }

    if (isTypeDeclaration(stmt)) {
      continue;
    }

    if (stmt.type === 'EmptyStatement') {
      continue;
    }

    return true;
  }

  return false;
}

function getImplPathFromSpec(specPath: string): string {
  return specPath.replace(/\.spec\.ts$/, '.ts');
}

function getSpecPathFromImpl(implPath: string): string {
  return implPath.replace(/\.ts$/, '.spec.ts');
}

const testUnitFileMappingRule = {
  create(context: RuleContext) {
    return {
      Program(node: AstNode) {
        const filename = getContextFilename(context);

        if (typeof filename !== 'string' || filename.length === 0) {
          return;
        }

        if (isE2ETestFile(filename) || isIntegrationTestFile(filename)) {
          return;
        }

        const base = basename(filename);

        if (base === 'index.ts') {
          return;
        }

        if (filename.endsWith('.d.ts')) {
          return;
        }

        if (isUnitSpecFile(filename)) {
          const implPath = getImplPathFromSpec(filename);
          const implExists = fileExists(context, implPath);

          if (implExists === null) {
            return;
          }

          if (!implExists) {
            context.report({
              messageId: 'missingImplementation',
              node,
              data: {
                expected: implPath,
              },
            });
          }

          return;
        }

        if (!filename.endsWith('.ts')) {
          return;
        }

        if (!isLogicful(node)) {
          return;
        }

        const specPath = getSpecPathFromImpl(filename);
        const specExists = fileExists(context, specPath);

        if (specExists === null) {
          return;
        }

        if (!specExists) {
          context.report({
            messageId: 'missingSpec',
            node,
            data: {
              expected: specPath,
            },
          });
        }
      },
    };
  },
  meta: {
    messages: {
      missingImplementation: 'Unit spec file must have a colocated implementation file: {{expected}}',
      missingSpec: 'Logicful implementation file must have a colocated unit spec file: {{expected}}',
    },
    schema: [],
    type: 'problem',
  },
};

export { testUnitFileMappingRule };
