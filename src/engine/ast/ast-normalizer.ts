import type {
  ArrowFunctionExpression,
  AssignmentExpression,
  BlockStatement,
  CallExpression,
  ChainExpression,
  ConditionalExpression,
  ExpressionStatement,
  ForOfStatement,
  IdentifierReference,
  IfStatement,
  LogicalExpression,
  Node,
  ParenthesizedExpression,
  ReturnStatement,
  StaticMemberExpression,
  TemplateElement,
  TemplateLiteral,
  UnaryExpression,
  VariableDeclaration,
  VariableDeclarator,
} from 'oxc-parser';

import type { NodeValue } from '../types';

import { forEachChildNode, isFunctionNode, isNodeRecord, isOxcNode, isOxcNodeArray, walkOxcTree } from './oxc-ast-utils';

type AnyNode = Node & Record<string, unknown>;

type NormalizedValue = NodeValue;

const withType = (type: string, fields: Record<string, unknown> = {}): Node => {
  return { type, start: 0, end: 0, ...fields } as unknown as Node;
};

const literal = (value: unknown): Node => withType('Literal', { value });

const identifier = (name: string): Node => withType('Identifier', { name });

const block = (body: ReadonlyArray<Node>): Node => withType('BlockStatement', { body: [...body] });

const expressionStatement = (expression: Node): Node => withType('ExpressionStatement', { expression });

const unary = (operator: string, argument: Node): Node => withType('UnaryExpression', { operator, argument, prefix: true });

const logical = (operator: string, left: Node, right: Node): Node => withType('LogicalExpression', { operator, left, right });

const binary = (operator: string, left: Node, right: Node): Node => withType('BinaryExpression', { operator, left, right });

const conditional = (test: Node, consequent: Node, alternate: Node): Node =>
  withType('ConditionalExpression', { test, consequent, alternate });

const returnStatement = (argument: Node): Node => withType('ReturnStatement', { argument });

const memberExpression = (object: Node, property: Node, computed: boolean): Node =>
  withType('MemberExpression', { object, property, computed, optional: false });

const forOfStatement = (left: Node, right: Node, body: Node): Node =>
  withType('ForOfStatement', { left, right, body, await: false });

const whileStatement = (test: Node, bodyNode: Node): Node => withType('WhileStatement', { test, body: bodyNode });

const variableDeclarator = (id: Node, init?: Node): Node => withType('VariableDeclarator', { id, init: init ?? null });

const variableDeclaration = (kind: 'const' | 'let' | 'var', declarations: ReadonlyArray<Node>): Node =>
  withType('VariableDeclaration', { kind, declarations: [...declarations] });

const hasReturnStatement = (node: NodeValue): boolean => {
  if (!isOxcNode(node)) {
    return false;
  }

  let found = false;

  walkOxcTree(node, value => {
    if (found) {
      return false;
    }

    if (value.type === 'ReturnStatement') {
      found = true;

      return false;
    }

    return true;
  });

  return found;
};

const isIdentifierNamed = (node: NodeValue, name: string): boolean => {
  if (!isOxcNode(node) || node.type !== 'Identifier') {
    return false;
  }

  return (node as IdentifierReference).name === name;
};

const isMemberNamed = (callee: NodeValue, name: string): { object: Node; computed: boolean } | null => {
  if (!isOxcNode(callee) || callee.type !== 'MemberExpression') {
    return null;
  }

  const member = callee as StaticMemberExpression;

  if (member.computed) {
    return null;
  }

  if (!isIdentifierNamed(member.property as NodeValue, name)) {
    return null;
  }

  return { object: member.object as Node, computed: false };
};

const toBlock = (value: NodeValue): Node | null => {
  if (!isOxcNode(value)) {
    return null;
  }

  if (value.type === 'BlockStatement') {
    return value;
  }

  return block([value]);
};

/** BlockStatement로 확인된 노드의 body 문장 배열을 안전하게 읽는다 (단일 결정 지점). */
const blockBodyStatements = (blockNode: Node): Node[] => {
  const bs = blockNode as BlockStatement;

  return Array.isArray(bs.body) ? (bs.body as Node[]) : [];
};

