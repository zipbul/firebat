import type { Node } from 'oxc-parser';

import * as path from 'node:path';

import type { Gildash } from '@zipbul/gildash';
import { isErr } from '@zipbul/result';

import type { NodeRecord, NodeValue, ParsedFile } from '../../engine/types';
import type { ForwardingFinding, ForwardingFindingKind, ForwardingParamsInfo } from '../../types';

import { getNodeHeader, isFunctionNode, isNodeRecord, isOxcNode, isOxcNodeArray, walkOxcTree } from '../../engine/ast/oxc-ast-utils';
import { getLineColumn } from '../../engine/source-position';

/* ------------------------------------------------------------------ */
/*  Path utilities                                                     */
/* ------------------------------------------------------------------ */

const normalizePath = (value: string): string => value.replaceAll('\\', '/');

/** Ensure a path from gildash (may be project-relative) is absolute. */
const resolveAbs = (rootAbs: string, p: string): string =>
  normalizePath(path.isAbsolute(p) ? p : path.resolve(rootAbs, p));

/* ------------------------------------------------------------------ */
/*  AST utilities — thin-wrapper detection                             */
/* ------------------------------------------------------------------ */

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

/** Structured callee reference for cross-file import resolution via gildash. */
type SimpleCalleeRef =
  | { readonly kind: 'local'; readonly name: string }
  | { readonly kind: 'namespace'; readonly ns: string; readonly name: string };

const getSimpleCalleeRef = (callExpression: Node): SimpleCalleeRef | null => {
  if (!isNodeRecord(callExpression)) {
    return null;
  }

  const callee = callExpression.callee;

  if (!isOxcNode(callee)) {
    return null;
  }

  if (callee.type === 'Identifier' && typeof callee.name === 'string') {
    return { kind: 'local', name: callee.name };
  }

  if (callee.type === 'MemberExpression' && isNodeRecord(callee)) {
    const object = callee.object;
    const property = callee.property;

    if (
      isOxcNode(object) &&
      object.type === 'Identifier' &&
      typeof object.name === 'string' &&
      isOxcNode(property) &&
      property.type === 'Identifier' &&
      typeof property.name === 'string'
    ) {
      return { kind: 'namespace', ns: object.name, name: property.name };
    }
  }

  return null;
};

/* ------------------------------------------------------------------ */
/*  Function name collection                                           */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Import / export indices from gildash                               */
/* ------------------------------------------------------------------ */

interface ImportTarget {
  readonly targetFilePath: string;
  readonly exportedName: string | null;
}

const buildImportIndex = (
  gildash: Gildash,
  rootAbs: string,
): Map<string, Map<string, ImportTarget>> => {
  const importRels = gildash.searchRelations({ type: 'imports', limit: 100_000 });

  if (isErr(importRels)) {
    return new Map();
  }

  const index = new Map<string, Map<string, ImportTarget>>();

  for (const rel of importRels) {
    const srcFile = resolveAbs(rootAbs, rel.srcFilePath);
    const fileImports = index.get(srcFile) ?? new Map<string, ImportTarget>();

    if (rel.srcSymbolName) {
      fileImports.set(rel.srcSymbolName, {
        targetFilePath: resolveAbs(rootAbs, rel.dstFilePath),
        exportedName: rel.dstSymbolName ?? null,
      });
    }

    index.set(srcFile, fileImports);
  }

  return index;
};

const buildExportIndex = (
  gildash: Gildash,
  rootAbs: string,
): Map<string, Set<string>> => {
  const allExported = gildash.searchSymbols({ isExported: true, limit: 100_000 });

  if (isErr(allExported)) {
    return new Map();
  }

  const index = new Map<string, Set<string>>();

  for (const sym of allExported) {
    const absFile = resolveAbs(rootAbs, sym.filePath);
    const names = index.get(absFile) ?? new Set<string>();

    names.add(sym.name);
    index.set(absFile, names);
  }

  return index;
};

const resolveCrossFileTarget = (
  ref: SimpleCalleeRef,
  srcFilePath: string,
  importIdx: Map<string, Map<string, ImportTarget>>,
): { readonly targetFilePath: string; readonly exportedName: string } | null => {
  const fileImports = importIdx.get(srcFilePath);

  if (!fileImports) {
    return null;
  }

  if (ref.kind === 'local') {
    const imp = fileImports.get(ref.name);

    if (!imp || imp.exportedName === null) {
      return null;
    }

    return { targetFilePath: imp.targetFilePath, exportedName: imp.exportedName };
  }

  if (ref.kind === 'namespace') {
    const imp = fileImports.get(ref.ns);

    if (!imp) {
      return null;
    }

    return { targetFilePath: imp.targetFilePath, exportedName: ref.name };
  }

  return null;
};

/* ------------------------------------------------------------------ */
/*  Main analysis                                                      */
/* ------------------------------------------------------------------ */

const analyzeForwarding = async (
  gildash: Gildash,
  files: ReadonlyArray<ParsedFile>,
  maxForwardDepth: number,
  rootAbs: string,
): Promise<ReadonlyArray<ForwardingFinding>> => {
  if (files.length === 0) {
    return createEmptyForwarding();
  }

  const findings: ForwardingFinding[] = [];

  // Build import/export indices from gildash for cross-file resolution
  const importIdx = buildImportIndex(gildash, rootAbs);
  const exportIdx = buildExportIndex(gildash, rootAbs);

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
    const fileExports = exportIdx.get(normalizedFilePath) ?? new Set<string>();

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

        // Cross-file: only track exported functions
        if (fileExports.has(header)) {
          const calleeRef = getSimpleCalleeRef(wrapperCall);
          const crossTarget = calleeRef
            ? resolveCrossFileTarget(calleeRef, normalizedFilePath, importIdx)
            : null;
          const targetKey = crossTarget
            ? `${crossTarget.targetFilePath}:${crossTarget.exportedName}`
            : null;
          const key = `${normalizedFilePath}:${header}`;

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
