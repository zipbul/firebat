import type { AstNode } from '../types';

import { nodeArray } from './node-array';

function getProgramBody(program: AstNode): AstNode[] {
  return nodeArray(program.body);
}

export { getProgramBody };
