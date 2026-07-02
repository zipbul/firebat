import type { Gildash } from '@zipbul/gildash';
import type { Function as OxcFunction, Node, Program } from 'oxc-parser';

import { GildashError, normalizePath } from '@zipbul/gildash';
import * as path from 'node:path';
import { Visitor } from 'oxc-parser';

import type { ParsedFile } from '../../engine/types';
import type { IndirectionFinding, IndirectionFindingKind, IndirectionParamsInfo } from '../../types';

import { getNodeHeader, isFunctionNode, isOxcNode, walkOxcTreeWithParent } from '../../engine/ast/oxc-ast-utils';
import { spanOfNode } from '../../engine/ast/source-span';
import { resolveAbs } from '../../shared/path-resolve';

/* ------------------------------------------------------------------ */
/*  AST utilities — thin-wrapper body-form gate (①)                    */
/* ------------------------------------------------------------------ */

const createEmptyIndirection = (): ReadonlyArray<IndirectionFinding> => [];

/**
 * Extract a plain `CallExpression` from an expression position.
 *
 * Only a bare `CallExpression` qualifies. `f?.(x)` (ChainExpression) and
 * `await f(x)` (AwaitExpression) are rejected here: optional-chain calls and
 * awaited calls add an observable decision (short-circuit / async contract) and
 * belong to error-flow, so they are NOT thin-wrappers (spec ①/④).
 */
const getPlainCall = (expression: Node | null): Node | null => {
  if (expression === null) {
    return null;
  }

  return expression.type === 'CallExpression' ? expression : null;
};

const getCallFromStatement = (statement: Node): Node | null => {
  if (statement.type === 'ReturnStatement') {
    return statement.argument ? getPlainCall(statement.argument) : null;
  }

  if (statement.type === 'ExpressionStatement') {
    return getPlainCall(statement.expression);
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

/**
 * Collect the wrapper's parameters as plain identifier names.
 *
 * Returns `null` (→ not a thin-wrapper) for any param shape that is not a bare
 * identifier or a trailing rest identifier: ObjectPattern / ArrayPattern
 * (destructuring is an object↔positional transform — spec ①), defaults
 * (AssignmentPattern), or a nested pattern inside rest.
 */
const getParams = (node: Node): IndirectionParamsInfo | null => {
  const paramsValue = getFunctionParams(node);

  if (paramsValue === null) {
    return null;
  }

  const params: string[] = [];
  let restParam: string | null = null;

  for (let index = 0; index < paramsValue.length; index += 1) {
    const paramNode = paramsValue[index];

    if (!paramNode) {
      return null;
    }

    if (paramNode.type === 'Identifier' && typeof paramNode.name === 'string') {
      params.push(paramNode.name);

      continue;
    }

    if (paramNode.type === 'RestElement') {
      // Rest must be the last param and bind a plain identifier.
      if (index !== paramsValue.length - 1) {
        return null;
      }

      const argument = paramNode.argument;

      if (argument.type !== 'Identifier') {
        return null;
      }

      restParam = argument.name;

      params.push(argument.name);

      continue;
    }

    // ObjectPattern / ArrayPattern / AssignmentPattern (default) / TSParameterProperty
    // — all add a transform, not a bare passthrough.
    return null;
  }

  return { params, restParam };
};

/**
 * Verify the call arguments forward the parameters 1:1 with no transform:
 * non-rest positions must be the bare parameter Identifier (no SpreadElement,
 * no literals, no reordering); the rest position must be `...restParam`.
 */
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

    // Non-rest position: bare identifier only. SpreadElement here (`f(...x)`)
    // is a positional→spread transform (spec ①) → reject.
    if (arg.type !== 'Identifier' || arg.name !== name) {
      return false;
    }
  }

  return true;
};

/**
 * Receiver gate (③): resolve which (if any) wrapper parameter is consumed as the
 * call receiver.
 *
 * Returns:
 *  - `{ ok: true, receiver: null }` for a free function identifier callee;
 *  - `{ ok: true, receiver: name }` for `p.m(...)` where `p` is a wrapper param;
 *  - `{ ok: false }` for this/super/private/import-namespace/external-object or
 *    optional member callees (not inlinable).
 */
interface CalleeResolution {
  readonly ok: boolean;
  readonly receiver: string | null;
}