const appendToBlockBody = (bodyNode: Node, statement: Node): Node => {
  if (!isNodeRecord(bodyNode) || bodyNode.type !== 'BlockStatement') {
    return block([bodyNode, statement]);
  }

  const body = blockBodyStatements(bodyNode);

  return block([...body, statement]);
};

const appendQuasiPart = (quasi: TemplateElement | undefined, parts: Node[]): void => {
  if (!quasi) {
    return;
  }

  const value = quasi.value;
  const cooked = typeof value?.cooked === 'string' ? value.cooked : typeof value?.raw === 'string' ? value.raw : '';

  if (cooked.length > 0) {
    parts.push(literal(cooked));
  }
};

const normalizeTemplateLiteralToConcat = (node: AnyNode): NodeValue => {
  const tl = node as TemplateLiteral;
  const quasis = Array.isArray(tl.quasis) ? (tl.quasis as TemplateElement[]) : [];
  const expressions = Array.isArray(tl.expressions) ? (tl.expressions as Node[]) : [];
  const parts: Node[] = [];

  for (let index = 0; index < quasis.length; index += 1) {
    appendQuasiPart(quasis[index], parts);

    const expr = expressions[index];

    if (isOxcNode(expr)) {
      parts.push(expr);
    }
  }

  if (parts.length === 0) {
    return literal('');
  }

  let current = parts[0] as Node;

  for (let index = 1; index < parts.length; index += 1) {
    current = binary('+', current, parts[index] as Node);
  }

  return current;
};

const normalizeOptionalChain = (node: AnyNode): NodeValue | null => {
  if (node.type !== 'ChainExpression') {
    return null;
  }

  const expression = (node as ChainExpression).expression;

  if (!isOxcNode(expression as NodeValue) || !isNodeRecord(expression as Node)) {
    return null;
  }

  if ((expression as Node).type !== 'MemberExpression') {
    return null;
  }

  const me = expression as StaticMemberExpression;
  const optional = Boolean(me.optional);

  if (!optional) {
    return null;
  }

  const object = me.object as Node;
  const property = me.property as Node;
  const computed = me.computed;

  if (!isOxcNode(object as NodeValue) || !isOxcNode(property as NodeValue)) {
    return null;
  }

  const test = binary('!=', object, literal(null));
  const consequent = memberExpression(object, property, computed);
  const alternate = identifier('undefined');

  return conditional(test, consequent, alternate);
};

const normalizeDeMorgan = (node: AnyNode): NodeValue | null => {
  if (node.type !== 'UnaryExpression') {
    return null;
  }

  const ue = node as UnaryExpression;

  if (ue.operator !== '!') {
    return null;
  }

  let argument: NodeValue = ue.argument as NodeValue;

  if (!isOxcNode(argument) || !isNodeRecord(argument as Node)) {
    return null;
  }

  if ((argument as Node).type === 'ParenthesizedExpression') {
    const pe = argument as ParenthesizedExpression;
    const expression = pe.expression;

    if (!isOxcNode(expression as NodeValue) || !isNodeRecord(expression as Node)) {
      return null;
    }

    argument = expression as NodeValue;
  }

  if ((argument as Node).type !== 'LogicalExpression') {
    return null;
  }

  const le = argument as LogicalExpression;
  const innerOperator = le.operator;

  if (innerOperator !== '&&' && innerOperator !== '||') {
    return null;
  }

  const left = le.left as Node;
  const right = le.right as Node;

  if (!isOxcNode(left as NodeValue) || !isOxcNode(right as NodeValue)) {
    return null;
  }

  return logical(innerOperator === '&&' ? '||' : '&&', unary('!', left), unary('!', right));
};

const normalizeTernaryInversion = (node: AnyNode): NodeValue | null => {
  if (node.type !== 'ConditionalExpression') {
    return null;
  }

  const ce = node as ConditionalExpression;
  const test = ce.test;

  if (!isOxcNode(test as NodeValue) || !isNodeRecord(test as Node)) {
    return null;
  }

  if ((test as Node).type !== 'UnaryExpression') {
    return null;
  }

  const ue = test as UnaryExpression;

  if (ue.operator !== '!') {
    return null;
  }

  const argument = ue.argument as NodeValue;

  if (!isOxcNode(argument)) {
    return null;
  }

  const consequent = ce.consequent;
  const alternate = ce.alternate;

  if (!isOxcNode(consequent as NodeValue) || !isOxcNode(alternate as NodeValue)) {
    return null;
  }

  return conditional(argument as Node, alternate as Node, consequent as Node);
};

