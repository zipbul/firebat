import type { Node } from 'oxc-parser';

import type { NodeValue, ParsedFile } from '../../engine/types';
import type { EarlyReturnItem, EarlyReturnKind, SourceSpan } from '../../types';

import { resolveFunctionBody, shouldIncreaseDepth } from '../../engine/cfg/control-flow-utils';
import { collectFunctionItems } from '../../engine/function-items';
import { getFunctionSpan } from '../../engine/function-span';
import { getLineColumn } from '../../engine/source-position';
import {
  getNodeHeader,
  isFunctionNode,
  isNodeRecord,
  isOxcNode,
  isOxcNodeArray,
  visitOxcChildren,
} from '../../engine/ast/oxc-ast-utils';

const createEmptyEarlyReturn = (): ReadonlyArray<EarlyReturnItem> => [];

// ── Reused helpers ──────────────────────────────────────────────────

export const isExitStatement = (value: NodeValue): boolean => {
  if (!isOxcNode(value)) {
    return false;
  }

  return value.type === 'ReturnStatement' || value.type === 'ThrowStatement';
};

/** Check if the last statement of a block (or a bare statement) is an exit (return/throw). Multi-statement blocks allowed. */
export const isExitBlock = (value: NodeValue): boolean => {
  if (!isOxcNode(value)) {
    return false;
  }

  if (value.type === 'ReturnStatement' || value.type === 'ThrowStatement') {
    return true;
  }

  if (value.type !== 'BlockStatement') {
    return false;
  }

  if (!isNodeRecord(value)) {
    return false;
  }

  const body = value.body;

  if (!Array.isArray(body) || body.length === 0) {
    return false;
  }

  const last = body[body.length - 1];

  return isExitStatement(last as NodeValue);
};

/** Check if the last statement of a block is a loop-control (continue/break) or exit (return/throw). */
export const isLoopGuardBlock = (value: NodeValue): boolean => {
  if (!isOxcNode(value)) {
    return false;
  }

  if (
    value.type === 'ContinueStatement' ||
    value.type === 'BreakStatement' ||
    value.type === 'ReturnStatement' ||
    value.type === 'ThrowStatement'
  ) {
    return true;
  }

  if (value.type !== 'BlockStatement') {
    return false;
  }

  if (!isNodeRecord(value)) {
    return false;
  }

  const body = value.body;

  if (!Array.isArray(body) || body.length === 0) {
    return false;
  }

  const last = body[body.length - 1];

  if (!isOxcNode(last)) {
    return false;
  }

  return (
    last.type === 'ContinueStatement' ||
    last.type === 'BreakStatement' ||
    last.type === 'ReturnStatement' ||
    last.type === 'ThrowStatement'
  );
};

export const countStatements = (node: NodeValue): number => {
  if (!isOxcNode(node)) {
    return 0;
  }

  if (node.type !== 'BlockStatement') {
    // For else-if chains: when alternate is an IfStatement, recursively
    // count all statements across the entire chain to get a true total.
    if (node.type === 'IfStatement' && isNodeRecord(node)) {
      const consequentCount = countStatements(node.consequent as NodeValue);
      const alternateCount = node.alternate != null ? countStatements(node.alternate as NodeValue) : 0;

      return consequentCount + alternateCount;
    }

    return 1;
  }

  if (!isNodeRecord(node)) {
    return 0;
  }

  const body = node.body;

  return Array.isArray(body) ? body.length : 0;
};

export const endsWithReturnOrThrow = (node: NodeValue): boolean => {
  if (!isOxcNode(node)) {
    return false;
  }

  if (node.type === 'ReturnStatement' || node.type === 'ThrowStatement') {
    return true;
  }

  if (node.type !== 'BlockStatement') {
    return false;
  }

  if (!isNodeRecord(node)) {
    return false;
  }

  const body = node.body;

  if (!Array.isArray(body) || body.length === 0) {
    return false;
  }

  const last = body[body.length - 1];

  return isExitStatement(last as NodeValue);
};

/** Check if the last statement of a block is a continue or break. */
const endsWithLoopExit = (value: NodeValue): boolean => {
  if (!isOxcNode(value)) {
    return false;
  }

  if (value.type === 'ContinueStatement' || value.type === 'BreakStatement') {
    return true;
  }

  if (value.type !== 'BlockStatement') {
    return false;
  }

  if (!isNodeRecord(value)) {
    return false;
  }

  const body = value.body;

  if (!Array.isArray(body) || body.length === 0) {
    return false;
  }

  const last = body[body.length - 1];

  if (!isOxcNode(last)) {
    return false;
  }

  return last.type === 'ContinueStatement' || last.type === 'BreakStatement';
};

// ── New types ───────────────────────────────────────────────────────

interface Opportunity {
  kind: EarlyReturnKind;
  span: SourceSpan;
  depthReduction: number;
  statementsAffected: number;
}

// ── Loop detection ──────────────────────────────────────────────────

