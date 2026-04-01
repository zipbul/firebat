import type { Node } from 'oxc-parser';

import { forEachChildNode } from './oxc-ast-utils';

/**
 * import된 이름 중 파일 내에서 export 외에 로컬로 사용되는 이름들을 반환한다.
 * scope-aware: shadow 변수(function, block, for, catch)가 있는 경우 정확히 판별한다.
 *
 * FP 없음. FN 방향 보수적:
 * - MemberExpression property (`obj.X`)를 사용으로 카운트 (실제로는 프로퍼티 접근)
 * - 객체 리터럴 키 (`{ X: 1 }`)를 사용으로 카운트
 * - named function expression 이름 scope 미등록
 * - enum/namespace 선언 scope 미등록
 * 모두 "사용됨"으로 과잉 판정 → 탐지 누락(FN) 방향. 실전 빈도 극히 낮음.
 */
export const collectLocallyUsedImportNames = (program: Node, importedNames: ReadonlySet<string>): Set<string> => {
  const used = new Set<string>();
  // scopeStack: 각 원소는 해당 scope에서 선언된 이름의 Set
  const scopeStack: Array<Set<string>> = [new Set()];

  const currentScope = (): Set<string> => scopeStack[scopeStack.length - 1] ?? new Set();

  const isInScope = (name: string): boolean => {
    for (let i = scopeStack.length - 1; i >= 0; i -= 1) {
      const scope = scopeStack[i];

      if (scope !== undefined && scope.has(name)) {
        return true;
      }
    }

    return false;
  };

  // 패턴에서 바인딩 이름을 수집 (ObjectPattern, ArrayPattern, Identifier 등)
  const collectBindingNames = (pattern: Node, target: Set<string>): void => {
    const node = pattern as Node & Record<string, unknown>;

    if (node.type === 'Identifier') {
      const name = node.name;

      if (typeof name === 'string') {
        target.add(name);
      }

      return;
    }

    if (node.type === 'ObjectPattern') {
      const properties = node.properties;

      if (Array.isArray(properties)) {
        for (const prop of properties) {
          const propNode = prop as Node & Record<string, unknown>;

          if (propNode.type === 'RestElement') {
            collectBindingNames(propNode.argument as Node, target);
          } else {
            collectBindingNames(propNode.value as Node, target);
          }
        }
      }

      return;
    }

    if (node.type === 'ArrayPattern') {
      const elements = node.elements;

      if (Array.isArray(elements)) {
        for (const el of elements) {
          if (el === null || el === undefined) {
            continue;
          }

          const elNode = el as Node & Record<string, unknown>;

          if (elNode.type === 'RestElement') {
            collectBindingNames(elNode.argument as Node, target);
          } else {
            collectBindingNames(el as Node, target);
          }
        }
      }

      return;
    }

    if (node.type === 'AssignmentPattern') {
      collectBindingNames(node.left as Node, target);
    }
  };

  // scope 진입 시 새 scope를 만들고 해당 노드의 직접 바인딩을 수집
  const collectScopeBindings = (node: Node): Set<string> => {
    const bindings = new Set<string>();

    // FunctionDeclaration / FunctionExpression / ArrowFunctionExpression — 파라미터
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      const nodeRecord = node as Node & Record<string, unknown>;
      const params = nodeRecord.params;

      if (Array.isArray(params)) {
        for (const param of params) {
          collectBindingNames(param as Node, bindings);
        }
      }
    }

    return bindings;
  };

  // VariableDeclaration의 declarators에서 바인딩 수집
  const collectVarDeclarationBindings = (node: Node): Set<string> => {
    const bindings = new Set<string>();

    if (node.type !== 'VariableDeclaration') {
      return bindings;
    }

    const nodeRecord = node as Node & Record<string, unknown>;
    const declarations = nodeRecord.declarations;

    if (!Array.isArray(declarations)) {
      return bindings;
    }

    for (const decl of declarations) {
      const declNode = decl as Node & Record<string, unknown>;

      collectBindingNames(declNode.id as Node, bindings);
    }

    return bindings;
  };

  // params의 default initializer를 방문 (scope push 후 호출)
  const visitParamDefaults = (node: Node): void => {
    const nodeRecord = node as Node & Record<string, unknown>;
    const params = nodeRecord.params;

    if (!Array.isArray(params)) {
      return;
    }

    for (const param of params) {
      const p = param as Node & Record<string, unknown>;

      // AssignmentPattern: left = right (default value)
      if (p.type !== 'AssignmentPattern') {
        continue;
      }

      const right = p.right;

      if (right !== null && right !== undefined) {
        visit(right as Node, false);
      }
    }
  };

  // ExportNamedDeclaration specifier의 local Identifier를 SKIP하기 위한 플래그
  // ExportDefaultDeclaration의 declaration이 Identifier인 경우도 SKIP

  const visit = (node: Node, skipIdentifier: boolean): void => {
    const nodeRecord = node as Node & Record<string, unknown>;
    const nodeType = node.type;

    // ImportDeclaration — specifiers의 Identifier는 SKIP (바인딩 선언이지 사용이 아님)
    if (nodeType === 'ImportDeclaration') {
      // ImportDeclaration 자체는 방문하지 않음 (specifiers의 Identifier를 사용으로 카운트 방지)
      return;
    }

    // ExportNamedDeclaration: specifiers의 Identifier는 SKIP
    if (nodeType === 'ExportNamedDeclaration') {
      // specifiers의 local/exported Identifier는 export 자체이므로 SKIP
      // declaration이 있으면 방문 (export const X = ... 패턴)
      const declaration = nodeRecord.declaration;

      if (declaration !== null && declaration !== undefined) {
        visit(declaration as Node, false);
      }

      return;
    }

    // ExportDefaultDeclaration: declaration이 Identifier면 SKIP
    if (nodeType === 'ExportDefaultDeclaration') {
      const declaration = nodeRecord.declaration as Node;

      if (declaration.type === 'Identifier') {
        // export default X — X를 사용으로 카운트하지 않음
        return;
      }

      // 그 외는 방문
      visit(declaration, false);

      return;
    }

    // Identifier — 실제 사용 판별
    if (nodeType === 'Identifier' && !skipIdentifier) {
      const name = nodeRecord.name;

      if (typeof name === 'string' && importedNames.has(name)) {
        if (!isInScope(name)) {
          used.add(name);
        }
      }

      return;
    }

    // VariableDeclaration — 현재 scope에 바인딩 추가
    if (nodeType === 'VariableDeclaration') {
      const bindings = collectVarDeclarationBindings(node);
      const topScope = currentScope();

      for (const name of bindings) {
        topScope.add(name);
      }

      // declarations의 init과 id의 typeAnnotation을 방문
      const declarations = nodeRecord.declarations;

      if (Array.isArray(declarations)) {
        for (const decl of declarations) {
          const declNode = decl as Node & Record<string, unknown>;
          // id의 typeAnnotation 방문 (타입 annotation 내 Identifier 수집)
          const id = declNode.id as Node & Record<string, unknown>;
          const typeAnnotation = id.typeAnnotation;

          if (typeAnnotation !== null && typeAnnotation !== undefined) {
            visit(typeAnnotation as Node, false);
          }

          const init = declNode.init;

          if (init !== null && init !== undefined) {
            visit(init as Node, false);
          }
        }
      }

      return;
    }

    // FunctionDeclaration — 함수 이름을 현재 scope에 추가, 새 scope 열기
    if (nodeType === 'FunctionDeclaration') {
      const idNode = nodeRecord.id as Node & Record<string, unknown>;

      if (idNode !== null && idNode !== undefined && idNode.type === 'Identifier') {
        const name = idNode.name;

        if (typeof name === 'string') {
          currentScope().add(name);
        }
      }

      const newScope = collectScopeBindings(node);

      scopeStack.push(newScope);

      // params default initializer 방문
      visitParamDefaults(node);

      // body 방문
      const body = nodeRecord.body;

      if (body !== null && body !== undefined) {
        visit(body as Node, false);
      }

      scopeStack.pop();

      return;
    }

    // ClassDeclaration — 클래스 이름을 현재 scope에 추가
    if (nodeType === 'ClassDeclaration') {
      const idNode = nodeRecord.id as Node & Record<string, unknown>;

      if (idNode !== null && idNode !== undefined && idNode.type === 'Identifier') {
        const name = idNode.name;

        if (typeof name === 'string') {
          currentScope().add(name);
        }
      }

      // superClass, body 방문
      const superClass = nodeRecord.superClass;

      if (superClass !== null && superClass !== undefined) {
        visit(superClass as Node, false);
      }

      const body = nodeRecord.body;

      if (body !== null && body !== undefined) {
        visit(body as Node, false);
      }

      return;
    }

    // TSTypeAliasDeclaration — 이름을 현재 scope에 추가
    if (nodeType === 'TSTypeAliasDeclaration') {
      const idNode = nodeRecord.id as Node & Record<string, unknown>;

      if (idNode !== null && idNode !== undefined && idNode.type === 'Identifier') {
        const name = idNode.name;

        if (typeof name === 'string') {
          currentScope().add(name);
        }
      }

      // typeAnnotation 방문 (타입 참조 확인)
      const typeAnnotation = nodeRecord.typeAnnotation;

      if (typeAnnotation !== null && typeAnnotation !== undefined) {
        visit(typeAnnotation as Node, false);
      }

      return;
    }

    // TSInterfaceDeclaration — 이름을 현재 scope에 추가
    if (nodeType === 'TSInterfaceDeclaration') {
      const idNode = nodeRecord.id as Node & Record<string, unknown>;

      if (idNode !== null && idNode !== undefined && idNode.type === 'Identifier') {
        const name = idNode.name;

        if (typeof name === 'string') {
          currentScope().add(name);
        }
      }

      // extends, body 방문
      const extendsArr = nodeRecord.extends;

      if (Array.isArray(extendsArr)) {
        for (const ext of extendsArr) {
          visit(ext as Node, false);
        }
      }

      const body = nodeRecord.body;

      if (body !== null && body !== undefined) {
        visit(body as Node, false);
      }

      return;
    }

    // FunctionExpression / ArrowFunctionExpression — 새 scope 열기
    if (nodeType === 'FunctionExpression' || nodeType === 'ArrowFunctionExpression') {
      const newScope = collectScopeBindings(node);

      scopeStack.push(newScope);

      // params default initializer 방문
      visitParamDefaults(node);

      // body 방문
      const body = nodeRecord.body;

      if (body !== null && body !== undefined) {
        visit(body as Node, false);
      }

      scopeStack.pop();

      return;
    }

    // BlockStatement — 새 block scope 열기 (변수 선언용)
    if (nodeType === 'BlockStatement') {
      scopeStack.push(new Set());

      const body = nodeRecord.body;

      if (Array.isArray(body)) {
        for (const stmt of body) {
          visit(stmt as Node, false);
        }
      }

      scopeStack.pop();

      return;
    }

    // ForStatement — init의 let/const 변수를 루프 scope에 추가
    if (nodeType === 'ForStatement') {
      scopeStack.push(new Set());

      const init = nodeRecord.init;

      if (init !== null && init !== undefined) {
        visit(init as Node, false);
      }

      const test = nodeRecord.test;

      if (test !== null && test !== undefined) {
        visit(test as Node, false);
      }

      const update = nodeRecord.update;

      if (update !== null && update !== undefined) {
        visit(update as Node, false);
      }

      const body = nodeRecord.body;

      if (body !== null && body !== undefined) {
        visit(body as Node, false);
      }

      scopeStack.pop();

      return;
    }

    // ForOfStatement / ForInStatement — left의 변수를 루프 scope에 추가
    if (nodeType === 'ForOfStatement' || nodeType === 'ForInStatement') {
      scopeStack.push(new Set());

      const left = nodeRecord.left;

      if (left !== null && left !== undefined) {
        visit(left as Node, false);
      }

      const right = nodeRecord.right;

      if (right !== null && right !== undefined) {
        visit(right as Node, false);
      }

      const body = nodeRecord.body;

      if (body !== null && body !== undefined) {
        visit(body as Node, false);
      }

      scopeStack.pop();

      return;
    }

    // CatchClause — param을 catch scope에 추가
    if (nodeType === 'CatchClause') {
      scopeStack.push(new Set());

      const param = nodeRecord.param;

      if (param !== null && param !== undefined) {
        collectBindingNames(param as Node, currentScope());
      }

      const body = nodeRecord.body;

      if (body !== null && body !== undefined) {
        visit(body as Node, false);
      }

      scopeStack.pop();

      return;
    }

    // 그 외 노드 — 자식 방문
    forEachChildNode(node, child => visit(child, false));
  };

  visit(program, false);

  return used;
};