const unwrapSingleStatement = (stmt: Node): Node | null => {
  if (!isNodeRecord(stmt)) {
    return null;
  }

  if (stmt.type !== 'BlockStatement') {
    return stmt;
  }

  const body = blockBodyStatements(stmt);

  if (body.length !== 1 || !isOxcNode(body[0])) {
    return null;
  }

  return body[0] as Node;
};

interface ReturnPair {
  readonly cArg: Node;
  readonly aArg: Node;
}

const tryExtractReturnPair = (c: Node, a: Node): ReturnPair | null => {
  if (c.type !== 'ReturnStatement' || a.type !== 'ReturnStatement') {
    return null;
  }

  if (!isNodeRecord(c) || !isNodeRecord(a)) {
    return null;
  }

  const cArg = (c as ReturnStatement).argument;
  const aArg = (a as ReturnStatement).argument;

  if (!isOxcNode(cArg as NodeValue) || !isOxcNode(aArg as NodeValue)) {
    return null;
  }

  return { cArg: cArg as Node, aArg: aArg as Node };
};

interface AssignmentPair {
  readonly left: Node;
  readonly rightC: Node;
  readonly rightA: Node;
}

const tryExtractSameIdentifierAssignment = (cExpr: Node, aExpr: Node): AssignmentPair | null => {
  if (
    !isNodeRecord(cExpr) ||
    !isNodeRecord(aExpr) ||
    cExpr.type !== 'AssignmentExpression' ||
    aExpr.type !== 'AssignmentExpression'
  ) {
    return null;
  }

  const aeC = cExpr as AssignmentExpression;
  const aeA = aExpr as AssignmentExpression;

  if (aeC.operator !== '=' || aeA.operator !== '=') {
    return null;
  }

  const leftC = aeC.left as Node;
  const leftA = aeA.left as Node;
  const rightC = aeC.right as Node;
  const rightA = aeA.right as Node;

  if (
    !isOxcNode(leftC as NodeValue) ||
    !isOxcNode(leftA as NodeValue) ||
    !isOxcNode(rightC as NodeValue) ||
    !isOxcNode(rightA as NodeValue)
  ) {
    return null;
  }

  if (leftC.type !== 'Identifier' || leftA.type !== 'Identifier') {
    return null;
  }

  const nameC = (leftC as IdentifierReference).name;
  const nameA = (leftA as IdentifierReference).name;

  if (typeof nameC !== 'string' || typeof nameA !== 'string' || nameC !== nameA) {
    return null;
  }

  return { left: leftC, rightC, rightA };
};

const normalizeIfElseToTernary = (node: AnyNode): NodeValue | null => {
  if (node.type !== 'IfStatement') {
    return null;
  }

  const is = node as IfStatement;
  const test = is.test;
  const consequent = is.consequent;
  const alternate = is.alternate;

  if (!isOxcNode(test as NodeValue) || !isOxcNode(consequent as NodeValue) || !isOxcNode(alternate as NodeValue)) {
    return null;
  }

  const c = unwrapSingleStatement(consequent as Node);
  const a = unwrapSingleStatement(alternate as Node);

  if (c == null || a == null) {
    return null;
  }

  // Only normalize `return A` / `return B`.
  const returnPair = tryExtractReturnPair(c, a);

  if (returnPair !== null) {
    return returnStatement(conditional(test as Node, returnPair.cArg, returnPair.aArg));
  }

  // Only normalize expression statements.
  if (c.type !== 'ExpressionStatement' || a.type !== 'ExpressionStatement') {
    return null;
  }

  if (!isNodeRecord(c) || !isNodeRecord(a)) {
    return null;
  }

  const cExpr = (c as ExpressionStatement).expression;
  const aExpr = (a as ExpressionStatement).expression;

  if (!isOxcNode(cExpr as NodeValue) || !isOxcNode(aExpr as NodeValue)) {
    return null;
  }

  // Prefer canonical `x = c ? a : b` when both sides are simple assignments to the same identifier.
  const assignPair = tryExtractSameIdentifierAssignment(cExpr as Node, aExpr as Node);

  if (assignPair === null) {
    // General case: `if (c) { expr1 } else { expr2 }` -> `c ? expr1 : expr2`.
    return expressionStatement(conditional(test as Node, cExpr as Node, aExpr as Node));
  }

  const assignment = withType('AssignmentExpression', {
    operator: '=',
    left: assignPair.left,
    right: conditional(test as Node, assignPair.rightC, assignPair.rightA),
  }) as unknown as Node;

  return expressionStatement(assignment);
};

