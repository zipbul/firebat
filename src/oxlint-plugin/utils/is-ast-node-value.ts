import type { AstNode, AstNodeValue } from '../types';

function isAstNodeValue(value: AstNodeValue | null | undefined): value is AstNode {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  if (!('type' in value)) {
    return false;
  }

  return typeof value.type === 'string';
}

export { isAstNodeValue };
