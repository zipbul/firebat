import type { Gildash } from '@zipbul/gildash';
import type { Function as OxcFunction, Node, Program } from 'oxc-parser';

import { GildashError, normalizePath } from '@zipbul/gildash';
import * as path from 'node:path';
import { Visitor } from 'oxc-parser';

import type { ParsedFile } from '../../engine/types';
import type { IndirectionFinding, IndirectionFindingKind, IndirectionParamsInfo } from '../../types';

import { getMemberPropertyName, getNodeHeader, isFunctionNode, isOxcNode, walkOxcTreeWithParent } from '../../engine/ast/oxc-ast-utils';
import { spanOfNode } from '../../engine/ast/source-span';
import { addToSetMap } from '../../shared/multi-map';
import { resolveAbs } from '../../shared/path-resolve';

/* ------------------------------------------------------------------ */
/*  AST utilities — thin-wrapper detection                             */
/* ------------------------------------------------------------------ */

/**
 * Higher-order array/promise methods that pass extra arguments to their callback.
 * Inlining `xs.map(x => f(x))` → `xs.map(f)` is unsafe because `.map` passes
 * (item, index, array) — semantics differ when `f` has its own parameter handling
 * (e.g. `parseInt`). Same risk applies to .forEach/.filter/.reduce/.find/.some/.every,
 * Promise.{then,catch,finally}, etc.
 */
const ARITY_SENSITIVE_HIGH_ORDER_METHODS = new Set<string>([
  'forEach',
  'map',
  'filter',
  'reduce',
  'reduceRight',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'some',
  'every',
  'flatMap',
  'sort',
  'then',
  'catch',
  'finally',
]);

/**
 * Collect arrow function nodes that are direct arguments to a high-order method
 * call (e.g. the arrow in `xs.map(x => f(x))`). These are arity-protective: inlining
 * them changes call semantics, so they should NOT be flagged as thin wrappers.
 */
const collectArityProtectiveArrows = (program: Node): Set<number> => {
  const arrowStarts = new Set<number>();

  walkOxcTreeWithParent(program, (node, parent) => {
    if (
      node.type !== 'ArrowFunctionExpression' ||
      parent === null ||
      parent.type !== 'CallExpression' ||
      !Array.isArray(parent.arguments) ||
      !parent.arguments.includes(node)
    ) {
      return true;
    }

    const callee = parent.callee;

    if (callee.type !== 'MemberExpression') {
      return true;
    }

    const methodName = getMemberPropertyName(callee);

    if (methodName !== null && ARITY_SENSITIVE_HIGH_ORDER_METHODS.has(methodName)) {
      arrowStarts.add(node.start);
    }

    return true;
  });

  return arrowStarts;
};

const createEmptyIndirection = (): ReadonlyArray<IndirectionFinding> => [];

const getAwaitedCallExpression = (node: Node): Node | null => {
  if (node.type !== 'AwaitExpression') {
    return null;
  }

  const argument = node.argument;

  if (argument.type === 'CallExpression') {
    return argument;
  }

  // `await fn?.(args)` — unwrap ChainExpression to expose the optional CallExpression.
  if (argument.type === 'ChainExpression') {
    const inner = argument.expression;

    if (inner.type === 'CallExpression') {
      return inner;
    }
  }

  return null;
};

