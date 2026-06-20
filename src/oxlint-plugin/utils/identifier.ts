import type { NodeOrNull } from '../types';

/**
 * True when `node` is an `Identifier` whose name equals `name`. Shared by the
 * rules that match well-known global/callee identifiers (e.g. `globalThis`,
 * `it`, `describe`, `console`).
 */
const isIdentifierNamed = (node: NodeOrNull, name: string): boolean => node?.type === 'Identifier' && node.name === name;

export { isIdentifierNamed };
