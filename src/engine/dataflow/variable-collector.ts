import type { Node } from 'oxc-parser';

import type { NodeValue, VariableCollectorOptions, VariableUsage } from '../types';

import { getLiteralString, getNodeName, getNodeType, isNodeRecord, isOxcNode, isOxcNodeArray } from '../ast/oxc-ast-utils';
import { evalStaticTruthiness, unwrapExpression } from '../ast/oxc-expression-utils';

const getNodeStart = (node: Node): number => node.start;

const isFunctionNode = (node: NodeValue): boolean => {
  if (!isOxcNode(node)) {
    return false;
  }

  const nodeType = getNodeType(node);

  return nodeType === 'ArrowFunctionExpression' || nodeType === 'FunctionDeclaration' || nodeType === 'FunctionExpression';
};

const getStaticObjectExpressionKeys = (node: NodeValue): Set<string> | null => {
  const n = unwrapExpression(node);

  if (n?.type !== 'ObjectExpression') {
    return null;
  }

  const keys = new Set<string>();
  const properties = (n.properties ?? []) as ReadonlyArray<Node>;

  for (const prop of properties) {
    if (!isOxcNode(prop)) {
      continue;
    }

    if (prop.type !== 'Property') {
      continue;
    }

    const key = prop.key;

    if (isOxcNode(key) && key.type === 'Identifier') {
      const name = getNodeName(key);

      if (name !== null) {
        keys.add(name);
      }

      continue;
    }

    if (isOxcNode(key) && key.type === 'Literal') {
      const value = getLiteralString(key);

      if (value !== null) {
        keys.add(value);
      }

      continue;
    }
  }

  return keys;
};