/**
 * Returns true if `body` contains a ContinueStatement that targets the enclosing
 * for-loop (i.e. not inside a nested loop or nested function). Such loops cannot
 * be safely rewritten to `while` by appending the update expression: at runtime
 * `continue` skips the appended update, changing iteration semantics.
 */
const bodyContainsLoopContinue = (body: Node): boolean => {
  let found = false;

  const walk = (n: Node): void => {
    if (found) {
      return;
    }

    if (n.type === 'ContinueStatement') {
      found = true;

      return;
    }

    // Continues in nested loops / functions target a different scope — ignore.
    if (
      n.type === 'ForStatement' ||
      n.type === 'WhileStatement' ||
      n.type === 'DoWhileStatement' ||
      n.type === 'ForInStatement' ||
      n.type === 'ForOfStatement' ||
      isFunctionNode(n)
    ) {
      return;
    }

    forEachChildNode(n, walk);
  };

  walk(body);

  return found;
};

const normalizeForToWhile = (node: AnyNode): NodeValue | null => {
  if (node.type !== 'ForStatement') {
    return null;
  }

  const initValue = node.init as unknown;
  const testValue = node.test as unknown;
  const updateValue = node.update as unknown;
  const bodyValue = node.body as unknown;
  const initNode = isOxcNode(initValue as NodeValue) ? (initValue as Node) : null;
  const testNode = isOxcNode(testValue as NodeValue) ? (testValue as Node) : literal(true);
  const updateNode = isOxcNode(updateValue as NodeValue) ? (updateValue as Node) : null;

  if (!isOxcNode(bodyValue as NodeValue)) {
    return null;
  }

  const originalBody = bodyValue as Node;

  // Bail out when the body contains `continue` targeting this loop: appending the
  // update expression to the body would let `continue` skip it, breaking semantics.
  if (updateNode !== null && bodyContainsLoopContinue(originalBody)) {
    return null;
  }

  let whileBody: Node = originalBody;

  if (updateNode !== null) {
    whileBody = appendToBlockBody(toBlock(originalBody) ?? originalBody, expressionStatement(updateNode));
  }

  const whileNode = whileStatement(testNode, whileBody);

  if (initNode === null) {
    return [whileNode];
  }

  // If init is an expression, wrap as an ExpressionStatement.
  if (initNode.type !== 'VariableDeclaration') {
    return [expressionStatement(initNode), whileNode];
  }

  return [initNode, whileNode];
};

const normalizeForEach = (node: AnyNode): NodeValue | null => {
  if (node.type !== 'ExpressionStatement' || !isNodeRecord(node)) {
    return null;
  }

  const expression = (node as ExpressionStatement).expression;

  if (
    !isOxcNode(expression as NodeValue) ||
    !isNodeRecord(expression as Node) ||
    (expression as Node).type !== 'CallExpression'
  ) {
    return null;
  }

  const call = expression as CallExpression;
  const callee = call.callee as NodeValue;
  const args = Array.isArray(call.arguments) ? (call.arguments as Node[]) : [];
  const member = isMemberNamed(callee, 'forEach');

  if (member === null || args.length !== 1) {
    return null;
  }

  const callback = args[0];

  if (
    !isOxcNode(callback as NodeValue) ||
    !isNodeRecord(callback as Node) ||
    (callback as Node).type !== 'ArrowFunctionExpression'
  ) {
    return null;
  }

  const afe = callback as ArrowFunctionExpression;
  const asyncFlag = Boolean(afe.async);

  if (asyncFlag) {
    return null;
  }

  const params = Array.isArray(afe.params) ? (afe.params as Node[]) : [];

  if (params.length !== 1 || params[0]?.type !== 'Identifier') {
    return null;
  }

  const bodyNode = afe.body as NodeValue;

  if (!isOxcNode(bodyNode)) {
    return null;
  }

  if (hasReturnStatement(bodyNode)) {
    return null;
  }

  const loopVar = params[0] as Node;
  const left = variableDeclaration('const', [variableDeclarator(loopVar)]);
  const bodyBlock = toBlock(bodyNode) ?? block([expressionStatement(bodyNode as Node)]);

  return forOfStatement(left, member.object, bodyBlock);
};

