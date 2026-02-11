import type { Node } from 'oxc-parser';

import type { ParsedFile } from './types';

import { collectFunctionNodesWithParent } from './oxc-ast-utils';

type FunctionNodeAnalyzer<TItem> = (node: Node, filePath: string, sourceText: string, parent: Node | null) => TItem | null;

const collectFunctionItems = <TItem>(
  files: ReadonlyArray<ParsedFile>,
  analyzeFunctionNode: FunctionNodeAnalyzer<TItem>,
): ReadonlyArray<TItem> => {
  const items: TItem[] = [];

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    const functions = collectFunctionNodesWithParent(file.program);

    for (const { node, parent } of functions) {
      const item = analyzeFunctionNode(node, file.filePath, file.sourceText, parent);

      if (item === null || item === undefined) {
        continue;
      }

      items.push(item);
    }
  }

  return items;
};

export { collectFunctionItems };
export type { FunctionNodeAnalyzer };
