import type { Node } from 'oxc-parser';

import { buildLineOffsets, getLineColumn } from '@zipbul/gildash';

import type { ParsedFile } from '../../engine/types';
import type { EarlyReturnItem, EarlyReturnKind, SourceSpan } from '../../types';

import { forEachChildNode, getNodeHeader, isFunctionNode } from '../../engine/ast/oxc-ast-utils';
import { resolveFunctionBody, shouldIncreaseDepth } from '../../engine/cfg/control-flow-utils';
import { collectFunctionItems } from '../../engine/function-items';

const nodeSpan = (node: Node, sourceText: string): SourceSpan => {
  const offsets = buildLineOffsets(sourceText);

  return {
    start: getLineColumn(offsets, node.start),
    end: getLineColumn(offsets, node.end),
  };
};

const createEmptyEarlyReturn = (): ReadonlyArray<EarlyReturnItem> => [];

// ── Reused helpers ──────────────────────────────────────────────────

export const isExitStatement = (node: Node): boolean => {
  return node.type === 'ReturnStatement' || node.type === 'ThrowStatement';
};

/** Check if the last statement of a block (or a bare statement) is an exit (return/throw). Multi-statement blocks allowed. */
export const isExitBlock = (node: Node): boolean => {
  if (node.type === 'ReturnStatement' || node.type === 'ThrowStatement') {
    return true;
  }

  if (node.type !== 'BlockStatement') {
    return false;
  }

  const body = node.body;

  if (!Array.isArray(body) || body.length === 0) {
    return false;
  }

  const last = body[body.length - 1] as Node;

  return isExitStatement(last);
};

/** Check if the last statement of a block is a loop-control (continue/break) or exit (return/throw). */
export const isLoopGuardBlock = (node: Node): boolean => {
  if (
    node.type === 'ContinueStatement' ||
    node.type === 'BreakStatement' ||
    node.type === 'ReturnStatement' ||
    node.type === 'ThrowStatement'
  ) {
    return true;
  }

  if (node.type !== 'BlockStatement') {
    return false;
  }

  const body = node.body;

  if (!Array.isArray(body) || body.length === 0) {
    return false;
  }

  const last = body[body.length - 1] as Node;

  return (
    last.type === 'ContinueStatement' ||
    last.type === 'BreakStatement' ||
    last.type === 'ReturnStatement' ||
    last.type === 'ThrowStatement'
  );
};

export const countStatements = (node: Node): number => {
  if (node.type !== 'BlockStatement') {
    // For else-if chains: when alternate is an IfStatement, recursively
    // count all statements across the entire chain to get a true total.
    if (node.type === 'IfStatement') {
      const consequentCount = countStatements(node.consequent as Node);
      const alternateCount = node.alternate !== null ? countStatements(node.alternate as Node) : 0;

      return consequentCount + alternateCount;
    }

    return 1;
  }

  const body = node.body;

  return Array.isArray(body) ? body.length : 0;
};

export const endsWithReturnOrThrow = (node: Node): boolean => {
  if (node.type === 'ReturnStatement' || node.type === 'ThrowStatement') {
    return true;
  }

  if (node.type !== 'BlockStatement') {
    return false;
  }

  const body = node.body;

  if (!Array.isArray(body) || body.length === 0) {
    return false;
  }

  const last = body[body.length - 1] as Node;

  return isExitStatement(last);
};

