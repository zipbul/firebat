import type { Node } from 'oxc-parser';

import { visitorKeys } from 'oxc-parser';

import { hashString } from '../hasher';
import { normalizeForFingerprint } from './ast-normalizer';
import { isOxcNode } from './oxc-ast-utils';

const pushLiteralValue = (node: Node, diffs: string[], includeLiteralValues: boolean): void => {
  if (node.type !== 'Literal') {
    return;
  }

  if (!includeLiteralValues) {
    diffs.push('literal');

    return;
  }

  const value = node.value;

  if (typeof value === 'string') {
    diffs.push(`string:${value}`);

    return;
  }

  if (typeof value === 'number') {
    diffs.push(`number:${value}`);

    return;
  }

  if (typeof value === 'boolean') {
    diffs.push(`boolean:${value}`);

    return;
  }

  if (typeof value === 'bigint') {
    diffs.push(`bigint:${value.toString()}`);

    return;
  }

  if (value === null) {
    diffs.push('null');
  }
};

interface OxcFingerprintOptions {
  readonly includeLiteralValues: boolean;
  readonly includeIdentifierNames: boolean;
  readonly ignoredKeys?: ReadonlySet<string>;
  /**
   * 비교 단위 내부에서 선언된 바인딩 이름 집합.
   * 제공되면 이 집합에 속한 식별자만 placeholder($ID)로 치환하고,
   * 자유 식별자·프로퍼티 이름은 그대로 비교한다 (CLAUDE.md duplicates 판정 절차).
   */
  readonly boundNames?: ReadonlySet<string>;
}

// ─── 바인딩 수집 (비교 단위 내부 선언만) ─────────────────────────────────────

const harvestPatternNames = (node: Node, names: Set<string>): void => {
  switch (node.type) {
    case 'Identifier':
      names.add(node.name);

      return;
    case 'ObjectPattern':
      for (const prop of node.properties) {
        if (prop.type === 'Property') {
          harvestPatternNames(prop.value as Node, names);
        } else {
          harvestPatternNames(prop.argument as Node, names);
        }
      }

      return;
    case 'ArrayPattern':
      for (const element of node.elements) {
        if (element !== null) {
          harvestPatternNames(element as Node, names);
        }
      }

      return;
    case 'AssignmentPattern':
      harvestPatternNames(node.left as Node, names);

      return;
    case 'RestElement':
      harvestPatternNames(node.argument as Node, names);

      return;
    case 'TSParameterProperty':
      harvestPatternNames(node.parameter as Node, names);

      return;
    default:
      return;
  }
};

const BINDING_OWNER_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ClassDeclaration',
  'ClassExpression',
  'TSTypeAliasDeclaration',
  'TSInterfaceDeclaration',
]);

const FUNCTION_LIKE_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

export const collectBindingNames = (root: Node): ReadonlySet<string> => {
  const names = new Set<string>();

  const visit = (n: Node): void => {
    const rec = n as unknown as Record<string, unknown>;

    // 선언 자신의 이름 (함수·클래스·타입 선언)
    if (BINDING_OWNER_TYPES.has(n.type)) {
      const id = rec.id;

      if (isOxcNode(id) && id.type === 'Identifier') {
        names.add(id.name);
      }
    }

    // 파라미터
    if (FUNCTION_LIKE_TYPES.has(n.type)) {
      const params = rec.params;

      if (Array.isArray(params)) {
        for (const param of params) {
          if (isOxcNode(param)) {
            harvestPatternNames(param, names);
          }
        }
      }
    }

    // 지역 변수
    if (n.type === 'VariableDeclarator') {
      harvestPatternNames(n.id as Node, names);
    }

    // catch 파라미터
    if (n.type === 'CatchClause' && isOxcNode(rec.param)) {
      harvestPatternNames(rec.param as Node, names);
    }

    // 타입 파라미터
    if (n.type === 'TSTypeParameter' && isOxcNode(rec.name) && (rec.name as Node).type === 'Identifier') {
      names.add((rec.name as Node & { readonly name: string }).name);
    }

    const keys = visitorKeys[n.type];

    if (keys === undefined) {
      return;
    }

    for (const key of keys) {
      const value = rec[key];

      if (isOxcNode(value)) {
        visit(value);
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (isOxcNode(item)) {
            visit(item);
          }
        }
      }
    }
  };

  visit(root);

  return names;
};

const NORMALIZED_IGNORED_KEYS: ReadonlySet<string> = new Set([
  // TypeScript / declaration noise
  'typeAnnotation',
  'typeParameters',
  'typeArguments',
  'returnType',
  'implements',
  'declare',
  'definite',
  // Decorators / modifiers
  'decorators',
  'accessibility',
  'abstract',
  'override',
  'readonly',
  // Literal representation / directives
  'raw',
  'directive',
  // Export metadata
  'exportKind',
  'attributes',
  'specifiers',
  'source',
]);