const normalizeMapFilterBoolean = (node: AnyNode): NodeValue | null => {
  if (node.type !== 'CallExpression' || !isNodeRecord(node)) {
    return null;
  }

  const outerCall = node as CallExpression;
  const callee = outerCall.callee as NodeValue;
  const args = Array.isArray(outerCall.arguments) ? (outerCall.arguments as Node[]) : [];
  const filterMember = isMemberNamed(callee, 'filter');

  if (filterMember === null || args.length !== 1) {
    return null;
  }

  if (!isIdentifierNamed(args[0], 'Boolean')) {
    return null;
  }

  const mapCall = filterMember.object;

  if (!isOxcNode(mapCall as NodeValue) || !isNodeRecord(mapCall as Node) || (mapCall as Node).type !== 'CallExpression') {
    return null;
  }

  const innerCall = mapCall as CallExpression;
  const mapCallee = innerCall.callee as NodeValue;
  const mapArgs = Array.isArray(innerCall.arguments) ? (innerCall.arguments as Node[]) : [];
  const mapMember = isMemberNamed(mapCallee, 'map');

  if (mapMember === null || mapArgs.length !== 1) {
    return null;
  }

  const callback = mapArgs[0];

  if (
    !isOxcNode(callback as NodeValue) ||
    !isNodeRecord(callback as Node) ||
    (callback as Node).type !== 'ArrowFunctionExpression'
  ) {
    return null;
  }

  const afe = callback as ArrowFunctionExpression;
  const params = Array.isArray(afe.params) ? (afe.params as Node[]) : [];

  if (params.length !== 1 || params[0]?.type !== 'Identifier') {
    return null;
  }

  const bodyNode = afe.body as NodeValue;

  if (!isOxcNode(bodyNode)) {
    return null;
  }

  // Use a synthetic normalized node shape so we can also normalize equivalent loop patterns.
  return withType('NormalizedMapFilterBoolean', {
    source: mapMember.object,
    mapBody: bodyNode,
  });
};

interface LoopPushCandidate {
  readonly right: Node;
  readonly init: Node;
}

interface ForOfBodyPair {
  readonly right: Node;
  readonly decl: Node;
  readonly guard: Node;
}

const extractForOfBodyPair = (node: AnyNode): ForOfBodyPair | null => {
  if (node.type !== 'ForOfStatement' || !isNodeRecord(node)) {
    return null;
  }

  const fos = node as ForOfStatement;
  const right = fos.right as Node;
  const bodyValue = fos.body as Node;

  if (!isOxcNode(right as NodeValue) || !isOxcNode(bodyValue as NodeValue) || !isNodeRecord(bodyValue as Node)) {
    return null;
  }

  if ((bodyValue as Node).type !== 'BlockStatement') {
    return null;
  }

  const body = blockBodyStatements(bodyValue as Node);

  if (body.length !== 2) {
    return null;
  }

  const decl = body[0];
  const guard = body[1];

  if (!isOxcNode(decl as NodeValue) || !isOxcNode(guard as NodeValue)) {
    return null;
  }

  return { right, decl: decl as Node, guard: guard as Node };
};

const extractInitFromVarDecl = (decl: Node): Node | null => {
  if (!isNodeRecord(decl) || (decl as Node).type !== 'VariableDeclaration') {
    return null;
  }

  const vd = decl as VariableDeclaration;
  const declarations = Array.isArray(vd.declarations) ? (vd.declarations as Node[]) : [];

  if (declarations.length !== 1 || !isOxcNode(declarations[0] as NodeValue) || !isNodeRecord(declarations[0] as Node)) {
    return null;
  }

  const declarator = declarations[0] as VariableDeclarator;

  if (declarator.type !== 'VariableDeclarator') {
    return null;
  }

  const id = declarator.id as Node;
  const init = declarator.init as Node | null;

  if (!isOxcNode(id as NodeValue) || (id as Node).type !== 'Identifier' || !isOxcNode(init as NodeValue)) {
    return null;
  }

  return init as Node;
};

