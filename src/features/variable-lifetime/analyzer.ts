import type { Function as OxcFunction, Node } from 'oxc-parser';

import { buildLineOffsets, getLineColumn } from '@zipbul/gildash';

import type { BitSet, FunctionBodyAnalysis, ParsedFile } from '../../engine/types';
import type {
  LivenessPressureFinding,
  MutationDensityFinding,
  ScopeNarrowingFinding,
  VariableLifetimeFinding,
} from '../../types';

import { normalizeFile } from '../../engine/ast/normalize-file';
import { collectFunctionNodes, forEachChildNode } from '../../engine/ast/oxc-ast-utils';
import { intersectBitSet } from '../../engine/dataflow/dataflow';
import { computeLiveness } from '../../engine/dataflow/liveness';
import { analyzeFunctionBody, collectLocalVarIndexes, collectParameterBindings } from '../../engine/dataflow/reaching-defs';
import { collectVariables } from '../../engine/dataflow/variable-collector';

const lineColumnAt = (sourceText: string, offset: number) => getLineColumn(buildLineOffsets(sourceText), offset);

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
    return isPureInitializer(node.left as Node) && isPureInitializer(node.right as Node);
  }

  // Logical expression: a && b, a || b, a ?? b
  if (node.type === 'LogicalExpression') {
    return isPureInitializer(node.left as Node) && isPureInitializer(node.right as Node);
  }

  // Conditional expression: cond ? a : b
  if (node.type === 'ConditionalExpression') {
    return (
      isPureInitializer(node.test as Node) &&
      isPureInitializer(node.consequent as Node) &&
      isPureInitializer(node.alternate as Node)
    );
  }

  // Unary expression: typeof x, void 0, !, ~, +, -
  if (node.type === 'UnaryExpression') {
    if (node.operator === 'delete') {
      return false;
    }

    return isPureInitializer(node.argument as Node);
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
          if (!isPureInitializer(prop.key as Node)) {
            return false;
          }
        }

        if (!isPureInitializer(prop.value as Node)) {
          return false;
        }
      }
    }

    return true;
  }

  // Member expression: a.b, a.b.c — treat as pure (getter/proxy risk accepted per spec)
  if (node.type === 'MemberExpression') {
    return isPureInitializer(node.object as Node);
  }

  // Chain expression: a?.b
  if (node.type === 'ChainExpression') {
    return isPureInitializer(node.expression as Node);
  }

  // TypeScript type casts — pure (just a type annotation)
  if (
    node.type === 'TSAsExpression' ||
    node.type === 'TSSatisfiesExpression' ||
    node.type === 'TSNonNullExpression' ||
    node.type === 'TSTypeAssertion'
  ) {
    return isPureInitializer(node.expression as Node);
  }

  // Parenthesized expression
  if (node.type === 'ParenthesizedExpression') {
    return isPureInitializer(node.expression as Node);
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
      const consequent = stmt.consequent as Node | null;
      const alternate = stmt.alternate !== null ? (stmt.alternate as Node) : null;

      if (consequent !== null && consequent.type === 'BlockStatement') {
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

        if (lastStmt === undefined || !isTerminalStatement(lastStmt)) {
          hasFallThrough = true;

          break;
        }
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
      const block = stmt.block as Node;
      const handler = stmt.handler !== null ? (stmt.handler as Node) : null;
      // finalizer is handled only for exclusion (see checkScopeNarrowing)

      blocks.push({ type: 'try-block', start: block.start, end: block.end });

      if (handler !== null && handler.type === 'CatchClause') {
        const handlerBody = handler.body as Node;

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

// ── Referenced variable name collection ──────────────────────────────────────

/**
 * Collects all Identifier names referenced by the initializer expression
 * (excluding MemberExpression non-computed property names).
 */
const collectReferencedVarNames = (initNode: Node | null | undefined): ReadonlySet<string> => {
  const names = new Set<string>();

  if (initNode === null || initNode === undefined) {
    return names;
  }

  const usages = collectVariables(initNode, { includeNestedFunctions: false });

  for (const usage of usages) {
    if (usage.isRead) {
      names.add(usage.name);
    }
  }

  return names;
};

// ── Intervening write check ───────────────────────────────────────────────────

interface FinalizerRange {
  readonly start: number;
  readonly end: number;
}

interface TryCatchRange {
  readonly tryStart: number;
  readonly tryEnd: number;
  readonly catchStart: number;
  readonly catchEnd: number;
}

interface TryCatchRangeCollection {
  readonly finalizerRanges: ReadonlyArray<FinalizerRange>;
  readonly tryHandlerRanges: ReadonlyArray<TryCatchRange>;
}

/**
 * Returns true if any variable referenced by the initializer has a write
 * in CFG nodes whose payload offset falls in [declOffset, blockStart).
 */
const hasInterveningWrites = (
  referencedVarNames: ReadonlySet<string>,
  declOffset: number,
  blockStartOffset: number,
  analysis: FunctionBodyAnalysis,
  localIndexByName: Map<string, number>,
): boolean => {
  if (referencedVarNames.size === 0) {
    return false;
  }

  // Separate referenced names into local vs non-local
  const localVarIndexes = new Set<number>();
  const nonLocalNames = new Set<string>();

  for (const name of referencedVarNames) {
    const idx = localIndexByName.get(name);

    if (typeof idx === 'number') {
      localVarIndexes.add(idx);
    } else {
      nonLocalNames.add(name);
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
      const payloadNodes: ReadonlyArray<Node> = Array.isArray(payload) ? (payload as ReadonlyArray<Node>) : [payload as Node];

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
  const finalizerRanges: FinalizerRange[] = [];
  const tryHandlerRanges: TryCatchRange[] = [];

  for (const stmt of bodyStatements) {
    if (stmt.type !== 'TryStatement') {
      continue;
    }

    const finalizer = stmt.finalizer !== null ? (stmt.finalizer as Node) : null;
    const block = stmt.block as Node;
    const handler = stmt.handler !== null ? (stmt.handler as Node) : null;

    if (finalizer !== null) {
      finalizerRanges.push({ start: finalizer.start, end: finalizer.end });
    }

    if (handler !== null && handler.type === 'CatchClause') {
      const handlerBody = handler.body as Node;

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

const collectAllSiteOffsets = (analysis: FunctionBodyAnalysis, localIndexByName: Map<string, number>): Map<number, number[]> => {
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

    const payloadNodes: ReadonlyArray<Node> = Array.isArray(payload) ? (payload as ReadonlyArray<Node>) : [payload as Node];

    for (const payloadNode of payloadNodes) {
      const usages = collectVariables(payloadNode, { includeNestedFunctions: false });

      for (const usage of usages) {
        const varIndex = localIndexByName.get(usage.name);

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

      const init = decl.init;

      return init ?? null;
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
): ReadonlyArray<ScopeNarrowingFinding> => {
  const findings: ScopeNarrowingFinding[] = [];
  const scopeBlocks = collectScopeBlocks(bodyStatements);

  if (scopeBlocks.length === 0) {
    return findings;
  }

  const varDeclInfo = collectVarDeclInfo(bodyStatements);
  const { finalizerRanges, tryHandlerRanges } = collectFinalizerAndTryCatchRanges(bodyStatements);
  const allSiteOffsetsByVarIndex = collectAllSiteOffsets(analysis, localIndexByName);

  const isInFinalizer = (offset: number): boolean => finalizerRanges.some(r => offset >= r.start && offset < r.end);

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

    // Get the variable index
    const varIndex = localIndexByName.get(defMeta.name);

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
    if (allSiteOffsets.some(o => isInFinalizer(o))) {
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

      if (allInBlock) {
        matchingBlock = block;

        break;
      }
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
    const referencedVarNames = collectReferencedVarNames(initNode);

    if (hasInterveningWrites(referencedVarNames, defMeta.location, matchingBlock.start, analysis, localIndexByName)) {
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

interface LoopBodyRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Recursively collects ranges of all loop statements anywhere in the given
 * AST node list (any depth).  For ForStatement the **entire** statement range
 * is used so that init/test/update clause writes (e.g. `i++`) are also
 * suppressed.  For other loop types the body range is sufficient.
 */
const collectLoopBodyRanges = (stmts: ReadonlyArray<Node>): ReadonlyArray<LoopBodyRange> => {
  const ranges: LoopBodyRange[] = [];

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
      const localIndexByName = collectLocalVarIndexes(functionNode);

      if (localIndexByName.size === 0) {
        continue;
      }

      const paramBindings = collectParameterBindings(functionNode);
      const fn = functionNode as OxcFunction;
      const bodyNode = fn.body ?? undefined;

      if (bodyNode === undefined) {
        continue;
      }

      const analysis = analyzeFunctionBody(bodyNode, localIndexByName, paramBindings);
      const { defs, reachingInByNode, useVarIndexesByNode, nodePayloads, defsOfVar } = analysis;
      // Compute last use offset for each defId via reaching definitions.
      const lastUseOffsetByDefId = new Map<number, number>();

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
            const existing = lastUseOffsetByDefId.get(defId);

            if (existing === undefined || useOffset > existing) {
              lastUseOffsetByDefId.set(defId, useOffset);
            }
          }
        }
      }

      // Generate findings for long-lived definitions.
      const longLived: LongLivedDef[] = [];

      for (const [defId, lastUseOffset] of lastUseOffsetByDefId) {
        const defMeta = defs[defId];

        if (!defMeta) {
          continue;
        }

        const defLoc = lineColumnAt(file.sourceText, defMeta.location);
        const useLoc = lineColumnAt(file.sourceText, lastUseOffset);
        const lifetime = useLoc.line - defLoc.line;

        if (lifetime > maxLifetimeLines) {
          longLived.push({
            variable: defMeta.name,
            defOffset: defMeta.location,
            lastUseOffset,
            lifetimeLines: lifetime,
          });
        }
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

      if (maxMutationCount < Infinity) {
        const loopBodyRanges = collectLoopBodyRanges(bodyStatements);

        const isInLoopBody = (offset: number): boolean => loopBodyRanges.some(r => offset >= r.start && offset < r.end);

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
          if (offset < 0 || isInLoopBody(offset)) {
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
  }

  return findings;
};

export { analyzeVariableLifetime, createEmptyVariableLifetime };

export const __testing__ = { isPureInitializer };
