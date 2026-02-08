import type { Node } from 'oxc-parser';

import type { NodeValue, ParsedFile } from '../../engine/types';
import type { ForwardingAnalysis, ForwardingFinding, ForwardingFindingKind, ForwardingParamsInfo } from '../../types';

import { getNodeHeader, isFunctionNode, isNodeRecord, isOxcNode, isOxcNodeArray, walkOxcTree } from '../../engine/oxc-ast-utils';
import { getLineColumn } from '../../engine/source-position';

const createEmptyForwarding = (): ForwardingAnalysis => ({
  findings: [],
});

const getSpan = (node: Node, sourceText: string) => {
  const start = getLineColumn(sourceText, node.start);
  const end = getLineColumn(sourceText, node.end);

  return {
    start,
    end,
  };
};

const getAwaitedCallExpression = (node: Node): Node | null => {
  if (node.type !== 'AwaitExpression') {
    return null;
  }

  if (!isNodeRecord(node)) {
    return null;
  }

  const argument = node.argument;

  if (!isOxcNode(argument)) {
    return null;
  }

  if (argument.type !== 'CallExpression') {
    return null;
  }

  return argument;
};

const getCallExpression = (node: Node): Node | null => {
  if (node.type === 'CallExpression') {
    return node;
  }

  return getAwaitedCallExpression(node);
};

const getCallFromExpression = (expression: Node | null): Node | null => {
  if (!expression) {
    return null;
  }

  return getCallExpression(expression);
};

const getCallFromStatement = (statement: Node): Node | null => {
  if (!isNodeRecord(statement)) {
    return null;
  }

  if (statement.type === 'ReturnStatement') {
    const argument = statement.argument;

    if (!isOxcNode(argument)) {
      return null;
    }

    return getCallFromExpression(argument);
  }

  if (statement.type === 'ExpressionStatement') {
    const expression = statement.expression;

    if (!isOxcNode(expression)) {
      return null;
    }

    return getCallFromExpression(expression);
  }

  return null;
};

const getParams = (node: Node): ForwardingParamsInfo | null => {
  if (!isNodeRecord(node)) {
    return null;
  }

  const paramsValue = node.params;

  if (!Array.isArray(paramsValue)) {
    return null;
  }

  const params: string[] = [];
  let restParam: string | null = null;

  for (const paramNode of paramsValue) {
    if (!isOxcNode(paramNode)) {
      return null;
    }

    if (paramNode.type === 'Identifier' && 'name' in paramNode && typeof paramNode.name === 'string') {
      params.push(paramNode.name);

      continue;
    }

    if (paramNode.type === 'RestElement' && isNodeRecord(paramNode)) {
      const argument = paramNode.argument;

      if (isOxcNode(argument) && argument.type === 'Identifier' && typeof argument.name === 'string') {
        restParam = argument.name;

        params.push(argument.name);

        continue;
      }
    }

    return null;
  }

  return {
    params,
    restParam,
  };
};

const isForwardingArgs = (callExpression: Node, params: readonly string[], restParam: string | null): boolean => {
  if (!isNodeRecord(callExpression)) {
    return false;
  }

  const args = callExpression.arguments;

  if (!Array.isArray(args)) {
    return false;
  }

  if (params.length === 0) {
    return args.length === 0;
  }

  if (args.length !== params.length) {
    return false;
  }

  for (let index = 0; index < params.length; index += 1) {
    const arg = args[index];
    const name = params[index] ?? '';
    const isRest = restParam !== null && name === restParam && index === params.length - 1;

    if (!isOxcNode(arg)) {
      return false;
    }

    if (isRest) {
      if (arg.type !== 'SpreadElement' || !isNodeRecord(arg)) {
        return false;
      }

      const spreadArg = arg.argument;

      if (!isOxcNode(spreadArg) || spreadArg.type !== 'Identifier' || spreadArg.name !== restParam) {
        return false;
      }

      continue;
    }

    if (arg.type !== 'Identifier' || arg.name !== name) {
      return false;
    }
  }

  return true;
};

const getWrapperCall = (node: Node): Node | null => {
  const paramsInfo = getParams(node);

  if (!paramsInfo) {
    return null;
  }

  if (!isNodeRecord(node)) {
    return null;
  }

  const body = node.body;

  if (!isOxcNode(body)) {
    return null;
  }

  const maybeCall =
    body.type === 'BlockStatement'
      ? (() => {
          if (!isNodeRecord(body)) {
            return null;
          }

          const statements = body.body;

          if (!isOxcNodeArray(statements) || statements.length !== 1) {
            return null;
          }

          const statement = statements[0];

          if (!isOxcNode(statement)) {
            return null;
          }

          return getCallFromStatement(statement);
        })()
      : getCallFromExpression(body);

  if (!maybeCall) {
    return null;
  }

  if (!isForwardingArgs(maybeCall, paramsInfo.params, paramsInfo.restParam)) {
    return null;
  }

  return maybeCall;
};