interface GuardCallInfo {
  readonly test: Node;
  readonly callArg: Node;
}

const extractGuardCallArg = (guard: Node): GuardCallInfo | null => {
  if (!isNodeRecord(guard) || (guard as Node).type !== 'IfStatement') {
    return null;
  }

  const guardIf = guard as IfStatement;
  const test = guardIf.test as Node;
  const consequent = guardIf.consequent as Node;
  const alternate = guardIf.alternate;

  if (!isOxcNode(test as NodeValue) || alternate != null || !isOxcNode(consequent as NodeValue)) {
    return null;
  }

  const only = toBlock(consequent as NodeValue);

  if (only === null || !isNodeRecord(only)) {
    return null;
  }

  const consequentBody = blockBodyStatements(only as Node);

  if (consequentBody.length !== 1 || !isOxcNode(consequentBody[0] as NodeValue) || !isNodeRecord(consequentBody[0] as Node)) {
    return null;
  }

  const stmt = consequentBody[0] as Node;

  if (stmt.type !== 'ExpressionStatement') {
    return null;
  }

  const expr = (stmt as ExpressionStatement).expression as Node;

  if (!isOxcNode(expr as NodeValue) || !isNodeRecord(expr as Node) || (expr as Node).type !== 'CallExpression') {
    return null;
  }

  const callExpr = expr as CallExpression;
  const callArgs = Array.isArray(callExpr.arguments) ? (callExpr.arguments as Node[]) : [];

  if (callArgs.length !== 1 || callArgs[0]?.type !== 'Identifier') {
    return null;
  }

  return { test, callArg: callArgs[0] as Node };
};

const extractLoopPushCandidate = (node: AnyNode): LoopPushCandidate | null => {
  const bodyPair = extractForOfBodyPair(node);

  if (bodyPair === null) {
    return null;
  }

  const init = extractInitFromVarDecl(bodyPair.decl);

  if (init === null) {
    return null;
  }

  const guardInfo = extractGuardCallArg(bodyPair.guard);

  if (guardInfo === null) {
    return null;
  }

  if ((guardInfo.test as Node).type !== 'Identifier') {
    return null;
  }

  const testName = (guardInfo.test as IdentifierReference).name;
  const argName = (guardInfo.callArg as IdentifierReference).name;

  if (typeof testName !== 'string' || typeof argName !== 'string' || testName !== argName) {
    return null;
  }

  return { right: bodyPair.right, init };
};

const normalizeLoopPushBoolean = (node: AnyNode): NodeValue | null => {
  // Recognize: for (const x of items) { const mapped = <expr>; if (mapped) out.push(mapped); }
  const candidate = extractLoopPushCandidate(node);

  if (candidate === null) {
    return null;
  }

  return expressionStatement(
    withType('NormalizedMapFilterBoolean', {
      source: candidate.right,
      mapBody: candidate.init,
    }),
  );
};

let normalizationCache = new WeakMap<Node, NormalizedValue>();

const FUNCTION_LIKE_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/**
 * 함수 본문 말미의 값 없는 `return;`을 제거한다 — 함수 끝에서 떨어지는 것과 동일(둘 다 undefined 반환).
 * 함수 body 블록의 *마지막* 문장이고 argument가 없을 때만. (루프·if 본문의 return은 제어흐름이라 제외)
 * 건전성: 함수 말미 무조건 return;은 관찰 가능 동작이 fall-off와 같다 (generator·async 포함).
 */
const normalizeTrailingReturn = (node: AnyNode): NodeValue | null => {
  if (!FUNCTION_LIKE_TYPES.has(node.type)) {
    return null;
  }

  const body = (node as unknown as { body?: NodeValue }).body;

  if (!isNodeRecord(body) || (body as AnyNode).type !== 'BlockStatement') {
    return null;
  }

  const stmts = (body as unknown as { body?: NodeValue }).body;

  if (!Array.isArray(stmts) || stmts.length === 0) {
    return null;
  }

  const last = stmts[stmts.length - 1] as Node | undefined;

  if (last === undefined || !isNodeRecord(last) || (last as AnyNode).type !== 'ReturnStatement') {
    return null;
  }

  const arg = (last as unknown as { argument?: NodeValue }).argument;

  if (arg !== null && arg !== undefined) {
    return null;
  }

  const rec = node as unknown as Record<string, unknown>;

  return withType(node.type, { ...rec, body: block(stmts.slice(0, -1) as ReadonlyArray<Node>) });
};

