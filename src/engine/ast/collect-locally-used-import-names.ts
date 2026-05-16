import { is } from '@zipbul/gildash';
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

  const collectObjectPatternBindings = (node: Node & Record<string, unknown>, target: Set<string>): void => {
    const properties = node.properties;

    if (!Array.isArray(properties)) {
      return;
    }

    for (const prop of properties) {
      const propNode = prop as Node & Record<string, unknown>;

      if (is.RestElement(propNode)) {
        collectBindingNames(propNode.argument as Node, target);
      } else {
        collectBindingNames(propNode.value as Node, target);
      }
    }
  };

  const collectArrayPatternBindings = (node: Node & Record<string, unknown>, target: Set<string>): void => {
    const elements = node.elements;

    if (!Array.isArray(elements)) {
      return;
    }

    for (const el of elements) {
      if (el === null || el === undefined) {
        continue;
      }

      const elNode = el as Node & Record<string, unknown>;
      const childNode = is.RestElement(elNode) ? (elNode.argument as Node) : (el as Node);

      collectBindingNames(childNode, target);
    }
  };

  // 패턴에서 바인딩 이름을 수집 (ObjectPattern, ArrayPattern, Identifier 등)
  const collectBindingNames = (pattern: Node, target: Set<string>): void => {
    const node = pattern as Node & Record<string, unknown>;

    if (is.Identifier(node)) {
      const name = node.name;

      if (typeof name === 'string') {
        target.add(name);
      }

      return;
    }

    if (is.ObjectPattern(node)) {
      collectObjectPatternBindings(node, target);

      return;
    }

    if (is.ArrayPattern(node)) {
      collectArrayPatternBindings(node, target);

      return;
    }

    if (is.AssignmentPattern(node)) {
      collectBindingNames(node.left as Node, target);
    }
  };

  // scope 진입 시 새 scope를 만들고 해당 노드의 직접 바인딩을 수집
  const collectScopeBindings = (node: Node): Set<string> => {
    const bindings = new Set<string>();
    const nodeType = node.type;

    if (nodeType !== 'FunctionDeclaration' && nodeType !== 'FunctionExpression' && nodeType !== 'ArrowFunctionExpression') {
      return bindings;
    }

    const nodeRecord = node as Node & Record<string, unknown>;
    const params = nodeRecord.params;

    if (Array.isArray(params)) {
      for (const param of params) {
        collectBindingNames(param as Node, bindings);
      }
    }

    return bindings;
  };

  // VariableDeclaration의 declarators에서 바인딩 수집
  const collectVarDeclarationBindings = (node: Node): Set<string> => {
    const bindings = new Set<string>();

    if (!is.VariableDeclaration(node)) {
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
      if (!is.AssignmentPattern(p)) {
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

  const recordImportedNameUse = (nodeRecord: Node & Record<string, unknown>): void => {
    const name = nodeRecord.name;

    if (typeof name === 'string' && importedNames.has(name) && !isInScope(name)) {
      used.add(name);
    }
  };

  const visitExportDefaultDeclaration = (nodeRecord: Node & Record<string, unknown>): void => {
    const declaration = nodeRecord.declaration as Node;

    if (!is.Identifier(declaration)) {
      visit(declaration, false);
    }
  };

  const visitExportDeclaration = (nodeType: string, nodeRecord: Node & Record<string, unknown>): void => {
    if (nodeType === 'ExportDefaultDeclaration') {
      visitExportDefaultDeclaration(nodeRecord);
    } else {
      // ExportNamedDeclaration: specifiers의 Identifier는 SKIP, declaration만 방문
      if (nodeRecord.declaration !== null && nodeRecord.declaration !== undefined) {
        visit(nodeRecord.declaration as Node, false);
      }
    }
  };

  const visitNodeOptional = (value: unknown): void => {
    if (value !== null && value !== undefined) {
      visit(value as Node, false);
    }
  };

  const registerNamedDeclInScope = (nodeRecord: Node & Record<string, unknown>): void => {
    const idNode = nodeRecord.id as Node & Record<string, unknown>;

    if (idNode === null || idNode === undefined) {
      return;
    }

    if (!is.Identifier(idNode)) {
      return;
    }

    const name = idNode.name;

    if (typeof name === 'string') {
      currentScope().add(name);
    }
  };

  const visitFunctionScope = (node: Node, nodeRecord: Node & Record<string, unknown>): void => {
    const newScope = collectScopeBindings(node);

    scopeStack.push(newScope);
    visitParamDefaults(node);
    visitNodeOptional(nodeRecord.body);
    scopeStack.pop();
  };

  const visitVariableDeclaration = (node: Node, nodeRecord: Node & Record<string, unknown>): void => {
    const bindings = collectVarDeclarationBindings(node);
    const topScope = currentScope();

    for (const name of bindings) {
      topScope.add(name);
    }

    const declarations = nodeRecord.declarations;

    if (!Array.isArray(declarations)) {
      return;
    }

    for (const decl of declarations) {
      const declNode = decl as Node & Record<string, unknown>;
      const id = declNode.id as Node & Record<string, unknown>;

      visitNodeOptional(id.typeAnnotation);
      visitNodeOptional(declNode.init);
    }
  };

  const visitTSInterfaceDeclaration = (nodeRecord: Node & Record<string, unknown>): void => {
    registerNamedDeclInScope(nodeRecord);

    const extendsArr = nodeRecord.extends;

    if (Array.isArray(extendsArr)) {
      for (const ext of extendsArr) {
        visit(ext as Node, false);
      }
    }

    visitNodeOptional(nodeRecord.body);
  };

  const visitBlockStatement = (nodeRecord: Node & Record<string, unknown>): void => {
    scopeStack.push(new Set());

    const body = nodeRecord.body;

    if (Array.isArray(body)) {
      for (const stmt of body) {
        visit(stmt as Node, false);
      }
    }

    scopeStack.pop();
  };

  const visitLoopWithScope = (nodeRecord: Node & Record<string, unknown>, kind: 'for' | 'forOf' | 'forIn'): void => {
    scopeStack.push(new Set());

    if (kind === 'for') {
      visitNodeOptional(nodeRecord.init);
      visitNodeOptional(nodeRecord.test);
      visitNodeOptional(nodeRecord.update);
    } else {
      visitNodeOptional(nodeRecord.left);
      visitNodeOptional(nodeRecord.right);
    }

    visitNodeOptional(nodeRecord.body);
    scopeStack.pop();
  };

  const visitCatchClause = (nodeRecord: Node & Record<string, unknown>): void => {
    scopeStack.push(new Set());

    const param = nodeRecord.param;

    if (param !== null && param !== undefined) {
      collectBindingNames(param as Node, currentScope());
    }

    visitNodeOptional(nodeRecord.body);
    scopeStack.pop();
  };

  const visitFunctionLike = (node: Node, nodeRecord: Node & Record<string, unknown>, isDeclaration: boolean): void => {
    if (isDeclaration) {
      registerNamedDeclInScope(nodeRecord);
    }

    visitFunctionScope(node, nodeRecord);
  };

  const visitTypeDeclaration = (nodeType: string, nodeRecord: Node & Record<string, unknown>): void => {
    registerNamedDeclInScope(nodeRecord);

    if (nodeType === 'ClassDeclaration') {
      visitNodeOptional(nodeRecord.superClass);
      visitNodeOptional(nodeRecord.body);
    } else if (nodeType === 'TSTypeAliasDeclaration') {
      visitNodeOptional(nodeRecord.typeAnnotation);
    } else {
      visitTSInterfaceDeclaration(nodeRecord);
    }
  };

  const visit = (node: Node, skipIdentifier: boolean): void => {
    const nodeRecord = node as Node & Record<string, unknown>;
    const nodeType = node.type;

    // Import/Export 선언 — 바인딩 선언이지 사용이 아님 (특수 처리)
    if (nodeType === 'ImportDeclaration') {
      return;
    }

    if (nodeType === 'ExportNamedDeclaration' || nodeType === 'ExportDefaultDeclaration') {
      visitExportDeclaration(nodeType, nodeRecord);

      return;
    }

    // Identifier — 실제 사용 판별
    if (nodeType === 'Identifier' && !skipIdentifier) {
      recordImportedNameUse(nodeRecord);

      return;
    }

    // VariableDeclaration — 현재 scope에 바인딩 추가
    if (nodeType === 'VariableDeclaration') {
      visitVariableDeclaration(node, nodeRecord);

      return;
    }

    // 함수 계열 — 새 scope 열기 (FunctionDeclaration은 이름도 현재 scope에 추가)
    if (nodeType === 'FunctionDeclaration' || nodeType === 'FunctionExpression' || nodeType === 'ArrowFunctionExpression') {
      visitFunctionLike(node, nodeRecord, nodeType === 'FunctionDeclaration');

      return;
    }

    // 타입/클래스 선언 — 이름을 현재 scope에 추가
    if (nodeType === 'ClassDeclaration' || nodeType === 'TSTypeAliasDeclaration' || nodeType === 'TSInterfaceDeclaration') {
      visitTypeDeclaration(nodeType, nodeRecord);

      return;
    }

    // BlockStatement — 새 block scope 열기 (변수 선언용)
    if (nodeType === 'BlockStatement') {
      visitBlockStatement(nodeRecord);

      return;
    }

    // ForStatement / ForOfStatement / ForInStatement — 루프 scope 처리
    if (nodeType === 'ForStatement' || nodeType === 'ForOfStatement' || nodeType === 'ForInStatement') {
      visitLoopWithScope(nodeRecord, nodeType === 'ForStatement' ? 'for' : 'forOf');

      return;
    }

    // CatchClause — param을 catch scope에 추가
    if (nodeType === 'CatchClause') {
      visitCatchClause(nodeRecord);

      return;
    }

    // 그 외 노드 — 자식 방문
    visitChildren(node);
  };

  const visitChildren = (node: Node): void => {
    forEachChildNode(node, child => visit(child, false));
  };

  visit(program, false);

  return used;
};
