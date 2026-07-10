/**
 * Clone 탐지 대상 노드 유형 및 공유 유틸리티.
 *
 * analyzer.ts가 사용하는 순수 함수들.
 */

import type { Node } from 'oxc-parser';

import type { FirebatItemKind, SourceSpan } from '../../types';

import { asRecord, isOxcNode } from '../../engine/ast/oxc-ast-utils';
import { getContractMembers } from '../../engine/ast/oxc-fingerprint';
import { countOxcSize } from '../../engine/ast/oxc-size-count';
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

// ─── 결정-존재 floor (익명 인라인 표현식) — CLAUDE.md duplicates 닫힌 규칙 ──────
//
// minSize는 "결정을 담기엔 너무 작아 K"라는 결정-존재 floor다 (CLAUDE.md: 문장열 규칙).
// 이 floor는 **익명 함수 표현식**(arrow / 이름 없는 function expression)과 **계약 타입선언**
// (interface / type alias)에도 적용한다.
//   - 익명 인라인 람다는 명명된 변경지점이 아니라 인라인 코드(문장열의 인라인 등가물).
//   - 계약 타입선언은 행위 없는 순수 구조라, floor 미만의 초소형 shape(`{line;column}` 등)는
//     독립 모듈이 우연히 수렴하는 보편 어휘다 — 사소한 람다 `(a,b)=>a-b`의 인터페이스 등가물.
//     이름은 fingerprint에서 alpha-renaming으로 치환되므로 명명 여부가 정보량을 만들지 않는다.
// 정규형 노드 수가 floor 미만이면 드리프트할 결정을 담기엔 너무 작다. 이는 유사도 임계가
// 아니라 노드 수 floor이며 매칭 자체는 정규형 완전 일치(이진·닫힘)다.
//
// 형태로 판정하는 닫힌 규칙: (익명 함수 표현식 ∨ 계약 타입선언) ∧ size < minSize.
//   - `(a, b) => a - b`(비교자), `x => x.length > 0`(술어), `n => f(n, k)`(투영),
//     `interface P { line: number; column: number }`(보편 shape) 등
//     우연히 같은 초소형 구조를 거른다(독립 결정의 우연한 동형, zero-FP).
//   - **행위-보유 명명 선언**(function/class/method)은 floor가 없다 — 작은 중복 함수도
//     주소 지정 가능한 변경지점이므로 잡는다(false negative 방지).
const isAnonymousFunctionExpression = (node: Node): boolean => {
  if (node.type === 'ArrowFunctionExpression') {
    return true;
  }

  // 이름 없는 function expression만. 이름 있는 표현식(`const x = function named(){}`)은
  // named binding을 가지므로 floor 비대상.
  if (node.type === 'FunctionExpression') {
    return !isOxcNode((node as Node & { readonly id: Node | null }).id);
  }

  return false;
};

const isContractTypeDeclaration = (node: Node): boolean =>
  node.type === 'TSInterfaceDeclaration' || node.type === 'TSTypeAliasDeclaration';

export const isBelowDecisionFloor = (node: Node, minSize: number): boolean =>
  (isAnonymousFunctionExpression(node) || isContractTypeDeclaration(node)) && countOxcSize(node) < minSize;

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

  let callNode: Node | null;

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

  return isParamPassthroughDelegation(fn) || isSimpleParamProjection(fn) || isIdentityArrow(fn) || isNullaryLiteralFactory(fn);
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
        const typeArgs = (
          annotation as Node & { readonly typeArguments?: (Node & { readonly params?: ReadonlyArray<Node> }) | null }
        ).typeArguments;

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
