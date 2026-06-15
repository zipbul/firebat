import type {
  BlockStatement,
  BreakStatement,
  CallExpression,
  ContinueStatement,
  DoWhileStatement,
  ExpressionStatement,
  ForInStatement,
  ForOfStatement,
  ForStatement,
  IfStatement,
  Node,
  ReturnStatement,
  SwitchStatement,
  ThrowStatement,
  TryStatement,
  WhileStatement,
} from 'oxc-parser';

import { evalStaticLiteralValue, evalStaticTruthiness, isFunctionNode, isOxcNode, unwrapExpression } from '../ast';
import { EdgeType, type CfgNodePayload, type LoopTargets, type NodeId, type OxcBuiltFunctionCfg } from '../types';
import { IntegerCFG } from './cfg';

export interface OxcCFGBuilderOptions {
  readonly inlineSyncIifes?: boolean;
}

export class OxcCFGBuilder {
  private cfg: IntegerCFG;
  private nodePayloads: Array<CfgNodePayload | null>;
  private exitId: NodeId;
  // Unified return-redirection stack. A `return` edges to the INNERMOST active
  // target: an inlined-IIFE's after-call node OR a try's finalizer-return
  // entry, whichever was pushed last (correct relative nesting). Merging the
  // two stacks fixes the bug where an inlined IIFE's `return`, when the IIFE
  // sat inside an outer try/finally, wrongly routed to the outer finalizer
  // instead of the IIFE's after-call node.
  private returnTargetStack: NodeId[];
  private activeCatchEntryStack: NodeId[];
  private readonly options: OxcCFGBuilderOptions;

  /**
   * Build a CFG for a function body.
   *
   * Using a static factory ensures all mutable state is created here and
   * passed into the builder — readers can never observe a partially-written
   * builder from a previous call (temporal-coupling eliminated).
   */
  public static build(bodyNode: Node | ReadonlyArray<Node> | undefined, options: OxcCFGBuilderOptions = {}): OxcBuiltFunctionCfg {
    return new OxcCFGBuilder(bodyNode, options).result;
  }

  private readonly result: OxcBuiltFunctionCfg;

  private constructor(bodyNode: Node | ReadonlyArray<Node> | undefined, options: OxcCFGBuilderOptions) {
    this.cfg = new IntegerCFG();
    this.nodePayloads = [];
    this.returnTargetStack = [];
    this.activeCatchEntryStack = [];
    this.options = options;

    const entryId = this.addNode(null);

    this.exitId = this.addNode(null);

    const tails = this.visitStatement(bodyNode, [entryId], [], null);

    for (const tail of tails) {
      this.cfg.addEdge(tail, this.exitId, EdgeType.Normal);
    }

    this.result = {
      cfg: this.cfg,
      entryId,
      exitId: this.exitId,
      nodePayloads: this.nodePayloads,
    };
  }

