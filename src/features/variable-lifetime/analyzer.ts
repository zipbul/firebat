import type { Function as OxcFunction, Node } from 'oxc-parser';

import { buildLineOffsets, getLineColumn } from '@zipbul/gildash';

import type { BitSet, FunctionBodyAnalysis, ParsedFile, VariableUsage } from '../../engine/types';
import type {
  LivenessPressureFinding,
  MutationDensityFinding,
  ScopeNarrowingFinding,
  VariableLifetimeFinding,
} from '../../types';

import { normalizeFile } from '../../engine/ast/normalize-file';
import {
  collectFunctionNodes,
  collectOxcNodes,
  forEachChildNode,
  isFunctionNode,
  toNodeArray,
} from '../../engine/ast/oxc-ast-utils';
import { intersectBitSet } from '../../engine/dataflow/dataflow';
import { computeLiveness } from '../../engine/dataflow/liveness';
import {
  analyzeFunctionBody,
  type BindingName,
  bindingKey,
  collectLocalVarIndexes,
  collectParameterBindings,
  resolveVarIndex,
} from '../../engine/dataflow/reaching-defs';
import { buildDeclScopeMap, collectVariables } from '../../engine/dataflow/variable-collector';
import { keepMapBound } from '../../shared/multi-map';
import { isOffsetInAnyRange, type OffsetRange } from '../../shared/offset-range';

const lineColumnAt = (sourceText: string, offset: number) => getLineColumn(buildLineOffsets(sourceText), offset);

/** The single `name@location` identity-key format for a named binding/usage. */
const nameLocationKey = (item: BindingName): string => `${item.name}@${item.location}`;

/** `name@location` key set of the usages matching `pred` — the read/write outer-usage key decision. */
const usageKeySet = (usages: ReadonlyArray<VariableUsage>, pred: (u: VariableUsage) => boolean): Set<string> =>
  new Set(usages.filter(pred).map(nameLocationKey));

const createEmptyVariableLifetime = (): ReadonlyArray<
  VariableLifetimeFinding | ScopeNarrowingFinding | LivenessPressureFinding | MutationDensityFinding
> => [];

interface AnalyzeVariableLifetimeOptions {
  readonly maxLifetimeLines: number;
  readonly maxLiveVariables?: number | undefined;
  readonly minFunctionLines?: number | undefined;
  readonly maxMutationCount?: number | undefined;
}

const payloadOffset = (payload: Node | ReadonlyArray<Node> | null): number => {
  if (payload === null) {
    return -1;
  }

  // `Array.isArray` does not narrow ReadonlyArray<T> reliably; cast back to
  // the element form in each branch.
  if (Array.isArray(payload)) {
    const first = (payload as ReadonlyArray<Node>)[0];

    return first !== undefined ? first.start : -1;
  }

  return (payload as Node).start;
};

// ── isPureInitializer ─────────────────────────────────────────────────────────

interface LongLivedDef {
  readonly variable: string;
  readonly defOffset: number;
  readonly lastUseOffset: number;
  readonly lifetimeLines: number;
}

/**
 * Returns true if the AST node is a pure (side-effect-free) expression.
 * null represents "no initializer" (e.g. `let x;`) which is also pure.
 */