const resolveCalleeName = (callExpression: Node): string | null => {
  if (!isNodeRecord(callExpression)) {
    return null;
  }

  const callee = callExpression.callee;

  if (!isOxcNode(callee)) {
    return null;
  }

  if (callee.type === 'Identifier' && 'name' in callee && typeof callee.name === 'string') {
    return callee.name;
  }

  if (callee.type === 'MemberExpression' && isNodeRecord(callee)) {
    const object = callee.object;
    const property = callee.property;

    if (isOxcNode(object) && object.type === 'ThisExpression' && isOxcNode(property) && property.type === 'Identifier') {
      return property.name;
    }
  }

  return null;
};

const collectFunctionNames = (program: NodeValue): Map<Node, string> => {
  const namesByNode = new Map<Node, string>();

  walkOxcTree(program, node => {
    if (!isNodeRecord(node)) {
      return true;
    }

    if (node.type === 'FunctionDeclaration') {
      const idNode = node.id;

      if (isOxcNode(idNode) && idNode.type === 'Identifier' && typeof idNode.name === 'string') {
        namesByNode.set(node, idNode.name);
      }

      return true;
    }

    if (node.type === 'VariableDeclarator') {
      const idNode = node.id;
      const initNode = node.init;

      if (isOxcNode(idNode) && idNode.type === 'Identifier' && typeof idNode.name === 'string' && isOxcNode(initNode)) {
        if (isFunctionNode(initNode)) {
          namesByNode.set(initNode, idNode.name);
        }
      }

      return true;
    }

    if (node.type === 'Property') {
      const valueNode = node.value;

      if (isOxcNode(valueNode) && isFunctionNode(valueNode)) {
        const header = getNodeHeader(node);

        if (header.length > 0 && header !== 'anonymous') {
          namesByNode.set(valueNode, header);
        }
      }

      return true;
    }

    if (node.type === 'MethodDefinition') {
      const valueNode = node.value;

      if (isOxcNode(valueNode) && isFunctionNode(valueNode)) {
        const header = getNodeHeader(node);

        if (header.length > 0 && header !== 'anonymous') {
          namesByNode.set(valueNode, header);
        }
      }

      return true;
    }

    return true;
  });

  return namesByNode;
};

const addFinding = (
  findings: ForwardingFinding[],
  kind: ForwardingFindingKind,
  node: Node,
  filePath: string,
  sourceText: string,
  header: string,
  depth: number,
  evidence: string,
): void => {
  findings.push({
    kind,
    filePath,
    span: getSpan(node, sourceText),
    header,
    depth,
    evidence,
  });
};

const computeChainDepth = (name: string, calleeByName: Map<string, string | null>, visited: Set<string>): number => {
  if (visited.has(name)) {
    return 1;
  }

  const nextName = calleeByName.get(name);

  if (nextName === null || nextName === undefined || nextName.length === 0) {
    return 1;
  }

  if (!calleeByName.has(nextName)) {
    return 1;
  }

  visited.add(name);

  const nextDepth = computeChainDepth(nextName, calleeByName, visited);

  visited.delete(name);

  return 1 + nextDepth;
};

const analyzeForwarding = (files: ReadonlyArray<ParsedFile>, maxForwardDepth: number): ForwardingAnalysis => {
  if (files.length === 0) {
    return createEmptyForwarding();
  }

  const findings: ForwardingFinding[] = [];

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    const namesByNode = collectFunctionNames(file.program);
    const calleeByName = new Map<string, string | null>();
    const wrapperNodeByName = new Map<string, Node>();

    walkOxcTree(file.program, node => {
      if (!isFunctionNode(node)) {
        return true;
      }

      const wrapperCall = getWrapperCall(node);

      if (!wrapperCall) {
        return true;
      }

      const header = namesByNode.get(node) ?? getNodeHeader(node);
      const calleeName = resolveCalleeName(wrapperCall);
      const evidence = `thin wrapper forwards to ${calleeName ?? 'call'}`;

      addFinding(findings, 'thin-wrapper', node, file.filePath, file.sourceText, header, 1, evidence);

      if (header.length > 0 && header !== 'anonymous') {
        calleeByName.set(header, calleeName);
        wrapperNodeByName.set(header, node);
      }

      return true;
    });

    if (maxForwardDepth >= 1) {
      for (const [name, node] of wrapperNodeByName.entries()) {
        const depth = computeChainDepth(name, calleeByName, new Set<string>());

        if (depth > maxForwardDepth) {
          const evidence = `forwarding chain depth ${depth} exceeds max ${maxForwardDepth}`;
          const header = namesByNode.get(node) ?? getNodeHeader(node);

          addFinding(findings, 'forward-chain', node, file.filePath, file.sourceText, header, depth, evidence);
        }
      }
    }
  }

  return {
    findings,
  };
};

export { analyzeForwarding, createEmptyForwarding };
