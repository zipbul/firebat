import { is } from '@zipbul/gildash';
import type { Node } from 'oxc-parser';

import { isFunctionNode } from '@zipbul/gildash';

import type { VariableCollectorOptions, VariableUsage } from '../types';

import {
  evalStaticNullish,
  evalStaticTruthiness,
  forEachChildNode,
  getLiteralString,
  getNodeName,
  unwrapExpression,
} from '../ast';

const getNodeStart = (node: Node): number => node.start;

const addPropertyKeyToSet = (key: Node, keys: Set<string>): void => {
  if (is.Identifier(key)) {
    const name = getNodeName(key);

    if (name !== null) {
      keys.add(name);
    }

    return;
  }

  if (is.Literal(key)) {
    const value = getLiteralString(key);

    if (value !== null) {
      keys.add(value);
    }
  }
};

const getStaticObjectExpressionKeys = (node: Node | null | undefined): Set<string> | null => {
  const n = unwrapExpression(node);

  if (n?.type !== 'ObjectExpression') {
    return null;
  }

  const keys = new Set<string>();
  const properties = (n.properties ?? []) as ReadonlyArray<Node>;

  for (const prop of properties) {
    if (!is.Property(prop)) {
      continue;
    }

    addPropertyKeyToSet(prop.key as Node, keys);
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
  current: Node,
  allowNestedFunctions: boolean,
  suppressDeclarations: boolean,
  visit: VisitFn,
): void => {
  const r = current as unknown as Record<string, unknown>;
  const operator = typeof r.operator === 'string' ? r.operator : '';
  const left = r.left as Node;
  const right = r.right as Node;

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

    // leftNullish === true or unknown: right may be evaluated.
    visit(right, allowNestedFunctions, false, undefined, suppressDeclarations);

    return;
  }

  // For unknown operators, be conservative.
  visit(right, allowNestedFunctions, false, undefined, suppressDeclarations);
};

const visitConditionalExpression = (
  current: Node,
  allowNestedFunctions: boolean,
  suppressDeclarations: boolean,
  visit: VisitFn,
): void => {
  const r = current as unknown as Record<string, unknown>;
  const test = r.test as Node;
  const consequent = r.consequent as Node;
  const alternate = r.alternate as Node;

  // Test is always evaluated.
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

  // Unknown: either branch may execute.
  visit(consequent, allowNestedFunctions, false, undefined, suppressDeclarations);
  visit(alternate, allowNestedFunctions, false, undefined, suppressDeclarations);
};