export const collectVariables = (node: NodeValue, options: VariableCollectorOptions = {}): VariableUsage[] => {
  const usages: VariableUsage[] = [];

  const visit = (
    current: NodeValue,
    allowNestedFunctions: boolean,
    isWriteContext: boolean = false,
    writeKind?: VariableUsage['writeKind'],
  ) => {
    if (isOxcNodeArray(current)) {
      for (const item of current) {
        visit(item, allowNestedFunctions, isWriteContext);
      }

      return;
    }

    if (!isOxcNode(current)) {
      return;
    }

    const nodeType = getNodeType(current);

    if (!allowNestedFunctions && isFunctionNode(current)) {
      return;
    }

    // Oxc Node Types
    // Observed in our environment: identifiers are represented as `Identifier`.
    if (current.type === 'Identifier') {
      const name = getNodeName(current);

      if (name === null) {
        return;
      }

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

      return;
    }

    // IdentifierReference/BindingIdentifier/AssignmentTargetIdentifier are represented as Identifier nodes.

    if (current.type === 'ChainExpression') {
      visit(current.expression, allowNestedFunctions, false);

      return;
    }

    if (current.type === 'MemberExpression') {
      // `obj.prop` does not read `prop` as a variable; only `obj`.
      // `obj[prop]` reads both `obj` and `prop`.
      const objectNode = current.object;

      if (objectNode !== undefined && objectNode !== null) {
        visit(objectNode, allowNestedFunctions, false);
      }

      const isComputed = current.computed;
      const propertyNode = current.property;

      if (isComputed && propertyNode !== undefined && propertyNode !== null) {
        visit(propertyNode, allowNestedFunctions, false);
      }

      return;
    }

    // Handle constructions
    if (current.type === 'LogicalExpression') {
      const operator = typeof current.operator === 'string' ? current.operator : '';
      const left = current.left;
      const right = current.right;

      // Left is always evaluated.
      visit(left, allowNestedFunctions, false);

      const leftTruthiness = evalStaticTruthiness(left);

      if (operator === '&&') {
        if (leftTruthiness === false) {
          return;
        }

        visit(right, allowNestedFunctions, false);

        return;
      }

      if (operator === '||') {
        if (leftTruthiness === true) {
          return;
        }

        visit(right, allowNestedFunctions, false);

        return;
      }

      // For unknown operators or unknown truthiness, be conservative.
      visit(right, allowNestedFunctions, false);

      return;
    }

    if (current.type === 'ConditionalExpression') {
      const test = current.test;
      const consequent = current.consequent;
      const alternate = current.alternate;

      // Test is always evaluated.
      visit(test, allowNestedFunctions, false);

      const truthiness = evalStaticTruthiness(test);

      if (truthiness === true) {
        visit(consequent, allowNestedFunctions, false);

        return;
      }

      if (truthiness === false) {
        visit(alternate, allowNestedFunctions, false);

        return;
      }

      // Unknown: either branch may execute.
      visit(consequent, allowNestedFunctions, false);
      visit(alternate, allowNestedFunctions, false);

      return;
    }

    if (current.type === 'AssignmentExpression') {
      const operator = typeof current.operator === 'string' ? current.operator : '=';
      const left = current.left;
      const right = current.right;

      if (operator === '=') {
        visit(left, allowNestedFunctions, true, 'assignment'); // LHS is write
        visit(right, allowNestedFunctions, false); // RHS is read

        return;
      }

      if (operator === '||=' || operator === '&&=' || operator === '??=') {
        visit(left, allowNestedFunctions, false);
        visit(left, allowNestedFunctions, true, 'logical-assignment');
        visit(right, allowNestedFunctions, false);

        return;
      }

      // Compound assignment (+=, -=, ...)
      visit(left, allowNestedFunctions, false); // reads LHS
      visit(left, allowNestedFunctions, true, 'compound-assignment'); // writes LHS
      visit(right, allowNestedFunctions, false); // RHS is read

      return;
    }

    if (current.type === 'UpdateExpression') {
      const argument = current.argument;

      // Treat update as both read and write.
      visit(argument, allowNestedFunctions, false);
      visit(argument, allowNestedFunctions, true, 'update');

      return;
    }

    if (current.type === 'VariableDeclarator') {
      const init = current.init;
      const id = current.id;
      const initKeys = getStaticObjectExpressionKeys(init);
      const idNode = isOxcNode(id) ? id : null;

      if (idNode?.type === 'ObjectPattern' && initKeys !== null) {
        // Object destructuring defaults are only evaluated if the property is missing.
        const properties = isOxcNodeArray(idNode.properties) ? idNode.properties : [];

        for (const prop of properties) {
          if (!isOxcNode(prop)) {
            continue;
          }

          if (prop.type !== 'Property') {
            continue;
          }

          const keyNode = prop.key;
          let keyName: string | null = null;

          if (isOxcNode(keyNode)) {
            const keyType = keyNode.type;

            if (keyType === 'Identifier') {
              const name = getNodeName(keyNode);

              keyName = name;
            } else if (keyType === 'Literal') {
              const value = getLiteralString(keyNode);

              if (value !== null) {
                keyName = value;
              }
            }
          }

          const valueNode = prop.value;

          if (isOxcNode(valueNode) && valueNode.type === 'AssignmentPattern') {
            const leftNode = valueNode.left;
            const rightNode = valueNode.right;

            visit(leftNode, allowNestedFunctions, true, 'declaration');

            const shouldEvaluateDefault = keyName === null ? true : !initKeys.has(keyName);

            if (shouldEvaluateDefault) {
              visit(rightNode, allowNestedFunctions, false);
            }

            continue;
          }

          visit(valueNode, allowNestedFunctions, true, 'declaration');
        }
      } else {
        visit(id, allowNestedFunctions, true, 'declaration'); // Def
      }

      if (init !== undefined && init !== null) {
        visit(init, allowNestedFunctions, false);
      } // Use

      return;
    }

    if (nodeType === 'CallExpression') {
      if (!isNodeRecord(current)) {
        return;
      }

      const callee = current.callee;
      const args = isOxcNodeArray(current.arguments) ? current.arguments : [];
      const unwrappedCallee = unwrapExpression(callee);

      if (unwrappedCallee !== null && isFunctionNode(unwrappedCallee)) {
        visit(unwrappedCallee, true, false);
      } else {
        visit(callee, allowNestedFunctions, false);
      }

      for (const arg of args) {
        visit(arg, allowNestedFunctions, false);
      }

      return;
    }

    if (!isNodeRecord(current)) {
      return;
    }

    const entries = Object.entries(current);

    for (const [key, value] of entries) {
      if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') {
        continue;
      }

      visit(value, allowNestedFunctions, isWriteContext);
    }
  };

  visit(node, options.includeNestedFunctions !== false, false);

  return usages.sort((left, right) => left.location - right.location);
};
