import type {
  AssignmentExpression,
  BindingProperty,
  CallExpression,
  CatchClause,
  ConditionalExpression,
  Expression,
  LogicalExpression,
  MemberExpression,
  Node,
  ObjectAssignmentTarget,
  ObjectExpression,
  ObjectPattern,
  PropertyKey,
  UpdateExpression,
  VariableDeclarator,
} from 'oxc-parser';

import { isFunctionNode } from '@zipbul/gildash';

import type { VariableCollectorOptions, VariableUsage } from '../types';

import { evalStaticNullish, evalStaticTruthiness, forEachChildNode, unwrapExpression } from '../ast';

const addPropertyKeyToSet = (key: PropertyKey, keys: Set<string>): void => {
  if (key.type === 'Identifier') {
    keys.add(key.name);

    return;
  }

  if (key.type === 'Literal' && typeof key.value === 'string') {
    keys.add(key.value);
  }
};

const getStaticObjectExpressionKeys = (node: Expression | null | undefined): Set<string> | null => {
  const n = unwrapExpression(node);

  if (n === null || n.type !== 'ObjectExpression') {
    return null;
  }

  const obj: ObjectExpression = n;
  const keys = new Set<string>();

  for (const prop of obj.properties) {
    if (prop.type !== 'Property') {
      continue;
    }

    addPropertyKeyToSet(prop.key, keys);
  }

  return keys;
};

type VisitFn = (
  current: Node,
  allowNestedFunctions: boolean,
  isWriteContext?: boolean,
  writeKind?: VariableUsage['writeKind'],
  suppressDeclarations?: boolean,
) => void;

const visitLogicalExpression = (
  current: LogicalExpression,
  allowNestedFunctions: boolean,
  suppressDeclarations: boolean,
  visit: VisitFn,
): void => {
  const { operator, left, right } = current;

  // Left is always evaluated.
  visit(left, allowNestedFunctions, false, undefined, suppressDeclarations);

  const leftTruthiness = evalStaticTruthiness(left);

  if (operator === '&&') {
    if (leftTruthiness !== false) {
      visit(right, allowNestedFunctions, false, undefined, suppressDeclarations);
    }

    return;
  }

  if (operator === '||') {
    if (leftTruthiness !== true) {
      visit(right, allowNestedFunctions, false, undefined, suppressDeclarations);
    }

    return;
  }

  if (operator === '??') {
    // ?? short-circuits on nullish (null/undefined), not on falsy.
    const leftNullish = evalStaticNullish(left);

    if (leftNullish === false) {
      // Left is statically non-nullish → right is never evaluated.
      return;
    }

    visit(right, allowNestedFunctions, false, undefined, suppressDeclarations);
  }
};

const visitConditionalExpression = (
  current: ConditionalExpression,
  allowNestedFunctions: boolean,
  suppressDeclarations: boolean,
  visit: VisitFn,
): void => {
  const { test, consequent, alternate } = current;

  visit(test, allowNestedFunctions, false, undefined, suppressDeclarations);

  const truthiness = evalStaticTruthiness(test);

  if (truthiness === true) {
    visit(consequent, allowNestedFunctions, false, undefined, suppressDeclarations);

    return;
  }

  if (truthiness === false) {
    visit(alternate, allowNestedFunctions, false, undefined, suppressDeclarations);

    return;
  }

  visit(consequent, allowNestedFunctions, false, undefined, suppressDeclarations);
  visit(alternate, allowNestedFunctions, false, undefined, suppressDeclarations);
};