/** Check if the last statement of a block is a continue or break. */
const endsWithLoopExit = (node: Node): boolean => {
  if (node.type === 'ContinueStatement' || node.type === 'BreakStatement') {
    return true;
  }

  if (node.type !== 'BlockStatement') {
    return false;
  }

  const body = node.body;

  if (!Array.isArray(body) || body.length === 0) {
    return false;
  }

  const last = body[body.length - 1] as Node;

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

// ── Consecutive trailing-if detection ────────────────────────────────

export const countConsecutiveTrailingIfs = (stmts: ReadonlyArray<Node>): number => {
  let count = 0;
  let startIdx = stmts.length - 1;

  // Allow skipping a final exit statement — dispatch patterns often end with a default return/throw
  if (startIdx >= 0 && isExitStatement(stmts[startIdx]!)) {
    startIdx -= 1;
  }

  for (let i = startIdx; i >= 0; i--) {
    const stmt = stmts[i]!;

    if (stmt.type === 'IfStatement' && stmt.alternate == null) {
      count += 1;
    } else {
      break;
    }
  }

  return count;
};

// ── Wrapping-if detection ───────────────────────────────────────────

/** Count statements in the consequent block of an if statement */
const countConsequentStatements = (ifNode: Node): number => {
  if (ifNode.type !== 'IfStatement') {
    return 0;
  }

  return countStatements(ifNode.consequent as Node);
};

/**
 * Detect wrapping-if: the last statement of a block is an IfStatement with no alternate,
 * whose consequent has 2+ statements. Inverting + early exit reduces nesting by 1.
 */
const detectWrappingIf = (bodyStatements: ReadonlyArray<Node>, sourceText: string): Opportunity | null => {
  if (bodyStatements.length === 0) {
    return null;
  }

  const last = bodyStatements[bodyStatements.length - 1]!;

  if (last.type !== 'IfStatement') {
    return null;
  }

  const alternateValue = last.alternate;

  // alternate must be absent (pure wrapping-if)
  if (alternateValue !== null) {
    return null;
  }

  const stmtCount = countConsequentStatements(last);

  if (stmtCount < 2) {
    return null;
  }

  return {
    kind: 'wrapping-if',
    span: nodeSpan(last, sourceText),
    depthReduction: 1,
    statementsAffected: stmtCount,
  };
};

// ── Implicit-else detection ─────────────────────────────────────────

/**
 * Detect implicit-else: an if (no else) whose consequent ends with exit,
 * followed by a short remaining tail — the implicit "else" branch.
 * Inverting the condition turns the tail into a guard clause and unindents the consequent.
 */
const detectImplicitElse = (
  bodyStatements: ReadonlyArray<Node>,
  insideLoop: boolean,
  sourceText: string,
): ReadonlyArray<Opportunity> => {
  if (bodyStatements.length < 2) {
    return [];
  }

  const results: Opportunity[] = [];

  for (let i = 0; i < bodyStatements.length; i++) {
    const stmt = bodyStatements[i]!;

    if (stmt.type !== 'IfStatement') {
      continue;
    }

    // Must have no alternate (no else)
    if (stmt.alternate !== null) {
      continue;
    }

    const consequent = stmt.consequent as Node;
    // Consequent must end with exit (return/throw) or loop-exit (continue/break)
    const exits = insideLoop ? isLoopGuardBlock(consequent) : isExitBlock(consequent);

    if (!exits) {
      continue;
    }

    const consequentCount = countStatements(consequent);
    const remainingCount = bodyStatements.length - i - 1;

    if (remainingCount === 0) {
      continue; // no tail → wrapping-if territory
    }

    // Only detect when consequent is the long side (the code that benefits from unindenting)
    if (consequentCount < remainingCount * 2) {
      continue;
    }

    if (remainingCount > 3) {
      continue;
    }

    // In function context: remaining (short side) must end with exit so it can become a guard
    // In loop context: no requirement — loop naturally continues
    if (!insideLoop) {
      const lastRemaining = bodyStatements[bodyStatements.length - 1]!;

      if (!isExitStatement(lastRemaining)) {
        continue;
      }
    }

    results.push({
      kind: 'implicit-else',
      span: nodeSpan(stmt, sourceText),
      depthReduction: 1,
      statementsAffected: consequentCount,
    });
  }

  return results;
};

// ── Cascade-guard detection ─────────────────────────────────────────

/**
 * Detect cascade-guard: an else-if chain where all non-final branches end in exit,
 * so the chain can be flattened to sequential guards.
 */
const detectCascadeGuard = (ifNode: Node, insideLoop: boolean, sourceText: string): Opportunity | null => {
  if (ifNode.type !== 'IfStatement') {
    return null;
  }

  // Must have an alternate to be a chain
  if (ifNode.alternate === null) {
    return null;
  }

  let chainLength = 0;
  let singleExitCount = 0;
  let current: Node = ifNode;

  // Walk the chain: each link must have consequent ending in exit
  while (current.type === 'IfStatement') {
    const consequent = current.consequent as Node;
    const alternate = current.alternate;
    // Check if consequent ends with exit (for loop context: also allow continue/break)
    const isGuard = insideLoop ? isLoopGuardBlock(consequent) : isExitBlock(consequent);

    if (!isGuard) {
      return null;
    }

    chainLength += 1;

    if (countStatements(consequent) <= 1) {
      singleExitCount += 1;
    }

    // If alternate is another IfStatement, continue the chain
    if (alternate !== null && (alternate as Node).type === 'IfStatement') {
      current = alternate as Node;
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
  const finalBranch = current.type === 'IfStatement' ? (current.alternate as Node | null) : null;

  if (finalBranch === null) {
    // Tail-less: all consequents in the chain already end with exit (verified by the while loop).
    // The entire chain can be flattened to sequential guards.
    let totalConsequentCount = 0;
    let recount: Node = ifNode;

    while (recount.type === 'IfStatement') {
      totalConsequentCount += countStatements(recount.consequent as Node);

      const alt = recount.alternate;

      if (alt !== null && (alt as Node).type === 'IfStatement') {
        recount = alt as Node;
      } else {
        break;
      }
    }

    return {
      kind: 'cascade-guard',
      span: nodeSpan(ifNode, sourceText),
      depthReduction: 1,
      statementsAffected: totalConsequentCount,
    };
  }

  const finalCount = countStatements(finalBranch as Node);

  if (finalCount === 0) {
    return null;
  }

  // Filter B: all branches (including final else) are single-exit → already maximally flat dispatch
  if (singleExitCount === chainLength && finalCount <= 1) {
    return null;
  }

  return {
    kind: 'cascade-guard',
    span: nodeSpan(ifNode, sourceText),
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

  const visit = (node: Node, depth: number, insideLoop: boolean, inTailPosition: boolean): void => {
    // Skip nodes that are part of a detected cascade-guard chain
    if (skipNodes.has(node as object)) {
      return;
    }

    // Respect function boundaries — don't descend into nested functions
    if (node !== functionNode && isFunctionNode(node)) {
      return;
    }

    const nodeType = node.type;
    const nextDepth = shouldIncreaseDepth(nodeType) ? depth + 1 : depth;

    if (nextDepth > maxDepth) {
      maxDepth = nextDepth;
    }

    if (nodeType === 'IfStatement') {
      const alternateValue = node.alternate;

      if (alternateValue !== null) {
        // 1. Try cascade-guard
        const cascade = detectCascadeGuard(node, insideLoop, sourceText);

        if (cascade !== null) {
          opportunities.push(cascade);

          // Mark all sub-IfStatements in the chain to skip re-analysis
          let chainNode: Node = node;

          while (chainNode.type === 'IfStatement') {
            const alt = chainNode.alternate;

            if (alt !== null && (alt as Node).type === 'IfStatement') {
              skipNodes.add(alt as object);

              chainNode = alt as Node;
            } else {
              break;
            }
          }
        } else {
          // 2. Try invertible-if-else — skip when alternate is an else-if chain
          //    (countStatements would sum the entire chain, producing a false positive)
          const alternateNode = alternateValue as Node;
          const isElseIfChain = alternateNode.type === 'IfStatement';

          if (!isElseIfChain) {
            const consequentValue = node.consequent as Node;
            const consequentCount = countStatements(consequentValue);
            const alternateCount = countStatements(alternateNode);

            if (consequentCount > 0 && alternateCount > 0) {
              const shortCount = consequentCount <= alternateCount ? consequentCount : alternateCount;
              const longCount = consequentCount <= alternateCount ? alternateCount : consequentCount;
              const shortNode = consequentCount <= alternateCount ? consequentValue : alternateNode;
              const shortExits = endsWithReturnOrThrow(shortNode) || (insideLoop && endsWithLoopExit(shortNode));

              if (shortCount <= 3 && shortExits && longCount >= shortCount * 2) {
                opportunities.push({
                  kind: 'invertible-if-else',
                  span: nodeSpan(node, sourceText),
                  depthReduction: 1,
                  statementsAffected: longCount,
                });
              }
            }
          }
        }
      }
    }

    // Check for wrapping-if and implicit-else in block statements
    if (nodeType === 'BlockStatement') {
      const bodyArr = node.body;

      if (bodyArr.length > 0) {
        const bodyStmts = bodyArr as ReadonlyArray<Node>;

        // Only detect wrapping-if/implicit-else when early exit is safe:
        // - inTailPosition: block is at end of function scope → return is safe
        // - insideLoop: can use continue/break
        // Also skip blocks with consecutive trailing bare ifs (sequential dispatch pattern)
        if ((inTailPosition || insideLoop) && countConsecutiveTrailingIfs(bodyStmts) < 2) {
          const wrapping = detectWrappingIf(bodyStmts, sourceText);

          if (wrapping !== null) {
            opportunities.push(wrapping);
          }

          const implicitElses = detectImplicitElse(bodyStmts, insideLoop, sourceText);

          for (const ie of implicitElses) {
            opportunities.push(ie);
          }
        }

        // Visit body children with tail position tracking:
        // only the last child inherits tail position from this block
        for (let i = 0; i < bodyStmts.length; i++) {
          const isLast = i === bodyStmts.length - 1;

          visit(bodyStmts[i]!, nextDepth, insideLoop, isLast && inTailPosition);
        }
      }

      return;
    }

    forEachChildNode(node, child => {
      const isLoop = isLoopNodeType(nodeType);
      const childTailPos = isLoop ? true : inTailPosition;

      visit(child, nextDepth, insideLoop || isLoop, childTailPos);
    });
  };

  visit(bodyValue as Node, 0, false, true);

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
  const lineOffsets = buildLineOffsets(sourceText);
  const span: SourceSpan = {
    start: getLineColumn(lineOffsets, functionNode.start),
    end: getLineColumn(lineOffsets, functionNode.end),
  };

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
