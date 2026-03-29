import type { Node } from 'oxc-parser';
import { visitorKeys } from 'oxc-parser';

import type { NodeRecord, NodeValue } from '../types';

export const isOxcNode = (value: unknown): value is Node => typeof value === 'object' && value !== null && !Array.isArray(value);

export const isOxcNodeArray = (value: NodeValue): value is ReadonlyArray<Node> => Array.isArray(value);

export const isNodeRecord = (node: unknown): node is NodeRecord =>
  typeof node === 'object' && node !== null && !Array.isArray(node);

export const getNodeType = (node: Node): string => node.type;

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
      for (const item of value) {
        if (isOxcNode(item)) {
          cb(item);
        }
      }
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

export interface FunctionNodeWithParent {
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

export const getNodeHeader = (node: Node, parent?: Node | null): string => {
  const rec = node as unknown as Record<string, unknown>;
  const idNode = rec.id;

  if (isOxcNode(idNode)) {
    const idName = getNodeName(idNode);

    if (typeof idName === 'string' && idName.length > 0) {
      return idName;
    }
  }

  const key = rec.key;

  if (key !== undefined && key !== null && isOxcNode(key)) {
    const keyName = getNodeName(key);

    if (typeof keyName === 'string' && keyName.length > 0) {
      return keyName;
    }

    const keyValue = getLiteralString(key);

    if (typeof keyValue === 'string' && keyValue.length > 0) {
      return keyValue;
    }
  }

  if (parent !== undefined && parent !== null) {
    const parentRec = parent as unknown as Record<string, unknown>;
    const parentType = parent.type;

    if (parentType === 'VariableDeclarator') {
      const parentId = parentRec.id;

      if (isOxcNode(parentId)) {
        const parentIdName = getNodeName(parentId);

        if (typeof parentIdName === 'string' && parentIdName.length > 0) {
          return parentIdName;
        }
      }
    }

    if (parentType === 'MethodDefinition' || parentType === 'PropertyDefinition' || parentType === 'Property') {
      const parentKey = parentRec.key;

      if (isOxcNode(parentKey)) {
        const parentKeyName = getNodeName(parentKey);

        if (typeof parentKeyName === 'string' && parentKeyName.length > 0) {
          return parentKeyName;
        }

        const parentKeyValue = getLiteralString(parentKey);

        if (typeof parentKeyValue === 'string' && parentKeyValue.length > 0) {
          return parentKeyValue;
        }
      }
    }
  }

  return 'anonymous';
};
