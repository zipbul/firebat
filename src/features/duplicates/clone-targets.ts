/**
 * Clone 탐지 대상 노드 유형 및 공유 유틸리티.
 *
 * analyzer.ts가 사용하는 순수 함수들.
 */

import type { Node } from 'oxc-parser';

import type { FirebatItemKind, SourceSpan } from '../../types';

import { asRecord, isOxcNode } from '../../engine/ast/oxc-ast-utils';
import { getContractMembers } from '../../engine/ast/oxc-fingerprint';
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

    if (statements.length !== 1) {
      return false;
    }

    const only = statements[0]!;

    if (only.type === 'ReturnStatement') {
      callNode = (only as Node & { readonly argument: Node | null }).argument;
    } else if (only.type === 'ExpressionStatement') {
      // void 위임: `x => { f(x); }` — 반환값을 버리는 단일 호출도 결정 없는 위임이다.
      callNode = (only as Node & { readonly expression: Node }).expression;
    } else {
      return false;
    }
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

// 단일 필드 projection: `x => x.a.b` 처럼 본문이 파라미터를 뿌리로 한 비계산 member-access
// 체인뿐인 화살표. 분기·계산·호출이 없어 결정을 담지 않는 selector 골격(K). computed 접근·
// 호출·블록 본문·항등(`x => x`)은 제외.
const isSimpleParamProjection = (fn: FunctionLikeNode): boolean => {
  const params = fn.params ?? [];

  if (params.length !== 1 || !isSimpleIdentifier(params[0])) {
    return false;
  }

  const body = fn.body;

  if (body === null || body === undefined || body.type !== 'MemberExpression') {
    return false;
  }

  let current: Node = body;

  while (current.type === 'MemberExpression') {
    const member = current as Node & { readonly computed: boolean; readonly object: Node; readonly property: Node };

    if (member.computed || member.property.type !== 'Identifier') {
      return false;
    }

    current = member.object;
  }

  return isSimpleIdentifier(current) && current.name === params[0].name;
};

// 항등 화살표: `x => x` — 파라미터를 그대로 반환한다. 분기·계산·호출·member-access가
// 전혀 없어 결정을 담지 않는 no-op 변환 골격(K). projection의 빈-체인 극한이며,
// 기본값 transform(`f = x => x`) 등으로 쓰이는 categorical identity.
const isIdentityArrow = (fn: FunctionLikeNode): boolean => {
  const params = fn.params ?? [];

  if (params.length !== 1 || !isSimpleIdentifier(params[0])) {
    return false;
  }

  const body = fn.body;

  return body !== null && body !== undefined && isSimpleIdentifier(body) && body.name === params[0].name;
};

const isEmptyList = (value: unknown): boolean => Array.isArray(value) && value.length === 0;

// 본문이 단일 seed 리터럴인 노드인가: bare Literal(`null`/`false`/`0`/`''` 등), 식별자
// `undefined`, 빈 배열·객체 리터럴. "어떤 값인가"라는 결정이 없는 zero-information seed.
// 비어있지 않은 배열·객체(룩업 테이블 후보)는 제외한다.
const isSeedLiteral = (node: Node): boolean => {
  if (node.type === 'ParenthesizedExpression') {
    const inner = asRecord(node).expression;

    return isOxcNode(inner) && isSeedLiteral(inner);
  }

  if (node.type === 'Literal') {
    return true;
  }

  if (isSimpleIdentifier(node)) {
    return node.name === 'undefined';
  }

  if (node.type === 'ArrayExpression') {
    return isEmptyList(asRecord(node).elements);
  }

  if (node.type === 'ObjectExpression') {
    return isEmptyList(asRecord(node).properties);
  }

  return false;
};

// 무인자 seed factory: `() => []`, `() => false`, `() => undefined` 처럼 파라미터 없이
// 단일 seed 리터럴을 돌려주는 화살표/함수. 입력→출력 관계도 분기도 없는 thunk이며,
// 돌려주는 상수값의 반복은 CLAUDE.md상 "단일 리터럴·상수 값의 반복" = redundancy(상수
// 추출) 영역이라 duplicates의 결정-중복 대상이 아니다 → 골격(K). 인자가 있으면(값이
// 인자에 의존) 제외.
const isNullaryLiteralFactory = (fn: FunctionLikeNode): boolean => {
  if ((fn.params ?? []).length !== 0) {
    return false;
  }

  const body = fn.body;

  return body !== null && body !== undefined && isSeedLiteral(body);
};

const isFunctionSkeleton = (fn: FunctionLikeNode): boolean => {
  if (fn.body === null || fn.body === undefined) {
    return true;
  }

  return (
    isParamPassthroughDelegation(fn) ||
    isSimpleParamProjection(fn) ||
    isIdentityArrow(fn) ||
    isNullaryLiteralFactory(fn)
  );
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

  if (t === 'TSInterfaceDeclaration' || t === 'TSTypeAliasDeclaration') {
    // An empty contract (no members) is a protocol-enforcing skeleton with no
    // decision. getContractMembers returns null for a non-literal type alias.
    if (getContractMembers(node)?.length === 0) {
      return true;
    }

    // bare 별칭(synonym): 본문이 타입인자 없는 명명 타입 참조뿐인 type alias — 자기 멤버
    // 구조가 없어 대상 타입을 따라갈 뿐, 독립적으로 드리프트할 결정이 없다 (골격).
    if (t === 'TSTypeAliasDeclaration') {
      const annotation = (node as Node & { readonly typeAnnotation: Node }).typeAnnotation;

      if (annotation.type === 'TSTypeReference') {
        const typeArgs = (annotation as Node & { readonly typeArguments?: (Node & { readonly params?: ReadonlyArray<Node> }) | null }).typeArguments;

        return (typeArgs?.params ?? []).length === 0;
      }
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