const isPureInitializer = (node: Node | null | undefined): boolean => {
  if (node === null || node === undefined) {
    return true;
  }

  // Literals: number, string, boolean, null, undefined (as Identifier), regex
  if (node.type === 'Literal') {
    return true;
  }

  // Identifier reference (e.g. someVar, SomeType)
  if (node.type === 'Identifier') {
    return true;
  }

  // Binary expression: a + b, a > b, etc. — pure if both operands are pure
  if (node.type === 'BinaryExpression') {
    return isPureInitializer(node.left) && isPureInitializer(node.right);
  }

  // Logical expression: a && b, a || b, a ?? b
  if (node.type === 'LogicalExpression') {
    return isPureInitializer(node.left) && isPureInitializer(node.right);
  }

  // Conditional expression: cond ? a : b
  if (node.type === 'ConditionalExpression') {
    return isPureInitializer(node.test) && isPureInitializer(node.consequent) && isPureInitializer(node.alternate);
  }

  // Unary expression: typeof x, void 0, !, ~, +, -
  if (node.type === 'UnaryExpression') {
    if (node.operator === 'delete') {
      return false;
    }

    return isPureInitializer(node.argument);
  }

  // Template literal (without tag): `hello ${name}`
  if (node.type === 'TemplateLiteral') {
    for (const expr of node.expressions as ReadonlyArray<Node>) {
      if (!isPureInitializer(expr)) {
        return false;
      }
    }

    return true;
  }

  // Tagged template is impure
  if (node.type === 'TaggedTemplateExpression') {
    return false;
  }

  // Array expression: [1, 2] — pure if no SpreadElement inside
  if (node.type === 'ArrayExpression') {
    for (const el of node.elements as ReadonlyArray<Node | null>) {
      if (el === null) {
        continue;
      }

      if (el.type === 'SpreadElement') {
        return false;
      }

      if (!isPureInitializer(el)) {
        return false;
      }
    }

    return true;
  }

  // Object expression: { a: 1 } — pure if no SpreadElement
  if (node.type === 'ObjectExpression') {
    for (const prop of node.properties as ReadonlyArray<Node>) {
      if (prop.type === 'SpreadElement') {
        return false;
      }

      if (prop.type === 'Property') {
        // Computed key: { [expr]: val } — the key expression must also be pure
        if (prop.computed === true) {
          if (!isPureInitializer(prop.key)) {
            return false;
          }
        }

        if (!isPureInitializer(prop.value)) {
          return false;
        }
      }
    }

    return true;
  }

  // Member expression: a.b, a.b.c — treat as pure (getter/proxy risk accepted per spec)
  if (node.type === 'MemberExpression') {
    return isPureInitializer(node.object);
  }

  // Chain expression: a?.b
  if (node.type === 'ChainExpression') {
    return isPureInitializer(node.expression);
  }

  // TypeScript type casts — pure (just a type annotation)
  if (
    node.type === 'TSAsExpression' ||
    node.type === 'TSSatisfiesExpression' ||
    node.type === 'TSNonNullExpression' ||
    node.type === 'TSTypeAssertion'
  ) {
    return isPureInitializer(node.expression);
  }

  // Parenthesized expression
  if (node.type === 'ParenthesizedExpression') {
    return isPureInitializer(node.expression);
  }

  // Impure: function calls, new, await, yield, assignment, update, spread, sequence
  if (
    node.type === 'CallExpression' ||
    node.type === 'NewExpression' ||
    node.type === 'AwaitExpression' ||
    node.type === 'YieldExpression' ||
    node.type === 'SpreadElement' ||
    node.type === 'AssignmentExpression' ||
    node.type === 'UpdateExpression' ||
    node.type === 'SequenceExpression'
  ) {
    return false;
  }

  // Unknown node type — conservatively treat as impure
  return false;
};

// ── Scope block collection ────────────────────────────────────────────────────

type ScopeBlockType = 'if-consequent' | 'if-alternate' | 'switch-case' | 'try-block' | 'catch-block';

interface ScopeBlock {
  readonly type: ScopeBlockType;
  readonly start: number;
  readonly end: number;
}

/** Terminal statement types that end a switch case without fall-through. */
const isTerminalStatement = (stmt: Node): boolean => {
  const t = stmt.type;

  return t === 'BreakStatement' || t === 'ReturnStatement' || t === 'ThrowStatement' || t === 'ContinueStatement';
};

/**
 * Collects all scope-creating blocks from the direct children of a function body.
 * Handles: IfStatement, SwitchStatement (no fall-through), TryStatement.
 * Loops are excluded per V1 spec.
 */
