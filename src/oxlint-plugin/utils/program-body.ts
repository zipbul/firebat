import type { AstNode } from '../types';

function getProgramBody(program: AstNode): AstNode[] {
  const body = program.body;

  if (Array.isArray(body)) {
    return body;
  }

  return [];
}

export { getProgramBody };
