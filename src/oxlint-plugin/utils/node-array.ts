import type { AstNode } from '../types';

/**
 * Reads an AST node array property defensively, returning `[]` when the value is
 * not an array. The "coerce a node child collection to an array" decision lives
 * in one place — every rule/util that walks `node.body`/`node.specifiers`/
 * `node.declarations` shares it.
 */
const nodeArray = (value: AstNode | AstNode[] | undefined): AstNode[] => (Array.isArray(value) ? value : []);

export { nodeArray };