const collectScopeBlocks = (bodyStatements: ReadonlyArray<Node>): ReadonlyArray<ScopeBlock> => {
  const blocks: ScopeBlock[] = [];

  for (const stmt of bodyStatements) {
    if (stmt.type === 'IfStatement') {
      const consequent = stmt.consequent;
      const alternate = stmt.alternate;

      if (consequent.type === 'BlockStatement') {
        blocks.push({ type: 'if-consequent', start: consequent.start, end: consequent.end });
      }

      // alternate: only BlockStatement (not else-if chain)
      if (alternate !== null && alternate.type === 'BlockStatement') {
        blocks.push({ type: 'if-alternate', start: alternate.start, end: alternate.end });
      }

      continue;
    }

    if (stmt.type === 'SwitchStatement') {
      // Check for fall-through: every case must end with a terminal statement
      let hasFallThrough = false;

      for (const switchCase of stmt.cases) {
        const switchCaseConsequent = switchCase.consequent;

        if (switchCaseConsequent.length === 0) {
          // Empty case (fall-through by definition)
          hasFallThrough = true;

          break;
        }

        const lastStmt = switchCaseConsequent[switchCaseConsequent.length - 1];

        if (lastStmt !== undefined && isTerminalStatement(lastStmt)) {
          continue;
        }

        hasFallThrough = true;

        break;
      }

      if (hasFallThrough) {
        continue;
      }

      for (const switchCase of stmt.cases) {
        blocks.push({ type: 'switch-case', start: switchCase.start, end: switchCase.end });
      }

      continue;
    }

    if (stmt.type === 'TryStatement') {
      const { block, handler } = stmt;
      // finalizer is handled only for exclusion (see checkScopeNarrowing)

      blocks.push({ type: 'try-block', start: block.start, end: block.end });

      if (handler !== null) {
        const handlerBody = handler.body;

        blocks.push({ type: 'catch-block', start: handlerBody.start, end: handlerBody.end });
      }

      continue;
    }
  }

  return blocks;
};

// ── Variable declaration info collection ─────────────────────────────────────

interface VarDeclInfo {
  readonly kind: 'const' | 'let' | 'var';
  readonly isDestructuring: boolean;
}

/**
 * Collects variable declaration info from direct-child VariableDeclaration statements
 * in the function body. Returns Map<declarationOffset, VarDeclInfo>.
 */
const collectVarDeclInfo = (bodyStatements: ReadonlyArray<Node>): Map<number, VarDeclInfo> => {
  const result = new Map<number, VarDeclInfo>();

  for (const stmt of bodyStatements) {
    if (stmt.type !== 'VariableDeclaration') {
      continue;
    }

    const kind = stmt.kind;

    if (kind !== 'const' && kind !== 'let' && kind !== 'var') {
      continue;
    }

    for (const decl of stmt.declarations) {
      const id = decl.id;
      const isDestructuring = id.type === 'ObjectPattern' || id.type === 'ArrayPattern';

      result.set(decl.start, { kind, isDestructuring });
    }
  }

  return result;
};

// ── Referenced variable collection ──────────────────────────────────────

/**
 * A read site identified by the binding it resolves to, not by name alone.
 * Same-named bindings in different lexical scopes carry different `declScope`
 * values, so downstream lookups distinguish outer/inner shadows.
 */
interface ReferencedBinding {
  readonly name: string;
  readonly declScope: string | undefined;
}

/**
 * Collects all Identifier reads in `initNode`, deduplicated by (name, declScope)
 * so each distinct binding appears once.
 */
const collectReferencedBindings = (
  initNode: Node | null | undefined,
  declScopeByIdLocation: ReadonlyMap<number, string>,
): ReadonlyArray<ReferencedBinding> => {
  if (initNode === null || initNode === undefined) {
    return [];
  }

  const usages = collectVariables(initNode, { includeNestedFunctions: false, declScopeByIdLocation });
  const seen = new Set<string>();
  const out: ReferencedBinding[] = [];

  for (const usage of usages) {
    if (!usage.isRead) {
      continue;
    }

    const key = bindingKey(usage.name, usage.declScope);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    out.push({ name: usage.name, declScope: usage.declScope });
  }

  return out;
};

// ── Intervening write check ───────────────────────────────────────────────────

interface TryCatchRange {
  readonly tryStart: number;
  readonly tryEnd: number;
  readonly catchStart: number;
  readonly catchEnd: number;
}

interface TryCatchRangeCollection {
  readonly finalizerRanges: ReadonlyArray<OffsetRange>;
  readonly tryHandlerRanges: ReadonlyArray<TryCatchRange>;
}

/**
 * Returns true if any variable referenced by the initializer has a write
 * in CFG nodes whose payload offset falls in [declOffset, blockStart).
 */
