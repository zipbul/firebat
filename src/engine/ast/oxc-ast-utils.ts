import type { Node } from 'oxc-parser';

import { isFunctionNode } from '@zipbul/gildash';
import { visitorKeys } from 'oxc-parser';

import type { NodeRecord, NodeValue } from '../types';

import { addNonEmptyString } from '../../shared';

export { isFunctionNode };

/** 비배열 객체 판정 — OXC Node·NodeRecord 가드의 단일 결정 지점. */
const isNonArrayObject = (value: unknown): boolean => typeof value === 'object' && value !== null && !Array.isArray(value);

export const isOxcNode = (value: unknown): value is Node => isNonArrayObject(value);

export const isOxcNodeArray = (value: NodeValue): value is ReadonlyArray<Node> => Array.isArray(value);

export const isNodeRecord = (node: unknown): node is NodeRecord => isNonArrayObject(node);

/**
 * Node를 string-keyed 동적 레코드로 보는 단일 캐스트 지점. visitorKeys에 없는
 * 스칼라 프로퍼티(operator·optional 등)나 타입별 자식을 동적 키로 읽을 때 쓴다.
 * 런타임 동작은 없고 형(型) 시야만 넓힌다.
 */
export const asRecord = (node: unknown): Record<string, unknown> => node as Record<string, unknown>;

/** CFG payload(단일 Node | Node 배열)를 ReadonlyArray<Node>로 정규화하는 단일 결정. */
export const toNodeArray = (payload: Node | ReadonlyArray<Node>): ReadonlyArray<Node> =>
  Array.isArray(payload) ? (payload as ReadonlyArray<Node>) : [payload as Node];

export const getNodeName = (node: Node | null | undefined): string | null => {
  if (node === null || node === undefined) {
    return null;
  }

  if ('name' in node && typeof node.name === 'string') {
    return node.name;
  }

  return null;
};

/**
 * Node의 이름을 꺼내 비어 있지 않은 문자열이면 집합에 추가하는 단일 결정.
 * "이름 추출 → 유효성(문자열·비어있지 않음) 검사 → 등록"의 변경지점이다.
 */
export const addNodeNameIfValid = (names: Set<string>, node: Node | null | undefined): void => {
  addNonEmptyString(names, getNodeName(node));
};

/**
 * MemberExpression의 property가 Identifier면 그 이름을, 아니면 null을 돌려준다.
 * `obj.prop` 에서 메서드/프로퍼티 이름을 꺼내는 결정의 단일 변경지점.
 * (호출부는 member가 MemberExpression임을 보장한다.)
 */
export const getMemberPropertyName = (member: Node): string | null => {
  const prop = asRecord(member).property;

  return isOxcNode(prop) && prop.type === 'Identifier' ? getNodeName(prop) : null;
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

/** Node의 각 자식 Node를 (child, 부모=node)로 콜백에 전달. parent-aware 재귀의 단일 하강 지점. */
export const forEachChildWithParent = (node: Node, cb: (child: Node, parent: Node) => void): void =>
  forEachChildNode(node, child => cb(child, node));

/**
 * `(node) => boolean` 콜백 — walkOxcTree에서는 "자식으로 내려갈지", collectOxcNodes에서는
 * "이 노드가 매칭인지"를 뜻한다(역할은 호출처 의미, 계약은 동일). 같은 함수 계약을 두 이름으로
 * 중복 선언하지 않도록 단일 별칭으로 둔다.
 */
type OxcNodePredicate = (node: Node) => boolean;

export const walkOxcTree = (program: Node, walker: OxcNodePredicate): void => {
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

    forEachChildWithParent(node, visit);
  };

  visit(root, null);
};

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

  const keyValue = getLiteralString(key);

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