const getCallExpression = (node: Node): Node | null => {
  if (node.type === 'CallExpression') {
    return node;
  }

  // Optional calls (`fn?.(args)`) are wrapped in a ChainExpression. Unwrap to expose
  // the inner CallExpression so optional-call wrappers are detected like plain ones.
  if (node.type === 'ChainExpression') {
    const inner = node.expression;

    if (inner.type === 'CallExpression') {
      return inner;
    }
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

const getFunctionParams = (node: Node): ReadonlyArray<Node> | null => {
  const params = (node as OxcFunction).params;

  if (!Array.isArray(params)) {
    return null;
  }

  return params as ReadonlyArray<Node>;
};

const getParams = (node: Node): IndirectionParamsInfo | null => {
  const paramsValue = getFunctionParams(node);

  if (paramsValue === null) {
    return null;
  }

  const params: string[] = [];
  let restParam: string | null = null;

  for (const paramNode of paramsValue) {
    if (paramNode.type === 'Identifier' && 'name' in paramNode && typeof paramNode.name === 'string') {
      params.push(paramNode.name);

      continue;
    }

    if (paramNode.type === 'ObjectPattern') {
      const properties = paramNode.properties;

      for (const prop of properties) {
        if (prop.type === 'Property') {
          if (prop.value.type !== 'Identifier') {
            return null;
          }

          params.push(prop.value.name);

          continue;
        }

        if (prop.type === 'RestElement') {
          const argument = prop.argument;

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

      if (argument.type !== 'Identifier') {
        return null;
      }

      restParam = argument.name;

      params.push(argument.name);

      continue;
    }

    return null;
  }

  return {
    params,
    restParam,
  };
};

const isPassthroughArgs = (callExpression: Node, params: readonly string[], restParam: string | null): boolean => {
  if (callExpression.type !== 'CallExpression') {
    return false;
  }

  const args = callExpression.arguments;

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

  const body: Node | null = (node as OxcFunction).body;

  if (body === null) {
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
  if (callExpression.type !== 'CallExpression') {
    return null;
  }

  const callee = callExpression.callee;

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
  if (callExpression.type !== 'CallExpression') {
    return null;
  }

  const callee = callExpression.callee;

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

const collectFunctionNames = (program: Program): CollectedFunctionNames => {
  const namesByNode = new Map<Node, string>();
  const methodNodes = new Set<Node>();

  new Visitor({
    FunctionDeclaration(node) {
      const idNode = node.id;

      if (idNode !== null) {
        namesByNode.set(node, idNode.name);
      }
    },

    VariableDeclarator(node) {
      const idNode = node.id;
      const initNode = node.init;

      if (idNode.type !== 'Identifier' || initNode === null || !isFunctionNode(initNode)) {
        return;
      }

      namesByNode.set(initNode, idNode.name);
    },

    Property(node) {
      const valueNode = node.value;

      if (!isFunctionNode(valueNode)) {
        return;
      }

      const header = getNodeHeader(node);

      if (header.length > 0 && header !== 'anonymous') {
        namesByNode.set(valueNode, header);
      }
    },

    MethodDefinition(node) {
      const valueNode = node.value;
      const header = getNodeHeader(node);

      if (header.length === 0 || header === 'anonymous') {
        return;
      }

      namesByNode.set(valueNode, header);
      methodNodes.add(valueNode);
    },
  }).visit(program);

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
    span: spanOfNode(node, sourceText),
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

    addToSetMap(index, absFile, sym.name);
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
      if (count <= 1) {
        continue;
      }

      if (kind === 'function') {
        functions.add(astKey);
      } else {
        methods.add(astKey);
      }
    }

    if (functions.size === 0 && methods.size === 0) {
      continue;
    }

    index.set(file, { functions, methods });
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

/**
 * Resolve a `TSTypeReference` type name to a readable string:
 * an `Identifier` yields its name, a `TSQualifiedName` its dotted header.
 * Returns null for any other shape. Single change-point for type-remap targets.
 */
const resolveTypeReferenceName = (typeName: Node): string | null => {
  if (typeName.type === 'Identifier') {
    return typeName.name;
  }

  if (typeName.type === 'TSQualifiedName') {
    return getNodeHeader(typeName);
  }

  return null;
};

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
    const arityProtectiveArrowStarts = collectArityProtectiveArrows(file.program);

    const handleThinWrapper = (node: Node): void => {
      // Skip arrow callbacks to .map/.filter/.then/etc. — inlining them is unsafe
      // because the higher-order method passes extra arguments.
      if (node.type === 'ArrowFunctionExpression' && arityProtectiveArrowStarts.has(node.start)) {
        return;
      }

      const wrapperCall = getWrapperCall(node);

      if (!wrapperCall) {
        return;
      }

      const header = namesByNode.get(node) ?? getNodeHeader(node);
      // Overloaded functions provide type narrowing — not simple indirection
      const overloadSet = methodNodes.has(node) ? fileOverloads.methods : fileOverloads.functions;

      if (overloadSet.has(header)) {
        return;
      }

      // Symbol-level filters: decorator (intentional wrapper), override modifier
      // (explicit base-class method forward — semantic, not indirection).
      // `decorators` is lifted onto FullSymbol; `modifiers` lives on the nested
      // SymbolDetail (FullSymbol.detail).
      try {
        const symbol = gildash.getFullSymbol(header, file.filePath);

        if (symbol !== null) {
          if (Array.isArray(symbol.decorators) && symbol.decorators.length > 0) {
            return;
          }

          const modifiers = symbol.detail.modifiers;

          if (Array.isArray(modifiers) && modifiers.includes('override')) {
            return;
          }
        }
      } catch (e) {
        if (!(e instanceof GildashError)) {
          throw e;
        }
        // Semantic layer unavailable — keep existing thin-wrapper behavior
      }

      const calleeName = resolveCalleeName(wrapperCall);
      const evidence = `thin wrapper forwards to ${calleeName ?? 'call'}`;

      addFinding(findings, 'thin-wrapper', node, file.filePath, file.sourceText, header, 1, evidence);

      if (header.length === 0 || header === 'anonymous') {
        return;
      }

      calleeByName.set(header, calleeName);
      wrapperNodeByName.set(header, node);

      // Cross-file: only track exported functions
      if (!fileExports.has(header)) {
        return;
      }

      const calleeRef = getSimpleCalleeRef(wrapperCall);
      const crossTarget = calleeRef ? resolveCrossFileTarget(calleeRef, normalizedFilePath, importIdx, gildash, rootAbs) : null;
      const targetKey = crossTarget ? `${crossTarget.targetFilePath}:${crossTarget.exportedName}` : null;
      const key = `${normalizedFilePath}:${header}`;

      crossFileWrappers.set(key, {
        node,
        file,
        header,
        depth: 0,
        targetKey,
      });
    };

    new Visitor({
      FunctionDeclaration: handleThinWrapper,
      FunctionExpression: handleThinWrapper,
      ArrowFunctionExpression: handleThinWrapper,
    }).visit(file.program);

    if (options.maxForwardDepth >= 1) {
      for (const [name, node] of wrapperNodeByName.entries()) {
        const depth = computeChainDepth(name, calleeByName, new Set<string>());

        if (depth <= options.maxForwardDepth) {
          continue;
        }

        const evidence = `forwarding chain depth ${depth} exceeds max ${options.maxForwardDepth}`;
        const header = namesByNode.get(node) ?? getNodeHeader(node);

        addFinding(findings, 'forward-chain', node, file.filePath, file.sourceText, header, depth, evidence);
      }
    }

    // Skip .d.ts files for type-level indirection checks
    if (normalizedFilePath.endsWith('.d.ts')) {
      continue;
    }

    // type-remap: type A = B (pure synonym, no type args, no type params)
    new Visitor({
      TSTypeAliasDeclaration(node) {
        if (node.declare === true) {
          return;
        }

        const typeAnnotation = node.typeAnnotation;

        if (typeAnnotation.type !== 'TSTypeReference') {
          return;
        }

        const typeArgs = typeAnnotation.typeArguments;
        const typeParams = node.typeParameters;

        if (typeArgs === null && typeParams === null) {
          const header = node.id.name;
          const targetName = resolveTypeReferenceName(typeAnnotation.typeName) ?? 'unknown';
          const evidence = `type alias ${header} is a direct synonym for ${targetName}`;

          addFinding(findings, 'type-remap', node, file.filePath, file.sourceText, header, 1, evidence);
        } else {
          // Semantic verification: complex aliases (with type args/params) may still be structurally equivalent
          // e.g. type A = Readonly<B> where B is already fully readonly — bidirectional assignability confirms equivalence
          const aliasHeader = node.id.name;
          const targetTypeName = resolveTypeReferenceName(typeAnnotation.typeName);

          if (targetTypeName === null) {
            return;
          }

          try {
            const fwd = gildash.isTypeAssignableTo(aliasHeader, file.filePath, targetTypeName, file.filePath);

            if (fwd !== true) {
              return;
            }

            const bwd = gildash.isTypeAssignableTo(targetTypeName, file.filePath, aliasHeader, file.filePath);

            if (bwd !== true) {
              return;
            }

            const evidence = `type alias ${aliasHeader} is structurally equivalent to ${targetTypeName}`;

            addFinding(findings, 'type-remap', node, file.filePath, file.sourceText, aliasHeader, 1, evidence);
          } catch (e) {
            if (!(e instanceof GildashError)) {
              throw e;
            }
            // Semantic layer unavailable — skip this check
          }
        }
      },
    }).visit(file.program);

    // interface-rewrap: empty interface with at least one extends (not declare, not module augmentation, not declaration merging)
    // Count same-name declarations for merging detection: interface+interface AND class+interface merging
    const declarationNameCount = new Map<string, number>();

    new Visitor({
      TSInterfaceDeclaration(node) {
        const name = node.id.name;

        declarationNameCount.set(name, (declarationNameCount.get(name) ?? 0) + 1);
      },
      ClassDeclaration(node) {
        const id = node.id;

        if (id !== null) {
          declarationNameCount.set(id.name, (declarationNameCount.get(id.name) ?? 0) + 1);
        }
      },
    }).visit(file.program);

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
          const symbols = gildash.searchSymbols({ text: name, exact: true });
          const otherFileHasSameName = symbols.some(s => resolveAbs(rootAbs, s.filePath) !== normalizedFilePath);

          if (otherFileHasSameName) {
            return true;
          }
        } catch (e) {
          if (!(e instanceof GildashError)) {
            throw e;
          }
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
