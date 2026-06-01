import type { Gildash } from '@zipbul/gildash';
import type { Node } from 'oxc-parser';

import { buildLineOffsets, getLineColumn } from '@zipbul/gildash';

import type { ParsedFile } from '../../engine/types';
import type { ErrorFlowFinding, ErrorFlowFindingKind, SourceSpan } from './types';
import type { TypeOracle } from './type-oracle';

import { forEachChildNode, walkOxcTree } from '../../engine/ast/oxc-ast-utils';
import { createTypeOracle } from './type-oracle';

interface AnalyzeErrorFlowInput {
  readonly gildash?: Gildash;
}

const getSpan = (node: Node, sourceText: string): SourceSpan => {
  const offsets = buildLineOffsets(sourceText);

  return {
    start: getLineColumn(offsets, node.start),
    end: getLineColumn(offsets, node.end),
  };
};

interface PushFindingInput {
  readonly kind: ErrorFlowFindingKind;
  readonly filePath: string;
  readonly sourceText: string;
  readonly node: Node;
  readonly evidence: string;
}

const pushFinding = (findings: ErrorFlowFinding[], input: PushFindingInput): void => {
  const evidence = input.evidence.length > 0 ? input.evidence : 'unknown';

  findings.push({
    kind: input.kind,
    file: input.filePath,
    span: getSpan(input.node, input.sourceText),
    evidence,
  });
};

const getEvidenceLineAt = (sourceText: string, index: number): string => {
  const start = Math.max(0, sourceText.lastIndexOf('\n', index - 1) + 1);
  const endBreak = sourceText.indexOf('\n', index);
  const end = endBreak === -1 ? sourceText.length : endBreak;

  return sourceText.slice(start, end).trim();
};

const isIdentifierName = (node: Node, name: string): boolean => {
  if (node.type !== 'Identifier') {
    return false;
  }

  return typeof node.name === 'string' && node.name === name;
};

interface TypedNode {
  readonly type: string;
}

interface FunctionScopeKind {
  readonly type: 'FunctionDeclaration' | 'FunctionExpression' | 'ArrowFunctionExpression';
}

interface FunctionLiteralKind {
  readonly type: 'ArrowFunctionExpression' | 'FunctionExpression';
}

// A function *scope* boundary in traversal — declarations and both expression forms. Used by the
// local walkers to stop at nested functions (their bodies belong to a different error-flow context).
// Type predicate so callers keep oxc's discriminated-union narrowing.
const isFunctionScope = <T extends TypedNode>(node: T): node is T & FunctionScopeKind =>
  node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression';

// A function *literal* usable as a callback argument (never a declaration).
const isFunctionLiteral = <T extends TypedNode>(node: T): node is T & FunctionLiteralKind =>
  node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression';

// A construct whose body executes conditionally / repeatedly. Used to nest the unobserved-variable
// branch depth so a reassignment inside one is not treated as an unconditional overwrite. (TryStatement
// is handled by the walker directly.)
const branchConstructTypes = new Set([
  'IfStatement',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
  'SwitchStatement',
  'ConditionalExpression',
  'LogicalExpression',
]);

const isBranchConstruct = (node: Node): boolean => branchConstructTypes.has(node.type);

// Collect the binding identifiers a parameter pattern introduces — plain `p`, default `p = …`, rest
// `...p`, and destructured `{ p }` / `[p]` (recursively). Only true binding positions are added; a
// computed key (`{ [c]: v }`) contributes `v`, never `c`, so an outer reference is never mistaken for
// a shadow (which would be a false positive).
const collectBindingNames = (pattern: Node, names: Set<string>): void => {
  switch (pattern.type) {
    case 'Identifier':
      if (typeof pattern.name === 'string') {
        names.add(pattern.name);
      }

      break;
    case 'AssignmentPattern':
      collectBindingNames(pattern.left, names);
      break;
    case 'RestElement':
      collectBindingNames(pattern.argument, names);
      break;
    case 'ArrayPattern':
      for (const element of pattern.elements) {
        if (element !== null) {
          collectBindingNames(element, names);
        }
      }

      break;
    case 'ObjectPattern':
      for (const property of pattern.properties) {
        if (property.type === 'RestElement') {
          collectBindingNames(property.argument, names);
        } else {
          collectBindingNames(property.value, names);
        }
      }

      break;
    case 'TSParameterProperty':
      collectBindingNames(pattern.parameter, names);
      break;
    default:
      break;
  }
};

// The names a function binds as parameters — they shadow same-named outer unobserved-variable
// candidates, so a read of a shadowing param must not mark the outer promise observed.
const collectParamBindingNames = (params: ReadonlyArray<Node>): Set<string> => {
  const names = new Set<string>();

  for (const param of params) {
    collectBindingNames(param, names);
  }

  return names;
};

const getMemberPropertyName = (callee: Node): string | null => {
  if (callee.type !== 'MemberExpression') {
    return null;
  }

  const prop = callee.property;

  if (prop.type === 'Identifier' && typeof prop.name === 'string') {
    return prop.name;
  }

  return null;
};

// An identifier is a *read* (its value escapes to the surrounding expression) unless it is a
// declaration name, a non-computed member property, a non-shorthand object key, or the target of
// an assignment / update. Used by unobserved-variable so a promise escaping via ANY expression
// (`return { p }`, `return [p]`, `cond ? p : x`, `o.p = p`, …) counts as observed.
const isIdentifierReadEscape = (node: Node, parent: Node): boolean => {
  switch (parent.type) {
    case 'VariableDeclarator':
      return parent.id !== node;
    case 'MemberExpression':
      return !(parent.property === node && parent.computed === false);
    case 'Property':
      return !(parent.key === node && parent.shorthand === false);
    case 'AssignmentExpression':
      return parent.left !== node;
    case 'UpdateExpression':
      return false;
    // TS value-wrappers: only the wrapped expression is a runtime read (`x as T` → `x`).
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSNonNullExpression':
    case 'TSTypeAssertion':
      return parent.expression === node;
    default:
      // Other `TS*` parents are type positions (type references, signatures, `typeof` queries,
      // type parameters …) — identifiers there are not runtime reads of the value.
      return !parent.type.startsWith('TS');
  }
};

