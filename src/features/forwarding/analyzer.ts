import type { Node } from 'oxc-parser';

import * as path from 'node:path';

import type { NodeRecord, NodeValue, ParsedFile } from '../../engine/types';
import type { ForwardingFinding, ForwardingFindingKind, ForwardingParamsInfo } from '../../types';

import { getNodeHeader, isFunctionNode, isNodeRecord, isOxcNode, isOxcNodeArray, walkOxcTree } from '../../engine/oxc-ast-utils';
import { getLineColumn } from '../../engine/source-position';

const normalizePath = (value: string): string => value.replaceAll('\\', '/');

const isStringLiteral = (value: NodeValue): value is NodeRecord => {
  if (!isOxcNode(value)) {
    return false;
  }

  if (!isNodeRecord(value)) {
    return false;
  }

  if (value.type !== 'Literal') {
    return false;
  }

  const literalValue = value.value;

  return typeof literalValue === 'string';
};

const isProgramBody = (value: unknown): value is { readonly body: ReadonlyArray<NodeValue> } => {
  return !!value && typeof value === 'object' && Array.isArray((value as { body?: unknown }).body);
};

const buildFileMap = (files: ReadonlyArray<ParsedFile>): Map<string, ParsedFile> => {
  const map = new Map<string, ParsedFile>();

  for (const file of files) {
    map.set(normalizePath(file.filePath), file);
  }

  return map;
};

const resolveImport = (fromPath: string, specifier: string, fileMap: Map<string, ParsedFile>): string | null => {
  if (!specifier.startsWith('.')) {
    return null;
  }

  const base = path.resolve(path.dirname(fromPath), specifier);
  const candidates = [base, `${base}.ts`, path.join(base, 'index.ts')];

  for (const candidate of candidates) {
    const normalized = normalizePath(candidate);

    if (fileMap.has(normalized)) {
      return normalized;
    }
  }

  return null;
};

type ImportBinding =
  | {
      readonly kind: 'named';
      readonly targetFilePath: string;
      readonly importedName: string;
    }
  | {
      readonly kind: 'default';
      readonly targetFilePath: string;
    }
  | {
      readonly kind: 'namespace';
      readonly targetFilePath: string;
    };

const collectImportBindings = (
  program: NodeValue,
  fromFilePath: string,
  fileMap: Map<string, ParsedFile>,
): Map<string, ImportBinding> => {
  const out = new Map<string, ImportBinding>();
  const p = program as unknown;

  if (!isProgramBody(p)) {
    return out;
  }

  for (const stmt of p.body) {
    if (!isOxcNode(stmt) || !isNodeRecord(stmt)) {
      continue;
    }

    if (stmt.type !== 'ImportDeclaration') {
      continue;
    }

    const source = stmt.source;

    if (!isStringLiteral(source)) {
      continue;
    }

    const specifier = source.value;
    const resolved = resolveImport(fromFilePath, specifier, fileMap);

    if (!resolved) {
      continue;
    }

    const specifiers = Array.isArray(stmt.specifiers) ? stmt.specifiers : [];

    for (const spec of specifiers) {
      if (!isOxcNode(spec) || !isNodeRecord(spec)) {
        continue;
      }

      if (spec.type === 'ImportSpecifier') {
        const local = spec.local;
        const imported = spec.imported;

        if (!isOxcNode(local) || local.type !== 'Identifier' || typeof local.name !== 'string') {
          continue;
        }

        if (!isOxcNode(imported)) {
          continue;
        }

        if (imported.type === 'Identifier' && typeof imported.name === 'string') {
          out.set(local.name, { kind: 'named', targetFilePath: resolved, importedName: imported.name });

          continue;
        }

        if (imported.type === 'Literal' && typeof (imported as unknown as { value?: unknown }).value === 'string') {
          const name = (imported as unknown as { value: string }).value;

          out.set(local.name, { kind: 'named', targetFilePath: resolved, importedName: name });

          continue;
        }

        continue;
      }

      if (spec.type === 'ImportDefaultSpecifier') {
        const local = spec.local;

        if (!isOxcNode(local) || local.type !== 'Identifier' || typeof local.name !== 'string') {
          continue;
        }

        out.set(local.name, { kind: 'default', targetFilePath: resolved });

        continue;
      }

      if (spec.type === 'ImportNamespaceSpecifier') {
        const local = spec.local;

        if (!isOxcNode(local) || local.type !== 'Identifier' || typeof local.name !== 'string') {
          continue;
        }

        out.set(local.name, { kind: 'namespace', targetFilePath: resolved });

        continue;
      }
    }
  }

  return out;
};