const hasInterveningWrites = (
  referencedBindings: ReadonlyArray<ReferencedBinding>,
  declOffset: number,
  blockStartOffset: number,
  analysis: FunctionBodyAnalysis,
  localIndexByName: Map<string, number>,
): boolean => {
  if (referencedBindings.length === 0) {
    return false;
  }

  // Separate referenced bindings into local vs non-local
  const localVarIndexes = new Set<number>();
  const nonLocalNames = new Set<string>();

  for (const ref of referencedBindings) {
    const idx = resolveVarIndex(localIndexByName, ref);

    if (typeof idx === 'number') {
      localVarIndexes.add(idx);
    } else {
      nonLocalNames.add(ref.name);
    }
  }

  const { nodePayloads, writeVarIndexesByNode } = analysis;

  for (let cfgNodeId = 0; cfgNodeId < nodePayloads.length; cfgNodeId += 1) {
    const payload = nodePayloads[cfgNodeId];

    if (payload === null || payload === undefined) {
      continue;
    }

    const offset = payloadOffset(payload as Node | ReadonlyArray<Node>);

    if (offset < declOffset || offset >= blockStartOffset) {
      continue;
    }

    // Check local variable writes via writeVarIndexesByNode
    if (localVarIndexes.size > 0) {
      const writeIndexes = writeVarIndexesByNode[cfgNodeId];

      if (writeIndexes) {
        for (const wi of writeIndexes) {
          if (localVarIndexes.has(wi)) {
            return true;
          }
        }
      }
    }

    // Check non-local variable writes via AST-based collectVariables
    if (nonLocalNames.size > 0) {
      const payloadNodes = toNodeArray(payload);

      for (const payloadNode of payloadNodes) {
        const usages = collectVariables(payloadNode, { includeNestedFunctions: false });

        for (const usage of usages) {
          if (usage.isWrite && nonLocalNames.has(usage.name)) {
            return true;
          }
        }
      }
    }
  }

  return false;
};

// ── checkScopeNarrowing ───────────────────────────────────────────────────────

const collectFinalizerAndTryCatchRanges = (bodyStatements: ReadonlyArray<Node>): TryCatchRangeCollection => {
  const finalizerRanges: OffsetRange[] = [];
  const tryHandlerRanges: TryCatchRange[] = [];

  for (const stmt of bodyStatements) {
    if (stmt.type !== 'TryStatement') {
      continue;
    }

    const { block, handler, finalizer } = stmt;

    if (finalizer !== null) {
      finalizerRanges.push({ start: finalizer.start, end: finalizer.end });
    }

    if (handler !== null) {
      const handlerBody = handler.body;

      tryHandlerRanges.push({
        tryStart: block.start,
        tryEnd: block.end,
        catchStart: handlerBody.start,
        catchEnd: handlerBody.end,
      });
    }
  }

  return { finalizerRanges, tryHandlerRanges };
};

const collectAllSiteOffsets = (
  analysis: FunctionBodyAnalysis,
  localIndexByName: Map<string, number>,
  declScopeByIdLocation: ReadonlyMap<number, string>,
): Map<number, number[]> => {
  const allSiteOffsetsByVarIndex = new Map<number, number[]>();

  for (let cfgNodeId = 0; cfgNodeId < analysis.nodePayloads.length; cfgNodeId += 1) {
    const payload = analysis.nodePayloads[cfgNodeId];

    if (payload === null || payload === undefined) {
      continue;
    }

    const offset = payloadOffset(payload as Node | ReadonlyArray<Node>);

    if (offset < 0) {
      continue;
    }

    const payloadNodes = toNodeArray(payload);

    for (const payloadNode of payloadNodes) {
      const usages = collectVariables(payloadNode, { includeNestedFunctions: false, declScopeByIdLocation });

      for (const usage of usages) {
        const varIndex = resolveVarIndex(localIndexByName, usage);

        if (typeof varIndex !== 'number') {
          continue;
        }

        // Exclude the declaration itself (writeKind === 'declaration')
        if (usage.isWrite && usage.writeKind === 'declaration') {
          continue;
        }

        let arr = allSiteOffsetsByVarIndex.get(varIndex);

        if (!arr) {
          arr = [];

          allSiteOffsetsByVarIndex.set(varIndex, arr);
        }

        arr.push(usage.location);
      }
    }
  }

  return allSiteOffsetsByVarIndex;
};