const knownPrimitiveWrappers = new Set(['String', 'Number', 'Boolean', 'Symbol', 'BigInt']);

const isPrimitiveWrapperName = (name: string): boolean => knownPrimitiveWrappers.has(name);

// Unwrap TS type-assertion wrappers so the *runtime* value is judged, not the asserted type:
// `'x' as unknown as Error` is a string at runtime and still loses the stack trace.
const unwrapThrowExpression = (node: Node): Node => {
  let current = node;

  while (
    current.type === 'TSAsExpression' ||
    current.type === 'TSSatisfiesExpression' ||
    current.type === 'TSNonNullExpression' ||
    current.type === 'TSTypeAssertion'
  ) {
    current = current.expression;
  }

  return current;
};

// throw-non-error fires only when the thrown value is *provably* not an Error (it would lose the
// stack trace / cause). Sound by construction: anything that could be an Error — identifiers,
// member access, calls of unknown type, new, await, conditionals — gets the benefit of the doubt
// (K). The syntactic floor reports literal-shaped values; the oracle augments it by proving the
// value's static type is a bare primitive (`throw msg`/`throw o.msg`/`throw g()`).
const isProvablyNonErrorThrow = (arg: Node, oracle: TypeOracle): boolean => {
  const value = unwrapThrowExpression(arg);

  // Literals and composite literals are never Error instances.
  if (
    value.type === 'Literal' ||
    value.type === 'TemplateLiteral' ||
    value.type === 'ObjectExpression' ||
    value.type === 'ArrayExpression'
  ) {
    return true;
  }

  // String()/Number()/Boolean()/Symbol()/BigInt() always produce a primitive.
  if (value.type === 'CallExpression' && value.callee.type === 'Identifier' && isPrimitiveWrapperName(value.callee.name)) {
    return true;
  }

  return oracle.isPrimitiveValue(value);
};

// The first argument of a `Promise.reject(X)` call, or null if `expr` is not one.
const promiseRejectArgument = (expr: Node): Node | null => {
  if (expr.type !== 'CallExpression') {
    return null;
  }

  const callee = expr.callee;

  if (
    callee.type !== 'MemberExpression' ||
    callee.object.type !== 'Identifier' ||
    callee.object.name !== 'Promise' ||
    callee.property.type !== 'Identifier' ||
    callee.property.name !== 'reject'
  ) {
    return null;
  }

  return expr.arguments[0] ?? null;
};

// The error value a statement throws or rejects with: `throw X` or `return Promise.reject(X)` (the
// async equivalent — the caller receives the rejection, so the cause-preservation rule applies the
// same way). Returns null for any other statement.
const throwOrRejectArgument = (node: Node): Node | null => {
  if (node.type === 'ThrowStatement') {
    return node.argument;
  }

  if (node.type === 'ReturnStatement' && node.argument !== null) {
    return promiseRejectArgument(node.argument);
  }

  return null;
};

const isErrorConstructor = (callee: Node): boolean => {
  if (callee.type !== 'Identifier') {
    return false;
  }

  const name = callee.name;

  return (
    name === 'Error' ||
    name === 'TypeError' ||
    name === 'RangeError' ||
    name === 'ReferenceError' ||
    name === 'SyntaxError' ||
    name === 'URIError' ||
    name === 'EvalError' ||
    name === 'AggregateError'
  );
};

const isPromiseFactoryCall = (expr: Node): boolean => {
  // Dynamic import expression — always returns a Promise.
  if (expr.type === 'ImportExpression') {
    return true;
  }

  // `new Promise(...)`
  if (expr.type === 'NewExpression') {
    const callee = expr.callee;

    return callee.type === 'Identifier' && callee.name === 'Promise';
  }

  if (expr.type !== 'CallExpression') {
    return false;
  }

  const callee = expr.callee;

  if (callee.type !== 'MemberExpression') {
    return false;
  }

  const obj = callee.object;
  const prop = callee.property;

  if (obj.type !== 'Identifier' || obj.name !== 'Promise') {
    return false;
  }

  if (prop.type !== 'Identifier') {
    return false;
  }

  const name = prop.name;

  return name === 'resolve' || name === 'reject' || name === 'all' || name === 'race' || name === 'any' || name === 'allSettled';
};

// A handler body that discards the rejection without observing or rethrowing it: an empty block
// (`() => {}`) or an expression body that yields a no-information value (`() => undefined`,
// `() => null`, `() => void x`). These all settle the chain to a value, swallowing the reason
// identically. A handler that returns a meaningful recovery value or calls anything is NOT trivial.
const isTrivialSwallowBody = (body: Node): boolean =>
  (body.type === 'BlockStatement' && body.body.length === 0) ||
  (body.type === 'Identifier' && body.name === 'undefined') ||
  (body.type === 'Literal' && body.value === null) ||
  (body.type === 'UnaryExpression' && body.operator === 'void');

// A rejection handler — `.catch(<h>)` or `.then(_, <h>)` — that swallows the rejection exactly like
// an empty catch block. Returns the handler body (the finding span), or null.
const emptyRejectionHandlerBody = (method: string | null, args: ReadonlyArray<Node>): Node | null => {
  const handler = method === 'catch' ? args[0] : method === 'then' ? args[1] : undefined;

  if (handler !== undefined && isFunctionLiteral(handler) && handler.body !== null && isTrivialSwallowBody(handler.body)) {
    return handler.body;
  }

  return null;
};

// A `.then` second argument / `.catch` argument that handles nothing — `undefined`, `null`, or
// `void x`. Such a placeholder does not actually observe the rejection.
const isNonHandler = (node: Node): boolean =>
  (node.type === 'Identifier' && node.name === 'undefined') ||
  (node.type === 'Literal' && node.value === null) ||
  (node.type === 'UnaryExpression' && node.operator === 'void');