const isLoopNodeType = (nodeType: string): boolean => {
  return (
    nodeType === 'ForStatement' ||
    nodeType === 'ForInStatement' ||
    nodeType === 'ForOfStatement' ||
    nodeType === 'WhileStatement' ||
    nodeType === 'DoWhileStatement'
  );
};

// ── Wrapping-if detection ───────────────────────────────────────────

/** Count statements in the consequent block of an if statement */
const countConsequentStatements = (ifNode: NodeValue): number => {
  if (!isNodeRecord(ifNode)) {
    return 0;
  }

  return countStatements(ifNode.consequent as NodeValue);
};

/**
 * Detect wrapping-if: the last statement of a block is an IfStatement with no alternate,
 * whose consequent has 2+ statements. Inverting + early exit reduces nesting by 1.
 */
const detectWrappingIf = (
  bodyStatements: ReadonlyArray<NodeValue>,
  sourceText: string,
): Opportunity | null => {
  if (bodyStatements.length === 0) {
    return null;
  }

  const last = bodyStatements[bodyStatements.length - 1];

  if (!isOxcNode(last) || last.type !== 'IfStatement') {
    return null;
  }

  if (!isNodeRecord(last)) {
    return null;
  }

  const alternateValue = last.alternate;

  // alternate must be absent (pure wrapping-if)
  if (alternateValue !== null && alternateValue !== undefined) {
    return null;
  }

  const stmtCount = countConsequentStatements(last as NodeValue);

  if (stmtCount < 2) {
    return null;
  }

  const ifNode = last as Node;
  const spanStart = getLineColumn(sourceText, ifNode.start);
  const spanEnd = getLineColumn(sourceText, ifNode.end);

  // Verify that an exit is possible: for loop body → continue, for function body → return/throw
  // We don't check the exit type here — the pattern is valid as long as the block scope allows an exit
  // insideLoop is only used to determine what exit would be used, not to gatekeep detection

  return {
    kind: 'wrapping-if',
    span: { start: spanStart, end: spanEnd },
    depthReduction: 1,
    statementsAffected: stmtCount,
  };
};

// ── Cascade-guard detection ─────────────────────────────────────────

/**
 * Detect cascade-guard: an else-if chain where all non-final branches end in exit,
 * so the chain can be flattened to sequential guards.
 */
const detectCascadeGuard = (
  ifNode: NodeValue,
  insideLoop: boolean,
  sourceText: string,
): Opportunity | null => {
  if (!isOxcNode(ifNode) || ifNode.type !== 'IfStatement') {
    return null;
  }

  if (!isNodeRecord(ifNode)) {
    return null;
  }

  // Must have an alternate to be a chain
  if (ifNode.alternate === null || ifNode.alternate === undefined) {
    return null;
  }

  let chainLength = 0;
  let current: NodeValue = ifNode;

  // Walk the chain: each link must have consequent ending in exit
  while (isOxcNode(current) && current.type === 'IfStatement' && isNodeRecord(current)) {
    const consequent = current.consequent as NodeValue;
    const alternate = current.alternate;

    // Check if consequent ends with exit (for loop context: also allow continue/break)
    const isGuard = insideLoop ? isLoopGuardBlock(consequent) : isExitBlock(consequent);

    if (!isGuard) {
      return null;
    }

    chainLength += 1;

    // If alternate is another IfStatement, continue the chain
    if (isOxcNode(alternate) && (alternate as Node).type === 'IfStatement') {
      current = alternate as NodeValue;
    } else {
      // alternate is the final branch (could be BlockStatement or null)
      break;
    }
  }

  if (chainLength < 2) {
    return null;
  }

  // Get the final branch's statement count
  // current is the last IfStatement in the chain — its alternate is the final branch
  if (!isNodeRecord(current)) {
    return null;
  }

  const finalBranch = current.alternate as NodeValue;

  if (finalBranch === null || finalBranch === undefined) {
    return null;
  }

  const finalCount = countStatements(finalBranch);

  if (finalCount === 0) {
    return null;
  }

  const node = ifNode as Node;
  const spanStart = getLineColumn(sourceText, node.start);
  const spanEnd = getLineColumn(sourceText, node.end);

  return {
    kind: 'cascade-guard',
    span: { start: spanStart, end: spanEnd },
    depthReduction: chainLength,
    statementsAffected: finalCount,
  };
};

// ── Main analyzer ───────────────────────────────────────────────────

