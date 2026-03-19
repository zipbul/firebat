import type { Node } from 'oxc-parser';

import type { NodeValue } from '../types';

import { isNodeRecord, isOxcNode, isOxcNodeArray } from './oxc-ast-utils';

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
export const collectLocallyUsedImportNames = (program: NodeValue, importedNames: ReadonlySet<string>): Set<string> => {
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
  const collectBindingNames = (pattern: unknown, target: Set<string>): void => {
    if (!isOxcNode(pattern as Node)) {
      return;
    }

    const node = pattern as Node;

    if (!isNodeRecord(node)) {
      return;
    }

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
          if (isNodeRecord(prop)) {
            if (prop.type === 'RestElement') {
              collectBindingNames(prop.argument, target);
            } else {
              collectBindingNames(prop.value, target);
            }
          }
        }
      }

      return;
    }

    if (node.type === 'ArrayPattern') {
      const elements = node.elements;

      if (Array.isArray(elements)) {
        for (const el of elements) {
          if (el !== null && el !== undefined) {
            if (isNodeRecord(el) && (el as Node).type === 'RestElement') {
              collectBindingNames((el as Node & Record<string, unknown>).argument, target);
            } else {
              collectBindingNames(el, target);
            }
          }
        }
      }

      return;
    }

    if (node.type === 'AssignmentPattern') {
      collectBindingNames(node.left, target);
    }
  };

  // scope 진입 시 새 scope를 만들고 해당 노드의 직접 바인딩을 수집
  const collectScopeBindings = (node: Node): Set<string> => {
    const bindings = new Set<string>();

    if (!isNodeRecord(node)) {
      return bindings;
    }

    // FunctionDeclaration / FunctionExpression / ArrowFunctionExpression — 파라미터
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      const params = node.params;

      if (Array.isArray(params)) {
        for (const param of params) {
          collectBindingNames(param, bindings);
        }
      }
    }

    return bindings;
  };

  // VariableDeclaration의 declarators에서 바인딩 수집
  const collectVarDeclarationBindings = (node: Node): Set<string> => {
    const bindings = new Set<string>();

    if (!isNodeRecord(node) || node.type !== 'VariableDeclaration') {
      return bindings;
    }

    const declarations = node.declarations;

    if (!Array.isArray(declarations)) {
      return bindings;
    }

    for (const decl of declarations) {
      if (isNodeRecord(decl)) {
        collectBindingNames(decl.id, bindings);
      }
    }

    return bindings;
  };

  // params의 default initializer를 방문 (scope push 후 호출)
  const visitParamDefaults = (node: Node): void => {
    if (!isNodeRecord(node)) {
      return;
    }

    const params = node.params;

    if (!Array.isArray(params)) {
      return;
    }

    for (const param of params) {
      if (!isNodeRecord(param as Node)) {
        continue;
      }

      const p = param as Node & Record<string, unknown>;

      // AssignmentPattern: left = right (default value)
      if (p.type === 'AssignmentPattern') {
        const right = p.right;

        if (right !== null && right !== undefined) {
          visit(right as NodeValue, false);
        }
      }
    }
  };

  // ExportNamedDeclaration specifier의 local Identifier를 SKIP하기 위한 플래그
  // ExportDefaultDeclaration의 declaration이 Identifier인 경우도 SKIP

  const visit = (value: NodeValue, skipIdentifier: boolean): void => {
    if (isOxcNodeArray(value)) {
      for (const entry of value) {
        visit(entry, skipIdentifier);
      }

      return;
    }

    if (!isOxcNode(value)) {
      return;
    }

    const node = value;

    if (!isNodeRecord(node)) {
      return;
    }

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
      const declaration = node.declaration;

      if (declaration !== null && declaration !== undefined) {
        visit(declaration as NodeValue, false);
      }

      return;
    }

    // ExportDefaultDeclaration: declaration이 Identifier면 SKIP
    if (nodeType === 'ExportDefaultDeclaration') {
      const declaration = node.declaration;

      if (isOxcNode(declaration as Node) && isNodeRecord(declaration as Node) && (declaration as Node).type === 'Identifier') {
        // export default X — X를 사용으로 카운트하지 않음
        return;
      }

      // 그 외는 방문
      if (declaration !== null && declaration !== undefined) {
        visit(declaration as NodeValue, false);
      }

      return;
    }

    // Identifier — 실제 사용 판별
    if (nodeType === 'Identifier' && !skipIdentifier) {
      const name = node.name;

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
      const declarations = node.declarations;

      if (Array.isArray(declarations)) {
        for (const decl of declarations) {
          if (isNodeRecord(decl)) {
            // id의 typeAnnotation 방문 (타입 annotation 내 Identifier 수집)
            const id = decl.id;

            if (isNodeRecord(id as Node)) {
              const typeAnnotation = (id as Node & Record<string, unknown>).typeAnnotation;

              if (typeAnnotation !== null && typeAnnotation !== undefined) {
                visit(typeAnnotation as NodeValue, false);
              }
            }

            const init = decl.init;

            if (init !== null && init !== undefined) {
              visit(init as NodeValue, false);
            }
          }
        }
      }

      return;
    }

    // FunctionDeclaration — 함수 이름을 현재 scope에 추가, 새 scope 열기
    if (nodeType === 'FunctionDeclaration') {
      const idNode = node.id;

      if (isOxcNode(idNode as Node) && isNodeRecord(idNode as Node) && (idNode as Node).type === 'Identifier') {
        const name = (idNode as Node & Record<string, unknown>).name;

        if (typeof name === 'string') {
          currentScope().add(name);
        }
      }

      const newScope = collectScopeBindings(node);

      scopeStack.push(newScope);

      // params default initializer 방문
      visitParamDefaults(node);

      // body 방문
      const body = node.body;

      if (body !== null && body !== undefined) {
        visit(body as NodeValue, false);
      }

      scopeStack.pop();

      return;
    }

    // ClassDeclaration — 클래스 이름을 현재 scope에 추가
    if (nodeType === 'ClassDeclaration') {
      const idNode = node.id;

      if (isOxcNode(idNode as Node) && isNodeRecord(idNode as Node) && (idNode as Node).type === 'Identifier') {
        const name = (idNode as Node & Record<string, unknown>).name;

        if (typeof name === 'string') {
          currentScope().add(name);
        }
      }

      // superClass, body 방문
      const superClass = node.superClass;

      if (superClass !== null && superClass !== undefined) {
        visit(superClass as NodeValue, false);
      }

      const body = node.body;

      if (body !== null && body !== undefined) {
        visit(body as NodeValue, false);
      }

      return;
    }

    // TSTypeAliasDeclaration — 이름을 현재 scope에 추가
    if (nodeType === 'TSTypeAliasDeclaration') {
      const idNode = node.id;

      if (isOxcNode(idNode as Node) && isNodeRecord(idNode as Node) && (idNode as Node).type === 'Identifier') {
        const name = (idNode as Node & Record<string, unknown>).name;

        if (typeof name === 'string') {
          currentScope().add(name);
        }
      }

      // typeAnnotation 방문 (타입 참조 확인)
      const typeAnnotation = node.typeAnnotation;

      if (typeAnnotation !== null && typeAnnotation !== undefined) {
        visit(typeAnnotation as NodeValue, false);
      }

      return;
    }

    // TSInterfaceDeclaration — 이름을 현재 scope에 추가
    if (nodeType === 'TSInterfaceDeclaration') {
      const idNode = node.id;

      if (isOxcNode(idNode as Node) && isNodeRecord(idNode as Node) && (idNode as Node).type === 'Identifier') {
        const name = (idNode as Node & Record<string, unknown>).name;

        if (typeof name === 'string') {
          currentScope().add(name);
        }
      }

      // extends, body 방문
      const extendsArr = node.extends;

      if (Array.isArray(extendsArr)) {
        for (const ext of extendsArr) {
          visit(ext as NodeValue, false);
        }
      }

      const body = node.body;

      if (body !== null && body !== undefined) {
        visit(body as NodeValue, false);
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
      const body = node.body;

      if (body !== null && body !== undefined) {
        visit(body as NodeValue, false);
      }

      scopeStack.pop();

      return;
    }

    // BlockStatement — 새 block scope 열기 (변수 선언용)
    if (nodeType === 'BlockStatement') {
      scopeStack.push(new Set());

      const body = node.body;

      if (Array.isArray(body)) {
        for (const stmt of body) {
          visit(stmt as NodeValue, false);
        }
      }

      scopeStack.pop();

      return;
    }

    // ForStatement — init의 let/const 변수를 루프 scope에 추가
    if (nodeType === 'ForStatement') {
      scopeStack.push(new Set());

      const init = node.init;

      if (init !== null && init !== undefined) {
        visit(init as NodeValue, false);
      }

      const test = node.test;

      if (test !== null && test !== undefined) {
        visit(test as NodeValue, false);
      }

      const update = node.update;

      if (update !== null && update !== undefined) {
        visit(update as NodeValue, false);
      }

      const body = node.body;

      if (body !== null && body !== undefined) {
        visit(body as NodeValue, false);
      }

      scopeStack.pop();

      return;
    }

    // ForOfStatement / ForInStatement — left의 변수를 루프 scope에 추가
    if (nodeType === 'ForOfStatement' || nodeType === 'ForInStatement') {
      scopeStack.push(new Set());

      const left = node.left;

      if (left !== null && left !== undefined) {
        visit(left as NodeValue, false);
      }

      const right = node.right;

      if (right !== null && right !== undefined) {
        visit(right as NodeValue, false);
      }

      const body = node.body;

      if (body !== null && body !== undefined) {
        visit(body as NodeValue, false);
      }

      scopeStack.pop();

      return;
    }

    // CatchClause — param을 catch scope에 추가
    if (nodeType === 'CatchClause') {
      scopeStack.push(new Set());

      const param = node.param;

      if (param !== null && param !== undefined) {
        collectBindingNames(param, currentScope());
      }

      const body = node.body;

      if (body !== null && body !== undefined) {
        visit(body as NodeValue, false);
      }

      scopeStack.pop();

      return;
    }

    // 그 외 노드 — 자식 방문
    const entries = Object.entries(node);

    for (const [key, childValue] of entries) {
      if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') {
        continue;
      }

      visit(childValue as NodeValue, false);
    }
  };

  visit(program, false);

  return used;
};