const chainHasCatch = (expr: Node): boolean => {
  let current: Node = expr;

  while (current.type === 'CallExpression') {
    const callee = current.callee;
    const method = getMemberPropertyName(callee);

    if (method === 'catch') {
      return true;
    }

    // .then(onFulfilled, onRejected) — the second argument handles rejection like .catch(), but only
    // when it is a real handler (a `undefined`/`null`/`void` placeholder observes nothing).
    if (method === 'then' && current.arguments.length >= 2) {
      const onRejected = current.arguments[1];

      if (onRejected !== undefined && !isNonHandler(onRejected)) {
        return true;
      }
    }

    // Walk down the chain: expr.callee.object is the previous call
    if (callee.type === 'MemberExpression') {
      current = callee.object;
    } else {
      break;
    }
  }

  return false;
};

// True when the chain contains a `.then(...)` call anywhere — a started-but-incomplete chain
// whose rejection is unobserved unless a `.catch` also appears (checked separately).
const chainHasThen = (expr: Node): boolean => {
  let current: Node = expr;

  while (current.type === 'CallExpression') {
    if (getMemberPropertyName(current.callee) === 'then') {
      return true;
    }

    if (current.callee.type === 'MemberExpression') {
      current = current.callee.object;
    } else {
      break;
    }
  }

  return false;
};

type UnsafeControlFlowKind = 'return' | 'throw' | 'break' | 'continue';

const findUnsafeControlFlowInFinally = (finalizer: Node): UnsafeControlFlowKind | null => {
  let result: UnsafeControlFlowKind | null = null;
  const localLabels = new Set<string>();

  // Pre-collect all labels defined inside the finalizer
  walkOxcTree(finalizer, node => {
    if (node.type === 'LabeledStatement') {
      const label = node.label;

      if (typeof label.name === 'string') {
        localLabels.add(label.name);
      }
    }

    // Don't cross function boundaries
    if (isFunctionScope(node)) {
      return false;
    }

    return true;
  });

  const walk = (node: Node, loopDepth: number, switchDepth: number): void => {
    if (result !== null) {
      return;
    }

    // Don't cross function boundaries
    if (isFunctionScope(node)) {
      return;
    }

    if (node.type === 'ReturnStatement') {
      result = 'return';

      return;
    }

    if (node.type === 'ThrowStatement') {
      result = 'throw';

      return;
    }

    if (node.type === 'BreakStatement') {
      const label = node.label;
      const labelName = label !== null ? label.name : null;

      if (labelName !== null) {
        // labeled break: unsafe only if label is defined outside finally
        if (!localLabels.has(labelName)) {
          result = 'break';

          return;
        }
      } else if (loopDepth === 0 && switchDepth === 0) {
        // unlabeled break without enclosing loop/switch in finally
        result = 'break';

        return;
      }
    }

    if (node.type === 'ContinueStatement') {
      const label = node.label;
      const labelName = label !== null ? label.name : null;

      if (labelName !== null) {
        if (!localLabels.has(labelName)) {
          result = 'continue';

          return;
        }
      } else if (loopDepth === 0) {
        result = 'continue';

        return;
      }
    }

    const isLoop =
      node.type === 'ForStatement' ||
      node.type === 'WhileStatement' ||
      node.type === 'DoWhileStatement' ||
      node.type === 'ForInStatement' ||
      node.type === 'ForOfStatement';
    const isSwitch = node.type === 'SwitchStatement';

    forEachChildNode(node, child => {
      walk(child, isLoop ? loopDepth + 1 : loopDepth, isSwitch ? switchDepth + 1 : switchDepth);
    });
  };

  walk(finalizer, 0, 0);

  return result;
};

// Names bound to the executor's settle callbacks (resolve, reject) — used to detect a
// throw that runs AFTER the promise is already settled.
const collectExecutorParamNames = (executor: Node): ReadonlySet<string> => {
  const names = new Set<string>();

  if (executor.type !== 'ArrowFunctionExpression' && executor.type !== 'FunctionExpression') {
    return names;
  }

  for (const param of executor.params) {
    if (param.type === 'Identifier' && typeof param.name === 'string') {
      names.add(param.name);
    }
  }

  return names;
};

// A bare `throw` in a sync executor is converted to a rejection by the Promise
// constructor (observable, propagated, cause preserved — K). Only a throw that runs AFTER
// a settle call (resolve/reject) is swallowed, because the promise is already settled and
// the constructor's reject becomes a no-op. Bounded to top-level sequential statements to
// stay sound (no branch analysis → flag only a guaranteed-after-settle throw).
const throwAfterSettleInExecutor = (body: Node, settleNames: ReadonlySet<string>): boolean => {
  if (body.type !== 'BlockStatement') {
    return false;
  }

  let settled = false;

  for (const stmt of body.body) {
    if (settled && stmt.type === 'ThrowStatement') {
      return true;
    }

    if (
      stmt.type === 'ExpressionStatement' &&
      stmt.expression.type === 'CallExpression' &&
      stmt.expression.callee.type === 'Identifier' &&
      settleNames.has(stmt.expression.callee.name)
    ) {
      settled = true;
    }
  }

  return false;
};

// misused-promises (result-returning group): the async-callback result is lost only when
// the call's value is discarded — a bare expression statement, a `void` operand, or a
// non-final element of a sequence expression. Anywhere else the promises flow onward (K).
const isResultDiscarded = (call: Node, parent: Node | null): boolean => {
  if (parent === null) {
    return false;
  }

  if (parent.type === 'ExpressionStatement') {
    return true;
  }

  if (parent.type === 'UnaryExpression' && parent.operator === 'void') {
    return true;
  }

  if (parent.type === 'SequenceExpression') {
    const exprs = parent.expressions;

    return exprs.length > 0 && exprs[exprs.length - 1] !== call;
  }

  return false;
};

const nodeStyleCallbackMethods = new Set([
  'readFile',
  'writeFile',
  'readdir',
  'stat',
  'unlink',
  'mkdir',
  'rmdir',
  'access',
  'rename',
  'copyFile',
  'exec',
  'execFile',
  'spawn',
]);
// Array iteration methods misused with an async callback (misused-promises).
//  - always-W: forEach ignores the result; predicate/comparator methods coerce the returned
//    (always-truthy) promise, so the async intent is lost regardless of where the value goes.
//  - result-W: map/flatMap/reduce/reduceRight make the promises the return value, so the
//    rejections are observable when that value flows somewhere — only a discarded result loses them.
const alwaysMisusedArrayMethods = new Set(['forEach', 'filter', 'some', 'every', 'find', 'findIndex', 'sort']);
const resultMisusedArrayMethods = new Set(['map', 'flatMap', 'reduce', 'reduceRight']);

