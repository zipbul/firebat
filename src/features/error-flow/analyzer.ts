import type { Gildash, HeritageNode } from '@zipbul/gildash';
import type { Node } from 'oxc-parser';

import { buildLineOffsets, getLineColumn } from '@zipbul/gildash';

import type { ParsedFile } from '../../engine/types';
import type { ErrorFlowFinding, ErrorFlowFindingKind, SourceSpan } from './types';
import type { TypeOracle } from './type-oracle';

import { forEachChildNode, walkOxcTree } from '../../engine/ast/oxc-ast-utils';
import { PartialResultError } from '../../engine/partial-result-error';
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

// An empty rejection handler — `.catch(() => {})` or `.then(_, () => {})` — swallows the
// rejection exactly like an empty catch block. Returns the empty handler body, or null.
const emptyRejectionHandlerBody = (method: string | null, args: ReadonlyArray<Node>): Node | null => {
  const handler = method === 'catch' ? args[0] : method === 'then' ? args[1] : undefined;

  if (
    handler !== undefined &&
    isFunctionLiteral(handler) &&
    handler.body !== null &&
    handler.body.type === 'BlockStatement' &&
    handler.body.body.length === 0
  ) {
    return handler.body;
  }

  return null;
};

const chainHasCatch = (expr: Node): boolean => {
  let current: Node = expr;

  while (current.type === 'CallExpression') {
    const callee = current.callee;
    const method = getMemberPropertyName(callee);

    if (method === 'catch') {
      return true;
    }

    // .then(onFulfilled, onRejected) — second argument handles rejection just like .catch()
    if (method === 'then' && Array.isArray(current.arguments) && current.arguments.length >= 2) {
      return true;
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
    const nextLoop = isLoop ? loopDepth + 1 : loopDepth;
    const nextSwitch = isSwitch ? switchDepth + 1 : switchDepth;

    forEachChildNode(node, child => {
      walk(child, nextLoop, nextSwitch);
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
      const isCauseKey = (key.type === 'Identifier' && key.name === 'cause') || (key.type === 'Literal' && key.value === 'cause');

      if (!isCauseKey) {
        continue;
      }

      if (isIdentifierName(value, name)) {
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

interface CollectFindingsResult {
  readonly findings: ErrorFlowFinding[];
  readonly constructorNames: Map<ErrorFlowFinding, string>;
}

const extractConstructorName = (callee: Node): string | null => {
  if (callee.type === 'Identifier' && typeof callee.name === 'string') {
    return callee.name;
  }

  // Namespaced: ns.ClassName
  if (callee.type === 'MemberExpression') {
    const prop = callee.property;

    if (prop.type === 'Identifier' && typeof prop.name === 'string') {
      return prop.name;
    }
  }

  return null;
};

const collectFindings = (program: Node, sourceText: string, filePath: string, gildash: Gildash | null): CollectFindingsResult => {
  const findings: ErrorFlowFinding[] = [];
  const constructorNames: Map<ErrorFlowFinding, string> = new Map();
  // Traversal state read by return-await-in-try: are we inside an async function, and inside the
  // *block* of a try that has a catch clause? Maintained by the walker, saved/restored per function.
  let inAsyncFunction = false;
  let inTryBlockWithCatchDepth = 0;
  // Unobserved-variable tracking: stack of candidate/observed sets per function scope
  const unobservedCandidates: Map<string, Node>[] = [];
  const unobservedObserved: Set<string>[] = [];
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

  const pushUnobservedScope = (): void => {
    unobservedCandidates.push(new Map());
    unobservedObserved.push(new Set());
  };

  const popUnobservedScope = (): void => {
    const candidates = unobservedCandidates.pop();
    const observed = unobservedObserved.pop();

    if (candidates === undefined || observed === undefined) {
      return;
    }

    for (const [name, node] of candidates) {
      if (!observed.has(name)) {
        pushFinding(findings, {
          kind: 'unobserved-variable',
          node,
          filePath,
          sourceText,
          evidence: getEvidenceLineAt(sourceText, node.start),
        });
      }
    }
  };

  const markObserved = (name: string): void => {
    // Walk from innermost scope outward. Mark observed in each scope,
    // but stop at the first scope that has this name as a candidate —
    // that scope "owns" this variable, and outer scopes with the same name are different variables.
    for (let i = unobservedObserved.length - 1; i >= 0; i -= 1) {
      const scope = unobservedObserved[i];

      if (scope !== undefined) {
        scope.add(name);
      }

      const candidates = unobservedCandidates[i];

      if (candidates !== undefined && candidates.has(name)) {
        break;
      }
    }
  };

  const addCandidate = (name: string, node: Node): void => {
    const top = unobservedCandidates[unobservedCandidates.length - 1];

    if (top !== undefined) {
      top.set(name, node);
    }
  };

  const reportCatchTransformHygieneIfNeeded = (catchClause: Node): void => {
    if (catchClause.type !== 'CatchClause') {
      return;
    }

    const param = catchClause.param;
    const body = catchClause.body;

    // Optional catch binding: catch { throw new Error('fail'); }
    if (param === null) {
      walkOxcTree(body, node => {
        if (node.type !== 'ThrowStatement') {
          return true;
        }

        const arg = node.argument;

        if (arg.type !== 'NewExpression') {
          return true;
        }

        if (isErrorConstructor(arg.callee)) {
          pushFinding(findings, {
            kind: 'missing-error-cause',
            node,
            filePath,
            sourceText,
            evidence: getEvidenceLineAt(sourceText, node.start),
          });
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
      pushFinding(findings, {
        kind: 'missing-error-cause',
        node: catchClause,
        filePath,
        sourceText,
        evidence: getEvidenceLineAt(sourceText, catchClause.start),
      });

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
      if (node.type !== 'ThrowStatement') {
        return true;
      }

      const arg = node.argument;

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
              pushFinding(findings, {
                kind: 'missing-error-cause',
                node,
                filePath,
                sourceText,
                evidence: getEvidenceLineAt(sourceText, node.start),
              });
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
          pushFinding(findings, {
            kind: 'missing-error-cause',
            node,
            filePath,
            sourceText,
            evidence: getEvidenceLineAt(sourceText, node.start),
          });
        }

        return true;
      }

      const usesIdentifier = containsIdentifierUse(arg, name);
      const hasCause = causeAssigned || hasCausePropertyWithIdentifier(arg, name);

      // Custom error class: catch param is used but cause is not preserved.
      // Lower confidence since we cannot statically verify it extends Error.
      if (usesIdentifier && !hasCause) {
        const constructorName = extractConstructorName(arg.callee);

        pushFinding(findings, {
          kind: 'missing-error-cause',
          node,
          filePath,
          sourceText,
          evidence: getEvidenceLineAt(sourceText, node.start),
        });

        const addedFinding = findings[findings.length - 1];

        if (addedFinding !== undefined && constructorName !== null) {
          constructorNames.set(addedFinding, constructorName);
        }

        return true;
      }

      // If identifier only appears as catch parameter but not in thrown expression, it's information loss
      if (!usesIdentifier && !hasCause) {
        const constructorName = extractConstructorName(arg.callee);

        pushFinding(findings, {
          kind: 'missing-error-cause',
          node: catchClause,
          filePath,
          sourceText,
          evidence: getEvidenceLineAt(sourceText, node.start),
        });

        const addedFinding = findings[findings.length - 1];

        if (addedFinding !== undefined && constructorName !== null) {
          constructorNames.set(addedFinding, constructorName);
        }
      }

      return true;
    });
  };

  // empty-catch: a catch with no statements swallows the error entirely — observability,
  // propagation and cause are all lost (W). A comment does not restore any of them, so it
  // does not exempt the catch (notation conventions are out of scope per the concept def).
  const reportEmptyCatchIfNeeded = (catchClause: Node): void => {
    if (catchClause.type !== 'CatchClause') {
      return;
    }

    const body = catchClause.body;

    if (body.type !== 'BlockStatement' || body.body.length !== 0) {
      return;
    }

    pushFinding(findings, {
      kind: 'empty-catch',
      node: body,
      filePath,
      sourceText,
      evidence: 'empty catch swallows the error',
    });
  };

  const visit = (node: Node, parent: Node | null): void => {
    // Function scope boundary: isolate try-catch depth for return-await-in-try
    // Also push/pop scope for unobserved-variable tracking.
    if (isFunctionScope(node)) {
      const savedAsync = inAsyncFunction;
      const savedTryWithCatch = inTryBlockWithCatchDepth;

      inAsyncFunction = node.async === true;
      inTryBlockWithCatchDepth = 0;

      pushUnobservedScope();

      forEachChildNode(node, child => visit(child, node));

      popUnobservedScope();

      inAsyncFunction = savedAsync;
      inTryBlockWithCatchDepth = savedTryWithCatch;

      return;
    }

    // unobserved-variable: any read of a candidate's identifier (return/object/array/ternary/
    // assignment-RHS/call-arg/await/.then …) means the promise escaped and is observed.
    if (node.type === 'Identifier' && parent !== null && isIdentifierReadEscape(node, parent)) {
      markObserved(node.name);
    }

    // Pre-order hooks
    if (node.type === 'TryStatement') {
      // unsafe-finally: try/finally that throws/returns/breaks/continues in finalizer
      if (node.finalizer !== null) {
        const unsafeKind = findUnsafeControlFlowInFinally(node.finalizer);

        if (unsafeKind !== null) {
          pushFinding(findings, {
            kind: 'unsafe-finally',
            node,
            filePath,
            sourceText,
            evidence: `finally contains ${unsafeKind}`,
          });
        }
      }

      // return-await-in-try only fires for returns inside a try that has a catch, so the
      // with-catch depth is raised only around the try block — not the handler or finalizer.
      const hasCatch = node.handler !== null;

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

      return;
    }

    // return-await-in-try: return without await in try block misses rejection
    if (node.type === 'ReturnStatement') {
      const arg = node.argument;

      if (inTryBlockWithCatchDepth > 0 && inAsyncFunction) {
        if (arg !== null && arg.type !== 'AwaitExpression') {
          // Conservative, mirroring floating-promises: flag only what is provably a Promise.
          // `import()` is syntactically always one; calls/members need gildash (no flag-all
          // fallback — that produced FPs like `return new Response()` in degraded scans).
          let shouldFlag = false;

          if (arg.type === 'ImportExpression') {
            shouldFlag = true;
          } else if (arg.type !== 'NewExpression') {
            // A CallExpression result type, or an identifier/member value type, must be a thenable.
            // (A constructed instance is almost never a thenable, so NewExpression is not flagged.)
            shouldFlag = oracle.isThenable(arg);
          }

          if (shouldFlag) {
            pushFinding(findings, {
              kind: 'return-await-in-try',
              node,
              filePath,
              sourceText,
              evidence: getEvidenceLineAt(sourceText, node.start),
            });
          }
        }
      }

    }

    // throw-non-error: flag only when the thrown value is provably not an Error.
    if (node.type === 'ThrowStatement') {
      if (isProvablyNonErrorThrow(node.argument, oracle)) {
        pushFinding(findings, {
          kind: 'throw-non-error',
          node,
          filePath,
          sourceText,
          evidence: getEvidenceLineAt(sourceText, node.start),
        });
      }
    }

    // promise-constructor-hygiene
    if (node.type === 'NewExpression') {
      const callee = node.callee;
      const isPromiseIdent = callee.type === 'Identifier' && callee.name === 'Promise';
      const isPromiseMember =
        !isPromiseIdent &&
        callee.type === 'MemberExpression' &&
        callee.object.type === 'Identifier' &&
        (callee.object.name === 'globalThis' || callee.object.name === 'window' || callee.object.name === 'self') &&
        callee.property.type === 'Identifier' &&
        callee.property.name === 'Promise';

      if (isPromiseIdent || isPromiseMember) {
        const executor = node.arguments[0];
        const isInlineExecutor =
          executor !== undefined && isFunctionLiteral(executor);

        if (isInlineExecutor) {
          const isAsync = executor.async === true;

          // async executor: thrown errors silently swallowed
          if (isAsync) {
            pushFinding(findings, {
              kind: 'promise-constructor-hygiene',
              node,
              filePath,
              sourceText,
              evidence: getEvidenceLineAt(sourceText, node.start),
            });
          }

          // sync executor throw AFTER settle: once resolve/reject has run the promise is
          // settled, so a later throw is swallowed (the constructor's reject is a no-op).
          // A bare throw with no prior settle is correctly converted to a rejection (K).
          if (!isAsync) {
            const executorBody = executor.body;

            if (executorBody !== null && executorBody.type === 'BlockStatement') {
              if (throwAfterSettleInExecutor(executorBody, collectExecutorParamNames(executor))) {
                pushFinding(findings, {
                  kind: 'promise-constructor-hygiene',
                  node,
                  filePath,
                  sourceText,
                  evidence: getEvidenceLineAt(sourceText, node.start),
                });
              }
            }
          }

          // param order: first param should be resolve, not reject
          const firstParam = executor.params[0];

          if (firstParam !== undefined && firstParam.type === 'Identifier' && firstParam.name === 'reject') {
            pushFinding(findings, {
              kind: 'promise-constructor-hygiene',
              node,
              filePath,
              sourceText,
              evidence: getEvidenceLineAt(sourceText, node.start),
            });
          }
        }

      }
    }

    if (node.type === 'CatchClause') {
      reportEmptyCatchIfNeeded(node);
      reportCatchTransformHygieneIfNeeded(node);
      // Keep visiting for other rules
    }

    // VariableDeclarator: track candidates for unobserved-variable
    if (node.type === 'VariableDeclarator') {
      const id = node.id;
      const init = node.init;

      if (
        id.type === 'Identifier' &&
        typeof id.name === 'string' &&
        init !== null &&
        (init.type === 'CallExpression' || init.type === 'NewExpression')
      ) {
        // Register only when the init expression's type is a thenable (the oracle excludes `any`
        // and answers `false` without gildash — so degraded scans register nothing), and the
        // binding is not exported (an exported promise is observable cross-module — out of scope).
        if (oracle.isThenable(init) && !exportedDeclarators.has(node)) {
          addCandidate(id.name, node);
        }
      }
    }

    // CallExpression: no-callback-in-promise and misused-promises.
    // (unobserved-variable observation is handled by the generic identifier-read hook above.)
    if (node.type === 'CallExpression') {
      const callee = node.callee;
      const method = getMemberPropertyName(callee);

      // unsafe-finally (promise form): .finally(() => { throw ... }) masks the original rejection
      // (a returned value is ignored by Promise.finally, so it is not flagged).
      if (method === 'finally') {
        const first = node.arguments[0];

        if (finallyCallbackThrows(first)) {
          pushFinding(findings, {
            kind: 'unsafe-finally',
            node,
            filePath,
            sourceText,
            evidence: getEvidenceLineAt(sourceText, node.start),
          });
        }
      }

      // Note: `.then(onOk, onErr)` style preference (".catch is nicer") is deliberately not a
      // rule — when onErr observes the upstream rejection the reason still reaches a handler, so
      // it is a pure notation convention (lint domain). The one genuine error-flow case — onOk
      // throws and the chain result is discarded with no downstream catch — belongs to
      // catch-or-return (backlog: precise its two-argument suppression).

      // no-callback-in-promise: callback-style API inside then/catch/finally callback.
      // At most one finding per call node — a `.then(onOk, onErr)` with a node-style callback in
      // both handlers is a single misuse of the same call (emit discipline shared with
      // misused-promises below).
      if (method === 'then' || method === 'catch') {
        for (const arg of node.arguments) {
          if (isFunctionLiteral(arg)) {
            const body = arg.body;

            if (body !== null && containsNodeStyleCallback(body)) {
              pushFinding(findings, {
                kind: 'no-callback-in-promise',
                node,
                filePath,
                sourceText,
                evidence: getEvidenceLineAt(sourceText, node.start),
              });

              break;
            }
          }
        }
      }

      // misused-promises: async callback passed to a sync-array iteration method (see the Set defs).
      const alwaysMisused = method !== null && alwaysMisusedArrayMethods.has(method);
      const resultMisused = method !== null && resultMisusedArrayMethods.has(method);
      let misusedReported = false;

      if (alwaysMisused || resultMisused) {
        const first = node.arguments[0];
        const isAsyncFn =
          first !== undefined &&
          isFunctionLiteral(first) &&
          first.async === true;

        if (isAsyncFn && (alwaysMisused || isResultDiscarded(node, parent))) {
          pushFinding(findings, {
            kind: 'misused-promises',
            node,
            filePath,
            sourceText,
            evidence: `${method} callback is async`,
          });

          misusedReported = true;
        }
      }

      // misused-promises (general void-callback slot): a thenable-returning callback passed into any
      // argument whose contextual type is a void-returning callback discards the rejection at the
      // call boundary (the call ignores the returned promise — a floating rejection). The callback
      // returns a thenable when it is `async`, or when it is an expression-bodied arrow whose body
      // the oracle proves is a thenable (`() => go()`) — return type, not the `async` keyword.
      // gildash-gated via the oracle, so degraded scans never flag. Skipped when the syntactic array
      // path already reported this call (avoids a double `forEach` finding); inert for
      // result-returning methods (map/reduce expect a value, so their slot is not void-returning).
      if (!misusedReported) {
        for (const arg of node.arguments) {
          if (callbackReturnsThenable(arg) && oracle.expectsVoidReturningCallback(arg)) {
            pushFinding(findings, {
              kind: 'misused-promises',
              node,
              filePath,
              sourceText,
              evidence: 'thenable-returning callback in a void-returning callback slot',
            });

            break;
          }
        }
      }

      // throw-non-error via rejection: Promise.reject(<provably-non-Error>) loses the stack
      // trace / cause exactly like `throw <non-Error>`.
      if (
        method === 'reject' &&
        callee.type === 'MemberExpression' &&
        callee.object.type === 'Identifier' &&
        callee.object.name === 'Promise'
      ) {
        const first = node.arguments[0];

        if (first !== undefined && isProvablyNonErrorThrow(first, oracle)) {
          pushFinding(findings, {
            kind: 'throw-non-error',
            node,
            filePath,
            sourceText,
            evidence: getEvidenceLineAt(sourceText, node.start),
          });
        }
      }

      // empty-catch (promise form): an empty `.catch(…)` / `.then(_, …)` rejection handler
      // swallows the rejection. gildash-gated on the receiver being PromiseLike so a non-Promise
      // fluent API with its own `.catch` is never flagged (zero-FP over degraded coverage).
      const emptyHandler = emptyRejectionHandlerBody(method, node.arguments);

      if (emptyHandler !== null && callee.type === 'MemberExpression' && oracle.isThenable(callee.object)) {
        pushFinding(findings, {
          kind: 'empty-catch',
          node: emptyHandler,
          filePath,
          sourceText,
          evidence: 'empty rejection handler swallows the error',
        });
      }
    }

    // Discarded-promise rules: a promise whose rejection is unobserved at an expression statement.
    if (node.type === 'ExpressionStatement') {
      const expr = node.expression;

      // explicit `void` is an intentional discard (K)
      if (!(expr.type === 'UnaryExpression' && expr.operator === 'void')) {
        // Unwrap optional-chain calls (`p?.then()`, `o.f?.()`) to the underlying call.
        const target = expr.type === 'ChainExpression' ? expr.expression : expr;

        if (isPromiseFactoryCall(target)) {
          // Promise.* / new Promise / import() created but not observed (syntactic).
          pushFinding(findings, {
            kind: 'floating-promises',
            node,
            filePath,
            sourceText,
            evidence: getEvidenceLineAt(sourceText, node.start),
          });
        } else if (target.type === 'CallExpression' && !chainHasCatch(target)) {
          if (chainHasThen(target)) {
            // catch-or-return: a `.then` chain with no `.catch` anywhere — rejection unobserved.
            // Syntactic (no gildash gate, unlike the bare-call branch below): `.then` is itself
            // the thenable signature, so a `.then` chain is promise-like by construction — the
            // same basis as ESLint's promise/catch-or-return.
            pushFinding(findings, {
              kind: 'catch-or-return',
              node,
              filePath,
              sourceText,
              evidence: getEvidenceLineAt(sourceText, node.start),
            });
          } else if (oracle.isThenable(target)) {
            // floating-promises: a discarded call whose result gildash proves is a Promise
            // (bare/method/optional/`.finally`). gildash-gated so non-Promise calls never flag.
            pushFinding(findings, {
              kind: 'floating-promises',
              node,
              filePath,
              sourceText,
              evidence: getEvidenceLineAt(sourceText, node.start),
            });
          }
        }
      }
    }

    // Fall back to generic traversal (parentheses are already normalized away upstream).
    forEachChildNode(node, child => visit(child, node));
  };

  // Single-pass traversal: all rules handled in visit().
  // Top-level program body gets an unobserved-variable scope.
  pushUnobservedScope();
  visit(program, null);
  popUnobservedScope();

  return { findings, constructorNames };
};

const createEmptyErrorFlow = (): ReadonlyArray<ErrorFlowFinding> => [];

interface ConstructorToVerify {
  readonly name: string;
  readonly filePath: string;
}

const heritageExtendsError = (node: HeritageNode): boolean => {
  if (node.symbolName === 'Error') {
    return true;
  }

  return node.children.some(child => child.kind === 'extends' && heritageExtendsError(child));
};

// KNOWN GAP (pending gildash — see gildash/FIREBAT_ERROR_FLOW_API_REQUEST_2.md):
// `getHeritageChain` requires a project-relative path while every other gildash path API (and the
// TypeOracle's span queries) accepts an absolute one. `finding.file` is absolute here, so heritage
// resolves to empty children and every custom-Error-subclass `missing-error-cause` finding is
// dropped (a silent false negative for `catch(e){ throw new CustomError(e.message) }`). Once gildash
// ships R1 (uniform absolute-path) + R2 (`isTypeAssignableToTypeAtSpan`), this post-hoc heritage
// round-trip is replaced by an oracle `isErrorSubtype(throwArg)` decided at the throw site — folding
// the last direct gildash call back under the TypeOracle's single-owner boundary.
const verifyCustomErrorClasses = async (
  findings: ErrorFlowFinding[],
  constructorNames: Map<ErrorFlowFinding, string>,
  gildash: Gildash,
): Promise<ErrorFlowFinding[]> => {
  // Collect unique constructor names from missing-error-cause findings on custom error classes
  // Uses the tagged constructorNames map instead of parsing evidence strings.
  const customErrorFindings = findings.filter(f => f.kind === 'missing-error-cause' && constructorNames.has(f));

  if (customErrorFindings.length === 0) {
    return findings;
  }

  const toVerify = new Map<string, ConstructorToVerify>();

  for (const finding of customErrorFindings) {
    const constructorName = constructorNames.get(finding);

    if (constructorName !== undefined) {
      toVerify.set(`${finding.file}:${constructorName}`, { name: constructorName, filePath: finding.file });
    }
  }

  // Check heritage chains
  const confirmedErrors = new Set<string>();

  for (const [key, { name, filePath }] of toVerify) {
    try {
      const heritage = await gildash.getHeritageChain(name, filePath);

      if (heritageExtendsError(heritage)) {
        confirmedErrors.add(key);
      }
    } catch {
      // Heritage check failed — keep the finding (lower confidence)
      confirmedErrors.add(key);
    }
  }

  // Filter out findings where constructor is confirmed NOT to extend Error
  return findings.filter(f => {
    if (f.kind !== 'missing-error-cause') {
      return true;
    }

    const constructorName = constructorNames.get(f);

    if (constructorName === undefined) {
      return true;
    }

    const key = `${f.file}:${constructorName}`;

    // If we verified this constructor and it's NOT an error class, drop the finding
    if (toVerify.has(key) && !confirmedErrors.has(key)) {
      return false;
    }

    return true;
  });
};

const analyzeErrorFlow = async (
  files: ReadonlyArray<ParsedFile>,
  input?: AnalyzeErrorFlowInput,
): Promise<ReadonlyArray<ErrorFlowFinding>> => {
  if (files.length === 0) {
    return createEmptyErrorFlow();
  }

  const findings: ErrorFlowFinding[] = [];
  const allConstructorNames: Map<ErrorFlowFinding, string> = new Map();
  const gildash = input?.gildash ?? null;

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    const result = collectFindings(file.program, file.sourceText, file.filePath, gildash);

    findings.push(...result.findings);

    for (const [finding, name] of result.constructorNames) {
      allConstructorNames.set(finding, name);
    }
  }

  // gildash heritage verification for custom error classes
  if (input?.gildash) {
    try {
      return await verifyCustomErrorClasses(findings, allConstructorNames, input.gildash);
    } catch (e) {
      if (e instanceof PartialResultError) {
        throw e;
      }

      throw new PartialResultError('gildash heritage check failed', findings);
    }
  }

  return findings;
};

export { analyzeErrorFlow, createEmptyErrorFlow };
