import type { Function as OxcFunction, Node } from 'oxc-parser';

import { buildLineOffsets, getLineColumn, walk } from '@zipbul/gildash';

import type { WasteFinding } from '..';
import type { BitSet, ParsedFile } from './types';

import { collectOxcNodes, forEachChildNode, isFunctionNode, isOxcNode } from './ast';
import { analyzeFunctionBody, bindingKey, collectLocalVarIndexes, collectParameterBindings, collectVariables } from './dataflow';
import { buildDeclScopeMap } from './dataflow/variable-collector';

interface NestedFunctionContext {
  /**
   * CFG node ids whose payload includes one or more nested functions. The CFG
   * delivers a nested function's body as a single payload reachable from its
   * declaration site, so each entryNodeId stands for "control reached a closure
   * that can fire at any time after this point."
   */
  readonly entryNodeIds: number[];
  /**
   * For each entry, the *outer* binding `varIndex`es that the nested function (or
   * its own nested functions, transitively) reads. A def whose `varIndex` is in
   * this set and whose `defId` reaches the entry is closure-captured.
   */
  readonly capturedVarIndexesByEntry: Map<number, Set<number>>;
}

/**
 * Collect outer-binding varIndexes that this nested function captures by reading.
 *
 * "Outer" is decided by varIndex membership in `localIndexByName`, which is keyed
 * by `bindingKey(name, declScope)` — same-named inner shadows resolve to a
 * different scope and therefore are never registered as outer bindings. This is
 * why the closure check is bindingKey-driven rather than name-driven.
 */
const collectCapturedVarIndexesFromFunction = (
  nestedFunction: Node,
  localIndexByName: Map<string, number>,
  declScopeByIdLocation: ReadonlyMap<number, string>,
  out: Set<number>,
): void => {
  const nestedUsages = collectVariables(nestedFunction, { includeNestedFunctions: true, declScopeByIdLocation });

  for (const u of nestedUsages) {
    if (!u.isRead) {
      continue;
    }

    const idx = localIndexByName.get(bindingKey(u.name, u.declScope));

    if (typeof idx === 'number') {
      out.add(idx);
    }
  }
};

const buildNestedFunctionContext = (
  nodePayloads: ReadonlyArray<Node | ReadonlyArray<Node> | undefined>,
  localIndexByName: Map<string, number>,
  declScopeByIdLocation: ReadonlyMap<number, string>,
): NestedFunctionContext => {
  const entryNodeIds: number[] = [];
  const capturedVarIndexesByEntry = new Map<number, Set<number>>();

  for (let nodeId = 0; nodeId < nodePayloads.length; nodeId += 1) {
    const payload = nodePayloads[nodeId];

    if (!payload) {
      continue;
    }

    const payloadNodes: ReadonlyArray<Node> = Array.isArray(payload) ? (payload as ReadonlyArray<Node>) : [payload as Node];
    const nested = payloadNodes.flatMap(pn => collectOxcNodes(pn, n => isFunctionNode(n)));

    if (nested.length === 0) {
      continue;
    }

    const captured = new Set<number>();

    for (const nestedFunction of nested) {
      collectCapturedVarIndexesFromFunction(nestedFunction, localIndexByName, declScopeByIdLocation, captured);
    }

    if (captured.size === 0) {
      continue;
    }

    entryNodeIds.push(nodeId);
    capturedVarIndexesByEntry.set(nodeId, captured);
  }

  return { entryNodeIds, capturedVarIndexesByEntry };
};

const isDefClosureCaptured = (
  defId: number,
  varIndex: number,
  nestedCtx: NestedFunctionContext,
  reachingInByNode: ReadonlyArray<BitSet>,
): boolean => {
  for (const entryNodeId of nestedCtx.entryNodeIds) {
    const capturedSet = nestedCtx.capturedVarIndexesByEntry.get(entryNodeId);

    if (!capturedSet || !capturedSet.has(varIndex)) {
      continue;
    }

    const reaching = reachingInByNode[entryNodeId];

    if (reaching && reaching.has(defId)) {
      return true;
    }
  }

  return false;
};