const containsNodeStyleCallback = (body: Node): boolean => {
  let found = false;

  walkOxcTree(body, node => {
    if (node.type === 'CallExpression') {
      const method = getMemberPropertyName(node.callee);

      if (method !== null && nodeStyleCallbackMethods.has(method)) {
        const args = node.arguments;
        const last = args[args.length - 1];
        const isCallbackArg =
          last !== undefined && isFunctionLiteral(last);

        if (isCallbackArg) {
          found = true;

          return false;
        }
      }
    }

    if (isFunctionScope(node)) {
      return false;
    }

    return true;
  });

  return found;
};

const containsIdentifierUse = (node: Node, name: string): boolean => {
  let found = false;

  walkOxcTree(node, inner => {
    if (!(inner.type === 'Identifier' && inner.name === name)) {
      return true;
    }

    found = true;

    return false;
  });

  return found;
};

// The caught error identifier appears as a *direct* argument of the NewExpression (`new E(msg, e)`),
// as opposed to a derived value (`new E(e.message)`). A whole-error argument may be forwarded as the
// constructor's cause, so it counts as cause-possibly-preserved.
const errorParamIsDirectArgument = (newExpr: Node, name: string): boolean =>
  newExpr.type === 'NewExpression' &&
  newExpr.arguments.some(
    // `new E(…, e)` / `new E(…, e as Error)` — the caught error passed whole (TS casts unwrapped), or
    // `new E(…, ...rest)` where a spread could carry it (opaque — suppress rather than over-report).
    argument => isIdentifierName(unwrapThrowExpression(argument), name) || argument.type === 'SpreadElement',
  );

const hasCausePropertyWithIdentifier = (node: Node, name: string): boolean => {
  let found = false;

  walkOxcTree(node, inner => {
    if (inner.type !== 'ObjectExpression') {
      return true;
    }

    for (const prop of inner.properties) {
      if (prop.type !== 'Property') {
        continue;
      }

      const key = prop.key;
      const value = prop.value;

      if (
        !((key.type === 'Identifier' && key.name === 'cause') || (key.type === 'Literal' && key.value === 'cause'))
      ) {
        continue;
      }

      // Unwrap TS assertions on the cause value — `{ cause: error as Error }` / `{ cause: error! }`
      // still forwards the caught error.
      if (isIdentifierName(unwrapThrowExpression(value), name)) {
        found = true;

        return false;
      }
    }

    return true;
  });

  return found;
};

// A direct assignment `<member>.cause = <param>` preserves the original error's cause just like
// `new Error(msg, { cause })`. Body-level and conservative: any such assignment in the catch
// body marks the cause as preserved (avoids false positives on the wrap-then-assign pattern).
const bodyAssignsCauseFromParam = (body: Node, name: string): boolean => {
  let found = false;

  walkOxcTree(body, node => {
    if (
      node.type === 'AssignmentExpression' &&
      node.operator === '=' &&
      getMemberPropertyName(node.left) === 'cause' &&
      isIdentifierName(node.right, name)
    ) {
      found = true;

      return false;
    }

    if (isFunctionScope(node)) {
      return false;
    }

    return true;
  });

  return found;
};

// Promise.prototype.finally IGNORES the callback's return value, but if the callback THROWS (or
// returns a rejected promise) the result promise rejects with that — masking the original
// settlement, including the original rejection. So a returned value is harmless (not flagged),
// while an escaping throw masks the error. Detect a throw that escapes the callback body: not
// inside a nested function, and conservatively not inside a try statement (which may catch it).
const finallyCallbackThrows = (arg: Node | undefined): boolean => {
  if (
    arg === undefined ||
    (arg.type !== 'ArrowFunctionExpression' && arg.type !== 'FunctionExpression' && arg.type !== 'FunctionDeclaration')
  ) {
    return false;
  }

  const body = arg.body;

  if (body === null || body.type !== 'BlockStatement') {
    return false;
  }

  let found = false;

  walkOxcTree(body, node => {
    if (found) {
      return false;
    }

    if (node.type === 'ThrowStatement') {
      found = true;

      return false;
    }

    if (
      isFunctionScope(node) ||
      node.type === 'TryStatement'
    ) {
      return false;
    }

    return true;
  });

  return found;
};

// The specific oxc node type for a given `type` discriminant — lets each rule take its exact node
// (e.g. NodeOfType<'ThrowStatement'>) so there is no re-checking or casting inside.
interface NodeTypeTag<K extends string> {
  readonly type: K;
}

type NodeOfType<K extends Node['type']> = Extract<Node, NodeTypeTag<K>>;

// An unobserved-variable candidate: the declaration/assignment node to report, plus the branch
// nesting depth where it was bound (so a reassignment is only treated as an overwrite when it
// happens at the same depth — an unconditional, dominating reassignment, not a conditional one).
interface CandidateInfo {
  readonly node: Node;
  readonly branchDepth: number;
}