const escapeFingerprintToken = (token: string): string => {
  // We use '\x00' as a join separator, so ensure tokens cannot contain it.
  return token.replace(/\x00/g, '\\0');
};

const pushIdentifierToken = (rec: Record<string, unknown>, diffs: string[], options: OxcFingerprintOptions): void => {
  const nameValue = rec.name;
  const name = typeof nameValue === 'string' ? nameValue : '';

  if (options.includeIdentifierNames) {
    diffs.push(`id:${name}`);

    return;
  }

  // 바인딩 집합이 있으면 내부 바인딩만 치환, 자유 식별자·프로퍼티 이름은 그대로 비교
  if (options.boundNames !== undefined && !options.boundNames.has(name)) {
    diffs.push(`id:${name}`);

    return;
  }

  diffs.push('$ID');
};

/**
 * 식별자가 "이름 위치"(참조가 아닌 이름)일 때 그 자식 키를 반환한다.
 * 프로퍼티명·멤버명·키는 바인딩 참조가 아니므로 치환하지 않고 그대로 비교해야 한다
 * (CLAUDE.md: 자유 식별자·프로퍼티 이름은 그대로 비교).
 */
const verbatimNameKey = (n: Node, rec: Record<string, unknown>): string | null => {
  switch (n.type) {
    case 'MemberExpression':
      return rec.computed === true ? null : 'property';
    case 'Property':
    case 'PropertyDefinition':
    case 'AccessorProperty':
    case 'MethodDefinition':
    case 'TSPropertySignature':
    case 'TSMethodSignature':
      return rec.computed === true ? null : 'key';
    case 'TSQualifiedName':
      return 'right';
    case 'TSEnumMember':
      return 'id';
    default:
      return null;
  }
};

const visitNodeChildren = (
  n: Node,
  rec: Record<string, unknown>,
  options: OxcFingerprintOptions,
  visit: (n: Node, verbatim: boolean) => void,
): void => {
  const keys = visitorKeys[n.type];

  if (keys === undefined) {
    return;
  }

  const nameKey = verbatimNameKey(n, rec);
  const sortedKeys = [...keys].sort();

  for (const key of sortedKeys) {
    if (options.ignoredKeys?.has(key)) {
      continue;
    }

    const value = rec[key];

    if (key === nameKey && isOxcNode(value)) {
      visit(value, true);

      continue;
    }

    if (isOxcNode(value)) {
      visit(value, false);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (isOxcNode(item)) {
          visit(item, false);
        }
      }
    }
  }
};

const createOxcFingerprintCore = (node: Node, options: OxcFingerprintOptions): string => {
  const diffs: string[] = [];

  const visit = (n: Node, verbatim: boolean) => {
    // Parenthesized expressions carry no semantic meaning; descend into the wrapped
    // expression without pushing the wrapper so `(a + b)` and `a + b` produce the same fingerprint.
    if (n.type === 'ParenthesizedExpression') {
      visit(n.expression, false);

      return;
    }

    // push Type
    if (n.type.length > 0) {
      diffs.push(n.type);
    }

    pushLiteralValue(n, diffs, options.includeLiteralValues);

    // push operator (scalar property, not in visitorKeys)
    const rec = n as unknown as Record<string, unknown>;
    const operatorValue = rec.operator;

    if (typeof operatorValue === 'string' && operatorValue.length > 0) {
      diffs.push(operatorValue);
    }

    // 계약 멤버의 optional(?)·readonly는 계약의 일부 — 정규형에 반영 (거짓병합 방지)
    if (n.type === 'TSPropertySignature' || n.type === 'TSMethodSignature' || n.type === 'TSIndexSignature') {
      if (rec.optional === true) {
        diffs.push('?');
      }

      if (rec.readonly === true) {
        diffs.push('readonly');
      }
    }

    // Identifier name handling — 이름 위치(프로퍼티·멤버·키)면 치환 없이 그대로 비교
    if (n.type === 'Identifier') {
      if (verbatim) {
        const nameValue = rec.name;

        diffs.push(`pname:${typeof nameValue === 'string' ? nameValue : ''}`);
      } else {
        pushIdentifierToken(rec, diffs, options);
      }
    }

    // Visit child nodes via visitorKeys (sorted for deterministic fingerprints)
    visitNodeChildren(n, rec, options, visit);
  };

  visit(node, false);

  const encoded = diffs.map(escapeFingerprintToken).join('\x00');

  return hashString(encoded);
};

/** 타입 선언은 본문 구조가 결정 그 자체 — 타입 키를 무시하면 안 된다 (CLAUDE.md duplicates 판정 절차). */
const TYPE_DECL_TYPES = new Set(['TSTypeAliasDeclaration', 'TSInterfaceDeclaration']);

