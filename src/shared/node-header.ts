import type { Node } from 'oxc-parser';

import type { NodeHeader } from '../types';

import { getNodeHeader as getOxcNodeHeader } from '../engine/ast/oxc-ast-utils';

export const getNodeHeader = (node: Node): NodeHeader => {
  return {
    kind: 'node',
    header: getOxcNodeHeader(node),
  };
};
