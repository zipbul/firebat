import { is } from '@zipbul/gildash';
import type { Node } from 'oxc-parser';

import { buildLineOffsets, getLineColumn } from '@zipbul/gildash';

import type { ParsedFile } from '../../engine/types';
import type { CollapsibleIfItem, SourceSpan } from '../../types';

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

const createEmptyCollapsibleIf = (): ReadonlyArray<CollapsibleIfItem> => [];

// ── Helpers ─────────────────────────────────────────────────────────

/** Count statements in a block or treat a single statement as 1. */
const countBlockStatements = (node: Node): number => {
  if (!is.BlockStatement(node)) {
    return 1;
  }

  const body = node.body;

  return Array.isArray(body) ? body.length : 0;
};

// ── Detection ────────��──────────────────────────────────────────────

interface Opportunity {
  kind: 'collapsible-if' | 'collapsible-else-if';
  span: SourceSpan;
  depthReduction: number;
  statementsAffected: number;
}

const MIN_INNER_STMTS = 3;

/**
 * Detect collapsible-if: `if(a) { if(b) { 3+ stmts } }`
 * where outer if has no else, its body is exactly 1 statement (inner if),
 * and inner if has no else with 3+ statements in its consequent.
 */
const detectCollapsibleIf = (ifNode: Node, sourceText: string): Opportunity | null => {
  if (!is.IfStatement(ifNode)) {
    return null;
  }

  // Outer if must have no else
  if (ifNode.alternate !== null) {
    return null;
  }

  const outerConsequent = ifNode.consequent;

  // Outer consequent must be a block with exactly 1 statement
  if (!is.BlockStatement(outerConsequent)) {
    return null;
  }

  const outerBody = outerConsequent.body;

  if (!Array.isArray(outerBody) || outerBody.length !== 1) {
    return null;
  }

  const innerStmt = outerBody[0] as Node;

  // Inner statement must be an IfStatement with no else
  if (!is.IfStatement(innerStmt)) {
    return null;
  }

  if (innerStmt.alternate !== null) {
    return null;
  }

  // Inner consequent must have 3+ statements
  const innerCount = countBlockStatements(innerStmt.consequent as Node);

  if (innerCount < MIN_INNER_STMTS) {
    return null;
  }

  return {
    kind: 'collapsible-if',
    span: nodeSpan(ifNode, sourceText),
    depthReduction: 1,
    statementsAffected: innerCount,
  };
};

/**
 * Detect collapsible-else-if: `if(a) { ... } else { if(b) { ... } }`
 * where else block has exactly 1 statement which is an IfStatement.
 * Can be simplified to `if(a) { ... } else if(b) { ... }`.
 */
const detectCollapsibleElseIf = (ifNode: Node, sourceText: string): Opportunity | null => {
  if (!is.IfStatement(ifNode)) {
    return null;
  }

  // Must have an alternate (else)
  const alternate = ifNode.alternate;

  if (alternate === null) {
    return null;
  }

  // Alternate must be a BlockStatement
  if (!is.BlockStatement(alternate)) {
    return null;
  }

  const elseBody = alternate.body;

  // Else block must have exactly 1 statement
  if (!Array.isArray(elseBody) || elseBody.length !== 1) {
    return null;
  }

  const innerStmt = elseBody[0] as Node;

  // That statement must be an IfStatement (inner if may have else — matches Clippy behavior)
  if (!is.IfStatement(innerStmt)) {
    return null;
  }

  // Count total statements across inner if's branches (consequent + alternate if present)
  let innerTotal = countBlockStatements(innerStmt.consequent as Node);

  if (innerStmt.alternate !== null) {
    innerTotal += countBlockStatements(innerStmt.alternate as Node);
  }

  // Empty inner if (e.g. `if(b) {}`) has no statements to benefit from collapsing
  if (innerTotal === 0) {
    return null;
  }

  const statementsAffected = Math.max(innerTotal, MIN_INNER_STMTS);

  return {
    kind: 'collapsible-else-if',
    span: nodeSpan(ifNode, sourceText),
    depthReduction: 1,
    statementsAffected,
  };
};

// ── Function-level analysis ──────���──────────────────────────────────

const analyzeFunctionNode = (
  functionNode: Node,
  filePath: string,
  sourceText: string,
  parent: Node | null,
): CollapsibleIfItem | null => {
  const bodyValue = resolveFunctionBody(functionNode);

  if (bodyValue === null || bodyValue === undefined) {
    return null;
  }

  let maxDepth = 0;
  const opportunities: Opportunity[] = [];

  const visit = (node: Node, depth: number): void => {
    // Respect function boundaries
    if (node !== functionNode && isFunctionNode(node)) {
      return;
    }

    const nodeType = node.type;
    const nextDepth = shouldIncreaseDepth(nodeType) ? depth + 1 : depth;

    if (nextDepth > maxDepth) {
      maxDepth = nextDepth;
    }

    // Check for collapsible-if / collapsible-else-if at each IfStatement
    if (nodeType === 'IfStatement') {
      const opportunity = detectCollapsibleIf(node, sourceText) ?? detectCollapsibleElseIf(node, sourceText);

      if (opportunity !== null) {
        opportunities.push(opportunity);
      }
    }

    forEachChildNode(node, child => {
      visit(child, nextDepth);
    });
  };

  visit(bodyValue as Node, 0);

  if (opportunities.length === 0) {
    return null;
  }

  const totalScore = opportunities.reduce((sum, o) => sum + o.depthReduction * o.statementsAffected, 0);

  if (totalScore < MIN_INNER_STMTS) {
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

const analyzeCollapsibleIf = (files: ReadonlyArray<ParsedFile>): ReadonlyArray<CollapsibleIfItem> => {
  if (files.length === 0) {
    return createEmptyCollapsibleIf();
  }

  return collectFunctionItems(files, analyzeFunctionNode).filter((item): item is CollapsibleIfItem => item !== null);
};

export { analyzeCollapsibleIf, createEmptyCollapsibleIf };