const resolveCallee = (callExpression: Node, paramNames: ReadonlySet<string>): CalleeResolution => {
  if (callExpression.type !== 'CallExpression') {
    return { ok: false, receiver: null };
  }

  const callee = callExpression.callee;

  // Free function identifier — allowed, no receiver.
  if (callee.type === 'Identifier') {
    return { ok: true, receiver: null };
  }

  if (callee.type === 'MemberExpression') {
    if (callee.optional === true) {
      return { ok: false, receiver: null };
    }

    const object = callee.object;

    // Receiver must be one of the wrapper's own parameters.
    if (object.type === 'Identifier' && paramNames.has(object.name)) {
      return { ok: true, receiver: object.name };
    }
  }

  return { ok: false, receiver: null };
};

/** True if the function node is async or a generator (spec ④ → error-flow). */
const isAsyncOrGenerator = (node: Node): boolean => {
  const fn = node as { async?: boolean; generator?: boolean };

  return fn.async === true || fn.generator === true;
};

/** True if the return type annotation is a type predicate or `asserts` (spec ⑤). */
const hasNarrowingReturn = (node: Node): boolean => {
  const ret = (node as { returnType?: Node | null }).returnType;

  if (!ret || !isOxcNode(ret)) {
    return false;
  }

  const annotation = (ret as { typeAnnotation?: Node }).typeAnnotation;

  return isOxcNode(annotation) && annotation.type === 'TSTypePredicate';
};

const getWrapperCall = (node: Node): Node | null => {
  // ④ async / generator delegation belongs to error-flow.
  if (isAsyncOrGenerator(node)) {
    return null;
  }

  // ⑤ return narrowing (type predicate / asserts).
  if (hasNarrowingReturn(node)) {
    return null;
  }

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
      : getPlainCall(body);

  if (!maybeCall) {
    return null;
  }

  // ③ receiver gate — also tells us which param (if any) is consumed as receiver.
  const calleeRes = resolveCallee(maybeCall, new Set(paramsInfo.params));

  if (!calleeRes.ok) {
    return null;
  }

  // Forwarded params = declared params minus the receiver param (consumed as
  // `this` in `p.m(...)`). The receiver param must not also appear among args.
  const forwardedParams =
    calleeRes.receiver === null ? paramsInfo.params : paramsInfo.params.filter(p => p !== calleeRes.receiver);
  const effectiveRest = calleeRes.receiver !== null && calleeRes.receiver === paramsInfo.restParam ? null : paramsInfo.restParam;

  if (!isPassthroughArgs(maybeCall, forwardedParams, effectiveRest)) {
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

/* ------------------------------------------------------------------ */
/*  Structured callee reference for cross-file import resolution        */
/* ------------------------------------------------------------------ */

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
  readonly propertyInitNodes: Set<Node>;
}

const collectFunctionNames = (program: Program): CollectedFunctionNames => {
  const namesByNode = new Map<Node, string>();
  const methodNodes = new Set<Node>();
  const propertyInitNodes = new Set<Node>();

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

      // A function delegate stored in a property init — aliasing does not close
      // on the file AST, so it is conservative K (spec ② property-init).
      propertyInitNodes.add(valueNode);

      const header = getNodeHeader(node);

      if (header.length > 0 && header !== 'anonymous') {
        namesByNode.set(valueNode, header);
      }
    },

    MethodDefinition(node) {
      const valueNode = node.value;
      const header = getNodeHeader(node);

      methodNodes.add(valueNode);

      if (header.length === 0 || header === 'anonymous') {
        return;
      }

      namesByNode.set(valueNode, header);
    },
  }).visit(program);

  return { namesByNode, methodNodes, propertyInitNodes };
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

/**
 * Compute the forward-chain depth for `name`. Returns -1 to signal a same-file
 * cycle was reached on this path (spec: same-file cycles are unreported).
 */
