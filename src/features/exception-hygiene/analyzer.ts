import type { Node } from 'oxc-parser';

import type { NodeValue, ParsedFile } from '../../engine/types';
import type { ExceptionHygieneFinding, ExceptionHygieneFindingKind, SourceSpan } from './types';

import { isNodeRecord, isOxcNode, walkOxcTree } from '../../engine/oxc-ast-utils';
import { getLineColumn } from '../../engine/source-position';

const getSpan = (node: Node, sourceText: string): SourceSpan => {
  const start = getLineColumn(sourceText, node.start);
  const end = getLineColumn(sourceText, node.end);

  return {
    start,
    end,
  };
};

interface PushFindingInput {
  readonly kind: ExceptionHygieneFindingKind;
  readonly filePath: string;
  readonly sourceText: string;
  readonly node: Node;
  readonly message: string;
  readonly evidence: string;
  readonly recipes: ReadonlyArray<string>;
}

const pushFinding = (findings: ExceptionHygieneFinding[], input: PushFindingInput): void => {
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

const isIdentifierName = (node: NodeValue, name: string): boolean => {
  if (!isOxcNode(node)) {
    return false;
  }

  if (node.type !== 'Identifier' || !isNodeRecord(node)) {
    return false;
  }

  return typeof node.name === 'string' && node.name === name;
};

const getMemberPropertyName = (callee: NodeValue): string | null => {
  if (!isOxcNode(callee) || callee.type !== 'MemberExpression' || !isNodeRecord(callee)) {
    return null;
  }

  const prop = callee.property;

  if (isOxcNode(prop) && prop.type === 'Identifier' && isNodeRecord(prop) && typeof prop.name === 'string') {
    return prop.name;
  }

  return null;
};

const knownPrimitiveWrappers = new Set(['String', 'Number', 'Boolean', 'Symbol', 'BigInt']);

const isPrimitiveWrapperName = (name: string): boolean => knownPrimitiveWrappers.has(name);

const isErrorConstructor = (callee: NodeValue): boolean => {
  if (!isOxcNode(callee) || !isNodeRecord(callee) || callee.type !== 'Identifier') {
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
    name === 'EvalError'
  );
};

const isPromiseFactoryCall = (expr: NodeValue): boolean => {
  if (!isOxcNode(expr) || expr.type !== 'CallExpression' || !isNodeRecord(expr)) {
    // `new Promise(...)`
    if (isOxcNode(expr) && expr.type === 'NewExpression' && isNodeRecord(expr)) {
      const callee = expr.callee;

      return isOxcNode(callee) && callee.type === 'Identifier' && isNodeRecord(callee) && callee.name === 'Promise';
    }

    return false;
  }

  const callee = expr.callee;

  if (!isOxcNode(callee) || callee.type !== 'MemberExpression' || !isNodeRecord(callee)) {
    return false;
  }

  const obj = callee.object;
  const prop = callee.property;

  if (!isOxcNode(obj) || !isOxcNode(prop)) {
    return false;
  }

  if (obj.type !== 'Identifier' || !isNodeRecord(obj) || obj.name !== 'Promise') {
    return false;
  }

  if (prop.type !== 'Identifier' || !isNodeRecord(prop)) {
    return false;
  }

  const name = prop.name;

  return name === 'resolve' || name === 'reject' || name === 'all' || name === 'race' || name === 'any' || name === 'allSettled';
};

const containsReturnStatement = (node: NodeValue): boolean => {
  let found = false;

  walkOxcTree(node, inner => {
    if (inner.type === 'ReturnStatement') {
      found = true;

      return false;
    }

    return true;
  });

  return found;
};

const containsReturnOrThrowStatement = (node: NodeValue): boolean => {
  let found = false;

  walkOxcTree(node, inner => {
    if (inner.type === 'ReturnStatement' || inner.type === 'ThrowStatement') {
      found = true;

      return false;
    }

    return true;
  });

  return found;
};

const containsThrowStatement = (node: NodeValue): boolean => {
  let found = false;

  walkOxcTree(node, inner => {
    if (inner.type === 'ThrowStatement') {
      found = true;

      return false;
    }

    return true;
  });

  return found;
};

interface TryCatchEntry {
  readonly hasCatch: boolean;
}

const containsIdentifierUse = (node: NodeValue, name: string): boolean => {
  let found = false;

  walkOxcTree(node, inner => {
    if (inner.type === 'Identifier' && isNodeRecord(inner) && inner.name === name) {
      found = true;

      return false;
    }

    return true;
  });

  return found;
};

const hasCausePropertyWithIdentifier = (node: NodeValue, name: string): boolean => {
  let found = false;

  walkOxcTree(node, inner => {
    if (inner.type !== 'ObjectExpression' || !isNodeRecord(inner)) {
      return true;
    }

    const props = Array.isArray(inner.properties) ? (inner.properties as ReadonlyArray<NodeValue>) : [];

    for (const prop of props) {
      if (!isOxcNode(prop) || !isNodeRecord(prop) || prop.type !== 'Property') {
        continue;
      }

      const key = prop.key as NodeValue;
      const value = prop.value as NodeValue;
      const isCauseKey =
        (isOxcNode(key) && key.type === 'Identifier' && isNodeRecord(key) && key.name === 'cause') ||
        (isOxcNode(key) && key.type === 'Literal' && isNodeRecord(key) && key.value === 'cause');

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

const isConsoleLikeCall = (stmt: NodeValue): boolean => {
  if (!isOxcNode(stmt) || !isNodeRecord(stmt) || stmt.type !== 'ExpressionStatement') {
    return false;
  }

  const expr = stmt.expression;

  if (!isOxcNode(expr) || !isNodeRecord(expr) || expr.type !== 'CallExpression') {
    return false;
  }

  const callee = expr.callee;

  if (!isOxcNode(callee) || !isNodeRecord(callee) || callee.type !== 'MemberExpression') {
    return false;
  }

  const obj = callee.object;

  return isOxcNode(obj) && isNodeRecord(obj) && obj.type === 'Identifier' && obj.name === 'console';
};

const hasNonEmptyReturnInFinallyCallback = (arg: NodeValue): boolean => {
  if (!isOxcNode(arg)) {
    return false;
  }

  if (arg.type === 'ArrowFunctionExpression' && isNodeRecord(arg)) {
    const body = arg.body;

    if (isOxcNode(body) && body.type === 'BlockStatement') {
      return containsReturnStatement(body);
    }

    // expression body => returns a value
    return true;
  }

  if ((arg.type === 'FunctionExpression' || arg.type === 'FunctionDeclaration') && isNodeRecord(arg)) {
    const body = arg.body;

    if (isOxcNode(body) && body.type === 'BlockStatement') {
      return containsReturnStatement(body);
    }
  }

  return false;
};

const collectFindings = (program: NodeValue, sourceText: string, filePath: string): ExceptionHygieneFinding[] => {
  const findings: ExceptionHygieneFinding[] = [];
  const tryCatchStack: TryCatchEntry[] = [];
  let functionTryCatchDepth = 0;

  const reportOverscopedTryIfNeeded = (node: NodeValue): void => {
    if (!isOxcNode(node) || !isNodeRecord(node) || node.type !== 'TryStatement') {
      return;
    }

    const handler = node.handler;
    const block = node.block;

    if (!isOxcNode(handler) || handler.type !== 'CatchClause') {
      return;
    }

    if (!isOxcNode(block) || block.type !== 'BlockStatement' || !isNodeRecord(block)) {
      return;
    }

    const stmts = Array.isArray(block.body) ? (block.body as ReadonlyArray<NodeValue>) : [];

    // Objective-only heuristic (spec): many top-level statements
    if (stmts.length >= 10) {
      pushFinding(findings, {
        kind: 'overscoped-try',
        node,
        filePath,
        sourceText,
        message: 'try scope is too broad and hides error boundaries',
        evidence: getEvidenceLineAt(sourceText, node.start),
        recipes: ['RCP-16'],
      });
    }
  };

  const reportExceptionControlFlowIfNeeded = (node: NodeValue): void => {
    if (!isOxcNode(node) || !isNodeRecord(node) || node.type !== 'TryStatement') {
      return;
    }

    const handler = node.handler;
    const finalizer = node.finalizer;
    const block = node.block;

    if (!isOxcNode(handler) || handler.type !== 'CatchClause' || finalizer !== null) {
      return;
    }

    if (!isOxcNode(block) || block.type !== 'BlockStatement' || !isNodeRecord(block)) {
      return;
    }

    const stmts = Array.isArray(block.body) ? (block.body as ReadonlyArray<NodeValue>) : [];

    if (stmts.length !== 1) {
      return;
    }

    const catchBody = handler.body;

    if (!isOxcNode(catchBody) || catchBody.type !== 'BlockStatement' || !isNodeRecord(catchBody)) {
      return;
    }

    const catchStmts = Array.isArray(catchBody.body) ? (catchBody.body as ReadonlyArray<NodeValue>) : [];
    const hasThrow = containsThrowStatement(catchBody);

    if (hasThrow) {
      return;
    }

    const hasDefaultReturn = catchStmts.some(
      s => isOxcNode(s) && (s.type === 'ReturnStatement' || s.type === 'ContinueStatement' || s.type === 'BreakStatement'),
    );

    if (!hasDefaultReturn) {
      return;
    }

    pushFinding(findings, {
      kind: 'exception-control-flow',
      node,
      filePath,
      sourceText,
      message: 'try/catch is used for control flow with default fallback',
      evidence: getEvidenceLineAt(sourceText, node.start),
      recipes: ['RCP-17', 'RCP-11'],
    });
  };

  const reportSilentCatchIfNeeded = (catchClause: NodeValue): void => {
    if (!isOxcNode(catchClause) || !isNodeRecord(catchClause)) {
      return;
    }

    const param = catchClause.param;
    const body = catchClause.body;

    if (!isOxcNode(body) || body.type !== 'BlockStatement' || !isNodeRecord(body)) {
      return;
    }

    const stmts = Array.isArray(body.body) ? (body.body as ReadonlyArray<NodeValue>) : [];
    const hasThrow = containsThrowStatement(body);

    if (hasThrow) {
      return;
    }

    const hasReturnOrJump = stmts.some(
      s => isOxcNode(s) && (s.type === 'ReturnStatement' || s.type === 'ContinueStatement' || s.type === 'BreakStatement'),
    );
    const isEmpty = stmts.length === 0;
    const isOnlyConsole = stmts.length > 0 && stmts.every(isConsoleLikeCall);

    if (!(isEmpty || isOnlyConsole || hasReturnOrJump)) {
      return;
    }

    pushFinding(findings, {
      kind: 'silent-catch',
      node: catchClause,
      filePath,
      sourceText,
      message: 'catch swallows an error without propagation or explicit handling',
      evidence: getEvidenceLineAt(sourceText, catchClause.start),
      recipes: ['RCP-01', 'RCP-02', 'RCP-11'],
    });

    void param;
  };

  const reportCatchTransformHygieneIfNeeded = (catchClause: NodeValue): void => {
    if (!isOxcNode(catchClause) || !isNodeRecord(catchClause)) {
      return;
    }

    const param = catchClause.param;
    const body = catchClause.body;

    if (!isOxcNode(param) || param.type !== 'Identifier' || !isNodeRecord(param)) {
      return;
    }

    if (!isOxcNode(body) || body.type !== 'BlockStatement' || !isNodeRecord(body)) {
      return;
    }

    const name = param.name;

    // Find throw new X(...)
    walkOxcTree(body, node => {
      if (node.type !== 'ThrowStatement' || !isNodeRecord(node)) {
        return true;
      }

      const arg = node.argument;

      if (!isOxcNode(arg) || arg.type !== 'NewExpression' || !isNodeRecord(arg)) {
        return true;
      }

      // Prefer a specific finding for Error constructors without { cause }.
      if (isErrorConstructor(arg.callee)) {
        const hasCause = hasCausePropertyWithIdentifier(arg, name);

        if (!hasCause) {
          pushFinding(findings, {
            kind: 'missing-error-cause',
            node,
            filePath,
            sourceText,
            message: `new Error() in catch block without { cause: ${name} }`,
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
        pushFinding(findings, {
          kind: 'missing-error-cause',
          node,
          filePath,
          sourceText,
          message: `new expression in catch block uses '${name}' but may not preserve { cause: ${name} }`,
          evidence: getEvidenceLineAt(sourceText, node.start),
          recipes: [],
        });

        return true;
      }

      // If identifier only appears as catch parameter but not in thrown expression, it's information loss
      if (!usesIdentifier && !hasCause) {
        pushFinding(findings, {
          kind: 'catch-transform-hygiene',
          node: catchClause,
          filePath,
          sourceText,
          message: 'catch transforms error without preserving cause/context',
          evidence: getEvidenceLineAt(sourceText, node.start),
          recipes: ['RCP-02'],
        });
      }

      return true;
    });
  };

  const isNestedUnderOuterCatch = (): boolean => {
    if (tryCatchStack.length < 2) {
      return false;
    }

    // Any outer try in this function that has a catch qualifies
    return tryCatchStack.slice(0, -1).some(e => e.hasCatch);
  };

  const reportRedundantNestedCatchIfNeeded = (catchClause: NodeValue): void => {
    if (!isNestedUnderOuterCatch()) {
      return;
    }

    // If inner catch is useless-catch OR silent-catch style, report redundancy.
    if (!isOxcNode(catchClause) || !isNodeRecord(catchClause)) {
      return;
    }

    const param = catchClause.param;
    const body = catchClause.body;
    const isUselessRethrow = (() => {
      if (!isOxcNode(param) || param.type !== 'Identifier' || !isNodeRecord(param)) {
        return false;
      }

      if (!isOxcNode(body) || body.type !== 'BlockStatement' || !isNodeRecord(body)) {
        return false;
      }

      const name = param.name;
      const stmts = Array.isArray(body.body) ? (body.body as ReadonlyArray<NodeValue>) : [];

      if (stmts.length !== 1) {
        return false;
      }

      const only = stmts[0];

      if (!isOxcNode(only) || only.type !== 'ThrowStatement' || !isNodeRecord(only)) {
        return false;
      }

      return isIdentifierName(only.argument, name);
    })();
    const isSilent = (() => {
      if (!isOxcNode(body) || body.type !== 'BlockStatement' || !isNodeRecord(body)) {
        return false;
      }

      if (containsThrowStatement(body)) {
        return false;
      }

      const stmts = Array.isArray(body.body) ? (body.body as ReadonlyArray<NodeValue>) : [];
      const hasReturnOrJump = stmts.some(
        s => isOxcNode(s) && (s.type === 'ReturnStatement' || s.type === 'ContinueStatement' || s.type === 'BreakStatement'),
      );
      const isEmpty = stmts.length === 0;
      const isOnlyConsole = stmts.length > 0 && stmts.every(isConsoleLikeCall);

      return isEmpty || isOnlyConsole || hasReturnOrJump;
    })();

    if (!(isUselessRethrow || isSilent)) {
      return;
    }

    pushFinding(findings, {
      kind: 'redundant-nested-catch',
      node: catchClause,
      filePath,
      sourceText,
      message: 'nested catch is redundant under an outer catch',
      evidence: getEvidenceLineAt(sourceText, catchClause.start),
      recipes: ['RCP-01', 'RCP-02'],
    });
  };

  const visit = (value: NodeValue): void => {
    if (Array.isArray(value)) {
      for (const entry of value) {
        visit(entry);
      }

      return;
    }

    if (!isOxcNode(value)) {
      return;
    }

    const node = value;

    // Function scope boundary: isolate try-catch depth for EH-09
    if (
      (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') &&
      isNodeRecord(node)
    ) {
      const savedDepth = functionTryCatchDepth;

      functionTryCatchDepth = 0;

      const entries = Object.entries(node);

      for (const [key, childValue] of entries) {
        if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') {
          continue;
        }

        visit(childValue);
      }

      functionTryCatchDepth = savedDepth;

      return;
    }

    // Pre-order hooks
    if (node.type === 'TryStatement' && isNodeRecord(node)) {
      reportOverscopedTryIfNeeded(node);
      reportExceptionControlFlowIfNeeded(node);

      const hasCatch = isOxcNode(node.handler) && node.handler.type === 'CatchClause';

      tryCatchStack.push({ hasCatch });

      if (hasCatch) {
        functionTryCatchDepth++;
      }

      // Visit children in structure order
      visit(node.block);
      visit(node.handler);
      visit(node.finalizer);

      if (hasCatch) {
        functionTryCatchDepth--;
      }

      tryCatchStack.pop();

      return;
    }

    // EH-09 return-await-policy: return await outside same-function try-catch is redundant
    if (node.type === 'ReturnStatement' && isNodeRecord(node)) {
      const arg = node.argument;

      if (isOxcNode(arg) && arg.type === 'AwaitExpression' && functionTryCatchDepth === 0) {
        pushFinding(findings, {
          kind: 'return-await-policy',
          node,
          filePath,
          sourceText,
          message: 'return await is redundant outside try/catch',
          evidence: getEvidenceLineAt(sourceText, node.start),
          recipes: ['RCP-14', 'RCP-15'],
        });
      }
    }

    // P3-1 throw-non-error
    if (node.type === 'ThrowStatement' && isNodeRecord(node)) {
      const arg = node.argument;

      if (isOxcNode(arg)) {
        const isLikelyError =
          arg.type === 'NewExpression' ||
          arg.type === 'Identifier' ||
          arg.type === 'AwaitExpression' ||
          arg.type === 'ChainExpression';
        // CallExpression is allowed in general (e.g. createError()),
        // but reject known primitive wrappers that never produce Error instances.
        const isCallButPrimitiveWrapper =
          arg.type === 'CallExpression' &&
          isNodeRecord(arg) &&
          isOxcNode(arg.callee) &&
          arg.callee.type === 'Identifier' &&
          isNodeRecord(arg.callee) &&
          isPrimitiveWrapperName(arg.callee.name as string);
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
    }

    // P3-2 async-promise-executor
    if (node.type === 'NewExpression' && isNodeRecord(node)) {
      const callee = node.callee;
      const isPromiseIdent =
        isOxcNode(callee) && callee.type === 'Identifier' && isNodeRecord(callee) && callee.name === 'Promise';
      const isPromiseMember =
        !isPromiseIdent &&
        isOxcNode(callee) &&
        callee.type === 'MemberExpression' &&
        isNodeRecord(callee) &&
        isOxcNode(callee.object) &&
        callee.object.type === 'Identifier' &&
        isNodeRecord(callee.object) &&
        (callee.object.name === 'globalThis' || callee.object.name === 'window' || callee.object.name === 'self') &&
        isOxcNode(callee.property) &&
        callee.property.type === 'Identifier' &&
        isNodeRecord(callee.property) &&
        callee.property.name === 'Promise';

      if (isPromiseIdent || isPromiseMember) {
        const args = Array.isArray(node.arguments) ? (node.arguments as ReadonlyArray<NodeValue>) : [];
        const executor = args[0];
        const isAsyncExecutor =
          executor !== undefined &&
          isOxcNode(executor) &&
          (executor.type === 'ArrowFunctionExpression' || executor.type === 'FunctionExpression') &&
          isNodeRecord(executor) &&
          executor.async === true;

        if (isAsyncExecutor) {
          pushFinding(findings, {
            kind: 'async-promise-executor',
            node,
            filePath,
            sourceText,
            message: 'Promise executor is async; thrown errors will not reject',
            evidence: getEvidenceLineAt(sourceText, node.start),
            recipes: [],
          });
        }
      }
    }

    if (node.type === 'CatchClause' && isNodeRecord(node)) {
      reportRedundantNestedCatchIfNeeded(node);
      reportSilentCatchIfNeeded(node);
      reportCatchTransformHygieneIfNeeded(node);
      // Keep visiting for other rules
    }

    // Fall back to generic traversal
    if (!isNodeRecord(node)) {
      return;
    }

    const entries = Object.entries(node);

    for (const [key, childValue] of entries) {
      if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') {
        continue;
      }

      visit(childValue);
    }
  };

  // Existing rule set (EH-01..08) still uses walkOxcTree.
  walkOxcTree(program, node => {
    // EH-02 unsafe-finally: try/finally that throws/returns in finalizer
    if (node.type === 'TryStatement' && isNodeRecord(node)) {
      const finalizer = node.finalizer;

      if (isOxcNode(finalizer) && finalizer.type === 'BlockStatement' && isNodeRecord(finalizer)) {
        if (containsReturnOrThrowStatement(finalizer)) {
          pushFinding(findings, {
            kind: 'unsafe-finally',
            node,
            filePath,
            sourceText,
            message: 'finally masks original control flow with return/throw',
            evidence: 'finally contains return/throw',
            recipes: ['RCP-03'],
          });
        }
      }
    }

    // EH-01 useless-catch: catch rethrows same identifier without adding anything
    if (node.type === 'CatchClause' && isNodeRecord(node)) {
      // If redundant nested-catch is already applicable, prefer the stronger structural signal.
      if (tryCatchStack.length > 1 && tryCatchStack.slice(0, -1).some(e => e.hasCatch)) {
        // let EH-12 handle it
        return true;
      }

      const param = node.param;
      const body = node.body;

      if (
        isOxcNode(param) &&
        param.type === 'Identifier' &&
        isNodeRecord(param) &&
        isOxcNode(body) &&
        body.type === 'BlockStatement'
      ) {
        const name = param.name;
        const stmts = Array.isArray(body.body) ? (body.body as ReadonlyArray<NodeValue>) : [];

        if (stmts.length === 1) {
          const only = stmts[0];

          if (isOxcNode(only) && only.type === 'ThrowStatement' && isNodeRecord(only)) {
            const arg = only.argument;

            if (isIdentifierName(arg, name)) {
              pushFinding(findings, {
                kind: 'useless-catch',
                node,
                filePath,
                sourceText,
                message: 'catch rethrows without adding context',
                evidence: getEvidenceLineAt(sourceText, node.start),
                recipes: ['RCP-01', 'RCP-02'],
              });
            }
          }
        }
      }
    }

    // EH-03 return-in-finally: .finally(() => { return ... })
    if (node.type === 'CallExpression' && isNodeRecord(node)) {
      const callee = node.callee;
      const method = getMemberPropertyName(callee);

      if (method === 'finally') {
        const args = Array.isArray(node.arguments) ? (node.arguments as ReadonlyArray<NodeValue>) : [];
        const first = args[0];

        if (hasNonEmptyReturnInFinallyCallback(first)) {
          pushFinding(findings, {
            kind: 'return-in-finally',
            node,
            filePath,
            sourceText,
            message: 'finally callback should not return a value',
            evidence: getEvidenceLineAt(sourceText, node.start),
            recipes: ['RCP-04'],
          });
        }
      }

      // EH-05 prefer-catch: .then(success, failure)
      if (method === 'then') {
        const args = Array.isArray(node.arguments) ? (node.arguments as ReadonlyArray<NodeValue>) : [];
        const second = args[1];

        if (second !== undefined) {
          pushFinding(findings, {
            kind: 'prefer-catch',
            node,
            filePath,
            sourceText,
            message: 'prefer .catch over then second argument',
            evidence: getEvidenceLineAt(sourceText, node.start),
            recipes: ['RCP-07'],
          });
        }
      }

      // EH-06 prefer-await-to-then: long then chains with block callbacks
      if (method === 'then') {
        const inner = isOxcNode(callee) && isNodeRecord(callee) ? callee.object : null;
        const hasNestedThen =
          isOxcNode(inner) &&
          inner.type === 'CallExpression' &&
          isNodeRecord(inner) &&
          getMemberPropertyName(inner.callee) === 'then';

        if (hasNestedThen) {
          const args = Array.isArray(node.arguments) ? (node.arguments as ReadonlyArray<NodeValue>) : [];
          const anyBlockCb = args.some(
            arg =>
              isOxcNode(arg) &&
              arg.type === 'ArrowFunctionExpression' &&
              isNodeRecord(arg) &&
              isOxcNode(arg.body) &&
              arg.body.type === 'BlockStatement',
          );

          if (anyBlockCb) {
            pushFinding(findings, {
              kind: 'prefer-await-to-then',
              node,
              filePath,
              sourceText,
              message: 'prefer await over long then chains for control flow',
              evidence: getEvidenceLineAt(sourceText, node.start),
              recipes: ['RCP-08'],
            });
          }
        }
      }
    }

    // Expression-statement based rules.
    if (node.type === 'ExpressionStatement' && isNodeRecord(node)) {
      const expr = node.expression;

      // ignore explicit void
      if (isOxcNode(expr) && expr.type === 'UnaryExpression' && isNodeRecord(expr) && expr.operator === 'void') {
        return true;
      }

      // EH-07 floating-promises: Promise.* / new Promise as expression statement
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

        return true;
      }

      // EH-04 catch-or-return: top-level then call without catch
      if (isOxcNode(expr) && expr.type === 'CallExpression' && isNodeRecord(expr)) {
        const callee = expr.callee;
        const method = getMemberPropertyName(callee);

        if (method === 'then') {
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

    // EH-08 misused-promises: async callback passed to forEach
    if (node.type === 'CallExpression' && isNodeRecord(node)) {
      const callee = node.callee;
      const method = getMemberPropertyName(callee);

      if (
        method &&
        (method === 'forEach' ||
          method === 'map' ||
          method === 'filter' ||
          method === 'some' ||
          method === 'every' ||
          method === 'find' ||
          method === 'findIndex' ||
          method === 'reduce' ||
          method === 'reduceRight' ||
          method === 'sort')
      ) {
        const args = Array.isArray(node.arguments) ? (node.arguments as ReadonlyArray<NodeValue>) : [];
        const first = args[0];
        const isAsyncFn =
          isOxcNode(first) &&
          (first.type === 'ArrowFunctionExpression' || first.type === 'FunctionExpression') &&
          isNodeRecord(first) &&
          first.async === true;

        if (isAsyncFn) {
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

    return true;
  });

  // Run enhanced traversal for EH-09..14 and for nested context.
  visit(program);

  return findings;
};

const createEmptyExceptionHygiene = (): ReadonlyArray<ExceptionHygieneFinding> => [];

const analyzeExceptionHygiene = (files: ReadonlyArray<ParsedFile>): ReadonlyArray<ExceptionHygieneFinding> => {
  if (files.length === 0) {
    return createEmptyExceptionHygiene();
  }

  const findings: ExceptionHygieneFinding[] = [];

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    findings.push(...collectFindings(file.program, file.sourceText, file.filePath));
  }

  return findings;
};

export { analyzeExceptionHygiene, createEmptyExceptionHygiene };