// ── Escape analysis (case 6/7) ────────────────────────────────────────────────
//
// "Meaningful use" = a use site whose presence makes removing the binding observable.
//   - 'real'           : value is consumed (return value, condition, plain identifier read,
//                         non-mutation method call, property read like v.length)
//   - 'escape'         : value crosses the function boundary (return / external call argument)
//   - 'mutation'       : v.push(...) etc. — local side-effect only, not observable if v is
//                         neither escaped nor read elsewhere. Whitelisted methods only.
//   - 'property-write' : v.p = ... — same property of "local-only mutation"
//
// A variable whose *only* uses are mutation / property-write (and never real or escape)
// is case 6/7 dead: removing the binding + its mutation sites preserves behavior.
//
// Closure capture is handled separately by `isDefClosureCaptured` (def-level), so this
// pass only inspects the outer function body and skips nested function bodies entirely.
//
// Mutation method whitelist: conservative — start with `push` only because it is the
// only mutation method exercised by the fixtures. Expand when a new fixture demands it.
const MUTATION_METHODS = new Set(['push']);

// Expression kinds whose evaluation has observable side-effects (call/await/yield/new
// /assignment/update/tagged template/spread/delete). If any of these appear inside a
// mutation argument or property-write RHS, the mutation cannot be classified as
// "local-only" — removing it would also remove the side-effect, violating CLAUDE.md's
// "side-effect 횟수·순서 보존".
//
// `ChainExpression` is intentionally NOT in this set: `a?.b` (optional member, no call)
// is a pure read, while `a?.b()` (optional call) wraps a `CallExpression` that the
// child recursion will catch.
//
// `SpreadElement` is impure because it invokes the iterator protocol
// (`[Symbol.iterator]()` + `.next()`), which user-defined iterables can override with
// arbitrary side-effects.
const IMPURE_NODE_TYPES = new Set<string>([
  'CallExpression',
  'NewExpression',
  'AwaitExpression',
  'YieldExpression',
  'UpdateExpression',
  'AssignmentExpression',
  'TaggedTemplateExpression',
  'ImportExpression',
  'SpreadElement',
]);

const containsImpureExpression = (node: Node | null | undefined): boolean => {
  if (node === null || node === undefined) {
    return false;
  }

  if (IMPURE_NODE_TYPES.has(node.type)) {
    return true;
  }

  // `delete obj.x` mutates `obj` and returns boolean; the deletion itself is the
  // observable effect we must preserve.
  if (node.type === 'UnaryExpression' && (node as { operator: string }).operator === 'delete') {
    return true;
  }

  // Function/arrow literals are values — their body is not evaluated at definition
  // time. Pushing a function literal into a collection is therefore a pure operation
  // with respect to "what happens right now", even if the body contains calls. Skip
  // descent into the body. (If the function is later invoked elsewhere, that's a use
  // of whatever holds it — escape analysis handles that path separately.)
  if (isFunctionNode(node)) {
    return false;
  }

  let found = false;

  forEachChildNode(node, child => {
    if (!found && containsImpureExpression(child)) {
      found = true;
    }
  });

  return found;
};

type UseKind = 'real' | 'mutation' | 'property-write' | 'escape';

