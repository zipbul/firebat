import type { Node } from 'oxc-parser';

import { walkOxcTree } from './oxc-ast-utils';

// ─── 명세이름 identity 게이트의 공용 수집기 ──────────────────────────────────
//
// CLAUDE.md 공통 원칙: 명세가 정의한 전역 이름(Promise/Error/Object/Reflect…)은 대상의
// identity가 확인될 때만 명세 사실로 취급한다. 파일이 같은 이름의 **런타임 바인딩**
// (변수·함수·클래스·enum·import·파라미터·catch·대입)을 선언/생성하면 그 이름이 전역
// 빌트인을 가리킨다는 것이 닫히지 않으므로, 그 이름을 근거로 W를 만들지 않는다(보류).
// 스코프체인 해석의 보수적 폐포다 — 사용처에 닿지 않는 스코프의 섀도잉도 보류시키지만
// 오차는 K방향(FN)뿐이고, 전역 빌트인 이름의 재선언은 극히 드물어 비용이 무시된다.
//
// ambient `declare`는 섀도잉이 아니다: 런타임 바인딩을 만들지 않고(emit 없음) 전역의
// 존재를 선언하는 명세 사실이다 — 그 서브트리는 통째로 건너뛴다.

/**
 * Collect the binding identifiers a pattern introduces — plain `p`, default `p = …`,
 * rest `...p`, destructured `{ p }` / `[p]` (recursively), and TS parameter properties.
 * Only true binding positions are added; a computed key (`{ [c]: v }`) contributes `v`,
 * never `c`.
 */
export const collectPatternBindingNames = (pattern: Node, names: Set<string>): void => {
  switch (pattern.type) {
    case 'Identifier':
      if (typeof pattern.name === 'string') {
        names.add(pattern.name);
      }

      break;
    case 'AssignmentPattern':
      collectPatternBindingNames(pattern.left, names);
      break;
    case 'RestElement':
      collectPatternBindingNames(pattern.argument, names);
      break;
    case 'ArrayPattern':
      for (const element of pattern.elements) {
        if (element !== null) {
          collectPatternBindingNames(element, names);
        }
      }

      break;
    case 'ObjectPattern':
      for (const property of pattern.properties) {
        if (property.type === 'RestElement') {
          collectPatternBindingNames(property.argument, names);
        } else {
          collectPatternBindingNames(property.value, names);
        }
      }

      break;
    case 'TSParameterProperty':
      collectPatternBindingNames(pattern.parameter, names);
      break;
    default:
      break;
  }
};

/** Unwrap TS value-preserving wrappers so `(globalThis as X).Object = …` is still seen. */
const unwrapTsValueWrappers = (node: Node): Node => {
  let current = node;

  while (
    current.type === 'TSAsExpression' ||
    current.type === 'TSSatisfiesExpression' ||
    current.type === 'TSNonNullExpression' ||
    current.type === 'TSTypeAssertion' ||
    current.type === 'ParenthesizedExpression'
  ) {
    current = (current as Node & { readonly expression: Node }).expression;
  }

  return current;
};

/**
 * The subset of `watched` global names that the file shadows with a RUNTIME binding
 * (declaration, import, param, catch) or mutates by assignment — `Name = …` and the
 * member form `globalThis.Name = …` (window/self likewise) both un-confirm the global
 * identity. Ambient `declare` subtrees are skipped (no runtime binding — they assert
 * the global exists).
 */
export const collectShadowedNames = (program: Node, watched: ReadonlySet<string>): ReadonlySet<string> => {
  const shadowed = new Set<string>();

  const addPattern = (pattern: Node): void => {
    const names = new Set<string>();

    collectPatternBindingNames(pattern, names);

    for (const name of names) {
      if (watched.has(name)) {
        shadowed.add(name);
      }
    }
  };

  const addId = (id: Node | null | undefined): void => {
    if (id !== null && id !== undefined && id.type === 'Identifier' && watched.has(id.name)) {
      shadowed.add(id.name);
    }
  };

  const isAmbient = (node: Node): boolean => (node as Node & { readonly declare?: boolean }).declare === true;

  walkOxcTree(program, node => {
    switch (node.type) {
      case 'VariableDeclaration':
        if (isAmbient(node)) {
          return false;
        }

        break;
      case 'VariableDeclarator':
        addPattern(node.id);
        break;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        if (isAmbient(node)) {
          return false;
        }

        addId((node as Node & { readonly id?: Node | null }).id);

        for (const param of (node as Node & { readonly params: ReadonlyArray<Node> }).params) {
          addPattern(param);
        }

        break;
      }
      case 'ClassDeclaration':
      case 'ClassExpression':
      case 'TSEnumDeclaration':
      case 'TSModuleDeclaration':
        if (isAmbient(node)) {
          return false;
        }

        addId((node as Node & { readonly id?: Node | null }).id);
        break;
      case 'ImportDeclaration': {
        // `import type …` creates NO runtime binding — the runtime value is still the
        // global (same reasoning as ambient `declare`) → not a shadow.
        if ((node as Node & { readonly importKind?: string }).importKind === 'type') {
          return false;
        }

        for (const spec of (node as Node & { readonly specifiers: ReadonlyArray<Node> }).specifiers) {
          if ((spec as Node & { readonly importKind?: string }).importKind === 'type') {
            continue;
          }

          addId((spec as Node & { readonly local: Node }).local);
        }

        break;
      }
      case 'TSImportEqualsDeclaration':
        // `import X = require('…')` binds a runtime value — a shadow.
        addId((node as Node & { readonly id?: Node | null }).id);
        break;
      case 'AssignmentExpression': {
        // `X = fake` is not a declaration but mutates what the free name refers to at
        // runtime — after it, the name's global identity is no longer a closed fact.
        // The member form `globalThis.X = fake` (window/self likewise) mutates the SAME
        // binding (a bare global read IS a globalThis property read), so it un-confirms
        // the identity identically — both close on the file AST.
        const left = (node as Node & { readonly left: Node }).left;

        addId(left);

        if (left.type === 'MemberExpression') {
          const member = left as Node & { readonly object: Node; readonly property: Node; readonly computed?: boolean };
          const objectNode = unwrapTsValueWrappers(member.object);
          const isGlobalObject =
            objectNode.type === 'Identifier' &&
            (objectNode.name === 'globalThis' || objectNode.name === 'window' || objectNode.name === 'self');

          if (isGlobalObject) {
            if (member.computed !== true) {
              addId(member.property);
            } else if (
              member.property.type === 'Literal' &&
              typeof (member.property as Node & { readonly value?: unknown }).value === 'string'
            ) {
              const key = (member.property as Node & { readonly value: string }).value;

              if (watched.has(key)) {
                shadowed.add(key);
              }
            }
          }
        }

        break;
      }
      case 'CatchClause': {
        const param = (node as Node & { readonly param: Node | null }).param;

        if (param !== null) {
          addPattern(param);
        }

        break;
      }
      default:
        break;
    }

    return true;
  });

  return shadowed;
};
