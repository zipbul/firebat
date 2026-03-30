import type {
  BlockStatement,
  BreakStatement,
  ContinueStatement,
  DoWhileStatement,
  ForInStatement,
  ForOfStatement,
  ForStatement,
  ForStatementInit,
  ForStatementLeft,
  IfStatement,
  LabeledStatement,
  Node,
  ReturnStatement,
  SwitchStatement,
  ThrowStatement,
  TryStatement,
  WhileStatement,
} from 'oxc-parser';

import { IntegerCFG } from './cfg';
import { isOxcNode } from '../ast/oxc-ast-utils';
import { evalStaticLiteralValue, evalStaticTruthiness } from '../ast/oxc-expression-utils';
import { EdgeType, type CfgNodePayload, type LoopTargets, type NodeId, type OxcBuiltFunctionCfg } from '../types';

export class OxcCFGBuilder {
  private cfg: IntegerCFG;
  private nodePayloads: Array<CfgNodePayload | null>;
  private exitId: NodeId;
  private finallyReturnEntryStack: NodeId[];
  private activeCatchEntryStack: NodeId[];

  constructor() {
    this.cfg = new IntegerCFG();
    this.nodePayloads = [];
    this.exitId = 0;
    this.finallyReturnEntryStack = [];
    this.activeCatchEntryStack = [];
  }

  public buildFunctionBody(bodyNode: Node | ReadonlyArray<Node> | undefined): OxcBuiltFunctionCfg {
    this.cfg = new IntegerCFG();
    this.nodePayloads = [];
    this.finallyReturnEntryStack = [];
    this.activeCatchEntryStack = [];

    const entryId = this.addNode(null);

    this.exitId = this.addNode(null);

    const tails = this.visitStatement(bodyNode, [entryId], [], null);

    for (const tail of tails) {
      this.cfg.addEdge(tail, this.exitId, EdgeType.Normal);
    }

    return {
      cfg: this.cfg,
      entryId,
      exitId: this.exitId,
      nodePayloads: this.nodePayloads,
    };
  }

  private addNode(payload: CfgNodePayload | null): NodeId {
    const nodeId = this.cfg.addNode();

    this.nodePayloads[nodeId] = payload;

    return nodeId;
  }

  private connect(fromNodes: readonly NodeId[], to: NodeId, type: EdgeType = EdgeType.Normal): void {
    for (const from of fromNodes) {
      this.cfg.addEdge(from, to, type);
    }
  }

  private addExceptionEdgeIfInTry(nodeId: NodeId): void {
    const catchEntry = this.activeCatchEntryStack[this.activeCatchEntryStack.length - 1];

    if (catchEntry !== undefined) {
      this.cfg.addEdge(nodeId, catchEntry, EdgeType.Exception);
    }
  }

  private addConditionalEdges(
    conditionNode: NodeId,
    trueTarget: NodeId,
    falseTarget: NodeId,
    truthiness: boolean | null,
    treatMissingAsTrue: boolean,
  ): void {
    if (truthiness === true) {
      this.cfg.addEdge(conditionNode, trueTarget, EdgeType.True);

      return;
    }

    if (truthiness === false) {
      this.cfg.addEdge(conditionNode, falseTarget, EdgeType.False);

      return;
    }

    if (treatMissingAsTrue) {
      this.cfg.addEdge(conditionNode, trueTarget, EdgeType.True);

      return;
    }

    this.cfg.addEdge(conditionNode, trueTarget, EdgeType.True);
    this.cfg.addEdge(conditionNode, falseTarget, EdgeType.False);
  }

  private resolveLoopTarget(loopStack: readonly LoopTargets[], label: string | null, useBreakTarget: boolean): NodeId | null {
    for (let index = loopStack.length - 1; index >= 0; index -= 1) {
      const entry = loopStack[index];

      if (!entry) {
        continue;
      }

      if (label === null) {
        return useBreakTarget ? entry.breakTarget : entry.continueTarget;
      }

      if (entry.label === label) {
        return useBreakTarget ? entry.breakTarget : entry.continueTarget;
      }
    }

    return null;
  }