const classifyUseInWaste = (usage: Node, parent: Node | null, grandparent: Node | null): UseKind => {
  if (parent === null) {
    return 'real';
  }

  // `return v;`
  if (parent.type === 'ReturnStatement' && (parent as { argument: Node | null }).argument === usage) {
    return 'escape';
  }

  // `f(v)` — argument position. Note: this is the direct argument case only; member
  // expressions inside arguments are handled by the MemberExpression branch below.
  if (parent.type === 'CallExpression') {
    const args = (parent as unknown as { arguments: ReadonlyArray<Node> }).arguments;

    if (args.includes(usage)) {
      return 'escape';
    }
  }

  // Member access on v: `v.p`, `v[k]`, `v.method(...)`, `v.p = ...`.
  // Only the object position counts as a use of v — `obj[v]` (v as computed property)
  // does NOT match this branch (parent.object !== usage), so it falls through to 'real'.
  if (parent.type === 'MemberExpression' && (parent as { object: Node }).object === usage) {
    if (grandparent !== null) {
      if (
        grandparent.type === 'AssignmentExpression' &&
        (grandparent as { left: Node }).left === parent
      ) {
        // `v.p = RHS` — local mutation only when RHS is pure. If RHS evaluation has
        // any side-effect (call/await/new/assignment/update), removing the property
        // write would also drop that side-effect → fall back to 'real'.
        const rhs = (grandparent as { right: Node }).right;

        if (containsImpureExpression(rhs)) {
          return 'real';
        }

        return 'property-write';
      }

      if (
        grandparent.type === 'CallExpression' &&
        (grandparent as { callee: Node }).callee === parent
      ) {
        const property = (parent as { property: Node }).property;

        if (property.type === 'Identifier' && MUTATION_METHODS.has((property as { name: string }).name)) {
          // `v.METHOD(args...)` — local mutation only when every argument is pure.
          const args = (grandparent as unknown as { arguments: ReadonlyArray<Node> }).arguments;

          for (const arg of args) {
            if (containsImpureExpression(arg)) {
              return 'real';
            }
          }

          return 'mutation';
        }
      }
    }

    // Plain property read (`v.length`, `v.toString()`, non-mutation method call) is real.
    // Update expressions on properties (`v.x++`) and other unhandled member contexts are
    // conservatively 'real' so we never falsely flag a dead-store.
    return 'real';
  }

  return 'real';
};

interface IdentifierContext {
  readonly node: Node;
  readonly parent: Node | null;
  readonly grandparent: Node | null;
  /**
   * Ancestor chain from the function/module root down to (but not including) the
   * Identifier itself. `ancestors[ancestors.length - 1]` is the parent. Used by
   * `findDefRhs` to walk up through destructure patterns to the enclosing
   * VariableDeclarator and recover its `init`.
   */
  readonly ancestors: ReadonlyArray<Node>;
}

const buildIdentifierContextByLocation = (functionBodyNodes: ReadonlyArray<Node>): Map<number, IdentifierContext> => {
  const ctxByLocation = new Map<number, IdentifierContext>();
  const ancestorStack: Node[] = [];

  for (const body of functionBodyNodes) {
    let depth = 0;

    walk(body, {
      enter(node: Node, parent: Node | null) {
        // Skip nested function bodies — outer variable references inside them are
        // handled by `isDefClosureCaptured` (def-level reachability).
        if (depth > 0 && isFunctionNode(node)) {
          this.skip();

          return;
        }

        if (isFunctionNode(node)) {
          depth += 1;
        }

        if (node.type === 'Identifier') {
          const grandparent = ancestorStack.length >= 2 ? (ancestorStack[ancestorStack.length - 2] ?? null) : null;
          const ancestors = ancestorStack.slice();

          ctxByLocation.set(node.start, { node, parent, grandparent, ancestors });
        }

        ancestorStack.push(node);
      },
      leave(node: Node) {
        ancestorStack.pop();

        if (isFunctionNode(node)) {
          depth -= 1;
        }
      },
    });
  }

  return ctxByLocation;
};

/**
 * Return the RHS expression whose evaluation is what *this* def writes, or `null`
 * if there is no separate RHS (the def itself is the side-effect, e.g. `x++`).
 *
 * Maps each `writeKind` to its expression source:
 *   - declaration   : `let x = RHS;`        → VariableDeclarator.init
 *   - assignment    : `x = RHS;`            → AssignmentExpression.right
 *   - compound/log. : `x += RHS;` / `x ??= RHS;` → AssignmentExpression.right
 *   - update        : `x++` / `++x`         → null (UnaryExpression-like, no RHS;
 *                                              caller treats the def as inherently
 *                                              impure-sensitive at its own site)
 */
