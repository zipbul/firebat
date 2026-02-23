import type { Node } from 'oxc-parser';

import type { NodeRecord, NodeValue, NodeValueVisitor, OxcNodePredicate, OxcNodeWalker } from '../types';

export const isOxcNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isOxcNodeArray = (value: NodeValue): value is ReadonlyArray<Node> => {
  if (!Array.isArray(value)) {
    return false;
  }

  return true;
};

export const isNodeRecord = (node: unknown): node is NodeRecord => typeof node === 'object' && node !== null && !Array.isArray(node);

export const getNodeType = (node: Node): string => node.type;

export const getNodeName = (node: NodeValue): string | null => {
  if (!isOxcNode(node)) {
    return null;
  }

  if ('name' in node && typeof node.name === 'string') {
    return node.name;
  }

  return null;
};

export const getLiteralString = (node: NodeValue): string | null => {
  if (!isOxcNode(node)) {
    return null;
  }

  if (node.type !== 'Literal') {
    return null;
  }

  if ('value' in node && typeof node.value === 'string') {
    return node.value;
  }

  return null;
};

export const isFunctionNode = (node: Node): boolean => {
  const nodeType = node.type;

  return nodeType === 'FunctionDeclaration' || nodeType === 'FunctionExpression' || nodeType === 'ArrowFunctionExpression';
};

export const walkOxcTree = (program: NodeValue, walker: OxcNodeWalker): void => {
  const visit = (value: NodeValue): void => {
    if (isOxcNodeArray(value)) {
      for (const entry of value) {
        visit(entry);
      }

      return;
    }

    if (!isOxcNode(value)) {
      return;
    }

    const shouldVisitChildren = walker(value);

    if (!shouldVisitChildren) {
      return;
    }

    if (!isNodeRecord(value)) {
      return;
    }

    const entries = Object.entries(value);

    for (const [key, childValue] of entries) {
      if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') {
        continue;
      }

      visit(childValue);
    }
  };

  visit(program);
};

export const collectOxcNodes = (program: NodeValue, predicate: OxcNodePredicate): Node[] => {
  const nodes: Node[] = [];

  walkOxcTree(program, node => {
    if (predicate(node)) {
      nodes.push(node);
    }

    return true;
  });

  return nodes;
};

export const collectFunctionNodes = (program: NodeValue): Node[] => collectOxcNodes(program, isFunctionNode);

export interface FunctionNodeWithParent {
  readonly node: Node;
  readonly parent: Node | null;
}

export const collectFunctionNodesWithParent = (program: NodeValue): FunctionNodeWithParent[] => {
  const results: FunctionNodeWithParent[] = [];

  const visit = (value: NodeValue, parent: Node | null): void => {
    if (isOxcNodeArray(value)) {
      for (const entry of value) {
        visit(entry, parent);
      }

      return;
    }

    if (!isOxcNode(value)) {
      return;
    }

    if (isFunctionNode(value)) {
      results.push({ node: value, parent });
    }

    if (!isNodeRecord(value)) {
      return;
    }

    const entries = Object.entries(value);

    for (const [key, childValue] of entries) {
      if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') {
        continue;
      }

      visit(childValue, value);
    }
  };

  visit(program, null);

  return results;
};

export const visitOxcChildren = (node: Node, visit: NodeValueVisitor): void => {
  if (!isNodeRecord(node)) {
    return;
  }

  const entries = Object.entries(node);

  for (const [key, value] of entries) {
    if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') {
      continue;
    }

    visit(value);
  }
};

export const getNodeHeader = (node: Node, parent?: Node | null): string => {
  const idNode = isNodeRecord(node) ? node.id : undefined;
  const idName = getNodeName(idNode);

  if (typeof idName === 'string' && idName.length > 0) {
    return idName;
  }

  const key = isNodeRecord(node) ? node.key : undefined;

  if (key !== undefined && key !== null) {
    const keyName = getNodeName(key);

    if (typeof keyName === 'string' && keyName.length > 0) {
      return keyName;
    }

    const keyValue = getLiteralString(key);

    if (typeof keyValue === 'string' && keyValue.length > 0) {
      return keyValue;
    }
  }

  if (parent !== undefined && parent !== null && isNodeRecord(parent)) {
    const parentType = (parent as Node).type;

    if (parentType === 'VariableDeclarator') {
      const parentIdName = getNodeName(parent.id);

      if (typeof parentIdName === 'string' && parentIdName.length > 0) {
        return parentIdName;
      }
    }

    if (parentType === 'MethodDefinition' || parentType === 'PropertyDefinition' || parentType === 'Property') {
      const parentKeyName = getNodeName(parent.key);

      if (typeof parentKeyName === 'string' && parentKeyName.length > 0) {
        return parentKeyName;
      }

      const parentKeyValue = getLiteralString(parent.key);

      if (typeof parentKeyValue === 'string' && parentKeyValue.length > 0) {
        return parentKeyValue;
      }
    }
  }

  return 'anonymous';
};
