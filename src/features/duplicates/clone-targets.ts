/**
 * Clone 탐지 대상 노드 유형 및 공유 유틸리티.
 *
 * analyzer.ts가 사용하는 순수 함수들.
 */

import type { Node } from 'oxc-parser';

import type { FirebatItemKind, SourceSpan } from '../../types';

import { spanOfNode } from '../../engine/ast/source-span';

const CLONE_TARGET_TYPES = new Set([
  'FunctionDeclaration',
  'ClassDeclaration',
  'ClassExpression',
  'MethodDefinition',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'TSTypeAliasDeclaration',
  'TSInterfaceDeclaration',
]);

export const isCloneTarget = (node: Node): boolean => CLONE_TARGET_TYPES.has(node.type);

// ─── 골격(결정 없음) 판정 — CLAUDE.md duplicates 개념의 닫힌 규칙 ────────────
//
// 정규형이 같아도 결정을 담지 않는 골격은 K:
//  1. 본문 없는 overload 시그니처
//  2. 단순 위임 — 본문이 파라미터 무변형 단일 호출 반환뿐인 것
//  3. 빈 marker 타입 (빈 interface / 빈 type literal alias)

type FunctionLikeNode = Node & {
  readonly params?: ReadonlyArray<Node>;
  readonly body?: Node | null;
};

const isSimpleIdentifier = (node: unknown): node is Node & { readonly name: string } =>
  typeof node === 'object' && node !== null && (node as Node).type === 'Identifier';

const isPlainCallee = (node: Node): boolean => {
  if (node.type === 'Identifier' || node.type === 'ThisExpression') {
    return true;
  }

  if (node.type === 'MemberExpression') {
    const member = node as Node & { readonly computed: boolean; readonly object: Node; readonly property: Node };

    return !member.computed && member.property.type === 'Identifier' && isPlainCallee(member.object);
  }

  return false;
};

const isParamPassthroughDelegation = (fn: FunctionLikeNode): boolean => {
  const params = fn.params ?? [];
  const paramNames = new Set<string>();

  for (const param of params) {
    if (!isSimpleIdentifier(param)) {
      return false;
    }

    paramNames.add(param.name);
  }

  const body = fn.body;

  if (body === null || body === undefined) {
    return false;
  }

  let callNode: Node | null = null;

  if (body.type === 'BlockStatement') {
    const statements = (body as Node & { readonly body: ReadonlyArray<Node> }).body;

    if (statements.length !== 1 || statements[0]!.type !== 'ReturnStatement') {
      return false;
    }

    callNode = (statements[0] as Node & { readonly argument: Node | null }).argument;
  } else {
    callNode = body;
  }

  if (callNode === null || callNode.type !== 'CallExpression') {
    return false;
  }

  const call = callNode as Node & { readonly callee: Node; readonly arguments: ReadonlyArray<Node> };

  if (!isPlainCallee(call.callee)) {
    return false;
  }

  return call.arguments.every(arg => isSimpleIdentifier(arg) && paramNames.has(arg.name));
};

const isFunctionSkeleton = (fn: FunctionLikeNode): boolean => {
  if (fn.body === null || fn.body === undefined) {
    return true;
  }

  return isParamPassthroughDelegation(fn);
};

export const isDecisionlessSkeleton = (node: Node): boolean => {
  const t = node.type;

  if (t === 'FunctionDeclaration' || t === 'FunctionExpression' || t === 'ArrowFunctionExpression') {
    return isFunctionSkeleton(node as FunctionLikeNode);
  }

  if (t === 'MethodDefinition') {
    const value = (node as Node & { readonly value: Node | null }).value;

    if (value === null || value === undefined) {
      return true;
    }

    return isFunctionSkeleton(value as FunctionLikeNode);
  }

  if (t === 'TSInterfaceDeclaration') {
    const body = (node as Node & { readonly body: Node & { readonly body: ReadonlyArray<Node> } }).body;

    return body.body.length === 0;
  }

  if (t === 'TSTypeAliasDeclaration') {
    const annotation = (node as Node & { readonly typeAnnotation: Node }).typeAnnotation;

    if (annotation.type === 'TSTypeLiteral') {
      return (annotation as Node & { readonly members: ReadonlyArray<Node> }).members.length === 0;
    }

    return false;
  }

  // 멤버가 전부 구현 없는 abstract/시그니처뿐인 클래스 = 프로토콜 강제 골격 (결정 없음)
  if (t === 'ClassDeclaration' || t === 'ClassExpression') {
    const members = (node as Node & { readonly body: Node & { readonly body: ReadonlyArray<Node> } }).body.body;

    return members.length > 0 && members.every(isBodylessMember);
  }

  return false;
};

const isBodylessMember = (member: Node): boolean => {
  if (member.type === 'TSAbstractMethodDefinition' || member.type === 'TSAbstractPropertyDefinition') {
    return true;
  }

  if (member.type === 'MethodDefinition') {
    const value = (member as Node & { readonly value: Node | null }).value;

    return value === null || value === undefined || (value as Node & { readonly body: Node | null }).body === null;
  }

  // 초기값 없는 필드 선언
  if (member.type === 'PropertyDefinition') {
    return (member as Node & { readonly value: Node | null }).value === null;
  }

  return false;
};

export const getItemKind = (node: Node): FirebatItemKind => {
  const t = node.type;

  if (t === 'FunctionDeclaration' || t === 'FunctionExpression' || t === 'ArrowFunctionExpression') {
    return 'function';
  }

  if (t === 'MethodDefinition') {
    return 'method';
  }

  if (t === 'ClassDeclaration' || t === 'ClassExpression' || t === 'TSTypeAliasDeclaration') {
    return 'type';
  }

  if (t === 'TSInterfaceDeclaration') {
    return 'interface';
  }

  return 'node';
};

export const resolveSpan = (sourceText: string, node: Node): SourceSpan => spanOfNode(node, sourceText);
