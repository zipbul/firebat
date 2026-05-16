import type { Node } from 'oxc-parser';

import { visitorKeys } from 'oxc-parser';

import type { NodeRecord, NodeValue } from '../types';

export const isOxcNode = (value: unknown): value is Node => typeof value === 'object' && value !== null && !Array.isArray(value);

export const isOxcNodeArray = (value: NodeValue): value is ReadonlyArray<Node> => Array.isArray(value);

export const isNodeRecord = (node: unknown): node is NodeRecord =>
  typeof node === 'object' && node !== null && !Array.isArray(node);

export const getNodeName = (node: Node | null | undefined): string | null => {
  if (node === null || node === undefined) {
    return null;
  }

  if ('name' in node && typeof node.name === 'string') {
    return node.name;
  }

  return null;
};

export const getLiteralString = (node: Node | null | undefined): string | null => {
  if (node === null || node === undefined) {
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

const forEachNodeInArray = (arr: unknown[], cb: (child: Node) => void): void => {
  for (const item of arr) {
    if (isOxcNode(item)) {
      cb(item);
    }
  }
};

/** Node의 자식 중 Node 타입인 것만 콜백에 전달. visitorKeys 기반. */
export const forEachChildNode = (node: Node, cb: (child: Node) => void): void => {
  const keys = visitorKeys[node.type];

  if (keys === undefined) {
    return;
  }

  for (const key of keys) {
    const value = (node as unknown as Record<string, unknown>)[key];

    if (isOxcNode(value)) {
      cb(value);
    } else if (Array.isArray(value)) {
      forEachNodeInArray(value, cb);
    }
  }
};

type OxcNodeWalker = (node: Node) => boolean;

export const walkOxcTree = (program: Node, walker: OxcNodeWalker): void => {
  const visit = (node: Node): void => {
    const shouldVisitChildren = walker(node);

    if (!shouldVisitChildren) {
      return;
    }

    forEachChildNode(node, visit);
  };

  visit(program);
};

type OxcNodeWalkerWithParent = (node: Node, parent: Node | null) => boolean;

export const walkOxcTreeWithParent = (root: Node, walker: OxcNodeWalkerWithParent): void => {
  const visit = (node: Node, parent: Node | null): void => {
    const shouldVisitChildren = walker(node, parent);

    if (!shouldVisitChildren) {
      return;
    }

    forEachChildNode(node, child => visit(child, node));
  };

  visit(root, null);
};

type OxcNodePredicate = (node: Node) => boolean;

export const collectOxcNodes = (program: Node, predicate: OxcNodePredicate): Node[] => {
  const nodes: Node[] = [];

  walkOxcTree(program, node => {
    if (predicate(node)) {
      nodes.push(node);
    }

    return true;
  });

  return nodes;
};

export const collectFunctionNodes = (program: Node): Node[] => collectOxcNodes(program, isFunctionNode);

interface FunctionNodeWithParent {
  readonly node: Node;
  readonly parent: Node | null;
}

export const collectFunctionNodesWithParent = (program: Node): FunctionNodeWithParent[] => {
  const results: FunctionNodeWithParent[] = [];

  walkOxcTreeWithParent(program, (node, parent) => {
    if (isFunctionNode(node)) {
      results.push({ node, parent });
    }

    return true;
  });

  return results;
};

const getNameFromKey = (key: Node): string | null => {
  if (key.type === 'Identifier') {
    return key.name;
  }

  const keyValue = getLiteralString(key as Node);

  return typeof keyValue === 'string' && keyValue.length > 0 ? keyValue : null;
};

const getNameFromParentContext = (parent: Node): string | null => {
  if (parent.type === 'VariableDeclarator') {
    if (parent.id.type === 'Identifier') {
      return parent.id.name;
    }

    return null;
  }

  if (parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition' || parent.type === 'Property') {
    return getNameFromKey(parent.key);
  }

  return null;
};

export const getNodeHeader = (node: Node, parent?: Node | null): string => {
  // Extract name from node's own id (FunctionDeclaration, ClassDeclaration, etc.)
  if (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ClassDeclaration' ||
    node.type === 'ClassExpression' ||
    node.type === 'TSTypeAliasDeclaration' ||
    node.type === 'TSInterfaceDeclaration' ||
    node.type === 'TSEnumDeclaration'
  ) {
    const name = node.id?.name;

    if (typeof name === 'string' && name.length > 0) {
      return name;
    }
  }

  // VariableDeclarator: id is BindingPattern (Identifier, ObjectPattern, ArrayPattern)
  if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') {
    return node.id.name;
  }

  // Extract name from node's key (MethodDefinition, PropertyDefinition, Property)
  if (node.type === 'MethodDefinition' || node.type === 'PropertyDefinition' || node.type === 'Property') {
    const name = getNameFromKey(node.key);

    if (name !== null) {
      return name;
    }
  }

  // Extract name from parent context
  if (parent !== undefined && parent !== null) {
    const parentName = getNameFromParentContext(parent);

    if (parentName !== null) {
      return parentName;
    }
  }

  return 'anonymous';
};