  private visitJumpStatement(
    node: BreakStatement | ContinueStatement,
    incoming: readonly NodeId[],
    loopStack: readonly LoopTargets[],
    useBreakTarget: boolean,
  ): NodeId[] {
    const jumpNode = this.addNode(node);

    this.connect(incoming, jumpNode, EdgeType.Normal);

    const targetLabel = node.label?.name ?? null;
    const target = this.resolveLoopTarget(loopStack, targetLabel, useBreakTarget);

    if (target !== null) {
      this.cfg.addEdge(jumpNode, target, EdgeType.Normal);
    }

    return [];
  }

  private visitStatement(
    node: Node | ReadonlyArray<Node> | undefined,
    incoming: readonly NodeId[],
    loopStack: readonly LoopTargets[],
    currentLabel: string | null,
  ): NodeId[] {
    if (Array.isArray(node)) {
      let tails: NodeId[] = [...incoming];

      for (const entry of node as ReadonlyArray<Node>) {
        tails = this.visitStatement(entry, tails, loopStack, null);
      }

      return tails;
    }

    if (!isOxcNode(node)) {
      return [...incoming];
    }

    switch (node.type) {
      case 'BlockStatement': {
        const blockNode = node as BlockStatement;
        let tails: NodeId[] = [...incoming];

        for (const child of blockNode.body) {
          tails = this.visitStatement(child, tails, loopStack, null);
        }

        return tails;
      }

      case 'LabeledStatement': {
        const labeledNode = node as LabeledStatement;

        return this.visitStatement(labeledNode.body, incoming, loopStack, labeledNode.label.name);
      }

      case 'IfStatement': {
        const ifNode = node as IfStatement;
        const conditionNode = this.addNode(ifNode.test);
        const truthiness = evalStaticTruthiness(ifNode.test);

        this.connect(incoming, conditionNode, EdgeType.Normal);

        const trueEntry = this.addNode(null);
        const falseEntry = this.addNode(null);

        if (truthiness === true) {
          this.cfg.addEdge(conditionNode, trueEntry, EdgeType.True);

          const trueTails = this.visitStatement(ifNode.consequent, [trueEntry], loopStack, null);
          const mergeNode = this.addNode(null);

          this.connect(trueTails, mergeNode, EdgeType.Normal);

          return [mergeNode];
        }

        if (truthiness === false) {
          this.cfg.addEdge(conditionNode, falseEntry, EdgeType.False);

          const falseTails =
            ifNode.alternate === null
              ? [falseEntry]
              : this.visitStatement(ifNode.alternate, [falseEntry], loopStack, null);
          const mergeNode = this.addNode(null);

          this.connect(falseTails, mergeNode, EdgeType.Normal);

          return [mergeNode];
        }

        this.cfg.addEdge(conditionNode, trueEntry, EdgeType.True);
        this.cfg.addEdge(conditionNode, falseEntry, EdgeType.False);

        const trueTails = this.visitStatement(ifNode.consequent, [trueEntry], loopStack, null);
        const falseTails =
          ifNode.alternate === null
            ? [falseEntry]
            : this.visitStatement(ifNode.alternate, [falseEntry], loopStack, null);
        const mergeNode = this.addNode(null);

        this.connect(trueTails, mergeNode, EdgeType.Normal);
        this.connect(falseTails, mergeNode, EdgeType.Normal);

        return [mergeNode];
      }

      case 'WhileStatement': {
        const whileNode = node as WhileStatement;
        const conditionNode = this.addNode(whileNode.test);
        const truthiness = evalStaticTruthiness(whileNode.test);

        this.connect(incoming, conditionNode, EdgeType.Normal);
        this.addExceptionEdgeIfInTry(conditionNode);

        const bodyEntry = this.addNode(null);
        const afterLoop = this.addNode(null);

        this.addConditionalEdges(conditionNode, bodyEntry, afterLoop, truthiness, false);

        if (truthiness === false) {
          return [afterLoop];
        }

        const nextLoopStack: LoopTargets[] = [
          ...loopStack,
          { breakTarget: afterLoop, continueTarget: conditionNode, label: currentLabel },
        ];
        const bodyTails = this.visitStatement(whileNode.body, [bodyEntry], nextLoopStack, null);

        this.connect(bodyTails, conditionNode, EdgeType.Normal);

        return [afterLoop];
      }

      case 'DoWhileStatement': {
        const doWhileNode = node as DoWhileStatement;
        const bodyEntry = this.addNode(null);
        const conditionNode = this.addNode(doWhileNode.test);
        const afterLoop = this.addNode(null);

        this.connect(incoming, bodyEntry, EdgeType.Normal);
        this.addExceptionEdgeIfInTry(conditionNode);

        const nextLoopStack: LoopTargets[] = [
          ...loopStack,
          { breakTarget: afterLoop, continueTarget: conditionNode, label: currentLabel },
        ];
        const bodyTails = this.visitStatement(doWhileNode.body, [bodyEntry], nextLoopStack, null);

        this.connect(bodyTails, conditionNode, EdgeType.Normal);

        this.cfg.addEdge(conditionNode, bodyEntry, EdgeType.True);
        this.cfg.addEdge(conditionNode, afterLoop, EdgeType.False);

        return [afterLoop];
      }

      case 'ForOfStatement':
      case 'ForInStatement': {
        // Model as: header -> body -> header, with an explicit exit edge.
        // IMPORTANT: keep the header payload free of `body` so that uses in the body
        // are not attributed to the same CFG node as the loop variable write.
        const forOfInNode = node as ForOfStatement | ForInStatement;
        const headerPayload: Node[] = [forOfInNode.left as Node as ForStatementLeft, forOfInNode.right];
        const headerNode = this.addNode(headerPayload);
        const bodyEntry = this.addNode(null);
        const afterLoop = this.addNode(null);

        this.connect(incoming, headerNode, EdgeType.Normal);
        this.addExceptionEdgeIfInTry(headerNode);

        // The loop may execute 0 times; keep a direct exit edge.
        this.cfg.addEdge(headerNode, afterLoop, EdgeType.Normal);
        this.cfg.addEdge(headerNode, bodyEntry, EdgeType.Normal);

        const nextLoopStack: LoopTargets[] = [
          ...loopStack,
          { breakTarget: afterLoop, continueTarget: headerNode, label: currentLabel },
        ];
        const bodyTails = this.visitStatement(forOfInNode.body, [bodyEntry], nextLoopStack, null);

        this.connect(bodyTails, headerNode, EdgeType.Normal);

        return [afterLoop];
      }

      case 'ForStatement': {
        const forNode = node as ForStatement;
        let tails: NodeId[] = [...incoming];

        if (forNode.init !== null) {
          const initNode = this.addNode(forNode.init as Node as ForStatementInit);

          this.connect(tails, initNode, EdgeType.Normal);
          this.addExceptionEdgeIfInTry(initNode);

          tails = [initNode];
        }

        const testNode = this.addNode(forNode.test);
        const truthiness = evalStaticTruthiness(forNode.test ?? undefined);

        this.connect(tails, testNode, EdgeType.Normal);
        this.addExceptionEdgeIfInTry(testNode);

        const bodyEntry = this.addNode(null);
        const afterLoop = this.addNode(null);

        this.addConditionalEdges(testNode, bodyEntry, afterLoop, truthiness, forNode.test === null);

        let continueTarget = testNode;
        let updateNode: NodeId | null = null;

        if (forNode.update !== null) {
          updateNode = this.addNode(forNode.update);

          this.addExceptionEdgeIfInTry(updateNode);

          continueTarget = updateNode;
        }

        if (truthiness === false) {
          return [afterLoop];
        }

        const nextLoopStack: LoopTargets[] = [...loopStack, { breakTarget: afterLoop, continueTarget, label: currentLabel }];
        const bodyTails = this.visitStatement(forNode.body, [bodyEntry], nextLoopStack, null);

        if (updateNode !== null) {
          this.connect(bodyTails, updateNode, EdgeType.Normal);
          this.cfg.addEdge(updateNode, testNode, EdgeType.Normal);
        } else {
          this.connect(bodyTails, testNode, EdgeType.Normal);
        }

        return [afterLoop];
      }

      case 'SwitchStatement': {
        // Build a combined payload: discriminant + reachable case test expressions.
        // Case tests are evaluated sequentially against the discriminant, stopping at the
        // first match. If the discriminant is a static literal, cases after the first
        // matching case are statically unreachable and their test expressions are excluded.
        const switchNode = node as SwitchStatement;
        const discriminantPayload: Node[] = [switchNode.discriminant];

        // Attempt to resolve static discriminant value so we can prune unreachable cases.
        const staticDiscriminant = evalStaticLiteralValue(switchNode.discriminant);
        let firstMatchFound = false;

        for (const caseNode of switchNode.cases) {
          // default case has no test
          if (caseNode.test === null) {
            continue;
          }

          // If a prior case already matched statically, this case is unreachable.
          if (firstMatchFound) {
            continue;
          }

          discriminantPayload.push(caseNode.test);

          // Check if this case matches the discriminant statically.
          if (staticDiscriminant !== undefined) {
            const staticTest = evalStaticLiteralValue(caseNode.test);

            if (staticTest !== undefined && Object.is(staticDiscriminant, staticTest)) {
              firstMatchFound = true;
            }
          }
        }

        const discriminantNode = this.addNode(discriminantPayload);

        this.connect(incoming, discriminantNode, EdgeType.Normal);

        const afterSwitch = this.addNode(null);
        const caseEntries: NodeId[] = switchNode.cases.map(() => this.addNode(null));

        for (const entry of caseEntries) {
          this.cfg.addEdge(discriminantNode, entry, EdgeType.Normal);
        }

        const nextLoopStack: LoopTargets[] = [
          ...loopStack,
          { breakTarget: afterSwitch, continueTarget: afterSwitch, label: currentLabel },
        ];

        for (let index = 0; index < switchNode.cases.length; index += 1) {
          const caseNode = switchNode.cases[index];
          const caseEntry = caseEntries[index];

          if (caseNode === undefined) {
            continue;
          }

          if (caseEntry === undefined) {
            continue;
          }

          const caseTails = this.visitStatement(caseNode.consequent, [caseEntry], nextLoopStack, null);
          const nextEntry = index + 1 < caseEntries.length ? caseEntries[index + 1] : undefined;

          if (nextEntry !== undefined) {
            this.connect(caseTails, nextEntry, EdgeType.Normal);
          } else {
            this.connect(caseTails, afterSwitch, EdgeType.Normal);
          }
        }

        return [afterSwitch];
      }

      case 'BreakStatement': {
        return this.visitJumpStatement(node as BreakStatement, incoming, loopStack, true);
      }

      case 'ContinueStatement': {
        return this.visitJumpStatement(node as ContinueStatement, incoming, loopStack, false);
      }

      case 'ReturnStatement': {
        const returnNode_node = node as ReturnStatement;
        const returnPayload: CfgNodePayload = returnNode_node.argument ?? returnNode_node;
        const returnNode = this.addNode(returnPayload);

        this.connect(incoming, returnNode, EdgeType.Normal);

        const finallyReturnEntry = this.finallyReturnEntryStack[this.finallyReturnEntryStack.length - 1] ?? null;

        if (finallyReturnEntry !== null) {
          this.cfg.addEdge(returnNode, finallyReturnEntry, EdgeType.Normal);
        } else {
          this.cfg.addEdge(returnNode, this.exitId, EdgeType.Normal);
        }

        return [];
      }

      case 'ThrowStatement': {
        const throwNode_node = node as ThrowStatement;
        const throwNode = this.addNode(throwNode_node.argument);

        this.connect(incoming, throwNode, EdgeType.Normal);
        this.cfg.addEdge(throwNode, this.exitId, EdgeType.Exception);

        return [];
      }

      case 'TryStatement': {
        const tryNode = node as TryStatement;
        const hasFinalizer = tryNode.finalizer !== null;
        const finallyEntryNormal = hasFinalizer ? this.addNode(null) : null;
        const finallyEntryReturn = hasFinalizer ? this.addNode(null) : null;

        if (finallyEntryReturn !== null) {
          this.finallyReturnEntryStack.push(finallyEntryReturn);
        }

        const tryEntry = this.addNode(null);

        this.connect(incoming, tryEntry, EdgeType.Normal);

        const tryBlockEntry = this.addNode(null);

        this.cfg.addEdge(tryEntry, tryBlockEntry, EdgeType.Normal);

        let catchTails: NodeId[] = [];

        if (tryNode.handler !== null) {
          const catchEntry = this.addNode(null);

          this.activeCatchEntryStack.push(catchEntry);

          const tryTails = this.visitStatement(tryNode.block, [tryBlockEntry], loopStack, null);

          this.activeCatchEntryStack.pop();

          catchTails = this.visitStatement(tryNode.handler.body, [catchEntry], loopStack, null);

          if (tryNode.finalizer !== null && finallyEntryNormal !== null && finallyEntryReturn !== null) {
            // Normal completion path.
            this.connect(tryTails, finallyEntryNormal, EdgeType.Normal);
            this.connect(catchTails, finallyEntryNormal, EdgeType.Normal);

            const finallyTails = this.visitStatement(tryNode.finalizer, [finallyEntryNormal], loopStack, null);
            // Return completion path: run finalizer and then exit.
            const finallyReturnTails = this.visitStatement(tryNode.finalizer, [finallyEntryReturn], loopStack, null);

            for (const tail of finallyReturnTails) {
              this.cfg.addEdge(tail, this.exitId, EdgeType.Normal);
            }

            this.finallyReturnEntryStack.pop();

            return finallyTails;
          }

          if (finallyEntryReturn !== null) {
            this.finallyReturnEntryStack.pop();
          }

          return [...tryTails, ...catchTails];
        }

        const tryTails = this.visitStatement(tryNode.block, [tryBlockEntry], loopStack, null);

        if (tryNode.finalizer !== null && finallyEntryNormal !== null && finallyEntryReturn !== null) {
          // Normal completion path.
          this.connect(tryTails, finallyEntryNormal, EdgeType.Normal);
          this.connect(catchTails, finallyEntryNormal, EdgeType.Normal);

          const finallyTails = this.visitStatement(tryNode.finalizer, [finallyEntryNormal], loopStack, null);
          // Return completion path: run finalizer and then exit.
          const finallyReturnTails = this.visitStatement(tryNode.finalizer, [finallyEntryReturn], loopStack, null);

          for (const tail of finallyReturnTails) {
            this.cfg.addEdge(tail, this.exitId, EdgeType.Normal);
          }

          this.finallyReturnEntryStack.pop();

          return finallyTails;
        }

        if (finallyEntryReturn !== null) {
          this.finallyReturnEntryStack.pop();
        }

        return [...tryTails, ...catchTails];
      }

      default: {
        const statementNode = this.addNode(node);

        this.connect(incoming, statementNode, EdgeType.Normal);
        this.addExceptionEdgeIfInTry(statementNode);

        return [statementNode];
      }
    }
  }
}
