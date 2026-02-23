import type { NodeValue } from '../types';

import { isNodeRecord, isOxcNode, isOxcNodeArray } from './oxc-ast-utils';

export const countOxcSize = (node: NodeValue): number => {
  // Oxc doesn't expose a canonical size metric directly in AST.
  // We use a fast structural heuristic by counting AST nodes.

  let count = 0;

  const visit = (value: NodeValue) => {
    if (isOxcNodeArray(value)) {
      for (const child of value) {
        visit(child);
      }

      return;
    }

    if (!isOxcNode(value)) {
      return;
    }

    count += 1;

    if (!isNodeRecord(value)) {
      return;
    }

    const entries = Object.entries(value);

    for (const [key, childValue] of entries) {
      if (key !== 'type' && key !== 'start' && key !== 'end' && key !== 'loc' && key !== 'span') {
        visit(childValue);
      }
    }
  };

  visit(node);

  return count;
};