const collectFindings = (program: Node, sourceText: string, filePath: string, gildash: Gildash | null): ErrorFlowFinding[] => {
  const findings: ErrorFlowFinding[] = [];
  // Traversal state read by return-await-in-try: are we inside an async function, and inside the
  // *block* of a try that has a catch clause? Maintained by the walker, saved/restored per function.
  let inAsyncFunction = false;
  let inTryBlockWithCatchDepth = 0;
  // Branch nesting within the current function (if/loop/switch/ternary/logical/try) — used by the
  // reassignment-kill check for unobserved-variable.
  let branchDepth = 0;
  // Unobserved-variable tracking: stack of candidate/observed sets per function scope, plus the
  // names a scope's function binds as parameters (those shadow same-named outer candidates, so a
  // read of a shadowing param must not mark the outer promise observed).
  const unobservedCandidates: Map<string, CandidateInfo>[] = [];
  const unobservedObserved: Set<string>[] = [];
  const unobservedShadows: Set<string>[] = [];
  // The sole owner of gildash type queries for this file. When gildash is unavailable every query
  // answers `false`, so degraded scans never over-report.
  const oracle = createTypeOracle(gildash, filePath);

  // A function literal whose result is a thenable: `async` (always returns a Promise), or an
  // expression-bodied arrow whose returned expression the oracle proves is a thenable (`() => go()`).
  // Block-bodied non-async functions are not inspected (their returns are not a single expression).
  const callbackReturnsThenable = (fn: Node): boolean => {
    if (!isFunctionLiteral(fn)) {
      return false;
    }

    if (fn.async === true) {
      return true;
    }

    return fn.type === 'ArrowFunctionExpression' && fn.expression === true && fn.body !== null && oracle.isThenable(fn.body);
  };

  // Declarators of `export const/let/var` bindings. An exported binding's promise can be observed
  // (awaited / `.catch`-ed) by an importing module, which is cross-module and out of this detector's
  // file scope — so it is never an unobserved-variable candidate.
  const exportedDeclarators = new Set<Node>();

  walkOxcTree(program, node => {
    if (node.type === 'ExportNamedDeclaration' && node.declaration !== null && node.declaration.type === 'VariableDeclaration') {
      for (const declarator of node.declaration.declarations) {
        exportedDeclarators.add(declarator);
      }
    }

    return true;
  });

  const pushUnobservedScope = (shadowNames: Set<string>): void => {
    unobservedCandidates.push(new Map());
    unobservedObserved.push(new Set());
    unobservedShadows.push(shadowNames);
  };

  const popUnobservedScope = (): void => {
    const candidates = unobservedCandidates.pop();
    const observed = unobservedObserved.pop();

    unobservedShadows.pop();

    if (candidates === undefined || observed === undefined) {
      return;
    }

    for (const [name, info] of candidates) {
      if (!observed.has(name)) {
        report('unobserved-variable', info.node);
      }
    }
  };

  const markObserved = (name: string): void => {
    // Walk from innermost scope outward. Mark observed in each scope, but stop at the first scope
    // that OWNS the name — it is a candidate there, or that scope's function binds it as a parameter
    // (a shadowing binding). Outer scopes with the same name are different variables.
    for (let i = unobservedObserved.length - 1; i >= 0; i -= 1) {
      const scope = unobservedObserved[i];

      if (scope !== undefined) {
        scope.add(name);
      }

      const candidates = unobservedCandidates[i];
      const shadows = unobservedShadows[i];

      if ((candidates !== undefined && candidates.has(name)) || shadows?.has(name) === true) {
        break;
      }
    }
  };

  const addCandidate = (name: string, node: Node): void => {
    const top = unobservedCandidates[unobservedCandidates.length - 1];

    if (top !== undefined) {
      top.set(name, { node, branchDepth });
    }
  };

  // Reassignment-kill: `p = <new value>` overwrites the binding. If `p` currently holds an
  // unobserved thenable candidate bound at the same branch depth (an unconditional, dominating
  // reassignment — not one guarded by an if/loop) and the right-hand side does not read `p`, the old
  // promise's rejection floats. Flag it, then track the new value if it too is a thenable.
  const ruleReassignmentKill = (node: NodeOfType<'AssignmentExpression'>): void => {
    if (node.operator !== '=' || node.left.type !== 'Identifier') {
      return;
    }

    const name = node.left.name;
    const top = unobservedCandidates[unobservedCandidates.length - 1];
    const info = top?.get(name);
    const observed = unobservedObserved[unobservedObserved.length - 1];

    if (
      top === undefined ||
      info === undefined ||
      observed?.has(name) === true ||
      info.branchDepth !== branchDepth ||
      containsIdentifierUse(node.right, name)
    ) {
      return;
    }

    report('unobserved-variable', info.node);
    top.delete(name);

    if (oracle.isThenable(node.right)) {
      addCandidate(name, node);
    }
  };

  // Finding emitters bound to this file's invariants (findings/filePath/sourceText). `report` uses
  // the source line at the node's start as evidence (the common case); `reportWith` takes explicit
  // prose evidence (or a different evidence anchor than the finding node).
  const report = (kind: ErrorFlowFindingKind, node: Node): void => {
    pushFinding(findings, { kind, node, filePath, sourceText, evidence: getEvidenceLineAt(sourceText, node.start) });
  };

  const reportWith = (kind: ErrorFlowFindingKind, node: Node, evidence: string): void => {
    pushFinding(findings, { kind, node, filePath, sourceText, evidence });
  };

  const ruleMissingErrorCause = (catchClause: NodeOfType<'CatchClause'>): void => {
    const param = catchClause.param;
    const body = catchClause.body;

    // Optional catch binding: `catch { throw new Error('fail') }` / `catch { return Promise.reject(new Error()) }`.
    if (param === null) {
      walkOxcTree(body, node => {
        // A nested function's throw/return is a different control-flow context, not this catch's.
        if (isFunctionScope(node)) {
          return false;
        }

        const arg = throwOrRejectArgument(node);

        if (arg === null || arg.type !== 'NewExpression') {
          return true;
        }

        if (isErrorConstructor(arg.callee)) {
          report('missing-error-cause', node);
        }

        return true;
      });

      return;
    }

    // Non-identifier param (e.g., destructured): skip
    if (param.type !== 'Identifier') {
      return;
    }

    const name = param.name;
    // `err.cause = e` preserves the cause as effectively as `new Error(msg, { cause: e })`.
    const causeAssigned = bodyAssignsCauseFromParam(body, name);
    // Catch param reassigned to a NEW error that drops the cause: `catch(e){ e = new Error(); throw e }`.
    // A reassignment that preserves the cause (`e = new Error(m, { cause: e })`) keeps the chain, so it
    // is not a violation — apply the same cause-preservation check used at the throw sites below.
    let hasUncausedReassignment = false;

    walkOxcTree(body, node => {
      if (
        node.type === 'AssignmentExpression' &&
        isIdentifierName(node.left, name) &&
        node.right.type === 'NewExpression' &&
        !(causeAssigned || hasCausePropertyWithIdentifier(node.right, name))
      ) {
        hasUncausedReassignment = true;

        return false;
      }

      // Don't cross function boundaries for reassignment check
      if (isFunctionScope(node)) {
        return false;
      }

      return true;
    });

    if (hasUncausedReassignment) {
      report('missing-error-cause', catchClause);

      return;
    }

    // Map varName -> NewExpression for indirect throw detection: `const wrapped = new Error(...); throw wrapped;`
    // Uses walkOxcTree to cover nested blocks (if/for/etc.) within catch body.
    const localNewExpressions = new Map<string, Node>();

    walkOxcTree(body, node => {
      if (node.type === 'VariableDeclarator') {
        const id = node.id;
        const init = node.init;

        if (id.type === 'Identifier' && typeof id.name === 'string' && init !== null && init.type === 'NewExpression') {
          localNewExpressions.set(id.name, init);
        }
      }

      // `w = new Error(...)` — a wrapper bound by assignment rather than declaration (last write wins).
      if (node.type === 'AssignmentExpression' && node.operator === '=' && node.left.type === 'Identifier' && node.right.type === 'NewExpression') {
        localNewExpressions.set(node.left.name, node.right);
      }

      // Don't cross function boundaries
      if (isFunctionScope(node)) {
        return false;
      }

      return true;
    });

    // Find throw new X(...) — direct inline throw, and throw <identifier> — indirect via variable.
    // NOTE: This walkOxcTree is a LOCAL traversal of the catch body, not a full program traversal.
    // It runs at CatchClause visit time to analyze throw patterns as a unit. The subsequent
    // visit() generic fallthrough re-visits catch body children for OTHER rules (throw-non-error,
    // unobserved-variable, etc.) — no duplicate findings because each path checks different kinds.
    walkOxcTree(body, node => {
      // A nested function's throw/return is a different control-flow context, not this catch's.
      if (isFunctionScope(node)) {
        return false;
      }

      const arg = throwOrRejectArgument(node);

      if (arg === null) {
        return true;
      }

      // Indirect throw: throw <identifier> where identifier was assigned a new Error(...)
      if (arg.type === 'Identifier' && typeof arg.name === 'string') {
        const varName = arg.name;

        // `throw <catchParam>` is a bare rethrow of the original caught error (cause preserved). The
        // catch param cannot be re-declared as a `const` in the same block, so any same-named local
        // is a dead inner-block shadow — never the thrown binding. (An uncaused reassignment of the
        // param was already handled above.) Resolve only genuine indirect bindings.
        if (varName === name) {
          return true;
        }

        const newExpr = localNewExpressions.get(varName);

        if (newExpr !== undefined && newExpr.type === 'NewExpression') {
          if (isErrorConstructor(newExpr.callee)) {
            const hasCause = causeAssigned || hasCausePropertyWithIdentifier(newExpr, name);

            if (!hasCause) {
              report('missing-error-cause', node);
            }
          }
        }

        return true;
      }

      if (arg.type !== 'NewExpression') {
        return true;
      }

      // Prefer a specific finding for Error constructors without { cause }.
      if (isErrorConstructor(arg.callee)) {
        const hasCause = causeAssigned || hasCausePropertyWithIdentifier(arg, name);

        if (!hasCause) {
          report('missing-error-cause', node);
        }

        return true;
      }

      // Custom error class: a cause-less wrap loses the chain only when the thrown class is actually
      // an Error subtype (throwing a non-Error object is throw-non-error's concern, not this rule's).
      // The oracle proves the subtype at the throw site; degraded scans answer `false` (no over-report).
      // Passing the caught error *whole* into the constructor (`new DomainError(msg, e)`) may store it
      // as the cause — the constructor body is opaque, so treat that conservatively as preserved (a
      // derived value like `e.message` does not count).
      const hasCause = causeAssigned || hasCausePropertyWithIdentifier(arg, name) || errorParamIsDirectArgument(arg, name);

      if (!hasCause && oracle.isErrorSubtype(arg)) {
        // Span at the throw when the param is used in the thrown expression, else at the catch clause
        // (the original error is only referenced by the binding, so the loss is the clause as a whole).
        const target = containsIdentifierUse(arg, name) ? node : catchClause;

        reportWith('missing-error-cause', target, getEvidenceLineAt(sourceText, node.start));
      }

      return true;
    });
  };

  // empty-catch: a catch with no statements swallows the error entirely — observability,
  // propagation and cause are all lost (W). A comment does not restore any of them, so it
  // does not exempt the catch (notation conventions are out of scope per the concept def).
  const ruleEmptyCatch = (catchClause: NodeOfType<'CatchClause'>): void => {
    const body = catchClause.body;

    if (body.type !== 'BlockStatement' || body.body.length !== 0) {
      return;
    }

    reportWith('empty-catch', body, 'empty catch swallows the error');
  };

  // ── Leaf rules — one error-flow concern each. The walker narrows the node and dispatches. ──

  // unsafe-finally: a finally block that throws/returns/breaks/continues masks the try's outcome.
  const ruleUnsafeFinally = (node: NodeOfType<'TryStatement'>): void => {
    if (node.finalizer === null) {
      return;
    }

    const unsafeKind = findUnsafeControlFlowInFinally(node.finalizer);

    if (unsafeKind !== null) {
      reportWith('unsafe-finally', node, `finally contains ${unsafeKind}`);
    }
  };

  // return-await-in-try: a non-awaited return of a promise inside a try-with-catch escapes the
  // catch — the rejection is observed by the caller, not the local handler. Reads the traversal
  // state the walker maintains (only true inside the block of a try that has a catch, in an async fn).
  const ruleReturnAwaitInTry = (node: NodeOfType<'ReturnStatement'>): void => {
    if (!(inTryBlockWithCatchDepth > 0 && inAsyncFunction)) {
      return;
    }

    const arg = node.argument;

    if (arg === null || arg.type === 'AwaitExpression') {
      return;
    }

    // Conservative, mirroring floating-promises: flag only what is provably a promise. `import()`
    // is syntactically always one; calls/members need gildash (no flag-all fallback — that produced
    // FPs like `return new Response()`). A constructed instance is almost never a thenable.
    let shouldFlag = false;

    if (arg.type === 'ImportExpression') {
      shouldFlag = true;
    } else if (arg.type !== 'NewExpression') {
      shouldFlag = oracle.isThenable(arg);
    }

    if (shouldFlag) {
      report('return-await-in-try', node);
    }
  };

  // throw-non-error: flag only when the thrown value is provably not an Error (loses stack/cause).
  const ruleThrowNonError = (node: NodeOfType<'ThrowStatement'>): void => {
    if (isProvablyNonErrorThrow(node.argument, oracle)) {
      report('throw-non-error', node);
    }
  };

  // promise-constructor-hygiene: async executor (throws swallowed), throw-after-settle, or a first
  // executor param named `reject` (a real rejection becomes a silent resolution).
  const rulePromiseConstructorHygiene = (node: NodeOfType<'NewExpression'>): void => {
    const callee = node.callee;
    const isPromiseIdent = callee.type === 'Identifier' && callee.name === 'Promise';
    const isPromiseMember =
      !isPromiseIdent &&
      callee.type === 'MemberExpression' &&
      callee.object.type === 'Identifier' &&
      (callee.object.name === 'globalThis' || callee.object.name === 'window' || callee.object.name === 'self') &&
      callee.property.type === 'Identifier' &&
      callee.property.name === 'Promise';

    if (!(isPromiseIdent || isPromiseMember)) {
      return;
    }

    const executor = node.arguments[0];

    if (executor === undefined || !isFunctionLiteral(executor)) {
      return;
    }

    const reportHygiene = (): void => {
      report('promise-constructor-hygiene', node);
    };

    if (executor.async === true) {
      reportHygiene();
    } else {
      const executorBody = executor.body;

      if (
        executorBody !== null &&
        executorBody.type === 'BlockStatement' &&
        throwAfterSettleInExecutor(executorBody, collectExecutorParamNames(executor))
      ) {
        reportHygiene();
      }
    }

    const firstParam = executor.params[0];

    if (firstParam !== undefined && firstParam.type === 'Identifier' && firstParam.name === 'reject') {
      reportHygiene();
    }
  };

  // unobserved-variable (candidate side): register a `const x = <thenable call/new>` binding whose
  // rejection would float if never observed. Observation is the walker's identifier-read hook.
  const ruleUnobservedCandidate = (node: NodeOfType<'VariableDeclarator'>): void => {
    const id = node.id;
    const init = node.init;

    if (
      id.type !== 'Identifier' ||
      typeof id.name !== 'string' ||
      init === null ||
      !(init.type === 'CallExpression' || init.type === 'NewExpression')
    ) {
      return;
    }

    // The oracle excludes `any` and answers `false` without gildash (degraded scans register
    // nothing); an exported binding is observable cross-module, which is out of file scope.
    if (oracle.isThenable(init) && !exportedDeclarators.has(node)) {
      addCandidate(id.name, node);
    }
  };

  // unsafe-finally (promise form): `.finally(() => { throw … })` masks the original rejection
  // (a returned value is ignored by Promise.finally, so it is not flagged). Suppressed when gildash
  // proves the receiver is not a thenable (a custom `.finally`, not Promise.prototype.finally).
  const ruleUnsafeFinallyCallback = (node: NodeOfType<'CallExpression'>, method: string | null): void => {
    if (method !== 'finally' || !finallyCallbackThrows(node.arguments[0])) {
      return;
    }

    const callee = node.callee;

    if (callee.type === 'MemberExpression' && oracle.isProvenNonThenable(callee.object)) {
      return;
    }

    reportWith('unsafe-finally', node, 'finally callback throws');
  };

  // no-callback-in-promise: a node-style callback API inside a then/catch handler. One finding per
  // call (a `.then(onOk, onErr)` with such a callback in both handlers is a single misuse).
  const ruleNoCallbackInPromise = (node: NodeOfType<'CallExpression'>, method: string | null): void => {
    if (method !== 'then' && method !== 'catch') {
      return;
    }

    for (const arg of node.arguments) {
      if (isFunctionLiteral(arg) && arg.body !== null && containsNodeStyleCallback(arg.body)) {
        report('no-callback-in-promise', node);

        return;
      }
    }
  };

  // misused-promises: an async callback to a sync array method (syntactic fast-path), or a
  // thenable-returning callback in any slot whose contextual type returns void (gildash-gated). The
  // array path takes precedence so `forEach` is reported once; result methods (map/reduce) expect a
  // value, so their slot is not void-returning and only the array path applies.
  const ruleMisusedPromises = (node: NodeOfType<'CallExpression'>, parent: Node | null, method: string | null): void => {
    const alwaysMisused = method !== null && alwaysMisusedArrayMethods.has(method);
    const resultMisused = method !== null && resultMisusedArrayMethods.has(method);

    if (alwaysMisused || resultMisused) {
      const first = node.arguments[0];
      const isAsyncFn = first !== undefined && isFunctionLiteral(first) && first.async === true;
      const callee = node.callee;
      // Suppress when gildash proves the receiver is not an Array — a like-named method on a custom
      // type (RxJS, a query builder) may handle the promise itself. Unproven/degraded → fire.
      const provenNonArray = callee.type === 'MemberExpression' && oracle.isProvenNonArray(callee.object);

      if (isAsyncFn && !provenNonArray && (alwaysMisused || isResultDiscarded(node, parent))) {
        reportWith('misused-promises', node, `${method} callback is async`);

        return;
      }
    }

    for (const arg of node.arguments) {
      if (callbackReturnsThenable(arg) && oracle.expectsVoidReturningCallback(arg)) {
        reportWith('misused-promises', node, 'thenable-returning callback in a void-returning callback slot');

        return;
      }
    }
  };

  // throw-non-error via rejection: `Promise.reject(<provably-non-Error>)` loses stack/cause.
  const ruleRejectNonError = (node: NodeOfType<'CallExpression'>, method: string | null): void => {
    const callee = node.callee;

    if (method === 'reject' && callee.type === 'MemberExpression' && callee.object.type === 'Identifier' && callee.object.name === 'Promise') {
      const first = node.arguments[0];

      if (first !== undefined && isProvablyNonErrorThrow(first, oracle)) {
        report('throw-non-error', node);
      }
    }
  };

  // empty-catch (promise form): an empty `.catch` / `.then(_, )` handler swallows the rejection.
  // gildash-gated on the receiver being a thenable so a non-Promise fluent `.catch` is never flagged.
  const ruleEmptyRejectionHandler = (node: NodeOfType<'CallExpression'>, method: string | null): void => {
    const callee = node.callee;
    const emptyHandler = emptyRejectionHandlerBody(method, node.arguments);

    if (emptyHandler !== null && callee.type === 'MemberExpression' && oracle.isThenable(callee.object)) {
      reportWith('empty-catch', emptyHandler, 'empty rejection handler swallows the error');
    }
  };

  // The five CallExpression-keyed rules, sharing only the computed method name.
  const ruleCallExpression = (node: NodeOfType<'CallExpression'>, parent: Node | null): void => {
    const method = getMemberPropertyName(node.callee);

    ruleUnsafeFinallyCallback(node, method);
    ruleNoCallbackInPromise(node, method);
    ruleMisusedPromises(node, parent, method);
    ruleRejectNonError(node, method);
    ruleEmptyRejectionHandler(node, method);
  };

  // Discarded-promise rules at an expression statement: floating-promises and catch-or-return.
  const ruleDiscardedPromise = (node: NodeOfType<'ExpressionStatement'>): void => {
    const expr = node.expression;

    // explicit `void` is an intentional discard (K)
    if (expr.type === 'UnaryExpression' && expr.operator === 'void') {
      return;
    }

    // Unwrap optional-chain calls (`p?.then()`, `o.f?.()`) to the underlying call.
    const target = expr.type === 'ChainExpression' ? expr.expression : expr;

    // Promise.* / new Promise / import() created but not observed (syntactic).
    if (isPromiseFactoryCall(target)) {
      report('floating-promises', node);

      return;
    }

    if (target.type !== 'CallExpression' || chainHasCatch(target)) {
      return;
    }

    if (chainHasThen(target)) {
      // catch-or-return: a `.then` chain with no `.catch` anywhere — rejection unobserved. Syntactic:
      // `.then` is itself the thenable signature, so the chain is promise-like by construction.
      report('catch-or-return', node);
    } else if (oracle.isThenable(target)) {
      // floating-promises: a discarded bare/method/optional call gildash proves is a promise.
      report('floating-promises', node);
    }
  };

  const visit = (node: Node, parent: Node | null): void => {
    // Function scope boundary: isolate try-catch depth for return-await-in-try
    // Also push/pop scope for unobserved-variable tracking.
    if (isFunctionScope(node)) {
      const savedAsync = inAsyncFunction;
      const savedTryWithCatch = inTryBlockWithCatchDepth;
      const savedBranchDepth = branchDepth;

      inAsyncFunction = node.async === true;
      inTryBlockWithCatchDepth = 0;
      branchDepth = 0;

      pushUnobservedScope(collectParamBindingNames(node.params));

      forEachChildNode(node, child => visit(child, node));

      popUnobservedScope();

      inAsyncFunction = savedAsync;
      inTryBlockWithCatchDepth = savedTryWithCatch;
      branchDepth = savedBranchDepth;

      return;
    }

    // unobserved-variable: any read of a candidate's identifier (return/object/array/ternary/
    // assignment-RHS/call-arg/await/.then …) means the promise escaped and is observed.
    if (node.type === 'Identifier' && parent !== null && isIdentifierReadEscape(node, parent)) {
      markObserved(node.name);
    }

    // TryStatement: custom child-visit order so return-await-in-try sees the with-catch depth only
    // inside the try block — not the handler or finalizer.
    if (node.type === 'TryStatement') {
      ruleUnsafeFinally(node);

      const hasCatch = node.handler !== null;

      // The try/catch/finally bodies are conditionally executed relative to surrounding code.
      branchDepth++;

      if (hasCatch) {
        inTryBlockWithCatchDepth++;
      }

      visit(node.block, node);

      if (hasCatch) {
        inTryBlockWithCatchDepth--;
      }

      if (node.handler !== null) {
        visit(node.handler, node);
      }

      if (node.finalizer !== null) {
        visit(node.finalizer, node);
      }

      branchDepth--;

      return;
    }

    // Leaf rules — dispatched on node type; each owns a single error-flow concern.
    switch (node.type) {
      case 'ReturnStatement':
        ruleReturnAwaitInTry(node);
        break;
      case 'ThrowStatement':
        ruleThrowNonError(node);
        break;
      case 'NewExpression':
        rulePromiseConstructorHygiene(node);
        break;
      case 'CatchClause':
        ruleEmptyCatch(node);
        ruleMissingErrorCause(node);
        break;
      case 'VariableDeclarator':
        ruleUnobservedCandidate(node);
        break;
      case 'AssignmentExpression':
        ruleReassignmentKill(node);
        break;
      case 'CallExpression':
        ruleCallExpression(node, parent);
        break;
      case 'ExpressionStatement':
        ruleDiscardedPromise(node);
        break;
      default:
        break;
    }

    // Branching constructs nest their children one branch deeper, so a reassignment guarded by a
    // condition/loop is not treated as an unconditional overwrite of a candidate bound outside it.
    if (isBranchConstruct(node)) {
      branchDepth++;

      forEachChildNode(node, child => visit(child, node));

      branchDepth--;

      return;
    }

    // Fall back to generic traversal (parentheses are already normalized away upstream).
    forEachChildNode(node, child => visit(child, node));
  };

  // Single-pass traversal: all rules handled in visit().
  // Top-level program body gets an unobserved-variable scope (no parameters at module scope).
  pushUnobservedScope(new Set());
  visit(program, null);
  popUnobservedScope();

  return findings;
};

const createEmptyErrorFlow = (): ReadonlyArray<ErrorFlowFinding> => [];

const analyzeErrorFlow = (
  files: ReadonlyArray<ParsedFile>,
  input?: AnalyzeErrorFlowInput,
): ReadonlyArray<ErrorFlowFinding> => {
  if (files.length === 0) {
    return createEmptyErrorFlow();
  }

  const findings: ErrorFlowFinding[] = [];
  const gildash = input?.gildash ?? null;

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    findings.push(...collectFindings(file.program, file.sourceText, file.filePath, gildash));
  }

  return findings;
};

export { analyzeErrorFlow, createEmptyErrorFlow };