const visitAssignmentExpression = (
  current: AssignmentExpression,
  allowNestedFunctions: boolean,
  suppressDeclarations: boolean,
  visit: VisitFn,
): void => {
  const { operator, left, right } = current;

  if (operator === '=') {
    visit(left, allowNestedFunctions, true, 'assignment', suppressDeclarations);
    visit(right, allowNestedFunctions, false, undefined, suppressDeclarations);

    return;
  }

  if (operator === '||=' || operator === '&&=' || operator === '??=') {
    visit(left, allowNestedFunctions, false, undefined, suppressDeclarations);
    visit(left, allowNestedFunctions, true, 'logical-assignment', suppressDeclarations);
    visit(right, allowNestedFunctions, false, undefined, suppressDeclarations);

    return;
  }

  // Compound assignment (+=, -=, ...)
  visit(left, allowNestedFunctions, false, undefined, suppressDeclarations);
  visit(left, allowNestedFunctions, true, 'compound-assignment', suppressDeclarations);
  visit(right, allowNestedFunctions, false, undefined, suppressDeclarations);
};

// `type: 'ObjectPattern'` is shared by BindingPattern's ObjectPattern (declarations)
// and AssignmentTarget's ObjectAssignmentTarget (destructuring assignments).
// Both expose `properties` and the same Property/RestElement discriminators with
// compatible runtime semantics for use-tracking.
const visitObjectPatternProperties = (
  pattern: ObjectPattern | ObjectAssignmentTarget,
  allowNestedFunctions: boolean,
  isWriteContext: boolean,
  writeKind: VariableUsage['writeKind'] | undefined,
  suppressDeclarations: boolean,
  visit: VisitFn,
): void => {
  for (const prop of pattern.properties) {
    if (prop.type === 'RestElement') {
      visit(prop.argument, allowNestedFunctions, isWriteContext, writeKind, suppressDeclarations);

      continue;
    }

    const valueNode = prop.value;

    if (valueNode.type !== 'AssignmentPattern') {
      visit(valueNode, allowNestedFunctions, isWriteContext, writeKind, suppressDeclarations);

      continue;
    }

    visit(valueNode.left, allowNestedFunctions, isWriteContext, writeKind, suppressDeclarations);
    visit(valueNode.right, allowNestedFunctions, false, undefined, suppressDeclarations);
  }
};

const visitArrayPatternElements = (
  elements: ReadonlyArray<Node | null>,
  allowNestedFunctions: boolean,
  isWriteContext: boolean,
  writeKind: VariableUsage['writeKind'] | undefined,
  suppressDeclarations: boolean,
  visit: VisitFn,
): void => {
  for (const element of elements) {
    if (element === null) {
      continue;
    }

    if (element.type === 'RestElement') {
      visit(element.argument, allowNestedFunctions, isWriteContext, writeKind, suppressDeclarations);

      continue;
    }

    if (element.type !== 'AssignmentPattern') {
      visit(element, allowNestedFunctions, isWriteContext, writeKind, suppressDeclarations);

      continue;
    }

    visit(element.left, allowNestedFunctions, isWriteContext, writeKind, suppressDeclarations);
    visit(element.right, allowNestedFunctions, false, undefined, suppressDeclarations);
  }
};

