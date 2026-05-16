import type { Node } from 'oxc-parser';

import { ScopeTracker, walk } from '@zipbul/gildash';

/**
 * import된 이름 중 파일 내에서 export 외에 로컬로 사용되는 이름들을 반환한다.
 * scope-aware: shadow 변수(function, block, for, catch, class, TS type alias,
 * TS interface)가 있는 경우 정확히 판별한다.
 *
 * FP 없음. FN 방향 보수적:
 * - MemberExpression property (`obj.X`)를 사용으로 카운트 (실제로는 프로퍼티 접근)
 * - 객체 리터럴 키 (`{ X: 1 }`)를 사용으로 카운트
 * 모두 "사용됨"으로 과잉 판정 → 탐지 누락(FN) 방향. 실전 빈도 극히 낮음.
 *
 * 구현: oxc-walker의 `ScopeTracker`가 import / function decl / function params /
 * class decl / variable bindings (let/const/var) / catch params 를 자동으로
 * scope에 등록한다. shadow 판정은 가장 안쪽 declaration의 종류가 `'Import'`가
 * 아니면 (즉 non-import binding이 같은 이름을 가리면) import 사용 아님.
 *
 * ScopeTracker 미처리 영역(TSTypeAliasDeclaration / TSInterfaceDeclaration /
 * TSEnumDeclaration / TSModuleDeclaration의 id)은 firebat 자체 보조 stack으로
 * 추적해 nested-scope shadow도 정확히 잡는다.
 */
export const collectLocallyUsedImportNames = (program: Node, importedNames: ReadonlySet<string>): Set<string> => {
  if (importedNames.size === 0) {
    return new Set();
  }

  const used = new Set<string>();
  // Identifier `start` offsets to skip even though they're bare Identifier
  // nodes: export specifier locals/exporteds and `export default X` bare ids.
  const skipIdentifierStarts = new Set<number>();
  const scopeTracker = new ScopeTracker();
  // Parallel shadow stack for TS declaration types that ScopeTracker doesn't
  // track. Pushed on scope-creating nodes (Block/For*/Catch/Function/Class)
  // and popped on leave so nested-scope-local type aliases shadow imports
  // only within their lexical scope.
  const tsShadowStack: Array<Set<string>> = [new Set<string>()];
  const tsShadowed = (name: string): boolean => tsShadowStack.some(s => s.has(name));
  const SCOPE_NODE_TYPES: ReadonlySet<string> = new Set([
    'BlockStatement',
    'ForStatement',
    'ForOfStatement',
    'ForInStatement',
    'CatchClause',
    'FunctionDeclaration',
    'FunctionExpression',
    'ArrowFunctionExpression',
    'ClassDeclaration',
    'ClassExpression',
    'StaticBlock',
  ]);

  walk(program, {
    scopeTracker,
    enter(node) {
      // ImportDeclaration: ScopeTracker auto-declares specifiers.
      if (node.type === 'ImportDeclaration') {
        this.skip();

        return;
      }

      // `export { X }` / `export { X as Y }` / `export { X } from './a'` —
      // specifier locals AND exporteds are re-export references, never local
      // uses. If there's no declaration alongside, skip the whole subtree to
      // avoid walking specifier identifiers at all.
      if (node.type === 'ExportNamedDeclaration') {
        for (const spec of node.specifiers) {
          if (spec.local.type === 'Identifier') {
            skipIdentifierStarts.add(spec.local.start);
          }

          if (spec.exported.type === 'Identifier') {
            skipIdentifierStarts.add(spec.exported.start);
          }
        }

        if (node.declaration === null) {
          this.skip();
        }

        return;
      }

      // `export default X`: bare-Identifier declaration is a re-export.
      if (node.type === 'ExportDefaultDeclaration') {
        if (node.declaration.type === 'Identifier') {
          skipIdentifierStarts.add(node.declaration.start);

          this.skip();
        }

        return;
      }

      // Track TS-only declarations whose ids ScopeTracker ignores.
      if (
        node.type === 'TSTypeAliasDeclaration' ||
        node.type === 'TSInterfaceDeclaration' ||
        node.type === 'TSEnumDeclaration' ||
        node.type === 'TSModuleDeclaration'
      ) {
        const idName = node.id?.type === 'Identifier' ? node.id.name : null;
        const top = tsShadowStack[tsShadowStack.length - 1];

        if (idName !== null && top !== undefined) {
          top.add(idName);
        }
      }

      // Push a TS-shadow scope for every scope-creating node we expect
      // ScopeTracker to push.
      if (SCOPE_NODE_TYPES.has(node.type)) {
        tsShadowStack.push(new Set());

        return;
      }

      if (node.type !== 'Identifier') {
        return;
      }

      if (skipIdentifierStarts.has(node.start)) {
        return;
      }

      const name = node.name;

      if (!importedNames.has(name)) {
        return;
      }

      if (tsShadowed(name)) {
        return;
      }

      const declaration = scopeTracker.getDeclaration(name);

      if (declaration !== null && declaration.type !== 'Import') {
        return;
      }

      used.add(name);
    },
    leave(node) {
      if (SCOPE_NODE_TYPES.has(node.type)) {
        tsShadowStack.pop();
      }
    },
  });

  return used;
};
