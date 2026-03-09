import type { Node } from 'oxc-parser';

import type { NodeValue, ParsedFile } from '../../engine/types';
import type { NestingItem, NestingKind } from '../../types';

import {
  getNodeHeader,
  isFunctionNode,
  isNodeRecord,
  isOxcNode,
  isOxcNodeArray,
  visitOxcChildren,
} from '../../engine/ast/oxc-ast-utils';
import { resolveFunctionBody } from '../../engine/cfg/control-flow-utils';
import { collectFunctionItems } from '../../engine/function-items';
import { getFunctionSpan } from '../../engine/function-span';

interface AnalyzeNestingOptions {
  readonly maxCognitiveComplexity: number;
  readonly maxCallbackDepth: number;
  readonly maxPromiseChainDepth: number;
  readonly maxNestingDepth: number;
  readonly minDensityLoc: number;
  readonly maxDensity: number;
}

const DEFAULT_NESTING_OPTIONS: AnalyzeNestingOptions = {
  maxCognitiveComplexity: 15,
  maxCallbackDepth: 3,
  maxPromiseChainDepth: 3,
  maxNestingDepth: 3,
  minDensityLoc: 8,
  maxDensity: 0.5,
};

const createEmptyNesting = (): ReadonlyArray<NestingItem> => [];

/**
 * SonarQube cognitive complexity — increments without depth bonus.
 *
 * Note: SonarSource whitepaper specifies +1 for direct recursive calls,
 * but the SonarJS JS/TS reference implementation (eslint-plugin-sonarjs S3776)
 * does not implement recursion detection due to the prevalence of anonymous
 * functions, closures, and dynamic `this` binding in JavaScript/TypeScript.
 * This implementation follows SonarJS parity. (detekt, gocognit, complexipy
 * implement recursion for their respective languages where named functions dominate.)
 */
const isDecisionPoint = (nodeType: string): boolean => {
  return (
    nodeType === 'IfStatement' ||
    nodeType === 'ForStatement' ||
    nodeType === 'ForInStatement' ||
    nodeType === 'ForOfStatement' ||
    nodeType === 'WhileStatement' ||
    nodeType === 'DoWhileStatement' ||
    nodeType === 'SwitchStatement' ||
    nodeType === 'ConditionalExpression' ||
    nodeType === 'CatchClause'
  );
};

/**
 * Nesting-specific depth function: same as shared shouldIncreaseDepth
 * but excludes TryStatement (SonarQube does not nest-penalize try).
 */
const shouldIncreaseNestingDepth = (nodeType: string): boolean => {
  return (
    nodeType === 'IfStatement' ||
    nodeType === 'ForStatement' ||
    nodeType === 'ForInStatement' ||
    nodeType === 'ForOfStatement' ||
    nodeType === 'WhileStatement' ||
    nodeType === 'DoWhileStatement' ||
    nodeType === 'SwitchStatement' ||
    nodeType === 'ConditionalExpression' ||
    nodeType === 'CatchClause'
  );
};

/**
 * Count cognitive complexity for a LogicalExpression chain.
 *
 * SonarJS S3776 rule (ground truth from `packages/jsts/src/rules/S3776/rule.ts`):
 *   - `||` and `??` are completely FREE (never counted)
 *   - `&&` adds +1 per new sequence (consecutive `&&` counts once)
 *   - No depth bonus is applied to logical operators
 *
 * Examples:
 *   a && b && c       → +1 (one && sequence)
 *   a || b || c       → +0 (|| is free)
 *   a && b || c       → +1 (one && sequence)
 *   a && b || c && d  → +2 (two && sequences separated by ||)
 */
const countLogicalComplexity = (node: NodeValue): number => {
  if (!isOxcNode(node) || !isNodeRecord(node) || node.type !== 'LogicalExpression') {
    return 0;
  }

  // Flatten the LogicalExpression tree into an ordered list of operators.
  const operators: string[] = [];

  const flatten = (expr: NodeValue): void => {
    if (!isOxcNode(expr) || !isNodeRecord(expr) || expr.type !== 'LogicalExpression') {
      return;
    }

    flatten(expr.left as NodeValue);
    operators.push(String(expr.operator ?? ''));
    flatten(expr.right as NodeValue);
  };

  flatten(node);

  // SonarJS: || and ?? are free. && counts +1 per new sequence.
  let cost = 0;
  let previousOp: string | null = null;

  for (const op of operators) {
    if (op === '||' || op === '??') {
      previousOp = op;

      continue;
    }

    // &&: +1 if starting a new sequence (different from previous operator)
    if (previousOp !== op) {
      cost += 1;
    }

    previousOp = op;
  }

  return cost;
};

