import type { Node } from 'oxc-parser';

import { ScopeTracker, walk } from '@zipbul/gildash';

/**
 * import된 이름 중 파일 내에서 export 외에 로컬로 사용되는 이름들을 반환한다.
 * scope-aware: shadow 변수(function, block, for, catch, class)가 있는 경우 정확히 판별한다.
 *
 * FP 없음. FN 방향 보수적:
 * - MemberExpression property (`obj.X`)를 사용으로 카운트 (실제로는 프로퍼티 접근)
 * - 객체 리터럴 키 (`{ X: 1 }`)를 사용으로 카운트
 * 모두 "사용됨"으로 과잉 판정 → 탐지 누락(FN) 방향. 실전 빈도 극히 낮음.
 *
 * 구현: oxc-walker의 `ScopeTracker`가 모든 binding (import / function decl /
 * function params / class decl / variable bindings (let/const/var) / catch
 * params)을 자동으로 scope에 등록한다. shadow 판정은 가장 안쪽 declaration의
 * 종류가 `'Import'`가 아니면 (즉 non-import binding이 같은 이름을 가리면)
 * import 사용 아님.
 */
export const collectLocallyUsedImportNames = (program: Node, importedNames: ReadonlySet<string>): Set<string> => {
  if (importedNames.size === 0) {
    return new Set();
  }

  const used = new Set<string>();
  // Identifier `start` offsets that should be treated as binding-only sites
  // even though they are bare Identifier AST nodes:
  //   - `export { X }` specifier locals
  //   - `export default X` bare-Identifier declaration
  // ScopeTracker does not flag these as "binding" — we mark them explicitly.
  const skipIdentifierStarts = new Set<number>();
  const scopeTracker = new ScopeTracker();

  walk(program, {
    scopeTracker,
    enter(node) {
      // ImportDeclaration: ScopeTracker auto-declares specifiers; the inner
      // Identifiers are binding sites, not uses — skip the subtree entirely.
      if (node.type === 'ImportDeclaration') {
        this.skip();

        return;
      }

      // `export { X }` / `export { X as Y }`: specifier locals are re-exports,
      // not uses. The `declaration` child (if any) is walked normally.
      if (node.type === 'ExportNamedDeclaration') {
        for (const spec of node.specifiers) {
          if (spec.local.type === 'Identifier') {
            skipIdentifierStarts.add(spec.local.start);
          }
        }

        return;
      }

      // `export default X`: bare-Identifier declaration is a re-export.
      // Non-Identifier declarations (function/class/expression) are walked.
      if (node.type === 'ExportDefaultDeclaration') {
        if (node.declaration.type === 'Identifier') {
          skipIdentifierStarts.add(node.declaration.start);
        }

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

      // ScopeTracker.getDeclaration walks inner-out. Hit on the import itself
      // means this Identifier is an import use; any other declaration kind
      // means the name is shadowed in scope.
      const declaration = scopeTracker.getDeclaration(name);

      if (declaration !== null && declaration.type !== 'Import') {
        return;
      }

      used.add(name);
    },
  });

  return used;
};