  /** @deprecated Use `OxcCFGBuilder.build()` instead. */
  public buildFunctionBody(bodyNode: Node | ReadonlyArray<Node> | undefined): OxcBuiltFunctionCfg {
    return OxcCFGBuilder.build(bodyNode);
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

  private selectTarget(entry: LoopTargets, useBreakTarget: boolean): NodeId {
    return useBreakTarget ? entry.breakTarget : entry.continueTarget;
  }

  /**
   * Push a loop scope (break/continue targets + label) onto the loop stack and
   * visit the loop body within it. Centralizes the single decision shared by
   * every loop visitor — how a loop registers its jump targets — so the
   * `LoopTargets` shape and stack-extension convention have one source of truth.
   * Returns the body's tail nodes; per-loop back-edge wiring stays in the caller.
   */
  private visitLoopBody(
    body: Node,
    bodyEntry: NodeId,
    breakTarget: NodeId,
    continueTarget: NodeId,
    loopStack: readonly LoopTargets[],
    currentLabel: string | null,
  ): NodeId[] {
    const nextLoopStack: LoopTargets[] = [...loopStack, { breakTarget, continueTarget, label: currentLabel }];

    return this.visitStatement(body, [bodyEntry], nextLoopStack, null);
  }

  private resolveLoopTarget(loopStack: readonly LoopTargets[], label: string | null, useBreakTarget: boolean): NodeId | null {
    for (let index = loopStack.length - 1; index >= 0; index -= 1) {
      const entry = loopStack[index];

      if (!entry) {
        continue;
      }

      if (label === null || entry.label === label) {
        return this.selectTarget(entry, useBreakTarget);
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

  private visitIfStatement(ifNode: IfStatement, incoming: readonly NodeId[], loopStack: readonly LoopTargets[]): NodeId[] {
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
        ifNode.alternate === null ? [falseEntry] : this.visitStatement(ifNode.alternate, [falseEntry], loopStack, null);
      const mergeNode = this.addNode(null);

      this.connect(falseTails, mergeNode, EdgeType.Normal);

      return [mergeNode];
    }

    this.cfg.addEdge(conditionNode, trueEntry, EdgeType.True);
    this.cfg.addEdge(conditionNode, falseEntry, EdgeType.False);

    const trueTails = this.visitStatement(ifNode.consequent, [trueEntry], loopStack, null);
    const falseTails =
      ifNode.alternate === null ? [falseEntry] : this.visitStatement(ifNode.alternate, [falseEntry], loopStack, null);
    const mergeNode = this.addNode(null);

    this.connect(trueTails, mergeNode, EdgeType.Normal);
    this.connect(falseTails, mergeNode, EdgeType.Normal);

    return [mergeNode];
  }

  private buildSwitchDiscriminantPayload(switchNode: SwitchStatement): Node[] {
    const discriminantPayload: Node[] = [switchNode.discriminant];
    const staticDiscriminant = evalStaticLiteralValue(switchNode.discriminant);
    let firstMatchFound = false;

    for (const caseNode of switchNode.cases) {
      if (caseNode.test === null || firstMatchFound) {
        continue;
      }

      discriminantPayload.push(caseNode.test);

      if (staticDiscriminant === undefined) {
        continue;
      }

      const staticTest = evalStaticLiteralValue(caseNode.test);

      if (staticTest !== undefined && Object.is(staticDiscriminant, staticTest)) {
        firstMatchFound = true;
      }
    }

    return discriminantPayload;
  }

  private visitSwitchStatement(
    switchNode: SwitchStatement,
    incoming: readonly NodeId[],
    loopStack: readonly LoopTargets[],
    currentLabel: string | null,
  ): NodeId[] {
    const discriminantPayload = this.buildSwitchDiscriminantPayload(switchNode);
    const discriminantNode = this.addNode(discriminantPayload);

    this.connect(incoming, discriminantNode, EdgeType.Normal);

    const afterSwitch = this.addNode(null);
    const caseEntries: NodeId[] = switchNode.cases.map(() => this.addNode(null));

    for (const entry of caseEntries) {
      this.cfg.addEdge(discriminantNode, entry, EdgeType.Normal);
    }

    // No `default` clause: a discriminant matching no case falls straight through
    // to after the switch. Without this edge the CFG models the switch as if some
    // case always matches, so a pre-switch def (`let i = 0`) that every case
    // reassigns looks dead even though the no-match path leaves it live and read
    // after the switch (and dropping its initializer would also break TS
    // definite-assignment). A `default` clause makes the switch total, so the
    // edge is only added when absent.
    const hasDefault = switchNode.cases.some(caseNode => caseNode.test === null);

    if (!hasDefault) {
      this.cfg.addEdge(discriminantNode, afterSwitch, EdgeType.Normal);
    }

    const nextLoopStack: LoopTargets[] = [
      ...loopStack,
      { breakTarget: afterSwitch, continueTarget: afterSwitch, label: currentLabel },
    ];

    for (let index = 0; index < switchNode.cases.length; index += 1) {
      const caseNode = switchNode.cases[index];
      const caseEntry = caseEntries[index];

      if (caseNode === undefined || caseEntry === undefined) {
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

  private visitForStatement(
    forNode: ForStatement,
    incoming: readonly NodeId[],
    loopStack: readonly LoopTargets[],
    currentLabel: string | null,
  ): NodeId[] {
    let tails: NodeId[] = [...incoming];

    if (forNode.init !== null) {
      const initNode = this.addNode(forNode.init);

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

    const bodyTails = this.visitLoopBody(forNode.body, bodyEntry, afterLoop, continueTarget, loopStack, currentLabel);

    if (updateNode !== null) {
      this.connect(bodyTails, updateNode, EdgeType.Normal);
      this.cfg.addEdge(updateNode, testNode, EdgeType.Normal);
    } else {
      this.connect(bodyTails, testNode, EdgeType.Normal);
    }

    return [afterLoop];
  }

  private visitWhileStatement(
    whileNode: WhileStatement,
    incoming: readonly NodeId[],
    loopStack: readonly LoopTargets[],
    currentLabel: string | null,
  ): NodeId[] {
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

    const bodyTails = this.visitLoopBody(whileNode.body, bodyEntry, afterLoop, conditionNode, loopStack, currentLabel);

    this.connect(bodyTails, conditionNode, EdgeType.Normal);

    return [afterLoop];
  }

  private visitDoWhileStatement(
    doWhileNode: DoWhileStatement,
    incoming: readonly NodeId[],
    loopStack: readonly LoopTargets[],
    currentLabel: string | null,
  ): NodeId[] {
    const bodyEntry = this.addNode(null);
    const conditionNode = this.addNode(doWhileNode.test);
    const afterLoop = this.addNode(null);

    this.connect(incoming, bodyEntry, EdgeType.Normal);
    this.addExceptionEdgeIfInTry(conditionNode);

    const bodyTails = this.visitLoopBody(doWhileNode.body, bodyEntry, afterLoop, conditionNode, loopStack, currentLabel);

    this.connect(bodyTails, conditionNode, EdgeType.Normal);

    this.cfg.addEdge(conditionNode, bodyEntry, EdgeType.True);
    this.cfg.addEdge(conditionNode, afterLoop, EdgeType.False);

    return [afterLoop];
  }

  private visitForOfInStatement(
    forOfInNode: ForOfStatement | ForInStatement,
    incoming: readonly NodeId[],
    loopStack: readonly LoopTargets[],
    currentLabel: string | null,
  ): NodeId[] {
    const headerPayload: Node[] = [forOfInNode.left, forOfInNode.right];
    const headerNode = this.addNode(headerPayload);
    const bodyEntry = this.addNode(null);
    const afterLoop = this.addNode(null);

    this.connect(incoming, headerNode, EdgeType.Normal);
    this.addExceptionEdgeIfInTry(headerNode);

    this.cfg.addEdge(headerNode, afterLoop, EdgeType.Normal);
    this.cfg.addEdge(headerNode, bodyEntry, EdgeType.Normal);

    const bodyTails = this.visitLoopBody(forOfInNode.body, bodyEntry, afterLoop, headerNode, loopStack, currentLabel);

    this.connect(bodyTails, headerNode, EdgeType.Normal);

    return [afterLoop];
  }

  private visitReturnStatement(returnNode_node: ReturnStatement, incoming: readonly NodeId[]): NodeId[] {
    const returnPayload: CfgNodePayload = returnNode_node.argument ?? returnNode_node;
    const returnNode = this.addNode(returnPayload);

    this.connect(incoming, returnNode, EdgeType.Normal);

    // Innermost active redirection wins: an inlined IIFE's after-call node or a
    // try's finalizer-return entry, whichever is on top. Falls back to the
    // function exit.
    const target = this.returnTargetStack[this.returnTargetStack.length - 1] ?? this.exitId;

    this.cfg.addEdge(returnNode, target, EdgeType.Normal);

    return [];
  }

  private getInlineableSyncIifeBody(callNode: CallExpression): Node | ReadonlyArray<Node> | null {
    if (this.options.inlineSyncIifes !== true || callNode.optional === true || callNode.arguments.length > 0) {
      return null;
    }

    const callee = unwrapExpression(callNode.callee);

    if (callee === null || !isFunctionNode(callee)) {
      return null;
    }

    const fn = callee as Node & {
      async?: boolean;
      generator?: boolean;
      params?: ReadonlyArray<Node>;
      body?: Node | null;
    };

    if (fn.async === true || fn.generator === true || (fn.params?.length ?? 0) > 0 || fn.body === null || fn.body === undefined) {
      return null;
    }

    // Binding identity is resolved later by getStandaloneFileBindings. IIFE-local
    // declarations have distinct declScope keys and are absent from the enclosing
    // localIndexByName, so processNodeUsages ignores them; outer references keep
    // their original declScope and still resolve to the enclosing variable.

    return fn.body.type === 'BlockStatement' ? (fn.body as BlockStatement).body : fn.body;
  }

  private visitExpressionStatement(
    expressionNode: ExpressionStatement,
    incoming: readonly NodeId[],
    loopStack: readonly LoopTargets[],
  ): NodeId[] | null {
    const expression = unwrapExpression(expressionNode.expression);

    if (expression === null) {
      return null;
    }

    if (expression.type === 'CallExpression') {
      return this.visitInlineableIifeCall(expression, incoming, loopStack, null);
    }

    if (
      expression.type === 'AssignmentExpression' &&
      expression.operator === '=' &&
      expression.left.type === 'Identifier' &&
      expression.right.type === 'CallExpression'
    ) {
      return this.visitInlineableIifeCall(expression.right, incoming, loopStack, expressionNode);
    }

    return null;
  }

  private visitVariableDeclarationWithInlineableIife(
    node: Node,
    incoming: readonly NodeId[],
    loopStack: readonly LoopTargets[],
  ): NodeId[] | null {
    if (node.type !== 'VariableDeclaration' || node.declarations.length !== 1) {
      return null;
    }

    const declarator = node.declarations[0];

    if (declarator === undefined || declarator.id.type !== 'Identifier' || declarator.init?.type !== 'CallExpression') {
      return null;
    }

    return this.visitInlineableIifeCall(declarator.init, incoming, loopStack, node);
  }

  private visitInlineableIifeCall(
    callNode: CallExpression,
    incoming: readonly NodeId[],
    loopStack: readonly LoopTargets[],
    afterPayload: CfgNodePayload | null,
  ): NodeId[] | null {
    const body = this.getInlineableSyncIifeBody(callNode);

    if (body === null) {
      return null;
    }

    const afterCall = this.addNode(null);

    this.returnTargetStack.push(afterCall);

    const tails = this.visitStatement(body, incoming, loopStack, null);

    this.returnTargetStack.pop();
    this.connect(tails, afterCall, EdgeType.Normal);

    if (afterPayload === null) {
      return [afterCall];
    }

    const afterPayloadNode = this.addNode(afterPayload);

    this.cfg.addEdge(afterCall, afterPayloadNode, EdgeType.Normal);
    this.addExceptionEdgeIfInTry(afterPayloadNode);

    return [afterPayloadNode];
  }

  private visitStatement(
    node: Node | ReadonlyArray<Node> | undefined,
    incoming: readonly NodeId[],
    loopStack: readonly LoopTargets[],
    currentLabel: string | null,
  ): NodeId[] {
    if (Array.isArray(node)) {
      let tails: NodeId[] = [...incoming];

      for (const entry of node) {
        tails = this.visitStatement(entry, tails, loopStack, null);
      }

      return tails;
    }

    if (!isOxcNode(node)) {
      return [...incoming];
    }

    switch (node.type) {
      case 'BlockStatement': {
        return this.visitBlockStatement(node, incoming, loopStack);
      }

      case 'LabeledStatement': {
        return this.visitStatement(node.body, incoming, loopStack, node.label.name);
      }

      case 'IfStatement': {
        return this.visitIfStatement(node, incoming, loopStack);
      }

      case 'WhileStatement': {
        return this.visitWhileStatement(node, incoming, loopStack, currentLabel);
      }

      case 'DoWhileStatement': {
        return this.visitDoWhileStatement(node, incoming, loopStack, currentLabel);
      }

      case 'ForOfStatement':
      case 'ForInStatement': {
        return this.visitForOfInStatement(node, incoming, loopStack, currentLabel);
      }

      case 'ForStatement': {
        return this.visitForStatement(node, incoming, loopStack, currentLabel);
      }

      case 'SwitchStatement': {
        return this.visitSwitchStatement(node, incoming, loopStack, currentLabel);
      }

      case 'BreakStatement': {
        return this.visitJumpStatement(node, incoming, loopStack, true);
      }

      case 'ContinueStatement': {
        return this.visitJumpStatement(node, incoming, loopStack, false);
      }

      case 'ReturnStatement': {
        return this.visitReturnStatement(node, incoming);
      }

      case 'ThrowStatement': {
        return this.visitThrowStatement(node, incoming);
      }

      case 'TryStatement': {
        return this.visitTryStatement(node, incoming, loopStack);
      }

      case 'ExpressionStatement': {
        const iifeTails = this.visitExpressionStatement(node, incoming, loopStack);

        if (iifeTails !== null) {
          return iifeTails;
        }

        break;
      }

      case 'VariableDeclaration': {
        const iifeTails = this.visitVariableDeclarationWithInlineableIife(node, incoming, loopStack);

        if (iifeTails !== null) {
          return iifeTails;
        }

        break;
      }

      default: {
        break;
      }
    }

    const statementNode = this.addNode(node);

    this.connect(incoming, statementNode, EdgeType.Normal);
    this.addExceptionEdgeIfInTry(statementNode);

    return [statementNode];
  }

  private visitBlockStatement(
    blockNode: BlockStatement,
    incoming: readonly NodeId[],
    loopStack: readonly LoopTargets[],
  ): NodeId[] {
    let tails: NodeId[] = [...incoming];

    for (const child of blockNode.body) {
      tails = this.visitStatement(child, tails, loopStack, null);
    }

    return tails;
  }

  private visitThrowStatement(throwNode_node: ThrowStatement, incoming: readonly NodeId[]): NodeId[] {
    const throwNode = this.addNode(throwNode_node.argument);

    this.connect(incoming, throwNode, EdgeType.Normal);

    // Route the exception edge to the innermost active catch handler, if any. Without
    // this, a `throw` inside `try { throw } catch (e) { ... }` skipped the catch block
    // entirely so reads in the handler were invisible to dataflow analysis.
    const activeCatch = this.activeCatchEntryStack[this.activeCatchEntryStack.length - 1];
    const exceptionTarget = activeCatch !== undefined ? activeCatch : this.exitId;

    this.cfg.addEdge(throwNode, exceptionTarget, EdgeType.Exception);

    return [];
  }

  private visitTryStatement(tryNode: TryStatement, incoming: readonly NodeId[], loopStack: readonly LoopTargets[]): NodeId[] {
    const hasFinalizer = tryNode.finalizer !== null;
    const finallyEntryNormal = hasFinalizer ? this.addNode(null) : null;
    const finallyEntryReturn = hasFinalizer ? this.addNode(null) : null;
    // Exception-path entry into the finalizer. When the try has no catch but does
    // have a finalizer, throws inside the try body must run the finalizer before
    // propagating, so the finalizer body has to be reachable along the exception edge.
    const finallyEntryException = hasFinalizer && tryNode.handler === null ? this.addNode(null) : null;

    if (finallyEntryReturn !== null) {
      this.returnTargetStack.push(finallyEntryReturn);
    }

    const tryEntry = this.addNode(null);

    this.connect(incoming, tryEntry, EdgeType.Normal);

    const tryBlockEntry = this.addNode(null);

    this.cfg.addEdge(tryEntry, tryBlockEntry, EdgeType.Normal);

    const { tryTails, catchTails } = this.visitTryBlock(tryNode, tryBlockEntry, loopStack, finallyEntryException);

    if (tryNode.finalizer !== null && finallyEntryNormal !== null && finallyEntryReturn !== null) {
      return this.visitFinalizer(
        tryNode.finalizer,
        tryTails,
        catchTails,
        finallyEntryNormal,
        finallyEntryReturn,
        finallyEntryException,
        loopStack,
      );
    }

    if (finallyEntryReturn !== null) {
      this.returnTargetStack.pop();
    }

    return [...tryTails, ...catchTails];
  }

  private visitTryBlock(
    tryNode: TryStatement,
    tryBlockEntry: NodeId,
    loopStack: readonly LoopTargets[],
    finallyEntryException: NodeId | null,
  ): { tryTails: NodeId[]; catchTails: NodeId[] } {
    if (tryNode.handler === null) {
      // No catch: finally (if present) acts as the exception handler so throws in the
      // try body still run finally before the exception propagates outward.
      if (finallyEntryException !== null) {
        // Exception before any try statement completes: pre-try state reaches the
        // finalizer's exception entry (so a `let x = init` before the try is live
        // along the throw path, not killed by an assignment that may not run).
        this.cfg.addEdge(tryBlockEntry, finallyEntryException, EdgeType.Exception);
        this.activeCatchEntryStack.push(finallyEntryException);
      }

      const tryTails = this.visitStatement(tryNode.block, [tryBlockEntry], loopStack, null);

      if (finallyEntryException !== null) {
        this.activeCatchEntryStack.pop();
      }

      return { tryTails, catchTails: [] };
    }

    const catchEntry = this.addNode(null);

    // Exception before any try statement completes: the state entering the try
    // body (e.g. a fallback `let x = init` declared before the try) reaches the
    // catch entry. Without this edge, a try-body assignment `x = compute()` would
    // be treated as if it always executes, killing the init's reach to post-try
    // uses and falsely flagging `let x = init` as a dead store — even though on
    // the throw path the init survives and is read after the try/catch.
    this.cfg.addEdge(tryBlockEntry, catchEntry, EdgeType.Exception);

    this.activeCatchEntryStack.push(catchEntry);

    const tryTails = this.visitStatement(tryNode.block, [tryBlockEntry], loopStack, null);

    this.activeCatchEntryStack.pop();

    const catchTails = this.visitStatement(tryNode.handler.body, [catchEntry], loopStack, null);

    return { tryTails, catchTails };
  }

  private visitFinalizer(
    finalizer: Node,
    tryTails: NodeId[],
    catchTails: NodeId[],
    finallyEntryNormal: NodeId,
    finallyEntryReturn: NodeId,
    finallyEntryException: NodeId | null,
    loopStack: readonly LoopTargets[],
  ): NodeId[] {
    // Pop THIS try's return entry before visiting the finalizer bodies: once we
    // are inside the finalizer, this try's return handling is done, so the
    // finalizer's own statements (and the return-completion target) must route
    // to the NEXT OUTER target, not back to this try's own entry.
    this.returnTargetStack.pop();

    // Normal completion path.
    this.connect(tryTails, finallyEntryNormal, EdgeType.Normal);
    this.connect(catchTails, finallyEntryNormal, EdgeType.Normal);

    const finallyTails = this.visitStatement(finalizer, [finallyEntryNormal], loopStack, null);
    // Return completion path: run finalizer and then complete the return to the
    // next outer target (function exit, an outer finally, or an enclosing IIFE).
    const finallyReturnTails = this.visitStatement(finalizer, [finallyEntryReturn], loopStack, null);
    const outerReturnTarget = this.returnTargetStack[this.returnTargetStack.length - 1] ?? this.exitId;

    for (const tail of finallyReturnTails) {
      this.cfg.addEdge(tail, outerReturnTarget, EdgeType.Normal);
    }

    // Exception completion path (try without catch): run the finalizer, then re-raise
    // the exception toward the next outer handler or the function exit.
    if (finallyEntryException !== null) {
      const finallyExceptionTails = this.visitStatement(finalizer, [finallyEntryException], loopStack, null);
      const outerExceptionTarget =
        this.activeCatchEntryStack.length > 0 ? this.activeCatchEntryStack[this.activeCatchEntryStack.length - 1]! : this.exitId;

      for (const tail of finallyExceptionTails) {
        this.cfg.addEdge(tail, outerExceptionTarget, EdgeType.Exception);
      }
    }

    // (Return entry already popped at the top of this method.)
    return finallyTails;
  }
}