const isIterationMethod = (name: string): boolean => {
  return (
    name === 'forEach' ||
    name === 'map' ||
    name === 'filter' ||
    name === 'reduce' ||
    name === 'reduceRight' ||
    name === 'find' ||
    name === 'some' ||
    name === 'every'
  );
};

const getMemberObjectIdentifier = (node: NodeValue): string | null => {
  if (!isOxcNode(node) || !isNodeRecord(node) || node.type !== 'MemberExpression') {
    return null;
  }

  const obj = node.object;
  const prop = node.property;

  if (!isOxcNode(obj) || !isNodeRecord(obj) || obj.type !== 'Identifier') {
    return null;
  }

  if (!isOxcNode(prop) || !isNodeRecord(prop) || prop.type !== 'Identifier') {
    return null;
  }

  return obj.name;
};

const getIterationTarget = (node: NodeValue): string | null => {
  if (!isOxcNode(node) || !isNodeRecord(node)) {
    return null;
  }

  if (node.type === 'ForOfStatement' || node.type === 'ForInStatement') {
    const right = node.right;

    if (isOxcNode(right) && isNodeRecord(right) && right.type === 'Identifier') {
      return right.name;
    }

    return null;
  }

  if (node.type === 'ForStatement') {
    const test = node.test;

    if (!isOxcNode(test) || !isNodeRecord(test) || test.type !== 'BinaryExpression') {
      return null;
    }

    const right = test.right;

    if (!isOxcNode(right) || !isNodeRecord(right) || right.type !== 'MemberExpression') {
      return null;
    }

    const objName = getMemberObjectIdentifier(right);
    const prop = right.property;
    const propName = isOxcNode(prop) && isNodeRecord(prop) && prop.type === 'Identifier' ? prop.name : null;

    if (objName && propName === 'length') {
      return objName;
    }

    return null;
  }

  if (node.type === 'CallExpression') {
    const callee = node.callee;

    if (!isOxcNode(callee) || !isNodeRecord(callee) || callee.type !== 'MemberExpression') {
      return null;
    }

    const prop = callee.property;
    const propName = isOxcNode(prop) && isNodeRecord(prop) && prop.type === 'Identifier' ? prop.name : null;

    if (!propName || !isIterationMethod(propName)) {
      return null;
    }

    return getMemberObjectIdentifier(callee);
  }

  return null;
};

/**
 * Test runner functions whose callbacks are structural (not complexity-bearing).
 * Callbacks passed to these functions do not increase callback depth.
 */
const TEST_RUNNER_FUNCTIONS = new Set([
  'describe',
  'it',
  'test',
  'beforeEach',
  'afterEach',
  'beforeAll',
  'afterAll',
]);

const isTestRunnerCall = (callee: NodeValue): boolean => {
  if (!isOxcNode(callee) || !isNodeRecord(callee)) {
    return false;
  }

  if (callee.type === 'Identifier') {
    return TEST_RUNNER_FUNCTIONS.has(String(callee.name ?? ''));
  }

  // Handle `describe.skip(...)`, `it.only(...)`, etc.
  if (callee.type === 'MemberExpression') {
    const obj = callee.object;

    if (isOxcNode(obj) && isNodeRecord(obj) && obj.type === 'Identifier') {
      return TEST_RUNNER_FUNCTIONS.has(String(obj.name ?? ''));
    }
  }

  return false;
};