// 타입 선언 본문은 결정 그 자체 — 타입 구조(annotation·parameters·arguments·returnType)와
// 리터럴을 보존하고, 선언-로컬 바인딩(자기 이름·타입파라미터)만 치환한다. 데코레이터·수식어
// 노이즈만 무시. typeArguments까지 무시하면 ReadonlyMap<string,A> ≡ ReadonlyMap<string,B>로
// 무관한 별칭이 충돌(FP)한다.
const TYPE_DECL_IGNORED_KEYS: ReadonlySet<string> = new Set(
  [...NORMALIZED_IGNORED_KEYS].filter(
    k => k !== 'typeAnnotation' && k !== 'typeParameters' && k !== 'typeArguments' && k !== 'returnType',
  ),
);

/**
 * 타입 선언(별칭·인터페이스) 본문 핑거프린트.
 * 리터럴·타입인자·멤버명·readonly/optional을 보존하고 선언-로컬 바인딩만 치환한다 —
 * "같은 구조의 계약/이름 변경"은 잡되 "같은 바깥 형태·다른 리터럴/타입인자"는 분리한다.
 */
const createTypeDeclBodyFingerprint = (node: Node): string =>
  createOxcFingerprintCore(node, {
    includeLiteralValues: true,
    includeIdentifierNames: false,
    ignoredKeys: TYPE_DECL_IGNORED_KEYS,
    boundNames: collectBindingNames(node),
  });

export const createOxcFingerprintExact = (node: Node): string =>
  createOxcFingerprintCore(node, { includeLiteralValues: true, includeIdentifierNames: true });

export const createOxcFingerprint = (node: Node): string =>
  createOxcFingerprintCore(node, { includeLiteralValues: true, includeIdentifierNames: false });

export const createOxcFingerprintShape = (node: Node): string =>
  TYPE_DECL_TYPES.has(node.type)
    ? createTypeDeclBodyFingerprint(node)
    : createOxcFingerprintCore(node, {
        includeLiteralValues: false,
        includeIdentifierNames: false,
        boundNames: collectBindingNames(node),
      });

/**
 * 외부에서 계산한 바인딩 집합으로 shape 핑거프린트 생성.
 * 비교 단위(함수 등) 내부의 부분 노드(문장·타입 참조)를 정렬·비교할 때
 * 단위 전체의 바인딩 컨텍스트를 유지하기 위해 사용한다.
 */
export const createOxcFingerprintShapeWithBindings = (node: Node, boundNames: ReadonlySet<string>): string =>
  createOxcFingerprintCore(node, {
    includeLiteralValues: false,
    includeIdentifierNames: false,
    boundNames,
  });

/**
 * 계약(interface / type alias의 타입 리터럴)의 멤버 목록을 반환한다.
 * interface와 type alias는 선언 구문이 달라도 같은 멤버 구조면 같은 계약이므로
 * (CLAUDE.md: 계약은 선언 구문과 무관하게 구조로 비교), 정규형을 멤버 기준으로 통일한다.
 */
const getContractMembers = (node: Node): ReadonlyArray<Node> | null => {
  if (node.type === 'TSInterfaceDeclaration') {
    const body = (node as Node & { readonly body: Node & { readonly body: ReadonlyArray<Node> } }).body;

    return body.body;
  }

  if (node.type === 'TSTypeAliasDeclaration') {
    const annotation = (node as Node & { readonly typeAnnotation: Node }).typeAnnotation;

    if (annotation.type === 'TSTypeLiteral') {
      return (annotation as Node & { readonly members: ReadonlyArray<Node> }).members;
    }
  }

  return null;
};

export const createOxcFingerprintNormalized = (node: Node): string => {
  // 계약: 선언 구문(interface vs type)을 지우고 멤버 구조만 정규형으로 비교한다.
  const members = getContractMembers(node);

  if (members !== null) {
    const boundNames = collectBindingNames(node);
    const parts = members.map(member =>
      createOxcFingerprintCore(member, {
        // 멤버의 판별 리터럴(kind: 'array')은 결정 — 보존해야 다른 종류가 충돌하지 않는다.
        includeLiteralValues: true,
        includeIdentifierNames: false,
        ignoredKeys: TYPE_DECL_IGNORED_KEYS,
        boundNames,
      }),
    );

    return hashString(`Contract\x00${parts.join('\x00')}`);
  }

  // 타입 리터럴이 아닌 타입 별칭(union·ReadonlyMap<...> 등): 본문 리터럴·타입인자를 보존한다.
  if (TYPE_DECL_TYPES.has(node.type)) {
    return createTypeDeclBodyFingerprint(node);
  }

  const normalized = normalizeForFingerprint(node);

  return createOxcFingerprintCore(normalized as Node, {
    includeLiteralValues: false,
    includeIdentifierNames: false,
    ignoredKeys: NORMALIZED_IGNORED_KEYS,
    boundNames: collectBindingNames(node),
  });
};
