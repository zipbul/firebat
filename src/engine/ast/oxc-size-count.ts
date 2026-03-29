import type { Node } from 'oxc-parser';

import { forEachChildNode } from './oxc-ast-utils';

export const countOxcSize = (node: Node): number => {
  let count = 0;

  const visit = (current: Node) => {
    count += 1;
    forEachChildNode(current, visit);
  };

  visit(node);

  return count;
};