const findInitNode = (bodyStatements: ReadonlyArray<Node>, defLocation: number): Node | null => {
  for (const stmt of bodyStatements) {
    if (stmt.type !== 'VariableDeclaration') {
      continue;
    }

    for (const decl of stmt.declarations) {
      if (decl.start !== defLocation) {
        continue;
      }

      return decl.init ?? null;
    }
  }

  return null;
};

const checkScopeNarrowing = (
  bodyStatements: ReadonlyArray<Node>,
  analysis: FunctionBodyAnalysis,
  localIndexByName: Map<string, number>,
  paramBindings: ReadonlySet<string>,
  file: string,
  sourceText: string,
  declScopeByIdLocation: ReadonlyMap<number, string>,
): ReadonlyArray<ScopeNarrowingFinding> => {
  const findings: ScopeNarrowingFinding[] = [];
  const scopeBlocks = collectScopeBlocks(bodyStatements);

  if (scopeBlocks.length === 0) {
    return findings;
  }

  const varDeclInfo = collectVarDeclInfo(bodyStatements);
  const { finalizerRanges, tryHandlerRanges } = collectFinalizerAndTryCatchRanges(bodyStatements);
  const allSiteOffsetsByVarIndex = collectAllSiteOffsets(analysis, localIndexByName, declScopeByIdLocation);

  const isInTryAndCatch = (useSiteOffsets: ReadonlyArray<number>, range: TryCatchRange): boolean => {
    const inTry = useSiteOffsets.some(o => o >= range.tryStart && o < range.tryEnd);
    const inCatch = useSiteOffsets.some(o => o >= range.catchStart && o < range.catchEnd);

    return inTry && inCatch;
  };

  // For each def in the analysis, check scope narrowing
  for (const [_defId, defMeta] of analysis.defs.entries()) {
    if (!defMeta) {
      continue;
    }

    // Skip parameters
    if (paramBindings.has(defMeta.name)) {
      continue;
    }

    // Only consider declaration defs
    if (defMeta.writeKind !== 'declaration') {
      continue;
    }

    // Check if this variable is declared with const/let (not var)
    const declInfo = varDeclInfo.get(defMeta.location);

    if (!declInfo) {
      // Declarations registered at a different offset (e.g. inner destructuring bindings)
      continue;
    }

    if (declInfo.kind === 'var') {
      continue;
    }

    // Skip destructuring declarations
    if (declInfo.isDestructuring) {
      continue;
    }

    // Get the variable index using the def's binding scope.
    const varIndex = resolveVarIndex(localIndexByName, defMeta);

    if (typeof varIndex !== 'number') {
      continue;
    }

    // Collect all use+write sites for this variable (excluding its declaration)
    const allSiteOffsets = allSiteOffsetsByVarIndex.get(varIndex) ?? [];

    // No uses = skip (unused variable, handled by other rules)
    if (allSiteOffsets.length === 0) {
      continue;
    }

    // Check finally exclusion
    if (allSiteOffsets.some(o => isOffsetInAnyRange(o, finalizerRanges))) {
      continue;
    }

    // Find the initializer node
    const initNode = findInitNode(bodyStatements, defMeta.location);

    // isPureInitializer check
    if (!isPureInitializer(initNode)) {
      continue;
    }

    // Find if all use sites are within a single scope block
    let matchingBlock: ScopeBlock | null = null;

    for (const block of scopeBlocks) {
      const allInBlock = allSiteOffsets.every(o => o > block.start && o < block.end);

      if (!allInBlock) {
        continue;
      }

      matchingBlock = block;

      break;
    }

    if (!matchingBlock) {
      continue;
    }

    // try+catch double exclusion
    const skipForTryCatch = tryHandlerRanges.some(r => isInTryAndCatch(allSiteOffsets, r));

    if (skipForTryCatch) {
      continue;
    }

    // intervening write check
    const referencedBindings = collectReferencedBindings(initNode, declScopeByIdLocation);

    if (hasInterveningWrites(referencedBindings, defMeta.location, matchingBlock.start, analysis, localIndexByName)) {
      continue;
    }

    // All checks passed — generate finding
    const declLoc = lineColumnAt(sourceText, defMeta.location);
    const blockStartLoc = lineColumnAt(sourceText, matchingBlock.start);
    const blockEndLoc = lineColumnAt(sourceText, matchingBlock.end);

    findings.push({
      kind: 'scope-narrowing',
      file,
      span: { start: declLoc, end: declLoc },
      variable: defMeta.name,
      targetBlock: {
        type: matchingBlock.type,
        span: { start: blockStartLoc, end: blockEndLoc },
      },
    });
  }

  return findings;
};

