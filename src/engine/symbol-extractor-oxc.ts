import type { Node } from 'oxc-parser';

import type { SourceSpan } from '../types';
import type { ParsedFile } from './types';

import { buildLineOffsets, getLineColumn } from '@zipbul/gildash';
import { forEachChildNode, getNodeHeader, isFunctionNode } from './ast/oxc-ast-utils';

type ExtractedSymbolKind = 'function' | 'method' | 'class' | 'type' | 'interface' | 'enum';

interface ExtractedSymbol {
  readonly kind: ExtractedSymbolKind;
  readonly name: string;
  readonly span: SourceSpan;
  readonly isExported: boolean;
}

const getNodeSpan = (node: Node, sourceText: string): SourceSpan => {
  const offsets = buildLineOffsets(sourceText);

  return {
    start: getLineColumn(offsets, node.start),
    end: getLineColumn(offsets, node.end),
  };
};

const extractSymbolsOxc = (file: ParsedFile): ReadonlyArray<ExtractedSymbol> => {
  const out: ExtractedSymbol[] = [];
  const { program, sourceText } = file;

  const visit = (node: Node, exported: boolean): void => {
    // Track export context for child declarations
    const isExportWrapper = node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration';
    const childExported = exported || isExportWrapper;

    if (node.type === 'FunctionDeclaration') {
      const name = getNodeHeader(node);

      if (name !== 'anonymous') {
        out.push({ kind: 'function', name, span: getNodeSpan(node, sourceText), isExported: childExported });
      }
    }

    if (node.type === 'VariableDeclarator') {
      const init = node.init;

      if (init !== undefined && init !== null && isFunctionNode(init as Node)) {
        const name = getNodeHeader(node);

        if (name !== 'anonymous') {
          out.push({ kind: 'function', name, span: getNodeSpan(node, sourceText), isExported: childExported });
        }
      }
    }

    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      const name = getNodeHeader(node);

      if (name !== 'anonymous') {
        out.push({ kind: 'class', name, span: getNodeSpan(node, sourceText), isExported: childExported });
      }
    }

    if (node.type === 'MethodDefinition') {
      const name = getNodeHeader(node);

      if (name !== 'anonymous') {
        out.push({ kind: 'method', name, span: getNodeSpan(node, sourceText), isExported: false });
      }
    }

    if (node.type === 'TSTypeAliasDeclaration') {
      const name = getNodeHeader(node);

      if (name !== 'anonymous') {
        out.push({ kind: 'type', name, span: getNodeSpan(node, sourceText), isExported: childExported });
      }
    }

    if (node.type === 'TSInterfaceDeclaration') {
      const name = getNodeHeader(node);

      if (name !== 'anonymous') {
        out.push({ kind: 'interface', name, span: getNodeSpan(node, sourceText), isExported: childExported });
      }
    }

    if (node.type === 'TSEnumDeclaration') {
      const name = getNodeHeader(node);

      if (name !== 'anonymous') {
        out.push({ kind: 'enum', name, span: getNodeSpan(node, sourceText), isExported: childExported });
      }
    }

    forEachChildNode(node, child => {
      visit(child, isExportWrapper);
    });
  };

  visit(program, false);

  return out;
};

export { extractSymbolsOxc };
export type { ExtractedSymbol, ExtractedSymbolKind };