const visitAssignmentExpression = (
  current: Node,
  allowNestedFunctions: boolean,
  suppressDeclarations: boolean,
  visit: VisitFn,
): void => {
  const r = current as unknown as Record<string, unknown>;
  const operator = typeof r.operator === 'string' ? r.operator : '=';
  const left = r.left as Node;
  const right = r.right as Node;

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

const visitObjectPatternProperties = (
  properties: ReadonlyArray<Node>,
  allowNestedFunctions: boolean,
  isWriteContext: boolean,
  writeKind: VariableUsage['writeKind'] | undefined,
  suppressDeclarations: boolean,
  visit: VisitFn,
): void => {
  for (const prop of properties) {
    if (is.RestElement(prop)) {
      visit(prop.argument as Node, allowNestedFunctions, isWriteContext, writeKind, suppressDeclarations);

      continue;
    }

    if (!is.Property(prop)) {
      continue;
    }

    const valueNode = prop.value as Node;

    if (!is.AssignmentPattern(valueNode)) {
      visit(valueNode, allowNestedFunctions, isWriteContext, writeKind, suppressDeclarations);

      continue;
    }

    visit(valueNode.left as Node, allowNestedFunctions, isWriteContext, writeKind, suppressDeclarations);
    visit(valueNode.right as Node, allowNestedFunctions, false, undefined, suppressDeclarations);
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

    if (is.RestElement(element)) {
      visit(element.argument as Node, allowNestedFunctions, isWriteContext, writeKind, suppressDeclarations);

      continue;
    }

    if (!is.AssignmentPattern(element)) {
      visit(element, allowNestedFunctions, isWriteContext, writeKind, suppressDeclarations);

      continue;
    }

    visit(element.left as Node, allowNestedFunctions, isWriteContext, writeKind, suppressDeclarations);
    visit(element.right as Node, allowNestedFunctions, false, undefined, suppressDeclarations);
  }
};

export const collectVariables = (node: Node, options: VariableCollectorOptions = {}): VariableUsage[] => {
  const usages: VariableUsage[] = [];
  // Forward declaration for mutual recursion between visit and visitObjectDestructuringProps.
  let visitObjectDestructuringProps: (
    id: Node,
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
      location: getNodeStart(current),
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
    current: Node,
    isWriteContext: boolean,
    writeKind: VariableUsage['writeKind'] | undefined,
    suppressDeclarations: boolean,
  ): void => {
    const name = getNodeName(current);

    if (name === null) {
      return;
    }

    // When suppressDeclarations is active (e.g. visiting inside an IIFE body),
    // skip declaration writes — they belong to the nested scope, not the outer scope.
    if (suppressDeclarations && isWriteContext && writeKind === 'declaration') {
      return;
    }

    pushIdentifierUsage(current, name, isWriteContext, writeKind);
  };

  const visitMemberExpression = (current: Node, allowNestedFunctions: boolean, suppressDeclarations: boolean): void => {
    const r = current as unknown as Record<string, unknown>;
    const object = r.object as Node;

    // Optional access on a literal `null` / `undefined` base short-circuits at runtime,
    // so the computed property is never actually read. Skip the property visit so the
    // inner identifier isn't spuriously treated as a use.
    if (r.optional === true && isLiteralNullishBase(object)) {
      return;
    }

    // `obj.prop` does not read `prop` as a variable; only `obj`.
    // `obj[prop]` reads both `obj` and `prop`.
    visit(object, allowNestedFunctions, false, undefined, suppressDeclarations);

    if (r.computed) {
      visit(r.property as Node, allowNestedFunctions, false, undefined, suppressDeclarations);
    }
  };

  const isLiteralNullishBase = (node: Node): boolean => {
    if (is.Literal(node)) {
      const value = (node as unknown as Record<string, unknown>).value;

      return value === null;
    }

    if (is.Identifier(node) && (node as unknown as { name?: string }).name === 'undefined') {
      return true;
    }

    return false;
  };

  const visitUpdateExpression = (current: Node, allowNestedFunctions: boolean, suppressDeclarations: boolean): void => {
    const argument = (current as unknown as Record<string, unknown>).argument as Node;

    // Treat update as both read and write.
    visit(argument, allowNestedFunctions, false, undefined, suppressDeclarations);
    visit(argument, allowNestedFunctions, true, 'update', suppressDeclarations);
  };

  const visitVariableDeclarator = (current: Node, allowNestedFunctions: boolean, suppressDeclarations: boolean): void => {
    const r = current as unknown as Record<string, unknown>;
    const init = r.init as Node | null | undefined;
    const id = r.id as Node;
    const initKeys = getStaticObjectExpressionKeys(init);

    if (is.ObjectPattern(id) && initKeys !== null) {
      visitObjectDestructuringProps(id, initKeys, allowNestedFunctions, suppressDeclarations);
    } else {
      visit(id, allowNestedFunctions, true, 'declaration', suppressDeclarations); // Def
    }

    if (init !== undefined && init !== null) {
      visit(init, allowNestedFunctions, false, undefined, suppressDeclarations);
    } // Use
  };

  const visitCatchClause = (current: Node, allowNestedFunctions: boolean, suppressDeclarations: boolean): void => {
    const r = current as unknown as Record<string, unknown>;
    const param = r.param as Node | null | undefined;
    const body = r.body as Node;

    if (param !== undefined && param !== null) {
      visit(param, allowNestedFunctions, true, 'declaration', suppressDeclarations);
    }

    visit(body, allowNestedFunctions, false, undefined, suppressDeclarations);
  };

  const visitCallExpression = (current: Node, allowNestedFunctions: boolean, suppressDeclarations: boolean): void => {
    const r = current as unknown as Record<string, unknown>;
    const callee = r.callee as Node;
    const args = r.arguments as ReadonlyArray<Node>;
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

    // Oxc Node Types
    // Observed in our environment: identifiers are represented as `Identifier`.
    if (is.Identifier(current)) {
      visitIdentifier(current, isWriteContext, writeKind, suppressDeclarations);

      return;
    }

    // IdentifierReference/BindingIdentifier/AssignmentTargetIdentifier are represented as Identifier nodes.

    if (is.ChainExpression(current)) {
      visit(current.expression, allowNestedFunctions, false, undefined, suppressDeclarations);

      return;
    }

    if (is.MemberExpression(current)) {
      visitMemberExpression(current, allowNestedFunctions, suppressDeclarations);

      return;
    }

    // Handle constructions
    if (is.LogicalExpression(current)) {
      visitLogicalExpression(current, allowNestedFunctions, suppressDeclarations, visit);

      return;
    }

    if (is.ConditionalExpression(current)) {
      visitConditionalExpression(current, allowNestedFunctions, suppressDeclarations, visit);

      return;
    }

    if (is.AssignmentExpression(current)) {
      visitAssignmentExpression(current, allowNestedFunctions, suppressDeclarations, visit);

      return;
    }

    if (is.UpdateExpression(current)) {
      visitUpdateExpression(current, allowNestedFunctions, suppressDeclarations);

      return;
    }

    if (is.VariableDeclarator(current)) {
      visitVariableDeclarator(current, allowNestedFunctions, suppressDeclarations);

      return;
    }

    if (is.CatchClause(current)) {
      visitCatchClause(current, allowNestedFunctions, suppressDeclarations);

      return;
    }

    if (is.ObjectPattern(current) || is.ArrayPattern(current)) {
      visitPatternNode(current, allowNestedFunctions, isWriteContext, writeKind, suppressDeclarations);

      return;
    }

    if (is.CallExpression(current)) {
      visitCallExpression(current, allowNestedFunctions, suppressDeclarations);

      return;
    }

    visitChildren(current, allowNestedFunctions, suppressDeclarations);
  };

  const visitChildren = (current: Node, allowNestedFunctions: boolean, suppressDeclarations: boolean): void => {
    forEachChildNode(current, child => visit(child, allowNestedFunctions, false, undefined, suppressDeclarations));
  };

  const visitPatternNode = (
    current: Node,
    allowNestedFunctions: boolean,
    isWriteContext: boolean,
    writeKind: VariableUsage['writeKind'] | undefined,
    suppressDeclarations: boolean,
  ): void => {
    const r = current as unknown as Record<string, unknown>;

    if (is.ObjectPattern(current)) {
      const properties = Array.isArray(r.properties) ? (r.properties as ReadonlyArray<Node>) : [];

      visitObjectPatternProperties(properties, allowNestedFunctions, isWriteContext, writeKind, suppressDeclarations, visit);
    } else {
      const elements = Array.isArray(r.elements) ? (r.elements as ReadonlyArray<Node | null>) : [];

      visitArrayPatternElements(elements, allowNestedFunctions, isWriteContext, writeKind, suppressDeclarations, visit);
    }
  };

  const visitDestructuringProperty = (
    prop: Node,
    initKeys: Set<string>,
    allowNestedFunctions: boolean,
    suppressDeclarations: boolean,
  ): void => {
    const propRecord = prop as unknown as Record<string, unknown>;
    const keyNode = propRecord.key as Node;
    let keyName: string | null = null;
    const keyType = keyNode.type;

    if (keyType === 'Identifier') {
      keyName = getNodeName(keyNode);
    } else if (keyType === 'Literal') {
      const value = getLiteralString(keyNode);

      if (value !== null) {
        keyName = value;
      }
    }

    const valueNode = propRecord.value as Node;

    if (!is.AssignmentPattern(valueNode)) {
      visit(valueNode, allowNestedFunctions, true, 'declaration', suppressDeclarations);

      return;
    }

    const leftNode = valueNode.left as Node;
    const rightNode = valueNode.right as Node;

    visit(leftNode, allowNestedFunctions, true, 'declaration', suppressDeclarations);

    const shouldEvaluateDefault = keyName === null ? true : !initKeys.has(keyName);

    if (shouldEvaluateDefault) {
      visit(rightNode, allowNestedFunctions, false, undefined, suppressDeclarations);
    }
  };

  visitObjectDestructuringProps = (
    id: Node,
    initKeys: Set<string>,
    allowNestedFunctions: boolean,
    suppressDeclarations: boolean,
  ): void => {
    // Object destructuring defaults are only evaluated if the property is missing.
    const idRecord = id as unknown as Record<string, unknown>;
    const properties = Array.isArray(idRecord.properties) ? (idRecord.properties as ReadonlyArray<Node>) : [];

    for (const prop of properties) {
      if (is.RestElement(prop)) {
        visit(prop.argument as Node, allowNestedFunctions, true, 'declaration', suppressDeclarations);

        continue;
      }

      if (!is.Property(prop)) {
        continue;
      }

      visitDestructuringProperty(prop, initKeys, allowNestedFunctions, suppressDeclarations);
    }
  };

  visit(node, options.includeNestedFunctions !== false, false);

  return usages.sort((left, right) => left.location - right.location);
};