export const collectVariables = (node: Node, options: VariableCollectorOptions = {}): VariableUsage[] => {
  const usages: VariableUsage[] = [];
  // Forward declaration for mutual recursion between visit and visitObjectDestructuringProps.
  let visitObjectDestructuringProps: (
    id: ObjectPattern,
    initKeys: Set<string>,
    allowNestedFunctions: boolean,
    suppressDeclarations: boolean,
  ) => void;

  const pushIdentifierUsage = (
    current: Node,
    name: string,
    isWriteContext: boolean,
    writeKind: VariableUsage['writeKind'] | undefined,
  ): void => {
    const usage: VariableUsage = {
      name,
      isRead: !isWriteContext,
      isWrite: isWriteContext,
      location: current.start,
    };

    if (isWriteContext && writeKind) {
      usage.writeKind = writeKind;
    }

    usages.push(usage);
  };

  // visit is declared with let so helper closures declared below can reference it.
  // eslint-disable-next-line prefer-const
  let visit: (
    current: Node,
    allowNestedFunctions: boolean,
    isWriteContext?: boolean,
    writeKind?: VariableUsage['writeKind'],
    suppressDeclarations?: boolean,
  ) => void;

  const visitIdentifier = (
    current: Node & { type: 'Identifier'; name: string },
    isWriteContext: boolean,
    writeKind: VariableUsage['writeKind'] | undefined,
    suppressDeclarations: boolean,
  ): void => {
    // When suppressDeclarations is active (e.g. visiting inside an IIFE body),
    // skip declaration writes — they belong to the nested scope, not the outer scope.
    if (suppressDeclarations && isWriteContext && writeKind === 'declaration') {
      return;
    }

    pushIdentifierUsage(current, current.name, isWriteContext, writeKind);
  };

  const isLiteralNullishBase = (node: Expression): boolean => {
    if (node.type === 'Literal') {
      return node.value === null;
    }

    if (node.type === 'Identifier' && node.name === 'undefined') {
      return true;
    }

    return false;
  };

  const visitMemberExpression = (
    current: MemberExpression,
    allowNestedFunctions: boolean,
    suppressDeclarations: boolean,
  ): void => {
    const { object } = current;

    // Optional access on a literal `null` / `undefined` base short-circuits at runtime,
    // so the computed property is never actually read.
    if (current.optional === true && isLiteralNullishBase(object)) {
      return;
    }

    // `obj.prop` does not read `prop` as a variable; only `obj`.
    // `obj[prop]` reads both `obj` and `prop`.
    visit(object, allowNestedFunctions, false, undefined, suppressDeclarations);

    if (current.computed === true) {
      visit(current.property, allowNestedFunctions, false, undefined, suppressDeclarations);
    }
  };

  const visitUpdateExpression = (
    current: UpdateExpression,
    allowNestedFunctions: boolean,
    suppressDeclarations: boolean,
  ): void => {
    const { argument } = current;

    // Treat update as both read and write.
    visit(argument, allowNestedFunctions, false, undefined, suppressDeclarations);
    visit(argument, allowNestedFunctions, true, 'update', suppressDeclarations);
  };

  const visitVariableDeclarator = (
    current: VariableDeclarator,
    allowNestedFunctions: boolean,
    suppressDeclarations: boolean,
  ): void => {
    const { id, init } = current;
    const initKeys = getStaticObjectExpressionKeys(init);

    if (id.type === 'ObjectPattern' && initKeys !== null) {
      visitObjectDestructuringProps(id, initKeys, allowNestedFunctions, suppressDeclarations);
    } else {
      visit(id, allowNestedFunctions, true, 'declaration', suppressDeclarations); // Def
    }

    if (init !== null) {
      visit(init, allowNestedFunctions, false, undefined, suppressDeclarations);
    }
  };

  const visitCatchClause = (current: CatchClause, allowNestedFunctions: boolean, suppressDeclarations: boolean): void => {
    const { param, body } = current;

    if (param !== null) {
      visit(param, allowNestedFunctions, true, 'declaration', suppressDeclarations);
    }

    visit(body, allowNestedFunctions, false, undefined, suppressDeclarations);
  };

  const visitCallExpression = (current: CallExpression, allowNestedFunctions: boolean, suppressDeclarations: boolean): void => {
    const { callee, arguments: args } = current;
    const unwrappedCallee = unwrapExpression(callee);

    if (unwrappedCallee !== null && isFunctionNode(unwrappedCallee)) {
      // IIFE: enter the function body with allowNestedFunctions=true so we can collect
      // outer-variable captures (reads). However, suppress declaration writes because
      // those variables belong to the IIFE's own scope, not the enclosing function scope.
      visit(unwrappedCallee, true, false, undefined, true);
    } else {
      visit(callee, allowNestedFunctions, false, undefined, suppressDeclarations);
    }

    for (const arg of args) {
      visit(arg, allowNestedFunctions, false, undefined, suppressDeclarations);
    }
  };

  visit = (
    current: Node,
    allowNestedFunctions: boolean,
    isWriteContext: boolean = false,
    writeKind?: VariableUsage['writeKind'],
    suppressDeclarations: boolean = false,
  ) => {
    if (!allowNestedFunctions && isFunctionNode(current)) {
      return;
    }

    if (current.type === 'Identifier') {
      visitIdentifier(current, isWriteContext, writeKind, suppressDeclarations);

      return;
    }

    if (current.type === 'ChainExpression') {
      visit(current.expression, allowNestedFunctions, false, undefined, suppressDeclarations);

      return;
    }

    if (current.type === 'MemberExpression') {
      visitMemberExpression(current, allowNestedFunctions, suppressDeclarations);

      return;
    }

    if (current.type === 'LogicalExpression') {
      visitLogicalExpression(current, allowNestedFunctions, suppressDeclarations, visit);

      return;
    }

    if (current.type === 'ConditionalExpression') {
      visitConditionalExpression(current, allowNestedFunctions, suppressDeclarations, visit);

      return;
    }

    if (current.type === 'AssignmentExpression') {
      visitAssignmentExpression(current, allowNestedFunctions, suppressDeclarations, visit);

      return;
    }

    if (current.type === 'UpdateExpression') {
      visitUpdateExpression(current, allowNestedFunctions, suppressDeclarations);

      return;
    }

    if (current.type === 'VariableDeclarator') {
      visitVariableDeclarator(current, allowNestedFunctions, suppressDeclarations);

      return;
    }

    if (current.type === 'CatchClause') {
      visitCatchClause(current, allowNestedFunctions, suppressDeclarations);

      return;
    }

    if (current.type === 'ObjectPattern') {
      visitObjectPatternProperties(current, allowNestedFunctions, isWriteContext, writeKind, suppressDeclarations, visit);

      return;
    }

    if (current.type === 'ArrayPattern') {
      visitArrayPatternElements(current.elements, allowNestedFunctions, isWriteContext, writeKind, suppressDeclarations, visit);

      return;
    }

    if (current.type === 'CallExpression') {
      visitCallExpression(current, allowNestedFunctions, suppressDeclarations);

      return;
    }

    forEachChildNode(current, child => visit(child, allowNestedFunctions, false, undefined, suppressDeclarations));
  };

  const visitDestructuringProperty = (
    prop: BindingProperty,
    initKeys: Set<string>,
    allowNestedFunctions: boolean,
    suppressDeclarations: boolean,
  ): void => {
    const { key, value } = prop;
    let keyName: string | null = null;

    if (key.type === 'Identifier') {
      keyName = key.name;
    } else if (key.type === 'Literal' && typeof key.value === 'string') {
      keyName = key.value;
    }

    if (value.type !== 'AssignmentPattern') {
      visit(value, allowNestedFunctions, true, 'declaration', suppressDeclarations);

      return;
    }

    visit(value.left, allowNestedFunctions, true, 'declaration', suppressDeclarations);

    const shouldEvaluateDefault = keyName === null || !initKeys.has(keyName);

    if (shouldEvaluateDefault) {
      visit(value.right, allowNestedFunctions, false, undefined, suppressDeclarations);
    }
  };

  visitObjectDestructuringProps = (
    id: ObjectPattern,
    initKeys: Set<string>,
    allowNestedFunctions: boolean,
    suppressDeclarations: boolean,
  ): void => {
    // Object destructuring defaults are only evaluated if the property is missing.
    for (const prop of id.properties) {
      if (prop.type === 'RestElement') {
        visit(prop.argument, allowNestedFunctions, true, 'declaration', suppressDeclarations);

        continue;
      }

      visitDestructuringProperty(prop, initKeys, allowNestedFunctions, suppressDeclarations);
    }
  };

  visit(node, options.includeNestedFunctions !== false, false);

  return usages.sort((left, right) => left.location - right.location);
};