const measureMaxCallbackDepth = (value: NodeValue, depth: number = 0): number => {
  if (isOxcNodeArray(value)) {
    let max = depth;

    for (const entry of value) {
      const d = measureMaxCallbackDepth(entry, depth);

      if (d > max) {
        max = d;
      }
    }

    return max;
  }

  if (!isOxcNode(value) || !isNodeRecord(value)) {
    return depth;
  }

  // Do not descend into nested function declarations / expressions that are not callback arguments.
  if (isFunctionNode(value) && depth === 0) {
    // Top-level body — scan children normally.
    let max = depth;

    visitOxcChildren(value, entry => {
      const d = measureMaxCallbackDepth(entry, depth);

      if (d > max) {
        max = d;
      }
    });

    return max;
  }

  if (value.type === 'CallExpression') {
    const args = Array.isArray(value.arguments) ? (value.arguments as ReadonlyArray<NodeValue>) : [];
    let max = depth;
    const callee = value.callee;
    const isTestRunner = isTestRunnerCall(callee as NodeValue);

    if (isOxcNode(callee)) {
      const d = measureMaxCallbackDepth(callee as NodeValue, depth);

      if (d > max) {
        max = d;
      }
    }

    for (const arg of args) {
      if (isOxcNode(arg) && isFunctionNode(arg)) {
        // Test runner callbacks (describe/it/test/beforeEach etc.) are structural,
        // not complexity-bearing — do not increase depth.
        const callbackBody = resolveFunctionBody(arg as unknown as Node);

        if (callbackBody !== null && callbackBody !== undefined) {
          const nextDepth = isTestRunner ? depth : depth + 1;
          const d = measureMaxCallbackDepth(callbackBody as NodeValue, nextDepth);

          if (d > max) {
            max = d;
          }
        }
      } else {
        const d = measureMaxCallbackDepth(arg, depth);

        if (d > max) {
          max = d;
        }
      }
    }

    return max;
  }

  // Skip other nested functions (standalone, not callback arguments).
  if (isFunctionNode(value)) {
    return depth;
  }

  let max = depth;

  visitOxcChildren(value, entry => {
    const d = measureMaxCallbackDepth(entry, depth);

    if (d > max) {
      max = d;
    }
  });

  return max;
};

const PROMISE_METHODS = new Set(['then', 'catch', 'finally']);

/**
 * Measure promise chain depth: `.then().catch().finally()` chaining and nested chains inside callbacks.
 * Only counts within the current function scope (does not descend into nested function declarations).
 */
const measurePromiseChainDepth = (value: NodeValue, depth: number = 0): number => {
  if (isOxcNodeArray(value)) {
    let max = depth;

    for (const entry of value) {
      const d = measurePromiseChainDepth(entry, depth);

      if (d > max) {
        max = d;
      }
    }

    return max;
  }

  if (!isOxcNode(value) || !isNodeRecord(value)) {
    return depth;
  }

  // Do not descend into nested function declarations (not callback arguments).
  if (isFunctionNode(value) && depth === 0) {
    let max = depth;

    visitOxcChildren(value, entry => {
      const d = measurePromiseChainDepth(entry, depth);

      if (d > max) {
        max = d;
      }
    });

    return max;
  }

  if (value.type === 'CallExpression') {
    const callee = value.callee;
    let chainDepth = depth;

    // Check if callee is a MemberExpression with then/catch/finally
    if (isOxcNode(callee) && isNodeRecord(callee) && callee.type === 'MemberExpression') {
      const prop = callee.property;

      if (isOxcNode(prop) && isNodeRecord(prop) && prop.type === 'Identifier' && PROMISE_METHODS.has(prop.name)) {
        chainDepth = depth + 1;

        // Recurse into the object (the chained receiver) to count further chain links
        const objDepth = measurePromiseChainDepth(callee.object as NodeValue, chainDepth);

        if (objDepth > chainDepth) {
          chainDepth = objDepth;
        }
      }
    }

    // Scan callback arguments for nested promise chains
    const args = Array.isArray(value.arguments) ? (value.arguments as ReadonlyArray<NodeValue>) : [];
    let max = chainDepth;

    for (const arg of args) {
      if (isOxcNode(arg) && isFunctionNode(arg)) {
        const callbackBody = resolveFunctionBody(arg as unknown as Node);

        if (callbackBody !== null && callbackBody !== undefined) {
          // Nested chains inside callbacks count from the current chain depth
          const d = measurePromiseChainDepth(callbackBody as NodeValue, chainDepth);

          if (d > max) {
            max = d;
          }
        }
      } else {
        const d = measurePromiseChainDepth(arg, depth);

        if (d > max) {
          max = d;
        }
      }
    }

    return max;
  }

  // Skip other nested functions (standalone, not callback arguments).
  if (isFunctionNode(value)) {
    return depth;
  }

  let max = depth;

  visitOxcChildren(value, entry => {
    const d = measurePromiseChainDepth(entry, depth);

    if (d > max) {
      max = d;
    }
  });

  return max;
};