const collectExportedNameByLocal = (program: NodeValue): Map<string, string> => {
  const out = new Map<string, string>();
  const p = program as unknown;

  if (!isProgramBody(p)) {
    return out;
  }

  for (const stmt of p.body) {
    if (!isOxcNode(stmt) || !isNodeRecord(stmt)) {
      continue;
    }

    if (stmt.type === 'ExportNamedDeclaration') {
      const declaration = stmt.declaration;
      const specifiers = Array.isArray(stmt.specifiers) ? stmt.specifiers : [];

      if (isOxcNode(declaration) && isNodeRecord(declaration)) {
        if (declaration.type === 'FunctionDeclaration') {
          const id = declaration.id;

          if (isOxcNode(id) && id.type === 'Identifier' && typeof id.name === 'string') {
            out.set(id.name, id.name);
          }
        }

        if (declaration.type === 'VariableDeclaration') {
          const declarations = Array.isArray(declaration.declarations) ? declaration.declarations : [];

          for (const decl of declarations) {
            if (!isOxcNode(decl) || !isNodeRecord(decl) || decl.type !== 'VariableDeclarator') {
              continue;
            }

            const id = decl.id;

            if (isOxcNode(id) && id.type === 'Identifier' && typeof id.name === 'string') {
              out.set(id.name, id.name);
            }
          }
        }
      }

      for (const spec of specifiers) {
        if (!isOxcNode(spec) || !isNodeRecord(spec)) {
          continue;
        }

        if (spec.type !== 'ExportSpecifier') {
          continue;
        }

        const local = spec.local;
        const exported = spec.exported;

        if (!isOxcNode(local) || local.type !== 'Identifier' || typeof local.name !== 'string') {
          continue;
        }

        if (!isOxcNode(exported) || exported.type !== 'Identifier' || typeof exported.name !== 'string') {
          continue;
        }

        out.set(local.name, exported.name);
      }

      continue;
    }

    if (stmt.type === 'ExportDefaultDeclaration') {
      continue;
    }
  }

  return out;
};

