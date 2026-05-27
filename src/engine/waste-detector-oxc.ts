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
  /**
   * Outer binding `varIndex`es captured by a **hoisted function declaration**
   * (`function f() { ... }`), as opposed to a function/arrow expression. A
   * hoisted declaration is callable from anywhere in its enclosing scope, so a
   * captured variable may be observed at any point regardless of where the
   * declaration appears (even after an early `return`, where its lexical CFG
   * node is unreachable). Such captures are treated order-independently: every
   * def of the variable is kept.
   */
  readonly hoistCapturedVarIndexes: Set<number>;
  /**
   * For each captured `varIndex`, the minimum source start offset among the
   * (non-hoisted) closures that capture it. A def located at or after this
   * offset means a capturing closure already existed when the def ran, so a
   * later (possibly async / opaque) invocation of that closure can observe the
   * def's value — the def is not dead. Source offset is robust to finally-block
   * CFG duplication and nested-function payload nodes (forward CFG reachability
   * was not). The reverse case — closure created AFTER the def, e.g.
   * `let x=1; x=2; return () => x` — is handled by the reaching-defs check: the
   * def reaches the later closure's entry only if it survives to it.
   */
  readonly captureMinStartByVar: Map<number, number>;
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

/**
 * varIndexes read inside ANY nested function within `bodyNodes` (closure
 * captures). Computed directly from the AST (independent of the CFG), so it is
 * available BEFORE analyzeFunctionBody — used to gate the dead-use fixpoint
 * (FIX D): a closure-captured variable has useCount 0 in the enclosing
 * straight-line flow even though a closure observes it, so the fixpoint must
 * NOT treat it as a dead store nor eliminate the reads its definition performs.
 */
const collectClosureCapturedVarIndexes = (
  bodyNodes: ReadonlyArray<Node>,
  localIndexByName: Map<string, number>,
  declScopeByIdLocation: ReadonlyMap<number, string>,
): Set<number> => {
  const captured = new Set<number>();

  for (const body of bodyNodes) {
    for (const nested of collectOxcNodes(body, n => isFunctionNode(n))) {
      collectCapturedVarIndexesFromFunction(nested, localIndexByName, declScopeByIdLocation, captured);
    }
  }

  return captured;
};

const buildNestedFunctionContext = (
  nodePayloads: ReadonlyArray<Node | ReadonlyArray<Node> | undefined>,
  localIndexByName: Map<string, number>,
  declScopeByIdLocation: ReadonlyMap<number, string>,
): NestedFunctionContext => {
  const entryNodeIds: number[] = [];
  const capturedVarIndexesByEntry = new Map<number, Set<number>>();
  const hoistCapturedVarIndexes = new Set<number>();
  const captureMinStartByVar = new Map<number, number>();

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
      const isHoisted = nestedFunction.type === 'FunctionDeclaration';
      const captureSink = isHoisted ? hoistCapturedVarIndexes : captured;
      const before = isHoisted ? new Set<number>() : captured;
      const sizeBefore = before.size;

      collectCapturedVarIndexesFromFunction(nestedFunction, localIndexByName, declScopeByIdLocation, captureSink);

      // Record the source start of each non-hoisted capturing closure against
      // the vars it captures (min over closures), for the offset-based
      // "closure existed before the def" observability check.
      if (!isHoisted && captured.size >= sizeBefore) {
        const start = nestedFunction.start;

        for (const idx of captured) {
          const prev = captureMinStartByVar.get(idx);

          if (prev === undefined || start < prev) {
            captureMinStartByVar.set(idx, start);
          }
        }
      }
    }

    if (captured.size === 0) {
      continue;
    }

    entryNodeIds.push(nodeId);
    capturedVarIndexesByEntry.set(nodeId, captured);
  }

  return { entryNodeIds, capturedVarIndexesByEntry, hoistCapturedVarIndexes, captureMinStartByVar };
};

