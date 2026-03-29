import type { Gildash } from '@zipbul/gildash';
import type { Node } from 'oxc-parser';

import { GildashError, normalizePath } from '@zipbul/gildash';
import * as path from 'node:path';

import type { ParsedFile } from '../../engine/types';
import type { IndirectionFinding, IndirectionFindingKind, IndirectionParamsInfo } from '../../types';

import { buildLineOffsets, getLineColumn } from '@zipbul/gildash';

import {
  getNodeHeader,
  isFunctionNode,
  isOxcNode,
  walkOxcTree,
  walkOxcTreeWithParent,
} from '../../engine/ast/oxc-ast-utils';

/* ------------------------------------------------------------------ */
/*  Path utilities                                                     */
/* ------------------------------------------------------------------ */

/** Ensure a path from gildash (may be project-relative) is absolute. */
const resolveAbs = (rootAbs: string, p: string): string => normalizePath(path.isAbsolute(p) ? p : path.resolve(rootAbs, p));

/* ------------------------------------------------------------------ */
/*  AST utilities — thin-wrapper detection                             */
/* ------------------------------------------------------------------ */

const createEmptyIndirection = (): ReadonlyArray<IndirectionFinding> => [];

const getSpan = (node: Node, sourceText: string) => {
  const offsets = buildLineOffsets(sourceText);

  return {
    start: getLineColumn(offsets, node.start),
    end: getLineColumn(offsets, node.end),
  };
};

const getAwaitedCallExpression = (node: Node): Node | null => {
  if (node.type !== 'AwaitExpression') {
    return null;
  }

  const argument = node.argument;

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
  if (statement.type === 'ReturnStatement') {
    const argument = statement.argument;

    if (!argument) {
      return null;
    }

    return getCallFromExpression(argument);
  }

  if (statement.type === 'ExpressionStatement') {
    return getCallFromExpression(statement.expression);
  }

  return null;
};