const findDefRhs = (ctx: IdentifierContext): Node | null => {
  const { node, parent } = ctx;

  if (parent === null) {
    return null;
  }

  // `let x = RHS;` (or `const`/`var`/destructure root)
  if (parent.type === 'VariableDeclarator' && (parent as { id: Node }).id === node) {
    return (parent as { init: Node | null }).init;
  }

  // `x = RHS;` / `x += RHS;` / `x ??= RHS;` etc. — node is the LHS reference
  if (parent.type === 'AssignmentExpression' && (parent as { left: Node }).left === node) {
    return (parent as { right: Node }).right;
  }

  // `++x` / `x++` — no separate RHS. The update itself is the write.
  if (parent.type === 'UpdateExpression') {
    return null;
  }

  // Destructure binding (`let { a } = obj;`, `let [first] = arr;`, `let { a: x } = obj;`,
  // `let [...rest] = arr;`, nested patterns, defaults like `let { a = g() } = obj`, etc.).
  //
  // Two side-effect sources need to survive when the binding is dropped:
  //   - the enclosing `init` expression (`g()` in `let { a } = g()`)
  //   - any default inside the pattern (`g()` in `let { a = g() } = obj`)
  //
  // Returning the *VariableDeclarator itself* makes `containsImpureExpression` walk
  // both subtrees (`id` for the pattern with defaults, `init` for the source),
  // catching either kind of impure dependency.
  if (
    parent.type === 'ObjectPattern' ||
    parent.type === 'ArrayPattern' ||
    parent.type === 'AssignmentPattern' ||
    parent.type === 'RestElement' ||
    parent.type === 'Property'
  ) {
    for (let i = ctx.ancestors.length - 1; i >= 0; i -= 1) {
      const ancestor = ctx.ancestors[i];

      if (ancestor !== undefined && ancestor.type === 'VariableDeclarator') {
        return ancestor;
      }
    }

    return null;
  }

  return null;
};

const buildVarHasMeaningfulUse = (
  functionBodyNodes: ReadonlyArray<Node>,
  localIndexByName: Map<string, number>,
  declScopeByIdLocation: ReadonlyMap<number, string>,
): Set<number> => {
  const meaningful = new Set<number>();
  const ctxByLocation = buildIdentifierContextByLocation(functionBodyNodes);
  // Reuse variable-collector for proper read-vs-write classification (it already filters
  // declarations, assignment targets, destructure bindings, etc.). evaluateAllBranches
  // matches the syntactic-read policy used for the use=0 exemption.
  const reads = functionBodyNodes
    .flatMap(n => collectVariables(n, { includeNestedFunctions: false, declScopeByIdLocation, evaluateAllBranches: true }))
    .filter(u => u.isRead);

  for (const usage of reads) {
    const idx = localIndexByName.get(bindingKey(usage.name, usage.declScope));

    if (typeof idx !== 'number') {
      continue;
    }

    const ctx = ctxByLocation.get(usage.location);

    if (ctx === undefined) {
      // No syntactic context found (defensive — variable-collector's evaluated branches
      // should always have a corresponding walk visit). Conservatively treat as real.
      meaningful.add(idx);
      continue;
    }

    const kind = classifyUseInWaste(ctx.node, ctx.parent, ctx.grandparent);

    if (kind === 'real' || kind === 'escape') {
      meaningful.add(idx);
    }
  }

  return meaningful;
};

const buildWasteFinding = (
  metaName: string,
  metaLocation: number,
  isOverwritten: boolean,
  writeKind: string | undefined,
  filePath: string,
  lineOffsets: number[],
): WasteFinding => {
  const loc = getLineColumn(lineOffsets, metaLocation);
  const kind = isOverwritten && writeKind !== 'declaration' ? 'dead-store-overwrite' : 'dead-store';
  const message =
    kind === 'dead-store-overwrite'
      ? `Variable '${metaName}' is assigned but overwritten before being read`
      : `Variable '${metaName}' is assigned but never read`;

  return {
    kind,
    label: metaName,
    message,
    filePath,
    span: {
      start: loc,
      end: {
        line: loc.line,
        column: loc.column + metaName.length,
      },
    },
  };
};