const analyzeFunctionNode = (
  functionNode: Node,
  filePath: string,
  sourceText: string,
  parent: Node | null,
): EarlyReturnItem | null => {
  const bodyValue = resolveFunctionBody(functionNode);

  if (bodyValue === null || bodyValue === undefined) {
    return null;
  }

  let maxDepth = 0;
  const opportunities: Opportunity[] = [];
  const skipNodes = new WeakSet<object>();

  const visit = (value: NodeValue, depth: number, insideLoop: boolean): void => {
    if (isOxcNodeArray(value)) {
      for (const entry of value) {
        visit(entry, depth, insideLoop);
      }

      return;
    }

    if (!isOxcNode(value)) {
      return;
    }

    // Skip nodes that are part of a detected cascade-guard chain
    if (skipNodes.has(value as object)) {
      return;
    }

    // Respect function boundaries — don't descend into nested functions
    if (value !== functionNode && isFunctionNode(value)) {
      return;
    }

    const nodeType = value.type;
    const nextDepth = shouldIncreaseDepth(nodeType) ? depth + 1 : depth;

    if (nextDepth > maxDepth) {
      maxDepth = nextDepth;
    }

    if (nodeType === 'IfStatement' && isNodeRecord(value)) {
      const alternateValue = value.alternate;

      if (alternateValue !== null && alternateValue !== undefined) {
        // 1. Try cascade-guard
        const cascade = detectCascadeGuard(value as NodeValue, insideLoop, sourceText);

        if (cascade !== null) {
          opportunities.push(cascade);

          // Mark all sub-IfStatements in the chain to skip re-analysis
          let chainNode: NodeValue = value;

          while (isOxcNode(chainNode) && chainNode.type === 'IfStatement' && isNodeRecord(chainNode)) {
            const alt = chainNode.alternate;

            if (isOxcNode(alt) && (alt as Node).type === 'IfStatement') {
              skipNodes.add(alt as object);
              chainNode = alt as NodeValue;
            } else {
              break;
            }
          }
        } else {
          // 2. Try invertible-if-else — skip when alternate is an else-if chain
          //    (countStatements would sum the entire chain, producing a false positive)
          const alternateNode = alternateValue as NodeValue;
          const isElseIfChain = isOxcNode(alternateNode) && alternateNode.type === 'IfStatement';

          if (!isElseIfChain) {
          const consequentValue = value.consequent as NodeValue;
          const consequentCount = countStatements(consequentValue);
          const alternateCount = countStatements(alternateNode);

          if (consequentCount > 0 && alternateCount > 0) {
            const shortCount = consequentCount <= alternateCount ? consequentCount : alternateCount;
            const longCount = consequentCount <= alternateCount ? alternateCount : consequentCount;
            const shortNode = consequentCount <= alternateCount ? consequentValue : alternateNode;

            const shortExits = endsWithReturnOrThrow(shortNode) || (insideLoop && endsWithLoopExit(shortNode));

            if (shortCount <= 3 && shortExits && longCount >= shortCount * 2) {
              const ifNode = value as Node;
              const spanStart = getLineColumn(sourceText, ifNode.start);
              const spanEnd = getLineColumn(sourceText, ifNode.end);

              opportunities.push({
                kind: 'invertible-if-else',
                span: { start: spanStart, end: spanEnd },
                depthReduction: 1,
                statementsAffected: longCount,
              });
            }
          }
          }
        }
      }
    }

    // Check for wrapping-if in block statements
    if (nodeType === 'BlockStatement' && isNodeRecord(value)) {
      const bodyArr = value.body;

      if (Array.isArray(bodyArr) && bodyArr.length > 0) {
        const wrapping = detectWrappingIf(bodyArr as ReadonlyArray<NodeValue>, sourceText);

        if (wrapping !== null) {
          opportunities.push(wrapping);
        }
      }
    }

    if (!isNodeRecord(value)) {
      return;
    }

    visitOxcChildren(value, entry => {
      const isLoop = isLoopNodeType(nodeType);

      visit(entry, nextDepth, insideLoop || isLoop);
    });
  };

  visit(bodyValue as NodeValue, 0, false);

  if (opportunities.length === 0) {
    return null;
  }

  // score = Σ(depthReduction × statementsAffected)
  const totalScore = opportunities.reduce((sum, o) => sum + o.depthReduction * o.statementsAffected, 0);

  if (totalScore < 2) {
    return null;
  }

  // kind = highest impact opportunity
  const primaryOpportunity = opportunities.reduce((best, o) =>
    o.depthReduction * o.statementsAffected > best.depthReduction * best.statementsAffected ? o : best,
  );

  const header = getNodeHeader(functionNode, parent);
  const span = getFunctionSpan(functionNode, sourceText);

  return {
    kind: primaryOpportunity.kind,
    file: filePath,
    header,
    span,
    ...(opportunities.length > 0 ? { opportunitySpans: opportunities.map(o => o.span) } : {}),
    metrics: {
      maxDepth,
      depthReduction: opportunities.reduce((sum, o) => sum + o.depthReduction, 0),
      statementsAffected: opportunities.reduce((sum, o) => sum + o.statementsAffected, 0),
    },
    score: totalScore,
  };
};

const analyzeEarlyReturn = (files: ReadonlyArray<ParsedFile>): ReadonlyArray<EarlyReturnItem> => {
  if (files.length === 0) {
    return createEmptyEarlyReturn();
  }

  return collectFunctionItems(files, analyzeFunctionNode).filter((item): item is EarlyReturnItem => item !== null);
};

export { analyzeEarlyReturn, createEmptyEarlyReturn };