const isDefClosureCaptured = (
  defId: number,
  varIndex: number,
  defLocation: number,
  nestedCtx: NestedFunctionContext,
  reachingInByNode: ReadonlyArray<BitSet>,
): boolean => {
  // Hoisted function declaration capture: callable throughout the enclosing
  // scope, so any def of the captured variable may be observed — order-
  // independent, regardless of where the declaration appears (even after an
  // early return, where its lexical CFG node is unreachable).
  if (nestedCtx.hoistCapturedVarIndexes.has(varIndex)) {
    return true;
  }

  // (b) Closure created BEFORE this def (its source start ≤ def location): it
  //     already exists when the def runs, so a later — possibly async / opaque
  //     — invocation observes the def's value. Covers forward-referenced module
  //     helpers and captured variables reassigned/finalized between invocations
  //     (`m = 3; update(); m = 4`, `try {...} finally { flag = false }` where a
  //     callback reads flag). Source-offset based: robust to finally-block CFG
  //     duplication and nested-function payload nodes. The reverse case —
  //     closure created AFTER the def, `let x=1; x=2; return () => x` — has its
  //     min start > x=1's location, so x=1 is NOT kept here.
  const minStart = nestedCtx.captureMinStartByVar.get(varIndex);

  if (minStart !== undefined && minStart <= defLocation) {
    return true;
  }

  // (a) Closure created AFTER this def but the def reaches the closure's entry
  //     (survives to it) → observed at creation. Handles `x=2` in
  //     `let x=1; x=2; return () => x` (x=2 reaches the closure; x=1 does not).
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
//
// Splitting by receiver shape: matching a name from the wrong bucket on a
// known-shape fresh allocation does NOT call that method — it throws a
// TypeError, which is an observable side-effect we must keep. So:
//   - `arr.set(...)` on an `ArrayExpression` is NOT a local mutation (throw)
//   - `o.push(...)` on an `ObjectExpression` is NOT a local mutation (throw)
// Cross-receiver compatibility is enforced at the use site via `mutationMethodCategory`.
const ARRAY_MUTATION_METHODS = new Set<string>([
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
  'fill',
  'copyWithin',
]);

const MAPSET_MUTATION_METHODS = new Set<string>(['set', 'add', 'delete', 'clear']);

// Mutation methods that RETURN THE RECEIVER itself: Array sort/reverse/fill/
// copyWithin return the array; Map.set returns the map; Set.add returns the
// set. When such a call's result is consumed (not a discarded statement), the
// receiver's reference/content escapes through the return value — e.g.
// `arr.sort().join()` reads the sorted array, `return c.set(k,v)` leaks the
// map. push/pop/shift/unshift/splice/delete/clear return a length/element/
// boolean/new-array, so consuming their result does NOT leak the receiver.
const RETURN_SELF_MUTATORS = new Set<string>(['sort', 'reverse', 'fill', 'copyWithin', 'set', 'add']);

type MutationMethodCategory = 'array' | 'mapset';

const mutationMethodCategory = (name: string): MutationMethodCategory | null => {
  if (ARRAY_MUTATION_METHODS.has(name)) {
    return 'array';
  }

  if (MAPSET_MUTATION_METHODS.has(name)) {
    return 'mapset';
  }

  return null;
};

type FreshAllocationKind = 'array' | 'object' | 'class' | 'regex';

const freshAllocationKindOf = (init: Node): FreshAllocationKind | null => {
  const unwrapped = unwrapValueWrappers(init);

  if (unwrapped.type === 'ArrayExpression') {
    return 'array';
  }

  if (unwrapped.type === 'ObjectExpression') {
    return 'object';
  }

  if (unwrapped.type === 'ClassExpression') {
    return 'class';
  }

  if (unwrapped.type === 'Literal' && (unwrapped as { regex?: unknown }).regex !== undefined) {
    return 'regex';
  }

  return null;
};

// Whether the mutation method category is reachable on a value of the given
// fresh-allocation kind. `{}.push(...)` and `[].set(...)` both throw TypeError,
// so they are NOT local mutations.
const mutationCompatibleWithInit = (category: MutationMethodCategory, initKind: FreshAllocationKind | undefined): boolean => {
  if (initKind === undefined) {
    // Unknown receiver kind (mixed defs, no fresh-allocation gate). Be safe:
    // any other condition will disqualify case 6/7 elsewhere.
    return true;
  }

  if (initKind === 'array') {
    return category === 'array';
  }

  // ObjectExpression literal carries no prototype mutator name. RegExp/Class
  // values are not standard mutation receivers — any whitelisted call on them
  // is either a TypeError or a user-defined override (already gated by
  // varHasUserDefinedAccessor for ObjectExpression with own methods).
  return false;
};

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

// Whether an ObjectExpression literal contains a getter or setter property.
// Source arguments to `Object.assign(target, source)` are enumerated and each
// own property is *read* — a getter on `source` fires at copy time. Detecting
// the getter syntactically is enough; `containsImpureExpression` skips
// function bodies, so the getter would otherwise look pure.
const objectLiteralHasAccessor = (node: Node): boolean => {
  if (node.type !== 'ObjectExpression') {
    return false;
  }

  const properties = (node as { properties?: ReadonlyArray<Node> }).properties;

  if (!Array.isArray(properties)) {
    return false;
  }

  for (const prop of properties) {
    if (prop.type !== 'Property') {
      continue;
    }

    const kind = (prop as { kind?: string }).kind;

    if (kind === 'get' || kind === 'set') {
      return true;
    }
  }

  return false;
};

const classifyUseInWaste = (
  usage: Node,
  parent: Node | null,
  grandparent: Node | null,
  receiverInitKind?: FreshAllocationKind,
  greatGrandparent?: Node | null,
): UseKind => {
  if (parent === null) {
    return 'real';
  }

  // Discard-only reads of a fresh local value are not meaningful observations.
  // Case 6/7 will still require an all-fresh definition set before reporting.
  if (parent.type === 'UnaryExpression' && (parent as { argument: Node }).argument === usage) {
    const operator = (parent as { operator: string }).operator;

    if (operator === 'typeof' || operator === 'void') {
      return 'mutation';
    }
  }

  if (parent.type === 'SequenceExpression') {
    const expressions = (parent as { expressions?: ReadonlyArray<Node> }).expressions ?? [];
    const index = expressions.indexOf(usage);

    if (index >= 0 && index < expressions.length - 1) {
      return 'mutation';
    }
  }

  if (
    parent.type === 'BinaryExpression' &&
    (parent as { operator?: string }).operator === 'instanceof' &&
    (parent as { left?: Node }).left === usage &&
    grandparent?.type === 'ExpressionStatement'
  ) {
    return 'mutation';
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

            if (other === undefined) {
              continue;
            }

            if (containsImpureExpression(other)) {
              return 'real';
            }

            // `Object.assign(target, { get x() { sideeffect } })` enumerates the
            // source and invokes its getter at copy time. The getter body looks
            // pure to `containsImpureExpression` (function-literal bodies are
            // skipped at value time) but it WILL run during the assign call.
            if (objectLiteralHasAccessor(other)) {
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
        grandparent.type === 'UnaryExpression' &&
        (grandparent as { operator: string; argument: Node }).operator === 'delete' &&
        (grandparent as { argument: Node }).argument === parent
      ) {
        return 'property-write';
      }

      if (grandparent.type === 'AssignmentExpression' && (grandparent as { left: Node }).left === parent) {
        // `v.p = RHS` — local mutation only when RHS is pure. If RHS evaluation has
        // any side-effect (call/await/new/assignment/update), removing the property
        // write would also drop that side-effect → fall back to 'real'.
        // Note: `v.length = N` on a fresh array literal is also local-only when v
        // does not escape — it just deletes excess own-indices. The earlier guard
        // that forced length writes to 'real' was over-conservative versus CLAUDE.md
        // "외부로 노출되는 reference identity" boundary.
        const rhs = (grandparent as { right: Node }).right;

        if (containsImpureExpression(rhs)) {
          return 'real';
        }

        return 'property-write';
      }

      if (grandparent.type === 'CallExpression' && (grandparent as { callee: Node }).callee === parent) {
        const property = (parent as { property: Node }).property;

        if (property.type === 'Identifier') {
          const methodName = (property as { name: string }).name;
          const category = mutationMethodCategory(methodName);

          if (category !== null) {
            // Cross-receiver check: `[].set(...)` / `{}.push(...)` throw TypeError
            // at runtime — observable side-effect we must keep. Only treat as a
            // local mutation when the method category matches the known receiver
            // init kind.
            if (!mutationCompatibleWithInit(category, receiverInitKind)) {
              return 'real';
            }

            // `v.METHOD(args...)` — local mutation only when every argument is pure.
            const args = (grandparent as unknown as { arguments: ReadonlyArray<Node> }).arguments;

            for (const arg of args) {
              if (containsImpureExpression(arg)) {
                return 'real';
              }
            }

            // Return-self mutators (sort/reverse/fill/copyWithin/set/add) return
            // the receiver. If the call's result is consumed (its parent — our
            // great-grandparent — is anything other than a discarded
            // ExpressionStatement), the receiver escapes through that value:
            // `arr.sort().join()`, `return c.set(k, v)`, `f(arr.reverse())`.
            if (RETURN_SELF_MUTATORS.has(methodName)) {
              const resultConsumed =
                greatGrandparent !== null && greatGrandparent !== undefined && greatGrandparent.type !== 'ExpressionStatement';

              if (resultConsumed) {
                return 'escape';
              }
            }

            return 'mutation';
          }
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

const containsMemberExpression = (node: Node | null | undefined): boolean => {
  if (node === null || node === undefined) {
    return false;
  }

  if (node.type === 'MemberExpression') {
    return true;
  }

  if (isFunctionNode(node)) {
    return false;
  }

  let found = false;

  forEachChildNode(node, child => {
    if (!found && containsMemberExpression(child)) {
      found = true;
    }
  });

  return found;
};

const containsClosureOrEvalReference = (node: Node | null | undefined): boolean => {
  if (node === null || node === undefined) {
    return false;
  }

  if (isFunctionNode(node)) {
    return true;
  }

  if (
    node.type === 'CallExpression' &&
    (node as { callee?: Node }).callee?.type === 'Identifier' &&
    ((node as { callee: Node }).callee as { name?: string }).name === 'eval'
  ) {
    return true;
  }

  let found = false;

  forEachChildNode(node, child => {
    if (!found && containsClosureOrEvalReference(child)) {
      found = true;
    }
  });

  return found;
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

    // `{ __proto__: parent }` installs a prototype at literal time. Property
    // writes/reads on the resulting object can fire inherited setters/getters
    // or throw against inherited frozen slots — the receiver is no longer a
    // clean own-property-only fresh allocation.
    const key = (prop as { key?: Node; computed?: boolean }).key;
    const computed = (prop as { computed?: boolean }).computed === true;

    if (!computed && key !== undefined) {
      const keyName =
        key.type === 'Identifier'
          ? (key as { name: string }).name
          : key.type === 'Literal' && typeof (key as { value?: unknown }).value === 'string'
            ? (key as { value: string }).value
            : null;

      if (keyName === '__proto__') {
        return true;
      }
    }

    // Computed key whose value is a function literal — semantically a method
    // (e.g. `{ [Symbol.toPrimitive]: () => ... }`). Object coercion / spread /
    // certain built-ins look up these well-known symbol methods and invoke
    // them, so the property's value is reachable as a method.
    if (computed) {
      const value = (prop as { value?: Node }).value;

      if (value !== undefined && isFunctionNode(value)) {
        return true;
      }
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

const isNaNIdentifierExpression = (node: Node | null): boolean => {
  const unwrapped = node === null ? null : unwrapValueWrappers(node);

  return unwrapped?.type === 'Identifier' && (unwrapped as { name: string }).name === 'NaN';
};

const hasLaterNaNReassign = (
  meta: DefMeta,
  defs: ReadonlyArray<DefMeta | undefined>,
  defCtxByLocation: ReadonlyMap<number, IdentifierContext>,
): boolean => {
  const currentCtx = defCtxByLocation.get(meta.location);

  if (currentCtx === undefined || !isNaNIdentifierExpression(resolveDeclarationInit(currentCtx))) {
    return false;
  }

  for (const other of defs) {
    if (
      other === undefined ||
      other.varIndex !== meta.varIndex ||
      other.location <= meta.location ||
      (other.writeKind !== 'assignment' && other.writeKind !== 'logical-assignment')
    ) {
      continue;
    }

    const otherCtx = defCtxByLocation.get(other.location);

    if (otherCtx !== undefined && isNaNIdentifierExpression(resolveDeclarationInit(otherCtx))) {
      return true;
    }
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

// A direct call to `eval(...)` inside a scope can dynamically read any binding
// by name — the string argument is opaque to static analysis. Any def whose
// next syntactic write looks like an overwrite could still be observed via
// eval. Disable case 1–4/6/7 for the whole scope when direct eval is present.
const scopeUsesDirectEval = (bodyNodes: ReadonlyArray<Node>): boolean => {
  let found = false;
  const visit = (node: Node): void => {
    if (found) {
      return;
    }

    // Skip nested function bodies — direct eval inside a nested function only
    // captures *that* function's scope, not the outer one. Each nested function
    // is analyzed in its own pass.
    if (isFunctionNode(node)) {
      return;
    }

    if (
      node.type === 'CallExpression' &&
      (node as { callee: Node }).callee.type === 'Identifier' &&
      (node as { callee: { name: string } }).callee.name === 'eval'
    ) {
      found = true;

      return;
    }

    forEachChildNode(node, visit);
  };

  for (const n of bodyNodes) {
    visit(n);

    if (found) {
      return true;
    }
  }

  return false;
};

const buildVarHasMeaningfulUse = (
  functionBodyNodes: ReadonlyArray<Node>,
  localIndexByName: Map<string, number>,
  declScopeByIdLocation: ReadonlyMap<number, string>,
  varInitKind: ReadonlyMap<number, FreshAllocationKind> = new Map(),
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

    // Class static blocks execute while evaluating the class definition. Treat outer
    // binding references there as meaningful so case 6/7 does not erase evaluation-time
    // mutations hidden inside the class body.
    if (ctx.ancestors.some(ancestor => ancestor.type === 'StaticBlock')) {
      meaningful.add(idx);
      continue;
    }

    const greatGrandparent = ctx.ancestors.length >= 3 ? ctx.ancestors[ctx.ancestors.length - 3] : null;
    const kind = classifyUseInWaste(ctx.node, ctx.parent, ctx.grandparent, varInitKind.get(idx), greatGrandparent);

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

// ── Phase 2: redundant single-use bindings (`const y = <pure expr>; … y …`) ──────
//
// A const binding whose initializer is read exactly once and can be substituted at
// that single use with no change to observable behavior or the TS type-check result
// (CLAUDE.md: removal via RHS substitution preserves behavior; readability of the
// name is explicitly not observable). Increment 1 covers the substitution-safe
// non-member, non-closure cases: identifier aliases and pure arithmetic / logical /
// unary / conditional expressions over identifier or literal operands (incl. `as` /
// `satisfies` casts, which travel with the value). Member reads, destructuring, and
// closure-captured bindings are out of this increment.
const REDUNDANT_BINDING_RHS_TYPES = new Set<string>([
  'Identifier',
  'BinaryExpression',
  'LogicalExpression',
  'UnaryExpression',
  'ConditionalExpression',
  'MemberExpression',
]);

// Whether the expression contains an optional chain (`a?.b`, `a?.[k]`, `a?.()`). The
// short-circuit semantics make a member read branch-dependent — out of scope.
const containsOptionalChain = (node: Node): boolean => {
  let found = false;

  walk(node, {
    enter(child: Node) {
      if (found) {
        this.skip();

        return;
      }

      if (child.type === 'ChainExpression' || (child as { optional?: boolean }).optional === true) {
        found = true;
      }
    },
  });

  return found;
};

const isInlinableRhs = (rhs: Node): boolean => {
  const unwrapped = unwrapValueWrappers(rhs);

  // A bare literal is excluded — naming a literal constant is a readability choice,
  // deferred to a later phase. Identifier aliases, arithmetic, and member reads survive.
  if (!REDUNDANT_BINDING_RHS_TYPES.has(unwrapped.type)) {
    return false;
  }

  // call / await / new / spread / tagged-template / update side-effects.
  if (defRhsCarriesSideEffect(unwrapped)) {
    return false;
  }

  // A closure / eval reference defers or hides evaluation; an optional chain is
  // branch-dependent.
  return !containsClosureOrEvalReference(unwrapped) && !containsOptionalChain(unwrapped);
};

// Node kinds that, between the RHS and its single use, can change a member-reading
// binding's observable result: a call / new / await / yield / assignment / update /
// tagged-template / spread / `delete` may mutate the receiver or run a getter, and an
// intervening *member read* (another getter / Proxy trap) reorders side-effects. `lo`
// must be the RHS's end offset so the RHS's own member reads are not counted, and the
// single use's own member sits at `hi` (excluded by the strict `< hi`).
const MEMBER_GAP_EFFECT_TYPES = new Set<string>([
  'CallExpression',
  'NewExpression',
  'AwaitExpression',
  'YieldExpression',
  'AssignmentExpression',
  'UpdateExpression',
  'TaggedTemplateExpression',
  'SpreadElement',
  'MemberExpression',
]);

const hasSideEffectBetween = (bodyNodes: ReadonlyArray<Node>, lo: number, hi: number): boolean => {
  let found = false;

  for (const body of bodyNodes) {
    walk(body, {
      enter(node: Node) {
        if (found) {
          this.skip();

          return;
        }

        const isDelete = node.type === 'UnaryExpression' && (node as { operator: string }).operator === 'delete';

        if ((MEMBER_GAP_EFFECT_TYPES.has(node.type) || isDelete) && node.start > lo && node.start < hi) {
          found = true;
        }
      },
    });
  }

  return found;
};

// Whether the single use sits inside a loop or a nested function that does NOT contain
// the declaration — in which case the member read is re-evaluated per iteration or
// deferred to a later call, diverging from the binding's single eager evaluation.
const LOOP_NODE_TYPES = new Set<string>(['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement']);

const useInLoopOrForeignClosure = (useCtx: IdentifierContext, declLoc: number): boolean => {
  for (const ancestor of useCtx.ancestors) {
    if (!LOOP_NODE_TYPES.has(ancestor.type) && !isFunctionNode(ancestor)) {
      continue;
    }

    // The declaration is outside this loop/function → the use is re-evaluated or deferred.
    if (declLoc < ancestor.start || declLoc >= ancestor.end) {
      return true;
    }
  }

  return false;
};

const declarationHasTypeAnnotation = (ctx: IdentifierContext): boolean =>
  (ctx.node as { typeAnnotation?: unknown }).typeAnnotation != null;

// A destructuring binding is a plain field/index extraction (`const { a } = obj`,
// `const [first] = arr`) only when its path to the declarator contains no default
// (`AssignmentPattern`), rest (`RestElement`), or computed key — each of which adds
// evaluation that inlining `obj.<key>` would lose.
const isPlainDestructurePath = (ctx: IdentifierContext): boolean => {
  for (let i = ctx.ancestors.length - 1; i >= 0; i -= 1) {
    const ancestor = ctx.ancestors[i];

    if (ancestor === undefined) {
      return false;
    }

    if (ancestor.type === 'VariableDeclarator') {
      return true;
    }

    // Object destructuring only. Array destructuring (`const [x] = it`) consumes the
    // iterator protocol at declaration time — not equivalent to an index read on inline.
    if (ancestor.type === 'ObjectPattern') {
      continue;
    }

    if (ancestor.type === 'Property' && (ancestor as { computed?: boolean }).computed !== true) {
      continue;
    }

    return false;
  }

  return false;
};

// The `kind` of the enclosing `VariableDeclaration` (`const`/`let`/`var`), read from
// the AST ancestor chain (reaching-defs does not propagate it for non-`using` kinds).
const enclosingDeclarationKind = (ctx: IdentifierContext): string | null => {
  for (let i = ctx.ancestors.length - 1; i >= 0; i -= 1) {
    const ancestor = ctx.ancestors[i];

    if (ancestor !== undefined && ancestor.type === 'VariableDeclaration') {
      return (ancestor as { kind: string }).kind;
    }
  }

  return null;
};

const collectRhsIdentifierNames = (rhs: Node): Set<string> => {
  const names = new Set<string>();

  walk(rhs, {
    enter(node: Node) {
      if (node.type === 'Identifier') {
        names.add((node as { name: string }).name);
      }
    },
  });

  return names;
};

// Whether any of `names` is reassigned (`name = …`, `name++`, `name += …`) anywhere in
// the scope. A pure RHS over `names` is only a stable substitute for its single use when
// none of its source identifiers is ever reassigned: a same-scope reassignment after the
// use, or one observed at a deferred call of a capturing closure, would change the value.
// (A plain call cannot reassign a caller's binding, so only explicit writes matter.)
const hasReassignmentOfNames = (bodyNodes: ReadonlyArray<Node>, names: ReadonlySet<string>): boolean => {
  let found = false;

  for (const body of bodyNodes) {
    walk(body, {
      enter(node: Node) {
        if (found) {
          this.skip();

          return;
        }

        if (node.type === 'AssignmentExpression') {
          const left = (node as { left: Node }).left;

          // Identifier target (`name = …`) or a destructuring target (`({ name } = …)`,
          // `[name] = …`) — for a pattern, any identifier inside it may be a write target.
          if (left.type === 'Identifier') {
            if (names.has((left as { name: string }).name)) {
              found = true;
            }
          } else if (left.type === 'ObjectPattern' || left.type === 'ArrayPattern') {
            if (identifierAppearsIn(left, names)) {
              found = true;
            }
          }
        } else if (node.type === 'UpdateExpression') {
          const arg = (node as { argument: Node }).argument;

          if (arg.type === 'Identifier' && names.has((arg as { name: string }).name)) {
            found = true;
          }
        } else if (node.type === 'ForInStatement' || node.type === 'ForOfStatement') {
          // `for (existing of …)` / `for ({ existing } of …)` — a non-declaration left
          // reassigns an outer binding each iteration.
          const left = (node as { left: Node }).left;

          if (left.type === 'Identifier') {
            if (names.has((left as { name: string }).name)) {
              found = true;
            }
          } else if (left.type === 'ObjectPattern' || left.type === 'ArrayPattern') {
            if (identifierAppearsIn(left, names)) {
              found = true;
            }
          }
        }
      },
    });
  }

  return found;
};

// Whether `name` appears as an identifier anywhere in `node` (e.g. a guard test).
const identifierAppearsIn = (node: Node | null | undefined, names: ReadonlySet<string>): boolean => {
  if (node === null || node === undefined) {
    return false;
  }

  let found = false;

  walk(node, {
    enter(child: Node) {
      if (found) {
        this.skip();

        return;
      }

      if (child.type === 'Identifier' && names.has((child as { name: string }).name)) {
        found = true;
      }
    },
  });

  return found;
};

// Whether the single use sits inside a control-flow branch/loop body whose guard
// narrows a source identifier — including a do-while/while body, where the guard test is
// positionally *after* the use but flow-narrows it on the looping path. (Offset-based
// `sourceGuardedBetween` cannot see a guard that follows the use, so this ancestor check
// complements it.)
const useInNarrowedBranch = (useCtx: IdentifierContext, names: ReadonlySet<string>): boolean => {
  const chain = [...useCtx.ancestors, useCtx.node];

  for (let i = 0; i < chain.length - 1; i += 1) {
    const ancestor = chain[i];
    const child = chain[i + 1];

    if (ancestor === undefined || child === undefined) {
      continue;
    }

    if (ancestor.type === 'IfStatement' || ancestor.type === 'ConditionalExpression') {
      const node = ancestor as { test: Node; consequent: Node; alternate?: Node | null };

      if ((child === node.consequent || child === node.alternate) && identifierAppearsIn(node.test, names)) {
        return true;
      }
    } else if (ancestor.type === 'LogicalExpression') {
      const node = ancestor as { left: Node; right: Node };

      if (child === node.right && identifierAppearsIn(node.left, names)) {
        return true;
      }
    } else if (ancestor.type === 'WhileStatement' || ancestor.type === 'DoWhileStatement') {
      const node = ancestor as { test: Node; body: Node };

      if (child === node.body && identifierAppearsIn(node.test, names)) {
        return true;
      }
    } else if (ancestor.type === 'SwitchStatement') {
      if (child.type === 'SwitchCase' && identifierAppearsIn((ancestor as { discriminant: Node }).discriminant, names)) {
        return true;
      }
    }
  }

  return false;
};

// Whether, between `lo` and `hi`, a source identifier is flow-narrowed for the use:
// referenced in a narrowing guard (`if`/`while`/`do-while`/ternary/`&&`·`||`/`switch`
// test) or passed as a call argument (a potential `asserts v is T` assertion). TS
// narrows the source past the guard, but the separate binding keeps its declared type,
// so inlining the source would change the TS type-check result (CLAUDE.md K "타입
// narrowing"). Offset-based, so it covers both branch-nested uses and earlier-sibling
// guards (early-`return`/`throw`, assertion calls) that ancestor inspection misses.
const sourceGuardedBetween = (bodyNodes: ReadonlyArray<Node>, names: ReadonlySet<string>, lo: number, hi: number): boolean => {
  let found = false;

  for (const body of bodyNodes) {
    walk(body, {
      enter(node: Node) {
        if (found) {
          this.skip();

          return;
        }

        let test: Node | null = null;

        if (
          node.type === 'IfStatement' ||
          node.type === 'WhileStatement' ||
          node.type === 'DoWhileStatement' ||
          node.type === 'ConditionalExpression'
        ) {
          test = (node as { test: Node }).test;
        } else if (node.type === 'LogicalExpression') {
          test = (node as { left: Node }).left;
        } else if (node.type === 'SwitchStatement') {
          test = (node as { discriminant: Node }).discriminant;
        }

        if (test !== null && test.start > lo && test.start < hi && identifierAppearsIn(test, names)) {
          found = true;

          return;
        }

        if (node.type === 'CallExpression') {
          for (const arg of (node as { arguments: ReadonlyArray<Node> }).arguments) {
            if (arg.type === 'Identifier' && names.has((arg as { name: string }).name) && arg.start > lo && arg.start < hi) {
              found = true;

              return;
            }
          }
        }
      },
    });
  }

  return found;
};

const buildRedundantBindingFinding = (name: string, location: number, filePath: string, lineOffsets: number[]): WasteFinding => {
  const loc = getLineColumn(lineOffsets, location);

  return {
    kind: 'redundant-binding',
    label: name,
    message: `Variable '${name}' is a redundant binding; its initializer is used only once and can be inlined`,
    filePath,
    span: {
      start: loc,
      end: {
        line: loc.line,
        column: loc.column + name.length,
      },
    },
  };
};

interface RedundantBindingInput {
  readonly bodyNodes: ReadonlyArray<Node>;
  readonly defs: ReadonlyArray<DefMeta | undefined>;
  readonly defCtxByLocation: ReadonlyMap<number, IdentifierContext>;
  readonly syntacticReads: ReadonlyArray<{ readonly name: string; readonly declScope?: string; readonly location: number }>;
  readonly localIndexByName: Map<string, number>;
  readonly varInitKind: ReadonlyMap<number, FreshAllocationKind>;
  readonly skipLocations: ReadonlySet<string> | ReadonlySet<number>;
  readonly skipNames?: ReadonlySet<string>;
  readonly filePath: string;
  readonly lineOffsets: number[];
  readonly findings: WasteFinding[];
}

const collectRedundantBindingFindings = (input: RedundantBindingInput): void => {
  const { bodyNodes, defs, defCtxByLocation, syntacticReads, localIndexByName, varInitKind, filePath, lineOffsets, findings } = input;

  // Per-variable use summary, restricted to reads in the same scope (a read inside a
  // nested function has no entry in defCtxByLocation → recorded as a closure read,
  // which disqualifies the binding in this increment).
  const usesByVar = new Map<number, { real: IdentifierContext[]; closureRead: boolean; otherKind: boolean }>();

  for (const usage of syntacticReads) {
    const idx = localIndexByName.get(bindingKey(usage.name, usage.declScope));

    if (typeof idx !== 'number') {
      continue;
    }

    let entry = usesByVar.get(idx);

    if (entry === undefined) {
      entry = { real: [], closureRead: false, otherKind: false };
      usesByVar.set(idx, entry);
    }

    const ctx = defCtxByLocation.get(usage.location);

    if (ctx === undefined) {
      entry.closureRead = true;
      continue;
    }

    const greatGrandparent = ctx.ancestors.length >= 3 ? (ctx.ancestors[ctx.ancestors.length - 3] ?? null) : null;
    const kind = classifyUseInWaste(ctx.node, ctx.parent, ctx.grandparent, varInitKind.get(idx), greatGrandparent);

    if (kind === 'real' || kind === 'escape') {
      entry.real.push(ctx);
    } else {
      entry.otherKind = true;
    }
  }

  const seenVar = new Set<number>();

  for (let defId = 0; defId < defs.length; defId += 1) {
    const meta = defs[defId];

    if (!meta || seenVar.has(meta.varIndex)) {
      continue;
    }

    seenVar.add(meta.varIndex);

    // The variable must have exactly one def — a single `const` declaration with an
    // initializer (no reassignment anywhere).
    let defCount = 0;
    let declMeta: DefMeta | null = null;

    for (const def of defs) {
      if (def === undefined || def.varIndex !== meta.varIndex) {
        continue;
      }

      defCount += 1;

      if (def.writeKind === 'declaration' && def.hasInit !== false) {
        declMeta = def;
      }
    }

    if (defCount !== 1 || declMeta === null) {
      continue;
    }

    if ((input.skipLocations as ReadonlySet<unknown>).has(declMeta.location) || input.skipNames?.has(meta.name) === true) {
      continue;
    }

    const entry = usesByVar.get(meta.varIndex);

    if (entry === undefined || entry.closureRead || entry.otherKind || entry.real.length !== 1) {
      continue;
    }

    const useCtx = entry.real[0];

    if (useCtx === undefined || useCtx.node.start <= declMeta.location) {
      continue;
    }

    const declCtx = defCtxByLocation.get(declMeta.location);

    if (declCtx === undefined || enclosingDeclarationKind(declCtx) !== 'const' || declarationHasTypeAnnotation(declCtx)) {
      continue;
    }

    // A simple binding (`const x = …`) substitutes its initializer. A destructuring
    // binding (`const { a } = obj`) substitutes `obj.a` — a member read of the declarator
    // init — so it is treated like a member-reading RHS below.
    const isSimpleBinding =
      declCtx.parent !== null && declCtx.parent.type === 'VariableDeclarator' && (declCtx.parent as { id: Node }).id === declCtx.node;

    const rhs = resolveDeclarationInit(declCtx);

    if (rhs === null) {
      continue;
    }

    // The substituted expression and whether it reads a member. For a destructuring
    // binding the init is the receiver (`obj`), and the substitution is `obj.<key>` — a
    // member read regardless of the init's own shape.
    const substituted = unwrapValueWrappers(rhs);
    const readsMember = !isSimpleBinding || containsMemberExpression(substituted);

    if (!isInlinableRhs(rhs)) {
      continue;
    }

    // Destructuring: only a plain field/index extraction (no default / rest / computed).
    if (!isSimpleBinding && !isPlainDestructurePath(declCtx)) {
      continue;
    }

    const names = collectRhsIdentifierNames(substituted);

    if (hasReassignmentOfNames(bodyNodes, names)) {
      continue;
    }

    // TS narrowing: a source identifier is flow-narrowed (guard or assertion) between the
    // declaration and the use, which the separate binding does not carry — inlining would
    // change the type-check result.
    if (sourceGuardedBetween(bodyNodes, names, declMeta.location, useCtx.node.start) || useInNarrowedBranch(useCtx, names)) {
      continue;
    }

    // Member-reading bindings: the read must be a single eager evaluation that is a stable
    // substitute at the use. Disqualify when the use is re-evaluated (loop) or deferred
    // (closure not containing the decl), or when any effect intervenes between the RHS and
    // the use (call/assignment/member-read/… could mutate the receiver or reorder getters).
    if (readsMember) {
      if (useInLoopOrForeignClosure(useCtx, declMeta.location)) {
        continue;
      }

      if (hasSideEffectBetween(bodyNodes, rhs.end, useCtx.node.start)) {
        continue;
      }
    }

    findings.push(buildRedundantBindingFinding(meta.name, declMeta.location, filePath, lineOffsets));
  }
};

// FP-A: a dead reassignment storing an empty value (`x = null` / `x = undefined` /
// `x = void …`) is a reference-release / lifetime-management idiom (CLAUDE.md K
// "자원 핸들 lifetime"). Whether the released reference is observed externally (e.g. a
// leak detector holding the same object) cannot be decided statically, so clearing a
// binding to an empty value is never reported as waste.
const isReferenceReleaseStore = (meta: DefMeta, defCtx: IdentifierContext | undefined): boolean => {
  if (meta.writeKind !== 'assignment' || defCtx === undefined) {
    return false;
  }

  const rhs = findDefRhs(defCtx);

  if (rhs === null) {
    return false;
  }

  const unwrapped = unwrapValueWrappers(rhs);

  if (unwrapped.type === 'Identifier') {
    return (unwrapped as { name: string }).name === 'undefined';
  }

  if (unwrapped.type === 'Literal') {
    return (unwrapped as { value: unknown }).value === null;
  }

  return unwrapped.type === 'UnaryExpression' && (unwrapped as { operator: string }).operator === 'void';
};

// FP-B1: a declaration immediately preceded by a `@ts-expect-error` / `@ts-ignore`
// directive carries a load-bearing type-check assertion — removing the binding would
// orphan the directive (a new "unused directive" error), changing the TS type-check
// result (CLAUDE.md K "TS 타입검사 결과 보존").
const TS_DIRECTIVE_RE = /@ts-(?:expect-error|ignore)\b/;

const declarationPrecededByTsDirective = (location: number, sourceText: string, lineOffsets: number[]): boolean => {
  const idLine = getLineColumn(lineOffsets, location).line; // 1-based

  // Walk upward from the line directly above the declaration, skipping blank lines,
  // and test the first non-blank line for the directive (TS binds it to the next code line).
  for (let line = idLine - 1; line >= 1; line -= 1) {
    const start = lineOffsets[line - 1];
    const end = lineOffsets[line] ?? sourceText.length;

    if (start === undefined) {
      return false;
    }

    const text = sourceText.slice(start, end);

    if (text.trim() === '') {
      continue;
    }

    return TS_DIRECTIVE_RE.test(text);
  }

  return false;
};

const collectWasteFindingsForFunction = (
  node: Node,
  functionBodyNode: Node | ReadonlyArray<Node>,
  filePath: string,
  sourceText: string,
  lineOffsets: number[],
  findings: WasteFinding[],
): void => {
  const localIndexByName = collectLocalVarIndexes(node, filePath, sourceText);
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
  const declScopeByIdLocation = buildDeclScopeMap(node, filePath, sourceText);
  const functionBodyNodes: ReadonlyArray<Node> = Array.isArray(functionBodyNode)
    ? (functionBodyNode as ReadonlyArray<Node>)
    : [functionBodyNode as Node];
  const defCtxByLocation = buildIdentifierContextByLocation(functionBodyNodes);
  const closureCapturedVarIndexes = collectClosureCapturedVarIndexes(functionBodyNodes, localIndexByName, declScopeByIdLocation);
  const analysis = analyzeFunctionBody(
    functionBodyNode,
    localIndexByName,
    parameterBindings,
    parameterDefaults,
    declScopeByIdLocation,
    {
      inlineSyncIifes: true,
      canEliminateDeadDefReads: ({ defId, meta, defs, reachingInByNode, defNodeIdByDefId }) => {
        // Only propagate dead-ness through a REASSIGNMENT whose value is dead
        // (an overwrite chain like `x = 1; x += 2; x = 5`). A `declaration`
        // binding that is "dead" is use-zero — that is no-unused-vars territory
        // (비대상), so its reads (e.g. a destructuring default `{ a = value }`
        // that is observably evaluated, and matters for TS definite-assignment)
        // must NOT be eliminated. Restricting to non-declaration reassignments
        // also keeps the eliminated read in the same scope as a real dead store.
        if (meta.writeKind === 'declaration' || meta.writeKind === undefined) {
          return false;
        }

        // A closure-captured variable has useCount 0 in the enclosing
        // straight-line flow even though a nested function observes it. The
        // fixpoint must not treat such a def as dead nor eliminate its reads
        // (e.g. `const LABELS = { a: helper }` read only inside a function →
        // `helper`'s read must stay live).
        if (closureCapturedVarIndexes.has(meta.varIndex)) {
          return false;
        }

        const defCtx = defCtxByLocation.get(meta.location);
        const rhs = defCtx === undefined ? null : findDefRhs(defCtx);

        return (
          rhs !== null &&
          !defRhsCarriesSideEffect(rhs) &&
          !containsMemberExpression(rhs) &&
          !containsClosureOrEvalReference(rhs) &&
          !compoundAssignmentMayCoerceObject(defId, meta, defs, reachingInByNode, defNodeIdByDefId, defCtxByLocation)
        );
      },
    },
  );
  const { defs, usedDefs, overwrittenDefIds, reachingInByNode, defNodeIdByDefId, nodePayloads } = analysis;
  // CLAUDE.md 비대상: function parameter. The reaching-defs seed for parameter bindings
  // is still needed so reads inside the body resolve to a definition, but the detector
  // must never report parameters themselves as waste.
  const parameterLocations = new Set<number>();

  for (const binding of parameterBindings) {
    parameterLocations.add(binding.location);
  }
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
  // Identifier context map for the body — reused by the per-def purity check below.
  // Direct eval barrier: a function body that contains `eval(...)` may read any
  // local binding dynamically. Skip waste analysis entirely.
  if (scopeUsesDirectEval(functionBodyNodes)) {
    return;
  }

  // Pre-compute each variable's init kind so use-site classification can reject
  // cross-receiver mutation method calls (`[].set(...)`, `{}.push(...)` throw
  // TypeError — not a local mutation).
  const varInitKind = new Map<number, FreshAllocationKind>();
  const varHasMixedFreshKinds = new Set<number>();

  for (const def of defs) {
    if (def === undefined) {
      continue;
    }

    if (def.writeKind !== 'declaration' && def.writeKind !== 'assignment' && def.writeKind !== 'logical-assignment') {
      continue;
    }

    if (def.writeKind === 'declaration' && def.hasInit === false) {
      continue;
    }

    const ctx = defCtxByLocation.get(def.location);

    if (ctx === undefined) {
      continue;
    }

    const init = resolveDeclarationInit(ctx);

    if (init === null) {
      continue;
    }

    const kind = freshAllocationKindOf(init);

    if (kind === null) {
      continue;
    }

    const existing = varInitKind.get(def.varIndex);

    if (existing === undefined) {
      varInitKind.set(def.varIndex, kind);
    } else if (existing !== kind) {
      varHasMixedFreshKinds.add(def.varIndex);
      varInitKind.delete(def.varIndex);
    }
  }

  // Case 6/7: a binding whose only uses are local mutation (`v.push(...)`) or property
  // write (`v.p = ...`), with no real read or escape, is dead. We track by `varIndex`,
  // not `defId`, because the question is whether the *variable* is ever observed; a
  // separate `defId`-keyed pass (`usedDefs`) handles within-variable dead writes.
  const varHasMeaningfulUse = buildVarHasMeaningfulUse(functionBodyNodes, localIndexByName, declScopeByIdLocation, varInitKind);

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

    if (def.writeKind !== 'declaration' && def.writeKind !== 'assignment' && def.writeKind !== 'logical-assignment') {
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

      if (def.writeKind !== 'declaration' && def.writeKind !== 'assignment' && def.writeKind !== 'logical-assignment') {
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

    if (meta.writeKind === 'compound-assignment' || meta.writeKind === 'update') {
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

    // FP-A: `x = null/undefined/void …` reference-release reassignment — lifetime
    // management, not waste (CLAUDE.md K "자원 핸들 lifetime").
    if (isReferenceReleaseStore(meta, defCtx)) {
      continue;
    }

    // FP-B1: declaration guarded by an adjacent `@ts-expect-error`/`@ts-ignore` directive.
    if (declarationPrecededByTsDirective(meta.location, sourceText, lineOffsets)) {
      continue;
    }

    if (compoundAssignmentMayCoerceObject(defId, meta, defs, reachingInByNode, defNodeIdByDefId, defCtxByLocation)) {
      continue;
    }

    if (hasLaterNaNReassign(meta, defs, defCtxByLocation)) {
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
      (meta.writeKind === 'declaration' || meta.writeKind === 'assignment' || meta.writeKind === 'logical-assignment') &&
      !varHasMeaningfulUse.has(meta.varIndex) &&
      !isDefClosureCaptured(defId, meta.varIndex, meta.location, nestedCtx, reachingInByNode) &&
      defCtx !== undefined &&
      isDeclarationFreshAllocation(defCtx) &&
      varHasOnlyFreshDefs.has(meta.varIndex) &&
      !varHasUserDefinedAccessor.has(meta.varIndex) &&
      !varHasMixedFreshKinds.has(meta.varIndex);

    if (!isCase67) {
      // Cases 1–4: per-def reaching-defs analysis. A def used elsewhere or captured by
      // a closure is not waste.
      if (usedDefs.has(defId)) {
        continue;
      }

      if (isDefClosureCaptured(defId, meta.varIndex, meta.location, nestedCtx, reachingInByNode)) {
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

  // Phase 2: redundant single-use bindings (separate from the dead-store loop above —
  // these bindings ARE read, so reaching-defs marks them used).
  collectRedundantBindingFindings({
    bodyNodes: functionBodyNodes,
    defs,
    defCtxByLocation,
    syntacticReads,
    localIndexByName,
    varInitKind,
    skipLocations: parameterLocations,
    filePath,
    lineOffsets,
    findings,
  });
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

/**
 * Declaration-name offsets of variables that are *direct members* of a TS
 * namespace (`namespace N { const x = ... }`). CLAUDE.md lists "namespace" as a
 * non-target: a namespace member is cross-namespace-visible surface (like an
 * export), so removing it requires cross-reference analysis outside waste's
 * scope. Bindings inside a function nested within a namespace are NOT members —
 * they are ordinary function locals and remain analyzable, so the walk resets
 * at every function boundary.
 */
const collectNamespaceMemberLocations = (programBody: ReadonlyArray<Node>): Set<number> => {
  const out = new Set<number>();

  const recordBindingIds = (idNode: Node): void => {
    if (idNode.type === 'Identifier') {
      out.add(idNode.start);

      return;
    }

    forEachChildNode(idNode, child => recordBindingIds(child));
  };

  const visit = (node: Node, inNamespaceDirect: boolean): void => {
    if (isFunctionNode(node)) {
      // Function boundary: its locals are not namespace members.
      forEachChildNode(node, child => visit(child, false));

      return;
    }

    if (node.type === 'TSModuleBlock') {
      forEachChildNode(node, child => visit(child, true));

      return;
    }

    if (inNamespaceDirect && node.type === 'VariableDeclaration') {
      for (const declarator of (node as { declarations: ReadonlyArray<{ id: Node }> }).declarations) {
        recordBindingIds(declarator.id);
      }
    }

    forEachChildNode(node, child => visit(child, inNamespaceDirect));
  };

  for (const stmt of programBody) {
    visit(stmt, false);
  }

  return out;
};

const collectWasteFindingsForModule = (
  program: Node,
  filePath: string,
  sourceText: string,
  lineOffsets: number[],
  findings: WasteFinding[],
): void => {
  const programBody = (program as { body: ReadonlyArray<Node> }).body;

  if (!Array.isArray(programBody) || programBody.length === 0) {
    return;
  }

  const declScopeByIdLocation = buildDeclScopeMap(program, filePath, sourceText);
  const localIndexByName = collectModuleLocalVarIndexes(programBody, declScopeByIdLocation);

  if (localIndexByName.size === 0) {
    return;
  }

  const exportExemption = collectExportExemption(programBody);
  const namespaceMemberLocations = collectNamespaceMemberLocations(programBody);
  const defCtxByLocation = buildIdentifierContextByLocation(programBody);
  const closureCapturedVarIndexes = collectClosureCapturedVarIndexes(programBody, localIndexByName, declScopeByIdLocation);
  const analysis = analyzeFunctionBody(programBody, localIndexByName, [], [], declScopeByIdLocation, {
    inlineSyncIifes: true,
    canEliminateDeadDefReads: ({ defId, meta, defs, reachingInByNode, defNodeIdByDefId }) => {
      // Same guards as the function path: only propagate through dead
      // REASSIGNMENTS (not declarations / use-zero), and never through a
      // closure-captured variable (useCount 0 in module flow but observed by a
      // nested function — e.g. a label table read only inside a function).
      if (meta.writeKind === 'declaration' || meta.writeKind === undefined) {
        return false;
      }

      if (closureCapturedVarIndexes.has(meta.varIndex)) {
        return false;
      }

      const defCtx = defCtxByLocation.get(meta.location);
      const rhs = defCtx === undefined ? null : findDefRhs(defCtx);

      return (
        rhs !== null &&
        !defRhsCarriesSideEffect(rhs) &&
        !containsMemberExpression(rhs) &&
        !containsClosureOrEvalReference(rhs) &&
        !compoundAssignmentMayCoerceObject(defId, meta, defs, reachingInByNode, defNodeIdByDefId, defCtxByLocation)
      );
    },
  });
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

  // Direct eval at module scope — same dynamic-read barrier as function path.
  if (scopeUsesDirectEval(programBody)) {
    return;
  }

  const varInitKind = new Map<number, FreshAllocationKind>();
  const varHasMixedFreshKinds = new Set<number>();

  for (const def of defs) {
    if (def === undefined) {
      continue;
    }

    if (def.writeKind !== 'declaration' && def.writeKind !== 'assignment' && def.writeKind !== 'logical-assignment') {
      continue;
    }

    if (def.writeKind === 'declaration' && def.hasInit === false) {
      continue;
    }

    const ctx = defCtxByLocation.get(def.location);

    if (ctx === undefined) {
      continue;
    }

    const init = resolveDeclarationInit(ctx);

    if (init === null) {
      continue;
    }

    const kind = freshAllocationKindOf(init);

    if (kind === null) {
      continue;
    }

    const existing = varInitKind.get(def.varIndex);

    if (existing === undefined) {
      varInitKind.set(def.varIndex, kind);
    } else if (existing !== kind) {
      varHasMixedFreshKinds.add(def.varIndex);
      varInitKind.delete(def.varIndex);
    }
  }

  const varHasMeaningfulUse = buildVarHasMeaningfulUse(programBody, localIndexByName, declScopeByIdLocation, varInitKind);
  // Same "all defs fresh" gate as the function path — required so module-scope
  // `let c; if (cond) c = []; else c = arg; c.push(1);` keeps the fresh def.
  const varHasOnlyFreshDefs = new Set<number>();
  const seenVarIndexes = new Set<number>();

  for (const def of defs) {
    if (def === undefined) {
      continue;
    }

    if (def.writeKind !== 'declaration' && def.writeKind !== 'assignment' && def.writeKind !== 'logical-assignment') {
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

      if (def.writeKind !== 'declaration' && def.writeKind !== 'assignment' && def.writeKind !== 'logical-assignment') {
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

    // CLAUDE.md "namespace 비대상": direct members of a TS namespace are
    // cross-namespace surface, out of waste's scope.
    if (namespaceMemberLocations.has(meta.location)) {
      continue;
    }

    if (!varHasAnyRead.has(meta.varIndex)) {
      continue;
    }

    if (meta.writeKind === 'declaration' && meta.hasInit === false) {
      continue;
    }

    if (meta.writeKind === 'compound-assignment' || meta.writeKind === 'update') {
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

    // FP-A / FP-B1 (same as function path).
    if (isReferenceReleaseStore(meta, defCtx)) {
      continue;
    }

    if (declarationPrecededByTsDirective(meta.location, sourceText, lineOffsets)) {
      continue;
    }

    if (compoundAssignmentMayCoerceObject(defId, meta, defs, reachingInByNode, defNodeIdByDefId, defCtxByLocation)) {
      continue;
    }

    if (hasLaterNaNReassign(meta, defs, defCtxByLocation)) {
      continue;
    }

    const isCase67 =
      (meta.writeKind === 'declaration' || meta.writeKind === 'assignment' || meta.writeKind === 'logical-assignment') &&
      !varHasMeaningfulUse.has(meta.varIndex) &&
      !isDefClosureCaptured(defId, meta.varIndex, meta.location, nestedCtx, reachingInByNode) &&
      defCtx !== undefined &&
      isDeclarationFreshAllocation(defCtx) &&
      varHasOnlyFreshDefs.has(meta.varIndex) &&
      !varHasUserDefinedAccessor.has(meta.varIndex) &&
      !varHasMixedFreshKinds.has(meta.varIndex);

    if (!isCase67) {
      if (usedDefs.has(defId)) {
        continue;
      }

      if (isDefClosureCaptured(defId, meta.varIndex, meta.location, nestedCtx, reachingInByNode)) {
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

  // Phase 2: module-scope redundant single-use bindings (CLAUDE.md "모든 scope").
  collectRedundantBindingFindings({
    bodyNodes: programBody,
    defs,
    defCtxByLocation,
    syntacticReads,
    localIndexByName,
    varInitKind,
    skipLocations: new Set<number>([...exportExemption.locations, ...namespaceMemberLocations]),
    skipNames: exportExemption.names,
    filePath,
    lineOffsets,
    findings,
  });
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
    collectWasteFindingsForModule(file.program, file.filePath, file.sourceText, lineOffsets, findings);

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
        collectWasteFindingsForFunction(node, functionBodyNode, file.filePath, file.sourceText, lineOffsets, findings);
      }

      forEachChildNode(node, child => visit(child));
    };

    visit(file.program);
  }

  return findings;
};