const collectWasteFindingsForFunction = (
  node: Node,
  functionBodyNode: Node | ReadonlyArray<Node>,
  filePath: string,
  lineOffsets: number[],
  findings: WasteFinding[],
): void => {
  const localIndexByName = collectLocalVarIndexes(node);
  const parameterBindings = collectParameterBindings(node);

  if (localIndexByName.size === 0) {
    return;
  }

  // Collect parameter default expressions (the right-hand side of `AssignmentPattern`).
  // Identifier reads inside defaults are use-sites for earlier parameters and must be
  // surfaced to the dataflow analysis so `function f(a=1, b=a)` doesn't flag `a` as dead.
  const fnParams = (node as OxcFunction).params;
  const parameterDefaults: Node[] = [];

  for (const param of fnParams) {
    if (param.type === 'AssignmentPattern') {
      parameterDefaults.push(param.right);
    }
  }

  // Build the decl-scope map from the function root so parameter declarations are
  // visible to the in-body walks (`ScopeTracker.getDeclaration` cannot resolve
  // parameters when the walk starts at the body).
  const declScopeByIdLocation = buildDeclScopeMap(node);
  const analysis = analyzeFunctionBody(
    functionBodyNode,
    localIndexByName,
    parameterBindings,
    parameterDefaults,
    declScopeByIdLocation,
  );
  const { defs, usedDefs, overwrittenDefIds, reachingInByNode, nodePayloads } = analysis;
  // CLAUDE.md 비대상: function parameter. The reaching-defs seed for parameter bindings
  // is still needed so reads inside the body resolve to a definition, but the detector
  // must never report parameters themselves as waste.
  const parameterLocations = new Set<number>();

  for (const binding of parameterBindings) {
    parameterLocations.add(binding.location);
  }
  const functionBodyNodes: ReadonlyArray<Node> = Array.isArray(functionBodyNode)
    ? (functionBodyNode as ReadonlyArray<Node>)
    : [functionBodyNode as Node];
  // Syntactic read counting (ignores static dead-branch pruning) to classify
  // "사용처 0회 변수 (no-unused-vars 영역)" correctly. Includes reads inside nested
  // functions so closure captures count as syntactic uses of the outer binding.
  const syntacticReads = functionBodyNodes
    .flatMap(n => collectVariables(n, { includeNestedFunctions: true, declScopeByIdLocation, evaluateAllBranches: true }))
    .filter(u => u.isRead);
  // Closure-capture analysis is varIndex-driven: a read inside a nested function only
  // counts as capturing an *outer* binding if `bindingKey(name, declScope)` resolves
  // to an entry in `localIndexByName` — inner same-name shadows resolve to a different
  // scope key and are filtered out automatically.
  const nestedCtx = buildNestedFunctionContext(
    nodePayloads as ReadonlyArray<Node | ReadonlyArray<Node> | undefined>,
    localIndexByName,
    declScopeByIdLocation,
  );
  // CLAUDE.md 비대상: 사용처 0회 변수 (no-unused-vars 영역).
  // A binding with zero syntactic reads belongs to no-unused-vars, not waste.
  // `syntacticReads` ignores static dead-branch pruning, matching how tsc's
  // `noUnusedLocals` classifies variables — a read in `1 ?? fallback` still counts.
  const varHasAnyRead = new Set<number>();

  for (const usage of syntacticReads) {
    const idx = localIndexByName.get(bindingKey(usage.name, usage.declScope));

    if (typeof idx === 'number') {
      varHasAnyRead.add(idx);
    }
  }

  // Case 6/7: a binding whose only uses are local mutation (`v.push(...)`) or property
  // write (`v.p = ...`), with no real read or escape, is dead. We track by `varIndex`,
  // not `defId`, because the question is whether the *variable* is ever observed; a
  // separate `defId`-keyed pass (`usedDefs`) handles within-variable dead writes.
  const varHasMeaningfulUse = buildVarHasMeaningfulUse(functionBodyNodes, localIndexByName, declScopeByIdLocation);
  // Identifier context map for the body — reused by the per-def purity check below.
  const defCtxByLocation = buildIdentifierContextByLocation(functionBodyNodes);

  // Deduplicate findings by (name, source location). The CFG may model the same
  // source-level write more than once (e.g. finally bodies are duplicated for the
  // normal- and abnormal-completion paths), producing distinct defIds at the same
  // offset. Without this guard the same dead-store is emitted multiple times.
  const emittedKeys = new Set<string>();

  for (let defId = 0; defId < defs.length; defId += 1) {
    const meta = defs[defId];

    if (!meta) {
      continue;
    }

    // CLAUDE.md "함수 파라미터" 비대상.
    if (parameterLocations.has(meta.location)) {
      continue;
    }

    // CLAUDE.md "사용처 0회 변수 (no-unused-vars 영역)" 비대상.
    if (!varHasAnyRead.has(meta.varIndex)) {
      continue;
    }

    // Binding-only declarations (`let x;`) create a binding but do not write a value.
    // reaching-defs registers them for other detectors (e.g. variable-lifetime), but
    // waste must not flag them as dead — there is no value to be dead in the first place.
    if (meta.writeKind === 'declaration' && meta.hasInit === false) {
      continue;
    }

    // `using` / `await using` declarations bind a resource whose disposal at scope exit
    // is the observable behavior (CLAUDE.md K example: "자원 핸들 lifetime").
    if (meta.declarationKind === 'using' || meta.declarationKind === 'await using') {
      continue;
    }

    // Purity guard: if the def's RHS has any side-effect (call/await/new/yield/spread/
    // assignment/update/delete/tagged template), removing the def would erase that
    // side-effect too — CLAUDE.md "side-effect 횟수·순서 보존" violation.
    const defCtx = defCtxByLocation.get(meta.location);

    if (defCtx !== undefined) {
      const rhs = findDefRhs(defCtx);

      if (rhs !== null && containsImpureExpression(rhs)) {
        continue;
      }
    }

    // Case 6/7: declaration whose binding is never *meaningfully* used — all uses are
    // mutation method calls or property writes, with no real read or escape, and not
    // captured by any nested function. Emit on the declaration site.
    const isCase67 =
      meta.writeKind === 'declaration' &&
      !varHasMeaningfulUse.has(meta.varIndex) &&
      !isDefClosureCaptured(defId, meta.varIndex, nestedCtx, reachingInByNode);

    if (!isCase67) {
      // Cases 1–4: per-def reaching-defs analysis. A def used elsewhere or captured by
      // a closure is not waste.
      if (usedDefs.has(defId)) {
        continue;
      }

      if (isDefClosureCaptured(defId, meta.varIndex, nestedCtx, reachingInByNode)) {
        continue;
      }
    }

    const dedupeKey = `${meta.name}@${meta.location}`;

    if (emittedKeys.has(dedupeKey)) {
      continue;
    }

    emittedKeys.add(dedupeKey);

    findings.push(
      buildWasteFinding(meta.name, meta.location, overwrittenDefIds[defId] === true, meta.writeKind, filePath, lineOffsets),
    );
  }
};

