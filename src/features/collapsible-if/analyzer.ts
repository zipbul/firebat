import type { Node } from 'oxc-parser';

import type { NodeValue, ParsedFile } from '../../engine/types';
import type { CollapsibleIfItem, SourceSpan } from '../../types';

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

const createEmptyCollapsibleIf = (): ReadonlyArray<CollapsibleIfItem> => [];

// ── Helpers ─────────────────────────────────────────────────────────

/** Count statements in a block or treat a single statement as 1. */
const countBlockStatements = (node: NodeValue): number => {
  if (!isOxcNode(node)) {
    return 0;
  }

  if (node.type !== 'BlockStatement') {
    return 1;
  }

  if (!isNodeRecord(node)) {
    return 0;
  }

  const body = node.body;

  return Array.isArray(body) ? body.length : 0;
};

// ── Detection ───────────────────────────────────────────────────────

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
const detectCollapsibleIf = (ifNode: NodeValue, sourceText: string): Opportunity | null => {
  if (!isOxcNode(ifNode) || ifNode.type !== 'IfStatement') {
    return null;
  }

  if (!isNodeRecord(ifNode)) {
    return null;
  }

  // Outer if must have no else
  if (ifNode.alternate !== null && ifNode.alternate !== undefined) {
    return null;
  }

  const outerConsequent = ifNode.consequent as NodeValue;

  // Outer consequent must be a block with exactly 1 statement
  if (!isOxcNode(outerConsequent) || outerConsequent.type !== 'BlockStatement') {
    return null;
  }

  if (!isNodeRecord(outerConsequent)) {
    return null;
  }

  const outerBody = outerConsequent.body;

  if (!Array.isArray(outerBody) || outerBody.length !== 1) {
    return null;
  }

  const innerStmt = outerBody[0] as NodeValue;

  // Inner statement must be an IfStatement with no else
  if (!isOxcNode(innerStmt) || innerStmt.type !== 'IfStatement') {
    return null;
  }

  if (!isNodeRecord(innerStmt)) {
    return null;
  }

  if (innerStmt.alternate !== null && innerStmt.alternate !== undefined) {
    return null;
  }

  // Inner consequent must have 3+ statements
  const innerConsequent = innerStmt.consequent as NodeValue;
  const innerCount = countBlockStatements(innerConsequent);

  if (innerCount < MIN_INNER_STMTS) {
    return null;
  }

  const node = ifNode as Node;
  const spanStart = getLineColumn(sourceText, node.start);
  const spanEnd = getLineColumn(sourceText, node.end);

  return {
    kind: 'collapsible-if',
    span: { start: spanStart, end: spanEnd },
    depthReduction: 1,
    statementsAffected: innerCount,
  };
};

/**
 * Detect collapsible-else-if: `if(a) { ... } else { if(b) { ... } }`
 * where else block has exactly 1 statement which is an IfStatement.
 * Can be simplified to `if(a) { ... } else if(b) { ... }`.
 */
const detectCollapsibleElseIf = (ifNode: NodeValue, sourceText: string): Opportunity | null => {
  if (!isOxcNode(ifNode) || ifNode.type !== 'IfStatement') {
    return null;
  }

  if (!isNodeRecord(ifNode)) {
    return null;
  }

  // Must have an alternate (else)
  const alternate = ifNode.alternate as NodeValue;

  if (alternate === null || alternate === undefined) {
    return null;
  }

  // Alternate must be a BlockStatement
  if (!isOxcNode(alternate) || alternate.type !== 'BlockStatement') {
    return null;
  }

  if (!isNodeRecord(alternate)) {
    return null;
  }

  const elseBody = alternate.body;

  // Else block must have exactly 1 statement
  if (!Array.isArray(elseBody) || elseBody.length !== 1) {
    return null;
  }

  const innerStmt = elseBody[0] as NodeValue;

  // That statement must be an IfStatement (inner if may have else — matches Clippy behavior)
  if (!isOxcNode(innerStmt) || innerStmt.type !== 'IfStatement') {
    return null;
  }

  // Count total statements across inner if's branches (consequent + alternate if present)
  let innerTotal = countBlockStatements(innerStmt.consequent as NodeValue);

  if (isNodeRecord(innerStmt) && innerStmt.alternate != null) {
    innerTotal += countBlockStatements(innerStmt.alternate as NodeValue);
  }

  // Empty inner if (e.g. `if(b) {}`) has no statements to benefit from collapsing
  if (innerTotal === 0) {
    return null;
  }

  const statementsAffected = Math.max(innerTotal, MIN_INNER_STMTS);
  const node = ifNode as Node;
  const spanStart = getLineColumn(sourceText, node.start);
  const spanEnd = getLineColumn(sourceText, node.end);

  return {
    kind: 'collapsible-else-if',
    span: { start: spanStart, end: spanEnd },
    depthReduction: 1,
    statementsAffected,
  };
};

// ── Function-level analysis ─────────────────────────────────────────

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

  const visit = (value: NodeValue, depth: number): void => {
    if (isOxcNodeArray(value)) {
      for (const entry of value) {
        visit(entry, depth);
      }

      return;
    }

    if (!isOxcNode(value)) {
      return;
    }

    // Respect function boundaries
    if (value !== functionNode && isFunctionNode(value)) {
      return;
    }

    const nodeType = value.type;
    const nextDepth = shouldIncreaseDepth(nodeType) ? depth + 1 : depth;

    if (nextDepth > maxDepth) {
      maxDepth = nextDepth;
    }

    // Check for collapsible-if / collapsible-else-if at each IfStatement
    if (nodeType === 'IfStatement') {
      const opportunity = detectCollapsibleIf(value, sourceText) ?? detectCollapsibleElseIf(value, sourceText);

      if (opportunity !== null) {
        opportunities.push(opportunity);
      }
    }

    if (!isNodeRecord(value)) {
      return;
    }

    visitOxcChildren(value, entry => {
      visit(entry, nextDepth);
    });
  };

  visit(bodyValue as NodeValue, 0);

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

const analyzeCollapsibleIf = (files: ReadonlyArray<ParsedFile>): ReadonlyArray<CollapsibleIfItem> => {
  if (files.length === 0) {
    return createEmptyCollapsibleIf();
  }

  return collectFunctionItems(files, analyzeFunctionNode).filter((item): item is CollapsibleIfItem => item !== null);
};

export { analyzeCollapsibleIf, createEmptyCollapsibleIf };
