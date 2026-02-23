import type { Node } from 'oxc-parser';

import type { NodeValue } from '../types';

import { getNodeType, isFunctionNode, isNodeRecord, isOxcNode, isOxcNodeArray, walkOxcTree } from './oxc-ast-utils';

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
  let found = false;

  walkOxcTree(node, value => {
    if (!isOxcNode(value)) {
      return true;
    }

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
  return (
    isOxcNode(node) &&
    node.type === 'Identifier' &&
    typeof (node as unknown as { name?: unknown }).name === 'string' &&
    (node as unknown as { name: string }).name === name
  );
};

const isMemberNamed = (callee: NodeValue, name: string): { object: Node; computed: boolean } | null => {
  if (!isOxcNode(callee) || callee.type !== 'MemberExpression' || !isNodeRecord(callee)) {
    return null;
  }

  const computed = Boolean((callee as unknown as { computed?: unknown }).computed);
  const property = (callee as unknown as { property?: unknown }).property;

  if (computed) {
    return null;
  }

  if (!isIdentifierNamed(property as NodeValue, name)) {
    return null;
  }

  const object = (callee as unknown as { object?: unknown }).object;

  if (!isOxcNode(object as NodeValue)) {
    return null;
  }

  return { object: object as Node, computed };
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

const appendToBlockBody = (bodyNode: Node, statement: Node): Node => {
  if (!isNodeRecord(bodyNode) || bodyNode.type !== 'BlockStatement') {
    return block([bodyNode, statement]);
  }

  const body = Array.isArray((bodyNode as unknown as { body?: unknown }).body)
    ? ((bodyNode as unknown as { body: Node[] }).body as Node[])
    : [];

  return block([...body, statement]);
};

const normalizeTemplateLiteralToConcat = (node: AnyNode): NodeValue => {
  const quasis = Array.isArray(node.quasis) ? (node.quasis as unknown as AnyNode[]) : [];
  const expressions = Array.isArray(node.expressions) ? (node.expressions as unknown as Node[]) : [];
  const parts: Node[] = [];

  for (let index = 0; index < quasis.length; index += 1) {
    const quasi = quasis[index];
    const value = quasi?.value as unknown as { raw?: unknown; cooked?: unknown } | undefined;
    const cooked = typeof value?.cooked === 'string' ? value.cooked : typeof value?.raw === 'string' ? value.raw : '';

    if (cooked.length > 0) {
      parts.push(literal(cooked));
    }

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

  const expression = node.expression as unknown;

  if (!isOxcNode(expression as NodeValue) || !isNodeRecord(expression as Node)) {
    return null;
  }

  if ((expression as Node).type !== 'MemberExpression') {
    return null;
  }

  const optional = Boolean((expression as unknown as { optional?: unknown }).optional);

  if (!optional) {
    return null;
  }

  const object = (expression as unknown as { object?: unknown }).object;
  const property = (expression as unknown as { property?: unknown }).property;
  const computed = Boolean((expression as unknown as { computed?: unknown }).computed);

  if (!isOxcNode(object as NodeValue) || !isOxcNode(property as NodeValue)) {
    return null;
  }

  const test = binary('!=', object as Node, literal(null));
  const consequent = memberExpression(object as Node, property as Node, computed);
  const alternate = identifier('undefined');

  return conditional(test, consequent, alternate);
};

const normalizeDeMorgan = (node: AnyNode): NodeValue | null => {
  if (node.type !== 'UnaryExpression') {
    return null;
  }

  const operator = typeof node.operator === 'string' ? node.operator : '';

  if (operator !== '!') {
    return null;
  }

  let argument = node.argument as unknown;

  if (!isOxcNode(argument as NodeValue) || !isNodeRecord(argument as Node)) {
    return null;
  }

  if ((argument as Node).type === 'ParenthesizedExpression') {
    const expression = (argument as unknown as { expression?: unknown }).expression;

    if (!isOxcNode(expression as NodeValue) || !isNodeRecord(expression as Node)) {
      return null;
    }

    argument = expression;
  }

  if ((argument as Node).type !== 'LogicalExpression') {
    return null;
  }

  const innerOperator =
    typeof (argument as unknown as { operator?: unknown }).operator === 'string'
      ? (argument as unknown as { operator: string }).operator
      : '';

  if (innerOperator !== '&&' && innerOperator !== '||') {
    return null;
  }

  const left = (argument as unknown as { left?: unknown }).left;
  const right = (argument as unknown as { right?: unknown }).right;

  if (!isOxcNode(left as NodeValue) || !isOxcNode(right as NodeValue)) {
    return null;
  }

  const newOp = innerOperator === '&&' ? '||' : '&&';

  return logical(newOp, unary('!', left as Node), unary('!', right as Node));
};

const normalizeTernaryInversion = (node: AnyNode): NodeValue | null => {
  if (node.type !== 'ConditionalExpression') {
    return null;
  }

  const test = node.test as unknown;

  if (!isOxcNode(test as NodeValue) || !isNodeRecord(test as Node)) {
    return null;
  }

  if ((test as Node).type !== 'UnaryExpression') {
    return null;
  }

  const operator =
    typeof (test as unknown as { operator?: unknown }).operator === 'string'
      ? (test as unknown as { operator: string }).operator
      : '';

  if (operator !== '!') {
    return null;
  }

  const argument = (test as unknown as { argument?: unknown }).argument;

  if (!isOxcNode(argument as NodeValue)) {
    return null;
  }

  const consequent = node.consequent as unknown;
  const alternate = node.alternate as unknown;

  if (!isOxcNode(consequent as NodeValue) || !isOxcNode(alternate as NodeValue)) {
    return null;
  }

  return conditional(argument as Node, alternate as Node, consequent as Node);
};

const normalizeIfElseToTernary = (node: AnyNode): NodeValue | null => {
  if (node.type !== 'IfStatement') {
    return null;
  }

  const test = node.test as unknown;
  const consequent = node.consequent as unknown;
  const alternate = node.alternate as unknown;

  if (!isOxcNode(test as NodeValue) || !isOxcNode(consequent as NodeValue) || !isOxcNode(alternate as NodeValue)) {
    return null;
  }

  const consequentNode = consequent as Node;
  const alternateNode = alternate as Node;

  const unwrapSingle = (stmt: Node): Node | null => {
    if (!isNodeRecord(stmt)) {
      return null;
    }

    if (stmt.type === 'BlockStatement') {
      const body = Array.isArray((stmt as unknown as { body?: unknown }).body)
        ? ((stmt as unknown as { body: Node[] }).body as Node[])
        : [];

      if (body.length !== 1 || !isOxcNode(body[0])) {
        return null;
      }

      return body[0] as Node;
    }

    return stmt;
  };

  const c = unwrapSingle(consequentNode);
  const a = unwrapSingle(alternateNode);

  if (c == null || a == null) {
    return null;
  }

  // Only normalize `return A` / `return B`.
  if (c.type === 'ReturnStatement' && a.type === 'ReturnStatement' && isNodeRecord(c) && isNodeRecord(a)) {
    const cArg = (c as unknown as { argument?: unknown }).argument;
    const aArg = (a as unknown as { argument?: unknown }).argument;

    if (!isOxcNode(cArg as NodeValue) || !isOxcNode(aArg as NodeValue)) {
      return null;
    }

    return returnStatement(conditional(test as Node, cArg as Node, aArg as Node));
  }

  // Only normalize `x = A` / `x = B`.
  if (c.type === 'ExpressionStatement' && a.type === 'ExpressionStatement' && isNodeRecord(c) && isNodeRecord(a)) {
    const cExpr = (c as unknown as { expression?: unknown }).expression;
    const aExpr = (a as unknown as { expression?: unknown }).expression;

    if (!isOxcNode(cExpr as NodeValue) || !isOxcNode(aExpr as NodeValue)) {
      return null;
    }

    // Prefer canonical `x = c ? a : b` when both sides are simple assignments to the same identifier.
    if (
      isNodeRecord(cExpr as Node) &&
      isNodeRecord(aExpr as Node) &&
      (cExpr as Node).type === 'AssignmentExpression' &&
      (aExpr as Node).type === 'AssignmentExpression'
    ) {
      const opC =
        typeof (cExpr as unknown as { operator?: unknown }).operator === 'string'
          ? (cExpr as unknown as { operator: string }).operator
          : '';
      const opA =
        typeof (aExpr as unknown as { operator?: unknown }).operator === 'string'
          ? (aExpr as unknown as { operator: string }).operator
          : '';

      if (opC === '=' && opA === '=') {
        const leftC = (cExpr as unknown as { left?: unknown }).left;
        const leftA = (aExpr as unknown as { left?: unknown }).left;
        const rightC = (cExpr as unknown as { right?: unknown }).right;
        const rightA = (aExpr as unknown as { right?: unknown }).right;

        if (
          isOxcNode(leftC as NodeValue) &&
          isOxcNode(leftA as NodeValue) &&
          isOxcNode(rightC as NodeValue) &&
          isOxcNode(rightA as NodeValue)
        ) {
          if ((leftC as Node).type === 'Identifier' && (leftA as Node).type === 'Identifier') {
            const nameC = (leftC as unknown as { name?: unknown }).name;
            const nameA = (leftA as unknown as { name?: unknown }).name;

            if (typeof nameC === 'string' && typeof nameA === 'string' && nameC === nameA) {
              const assignment = withType('AssignmentExpression', {
                operator: '=',
                left: leftC as Node,
                right: conditional(test as Node, rightC as Node, rightA as Node),
              }) as unknown as Node;

              return expressionStatement(assignment);
            }
          }
        }
      }
    }

    // General case: `if (c) { expr1 } else { expr2 }` -> `c ? expr1 : expr2`.
    return expressionStatement(conditional(test as Node, cExpr as Node, aExpr as Node));
  }

  return null;
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
  let whileBody: Node = originalBody;

  if (updateNode !== null) {
    whileBody = appendToBlockBody(toBlock(originalBody) ?? originalBody, expressionStatement(updateNode));
  }

  const whileNode = whileStatement(testNode, whileBody);

  if (initNode === null) {
    return [whileNode];
  }

  // If init is an expression, wrap as an ExpressionStatement.
  if (getNodeType(initNode) !== 'VariableDeclaration') {
    return [expressionStatement(initNode), whileNode];
  }

  return [initNode, whileNode];
};

const normalizeForEach = (node: AnyNode): NodeValue | null => {
  if (node.type !== 'ExpressionStatement' || !isNodeRecord(node)) {
    return null;
  }

  const expression = (node as unknown as { expression?: unknown }).expression;

  if (
    !isOxcNode(expression as NodeValue) ||
    !isNodeRecord(expression as Node) ||
    (expression as Node).type !== 'CallExpression'
  ) {
    return null;
  }

  const call = expression as AnyNode;
  const callee = (call as unknown as { callee?: unknown }).callee;
  const args = Array.isArray((call as unknown as { arguments?: unknown }).arguments)
    ? ((call as unknown as { arguments: Node[] }).arguments as Node[])
    : [];
  const member = isMemberNamed(callee as NodeValue, 'forEach');

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

  const asyncFlag = Boolean((callback as unknown as { async?: unknown }).async);

  if (asyncFlag) {
    return null;
  }

  const params = Array.isArray((callback as unknown as { params?: unknown }).params)
    ? ((callback as unknown as { params: Node[] }).params as Node[])
    : [];

  if (params.length !== 1 || params[0]?.type !== 'Identifier') {
    return null;
  }

  const bodyNode = (callback as unknown as { body?: unknown }).body;

  if (!isOxcNode(bodyNode as NodeValue)) {
    return null;
  }

  if (hasReturnStatement(bodyNode as NodeValue)) {
    return null;
  }

  const loopVar = params[0] as Node;
  const left = variableDeclaration('const', [variableDeclarator(loopVar)]);
  const bodyBlock = toBlock(bodyNode as NodeValue) ?? block([expressionStatement(bodyNode as Node)]);

  return forOfStatement(left, member.object, bodyBlock);
};

const normalizeMapFilterBoolean = (node: AnyNode): NodeValue | null => {
  if (node.type !== 'CallExpression' || !isNodeRecord(node)) {
    return null;
  }

  const callee = (node as unknown as { callee?: unknown }).callee;
  const args = Array.isArray((node as unknown as { arguments?: unknown }).arguments)
    ? ((node as unknown as { arguments: Node[] }).arguments as Node[])
    : [];
  const filterMember = isMemberNamed(callee as NodeValue, 'filter');

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

  const mapCallee = (mapCall as unknown as { callee?: unknown }).callee;
  const mapArgs = Array.isArray((mapCall as unknown as { arguments?: unknown }).arguments)
    ? ((mapCall as unknown as { arguments: Node[] }).arguments as Node[])
    : [];
  const mapMember = isMemberNamed(mapCallee as NodeValue, 'map');

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

  const params = Array.isArray((callback as unknown as { params?: unknown }).params)
    ? ((callback as unknown as { params: Node[] }).params as Node[])
    : [];

  if (params.length !== 1 || params[0]?.type !== 'Identifier') {
    return null;
  }

  const bodyNode = (callback as unknown as { body?: unknown }).body;

  if (!isOxcNode(bodyNode as NodeValue)) {
    return null;
  }

  // Use a synthetic normalized node shape so we can also normalize equivalent loop patterns.
  return withType('NormalizedMapFilterBoolean', {
    source: mapMember.object,
    mapBody: bodyNode,
  });
};

const normalizeLoopPushBoolean = (node: AnyNode): NodeValue | null => {
  // Recognize: for (const x of items) { const mapped = <expr>; if (mapped) out.push(mapped); }
  if (node.type !== 'ForOfStatement' || !isNodeRecord(node)) {
    return null;
  }

  const right = (node as unknown as { right?: unknown }).right;
  const bodyValue = (node as unknown as { body?: unknown }).body;

  if (!isOxcNode(right as NodeValue) || !isOxcNode(bodyValue as NodeValue) || !isNodeRecord(bodyValue as Node)) {
    return null;
  }

  if ((bodyValue as Node).type !== 'BlockStatement') {
    return null;
  }

  const body = Array.isArray((bodyValue as unknown as { body?: unknown }).body)
    ? ((bodyValue as unknown as { body: Node[] }).body as Node[])
    : [];

  if (body.length !== 2) {
    return null;
  }

  const decl = body[0];
  const guard = body[1];

  if (!isOxcNode(decl as NodeValue) || !isNodeRecord(decl as Node) || (decl as Node).type !== 'VariableDeclaration') {
    return null;
  }

  const declarations = Array.isArray((decl as unknown as { declarations?: unknown }).declarations)
    ? ((decl as unknown as { declarations: Node[] }).declarations as Node[])
    : [];

  if (declarations.length !== 1 || !isOxcNode(declarations[0] as NodeValue) || !isNodeRecord(declarations[0] as Node)) {
    return null;
  }

  const declarator = declarations[0] as AnyNode;

  if (declarator.type !== 'VariableDeclarator') {
    return null;
  }

  const id = declarator.id as unknown;
  const init = declarator.init as unknown;

  if (!isOxcNode(id as NodeValue) || (id as Node).type !== 'Identifier' || !isOxcNode(init as NodeValue)) {
    return null;
  }

  if (!isOxcNode(guard as NodeValue) || !isNodeRecord(guard as Node) || (guard as Node).type !== 'IfStatement') {
    return null;
  }

  const test = (guard as unknown as { test?: unknown }).test;
  const consequent = (guard as unknown as { consequent?: unknown }).consequent;
  const alternate = (guard as unknown as { alternate?: unknown }).alternate;

  if (!isOxcNode(test as NodeValue) || alternate != null) {
    return null;
  }

  if (!isOxcNode(consequent as NodeValue)) {
    return null;
  }

  const only = toBlock(consequent as NodeValue);

  if (only === null || !isNodeRecord(only)) {
    return null;
  }

  const consequentBody = Array.isArray((only as unknown as { body?: unknown }).body)
    ? ((only as unknown as { body: Node[] }).body as Node[])
    : [];

  if (consequentBody.length !== 1 || !isOxcNode(consequentBody[0] as NodeValue) || !isNodeRecord(consequentBody[0] as Node)) {
    return null;
  }

  const stmt = consequentBody[0] as AnyNode;

  if (stmt.type !== 'ExpressionStatement') {
    return null;
  }

  const expr = stmt.expression as unknown;

  if (!isOxcNode(expr as NodeValue) || !isNodeRecord(expr as Node) || (expr as Node).type !== 'CallExpression') {
    return null;
  }

  const callArgs = Array.isArray((expr as unknown as { arguments?: unknown }).arguments)
    ? ((expr as unknown as { arguments: Node[] }).arguments as Node[])
    : [];

  if (callArgs.length !== 1 || callArgs[0]?.type !== 'Identifier') {
    return null;
  }

  // Require: if (mapped) out.push(mapped)
  if ((test as Node).type !== 'Identifier') {
    return null;
  }

  const testName = (test as unknown as { name?: unknown }).name;
  const argName = (callArgs[0] as unknown as { name?: unknown }).name;

  if (typeof testName !== 'string' || typeof argName !== 'string' || testName !== argName) {
    return null;
  }

  return expressionStatement(
    withType('NormalizedMapFilterBoolean', {
      source: right,
      mapBody: init,
    }),
  );
};

let normalizationCache = new WeakMap<Node, NormalizedValue>();

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

  if (!isFunctionNode(node)) {
    normalizationCache.set(node, normalized);
  }

  return normalized;
};

const normalizeForFingerprintInternal = (value: NodeValue, functionDepth: number): NormalizedValue => {
  if (isOxcNodeArray(value)) {
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