const analyzeFunctionNode = (
  functionNode: Node,
  filePath: string,
  sourceText: string,
  parent: Node | null,
  opts: AnalyzeNestingOptions = DEFAULT_NESTING_OPTIONS,
): NestingItem | null => {
  const bodyValue = resolveFunctionBody(functionNode);

  if (bodyValue === null || bodyValue === undefined) {
    return null;
  }

  let maxDepth = 0;
  let cognitiveComplexity = 0;
  const iterationStack: string[] = [];
  const accidentalQuadraticTargets = new Set<string>();

  // Halstead counters
  let totalOperators = 0;
  let totalOperands = 0;
  const uniqueOperators = new Set<string>();
  const uniqueOperands = new Set<string>();

  const hasNestedIterationOnTarget = (value: NodeValue, target: string): boolean => {
    let found = false;

    const scan = (candidate: NodeValue): void => {
      if (found) {
        return;
      }

      if (isOxcNodeArray(candidate)) {
        for (const entry of candidate) {
          scan(entry);
        }

        return;
      }

      if (!isOxcNode(candidate)) {
        return;
      }

      // Keep scan bounded: do not enter further nested function bodies.
      if (candidate !== value && isFunctionNode(candidate)) {
        return;
      }

      const innerTarget = getIterationTarget(candidate);

      if (innerTarget === target) {
        found = true;

        return;
      }

      if (!isNodeRecord(candidate)) {
        return;
      }

      visitOxcChildren(candidate, entry => {
        scan(entry);
      });
    };

    scan(value);

    return found;
  };

  const maybeReportCallbackQuadratic = (node: NodeValue, target: string): void => {
    if (!isOxcNode(node) || !isNodeRecord(node) || node.type !== 'CallExpression') {
      return;
    }

    const args = Array.isArray(node.arguments) ? (node.arguments as ReadonlyArray<NodeValue>) : [];
    const callback = args[0];

    if (!isOxcNode(callback) || !isFunctionNode(callback) || !isNodeRecord(callback)) {
      return;
    }

    const callbackBody = resolveFunctionBody(callback as unknown as Node);

    if (callbackBody === null || callbackBody === undefined) {
      return;
    }

    if (hasNestedIterationOnTarget(callbackBody as NodeValue, target)) {
      accidentalQuadraticTargets.add(target);
    }
  };

  /**
   * Visit non-LogicalExpression children of a LogicalExpression.
   * The LogicalExpression chain itself is handled by countLogicalComplexity();
   * we still need to descend into non-logical operands (e.g. ternary inside &&).
   */
  const visitLogicalLeaves = (node: NodeValue, depth: number): void => {
    if (!isOxcNode(node) || !isNodeRecord(node)) {
      return;
    }

    if (node.type === 'LogicalExpression') {
      // Halstead: count ALL logical operators in the chain (visit() only counts the top-level one)
      collectHalstead(node as NodeValue, 'LogicalExpression');
      visitLogicalLeaves(node.left as NodeValue, depth);
      visitLogicalLeaves(node.right as NodeValue, depth);

      return;
    }

    visit(node as NodeValue, depth);
  };

  const visitIfStatement = (node: NodeValue, depth: number): void => {
    if (!isOxcNode(node) || !isNodeRecord(node) || node.type !== 'IfStatement') {
      return;
    }

    // +1 (inherent) + depth (nesting bonus)
    cognitiveComplexity += 1 + depth;

    const nextDepth = depth + 1;

    if (nextDepth > maxDepth) {
      maxDepth = nextDepth;
    }

    // Visit the test expression at current depth (condition is evaluated before entering if body)
    visit(node.test as NodeValue, depth);

    // Visit the consequent body
    visit(node.consequent as NodeValue, nextDepth);

    // Handle alternate
    const alt = node.alternate;

    if (alt !== null && alt !== undefined && isOxcNode(alt)) {
      if (isNodeRecord(alt) && alt.type === 'IfStatement') {
        // else if: +1 only (no nesting bonus, no depth increase)
        // Halstead: count the else-if IfStatement operator (bypasses visit())
        collectHalstead(alt as NodeValue, 'IfStatement');
        visitIfStatement(alt as NodeValue, depth);
      } else {
        // standalone else: +1, then visit body at increased depth
        cognitiveComplexity += 1;

        visit(alt as NodeValue, nextDepth);
      }
    }
  };

  const HALSTEAD_CONTROL_OPS = new Set([
    'IfStatement',
    'ForStatement',
    'ForInStatement',
    'ForOfStatement',
    'WhileStatement',
    'DoWhileStatement',
    'SwitchStatement',
    'SwitchCase',
    'CatchClause',
    'TryStatement',
    'ReturnStatement',
    'ThrowStatement',
    'BreakStatement',
    'ContinueStatement',
  ]);

  const collectHalstead = (value: NodeValue, nodeType: string): void => {
    if (!isNodeRecord(value)) {
      return;
    }

    // Control-flow operators
    if (HALSTEAD_CONTROL_OPS.has(nodeType)) {
      const op = nodeType;

      totalOperators++;
      uniqueOperators.add(op);
    }

    // Binary/Logical/Assignment/Unary/Update operators
    if (
      nodeType === 'BinaryExpression' ||
      nodeType === 'LogicalExpression' ||
      nodeType === 'AssignmentExpression' ||
      nodeType === 'UnaryExpression' ||
      nodeType === 'UpdateExpression'
    ) {
      const op = String(value.operator ?? '');

      if (op.length > 0) {
        totalOperators++;
        uniqueOperators.add(op);
      }
    }

    // ConditionalExpression (ternary)
    if (nodeType === 'ConditionalExpression') {
      totalOperators++;
      uniqueOperators.add('?:');
    }

    // Function call operator
    if (nodeType === 'CallExpression') {
      totalOperators++;
      uniqueOperators.add('()');
    }

    // Object creation operator
    if (nodeType === 'NewExpression') {
      totalOperators++;
      uniqueOperators.add('new');
    }

    // Await operator
    if (nodeType === 'AwaitExpression') {
      totalOperators++;
      uniqueOperators.add('await');
    }

    // Yield operator
    if (nodeType === 'YieldExpression') {
      totalOperators++;
      uniqueOperators.add('yield');
    }

    // Property access operator
    if (nodeType === 'MemberExpression') {
      const optional = Boolean(value.optional);
      const computed = Boolean(value.computed);
      const op = optional ? '?.' : computed ? '[]' : '.';

      totalOperators++;
      uniqueOperators.add(op);
    }

    // Operands: Identifier
    if (nodeType === 'Identifier') {
      const name = String(value.name ?? '');

      if (name.length > 0) {
        totalOperands++;
        uniqueOperands.add(name);
      }
    }

    // Operands: Literals
    if (
      nodeType === 'NumericLiteral' ||
      nodeType === 'StringLiteral' ||
      nodeType === 'BooleanLiteral' ||
      nodeType === 'NullLiteral' ||
      nodeType === 'BigIntLiteral' ||
      nodeType === 'RegExpLiteral'
    ) {
      const raw = String(value.raw ?? value.value ?? nodeType);

      totalOperands++;
      uniqueOperands.add(raw);
    }

    // Operands: this, super
    if (nodeType === 'ThisExpression') {
      totalOperands++;
      uniqueOperands.add('this');
    }

    if (nodeType === 'Super') {
      totalOperands++;
      uniqueOperands.add('super');
    }
  };

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

    if (value !== functionNode && isFunctionNode(value)) {
      return;
    }

    const nodeType = value.type;

    // IfStatement has custom handling for else-if chains
    if (nodeType === 'IfStatement') {
      // Halstead: count IfStatement operator (else-if handled in visitIfStatement)
      collectHalstead(value, nodeType);

      if (!isNodeRecord(value)) {
        return;
      }

      visitIfStatement(value, depth);

      return;
    }

    // LogicalExpression: flat counting of operator switches, no depth bonus
    // Halstead for all logical operators is handled inside visitLogicalLeaves
    if (nodeType === 'LogicalExpression') {
      cognitiveComplexity += countLogicalComplexity(value);

      visitLogicalLeaves(value, depth);

      return;
    }

    // Halstead: collect operators and operands for all other node types
    collectHalstead(value, nodeType);

    // labeled break/continue: +1
    if (nodeType === 'BreakStatement' || nodeType === 'ContinueStatement') {
      if (isNodeRecord(value) && value.label !== null && value.label !== undefined) {
        cognitiveComplexity += 1;
      }
    }

    const nextDepth = shouldIncreaseNestingDepth(nodeType) ? depth + 1 : depth;

    if (nextDepth > maxDepth) {
      maxDepth = nextDepth;
    }

    // Decision point: +1 (inherent) + depth (nesting bonus)
    // IfStatement and LogicalExpression are handled above
    if (isDecisionPoint(nodeType)) {
      cognitiveComplexity += 1 + depth;
    }

    const iterationTarget = getIterationTarget(value);
    const isIteration = iterationTarget !== null;

    const pushIteration = (): void => {
      if (iterationTarget === null) {
        return;
      }

      if (iterationStack.includes(iterationTarget)) {
        accidentalQuadraticTargets.add(iterationTarget);
      }

      iterationStack.push(iterationTarget);
    };

    const popIteration = (): void => {
      if (!isIteration) {
        return;
      }

      iterationStack.pop();
    };

    if (!isNodeRecord(value)) {
      return;
    }

    if (isIteration) {
      pushIteration();

      if (iterationTarget !== null) {
        maybeReportCallbackQuadratic(value, iterationTarget);
      }
    }

    visitOxcChildren(value, entry => {
      visit(entry, nextDepth);
    });

    if (isIteration) {
      popIteration();
    }
  };

  visit(bodyValue as NodeValue, 0);

  const header = getNodeHeader(functionNode, parent);
  const span = getFunctionSpan(functionNode, sourceText);
  const nestingScore = Math.max(0, cognitiveComplexity);
  const callbackDepth = measureMaxCallbackDepth(bodyValue as NodeValue);
  const promiseChainDepth = measurePromiseChainDepth(bodyValue as NodeValue);
  const quadraticTargets = Array.from(accidentalQuadraticTargets).sort();
  // Complexity density: CC / LOC
  const loc = span.end.line - span.start.line + 1;
  const density = loc > 0 ? cognitiveComplexity / loc : 0;

  // Halstead metrics
  const eta1 = uniqueOperators.size;
  const eta2 = uniqueOperands.size;
  const n1 = totalOperators;
  const n2 = totalOperands;
  const vocabulary = eta1 + eta2;
  const halsteadVolume = vocabulary > 0 ? (n1 + n2) * Math.log2(vocabulary) : 0;
  const halsteadDifficulty = eta2 > 0 ? (eta1 / 2) * (n2 / eta2) : 0;

  const PRIORITY: ReadonlyArray<NestingKind> = [
    'accidental-quadratic',
    'high-cognitive-complexity',
    'callback-depth',
    'promise-chain-depth',
    'deep-nesting',
    'complexity-density',
  ];

  const collectSignals = (): NestingKind[] => {
    const signals: NestingKind[] = [];

    if (quadraticTargets.length > 0) signals.push('accidental-quadratic');
    if (cognitiveComplexity >= opts.maxCognitiveComplexity) signals.push('high-cognitive-complexity');
    if (callbackDepth >= opts.maxCallbackDepth) signals.push('callback-depth');
    if (promiseChainDepth >= opts.maxPromiseChainDepth) signals.push('promise-chain-depth');
    if (maxDepth >= opts.maxNestingDepth) signals.push('deep-nesting');
    if (loc >= opts.minDensityLoc && density > opts.maxDensity) signals.push('complexity-density');

    return signals;
  };

  const signals = collectSignals();

  if (signals.length === 0) {
    return null;
  }

  const kind = PRIORITY.find(k => signals.includes(k))!;

  return {
    kind,
    signals,
    file: filePath,
    header,
    span,
    metrics: {
      depth: maxDepth,
      cognitiveComplexity,
      callbackDepth,
      promiseChainDepth: promiseChainDepth > 0 ? promiseChainDepth : undefined,
      quadraticTargets,
      density,
      halsteadVolume: Math.round(halsteadVolume * 100) / 100,
      halsteadDifficulty: Math.round(halsteadDifficulty * 100) / 100,
    },
    score: nestingScore,
  };
};

const analyzeNesting = (
  files: ReadonlyArray<ParsedFile>,
  options?: Partial<AnalyzeNestingOptions>,
): ReadonlyArray<NestingItem> => {
  if (files.length === 0) {
    return createEmptyNesting();
  }

  const opts: AnalyzeNestingOptions = { ...DEFAULT_NESTING_OPTIONS, ...options };

  return collectFunctionItems(files, (node, filePath, sourceText, parent) =>
    analyzeFunctionNode(node, filePath, sourceText, parent, opts),
  ).filter((item): item is NestingItem => item !== null);
};

export { analyzeNesting, createEmptyNesting, DEFAULT_NESTING_OPTIONS };
export type { AnalyzeNestingOptions };
