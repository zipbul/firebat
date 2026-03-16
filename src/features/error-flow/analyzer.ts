import type { Node } from 'oxc-parser';

import type { NodeValue, ParsedFile } from '../../engine/types';
import type { ErrorFlowFinding, ErrorFlowFindingKind, SourceSpan } from './types';

import { isNodeRecord, isOxcNode, walkOxcTree } from '../../engine/ast/oxc-ast-utils';
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
    name === 'EvalError' ||
    name === 'AggregateError'
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

type UnsafeControlFlowKind = 'return' | 'throw' | 'break' | 'continue';

const findUnsafeControlFlowInFinally = (finalizer: NodeValue): UnsafeControlFlowKind | null => {
  let result: UnsafeControlFlowKind | null = null;

  const walk = (node: NodeValue, loopDepth: number, switchDepth: number): void => {
    if (result !== null) {
      return;
    }

    if (Array.isArray(node)) {
      for (const entry of node) {
        walk(entry, loopDepth, switchDepth);
      }

      return;
    }

    if (!isOxcNode(node)) {
      return;
    }

    // Don't cross function boundaries
    if (
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression'
    ) {
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

    if (node.type === 'BreakStatement' && isNodeRecord(node)) {
      if (isOxcNode(node.label) || (loopDepth === 0 && switchDepth === 0)) {
        result = 'break';

        return;
      }
    }

    if (node.type === 'ContinueStatement' && isNodeRecord(node)) {
      if (isOxcNode(node.label) || loopDepth === 0) {
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

    if (!isNodeRecord(node)) {
      return;
    }

    for (const [key, child] of Object.entries(node)) {
      if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') {
        continue;
      }

      walk(child as NodeValue, nextLoop, nextSwitch);
    }
  };

  walk(finalizer, 0, 0);

  return result;
};

const containsThrowInExecutor = (body: NodeValue): boolean => {
  let found = false;

  walkOxcTree(body, node => {
    if (node.type === 'ThrowStatement') {
      found = true;

      return false;
    }

    // Don't cross function boundaries
    if (
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression'
    ) {
      return false;
    }

    return true;
  });

  return found;
};

const containsNonEmptyReturnInExecutor = (body: NodeValue): boolean => {
  let found = false;

  walkOxcTree(body, node => {
    if (node.type === 'ReturnStatement' && isNodeRecord(node)) {
      const arg = node.argument;

      // return; (no argument) is fine
      if (isOxcNode(arg)) {
        found = true;

        return false;
      }
    }

    // Don't cross function boundaries
    if (
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression'
    ) {
      return false;
    }

    return true;
  });

  return found;
};

const callbackApiMethods = new Set(['addEventListener', 'on', 'once', 'subscribe', 'addListener']);

const containsCallbackApiCall = (body: NodeValue): boolean => {
  let found = false;

  walkOxcTree(body, node => {
    if (node.type === 'CallExpression' && isNodeRecord(node)) {
      const method = getMemberPropertyName(node.callee);

      if (method !== null && callbackApiMethods.has(method)) {
        found = true;

        return false;
      }
    }

    return true;
  });

  return found;
};

const isPromiseWrapCall = (expr: NodeValue): boolean => {
  if (!isOxcNode(expr) || expr.type !== 'CallExpression' || !isNodeRecord(expr)) {
    return false;
  }

  const callee = expr.callee;

  if (!isOxcNode(callee) || callee.type !== 'MemberExpression' || !isNodeRecord(callee)) {
    return false;
  }

  const obj = callee.object;
  const prop = callee.property;

  return (
    isOxcNode(obj) &&
    obj.type === 'Identifier' &&
    isNodeRecord(obj) &&
    obj.name === 'Promise' &&
    isOxcNode(prop) &&
    prop.type === 'Identifier' &&
    isNodeRecord(prop) &&
    (prop.name === 'resolve' || prop.name === 'reject')
  );
};

const containsPromiseWrapReturn = (body: NodeValue): boolean => {
  let found = false;

  walkOxcTree(body, node => {
    if (node.type === 'ReturnStatement' && isNodeRecord(node)) {
      if (isPromiseWrapCall(node.argument)) {
        found = true;

        return false;
      }
    }

    if (
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression'
    ) {
      return false;
    }

    return true;
  });

  return found;
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

const containsNodeStyleCallback = (body: NodeValue): boolean => {
  let found = false;

  walkOxcTree(body, node => {
    if (node.type === 'CallExpression' && isNodeRecord(node)) {
      const method = getMemberPropertyName(node.callee);

      if (method !== null && nodeStyleCallbackMethods.has(method)) {
        const args = Array.isArray(node.arguments) ? (node.arguments as ReadonlyArray<NodeValue>) : [];
        const last = args[args.length - 1];
        const isCallbackArg =
          last !== undefined &&
          isOxcNode(last) &&
          (last.type === 'ArrowFunctionExpression' || last.type === 'FunctionExpression');

        if (isCallbackArg) {
          found = true;

          return false;
        }
      }
    }

    if (
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression'
    ) {
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

interface UnobservedCandidate {
  readonly name: string;
  readonly node: Node;
}

const collectUnobservedVariables = (
  program: NodeValue,
  findings: ErrorFlowFinding[],
  filePath: string,
  sourceText: string,
): void => {
  // Collect variable declarations initialized with call expressions,
  // then check if the variable is ever awaited, .then()ed, or .catch()ed in the same scope.
  const processScope = (body: NodeValue): void => {
    if (!Array.isArray(body)) {
      return;
    }

    const candidates: UnobservedCandidate[] = [];

    // Pass 1: collect candidates
    for (const stmt of body) {
      if (!isOxcNode(stmt) || stmt.type !== 'VariableDeclaration' || !isNodeRecord(stmt)) {
        continue;
      }

      const decls = Array.isArray(stmt.declarations) ? (stmt.declarations as ReadonlyArray<NodeValue>) : [];

      for (const decl of decls) {
        if (!isOxcNode(decl) || decl.type !== 'VariableDeclarator' || !isNodeRecord(decl)) {
          continue;
        }

        const id = decl.id;
        const init = decl.init;

        if (
          isOxcNode(id) &&
          id.type === 'Identifier' &&
          isNodeRecord(id) &&
          typeof id.name === 'string' &&
          isOxcNode(init) &&
          init.type === 'CallExpression'
        ) {
          candidates.push({ name: id.name, node: stmt as Node });
        }
      }
    }

    if (candidates.length === 0) {
      return;
    }

    // Pass 2: check usage
    const observed = new Set<string>();

    walkOxcTree(body, node => {
      // await x
      if (node.type === 'AwaitExpression' && isNodeRecord(node)) {
        const arg = node.argument;

        if (isOxcNode(arg) && arg.type === 'Identifier' && isNodeRecord(arg) && typeof arg.name === 'string') {
          observed.add(arg.name);
        }
      }

      // x.then(...), x.catch(...), or x passed as function argument
      if (node.type === 'CallExpression' && isNodeRecord(node)) {
        const callee = node.callee;

        if (isOxcNode(callee) && callee.type === 'MemberExpression' && isNodeRecord(callee)) {
          const obj = callee.object;
          const method = getMemberPropertyName(callee);

          if (
            isOxcNode(obj) &&
            obj.type === 'Identifier' &&
            isNodeRecord(obj) &&
            typeof obj.name === 'string' &&
            (method === 'then' || method === 'catch' || method === 'finally')
          ) {
            observed.add(obj.name);
          }
        }

        // fn(p) — passed as function argument, considered observed
        const callArgs = Array.isArray(node.arguments) ? (node.arguments as ReadonlyArray<NodeValue>) : [];

        for (const callArg of callArgs) {
          if (isOxcNode(callArg) && callArg.type === 'Identifier' && isNodeRecord(callArg) && typeof callArg.name === 'string') {
            observed.add(callArg.name);
          }
        }
      }

      // return x
      if (node.type === 'ReturnStatement' && isNodeRecord(node)) {
        const arg = node.argument;

        if (isOxcNode(arg) && arg.type === 'Identifier' && isNodeRecord(arg) && typeof arg.name === 'string') {
          observed.add(arg.name);
        }
      }

      return true;
    });

    for (const candidate of candidates) {
      if (!observed.has(candidate.name)) {
        pushFinding(findings, {
          kind: 'unobserved-variable',
          node: candidate.node,
          filePath,
          sourceText,
          message: `variable '${candidate.name}' is assigned a call result but never awaited, .then()ed, or .catch()ed`,
          evidence: getEvidenceLineAt(sourceText, candidate.node.start),
          recipes: [],
        });
      }
    }
  };

  // Walk top-level and function bodies
  walkOxcTree(program, node => {
    if (
      (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') &&
      isNodeRecord(node)
    ) {
      const body = node.body;

      if (isOxcNode(body) && body.type === 'BlockStatement' && isNodeRecord(body)) {
        processScope(body.body as NodeValue);
      }
    }

    return true;
  });

  // Also process top-level program body
  if (isNodeRecord(program)) {
    const body = program.body;

    if (Array.isArray(body)) {
      processScope(body);
    }
  }
};

const collectFindings = (program: NodeValue, sourceText: string, filePath: string): ErrorFlowFinding[] => {
  const findings: ErrorFlowFinding[] = [];
  const tryCatchStack: TryCatchEntry[] = [];
  let functionTryCatchDepth = 0;
  let inTryBlockDepth = 0;
  let inAsyncFunction = false;
  let inTryBlockWithCatchDepth = 0;

  const reportCatchTransformHygieneIfNeeded = (catchClause: NodeValue): void => {
    if (!isOxcNode(catchClause) || !isNodeRecord(catchClause)) {
      return;
    }

    const param = catchClause.param;
    const body = catchClause.body;

    if (!isOxcNode(body) || body.type !== 'BlockStatement' || !isNodeRecord(body)) {
      return;
    }

    // Optional catch binding: catch { throw new Error('fail'); }
    if (!isOxcNode(param)) {
      walkOxcTree(body, node => {
        if (node.type !== 'ThrowStatement' || !isNodeRecord(node)) {
          return true;
        }

        const arg = node.argument;

        if (!isOxcNode(arg) || arg.type !== 'NewExpression' || !isNodeRecord(arg)) {
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
    if (param.type !== 'Identifier' || !isNodeRecord(param)) {
      return;
    }

    const name = param.name;
    // Catch param reassignment: catch(e) { e = new Error(); throw e; }
    let hasReassignment = false;

    walkOxcTree(body, node => {
      if (node.type === 'AssignmentExpression' && isNodeRecord(node)) {
        if (isIdentifierName(node.left, name)) {
          hasReassignment = true;

          return false;
        }
      }

      // Don't cross function boundaries for reassignment check
      if (
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression' ||
        node.type === 'FunctionDeclaration'
      ) {
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
          // Check for vibe pattern: catch param used in Error message position
          const constructorArgs = Array.isArray(arg.arguments) ? (arg.arguments as ReadonlyArray<NodeValue>) : [];
          const firstArg = constructorArgs[0];
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
          kind: 'missing-error-cause',
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

  const isUselessRethrow = (catchClause: NodeValue): boolean => {
    if (!isOxcNode(catchClause) || !isNodeRecord(catchClause)) {
      return false;
    }

    const param = catchClause.param;
    const body = catchClause.body;

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
  };

  const reportUselessCatchIfNeeded = (catchClause: NodeValue): void => {
    if (!isUselessRethrow(catchClause)) {
      return;
    }

    const isNested = isNestedUnderOuterCatch();

    pushFinding(findings, {
      kind: 'useless-catch',
      node: catchClause,
      filePath,
      sourceText,
      message: isNested ? 'nested catch is redundant under an outer catch' : 'catch rethrows without adding context',
      evidence: getEvidenceLineAt(sourceText, (catchClause as Node).start),
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

    // Function scope boundary: isolate try-catch depth for EF-06 return-await-in-try
    if (
      (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') &&
      isNodeRecord(node)
    ) {
      const savedDepth = functionTryCatchDepth;
      const savedTryBlockDepth = inTryBlockDepth;
      const savedAsync = inAsyncFunction;
      const savedTryWithCatch = inTryBlockWithCatchDepth;

      functionTryCatchDepth = 0;
      inTryBlockDepth = 0;
      inAsyncFunction = node.async === true;
      inTryBlockWithCatchDepth = 0;

      const entries = Object.entries(node);

      for (const [key, childValue] of entries) {
        if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') {
          continue;
        }

        visit(childValue);
      }

      functionTryCatchDepth = savedDepth;
      inTryBlockDepth = savedTryBlockDepth;
      inAsyncFunction = savedAsync;
      inTryBlockWithCatchDepth = savedTryWithCatch;

      return;
    }

    // Pre-order hooks
    if (node.type === 'TryStatement' && isNodeRecord(node)) {
      const hasCatch = isOxcNode(node.handler) && node.handler.type === 'CatchClause';
      const hasFinalizer = isOxcNode(node.finalizer);

      // Nested try/catch: flag try/catch inside another try block that has catch (SonarQube S1141)
      // Allowed: inner try/catch inside outer try/finally (no catch) — cleanup pattern
      if (hasCatch && inTryBlockWithCatchDepth > 0) {
        pushFinding(findings, {
          kind: 'useless-catch',
          node,
          filePath,
          sourceText,
          message: 'nested try/catch inside try block increases error flow complexity',
          evidence: getEvidenceLineAt(sourceText, node.start),
          recipes: [],
        });
      }

      tryCatchStack.push({ hasCatch });

      if (hasCatch || hasFinalizer) {
        functionTryCatchDepth++;
      }

      // Visit block with depth tracking
      inTryBlockDepth++;

      if (hasCatch) {
        inTryBlockWithCatchDepth++;
      }

      visit(node.block);

      if (hasCatch) {
        inTryBlockWithCatchDepth--;
      }

      inTryBlockDepth--;

      visit(node.handler);

      visit(node.finalizer);

      if (hasCatch || hasFinalizer) {
        functionTryCatchDepth--;
      }

      tryCatchStack.pop();

      return;
    }

    // EF-06 return-await-in-try: return without await in try block misses rejection
    if (node.type === 'ReturnStatement' && isNodeRecord(node) && inTryBlockWithCatchDepth > 0) {
      const arg = node.argument;

      // Only flag non-awaited expressions that likely return a Promise
      if (
        isOxcNode(arg) &&
        arg.type !== 'AwaitExpression' &&
        (arg.type === 'CallExpression' || arg.type === 'NewExpression')
      ) {
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

    // P3-2 promise-constructor-hygiene
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
        const isInlineExecutor =
          executor !== undefined &&
          isOxcNode(executor) &&
          (executor.type === 'ArrowFunctionExpression' || executor.type === 'FunctionExpression') &&
          isNodeRecord(executor);

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

          // sync executor throw: throw in executor does NOT reject, it throws synchronously
          if (!isAsync) {
            const executorBody = executor.body;

            if (isOxcNode(executorBody) && executorBody.type === 'BlockStatement') {
              if (containsThrowInExecutor(executorBody)) {
                pushFinding(findings, {
                  kind: 'promise-constructor-hygiene',
                  node,
                  filePath,
                  sourceText,
                  message: 'throw in sync Promise executor does not reject — use reject() instead',
                  evidence: getEvidenceLineAt(sourceText, node.start),
                  recipes: [],
                });
              }
            }
          }

          // executor return value: return in executor is ignored
          if (!isAsync) {
            const executorBody = executor.body;

            if (isOxcNode(executorBody) && executorBody.type === 'BlockStatement') {
              if (containsNonEmptyReturnInExecutor(executorBody)) {
                pushFinding(findings, {
                  kind: 'promise-constructor-hygiene',
                  node,
                  filePath,
                  sourceText,
                  message: 'return value in Promise executor is ignored — use resolve() instead',
                  evidence: getEvidenceLineAt(sourceText, node.start),
                  recipes: [],
                });
              }
            }
          }

          // param order: first param should be resolve, not reject
          const executorParams = Array.isArray(executor.params) ? (executor.params as ReadonlyArray<NodeValue>) : [];
          const firstParam = executorParams[0];

          if (
            firstParam !== undefined &&
            isOxcNode(firstParam) &&
            firstParam.type === 'Identifier' &&
            isNodeRecord(firstParam) &&
            firstParam.name === 'reject'
          ) {
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

        // unnecessary new Promise in async function (GAP-14)
        // Skip if already flagged as async executor — avoid duplicate on same node
        const isAsyncExecutor = isInlineExecutor && executor.async === true;

        if (inAsyncFunction && !isAsyncExecutor) {
          const hasCallbackWrapping =
            isInlineExecutor && containsCallbackApiCall(executor.body as NodeValue);

          if (!hasCallbackWrapping) {
            pushFinding(findings, {
              kind: 'promise-constructor-hygiene',
              node,
              filePath,
              sourceText,
              message: 'unnecessary new Promise in async function — use await instead',
              evidence: getEvidenceLineAt(sourceText, node.start),
              recipes: [],
            });
          }
        }
      }
    }

    if (node.type === 'CatchClause' && isNodeRecord(node)) {
      reportUselessCatchIfNeeded(node);
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

  // Existing rule set (EF-01..08) still uses walkOxcTree.
  walkOxcTree(program, node => {
    // EF-03 unsafe-finally: try/finally that throws/returns/breaks/continues in finalizer
    if (node.type === 'TryStatement' && isNodeRecord(node)) {
      const finalizer = node.finalizer;

      if (isOxcNode(finalizer) && finalizer.type === 'BlockStatement' && isNodeRecord(finalizer)) {
        const unsafeKind = findUnsafeControlFlowInFinally(finalizer);

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
    }

    // EF-01 useless-catch is now handled in visit() via reportUselessCatchIfNeeded
    // to avoid double-reporting with the nested variant.

    // EF-03 return-in-finally: .finally(() => { return ... })
    if (node.type === 'CallExpression' && isNodeRecord(node)) {
      const callee = node.callee;
      const method = getMemberPropertyName(callee);

      if (method === 'finally') {
        const args = Array.isArray(node.arguments) ? (node.arguments as ReadonlyArray<NodeValue>) : [];
        const first = args[0];

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

      // EF-07 prefer-catch: .then(success, failure)
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

      // EF-07 prefer-await-to-then: long then chains with block callbacks
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

      // no-return-wrap: .then(() => Promise.resolve(x)) — unnecessary wrapping
      if (method === 'then') {
        const args = Array.isArray(node.arguments) ? (node.arguments as ReadonlyArray<NodeValue>) : [];

        for (const arg of args) {
          if (!isOxcNode(arg) || !isNodeRecord(arg)) {
            continue;
          }

          if (arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression') {
            const body = arg.body;

            if (isOxcNode(body) && body.type !== 'BlockStatement' && isPromiseWrapCall(body)) {
              pushFinding(findings, {
                kind: 'no-return-wrap',
                node,
                filePath,
                sourceText,
                message: 'unnecessary Promise.resolve/reject wrapping in then callback — return value directly',
                evidence: getEvidenceLineAt(sourceText, node.start),
                recipes: [],
              });
            }

            if (isOxcNode(body) && body.type === 'BlockStatement') {
              if (containsPromiseWrapReturn(body)) {
                pushFinding(findings, {
                  kind: 'no-return-wrap',
                  node,
                  filePath,
                  sourceText,
                  message: 'unnecessary Promise.resolve/reject wrapping in then callback — return value directly',
                  evidence: getEvidenceLineAt(sourceText, node.start),
                  recipes: [],
                });
              }
            }
          }
        }
      }

      // always-return: then callback with block body that has no return
      if (method === 'then') {
        const args = Array.isArray(node.arguments) ? (node.arguments as ReadonlyArray<NodeValue>) : [];
        const first = args[0];

        if (
          first !== undefined &&
          isOxcNode(first) &&
          (first.type === 'ArrowFunctionExpression' || first.type === 'FunctionExpression') &&
          isNodeRecord(first)
        ) {
          const body = first.body;

          if (isOxcNode(body) && body.type === 'BlockStatement' && !containsReturnStatement(body)) {
            pushFinding(findings, {
              kind: 'always-return',
              node,
              filePath,
              sourceText,
              message: 'then callback does not return a value — breaks Promise chain',
              evidence: getEvidenceLineAt(sourceText, node.start),
              recipes: [],
            });
          }
        }
      }

      // no-callback-in-promise: callback-style API inside then/catch/finally callback
      if (method === 'then' || method === 'catch') {
        const args = Array.isArray(node.arguments) ? (node.arguments as ReadonlyArray<NodeValue>) : [];

        for (const arg of args) {
          if (
            isOxcNode(arg) &&
            (arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression') &&
            isNodeRecord(arg)
          ) {
            const body = arg.body;

            if (isOxcNode(body) && containsNodeStyleCallback(body)) {
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
    }

    // Expression-statement based rules.
    if (node.type === 'ExpressionStatement' && isNodeRecord(node)) {
      const expr = node.expression;

      // ignore explicit void
      if (isOxcNode(expr) && expr.type === 'UnaryExpression' && isNodeRecord(expr) && expr.operator === 'void') {
        return true;
      }

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

        return true;
      }

      // EF-08 catch-or-return: top-level then call without catch
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

    // EF-08 misused-promises: async callback passed to forEach
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

  // Run enhanced traversal for EF-04 missing-error-cause, EF-05 promise-constructor, nested context.
  visit(program);

  // unobserved-variable: const p = asyncFn(); without await/then/catch on p
  collectUnobservedVariables(program, findings, filePath, sourceText);

  return findings;
};

const createEmptyErrorFlow = (): ReadonlyArray<ErrorFlowFinding> => [];

const analyzeErrorFlow = (files: ReadonlyArray<ParsedFile>): ReadonlyArray<ErrorFlowFinding> => {
  if (files.length === 0) {
    return createEmptyErrorFlow();
  }

  const findings: ErrorFlowFinding[] = [];

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    findings.push(...collectFindings(file.program, file.sourceText, file.filePath));
  }

  return findings;
};

export { analyzeErrorFlow, createEmptyErrorFlow };