const createEmptyForwarding = (): ReadonlyArray<ForwardingFinding> => [];

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

    if (paramNode.type === 'ObjectPattern' && isNodeRecord(paramNode)) {
      const properties = paramNode.properties;

      if (!Array.isArray(properties)) {
        return null;
      }

      for (const prop of properties) {
        if (!isOxcNode(prop)) {
          return null;
        }

        if (prop.type === 'Property' && isNodeRecord(prop)) {
          const value = prop.value ?? prop.key;

          if (!isOxcNode(value) || value.type !== 'Identifier' || typeof value.name !== 'string') {
            return null;
          }

          params.push(value.name);

          continue;
        }

        if (prop.type === 'RestElement' && isNodeRecord(prop)) {
          const argument = prop.argument;

          if (!isOxcNode(argument) || argument.type !== 'Identifier' || typeof argument.name !== 'string') {
            return null;
          }

          restParam = argument.name;

          params.push(argument.name);

          continue;
        }

        return null;
      }

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

type CalleeRef =
  | { readonly kind: 'local'; readonly name: string }
  | { readonly kind: 'namespace'; readonly namespace: string; readonly name: string }
  | { readonly kind: 'this'; readonly name: string }
  | { readonly kind: 'unknown' };

const resolveCalleeRef = (callExpression: Node): CalleeRef => {
  if (!isNodeRecord(callExpression)) {
    return { kind: 'unknown' };
  }

  const callee = callExpression.callee;

  if (!isOxcNode(callee)) {
    return { kind: 'unknown' };
  }

  if (callee.type === 'Identifier' && 'name' in callee && typeof callee.name === 'string') {
    return { kind: 'local', name: callee.name };
  }

  if (callee.type === 'MemberExpression' && isNodeRecord(callee)) {
    const object = callee.object;
    const property = callee.property;

    if (isOxcNode(object) && object.type === 'ThisExpression' && isOxcNode(property) && property.type === 'Identifier') {
      return { kind: 'this', name: property.name };
    }

    if (isOxcNode(object) && object.type === 'Identifier' && typeof object.name === 'string') {
      if (isOxcNode(property) && property.type === 'Identifier' && typeof property.name === 'string') {
        return { kind: 'namespace', namespace: object.name, name: property.name };
      }
    }
  }

  return { kind: 'unknown' };
};

const resolveImportedTarget = (
  callee: CalleeRef,
  imports: Map<string, ImportBinding>,
): { readonly targetFilePath: string; readonly exportedName: string } | null => {
  if (callee.kind === 'local') {
    const binding = imports.get(callee.name);

    if (!binding) {
      return null;
    }

    if (binding.kind === 'named') {
      return { targetFilePath: binding.targetFilePath, exportedName: binding.importedName };
    }

    if (binding.kind === 'default') {
      return { targetFilePath: binding.targetFilePath, exportedName: 'default' };
    }

    return null;
  }

  if (callee.kind === 'namespace') {
    const binding = imports.get(callee.namespace);

    if (!binding || binding.kind !== 'namespace') {
      return null;
    }

    return { targetFilePath: binding.targetFilePath, exportedName: callee.name };
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

const analyzeForwarding = (files: ReadonlyArray<ParsedFile>, maxForwardDepth: number): ReadonlyArray<ForwardingFinding> => {
  if (files.length === 0) {
    return createEmptyForwarding();
  }

  const findings: ForwardingFinding[] = [];
  const fileMap = buildFileMap(files);

  type CrossFileWrapper = {
    node: Node;
    file: ParsedFile;
    header: string;
    depth: number;
    targetKey: string | null;
  };

  const crossFileWrappers = new Map<string, CrossFileWrapper>();

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    const normalizedFilePath = normalizePath(file.filePath);
    const namesByNode = collectFunctionNames(file.program);
    const calleeByName = new Map<string, string | null>();
    const wrapperNodeByName = new Map<string, Node>();
    const exportsByLocal = collectExportedNameByLocal(file.program as NodeValue);
    const importsByLocal = collectImportBindings(file.program as NodeValue, normalizedFilePath, fileMap);

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

        const exportedName = exportsByLocal.get(header);

        if (exportedName && exportedName.length > 0) {
          const calleeRef = resolveCalleeRef(wrapperCall);
          const importedTarget = resolveImportedTarget(calleeRef, importsByLocal);
          const targetKey = importedTarget ? `${importedTarget.targetFilePath}:${importedTarget.exportedName}` : null;
          const key = `${normalizedFilePath}:${exportedName}`;

          crossFileWrappers.set(key, {
            node,
            file,
            header,
            depth: 0,
            targetKey,
          });
        }
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

  // Pass 2: Resolve cross-file forwarding chains (fixpoint)
  if (crossFileWrappers.size > 0) {
    // Detect cycles in the forwarding graph to prevent inflated depth values.
    const inCycle = new Set<string>();

    for (const [key] of crossFileWrappers) {
      if (inCycle.has(key)) {
        continue;
      }

      const visited = new Set<string>();
      let cursor: string | null = key;

      while (cursor !== null && !visited.has(cursor)) {
        visited.add(cursor);

        const entry = crossFileWrappers.get(cursor);

        cursor = entry?.targetKey ?? null;
      }

      if (cursor !== null && visited.has(cursor)) {
        // Found a cycle — mark all nodes in the cycle.
        let mark: string | null = cursor;
        const cycleStart = cursor;

        do {
          if (mark !== null) {
            inCycle.add(mark);
          }

          const entryInCycle: CrossFileWrapper | undefined = mark !== null ? crossFileWrappers.get(mark) : undefined;

          mark = entryInCycle?.targetKey ?? null;
        } while (mark !== null && mark !== cycleStart);
      }
    }

    // Fixpoint iteration: only resolve non-cyclic entries.
    const maxIterations = crossFileWrappers.size + 1;

    for (let iter = 0; iter < maxIterations; iter += 1) {
      let changed = false;

      for (const [key, entry] of crossFileWrappers.entries()) {
        if (!entry.targetKey || inCycle.has(key)) {
          continue;
        }

        const next = crossFileWrappers.get(entry.targetKey);

        if (!next || inCycle.has(entry.targetKey)) {
          continue;
        }

        const candidate = 1 + next.depth;

        if (candidate > entry.depth) {
          entry.depth = candidate;
          changed = true;
        }
      }

      if (!changed) {
        break;
      }
    }

    for (const [key, entry] of crossFileWrappers.entries()) {
      if (inCycle.has(key)) {
        // Report circular forwarding as a distinct finding.
        const evidence = 'circular forwarding chain detected';

        addFinding(
          findings,
          'cross-file-forwarding-chain',
          entry.node,
          entry.file.filePath,
          entry.file.sourceText,
          entry.header,
          -1,
          evidence,
        );

        continue;
      }

      if (entry.depth < 2) {
        continue;
      }

      const evidence = `cross-file forwarding chain depth ${entry.depth}`;

      addFinding(
        findings,
        'cross-file-forwarding-chain',
        entry.node,
        entry.file.filePath,
        entry.file.sourceText,
        entry.header,
        entry.depth,
        evidence,
      );
    }
  }

  return findings;
};

export { analyzeForwarding, createEmptyForwarding };