const applyLocalRewrites = (normalized: AnyNode, functionDepth: number): NormalizedValue | null => {
  const trailingReturn = normalizeTrailingReturn(normalized);

  if (trailingReturn !== null) {
    return normalizeForFingerprintInternal(trailingReturn, functionDepth);
  }

  const ternaryInversion = normalizeTernaryInversion(normalized);

  if (ternaryInversion !== null) {
    return normalizeForFingerprintInternal(ternaryInversion, functionDepth);
  }

  const deMorgan = normalizeDeMorgan(normalized);

  if (deMorgan !== null) {
    return normalizeForFingerprintInternal(deMorgan, functionDepth);
  }

  const ifElse = normalizeIfElseToTernary(normalized);

  if (ifElse !== null) {
    return normalizeForFingerprintInternal(ifElse, functionDepth);
  }

  const optional = normalizeOptionalChain(normalized);

  if (optional !== null) {
    return normalizeForFingerprintInternal(optional, functionDepth);
  }

  if (normalized.type === 'TemplateLiteral') {
    return normalizeForFingerprintInternal(normalizeTemplateLiteralToConcat(normalized), functionDepth);
  }

  const forToWhile = normalizeForToWhile(normalized);

  if (forToWhile !== null) {
    return normalizeForFingerprintInternal(forToWhile, functionDepth);
  }

  const mapFilter = normalizeMapFilterBoolean(normalized);

  if (mapFilter !== null) {
    return normalizeForFingerprintInternal(mapFilter, functionDepth);
  }

  const loopPush = normalizeLoopPushBoolean(normalized);

  if (loopPush !== null) {
    return normalizeForFingerprintInternal(loopPush, functionDepth);
  }

  const forEach = normalizeForEach(normalized);

  if (forEach !== null) {
    return normalizeForFingerprintInternal(forEach, functionDepth);
  }

  return null;
};

const normalizeNode = (node: Node, functionDepth: number): NormalizedValue => {
  // Memoize: if this exact node reference was already normalized at the same semantic level, reuse.
  // functionDepth only distinguishes 0 vs >0, and at >0 function nodes are returned early in the
  // caller, so caching by node alone is safe for non-function nodes.
  if (!isFunctionNode(node)) {
    const cached = normalizationCache.get(node);

    if (cached !== undefined) {
      return cached;
    }
  }

  if (!isNodeRecord(node)) {
    return node;
  }

  const record = node as AnyNode;
  // First, recursively normalize children.
  const entries = Object.entries(record);
  const out: Record<string, unknown> = {};

  for (const [key, value] of entries) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'span' || key === 'comments') {
      continue;
    }

    out[key] = normalizeForFingerprintInternal(value as NodeValue, functionDepth);
  }

  const normalized = withType(record.type, out) as unknown as AnyNode;
  // Apply local rewrites (post-order).
  const rewritten = applyLocalRewrites(normalized, functionDepth);

  if (rewritten !== null) {
    return rewritten;
  }

  if (!isFunctionNode(node)) {
    normalizationCache.set(node, normalized);
  }

  return normalized;
};

const normalizeArrayItems = (value: ReadonlyArray<Node>, functionDepth: number): NormalizedValue => {
  const items: NodeValue[] = [];

  for (const entry of value) {
    const normalized = normalizeForFingerprintInternal(entry, functionDepth);

    if (Array.isArray(normalized)) {
      items.push(...normalized);
    } else {
      items.push(normalized);
    }
  }

  return items;
};

const normalizeForFingerprintInternal = (value: NodeValue, functionDepth: number): NormalizedValue => {
  if (isOxcNodeArray(value)) {
    return normalizeArrayItems(value, functionDepth);
  }

  if (!isOxcNode(value)) {
    return value;
  }

  if (isFunctionNode(value)) {
    if (functionDepth > 0) {
      return value;
    }

    return normalizeNode(value, functionDepth + 1);
  }

  return normalizeNode(value, functionDepth);
};

export const normalizeForFingerprint = (value: NodeValue): NormalizedValue => {
  normalizationCache = new WeakMap();

  return normalizeForFingerprintInternal(value, 0);
};