// ── Module-scope analysis (CLAUDE.md: "모든 scope" = module + function + block) ──
//
// The function-level path covers anything inside a function (including any nested
// block scope). What it misses is everything outside any function: top-level
// `let x = 1; x = 2; ...`, top-level blocks, module-scope case 6/7. This pass
// runs once per file over the program body and reuses the same dataflow + waste
// rules as the function path, with two module-specific adjustments:
//
//   1. No parameters — `parameterBindings = []` and there are no parameter defaults.
//   2. Exported bindings are out of waste's scope (CLAUDE.md: "export된 binding —
//      cross-module 분석 필요, dependencies detector 영역"). Their declaration
//      sites are collected and excluded at emit time, like function parameters.

const collectModuleLocalVarIndexes = (
  programBody: ReadonlyArray<Node>,
  declScopeByIdLocation: ReadonlyMap<number, string>,
): Map<string, number> => {
  const keys = new Set<string>();

  for (const stmt of programBody) {
    for (const usage of collectVariables(stmt, { includeNestedFunctions: false, declScopeByIdLocation })) {
      if (usage.isWrite && usage.writeKind === 'declaration') {
        keys.add(bindingKey(usage.name, usage.declScope));
      }
    }
  }

  const out = new Map<string, number>();
  let index = 0;

  for (const key of keys) {
    out.set(key, index);
    index += 1;
  }

  return out;
};

