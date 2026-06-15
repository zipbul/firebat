import type { AstNode } from '../types';

type StatementBodyHandler = (body: AstNode[]) => void;

type NodeVisit = (node: AstNode) => void;

interface StatementBodyVisitor {
  [key: string]: NodeVisit | undefined;
  BlockStatement: NodeVisit;
  Program: NodeVisit;
}

/**
 * Builds the oxlint visitor object that runs `checkBody` over the statement list
 * of every `BlockStatement` and `Program`. Both rules that walk statement bodies
 * share this exact traversal shape.
 */
const createStatementBodyVisitor = (checkBody: StatementBodyHandler): StatementBodyVisitor => {
  const visit = (node: AstNode): void => {
    const body = Array.isArray(node.body) ? node.body : [];

    checkBody(body);
  };

  return {
    BlockStatement: visit,
    Program: visit,
  };
};

export { createStatementBodyVisitor };
