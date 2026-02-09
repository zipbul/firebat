import type { Node } from 'oxc-parser';

import type { SourceSpan } from '../types';
import type { NodeValue, ParsedFile } from './types';

import { getNodeHeader, isFunctionNode, isNodeRecord, isOxcNode } from './oxc-ast-utils';
import { getLineColumn } from './source-position';

type ExtractedSymbolKind = 'function' | 'method' | 'class' | 'type' | 'interface' | 'enum';

interface ExtractedSymbol {
  readonly kind: ExtractedSymbolKind;
  readonly name: string;
  readonly span: SourceSpan;
  readonly isExported: boolean;
}

interface NodeWithInit {
  readonly init?: NodeValue;
}

const getNodeSpan = (node: Node, sourceText: string): SourceSpan => ({
  start: getLineColumn(sourceText, node.start),
  end: getLineColumn(sourceText, node.end),
});

const extractSymbolsOxc = (file: ParsedFile): ReadonlyArray<ExtractedSymbol> => {
  const out: ExtractedSymbol[] = [];
  const { program, sourceText } = file;

  const visit = (value: NodeValue, exported: boolean): void => {
    if (Array.isArray(value)) {
      for (const entry of value as ReadonlyArray<NodeValue>) {
        visit(entry, exported);
      }

      return;
    }

    if (!isOxcNode(value)) {
      return;
    }

    const node = value;
    // Track export context for child declarations
    const isExportWrapper = node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration';
    const childExported = exported || isExportWrapper;

    if (node.type === 'FunctionDeclaration') {
      const name = getNodeHeader(node);

      if (name !== 'anonymous') {
        out.push({ kind: 'function', name, span: getNodeSpan(node, sourceText), isExported: childExported });
      }
    }

    if (node.type === 'VariableDeclarator' && isNodeRecord(node)) {
      const init = (node as NodeWithInit).init;

      if (isOxcNode(init) && isFunctionNode(init)) {
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

    if (!isNodeRecord(node)) {
      return;
    }

    const entries = Object.entries(node) as Array<[string, NodeValue]>;

    for (const [key, childValue] of entries) {
      if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') {
        continue;
      }

      visit(childValue, isExportWrapper);
    }
  };

  visit(program, false);

  return out;
};

export { extractSymbolsOxc };
export type { ExtractedSymbol, ExtractedSymbolKind };
