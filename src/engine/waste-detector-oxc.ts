import type { Function as OxcFunction, Node } from 'oxc-parser';

import { buildLineOffsets, getLineColumn, walk } from '@zipbul/gildash';

import type { WasteFinding } from '..';
import type { BitSet, DefMeta, ParsedFile } from './types';

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
// Method names that perform an in-place mutation on the receiver and whose return
// value (if any) is local. Matching is by name only — same-named methods on other
// built-ins are tolerated because case 6/7 also requires the variable to be a fresh
// allocation, so an `ArrayExpression` value will not actually carry `Date.setHours`
// etc.
//
// - Array.prototype mutators
// - Map / Set / WeakMap / WeakSet mutators
// - TypedArray mutators (share names with Array)
const MUTATION_METHODS = new Set([
  // Array
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
  'fill',
  'copyWithin',
  // Map / Set / WeakMap / WeakSet
  'set',
  'add',
  'delete',
  'clear',
]);

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

// Well-known built-in functions that mutate their first argument and treat the
// remaining arguments as read-only sources. Same safety rule as a method call on
// a mutation whitelist: the first argument is the local-mutation receiver, the
// rest must be pure or the call's side-effects survive.
const BUILTIN_TARGET_MUTATION_APIS = new Set<string>([
  'Object.assign',
  'Object.defineProperty',
  'Object.defineProperties',
  'Object.setPrototypeOf',
  'Reflect.set',
  'Reflect.defineProperty',
  'Reflect.deleteProperty',
  'Reflect.setPrototypeOf',
]);