// ── collectLoopBodyRanges ─────────────────────────────────────────────────────

/**
 * Recursively collects ranges of all loop statements anywhere in the given
 * AST node list (any depth).  For ForStatement the **entire** statement range
 * is used so that init/test/update clause writes (e.g. `i++`) are also
 * suppressed.  For other loop types the body range is sufficient.
 */
const collectLoopBodyRanges = (stmts: ReadonlyArray<Node>): ReadonlyArray<OffsetRange> => {
  const ranges: OffsetRange[] = [];

  const visit = (node: Node): void => {
    if (node.type === 'ForStatement') {
      // ForStatement: use full statement range to cover init/test/update clauses
      ranges.push({ start: node.start, end: node.end });
    } else if (
      node.type === 'WhileStatement' ||
      node.type === 'DoWhileStatement' ||
      node.type === 'ForInStatement' ||
      node.type === 'ForOfStatement'
    ) {
      ranges.push({ start: node.body.start, end: node.body.end });
    }

    // Recurse into all child Node values
    forEachChildNode(node, child => {
      visit(child);
    });
  };

  for (const stmt of stmts) {
    visit(stmt);
  }

  return ranges;
};

// ── analyzeVariableLifetime ───────────────────────────────────────────────────

const analyzeVariableLifetime = (
  files: ReadonlyArray<ParsedFile>,
  options: AnalyzeVariableLifetimeOptions,
): ReadonlyArray<VariableLifetimeFinding | ScopeNarrowingFinding | LivenessPressureFinding | MutationDensityFinding> => {
  if (files.length === 0) {
    return createEmptyVariableLifetime();
  }

  const maxLifetimeLines = Math.max(0, Math.floor(options.maxLifetimeLines));
  const findings: Array<VariableLifetimeFinding | ScopeNarrowingFinding | LivenessPressureFinding | MutationDensityFinding> = [];

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    const rel = normalizeFile(file.filePath);

    if (!rel.endsWith('.ts')) {
      continue;
    }

    const functionNodes = collectFunctionNodes(file.program);

    for (const functionNode of functionNodes) {
      const localIndexByName = collectLocalVarIndexes(functionNode, file.filePath, file.sourceText);

      if (localIndexByName.size === 0) {
        continue;
      }

      const paramBindings = collectParameterBindings(functionNode);
      const bodyNode = (functionNode as OxcFunction).body ?? undefined;

      if (bodyNode === undefined) {
        continue;
      }

      const declScopeByIdLocation = buildDeclScopeMap(functionNode, file.filePath, file.sourceText);
      const analysis = analyzeFunctionBody(bodyNode, localIndexByName, paramBindings, [], declScopeByIdLocation);
      const { defs, reachingInByNode, useVarIndexesByNode, nodePayloads, defsOfVar } = analysis;
      // Compute first/last use offset for each defId via reaching definitions.
      const lastUseOffsetByDefId = new Map<number, number>();
      const firstUseOffsetByDefId = new Map<number, number>();

      for (let cfgNodeId = 0; cfgNodeId < nodePayloads.length; cfgNodeId += 1) {
        const reachingIn = reachingInByNode[cfgNodeId];
        const useVarIndexes = useVarIndexesByNode[cfgNodeId];

        if (!reachingIn || !useVarIndexes || useVarIndexes.length === 0) {
          continue;
        }

        const payload = nodePayloads[cfgNodeId];

        if (payload === null || payload === undefined) {
          continue;
        }

        const useOffset = payloadOffset(payload);

        if (useOffset < 0) {
          continue;
        }

        for (const varIndex of useVarIndexes) {
          const varDefs = defsOfVar[varIndex] as BitSet | undefined;

          if (!varDefs) {
            continue;
          }

          const reachingDefs = intersectBitSet(reachingIn, varDefs);
          const defIds = reachingDefs.array();

          for (const defId of defIds) {
            keepMapBound(lastUseOffsetByDefId, defId, useOffset, (next, prev) => next > prev);
            keepMapBound(firstUseOffsetByDefId, defId, useOffset, (next, prev) => next < prev);
          }
        }
      }

      // Build parameter location set for filtering.
      const paramLocationSet = new Set(paramBindings.map(nameLocationKey));
      // Collect nested function definitions with their captured variable names.
      // Each entry: { startOffset, capturedNames } — used to check if moving a declaration
      // past a closure definition would break capture semantics.
      const nestedFunctions: Array<{ readonly startOffset: number; readonly capturedNames: Set<string> }> = [];
      const outerUsages = collectVariables(bodyNode, { includeNestedFunctions: false, declScopeByIdLocation });
      const outerReadKeys = usageKeySet(outerUsages, u => u.isRead);
      const outerWriteKeys = usageKeySet(outerUsages, u => u.isWrite);
      const nestedFnNodes = collectOxcNodes(bodyNode, n => isFunctionNode(n));

      for (const nfn of nestedFnNodes) {
        const nestedUsages = collectVariables(nfn, { includeNestedFunctions: true, declScopeByIdLocation });
        const captured = new Set<string>();

        for (const u of nestedUsages) {
          // A usage is "captured" if it references a local binding and the same name@location
          // is NOT present in the outer (non-nested) usages — meaning it's only accessed inside the closure.
          const siteKey = `${u.name}@${u.location}`;

          if (
            localIndexByName.has(bindingKey(u.name, u.declScope)) &&
            ((u.isRead && !outerReadKeys.has(siteKey)) || (u.isWrite && !outerWriteKeys.has(siteKey)))
          ) {
            captured.add(u.name);
          }
        }

        if (captured.size > 0) {
          nestedFunctions.push({ startOffset: nfn.start, capturedNames: captured });
        }
      }

      // Generate findings for long-lived definitions.
      const longLived: LongLivedDef[] = [];

      for (const [defId, lastUseOffset] of lastUseOffsetByDefId) {
        const defMeta = defs[defId];

        if (!defMeta) {
          continue;
        }

        // Filter 1: Skip parameters — cannot move.
        if (paramLocationSet.has(`${defMeta.name}@${defMeta.location}`)) {
          continue;
        }

        const defLoc = lineColumnAt(file.sourceText, defMeta.location);
        const useLoc = lineColumnAt(file.sourceText, lastUseOffset);
        const lifetime = useLoc.line - defLoc.line;

        if (lifetime <= maxLifetimeLines) {
          continue;
        }

        // Filter 2: Check if moving to firstUse would actually reduce lifetime below threshold.
        const firstUseOffset = firstUseOffsetByDefId.get(defId);

        if (firstUseOffset !== undefined) {
          const firstUseLoc = lineColumnAt(file.sourceText, firstUseOffset);

          if (useLoc.line - firstUseLoc.line > maxLifetimeLines) {
            // Even after moving, lifetime still exceeds threshold — not actionable.
            continue;
          }
        }

        // Filter 3: Check if any closure defined BEFORE the move target captures this variable.
        // Move target = firstUseOffset. If a closure defined between defOffset and firstUseOffset
        // captures this variable, moving the declaration past the closure would break it.
        if (firstUseOffset !== undefined) {
          const defOffset = defMeta.location;
          let blockedByClosure = false;

          for (const nf of nestedFunctions) {
            if (nf.startOffset > defOffset && nf.startOffset < firstUseOffset && nf.capturedNames.has(defMeta.name)) {
              blockedByClosure = true;

              break;
            }
          }

          if (blockedByClosure) {
            continue;
          }
        }

        longLived.push({
          variable: defMeta.name,
          defOffset: defMeta.location,
          lastUseOffset,
          lifetimeLines: lifetime,
        });
      }

      const contextBurden = longLived.length;

      for (const item of longLived) {
        const start = lineColumnAt(file.sourceText, item.defOffset);
        const end = lineColumnAt(file.sourceText, item.lastUseOffset);

        findings.push({
          kind: 'variable-lifetime',
          file: rel,
          span: { start, end },
          variable: item.variable,
          lifetimeLines: item.lifetimeLines,
          contextBurden,
        });
      }

      // Generate scope-narrowing findings
      const paramBindingNames = new Set(paramBindings.map(b => b.name));
      const bodyStatements =
        bodyNode !== undefined && bodyNode !== null && bodyNode.type === 'BlockStatement'
          ? (bodyNode.body as ReadonlyArray<Node>)
          : [];
      const narrowingFindings = checkScopeNarrowing(
        bodyStatements,
        analysis,
        localIndexByName,
        paramBindingNames,
        rel,
        file.sourceText,
        declScopeByIdLocation,
      );

      findings.push(...narrowingFindings);

      // Liveness pressure check
      const maxLiveVarsThreshold = options.maxLiveVariables ?? Infinity;
      const minFuncLines = options.minFunctionLines ?? Infinity;
      const fnOffsets = buildLineOffsets(file.sourceText);
      const functionSpan = {
        start: getLineColumn(fnOffsets, functionNode.start),
        end: getLineColumn(fnOffsets, functionNode.end),
      };
      const functionLineCount = functionSpan.end.line - functionSpan.start.line;

      if (functionLineCount >= minFuncLines) {
        const livenessResult = computeLiveness(
          analysis.cfg,
          analysis.useVarIndexesByNode,
          analysis.writeVarIndexesByNode,
          localIndexByName.size,
        );

        if (livenessResult.maxLiveCount >= maxLiveVarsThreshold) {
          const hotSpotPayload = analysis.nodePayloads[livenessResult.maxLiveNodeId];
          const hotSpotOffset = hotSpotPayload ? payloadOffset(hotSpotPayload as Node | ReadonlyArray<Node>) : functionNode.start;
          const hotSpotLine = lineColumnAt(file.sourceText, hotSpotOffset >= 0 ? hotSpotOffset : functionNode.start).line;

          findings.push({
            kind: 'liveness-pressure',
            file: rel,
            span: functionSpan,
            maxLiveVariables: livenessResult.maxLiveCount,
            functionLineCount,
            hotSpotLine,
          });
        }
      }

      // Mutation density check
      const maxMutationCount = options.maxMutationCount ?? Infinity;

      if (maxMutationCount >= Infinity) {
        continue;
      }

      const loopBodyRanges = collectLoopBodyRanges(bodyStatements);
      // Group non-declaration defs by variable name, excluding loop-body writes
      const nonDeclWriteCountByVar = new Map<string, { count: number; firstWriteOffset: number }>();

      for (const [defId, defMeta] of analysis.defs.entries()) {
        if (!defMeta) {
          continue;
        }

        if (defMeta.writeKind === 'declaration' || defMeta.writeKind === undefined) {
          continue;
        }

        const nodeId = analysis.defNodeIdByDefId[defId];

        if (nodeId === undefined) {
          continue;
        }

        const payload = analysis.nodePayloads[nodeId];
        const offset = payload !== null && payload !== undefined ? payloadOffset(payload as Node | ReadonlyArray<Node>) : -1;

        // Skip writes whose location cannot be determined or that are inside loop bodies
        if (offset < 0 || isOffsetInAnyRange(offset, loopBodyRanges)) {
          continue;
        }

        const existing = nonDeclWriteCountByVar.get(defMeta.name);

        if (existing === undefined) {
          nonDeclWriteCountByVar.set(defMeta.name, { count: 1, firstWriteOffset: defMeta.location });
        } else {
          nonDeclWriteCountByVar.set(defMeta.name, {
            count: existing.count + 1,
            firstWriteOffset: Math.min(existing.firstWriteOffset, defMeta.location),
          });
        }
      }

      for (const [varName, info] of nonDeclWriteCountByVar) {
        if (info.count > maxMutationCount) {
          const defLoc = lineColumnAt(file.sourceText, info.firstWriteOffset);

          findings.push({
            kind: 'mutation-density',
            file: rel,
            span: { start: defLoc, end: defLoc },
            variable: varName,
            mutationCount: info.count,
          });
        }
      }
    }
  }

  return findings;
};

export { analyzeVariableLifetime, createEmptyVariableLifetime };

export const __testing__ = { isPureInitializer };