const computeChainDepth = (name: string, calleeByName: Map<string, string | null>, visited: Set<string>): number => {
  if (visited.has(name)) {
    // Same-file cycle — infinite recursion bug, not a static indirection layer.
    return -1;
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

  if (nextDepth < 0) {
    return -1;
  }

  return 1 + nextDepth;
};

/* ------------------------------------------------------------------ */
/*  Reference / identity gate (②)                                      */
/* ------------------------------------------------------------------ */

/**
 * Build the set of identifier names that alias a thin-wrapper delegate via
 * same-file `const a = w` rebinds (fixpoint). Seeded with the delegate's own
 * name. Property/member rebinds are NOT followed (aliasing not closed).
 */
const buildAliasNames = (seedName: string, program: Program): Set<string> => {
  const aliases = new Set<string>([seedName]);
  let changed = true;

  while (changed) {
    changed = false;

    new Visitor({
      VariableDeclarator(node) {
        if (node.id.type !== 'Identifier') {
          return;
        }

        const init = node.init;

        if (init === null || init.type !== 'Identifier') {
          return;
        }

        if (aliases.has(init.name) && !aliases.has(node.id.name)) {
          aliases.add(node.id.name);

          changed = true;
        }
      },
    }).visit(program);
  }

  return aliases;
};

/**
 * Scan the file for any reference of `aliasNames` that reaches a non-direct-call
 * position. A direct call is the callee of a CallExpression (`name(...)`). Any
 * other reach — argument, comparison operand, array element, spread, init/assign
 * RHS, return, export, JSX attribute, default — fixes reference identity and
 * makes the wrapper non-inlinable (spec ②). Returns true if such a reach exists.
 */
const hasIdentityReach = (aliasNames: ReadonlySet<string>, program: Program): boolean => {
  let reached = false;

  walkOxcTreeWithParent(program, (node, parent) => {
    if (reached) {
      return false;
    }

    if (node.type !== 'Identifier' || !aliasNames.has(node.name)) {
      return true;
    }

    if (parent === null) {
      return true;
    }

    // Direct call: `name(...)` — callee position of a CallExpression.
    if (parent.type === 'CallExpression' && parent.callee === node) {
      return true;
    }

    // Declaration site of the binding itself (id of declarator / function id /
    // param / member property key) — not a use.
    if (parent.type === 'VariableDeclarator' && parent.id === node) {
      return true;
    }

    if (
      (parent.type === 'FunctionDeclaration' || parent.type === 'FunctionExpression') &&
      (parent as { id?: Node | null }).id === node
    ) {
      return true;
    }

    // Member property name (`x.name`) or non-computed object key — not a value
    // reference to the binding.
    if (parent.type === 'MemberExpression' && parent.property === node && parent.computed !== true) {
      return true;
    }

    if (
      (parent.type === 'Property' || parent.type === 'PropertyDefinition' || parent.type === 'MethodDefinition') &&
      parent.key === node &&
      (parent as { computed?: boolean }).computed !== true
    ) {
      return true;
    }

    // Import/export specifier local/exported names referencing the binding count
    // as escapes (export of the value) — handled below by default reach.
    if (
      parent.type === 'ImportSpecifier' ||
      parent.type === 'ImportDefaultSpecifier' ||
      parent.type === 'ImportNamespaceSpecifier'
    ) {
      return true;
    }

    // Any other parent context is an identity reach.
    reached = true;

    return false;
  });

  return reached;
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

/**
 * Names exported by a file, read directly from its OWN AST.
 *
 * "Is this declaration exported" is a pure syntactic property — determining it
 * from the file's AST is complete and robust, whereas gildash's project-wide
 * export index can be partial/degraded (e.g. when dependencies aren't installed),
 * which would silently disable the cross-module thin-wrapper guard and produce
 * false positives for every exported wrapper.
 */
const collectExportedNames = (program: Program): Set<string> => {
  const names = new Set<string>();
  const body = (program as { body?: ReadonlyArray<Node> }).body ?? [];

  for (const stmt of body) {
    if (stmt.type !== 'ExportNamedDeclaration') {
      continue;
    }

    const decl = (stmt as { declaration?: Node | null }).declaration;

    if (decl) {
      if ((decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') && 'id' in decl) {
        const id = (decl as { id?: { name?: string } | null }).id;

        if (id && typeof id.name === 'string') {
          names.add(id.name);
        }
      } else if (decl.type === 'VariableDeclaration') {
        for (const d of (decl as { declarations: ReadonlyArray<{ id?: Node }> }).declarations) {
          const id = d.id;

          if (id && id.type === 'Identifier' && typeof id.name === 'string') {
            names.add(id.name);
          }
        }
      }
    }

    // `export { foo, bar as baz }` — the exported (public) name is what matters.
    const specifiers = (stmt as { specifiers?: ReadonlyArray<{ exported?: { name?: string } }> }).specifiers;

    if (Array.isArray(specifiers)) {
      for (const spec of specifiers) {
        const name = spec.exported?.name;

        if (typeof name === 'string') {
          names.add(name);
        }
      }
    }
  }

  return names;
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

/**
 * Build the set of overloaded top-level function names per file (spec ⑥ —
 * overload forces a protocol, so the implementation is K). A name is overloaded
 * if gildash indexes 2+ function symbols with the same name in the same file.
 * Methods are excluded: class methods are wholesale K via the method guard.
 */
const buildOverloadIndex = (gildash: Gildash, rootAbs: string): Map<string, Set<string>> => {
  let allSymbols: ReturnType<Gildash['searchSymbols']>;

  try {
    allSymbols = gildash.searchSymbols({});
  } catch (e) {
    if (e instanceof GildashError) {
      return new Map();
    }
    throw e;
  }

  const counts = new Map<string, Map<string, number>>();

  for (const sym of allSymbols) {
    if (sym.kind !== 'function') {
      continue;
    }

    const absFile = resolveAbs(rootAbs, sym.filePath);
    const fileCounts = counts.get(absFile) ?? new Map<string, number>();

    fileCounts.set(sym.name, (fileCounts.get(sym.name) ?? 0) + 1);
    counts.set(absFile, fileCounts);
  }

  const index = new Map<string, Set<string>>();

  for (const [file, fileCounts] of counts) {
    const overloaded = new Set<string>();

    for (const [name, count] of fileCounts) {
      if (count > 1) {
        overloaded.add(name);
      }
    }

    if (overloaded.size > 0) {
      index.set(file, overloaded);
    }
  }

  return index;
};

/**
 * gildash symbol-level K gate (spec ⑥): decorator (intentional wrapper). Returns
 * true if the wrapper must be skipped. Gildash unavailability is swallowed (keep
 * AST behavior).
 *
 * NOTE: the `override` modifier is intentionally NOT checked here — `override`
 * is only legal on class methods, and every method is already K via the method
 * guard in `handleThinWrapper` (it returns before this gate is reached). An
 * override check here would be unreachable dead code.
 */
const hasDecorator = (gildash: Gildash, header: string, filePath: string): boolean => {
  try {
    const symbol = gildash.getFullSymbol(header, filePath);

    if (symbol === null) {
      return false;
    }

    return Array.isArray(symbol.decorators) && symbol.decorators.length > 0;
  } catch (e) {
    if (!(e instanceof GildashError)) {
      throw e;
    }

    return false;
  }
};

/* ------------------------------------------------------------------ */
/*  Module-file detection (for interface-rewrap gate)                  */
/* ------------------------------------------------------------------ */

/** True if the program has any top-level import/export declaration (module, not script). */
const isModuleFile = (program: Program): boolean => {
  for (const stmt of program.body) {
    if (
      stmt.type === 'ImportDeclaration' ||
      stmt.type === 'ExportNamedDeclaration' ||
      stmt.type === 'ExportDefaultDeclaration' ||
      stmt.type === 'ExportAllDeclaration'
    ) {
      return true;
    }
  }

  return false;
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
  // Build import/overload indices from gildash. Export status is read per-file
  // from the AST (collectExportedNames) — robust even when gildash's project
  // index is partial (e.g. dependencies not installed).
  const importIdx = buildImportIndex(gildash, rootAbs);
  const overloadIdx = buildOverloadIndex(gildash, rootAbs);
  const crossFileWrappers = new Map<string, CrossFileWrapper>();

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    const normalizedFilePath = normalizePath(file.filePath);
    const { namesByNode, methodNodes, propertyInitNodes } = collectFunctionNames(file.program);
    const calleeByName = new Map<string, string | null>();
    const wrapperNodeByName = new Map<string, Node>();
    const fileExports = collectExportedNames(file.program);
    const fileOverloads = overloadIdx.get(normalizedFilePath) ?? new Set<string>();

    const handleThinWrapper = (node: Node): void => {
      // ③/② Class methods: receiver is reached via instance/prototype aliasing,
      // which does not close on the file AST — conservative K (spec method).
      if (methodNodes.has(node)) {
        return;
      }

      // Property-init delegate: aliasing not closed — conservative K (spec ②).
      if (propertyInitNodes.has(node)) {
        return;
      }

      const wrapperCall = getWrapperCall(node);

      if (!wrapperCall) {
        return;
      }

      const header = namesByNode.get(node) ?? getNodeHeader(node);

      // Only named change-points are thin-wrapper targets (named function decl or
      // variable-init arrow/function expression). An anonymous inline delegate
      // (e.g. an arrow passed directly to `.map`) is itself reached as a value in
      // an identity position — not a named binding — so it is K (spec target #1).
      if (header.length === 0 || header === 'anonymous') {
        return;
      }

      // ⑥ overload: a same-name signature-only declaration is co-present — the
      // implementation forces a protocol and is K (incl. chain tracking).
      if (fileOverloads.has(header)) {
        return;
      }

      // ⑥ decorator / override modifier — intentional/protocol forward, K.
      if (hasDecorator(gildash, header, file.filePath)) {
        return;
      }

      const calleeName = resolveCalleeName(wrapperCall);

      // Self-recursive wrapper (`const f = () => f()`): the callee is the wrapper
      // itself, so there is no underlying layer to inline away — removing it would
      // break the self-reference. Not indirection (K).
      if (calleeName !== null && calleeName === header) {
        return;
      }

      // Track callee for same-file forward-chain regardless of ②/export — the
      // chain target #2/#3 does not require the reference-identity proof.
      calleeByName.set(header, calleeName);
      wrapperNodeByName.set(header, node);

      // ② export guard: a wrapper whose uses escape the file cannot be proven
      // identity-safe here → thin-wrapper not reportable (cross-module).
      // Still tracked above for forward-chain.
      if (fileExports.has(header)) {
        // Cross-file forward-chain tracking (only exported wrappers cross files).
        const calleeRef = getSimpleCalleeRef(wrapperCall);
        const crossTarget = calleeRef ? resolveCrossFileTarget(calleeRef, normalizedFilePath, importIdx, gildash, rootAbs) : null;
        const targetKey = crossTarget ? `${crossTarget.targetFilePath}:${crossTarget.exportedName}` : null;
        const key = `${normalizedFilePath}:${header}`;

        // Base depth 1: a registered wrapper performs one delegation hop itself
        // (its target counts), matching the same-file `computeChainDepth`
        // convention where a wrapper forwarding to a non-wrapper has depth 1.
        crossFileWrappers.set(key, { node, file, header, depth: 1, targetKey });

        return;
      }

      // ② reference / identity gate — scan same-file uses (incl. fixpoint rebinds).
      const aliasNames = buildAliasNames(header, file.program);

      if (hasIdentityReach(aliasNames, file.program)) {
        return;
      }

      const evidence = `thin wrapper forwards to ${calleeName ?? 'call'}`;

      addFinding(findings, 'thin-wrapper', node, file.filePath, file.sourceText, header, 1, evidence);
    };

    new Visitor({
      FunctionDeclaration: handleThinWrapper,
      FunctionExpression: handleThinWrapper,
      ArrowFunctionExpression: handleThinWrapper,
    }).visit(file.program);

    if (options.maxForwardDepth >= 1) {
      for (const [name, node] of wrapperNodeByName.entries()) {
        const depth = computeChainDepth(name, calleeByName, new Set<string>());

        // depth < 0 → same-file cycle on this path: unreported (spec).
        if (depth < 0 || depth <= options.maxForwardDepth) {
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

    // type-remap: type A = B (pure synonym, no type args, no type params).
    // typeArg/typeParam present → generic variation → always K (spec ⑦).
    new Visitor({
      TSTypeAliasDeclaration(node) {
        if (node.declare === true) {
          return;
        }

        const typeAnnotation = node.typeAnnotation;

        if (typeAnnotation.type !== 'TSTypeReference') {
          return;
        }

        if (typeAnnotation.typeArguments !== null || node.typeParameters !== null) {
          return;
        }

        const header = node.id.name;
        const targetName = resolveTypeReferenceName(typeAnnotation.typeName) ?? 'unknown';
        const evidence = `type alias ${header} is a direct synonym for ${targetName}`;

        addFinding(findings, 'type-remap', node, file.filePath, file.sourceText, header, 1, evidence);
      },
    }).visit(file.program);

    // interface-rewrap gate (spec ⑤ target): empty body, exactly one extends,
    // no typeParameters, heritage has no typeArguments, not declare / not module
    // augmentation / not declaration merging, and the file is a module.
    const fileIsModule = isModuleFile(file.program);
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
      if (node.type !== 'TSInterfaceDeclaration' || node.declare === true) {
        return true;
      }

      // Script file → same-name interfaces may merge cross-file → always K.
      if (!fileIsModule) {
        return true;
      }

      const extendsArr = node.extends;

      // Exactly one extends (0 = empty marker, multiple = composition).
      if (extendsArr.length !== 1) {
        return true;
      }

      // No type parameters on the interface (generic variation).
      if (node.typeParameters !== null && node.typeParameters !== undefined) {
        return true;
      }

      if (node.body.body.length > 0) {
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

      // Heritage with type arguments → generic variation → K (spec ⑦).
      const heritageTypeArgs = (firstExtends as { typeArguments?: Node | null }).typeArguments;

      if (heritageTypeArgs !== null && heritageTypeArgs !== undefined) {
        return true;
      }

      const baseExpr = (firstExtends as { expression?: Node }).expression;
      const baseName =
        baseExpr && baseExpr.type === 'Identifier'
          ? baseExpr.name
          : baseExpr && baseExpr.type === 'TSQualifiedName'
            ? getNodeHeader(baseExpr)
            : 'anonymous';
      const evidence = `interface ${name} extends ${baseName} with empty body`;

      addFinding(findings, 'interface-rewrap', node, file.filePath, file.sourceText, name, 1, evidence);

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