interface ExportExemption {
  /** Declaration-site identifier offsets — match `meta.location` (inline export decl). */
  readonly locations: Set<number>;
  /**
   * Binding names referenced by export specifiers (`export { foo, bar as baz }`).
   * Match by `meta.name` because the specifier's `local` identifier is a *reference*,
   * not the binding declaration site, so offset-based matching would miss it.
   * Module-scope binding names are unique, so name-based matching is safe at this scope.
   */
  readonly names: Set<string>;
}

const collectExportExemption = (programBody: ReadonlyArray<Node>): ExportExemption => {
  const locations = new Set<number>();
  const names = new Set<string>();

  const recordBindingLocations = (idNode: Node): void => {
    if (idNode.type === 'Identifier') {
      locations.add(idNode.start);

      return;
    }

    // Destructure patterns inside an export declaration — recurse into each binding.
    forEachChildNode(idNode, child => recordBindingLocations(child));
  };

  for (const stmt of programBody) {
    if (stmt.type !== 'ExportNamedDeclaration' && stmt.type !== 'ExportDefaultDeclaration') {
      continue;
    }

    const decl = (stmt as { declaration: Node | null }).declaration;

    if (decl === null) {
      // `export { foo, bar as baz }` — specifier-only export of a module-local binding.
      // The local declaration lives in a separate statement; match by name at emit time.
      const specifiers = (stmt as { specifiers?: ReadonlyArray<{ local?: { type?: string; name?: string } }> }).specifiers;

      if (Array.isArray(specifiers)) {
        for (const spec of specifiers) {
          const local = spec.local;

          if (local !== undefined && local.type === 'Identifier' && typeof local.name === 'string') {
            names.add(local.name);
          }
        }
      }

      continue;
    }

    if (decl.type === 'VariableDeclaration') {
      for (const declarator of (decl as { declarations: ReadonlyArray<{ id: Node }> }).declarations) {
        recordBindingLocations(declarator.id);
      }
    }

    // `export default function foo() {}` / `export default class Foo {}` / `export default expr`
    // do not produce a module-scope variable binding (functions/classes are their own scope,
    // expressions have no binding), so nothing to skip here.
  }

  return { locations, names };
};