const getParams = (node: Node): IndirectionParamsInfo | null => {
  const rec = node as unknown as Record<string, unknown>;
  const paramsValue = rec.params;

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

    if (paramNode.type === 'ObjectPattern') {
      const properties = paramNode.properties;

      for (const prop of properties) {
        if (prop.type === 'Property') {
          const propRec = prop as unknown as Record<string, unknown>;
          const value = (propRec.value ?? propRec.key) as Node | undefined;

          if (!isOxcNode(value) || value.type !== 'Identifier') {
            return null;
          }

          params.push(value.name);

          continue;
        }

        if (prop.type === 'RestElement') {
          const restRec = prop as unknown as Record<string, unknown>;
          const argument = restRec.argument as Node;

          if (argument.type !== 'Identifier') {
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

    if (paramNode.type === 'RestElement') {
      const argument = paramNode.argument;

      if (argument.type === 'Identifier') {
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

const isPassthroughArgs = (callExpression: Node, params: readonly string[], restParam: string | null): boolean => {
  const rec = callExpression as unknown as Record<string, unknown>;
  const args = rec.arguments;

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
      if (arg.type !== 'SpreadElement') {
        return false;
      }

      const spreadArg = arg.argument;

      if (spreadArg.type !== 'Identifier' || spreadArg.name !== restParam) {
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

  const nodeRec = node as unknown as Record<string, unknown>;
  const body = nodeRec.body;

  if (!isOxcNode(body)) {
    return null;
  }

  const maybeCall =
    body.type === 'BlockStatement'
      ? (() => {
          const statements = body.body;

          if (statements.length !== 1) {
            return null;
          }

          const statement = statements[0];

          if (!statement) {
            return null;
          }

          return getCallFromStatement(statement);
        })()
      : getCallFromExpression(body);

  if (!maybeCall) {
    return null;
  }

  if (!isPassthroughArgs(maybeCall, paramsInfo.params, paramsInfo.restParam)) {
    return null;
  }

  return maybeCall;
};

const resolveCalleeName = (callExpression: Node): string | null => {
  const rec = callExpression as unknown as Record<string, unknown>;
  const callee = rec.callee;

  if (!isOxcNode(callee)) {
    return null;
  }

  if (callee.type === 'Identifier') {
    return callee.name;
  }

  if (callee.type === 'MemberExpression') {
    const object = callee.object;
    const property = callee.property;

    if (object.type === 'ThisExpression' && property.type === 'Identifier') {
      return property.name;
    }
  }

  return null;
};

/** Structured callee reference for cross-file import resolution via gildash. */
interface LocalCalleeRef {
  readonly kind: 'local';
  readonly name: string;
}

interface NamespaceCalleeRef {
  readonly kind: 'namespace';
  readonly ns: string;
  readonly name: string;
}

type SimpleCalleeRef = LocalCalleeRef | NamespaceCalleeRef;

const getSimpleCalleeRef = (callExpression: Node): SimpleCalleeRef | null => {
  const rec = callExpression as unknown as Record<string, unknown>;
  const callee = rec.callee;

  if (!isOxcNode(callee)) {
    return null;
  }

  if (callee.type === 'Identifier') {
    return { kind: 'local', name: callee.name };
  }

  if (callee.type === 'MemberExpression') {
    const object = callee.object;
    const property = callee.property;

    if (object.type === 'Identifier' && property.type === 'Identifier') {
      return { kind: 'namespace', ns: object.name, name: property.name };
    }
  }

  return null;
};

/* ------------------------------------------------------------------ */
/*  Function name collection                                           */
/* ------------------------------------------------------------------ */

interface CollectedFunctionNames {
  readonly namesByNode: Map<Node, string>;
  readonly methodNodes: Set<Node>;
}

const collectFunctionNames = (program: Node): CollectedFunctionNames => {
  const namesByNode = new Map<Node, string>();
  const methodNodes = new Set<Node>();

  walkOxcTree(program, node => {
    if (node.type === 'FunctionDeclaration') {
      const idNode = node.id;

      if (idNode !== null) {
        namesByNode.set(node, idNode.name);
      }

      return true;
    }

    if (node.type === 'VariableDeclarator') {
      const idNode = node.id;
      const initNode = node.init;

      if (idNode.type === 'Identifier' && initNode !== null && isFunctionNode(initNode)) {
        namesByNode.set(initNode, idNode.name);
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
          methodNodes.add(valueNode);
        }
      }

      return true;
    }

    return true;
  });

  return { namesByNode, methodNodes };
};

const addFinding = (
  findings: IndirectionFinding[],
  kind: IndirectionFindingKind,
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

const buildImportIndex = (gildash: Gildash, rootAbs: string): Map<string, Map<string, ImportTarget>> => {
  let importRels: ReturnType<Gildash['searchRelations']>;

  try {
    importRels = gildash.searchRelations({ type: 'imports' });
  } catch (e) {
    if (e instanceof GildashError) {
      return new Map();
    }
    throw e;
  }

  const index = new Map<string, Map<string, ImportTarget>>();

  for (const rel of importRels) {
    const srcFile = resolveAbs(rootAbs, rel.srcFilePath);
    const fileImports = index.get(srcFile) ?? new Map<string, ImportTarget>();

    if (rel.srcSymbolName && rel.dstFilePath !== null) {
      fileImports.set(rel.srcSymbolName, {
        targetFilePath: resolveAbs(rootAbs, rel.dstFilePath),
        exportedName: rel.dstSymbolName ?? null,
      });
    }

    index.set(srcFile, fileImports);
  }

  return index;
};

const buildExportIndex = (gildash: Gildash, rootAbs: string): Map<string, Set<string>> => {
  let allExported: ReturnType<Gildash['searchSymbols']>;

  try {
    allExported = gildash.searchSymbols({ isExported: true });
  } catch (e) {
    if (e instanceof GildashError) {
      return new Map();
    }
    throw e;
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

interface CrossFileTarget {
  readonly targetFilePath: string;
  readonly exportedName: string;
}

const resolveCrossFileTarget = (
  ref: SimpleCalleeRef,
  srcFilePath: string,
  importIdx: Map<string, Map<string, ImportTarget>>,
  gildash: Gildash,
  rootAbs: string,
): CrossFileTarget | null => {
  const fileImports = importIdx.get(srcFilePath);

  if (!fileImports) {
    return null;
  }

  let targetFilePath: string;
  let exportedName: string;

  if (ref.kind === 'local') {
    const imp = fileImports.get(ref.name);

    if (!imp || imp.exportedName === null) {
      return null;
    }

    targetFilePath = imp.targetFilePath;
    exportedName = imp.exportedName;
  } else if (ref.kind === 'namespace') {
    const imp = fileImports.get(ref.ns);

    if (!imp) {
      return null;
    }

    targetFilePath = imp.targetFilePath;
    exportedName = ref.name;
  } else {
    return null;
  }

  // Follow re-export chain to find the original definition
  try {
    const relTargetPath = path.relative(rootAbs, targetFilePath);
    const resolved = gildash.resolveSymbol(exportedName, relTargetPath);

    return {
      targetFilePath: resolveAbs(rootAbs, resolved.originalFilePath),
      exportedName: resolved.originalName,
    };
  } catch {
    // resolveSymbol 실패 시 single-hop 결과 반환
    return { targetFilePath, exportedName };
  }
};

interface FileOverloads {
  readonly functions: Set<string>;
  readonly methods: Set<string>;
}

const emptyOverloads: FileOverloads = { functions: new Set(), methods: new Set() };

/**
 * Build a set of overloaded function/method names per file.
 * A name is overloaded if gildash indexes 2+ symbols with the same name in the same file.
 * Functions and methods are tracked separately to avoid false collisions.
 */
const buildOverloadIndex = (gildash: Gildash, rootAbs: string): Map<string, FileOverloads> => {
  let allSymbols: ReturnType<Gildash['searchSymbols']>;

  try {
    allSymbols = gildash.searchSymbols({});
  } catch (e) {
    if (e instanceof GildashError) {
      return new Map();
    }
    throw e;
  }

  // Count by qualified name (sym.name) to correctly group overloads.
  // Store kind and AST-matching key (memberName ?? name) for the final sets.
  const counts = new Map<string, Map<string, { count: number; astKey: string; kind: 'function' | 'method' }>>();

  for (const sym of allSymbols) {
    if (sym.kind !== 'function' && sym.kind !== 'method') {
      continue;
    }

    const absFile = resolveAbs(rootAbs, sym.filePath);
    const fileCounts = counts.get(absFile) ?? new Map<string, { count: number; astKey: string; kind: 'function' | 'method' }>();
    const existing = fileCounts.get(sym.name);
    const astKey = sym.memberName ?? sym.name;

    fileCounts.set(sym.name, { count: (existing?.count ?? 0) + 1, astKey, kind: sym.kind });
    counts.set(absFile, fileCounts);
  }

  // Convert to separate sets for functions and methods
  const index = new Map<string, FileOverloads>();

  for (const [file, fileCounts] of counts) {
    const functions = new Set<string>();
    const methods = new Set<string>();

    for (const [, { count, astKey, kind }] of fileCounts) {
      if (count > 1) {
        if (kind === 'function') {
          functions.add(astKey);
        } else {
          methods.add(astKey);
        }
      }
    }

    if (functions.size > 0 || methods.size > 0) {
      index.set(file, { functions, methods });
    }
  }

  return index;
};

/* ------------------------------------------------------------------ */
/*  Main analysis                                                      */
/* ------------------------------------------------------------------ */

interface AnalyzeIndirectionOptions {
  readonly maxForwardDepth: number;
  readonly crossFileMinDepth: number;
}

interface CrossFileWrapper {
  node: Node;
  file: ParsedFile;
  header: string;
  depth: number;
  targetKey: string | null;
}

const analyzeIndirection = async (
  gildash: Gildash,
  files: ReadonlyArray<ParsedFile>,
  options: AnalyzeIndirectionOptions,
  rootAbs: string,
): Promise<ReadonlyArray<IndirectionFinding>> => {
  if (files.length === 0) {
    return createEmptyIndirection();
  }

  const findings: IndirectionFinding[] = [];
  // Build import/export/overload indices from gildash
  const importIdx = buildImportIndex(gildash, rootAbs);
  const exportIdx = buildExportIndex(gildash, rootAbs);
  const overloadIdx = buildOverloadIndex(gildash, rootAbs);

  const crossFileWrappers = new Map<string, CrossFileWrapper>();

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    const normalizedFilePath = normalizePath(file.filePath);
    const { namesByNode, methodNodes } = collectFunctionNames(file.program);
    const calleeByName = new Map<string, string | null>();
    const wrapperNodeByName = new Map<string, Node>();
    const fileExports = exportIdx.get(normalizedFilePath) ?? new Set<string>();
    const fileOverloads = overloadIdx.get(normalizedFilePath) ?? emptyOverloads;

    walkOxcTree(file.program, node => {
      if (!isFunctionNode(node)) {
        return true;
      }

      const wrapperCall = getWrapperCall(node);

      if (!wrapperCall) {
        return true;
      }

      const header = namesByNode.get(node) ?? getNodeHeader(node);

      // Overloaded functions provide type narrowing — not simple indirection
      const overloadSet = methodNodes.has(node) ? fileOverloads.methods : fileOverloads.functions;

      if (overloadSet.has(header)) {
        return true;
      }

      // Decorator check: functions with decorators indicate intentional wrapping — skip
      try {
        const detail = gildash.getFullSymbol(header, file.filePath);

        if (detail !== null && Array.isArray(detail.decorators) && detail.decorators.length > 0) {
          return true;
        }
      } catch {
        // Semantic layer unavailable — keep existing thin-wrapper behavior
      }

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
            ? resolveCrossFileTarget(calleeRef, normalizedFilePath, importIdx, gildash, rootAbs)
            : null;
          const targetKey = crossTarget ? `${crossTarget.targetFilePath}:${crossTarget.exportedName}` : null;
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

    if (options.maxForwardDepth >= 1) {
      for (const [name, node] of wrapperNodeByName.entries()) {
        const depth = computeChainDepth(name, calleeByName, new Set<string>());

        if (depth > options.maxForwardDepth) {
          const evidence = `forwarding chain depth ${depth} exceeds max ${options.maxForwardDepth}`;
          const header = namesByNode.get(node) ?? getNodeHeader(node);

          addFinding(findings, 'forward-chain', node, file.filePath, file.sourceText, header, depth, evidence);
        }
      }
    }

    // Skip .d.ts files for type-level indirection checks
    if (normalizedFilePath.endsWith('.d.ts')) {
      continue;
    }

    // type-remap: type A = B (pure synonym, no type args, no type params)
    walkOxcTree(file.program, node => {
      if (node.type === 'TSTypeAliasDeclaration' && node.declare !== true) {
        const typeAnnotation = node.typeAnnotation;

        if (typeAnnotation.type === 'TSTypeReference') {
          const typeArgs = typeAnnotation.typeArguments;
          const typeParams = node.typeParameters;
          const hasTypeArgs = typeArgs !== null;
          const hasTypeParams = typeParams !== null;

          if (!hasTypeArgs && !hasTypeParams) {
            const header = node.id.name;
            const typeName = typeAnnotation.typeName;
            let targetName = 'unknown';

            if (typeName.type === 'Identifier') {
              targetName = typeName.name;
            } else if (typeName.type === 'TSQualifiedName') {
              targetName = getNodeHeader(typeName);
            }

            const evidence = `type alias ${header} is a direct synonym for ${targetName}`;

            addFinding(findings, 'type-remap', node, file.filePath, file.sourceText, header, 1, evidence);
          } else {
            // Semantic verification: complex aliases (with type args/params) may still be structurally equivalent
            // e.g. type A = Readonly<B> where B is already fully readonly — bidirectional assignability confirms equivalence
            const aliasHeader = node.id.name;
            const typeName = typeAnnotation.typeName;
            let targetTypeName: string | null = null;

            if (typeName.type === 'Identifier') {
              targetTypeName = typeName.name;
            } else if (typeName.type === 'TSQualifiedName') {
              targetTypeName = getNodeHeader(typeName);
            }

            if (targetTypeName !== null) {
              try {
                const fwd = gildash.isTypeAssignableTo(aliasHeader, file.filePath, targetTypeName, file.filePath);
                const bwd = gildash.isTypeAssignableTo(targetTypeName, file.filePath, aliasHeader, file.filePath);

                if (fwd === true && bwd === true) {
                  const evidence = `type alias ${aliasHeader} is structurally equivalent to ${targetTypeName}`;

                  addFinding(findings, 'type-remap', node, file.filePath, file.sourceText, aliasHeader, 1, evidence);
                }
              } catch {
                // Semantic layer unavailable — skip this check
              }
            }
          }
        }
      }

      return true;
    });

    // interface-rewrap: empty interface with at least one extends (not declare, not module augmentation, not declaration merging)
    // Count same-name declarations for merging detection: interface+interface AND class+interface merging
    const declarationNameCount = new Map<string, number>();

    walkOxcTree(file.program, node => {
      if (node.type === 'TSInterfaceDeclaration') {
        const name = node.id.name;

        declarationNameCount.set(name, (declarationNameCount.get(name) ?? 0) + 1);
      } else if (node.type === 'ClassDeclaration') {
        const id = node.id;

        if (id !== null) {
          declarationNameCount.set(id.name, (declarationNameCount.get(id.name) ?? 0) + 1);
        }
      }

      return true;
    });

    walkOxcTreeWithParent(file.program, (node, parent) => {
      if (node.type === 'TSInterfaceDeclaration' && node.declare !== true) {
        const extendsArr = node.extends;

        if (extendsArr.length === 0) {
          return true;
        }

        const bodyBody = node.body.body;

        if (bodyBody.length > 0) {
          return true;
        }

        // Skip module augmentation (parent is TSModuleBlock)
        if (parent !== null && parent.type === 'TSModuleBlock') {
          return true;
        }

        const name = node.id.name;

        // Skip same-file declaration merging (interface+interface or class+interface)
        if ((declarationNameCount.get(name) ?? 0) >= 2) {
          return true;
        }

        // Skip cross-file declaration merging
        try {
          const symbols = gildash.searchSymbols({ text: name, limit: 100 });
          const otherFileHasSameName = symbols.some(
            s => s.name === name && resolveAbs(rootAbs, s.filePath) !== normalizedFilePath,
          );

          if (otherFileHasSameName) {
            return true;
          }
        } catch {
          // gildash failure: conservative — do not skip
        }

        const firstExtends = extendsArr[0];

        if (!firstExtends) {
          return true;
        }

        const baseName = getNodeHeader(firstExtends);
        const evidence = `interface ${name} extends ${baseName} with empty body`;

        addFinding(findings, 'interface-rewrap', node, file.filePath, file.sourceText, name, 1, evidence);
      }

      return true;
    });
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

      if (entry.depth < options.crossFileMinDepth) {
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

export { analyzeIndirection, createEmptyIndirection };
