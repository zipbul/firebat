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
      this.addNormalEdge(tail, this.exitId);
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

  /**
   * Add a CFG node for `payload` and wire every `incoming` predecessor into it
   * with a Normal edge, returning the new node. The single "materialize a node
   * at a join from its predecessors" decision: statement/payload nodes in the
   * jump/return/switch visitors, and (with a null payload) the if-statement's
   * branch-merge node.
   */
  private addNodeFrom(incoming: readonly NodeId[], payload: CfgNodePayload | null): NodeId {
    const node = this.addNode(payload);

    this.connect(incoming, node, EdgeType.Normal);

    return node;
  }

  // Single-edge constructors: one decision point per edge type. Each is distinct
  // (the EdgeType property is part of the decision, not a substitutable literal),
  // so a change to how an edge of a given kind is recorded has one home.
  private addNormalEdge(from: NodeId, to: NodeId): void {
    this.cfg.addEdge(from, to, EdgeType.Normal);
  }

  private addTrueEdge(from: NodeId, to: NodeId): void {
    this.cfg.addEdge(from, to, EdgeType.True);
  }

  private addFalseEdge(from: NodeId, to: NodeId): void {
    this.cfg.addEdge(from, to, EdgeType.False);
  }

  private addExceptionEdge(from: NodeId, to: NodeId): void {
    this.cfg.addEdge(from, to, EdgeType.Exception);
  }

  /** Branch a condition node both ways: True to `trueTarget`, False to `falseTarget`. */
  private addBranchEdges(conditionNode: NodeId, trueTarget: NodeId, falseTarget: NodeId): void {
    this.addTrueEdge(conditionNode, trueTarget);
    this.addFalseEdge(conditionNode, falseTarget);
  }

  /** Innermost active catch/finalizer handler entry, or undefined if not inside a try. */
  private currentCatchEntry(): NodeId | undefined {
    return this.activeCatchEntryStack[this.activeCatchEntryStack.length - 1];
  }

  /** Innermost active return-redirection target (inlined IIFE / finalizer), falling back to the function exit. */
  private currentReturnTarget(): NodeId {
    return this.returnTargetStack[this.returnTargetStack.length - 1] ?? this.exitId;
  }

  private addExceptionEdgeIfInTry(nodeId: NodeId): void {
    const catchEntry = this.currentCatchEntry();

    if (catchEntry !== undefined) {
      this.addExceptionEdge(nodeId, catchEntry);
    }
  }

  /**
   * Wire `incoming` predecessors into an existing `node` with a Normal edge and
   * register its in-try exception edge. The single "a node both completes
   * normally from its predecessors and may throw" decision used by the for/while
   * header nodes.
   */
  private connectInto(incoming: readonly NodeId[], node: NodeId): void {
    this.connectIntoThrowable(incoming, node, node);
  }

  private connectIntoThrowable(incoming: readonly NodeId[], target: NodeId, throwableNode: NodeId): void {
    this.connect(incoming, target, EdgeType.Normal);
    this.addExceptionEdgeIfInTry(throwableNode);
  }

  private connectAndContinueWith(fromNodes: readonly NodeId[], target: NodeId, nextTail: NodeId): NodeId[] {
    this.connect(fromNodes, target, EdgeType.Normal);

    return [nextTail];
  }

  private popReturnTargetAndConnect(fromNodes: readonly NodeId[], target: NodeId): void {
    this.returnTargetStack.pop();
    this.connect(fromNodes, target, EdgeType.Normal);
  }

  /**
   * Make `handlerEntry` the active exception handler for the try body: route a
   * pre-statement exception edge from `tryBlockEntry` to it and push it as the
   * innermost catch entry. The single decision shared by the catch and
   * finally-as-handler paths. Caller pops the stack once the try body is visited.
   */
  private installCatchHandler(tryBlockEntry: NodeId, handlerEntry: NodeId): void {
    this.addExceptionEdge(tryBlockEntry, handlerEntry);
    this.activeCatchEntryStack.push(handlerEntry);
  }

  private addConditionalEdges(
    conditionNode: NodeId,
    trueTarget: NodeId,
    falseTarget: NodeId,
    truthiness: boolean | null,
    treatMissingAsTrue: boolean,
  ): void {
    if (truthiness === true) {
      this.addTrueEdge(conditionNode, trueTarget);

      return;
    }

    if (truthiness === false) {
      this.addFalseEdge(conditionNode, falseTarget);

      return;
    }

    if (treatMissingAsTrue) {
      this.addTrueEdge(conditionNode, trueTarget);

      return;
    }

    this.addBranchEdges(conditionNode, trueTarget, falseTarget);
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
  /** Push a break/continue/label scope onto the loop stack. The single jump-target registration decision shared by loops and switches. */
  private extendLoopStack(
    loopStack: readonly LoopTargets[],
    breakTarget: NodeId,
    continueTarget: NodeId,
    currentLabel: string | null,
  ): LoopTargets[] {
    return [...loopStack, { breakTarget, continueTarget, label: currentLabel }];
  }

  private visitLoopBody(
    body: Node,
    bodyEntry: NodeId,
    breakTarget: NodeId,
    continueTarget: NodeId,
    loopStack: readonly LoopTargets[],
    currentLabel: string | null,
  ): NodeId[] {
    const nextLoopStack = this.extendLoopStack(loopStack, breakTarget, continueTarget, currentLabel);

    return this.visitStatement(body, [bodyEntry], nextLoopStack, null);
  }

  /**
   * 루프 본문을 방문하고, 본문 tail을 back-edge 타깃으로 되돌린 뒤 afterLoop로 빠져나간다.
   * continue 타깃과 back-edge 타깃이 같은 루프(while/for-of/for-in)가 공유하는 epilogue.
   */
  private visitLoopBodyAndExit(
    body: Node,
    bodyEntry: NodeId,
    afterLoop: NodeId,
    backEdgeTarget: NodeId,
    loopStack: readonly LoopTargets[],
    currentLabel: string | null,
  ): NodeId[] {
    const bodyTails = this.visitLoopBody(body, bodyEntry, afterLoop, backEdgeTarget, loopStack, currentLabel);

    return this.connectAndContinueWith(bodyTails, backEdgeTarget, afterLoop);
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
    const jumpNode = this.addNodeFrom(incoming, node);

    const targetLabel = node.label?.name ?? null;
    const target = this.resolveLoopTarget(loopStack, targetLabel, useBreakTarget);

    if (target !== null) {
      this.addNormalEdge(jumpNode, target);
    }

    return [];
  }

  /** Tails of an if-statement's alternate: the false entry itself when there is no `else`, otherwise the visited alternate. */
  private visitAlternate(ifNode: IfStatement, falseEntry: NodeId, loopStack: readonly LoopTargets[]): NodeId[] {
    return ifNode.alternate === null ? [falseEntry] : this.visitStatement(ifNode.alternate, [falseEntry], loopStack, null);
  }

  private visitIfStatement(ifNode: IfStatement, incoming: readonly NodeId[], loopStack: readonly LoopTargets[]): NodeId[] {
    const conditionNode = this.addNode(ifNode.test);
    const truthiness = evalStaticTruthiness(ifNode.test);

    this.connect(incoming, conditionNode, EdgeType.Normal);

    const trueEntry = this.addNode(null);
    const falseEntry = this.addNode(null);

    if (truthiness === true) {
      this.addTrueEdge(conditionNode, trueEntry);

      const trueTails = this.visitStatement(ifNode.consequent, [trueEntry], loopStack, null);

      return [this.addNodeFrom(trueTails, null)];
    }

    if (truthiness === false) {
      this.addFalseEdge(conditionNode, falseEntry);

      const falseTails = this.visitAlternate(ifNode, falseEntry, loopStack);

      return [this.addNodeFrom(falseTails, null)];
    }

    this.addBranchEdges(conditionNode, trueEntry, falseEntry);

    const trueTails = this.visitStatement(ifNode.consequent, [trueEntry], loopStack, null);
    const falseTails = this.visitAlternate(ifNode, falseEntry, loopStack);
    const mergeNode = this.addNodeFrom(trueTails, null);

    return this.connectAndContinueWith(falseTails, mergeNode, mergeNode);
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
    const discriminantNode = this.addNodeFrom(incoming, discriminantPayload);

    const afterSwitch = this.addNode(null);
    const caseEntries: NodeId[] = switchNode.cases.map(() => this.addNode(null));

    for (const entry of caseEntries) {
      this.addNormalEdge(discriminantNode, entry);
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
      this.addNormalEdge(discriminantNode, afterSwitch);
    }

    const nextLoopStack = this.extendLoopStack(loopStack, afterSwitch, afterSwitch, currentLabel);

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

      this.connectInto(tails, initNode);

      tails = [initNode];
    }

    const testNode = this.addNode(forNode.test);
    const truthiness = evalStaticTruthiness(forNode.test ?? undefined);

    this.connectInto(tails, testNode);

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
      this.addNormalEdge(updateNode, testNode);
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

    this.connectInto(incoming, conditionNode);

    const bodyEntry = this.addNode(null);
    const afterLoop = this.addNode(null);

    this.addConditionalEdges(conditionNode, bodyEntry, afterLoop, truthiness, false);

    if (truthiness === false) {
      return [afterLoop];
    }

    return this.visitLoopBodyAndExit(whileNode.body, bodyEntry, afterLoop, conditionNode, loopStack, currentLabel);
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

    this.connectIntoThrowable(incoming, bodyEntry, conditionNode);

    const bodyTails = this.visitLoopBody(doWhileNode.body, bodyEntry, afterLoop, conditionNode, loopStack, currentLabel);

    this.connect(bodyTails, conditionNode, EdgeType.Normal);

    this.addBranchEdges(conditionNode, bodyEntry, afterLoop);

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

    this.connectInto(incoming, headerNode);

    this.addNormalEdge(headerNode, afterLoop);
    this.addNormalEdge(headerNode, bodyEntry);

    return this.visitLoopBodyAndExit(forOfInNode.body, bodyEntry, afterLoop, headerNode, loopStack, currentLabel);
  }

  private visitReturnStatement(returnNode_node: ReturnStatement, incoming: readonly NodeId[]): NodeId[] {
    const returnPayload: CfgNodePayload = returnNode_node.argument ?? returnNode_node;
    const returnNode = this.addNodeFrom(incoming, returnPayload);

    // Innermost active redirection wins: an inlined IIFE's after-call node or a
    // try's finalizer-return entry, whichever is on top. Falls back to the
    // function exit.
    const target = this.currentReturnTarget();

    this.addNormalEdge(returnNode, target);

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

    this.popReturnTargetAndConnect(tails, afterCall);

    if (afterPayload === null) {
      return [afterCall];
    }

    const afterPayloadNode = this.addNode(afterPayload);

    this.addNormalEdge(afterCall, afterPayloadNode);
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

    const statementNode = this.addNodeFrom(incoming, node);

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
    const throwNode = this.addNodeFrom(incoming, throwNode_node.argument);

    // Route the exception edge to the innermost active catch handler, if any. Without
    // this, a `throw` inside `try { throw } catch (e) { ... }` skipped the catch block
    // entirely so reads in the handler were invisible to dataflow analysis.
    const activeCatch = this.currentCatchEntry();
    const exceptionTarget = activeCatch !== undefined ? activeCatch : this.exitId;

    this.addExceptionEdge(throwNode, exceptionTarget);

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

    const tryEntry = this.addNodeFrom(incoming, null);

    const tryBlockEntry = this.addNode(null);

    this.addNormalEdge(tryEntry, tryBlockEntry);

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
        this.installCatchHandler(tryBlockEntry, finallyEntryException);
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
    this.installCatchHandler(tryBlockEntry, catchEntry);

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
    this.popReturnTargetAndConnect(tryTails, finallyEntryNormal);

    // Normal completion path.
    this.connect(catchTails, finallyEntryNormal, EdgeType.Normal);

    const finallyTails = this.visitStatement(finalizer, [finallyEntryNormal], loopStack, null);
    // Return completion path: run finalizer and then complete the return to the
    // next outer target (function exit, an outer finally, or an enclosing IIFE).
    const finallyReturnTails = this.visitStatement(finalizer, [finallyEntryReturn], loopStack, null);
    const outerReturnTarget = this.currentReturnTarget();

    this.connect(finallyReturnTails, outerReturnTarget, EdgeType.Normal);

    // Exception completion path (try without catch): run the finalizer, then re-raise
    // the exception toward the next outer handler or the function exit.
    if (finallyEntryException !== null) {
      const finallyExceptionTails = this.visitStatement(finalizer, [finallyEntryException], loopStack, null);
      const outerExceptionTarget =
        this.activeCatchEntryStack.length > 0 ? this.activeCatchEntryStack[this.activeCatchEntryStack.length - 1]! : this.exitId;

      this.connect(finallyExceptionTails, outerExceptionTarget, EdgeType.Exception);
    }

    // (Return entry already popped at the top of this method.)
    return finallyTails;
  }
}