const collectWasteFindingsForModule = (
  program: Node,
  filePath: string,
  lineOffsets: number[],
  findings: WasteFinding[],
): void => {
  const programBody = (program as { body: ReadonlyArray<Node> }).body;

  if (!Array.isArray(programBody) || programBody.length === 0) {
    return;
  }

  const declScopeByIdLocation = buildDeclScopeMap(program);
  const localIndexByName = collectModuleLocalVarIndexes(programBody, declScopeByIdLocation);

  if (localIndexByName.size === 0) {
    return;
  }

  const exportExemption = collectExportExemption(programBody);
  const analysis = analyzeFunctionBody(programBody, localIndexByName, [], [], declScopeByIdLocation);
  const { defs, usedDefs, overwrittenDefIds, reachingInByNode, nodePayloads } = analysis;
  const syntacticReads = programBody
    .flatMap(n => collectVariables(n, { includeNestedFunctions: true, declScopeByIdLocation, evaluateAllBranches: true }))
    .filter(u => u.isRead);
  const nestedCtx = buildNestedFunctionContext(
    nodePayloads as ReadonlyArray<Node | ReadonlyArray<Node> | undefined>,
    localIndexByName,
    declScopeByIdLocation,
  );
  const varHasAnyRead = new Set<number>();

  for (const usage of syntacticReads) {
    const idx = localIndexByName.get(bindingKey(usage.name, usage.declScope));

    if (typeof idx === 'number') {
      varHasAnyRead.add(idx);
    }
  }

  const varHasMeaningfulUse = buildVarHasMeaningfulUse(programBody, localIndexByName, declScopeByIdLocation);
  const defCtxByLocation = buildIdentifierContextByLocation(programBody);
  const emittedKeys = new Set<string>();

  for (let defId = 0; defId < defs.length; defId += 1) {
    const meta = defs[defId];

    if (!meta) {
      continue;
    }

    // CLAUDE.md "export된 binding 비대상" — module-scope analogue of function-parameter
    // exemption. Cover both shapes:
    //   - inline:   `export let value = 1; ...`     → declaration location matches
    //   - specifier: `let foo = 1; export { foo };`  → match by name (specifier's local
    //                                                  is a reference, not declaration)
    if (exportExemption.locations.has(meta.location) || exportExemption.names.has(meta.name)) {
      continue;
    }

    if (!varHasAnyRead.has(meta.varIndex)) {
      continue;
    }

    if (meta.writeKind === 'declaration' && meta.hasInit === false) {
      continue;
    }

    if (meta.declarationKind === 'using' || meta.declarationKind === 'await using') {
      continue;
    }

    // Purity guard (same as function path).
    const defCtx = defCtxByLocation.get(meta.location);

    if (defCtx !== undefined) {
      const rhs = findDefRhs(defCtx);

      if (rhs !== null && containsImpureExpression(rhs)) {
        continue;
      }
    }

    const isCase67 =
      meta.writeKind === 'declaration' &&
      !varHasMeaningfulUse.has(meta.varIndex) &&
      !isDefClosureCaptured(defId, meta.varIndex, nestedCtx, reachingInByNode);

    if (!isCase67) {
      if (usedDefs.has(defId)) {
        continue;
      }

      if (isDefClosureCaptured(defId, meta.varIndex, nestedCtx, reachingInByNode)) {
        continue;
      }
    }

    const dedupeKey = `${meta.name}@${meta.location}`;

    if (emittedKeys.has(dedupeKey)) {
      continue;
    }

    emittedKeys.add(dedupeKey);

    findings.push(
      buildWasteFinding(meta.name, meta.location, overwrittenDefIds[defId] === true, meta.writeKind, filePath, lineOffsets),
    );
  }
};

export const detectWasteOxc = (files: ParsedFile[]): WasteFinding[] => {
  const findings: WasteFinding[] = [];

  if (!Array.isArray(files)) {
    return [];
  }

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    const lineOffsets = buildLineOffsets(file.sourceText);

    // Module-scope pass: CLAUDE.md says "모든 scope (module / function / block)" are
    // in scope. Without this pass, top-level `let v=1; v=2; ...`, top-level blocks,
    // and module-scope case 6/7 all escape detection. Function-internal blocks are
    // already covered by the function-scope pass below.
    collectWasteFindingsForModule(file.program, file.filePath, lineOffsets, findings);

    const visit = (node: Node | ReadonlyArray<Node> | undefined): void => {
      if (Array.isArray(node)) {
        for (const entry of node as ReadonlyArray<Node>) {
          visit(entry);
        }

        return;
      }

      if (!isOxcNode(node)) {
        return;
      }

      const fn = node as OxcFunction;
      const functionBodyNode = isFunctionNode(node) ? (fn.body ?? undefined) : undefined;

      if (isFunctionNode(node) && functionBodyNode !== undefined) {
        collectWasteFindingsForFunction(node, functionBodyNode, file.filePath, lineOffsets, findings);
      }

      forEachChildNode(node, child => visit(child));
    };

    visit(file.program);
  }

  return findings;
};