const callExpressionTargetMutationApi = (callee: Node): string | null => {
  if (callee.type !== 'MemberExpression') {
    return null;
  }

  const me = callee as { object: Node; property: Node; computed?: boolean };

  if (me.computed === true) {
    return null;
  }

  if (me.object.type !== 'Identifier' || me.property.type !== 'Identifier') {
    return null;
  }

  const name = `${(me.object as { name: string }).name}.${(me.property as { name: string }).name}`;

  return BUILTIN_TARGET_MUTATION_APIS.has(name) ? name : null;
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

  // `v ??= ...` / `v ||= ...` / `v &&= ...` — the LHS read is the condition check
  // that decides whether the RHS is evaluated; the value itself is never consumed
  // elsewhere through this site. Classify as 'mutation' (locally observable, no
  // external value flow) so case 6/7 stays applicable when the RHS is fresh.
  if (parent.type === 'AssignmentExpression' && (parent as { left: Node }).left === usage) {
    const operator = (parent as { operator: string }).operator;

    if (operator === '??=' || operator === '||=' || operator === '&&=') {
      return 'mutation';
    }
  }

  // `f(v)` — argument position. Note: this is the direct argument case only; member
  // expressions inside arguments are handled by the MemberExpression branch below.
  if (parent.type === 'CallExpression') {
    const args = (parent as unknown as { arguments: ReadonlyArray<Node> }).arguments;
    const argIndex = args.indexOf(usage);

    if (argIndex >= 0) {
      // Well-known built-in target-mutation APIs (Object.assign, Reflect.set, ...).
      // `v` as the first argument is a mutation receiver; later arguments are pure
      // sources. If any non-target argument has side-effects, the whole call has
      // side-effects beyond the mutation and we must fall back to 'real'.
      const callee = (parent as { callee: Node }).callee;

      if (callExpressionTargetMutationApi(callee) !== null) {
        if (argIndex === 0) {
          for (let i = 1; i < args.length; i += 1) {
            const other = args[i];

            if (other !== undefined && containsImpureExpression(other)) {
              return 'real';
            }
          }

          return 'mutation';
        }

        // Non-target argument of a target-mutation API is a regular escape: the
        // function reads the value to merge/copy from. Same as a normal call arg.
        return 'escape';
      }

      return 'escape';
    }
  }

  // Member access on v: `v.p`, `v[k]`, `v.method(...)`, `v.p = ...`.
  // Only the object position counts as a use of v — `obj[v]` (v as computed property)
  // does NOT match this branch (parent.object !== usage), so it falls through to 'real'.
  if (parent.type === 'MemberExpression' && (parent as { object: Node }).object === usage) {
    // Computed-key purity: `v[g()]` evaluates `g()` whenever the access executes. If
    // that key expression has side-effects, removing the surrounding write would erase
    // the call too — treat as real to keep it.
    const memberParent = parent as { computed?: boolean; property: Node };

    if (memberParent.computed === true && containsImpureExpression(memberParent.property)) {
      return 'real';
    }

    if (grandparent !== null) {
      if (
        grandparent.type === 'AssignmentExpression' &&
        (grandparent as { left: Node }).left === parent
      ) {
        const property = (parent as { computed?: boolean; property: Node }).property;

        if (
          (property.type === 'Identifier' && (property as { name: string }).name === 'length') ||
          (property.type === 'Literal' && (property as { value?: unknown }).value === 'length')
        ) {
          return 'real';
        }

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
// Expression kinds that produce a brand-new value with no pre-existing identity.
// Case 6/7 ("local mutation only") is only safe when the binding holds a freshly
// allocated value — otherwise the mutations observed externally through whatever
// outer reference also points at the same object. `new Foo()` is excluded because
// the constructor call is itself impure (handled by `containsImpureExpression`).
const FRESH_ALLOCATION_TYPES = new Set<string>(['ArrayExpression', 'ObjectExpression', 'ClassExpression']);

// TS/paren wrappers that preserve the underlying value identity. `[] as T`,
// `([])`, `[] satisfies T`, `[]!`, `<T>[]` all still hold a fresh literal —
// peel them off before checking against `FRESH_ALLOCATION_TYPES`.
const unwrapValueWrappers = (node: Node): Node => {
  let current = node;

  while (true) {
    if (
      current.type === 'TSAsExpression' ||
      current.type === 'TSSatisfiesExpression' ||
      current.type === 'TSNonNullExpression' ||
      current.type === 'TSTypeAssertion' ||
      current.type === 'ParenthesizedExpression'
    ) {
      const inner = (current as { expression?: Node }).expression;

      if (inner === undefined) {
        return current;
      }

      current = inner;
      continue;
    }

    return current;
  }
};

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
  // Also destructure *assignment* (`[a] = g();`, `({ a } = g());`) — same RHS purity
  // requirement, but the enclosing node is an AssignmentExpression rather than a
  // VariableDeclarator.
  //
  // Two side-effect sources need to survive when the binding is dropped:
  //   - the enclosing init / RHS expression (`g()`)
  //   - any default inside the pattern (`g()` in `let { a = g() } = obj`)
  //
  // Returning the *enclosing declarator/assignment itself* makes
  // `containsImpureExpression` walk both subtrees (pattern with defaults + source).
  if (
    parent.type === 'ObjectPattern' ||
    parent.type === 'ArrayPattern' ||
    parent.type === 'AssignmentPattern' ||
    parent.type === 'RestElement' ||
    parent.type === 'Property'
  ) {
    for (let i = ctx.ancestors.length - 1; i >= 0; i -= 1) {
      const ancestor = ctx.ancestors[i];

      if (ancestor === undefined) {
        continue;
      }

      if (ancestor.type === 'VariableDeclarator') {
        return ancestor;
      }

      // Destructure assignment: `[a] = g();`, `({ a } = g());`
      if (ancestor.type === 'AssignmentExpression') {
        const left = (ancestor as { left: Node }).left;

        if (left.type === 'ObjectPattern' || left.type === 'ArrayPattern') {
          return ancestor;
        }
      }
    }

    return null;
  }

  return null;
};

/**
 * Resolve the value expression that flows into `ctx`'s declaration, unwrapping
 * a `VariableDeclarator` or `AssignmentExpression` wrapper when `findDefRhs`
 * returns one (destructure patterns). Returns `null` when there is no source
 * expression (`let x;`, `x++`).
 */
const resolveDeclarationInit = (ctx: IdentifierContext): Node | null => {
  const rhs = findDefRhs(ctx);

  if (rhs === null) {
    return null;
  }

  if (rhs.type === 'VariableDeclarator') {
    return (rhs as { init: Node | null }).init;
  }

  if (rhs.type === 'AssignmentExpression') {
    return (rhs as { right: Node }).right;
  }

  return rhs;
};

/**
 * Whether the def's source expression — including any destructure pattern that
 * wraps it — carries an observable side-effect. Unwraps the declarator /
 * assignment node returned by `findDefRhs` so the wrapper's own node type
 * (`AssignmentExpression`, which is in `IMPURE_NODE_TYPES`) doesn't falsely
 * classify every destructure assignment as impure.
 */
const defRhsCarriesSideEffect = (rhs: Node): boolean => {
  if (rhs.type === 'VariableDeclarator') {
    const init = (rhs as { init: Node | null }).init;
    const id = (rhs as { id: Node }).id;

    return containsImpureExpression(init) || containsImpureExpression(id);
  }

  if (rhs.type === 'AssignmentExpression') {
    const right = (rhs as { right: Node }).right;
    const left = (rhs as { left: Node }).left;

    return containsImpureExpression(right) || containsImpureExpression(left);
  }

  return containsImpureExpression(rhs);
};

/**
 * Whether the declaration init at this context is a fresh allocation (a brand-new
 * object/array/class instance the binding owns exclusively at declaration time).
 * Case 6/7's safety claim ("local mutation only") only holds for fresh allocations
 * — `const c = []; c.push(1);` is dead, but `const c = arg; c.push(1);` mutates
 * the caller's array through a shared reference.
 */
/**
 * Whether the declaration init contains any user-defined method, getter, or setter
 * that could shadow a built-in mutation method or trigger side-effects on property
 * write. When such a definition exists, case 6/7 must not fire on the variable —
 * the matching `MUTATION_METHODS` name on this receiver actually invokes the user's
 * code, and the matching property-write name actually invokes the user's setter.
 */
const objectInitDefinesMethodOrAccessor = (init: Node): boolean => {
  if (init.type !== 'ObjectExpression') {
    return false;
  }

  const properties = (init as { properties?: ReadonlyArray<Node> }).properties;

  if (!Array.isArray(properties)) {
    return false;
  }

  for (const prop of properties) {
    if (prop.type !== 'Property') {
      continue;
    }

    const kind = (prop as { kind?: string }).kind;
    const isMethod = (prop as { method?: boolean }).method === true;

    if (kind === 'get' || kind === 'set' || isMethod) {
      return true;
    }
  }

  return false;
};

const isDeclarationFreshAllocation = (ctx: IdentifierContext): boolean => {
  const init = resolveDeclarationInit(ctx);

  if (init === null) {
    return false;
  }

  const unwrapped = unwrapValueWrappers(init);

  return (
    FRESH_ALLOCATION_TYPES.has(unwrapped.type) ||
    (unwrapped.type === 'Literal' && (unwrapped as { regex?: unknown }).regex !== undefined)
  );
};

const isKnownPrimitiveExpression = (node: Node | null): boolean => {
  if (node === null) {
    return false;
  }

  const unwrapped = unwrapValueWrappers(node);

  if (unwrapped.type === 'Literal') {
    return (unwrapped as { regex?: unknown }).regex === undefined;
  }

  if (unwrapped.type === 'TemplateLiteral') {
    return ((unwrapped as { expressions?: ReadonlyArray<Node> }).expressions ?? []).length === 0;
  }

  if (unwrapped.type === 'Identifier' && (unwrapped as { name: string }).name === 'undefined') {
    return true;
  }

  return false;
};

const compoundAssignmentMayCoerceObject = (
  defId: number,
  meta: DefMeta,
  defs: ReadonlyArray<DefMeta | undefined>,
  reachingInByNode: ReadonlyArray<BitSet>,
  defNodeIdByDefId: ReadonlyArray<number>,
  defCtxByLocation: ReadonlyMap<number, IdentifierContext>,
): boolean => {
  if (meta.writeKind !== 'compound-assignment') {
    return false;
  }

  const nodeId = defNodeIdByDefId[defId];
  const reaching = nodeId === undefined ? undefined : reachingInByNode[nodeId];

  if (reaching === undefined) {
    return true;
  }

  let sawPriorDef = false;

  for (const priorDefId of reaching.array()) {
    const prior = defs[priorDefId];

    if (prior === undefined || prior.varIndex !== meta.varIndex) {
      continue;
    }

    sawPriorDef = true;

    if (prior.writeKind === 'declaration' && prior.hasInit === false) {
      return true;
    }

    const priorCtx = defCtxByLocation.get(prior.location);

    if (priorCtx === undefined || !isKnownPrimitiveExpression(resolveDeclarationInit(priorCtx))) {
      return true;
    }
  }

  return !sawPriorDef;
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
  const { defs, usedDefs, overwrittenDefIds, reachingInByNode, defNodeIdByDefId, nodePayloads } = analysis;
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

  // Case 6/7's safety claim ("mutation is local-only") requires that *every* def of
  // the variable is a fresh allocation. If one branch assigns a fresh `[]` and another
  // aliases an outer reference, the mutation site (`c.push(...)`) reaches both, so
  // dropping the fresh-allocation def would not actually eliminate the observable
  // mutation on the aliased path. Compute the "all defs fresh" predicate per varIndex.
  const varHasOnlyFreshDefs = new Set<number>();
  const seenVarIndexes = new Set<number>();

  for (const def of defs) {
    if (def === undefined) {
      continue;
    }

    if (
      def.writeKind !== 'declaration' &&
      def.writeKind !== 'assignment' &&
      def.writeKind !== 'logical-assignment'
    ) {
      continue;
    }

    seenVarIndexes.add(def.varIndex);
  }

  // A variable whose init defines a user method/getter/setter shadows the built-in
  // mutation receiver — same name match would invoke the user's code with arbitrary
  // side-effects. Disable case 6/7 entirely for these variables.
  const varHasUserDefinedAccessor = new Set<number>();

  for (const varIndex of seenVarIndexes) {
    let allFresh = true;

    for (const def of defs) {
      if (def === undefined || def.varIndex !== varIndex) {
        continue;
      }

      if (
        def.writeKind !== 'declaration' &&
        def.writeKind !== 'assignment' &&
        def.writeKind !== 'logical-assignment'
      ) {
        continue;
      }

      // Binding-only declarations (`let c;`) write no value, so they don't introduce
      // a non-fresh alias — ignore them for the "all defs fresh" check.
      if (def.writeKind === 'declaration' && def.hasInit === false) {
        continue;
      }

      const ctx = defCtxByLocation.get(def.location);

      if (ctx === undefined || !isDeclarationFreshAllocation(ctx)) {
        allFresh = false;
        break;
      }

      const init = resolveDeclarationInit(ctx);

      if (init !== null && objectInitDefinesMethodOrAccessor(unwrapValueWrappers(init))) {
        varHasUserDefinedAccessor.add(varIndex);
      }
    }

    if (allFresh) {
      varHasOnlyFreshDefs.add(varIndex);
    }
  }

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

      if (rhs !== null && defRhsCarriesSideEffect(rhs)) {
        continue;
      }
    }

    if (compoundAssignmentMayCoerceObject(defId, meta, defs, reachingInByNode, defNodeIdByDefId, defCtxByLocation)) {
      continue;
    }

    // Case 6/7: a binding whose entire lifetime is local mutation only — every use is
    // a mutation method call or property write with no real read, no escape, and no
    // closure capture. Applies to both declarations and assignments whose RHS is a
    // fresh allocation (`const c = []`, `c = {}`), so `let c; c = []; c.push(1);`
    // is caught alongside `const c = []; c.push(1);`. Outside the fresh-allocation
    // gate the binding aliases an outer reference and the mutations are externally
    // observable.
    const isCase67 =
      (meta.writeKind === 'declaration' ||
        meta.writeKind === 'assignment' ||
        meta.writeKind === 'logical-assignment') &&
      !varHasMeaningfulUse.has(meta.varIndex) &&
      !isDefClosureCaptured(defId, meta.varIndex, nestedCtx, reachingInByNode) &&
      defCtx !== undefined &&
      isDeclarationFreshAllocation(defCtx) &&
      varHasOnlyFreshDefs.has(meta.varIndex) &&
      !varHasUserDefinedAccessor.has(meta.varIndex);

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
  const { defs, usedDefs, overwrittenDefIds, reachingInByNode, defNodeIdByDefId, nodePayloads } = analysis;
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
  // Same "all defs fresh" gate as the function path — required so module-scope
  // `let c; if (cond) c = []; else c = arg; c.push(1);` keeps the fresh def.
  const varHasOnlyFreshDefs = new Set<number>();
  const seenVarIndexes = new Set<number>();

  for (const def of defs) {
    if (def === undefined) {
      continue;
    }

    if (
      def.writeKind !== 'declaration' &&
      def.writeKind !== 'assignment' &&
      def.writeKind !== 'logical-assignment'
    ) {
      continue;
    }

    seenVarIndexes.add(def.varIndex);
  }

  // A variable whose init defines a user method/getter/setter shadows the built-in
  // mutation receiver — same name match would invoke the user's code with arbitrary
  // side-effects. Disable case 6/7 entirely for these variables.
  const varHasUserDefinedAccessor = new Set<number>();

  for (const varIndex of seenVarIndexes) {
    let allFresh = true;

    for (const def of defs) {
      if (def === undefined || def.varIndex !== varIndex) {
        continue;
      }

      if (
        def.writeKind !== 'declaration' &&
        def.writeKind !== 'assignment' &&
        def.writeKind !== 'logical-assignment'
      ) {
        continue;
      }

      // Binding-only declarations (`let c;`) write no value, so they don't introduce
      // a non-fresh alias — ignore them for the "all defs fresh" check.
      if (def.writeKind === 'declaration' && def.hasInit === false) {
        continue;
      }

      const ctx = defCtxByLocation.get(def.location);

      if (ctx === undefined || !isDeclarationFreshAllocation(ctx)) {
        allFresh = false;
        break;
      }

      const init = resolveDeclarationInit(ctx);

      if (init !== null && objectInitDefinesMethodOrAccessor(unwrapValueWrappers(init))) {
        varHasUserDefinedAccessor.add(varIndex);
      }
    }

    if (allFresh) {
      varHasOnlyFreshDefs.add(varIndex);
    }
  }
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

      if (rhs !== null && defRhsCarriesSideEffect(rhs)) {
        continue;
      }
    }

    if (compoundAssignmentMayCoerceObject(defId, meta, defs, reachingInByNode, defNodeIdByDefId, defCtxByLocation)) {
      continue;
    }

    const isCase67 =
      (meta.writeKind === 'declaration' ||
        meta.writeKind === 'assignment' ||
        meta.writeKind === 'logical-assignment') &&
      !varHasMeaningfulUse.has(meta.varIndex) &&
      !isDefClosureCaptured(defId, meta.varIndex, nestedCtx, reachingInByNode) &&
      defCtx !== undefined &&
      isDeclarationFreshAllocation(defCtx) &&
      varHasOnlyFreshDefs.has(meta.varIndex) &&
      !varHasUserDefinedAccessor.has(meta.varIndex);

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
