import type { Node } from 'oxc-parser';

import type { BitSet, CfgNodePayload, FunctionBodyAnalysis, NodeRecord, ParsedFile } from '../../engine/types';
import type {
  LivenessPressureFinding,
  MutationDensityFinding,
  ScopeNarrowingFinding,
  VariableLifetimeFinding,
} from '../../types';

import { normalizeFile } from '../../engine/ast/normalize-file';
import { collectFunctionNodes, isNodeRecord, isOxcNode } from '../../engine/ast/oxc-ast-utils';
import { intersectBitSet } from '../../engine/dataflow/dataflow';
import { computeLiveness } from '../../engine/dataflow/liveness';
import { analyzeFunctionBody, collectLocalVarIndexes, collectParameterBindings } from '../../engine/dataflow/reaching-defs';
import { collectVariables } from '../../engine/dataflow/variable-collector';
import { getFunctionSpan } from '../../engine/function-span';
import { getLineColumn } from '../../engine/source-position';

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

  const type = node.type;

  // Literals: number, string, boolean, null, undefined (as Identifier), regex
  if (type === 'Literal') {
    return true;
  }

  // Identifier reference (e.g. someVar, SomeType)
  if (type === 'Identifier') {
    return true;
  }

  // Binary expression: a + b, a > b, etc. — pure if both operands are pure
  if (type === 'BinaryExpression' && isNodeRecord(node)) {
    const left = isOxcNode(node.left) ? node.left : null;
    const right = isOxcNode(node.right) ? node.right : null;

    return isPureInitializer(left) && isPureInitializer(right);
  }

  // Logical expression: a && b, a || b, a ?? b
  if (type === 'LogicalExpression' && isNodeRecord(node)) {
    const left = isOxcNode(node.left) ? node.left : null;
    const right = isOxcNode(node.right) ? node.right : null;

    return isPureInitializer(left) && isPureInitializer(right);
  }

  // Conditional expression: cond ? a : b
  if (type === 'ConditionalExpression' && isNodeRecord(node)) {
    const test = isOxcNode(node.test) ? node.test : null;
    const consequent = isOxcNode(node.consequent) ? node.consequent : null;
    const alternate = isOxcNode(node.alternate) ? node.alternate : null;

    return isPureInitializer(test) && isPureInitializer(consequent) && isPureInitializer(alternate);
  }

  // Unary expression: typeof x, void 0, !, ~, +, -
  if (type === 'UnaryExpression' && isNodeRecord(node)) {
    const operator = node.operator;

    if (operator === 'delete') {
      return false;
    }

    const argument = isOxcNode(node.argument) ? node.argument : null;

    return isPureInitializer(argument);
  }

  // Template literal (without tag): `hello ${name}`
  if (type === 'TemplateLiteral' && isNodeRecord(node)) {
    const expressions = node.expressions;

    if (Array.isArray(expressions)) {
      for (const expr of expressions) {
        if (isOxcNode(expr) && !isPureInitializer(expr)) {
          return false;
        }
      }
    }

    return true;
  }

  // Tagged template is impure
  if (type === 'TaggedTemplateExpression') {
    return false;
  }

  // Array expression: [1, 2] — pure if no SpreadElement inside
  if (type === 'ArrayExpression' && isNodeRecord(node)) {
    const elements = node.elements;

    if (Array.isArray(elements)) {
      for (const el of elements) {
        if (!isOxcNode(el)) {
          continue;
        }

        if (el.type === 'SpreadElement') {
          return false;
        }

        if (!isPureInitializer(el)) {
          return false;
        }
      }
    }

    return true;
  }

  // Object expression: { a: 1 } — pure if no SpreadElement
  if (type === 'ObjectExpression' && isNodeRecord(node)) {
    const properties = node.properties;

    if (Array.isArray(properties)) {
      for (const prop of properties) {
        if (!isOxcNode(prop)) {
          continue;
        }

        if (prop.type === 'SpreadElement') {
          return false;
        }

        if (isNodeRecord(prop)) {
          // Computed key: { [expr]: val } — the key expression must also be pure
          if (prop.computed === true) {
            const key = isOxcNode(prop.key) ? prop.key : null;

            if (key !== null && !isPureInitializer(key)) {
              return false;
            }
          }

          const value = isOxcNode(prop.value) ? prop.value : null;

          if (value !== null && !isPureInitializer(value)) {
            return false;
          }
        }
      }
    }

    return true;
  }

  // Member expression: a.b, a.b.c — treat as pure (getter/proxy risk accepted per spec)
  if (type === 'MemberExpression' && isNodeRecord(node)) {
    const object = isOxcNode(node.object) ? node.object : null;

    return isPureInitializer(object);
  }

  // Chain expression: a?.b
  if (type === 'ChainExpression' && isNodeRecord(node)) {
    const expression = isOxcNode(node.expression) ? node.expression : null;

    return isPureInitializer(expression);
  }

  // TypeScript type casts — pure (just a type annotation)
  if (
    (type === 'TSAsExpression' ||
      type === 'TSSatisfiesExpression' ||
      type === 'TSNonNullExpression' ||
      type === 'TSTypeAssertion') &&
    isNodeRecord(node)
  ) {
    const expression = isOxcNode(node.expression) ? node.expression : null;

    return isPureInitializer(expression);
  }

  // Parenthesized expression
  if (type === 'ParenthesizedExpression' && isNodeRecord(node)) {
    const expression = isOxcNode(node.expression) ? node.expression : null;

    return isPureInitializer(expression);
  }

  // Impure: function calls, new, await, yield, assignment, update, spread, sequence
  if (
    type === 'CallExpression' ||
    type === 'NewExpression' ||
    type === 'AwaitExpression' ||
    type === 'YieldExpression' ||
    type === 'SpreadElement' ||
    type === 'AssignmentExpression' ||
    type === 'UpdateExpression' ||
    type === 'SequenceExpression'
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
    if (!isOxcNode(stmt)) {
      continue;
    }

    if (stmt.type === 'IfStatement' && isNodeRecord(stmt)) {
      const consequent = isOxcNode(stmt.consequent) ? stmt.consequent : null;
      const alternate = isOxcNode(stmt.alternate) ? stmt.alternate : null;

      if (consequent !== null && consequent.type === 'BlockStatement') {
        blocks.push({ type: 'if-consequent', start: consequent.start, end: consequent.end });
      }

      // alternate: only BlockStatement (not else-if chain)
      if (alternate !== null && alternate.type === 'BlockStatement') {
        blocks.push({ type: 'if-alternate', start: alternate.start, end: alternate.end });
      }

      continue;
    }

    if (stmt.type === 'SwitchStatement' && isNodeRecord(stmt)) {
      const cases = stmt.cases;

      if (!Array.isArray(cases)) {
        continue;
      }

      // Check for fall-through: every case must end with a terminal statement
      let hasFallThrough = false;

      for (const switchCase of cases) {
        if (!isOxcNode(switchCase) || !isNodeRecord(switchCase)) {
          continue;
        }

        const consequent = switchCase.consequent;

        if (!Array.isArray(consequent) || consequent.length === 0) {
          // Empty case (fall-through by definition)
          hasFallThrough = true;

          break;
        }

        const lastStmt = consequent[consequent.length - 1];

        if (!isOxcNode(lastStmt) || !isTerminalStatement(lastStmt)) {
          hasFallThrough = true;

          break;
        }
      }

      if (hasFallThrough) {
        continue;
      }

      for (const switchCase of cases) {
        if (!isOxcNode(switchCase)) {
          continue;
        }

        blocks.push({ type: 'switch-case', start: switchCase.start, end: switchCase.end });
      }

      continue;
    }

    if (stmt.type === 'TryStatement' && isNodeRecord(stmt)) {
      const block = isOxcNode(stmt.block) ? stmt.block : null;
      const handler = isOxcNode(stmt.handler) ? stmt.handler : null;
      // finalizer is handled only for exclusion (see checkScopeNarrowing)

      if (block !== null) {
        blocks.push({ type: 'try-block', start: block.start, end: block.end });
      }

      if (handler !== null && isNodeRecord(handler)) {
        const handlerBody = isOxcNode(handler.body) ? handler.body : null;

        if (handlerBody !== null) {
          blocks.push({ type: 'catch-block', start: handlerBody.start, end: handlerBody.end });
        }
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
    if (!isOxcNode(stmt) || stmt.type !== 'VariableDeclaration' || !isNodeRecord(stmt)) {
      continue;
    }

    const kind = stmt.kind;

    if (kind !== 'const' && kind !== 'let' && kind !== 'var') {
      continue;
    }

    const declarations = stmt.declarations;

    if (!Array.isArray(declarations)) {
      continue;
    }

    for (const decl of declarations) {
      if (!isOxcNode(decl) || !isNodeRecord(decl)) {
        continue;
      }

      const id = isOxcNode(decl.id) ? decl.id : null;

      if (id === null) {
        continue;
      }

      const isDestructuring = id.type === 'ObjectPattern' || id.type === 'ArrayPattern';

      result.set(decl.start, { kind: kind as 'const' | 'let' | 'var', isDestructuring });
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
      const usages = collectVariables(payload as CfgNodePayload, { includeNestedFunctions: false });

      for (const usage of usages) {
        if (usage.isWrite && nonLocalNames.has(usage.name)) {
          return true;
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
    if (!isOxcNode(stmt) || stmt.type !== 'TryStatement' || !isNodeRecord(stmt)) {
      continue;
    }

    const finalizer = isOxcNode(stmt.finalizer) ? stmt.finalizer : null;
    const block = isOxcNode(stmt.block) ? stmt.block : null;
    const handler = isOxcNode(stmt.handler) ? stmt.handler : null;

    if (finalizer !== null) {
      finalizerRanges.push({ start: finalizer.start, end: finalizer.end });
    }

    if (block !== null && handler !== null && isNodeRecord(handler)) {
      const handlerBody = isOxcNode(handler.body) ? handler.body : null;

      if (handlerBody !== null) {
        tryHandlerRanges.push({
          tryStart: block.start,
          tryEnd: block.end,
          catchStart: handlerBody.start,
          catchEnd: handlerBody.end,
        });
      }
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

    const usages = collectVariables(payload as CfgNodePayload, { includeNestedFunctions: false });

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

  return allSiteOffsetsByVarIndex;
};

const findInitNode = (bodyStatements: ReadonlyArray<Node>, defLocation: number): Node | null => {
  for (const stmt of bodyStatements) {
    if (!isOxcNode(stmt) || stmt.type !== 'VariableDeclaration' || !isNodeRecord(stmt)) {
      continue;
    }

    const declarations = stmt.declarations;

    if (!Array.isArray(declarations)) {
      continue;
    }

    for (const decl of declarations) {
      if (!isOxcNode(decl) || !isNodeRecord(decl)) {
        continue;
      }

      if (decl.start !== defLocation) {
        continue;
      }

      return isOxcNode(decl.init) ? decl.init : null;
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
    const declLoc = getLineColumn(sourceText, defMeta.location);
    const blockStartLoc = getLineColumn(sourceText, matchingBlock.start);
    const blockEndLoc = getLineColumn(sourceText, matchingBlock.end);

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

const LOOP_STATEMENT_TYPES = new Set(['ForStatement', 'WhileStatement', 'DoWhileStatement', 'ForInStatement', 'ForOfStatement']);

/**
 * Recursively collects ranges of all loop statements anywhere in the given
 * AST node list (any depth).  For ForStatement the **entire** statement range
 * is used so that init/test/update clause writes (e.g. `i++`) are also
 * suppressed.  For other loop types the body range is sufficient.
 */
const collectLoopBodyRanges = (stmts: ReadonlyArray<Node>): ReadonlyArray<LoopBodyRange> => {
  const ranges: LoopBodyRange[] = [];

  const visit = (node: Node): void => {
    if (!isNodeRecord(node)) {
      return;
    }

    if (LOOP_STATEMENT_TYPES.has(node.type)) {
      // ForStatement: use full statement range to cover init/test/update clauses
      if (node.type === 'ForStatement') {
        ranges.push({ start: node.start, end: node.end });
      } else {
        const body = isOxcNode(node.body) ? (node.body as Node) : null;

        if (body !== null) {
          ranges.push({ start: body.start, end: body.end });
        }
      }
    }

    // Recurse into all child Node values
    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end') {
        continue;
      }

      const value = (node as NodeRecord)[key];

      if (isOxcNode(value as Node)) {
        visit(value as Node);
      } else if (Array.isArray(value)) {
        for (const child of value as unknown[]) {
          if (isOxcNode(child as Node)) {
            visit(child as Node);
          }
        }
      }
    }
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
      const bodyValue = isNodeRecord(functionNode) ? (functionNode as NodeRecord).body : undefined;
      const bodyNode = isOxcNode(bodyValue) || Array.isArray(bodyValue) ? bodyValue : undefined;

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

        const defLoc = getLineColumn(file.sourceText, defMeta.location);
        const useLoc = getLineColumn(file.sourceText, lastUseOffset);
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
        const start = getLineColumn(file.sourceText, item.defOffset);
        const end = getLineColumn(file.sourceText, item.lastUseOffset);

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
      const bodyRec = isNodeRecord(bodyNode) ? (bodyNode as NodeRecord) : null;
      const bodyStatements = Array.isArray(bodyNode)
        ? (bodyNode as ReadonlyArray<Node>)
        : bodyRec !== null && Array.isArray(bodyRec.body)
          ? (bodyRec.body as ReadonlyArray<Node>)
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
      const functionSpan = getFunctionSpan(functionNode, file.sourceText);
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
          const hotSpotLine = getLineColumn(file.sourceText, hotSpotOffset >= 0 ? hotSpotOffset : functionNode.start).line;

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
            const defLoc = getLineColumn(file.sourceText, info.firstWriteOffset);

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
