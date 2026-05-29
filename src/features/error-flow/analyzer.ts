import type { Gildash, HeritageNode } from '@zipbul/gildash';
import type { Node } from 'oxc-parser';

import { buildLineOffsets, getLineColumn } from '@zipbul/gildash';

import type { ParsedFile } from '../../engine/types';
import type { ErrorFlowFinding, ErrorFlowFindingKind, SourceSpan } from './types';

import { forEachChildNode, walkOxcTree } from '../../engine/ast/oxc-ast-utils';
import { PartialResultError } from '../../engine/partial-result-error';

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
  readonly message: string;
  readonly evidence: string;
  readonly recipes: ReadonlyArray<string>;
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

const knownPrimitiveWrappers = new Set(['String', 'Number', 'Boolean', 'Symbol', 'BigInt']);

const isPrimitiveWrapperName = (name: string): boolean => knownPrimitiveWrappers.has(name);

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

const containsReturnStatement = (node: Node): boolean => {
  let found = false;

  walkOxcTree(node, inner => {
    if (inner.type === 'ReturnStatement') {
      found = true;

      return false;
    }

    // Don't cross function boundaries
    if (inner.type === 'FunctionDeclaration' || inner.type === 'FunctionExpression' || inner.type === 'ArrowFunctionExpression') {
      return false;
    }

    return true;
  });

  return found;
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
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      return false;
    }

    return true;
  });

  const walk = (node: Node, loopDepth: number, switchDepth: number): void => {
    if (result !== null) {
      return;
    }

    // Don't cross function boundaries
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
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

const containsNodeStyleCallback = (body: Node): boolean => {
  let found = false;

  walkOxcTree(body, node => {
    if (node.type === 'CallExpression') {
      const method = getMemberPropertyName(node.callee);

      if (method !== null && nodeStyleCallbackMethods.has(method)) {
        const args = node.arguments;
        const last = args[args.length - 1];
        const isCallbackArg =
          last !== undefined && (last.type === 'ArrowFunctionExpression' || last.type === 'FunctionExpression');

        if (isCallbackArg) {
          found = true;

          return false;
        }
      }
    }

    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
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

const hasNonEmptyReturnInFinallyCallback = (arg: Node | undefined): boolean => {
  if (arg === undefined) {
    return false;
  }

  if (arg.type === 'ArrowFunctionExpression') {
    const body = arg.body;

    if (body.type === 'BlockStatement') {
      return containsReturnStatement(body);
    }

    // expression body => returns a value
    return true;
  }

  if (arg.type === 'FunctionExpression' || arg.type === 'FunctionDeclaration') {
    const body = arg.body;

    if (body !== null && body.type === 'BlockStatement') {
      return containsReturnStatement(body);
    }
  }

  return false;
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

/** Pre-scan: collect variable identifier positions for VariableDeclarators with CallExpression init.
 *  Uses id.start (Identifier position) instead of init.start (CallExpression position) because
 *  gildash resolves types at identifier positions, and the variable's type IS the call result type. */
const collectCallVarPositions = (program: Node): number[] => {
  const positions: number[] = [];

  walkOxcTree(program, node => {
    if (node.type === 'VariableDeclarator') {
      const id = node.id;
      const init = node.init;

      if (
        id.type === 'Identifier' &&
        typeof id.name === 'string' &&
        init !== null &&
        (init.type === 'CallExpression' || init.type === 'NewExpression')
      ) {
        positions.push(id.start);
      }
    }

    return true;
  });

  return positions;
};

const collectFindings = (program: Node, sourceText: string, filePath: string, gildash: Gildash | null): CollectFindingsResult => {
  const findings: ErrorFlowFinding[] = [];
  const constructorNames: Map<ErrorFlowFinding, string> = new Map();
  let functionTryCatchDepth = 0;
  let inTryBlockDepth = 0;
  let inAsyncFunction = false;
  let inTryBlockWithCatchDepth = 0;
  // Unobserved-variable tracking: stack of candidate/observed sets per function scope
  const unobservedCandidates: Map<string, Node>[] = [];
  const unobservedObserved: Set<string>[] = [];
  // Pre-compute which variable positions have Promise types (one batch call per file).
  // Uses id.start positions so gildash resolves the variable's type (= call result type).
  // Filters out `any` typed positions since `any` is assignable to everything.
  //
  // Default is an empty set: when gildash is unavailable or throws, register NO candidates
  // rather than registering ALL (which produces broad FP for every sync call result).
  const promisePositions = new Set<number>();

  if (gildash) {
    const allPositions = collectCallVarPositions(program);

    if (allPositions.length > 0) {
      try {
        // Step 1: Resolve types to filter out `any` positions (TypeFlags.Any = 1).
        const resolvedTypes = gildash.getResolvedTypesAtPositions(filePath, allPositions);
        const nonAnyPositions = allPositions.filter(pos => {
          const resolved = resolvedTypes.get(pos);

          return resolved !== undefined && (resolved.flags & 1) === 0;
        });

        // Step 2: Check PromiseLike assignability only for non-any positions.
        if (nonAnyPositions.length > 0) {
          const results = gildash.isTypeAssignableToTypeAtPositions(filePath, nonAnyPositions, 'PromiseLike<any>', {
            anyConstituent: true,
          });

          for (const [pos, isPromise] of results) {
            if (isPromise) {
              promisePositions.add(pos);
            }
          }
        }
      } catch {
        // Semantic layer error — promisePositions stays empty, conservative fallback.
      }
    }
  }

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
          message: `variable '${name}' is assigned a call result but never awaited, .then()ed, or .catch()ed`,
          evidence: getEvidenceLineAt(sourceText, node.start),
          recipes: [],
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
            message: 'catch block has no error binding — cannot preserve error cause',
            evidence: getEvidenceLineAt(sourceText, node.start),
            recipes: [],
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
    // Catch param reassignment: catch(e) { e = new Error(); throw e; }
    let hasReassignment = false;

    walkOxcTree(body, node => {
      if (node.type === 'AssignmentExpression') {
        if (isIdentifierName(node.left, name)) {
          hasReassignment = true;

          return false;
        }
      }

      // Don't cross function boundaries for reassignment check
      if (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression' || node.type === 'FunctionDeclaration') {
        return false;
      }

      return true;
    });

    if (hasReassignment) {
      pushFinding(findings, {
        kind: 'missing-error-cause',
        node: catchClause,
        filePath,
        sourceText,
        message: `catch param '${name}' is reassigned — original error context destroyed`,
        evidence: getEvidenceLineAt(sourceText, catchClause.start),
        recipes: [],
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
      if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
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
        const newExpr = localNewExpressions.get(varName);

        if (newExpr !== undefined && newExpr.type === 'NewExpression') {
          if (isErrorConstructor(newExpr.callee)) {
            const hasCause = hasCausePropertyWithIdentifier(newExpr, name);

            if (!hasCause) {
              pushFinding(findings, {
                kind: 'missing-error-cause',
                node,
                filePath,
                sourceText,
                message: `variable '${varName}' holds new Error() without { cause: ${name} } — loses original error context`,
                evidence: getEvidenceLineAt(sourceText, node.start),
                recipes: [],
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
        const hasCause = hasCausePropertyWithIdentifier(arg, name);

        if (!hasCause) {
          // Check for vibe pattern: catch param used in Error message position
          const firstArg = arg.arguments[0];
          const isVibePattern = firstArg !== undefined && containsIdentifierUse(firstArg, name);

          pushFinding(findings, {
            kind: 'missing-error-cause',
            node,
            filePath,
            sourceText,
            message: isVibePattern
              ? `catch param '${name}' used in Error message instead of { cause: ${name} } — loses stack trace`
              : `new Error() in catch block without { cause: ${name} }`,
            evidence: getEvidenceLineAt(sourceText, node.start),
            recipes: [],
          });
        }

        return true;
      }

      const usesIdentifier = containsIdentifierUse(arg, name);
      const hasCause = hasCausePropertyWithIdentifier(arg, name);

      // Custom error class: catch param is used but cause is not preserved.
      // Lower confidence since we cannot statically verify it extends Error.
      if (usesIdentifier && !hasCause) {
        const constructorName = extractConstructorName(arg.callee);

        pushFinding(findings, {
          kind: 'missing-error-cause',
          node,
          filePath,
          sourceText,
          message: `new expression in catch block uses '${name}' but may not preserve { cause: ${name} }`,
          evidence: getEvidenceLineAt(sourceText, node.start),
          recipes: [],
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
          message: 'catch transforms error without preserving cause/context',
          evidence: getEvidenceLineAt(sourceText, node.start),
          recipes: ['RCP-02'],
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
      message: 'empty catch swallows the error — observe, rethrow, or log it',
      evidence: 'empty catch swallows the error',
      recipes: [],
    });
  };

  const visit = (node: Node, parent: Node | null): void => {
    // Function scope boundary: isolate try-catch depth for EF-06 return-await-in-try
    // Also push/pop scope for unobserved-variable tracking.
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      const savedDepth = functionTryCatchDepth;
      const savedTryBlockDepth = inTryBlockDepth;
      const savedAsync = inAsyncFunction;
      const savedTryWithCatch = inTryBlockWithCatchDepth;

      functionTryCatchDepth = 0;
      inTryBlockDepth = 0;
      inAsyncFunction = node.async === true;
      inTryBlockWithCatchDepth = 0;

      pushUnobservedScope();

      forEachChildNode(node, child => visit(child, node));

      popUnobservedScope();

      functionTryCatchDepth = savedDepth;
      inTryBlockDepth = savedTryBlockDepth;
      inAsyncFunction = savedAsync;
      inTryBlockWithCatchDepth = savedTryWithCatch;

      return;
    }

    // Pre-order hooks
    if (node.type === 'TryStatement') {
      const hasCatch = node.handler !== null;
      const hasFinalizer = node.finalizer !== null;

      // EF-03 unsafe-finally: try/finally that throws/returns/breaks/continues in finalizer
      if (hasFinalizer && node.finalizer !== null) {
        const unsafeKind = findUnsafeControlFlowInFinally(node.finalizer);

        if (unsafeKind !== null) {
          pushFinding(findings, {
            kind: 'unsafe-finally',
            node,
            filePath,
            sourceText,
            message: `finally masks original control flow with ${unsafeKind}`,
            evidence: `finally contains ${unsafeKind}`,
            recipes: ['RCP-03'],
          });
        }
      }

      if (hasCatch || hasFinalizer) {
        functionTryCatchDepth++;
      }

      // Visit block with depth tracking
      inTryBlockDepth++;

      if (hasCatch) {
        inTryBlockWithCatchDepth++;
      }

      visit(node.block, node);

      if (hasCatch) {
        inTryBlockWithCatchDepth--;
      }

      inTryBlockDepth--;

      if (node.handler !== null) {
        visit(node.handler as Node, node);
      }

      if (node.finalizer !== null) {
        visit(node.finalizer as Node, node);
      }

      if (hasCatch || hasFinalizer) {
        functionTryCatchDepth--;
      }

      return;
    }

    // EF-06 return-await-in-try: return without await in try block misses rejection
    if (node.type === 'ReturnStatement') {
      const arg = node.argument;

      if (inTryBlockWithCatchDepth > 0 && inAsyncFunction) {
        if (arg !== null && arg.type !== 'AwaitExpression') {
          let shouldFlag = false;

          if (gildash) {
            // CallExpression/NewExpression: callee position → function type → match function returning PromiseLike
            // Other expressions: direct type → match PromiseLike, anyConstituent for union (e.g. Promise<T> | null)
            try {
              const isCall = arg.type === 'CallExpression' || arg.type === 'NewExpression';
              const assignable = isCall
                ? gildash.isTypeAssignableToType(filePath, arg.start, '(...args: any[]) => PromiseLike<any>')
                : gildash.isTypeAssignableToType(filePath, arg.start, 'PromiseLike<any>', { anyConstituent: true });

              if (assignable !== null) {
                shouldFlag = assignable;
              } else {
                shouldFlag = arg.type === 'CallExpression' || arg.type === 'NewExpression' || arg.type === 'ImportExpression';
              }
            } catch {
              // semantic layer 미활성 등 → AST 휴리스틱 fallback
              shouldFlag = arg.type === 'CallExpression' || arg.type === 'NewExpression' || arg.type === 'ImportExpression';
            }
          } else {
            shouldFlag = arg.type === 'CallExpression' || arg.type === 'NewExpression' || arg.type === 'ImportExpression';
          }

          if (shouldFlag) {
            pushFinding(findings, {
              kind: 'return-await-in-try',
              node,
              filePath,
              sourceText,
              message: 'return without await in try block — catch cannot intercept rejections',
              evidence: getEvidenceLineAt(sourceText, node.start),
              recipes: [],
            });
          }
        }
      }

      // Mark returned identifier as observed for unobserved-variable
      if (arg !== null && arg.type === 'Identifier') {
        markObserved(arg.name);
      }
    }

    // P3-1 throw-non-error
    if (node.type === 'ThrowStatement') {
      const arg = node.argument;
      const isLikelyError =
        arg.type === 'NewExpression' ||
        arg.type === 'Identifier' ||
        arg.type === 'AwaitExpression' ||
        arg.type === 'ChainExpression';
      // CallExpression is allowed in general (e.g. createError()),
      // but reject known primitive wrappers that never produce Error instances.
      const isCallButPrimitiveWrapper =
        arg.type === 'CallExpression' && arg.callee.type === 'Identifier' && isPrimitiveWrapperName(arg.callee.name);
      const isAllowedCall = arg.type === 'CallExpression' && !isCallButPrimitiveWrapper;

      if (!isLikelyError && !isAllowedCall) {
        pushFinding(findings, {
          kind: 'throw-non-error',
          node,
          filePath,
          sourceText,
          message: 'throw argument is not an Error instance (loses stack trace)',
          evidence: getEvidenceLineAt(sourceText, node.start),
          recipes: [],
        });
      }
    }

    // P3-2 promise-constructor-hygiene
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
          executor !== undefined && (executor.type === 'ArrowFunctionExpression' || executor.type === 'FunctionExpression');

        if (isInlineExecutor) {
          const isAsync = executor.async === true;

          // async executor: thrown errors silently swallowed
          if (isAsync) {
            pushFinding(findings, {
              kind: 'promise-constructor-hygiene',
              node,
              filePath,
              sourceText,
              message: 'Promise executor is async; thrown errors will not reject',
              evidence: getEvidenceLineAt(sourceText, node.start),
              recipes: [],
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
                  message: 'throw after settling a Promise executor is swallowed — throw before resolve/reject',
                  evidence: getEvidenceLineAt(sourceText, node.start),
                  recipes: [],
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
              message: 'Promise executor first param should be resolve, not reject — params appear swapped',
              evidence: getEvidenceLineAt(sourceText, node.start),
              recipes: [],
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
        // Only register as candidate if gildash confirmed the call returns a Promise.
        // When gildash is unavailable, promisePositions is empty → no candidates registered
        // (conservative fallback; broadcasting unobserved-variable for every call result
        // produced massive FP for sync function results).
        if (promisePositions.has(id.start)) {
          addCandidate(id.name, node);
        }
      }
    }

    // AwaitExpression: mark awaited identifier as observed
    if (node.type === 'AwaitExpression') {
      const arg = node.argument;

      if (arg.type === 'Identifier') {
        markObserved(arg.name);
      }
    }

    // CallExpression: mark .then/.catch/.finally on identifier; mark args as observed
    // Also handle walkOxcTree rules: prefer-catch, prefer-await-to-then, no-return-wrap,
    // always-return, no-callback-in-promise, misused-promises, unsafe-finally(.finally())
    if (node.type === 'CallExpression') {
      const callee = node.callee;
      const method = getMemberPropertyName(callee);

      // Unobserved-variable: x.then/catch/finally(...) marks x as observed
      if (method !== null && (method === 'then' || method === 'catch' || method === 'finally')) {
        if (callee.type === 'MemberExpression') {
          const obj = callee.object;

          if (obj.type === 'Identifier') {
            markObserved(obj.name);
          }
        }
      }

      // Unobserved-variable: fn(p) or fn([p]) — passed as function argument marks p as observed
      for (const callArg of node.arguments) {
        if (callArg.type === 'Identifier') {
          markObserved(callArg.name);
        } else if (callArg.type === 'ArrayExpression') {
          for (const el of callArg.elements) {
            if (el !== null && el.type === 'Identifier') {
              markObserved(el.name);
            }
          }
        }
      }

      // EF-03 return-in-finally: .finally(() => { return ... })
      if (method === 'finally') {
        const first = node.arguments[0];

        if (hasNonEmptyReturnInFinallyCallback(first)) {
          pushFinding(findings, {
            kind: 'unsafe-finally',
            node,
            filePath,
            sourceText,
            message: 'return in .finally() callback overrides original control flow',
            evidence: getEvidenceLineAt(sourceText, node.start),
            recipes: ['RCP-04'],
          });
        }
      }

      // EF-07 prefer-catch (`.then(onOk, onErr)`): out of scope. When onErr observes the
      // upstream rejection, the reason reaches a handler (observability/propagation/cause
      // preserved) — preferring `.catch` over a second argument is a pure notation
      // convention (lint domain), like its disabled PREFER siblings (prefer-await-to-then,
      // no-return-wrap). The one genuine error-flow case — onOk throws and the chain result
      // is discarded with no downstream catch — belongs to catch-or-return (backlog: precise
      // its two-argument suppression), not to a blanket `.then(_, _)` style rule.

      // no-callback-in-promise: callback-style API inside then/catch/finally callback
      if (method === 'then' || method === 'catch') {
        for (const arg of node.arguments) {
          if (arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression') {
            const body = arg.body;

            if (body !== null && containsNodeStyleCallback(body)) {
              pushFinding(findings, {
                kind: 'no-callback-in-promise',
                node,
                filePath,
                sourceText,
                message: 'callback-style API inside Promise chain — use Promise-based alternative',
                evidence: getEvidenceLineAt(sourceText, node.start),
                recipes: [],
              });
            }
          }
        }
      }

      // EF-08 misused-promises: async callback passed to a sync-array iteration method.
      //  - always-W group: forEach ignores the result; predicate/comparator methods coerce
      //    the returned (always-truthy) Promise, so the async intent is lost regardless of
      //    where the call's value goes.
      //  - result-W group (map/flatMap/reduce/reduceRight): the promises are the return
      //    value, so the rejections are observable when that value flows somewhere; only a
      //    discarded result loses them.
      const alwaysMisused =
        method === 'forEach' ||
        method === 'filter' ||
        method === 'some' ||
        method === 'every' ||
        method === 'find' ||
        method === 'findIndex' ||
        method === 'sort';
      const resultMisused = method === 'map' || method === 'flatMap' || method === 'reduce' || method === 'reduceRight';

      if (alwaysMisused || resultMisused) {
        const first = node.arguments[0];
        const isAsyncFn =
          first !== undefined &&
          (first.type === 'ArrowFunctionExpression' || first.type === 'FunctionExpression') &&
          first.async === true;

        if (isAsyncFn && (alwaysMisused || isResultDiscarded(node, parent))) {
          pushFinding(findings, {
            kind: 'misused-promises',
            node,
            filePath,
            sourceText,
            message: 'async callback is passed where a sync callback is expected',
            evidence: `${method} callback is async`,
            recipes: ['RCP-12', 'RCP-13'],
          });
        }
      }
    }

    // Expression-statement based rules.
    if (node.type === 'ExpressionStatement') {
      const expr = node.expression;

      // ignore explicit void
      if (!(expr.type === 'UnaryExpression' && expr.operator === 'void')) {
        // EF-08 floating-promises: Promise.* / new Promise as expression statement
        if (isPromiseFactoryCall(expr)) {
          pushFinding(findings, {
            kind: 'floating-promises',
            node,
            filePath,
            sourceText,
            message: 'promise is created but not observed',
            evidence: getEvidenceLineAt(sourceText, node.start),
            recipes: ['RCP-09', 'RCP-10', 'RCP-11'],
          });
        } else if (expr.type === 'CallExpression') {
          // EF-08 catch-or-return: top-level then call without catch anywhere in chain
          const exprCallee = expr.callee;
          const exprMethod = getMemberPropertyName(exprCallee);

          if (exprMethod === 'then' && !chainHasCatch(expr)) {
            pushFinding(findings, {
              kind: 'catch-or-return',
              node,
              filePath,
              sourceText,
              message: 'promise chain should have catch or be awaited/returned',
              evidence: getEvidenceLineAt(sourceText, node.start),
              recipes: ['RCP-05', 'RCP-06'],
            });
          }
        }
      }
    }

    // Fall back to generic traversal
    forEachChildNode(node, child => visit(child, node.type === 'ParenthesizedExpression' ? parent : node));
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
