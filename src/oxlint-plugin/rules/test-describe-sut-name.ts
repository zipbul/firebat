import { basename } from 'node:path';

import type { AstNode, RuleContext } from '../types';

import { getContextFilename } from '../utils/context-filename';
import { fileExists } from '../utils/context-fs';
import { getImplPathFromSpec } from '../utils/test-file-path';

function readText(context: RuleContext, filePath: string): string | null {
  if (typeof context.readFile === 'function') {
    return context.readFile(filePath);
  }

  return null;
}

function isTopLevel(node: AstNode): boolean {
  const parent = node.parent;

  if (!parent || typeof parent !== 'object' || Array.isArray(parent)) {
    return true;
  }

  const grandParent = parent.parent;

  return (
    parent.type === 'ExpressionStatement' &&
    grandParent !== null &&
    grandParent !== undefined &&
    typeof grandParent === 'object' &&
    !Array.isArray(grandParent) &&
    grandParent.type === 'Program'
  );
}

function getIdentifierName(node: AstNode | null | undefined): string | null {
  if (!node) {
    return null;
  }

  if (node.type === 'Identifier' && typeof node.name === 'string') {
    return node.name;
  }

  return null;
}

function getCalleeName(callee: AstNode | null | undefined): string | null {
  const direct = getIdentifierName(callee);

  if (typeof direct === 'string' && direct.length > 0) {
    return direct;
  }

  if (callee?.type === 'MemberExpression') {
    const objectName = getIdentifierName(callee.object);

    if (typeof objectName === 'string' && objectName.length > 0) {
      return objectName;
    }
  }

  return null;
}

function getFirstArgString(node: AstNode): string | null {
  const args = node.arguments;

  if (!Array.isArray(args) || args.length === 0) {
    return null;
  }

  const first = args[0];

  if (!first || typeof first !== 'object' || Array.isArray(first)) {
    return null;
  }

  if (first.type === 'Literal' && typeof first.value === 'string') {
    return first.value;
  }

  return null;
}

function getSutFromFilename(testFilename: string): string {
  const base = basename(testFilename);

  return base.replace(/\.spec\.ts$/, '').replace(/\.ts$/, '');
}

function getExportedClassNameFromText(text: string): string | null {
  const matches = Array.from(text.matchAll(/\bexport\s+class\s+([A-Za-z0-9_]+)\b/g))
    .map(m => m[1])
    .filter((n): n is string => typeof n === 'string' && n.length > 0);
  const unique = Array.from(new Set(matches));

  if (unique.length !== 1) {
    return null;
  }

  const only = unique[0];

  return typeof only === 'string' ? only : null;
}

const testDescribeSutNameRule = {
  create(context: RuleContext) {
    let expectedSutName: string | null = null;

    function computeExpected(): string | null {
      const filename = getContextFilename(context);

      if (typeof filename !== 'string' || filename.length === 0 || !filename.endsWith('.spec.ts')) {
        return null;
      }

      const fallback = getSutFromFilename(filename);
      const implPath = getImplPathFromSpec(filename);
      const implExists = fileExists(context, implPath);

      if (implExists === null || !implExists) {
        return fallback;
      }

      const implText = readText(context, implPath);

      if (typeof implText !== 'string' || implText.length === 0) {
        return fallback;
      }

      const exportedClassName = getExportedClassNameFromText(implText);

      return exportedClassName ?? fallback;
    }

    return {
      CallExpression(node: AstNode) {
        const filename = getContextFilename(context);

        if (typeof filename !== 'string' || filename.length === 0 || !filename.endsWith('.spec.ts')) {
          return;
        }

        if (!isTopLevel(node)) {
          return;
        }

        const calleeName = getCalleeName(node.callee);

        if (calleeName !== 'describe') {
          return;
        }

        expectedSutName ??= computeExpected();

        if (typeof expectedSutName !== 'string' || expectedSutName.length === 0) {
          return;
        }

        const actual = getFirstArgString(node);

        if (actual !== expectedSutName) {
          context.report({
            messageId: 'sutName',
            node,
            data: {
              expected: expectedSutName,
            },
          });
        }
      },
    };
  },
  meta: {
    messages: {
      sutName: 'Top-level describe() title must match SUT name: {{expected}}',
    },
    schema: [],
    type: 'problem',
  },
};

export { testDescribeSutNameRule };
