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

import { isFunctionNode, ScopeTracker, walk } from '@zipbul/gildash';

import type { VariableCollectorOptions, VariableUsage } from '../types';

import { evalStaticNullish, evalStaticTruthiness, forEachChildNode, unwrapExpression } from '../ast';

/**
 * Walk `root` with a `ScopeTracker` and return a map from each identifier's start
 * offset to the lexical scope key of its declaration. Pass the resulting map to
 * `collectVariables` (via `declScopeByIdLocation`) when traversing only part of
 * the enclosing scope, so usages of declarations outside the traversed subtree
 * (e.g. function parameters when traversing the function body) still resolve.
 *
 * `var` hoisting: oxc-walker's ScopeTracker treats `var` declarations the same as
 * `let`/`const` — they stay in the enclosing block scope. JS spec says `var`
 * hoists to the enclosing function (or module) scope, so a `var c` declared
 * inside a nested block must be reachable from any reference of `c` outside that
 * block but still inside the same function. The post-walk normalization below
 * overrides ScopeTracker's scope key for any identifier that binds to a `var`
 * declaration, using `var:<funcOffset>:<name>` as the unified synthetic key for
 * the declaration site and every reference within the same function body. Other
 * declarations (let/const/parameter/import/catch) pass through unchanged.
 */
export const buildDeclScopeMap = (root: Node): ReadonlyMap<number, string> => {
  const declScopeByIdLocation = new Map<number, string>();
  const scopeTracker = new ScopeTracker();

  // Pre-walk: per enclosing function/module, the set of names declared by `var`.
  // Key = function/arrow node start offset; 0 = module scope.
  const varNamesByFunction = collectVarHoistInfo(root);

  // Main walk: ancestor stack lets us find the nearest enclosing function and
  // apply the var-hoist override before recording the scope key.
  const ancestors: Node[] = [];

  walk(root, {
    scopeTracker,
    enter(n: Node) {
      if (n.type === 'Identifier') {
        const decl = scopeTracker.getDeclaration(n.name);
        const declaredByVar = decl !== null && decl.type === 'Variable' &&
          (decl as { variableNode: { kind: string } }).variableNode.kind === 'var';

        let scopeKey: string | null = decl !== null ? decl.scope : null;

        // Override only when (a) ScopeTracker found no binding (outer reference
        // of a hoisted var), or (b) the binding is itself a `var` (could be the
        // wrong inner scope). For let/const/param/import/catch, trust ScopeTracker.
        if (decl === null || declaredByVar) {
          const hoisted = findVarHoistScopeKey(ancestors, n.name, varNamesByFunction);

          if (hoisted !== null) {
            scopeKey = hoisted;
          }
        }

        if (scopeKey !== null) {
          declScopeByIdLocation.set(n.start, scopeKey);
        }
      }

      ancestors.push(n);
    },
    leave() {
      ancestors.pop();
    },
  });

  return declScopeByIdLocation;
};

const collectVarHoistInfo = (root: Node): Map<number, Set<string>> => {
  const result = new Map<number, Set<string>>();
  // Top of stack = enclosing function node offset; 0 = module/global.
  const fnStack: number[] = [0];

  const ensureSet = (key: number): Set<string> => {
    let s = result.get(key);

    if (s === undefined) {
      s = new Set<string>();
      result.set(key, s);
    }

    return s;
  };

  const visit = (node: Node): void => {
    const enteredFn = isFunctionNode(node);

    if (enteredFn) {
      fnStack.push(node.start);
    }

    if (node.type === 'VariableDeclaration' &&
        (node as { kind?: string }).kind === 'var') {
      const target = ensureSet(fnStack[fnStack.length - 1] ?? 0);

      for (const declarator of (node as { declarations: ReadonlyArray<{ id: Node }> }).declarations) {
        collectPatternBindingNames(declarator.id, name => target.add(name));
      }
    }

    forEachChildNode(node, visit);

    if (enteredFn) {
      fnStack.pop();
    }
  };

  visit(root);

  return result;
};

const collectPatternBindingNames = (pattern: Node, emit: (name: string) => void): void => {
  if (pattern.type === 'Identifier') {
    emit((pattern as { name: string }).name);

    return;
  }

  if (pattern.type === 'ArrayPattern') {
    for (const el of (pattern as { elements: ReadonlyArray<Node | null> }).elements) {
      if (el !== null) {
        collectPatternBindingNames(el, emit);
      }
    }

    return;
  }

  if (pattern.type === 'ObjectPattern') {
    for (const prop of (pattern as { properties: ReadonlyArray<Node> }).properties) {
      if (prop.type === 'Property') {
        const value = (prop as { value: Node }).value;

        collectPatternBindingNames(value, emit);
      } else if (prop.type === 'RestElement') {
        const arg = (prop as { argument: Node }).argument;

        collectPatternBindingNames(arg, emit);
      }
    }

    return;
  }

  if (pattern.type === 'RestElement') {
    collectPatternBindingNames((pattern as { argument: Node }).argument, emit);

    return;
  }

  if (pattern.type === 'AssignmentPattern') {
    collectPatternBindingNames((pattern as { left: Node }).left, emit);
  }
};

const findVarHoistScopeKey = (
  ancestors: ReadonlyArray<Node>,
  name: string,
  varNamesByFunction: ReadonlyMap<number, Set<string>>,
): string | null => {
  // Walk innermost → outermost function ancestor. First function whose hoist
  // set has the name wins (matches JS var lookup semantics).
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    const a = ancestors[i];

    if (a !== undefined && isFunctionNode(a)) {
      const set = varNamesByFunction.get(a.start);

      if (set !== undefined && set.has(name)) {
        return `var:${a.start}:${name}`;
      }
    }
  }

  // Module scope.
  const moduleSet = varNamesByFunction.get(0);

  if (moduleSet !== undefined && moduleSet.has(name)) {
    return `var:0:${name}`;
  }

  return null;
};

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

  // Pre-pass: walk with ScopeTracker so every identifier's declaration scope is known.
  // This lets `declScope` distinguish same-name bindings in different lexical scopes
  // (outer `let x` vs inner `let x`) without relying on name alone.
  //
  // When the caller provides `declScopeByIdLocation`, use it directly — it is expected
  // to cover the enclosing function (including parameters), which an in-body walk
  // alone cannot see.
  const declScopeByIdLocation: ReadonlyMap<number, string> =
    options.declScopeByIdLocation ?? buildDeclScopeMap(node);
  const evaluateAllBranches = options.evaluateAllBranches === true;

  const pushIdentifierUsage = (
    current: Node,
    name: string,
    isWriteContext: boolean,
    writeKind: VariableUsage['writeKind'] | undefined,
    declarationKind: VariableUsage['declarationKind'] | undefined,
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

    if (writeKind === 'declaration' && declarationKind) {
      usage.declarationKind = declarationKind;
    }

    const declScope = declScopeByIdLocation.get(current.start);

    if (declScope !== undefined) {
      usage.declScope = declScope;
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
    declarationKind?: VariableUsage['declarationKind'],
  ) => void;

  const visitIdentifier = (
    current: Node & { type: 'Identifier'; name: string },
    isWriteContext: boolean,
    writeKind: VariableUsage['writeKind'] | undefined,
    suppressDeclarations: boolean,
    declarationKind: VariableUsage['declarationKind'] | undefined,
  ): void => {
    // When suppressDeclarations is active (e.g. visiting inside an IIFE body),
    // skip declaration writes — they belong to the nested scope, not the outer scope.
    if (suppressDeclarations && isWriteContext && writeKind === 'declaration') {
      return;
    }

    pushIdentifierUsage(current, current.name, isWriteContext, writeKind, declarationKind);
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
    // so the computed property is never actually read. (Skipped in syntactic mode so
    // tools like waste's no-unused-vars classification still count the read.)
    if (current.optional === true && isLiteralNullishBase(object) && !evaluateAllBranches) {
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
    declarationKind: VariableUsage['declarationKind'] | undefined,
  ): void => {
    const { id, init } = current;
    const initKeys = getStaticObjectExpressionKeys(init);

    if (id.type === 'ObjectPattern' && initKeys !== null) {
      visitObjectDestructuringProps(id, initKeys, allowNestedFunctions, suppressDeclarations);
    } else if (id.type === 'Identifier' && init === null) {
      // `let x;` — binding-only declaration. Carries hasInit=false so detectors can
      // distinguish the binding from an actual value write.
      if (!suppressDeclarations) {
        const usage: VariableUsage = {
          name: id.name,
          isRead: false,
          isWrite: true,
          location: id.start,
          writeKind: 'declaration',
          hasInit: false,
        };

        if (declarationKind) {
          usage.declarationKind = declarationKind;
        }

        const declScope = declScopeByIdLocation.get(id.start);

        if (declScope !== undefined) {
          usage.declScope = declScope;
        }

        usages.push(usage);
      }
    } else {
      visit(id, allowNestedFunctions, true, 'declaration', suppressDeclarations, declarationKind);
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
    declarationKind?: VariableUsage['declarationKind'],
  ) => {
    if (!allowNestedFunctions && isFunctionNode(current)) {
      return;
    }

    if (current.type === 'VariableDeclaration') {
      // Container node — propagate the declaration keyword (`let`/`const`/`var`/`using`/
      // `await using`) to each declarator so detector layers (e.g. waste) can apply
      // keyword-specific policy (e.g. exempt `using` from waste reporting).
      for (const declarator of current.declarations) {
        visit(declarator, allowNestedFunctions, false, undefined, suppressDeclarations, current.kind);
      }

      return;
    }

    if (current.type === 'Identifier') {
      visitIdentifier(current, isWriteContext, writeKind, suppressDeclarations, declarationKind);

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
      if (evaluateAllBranches) {
        // Syntactic mode — traverse both sides regardless of static reachability.
        visit(current.left, allowNestedFunctions, false, undefined, suppressDeclarations);
        visit(current.right, allowNestedFunctions, false, undefined, suppressDeclarations);
      } else {
        visitLogicalExpression(current, allowNestedFunctions, suppressDeclarations, visit);
      }

      return;
    }

    if (current.type === 'ConditionalExpression') {
      if (evaluateAllBranches) {
        visit(current.test, allowNestedFunctions, false, undefined, suppressDeclarations);
        visit(current.consequent, allowNestedFunctions, false, undefined, suppressDeclarations);
        visit(current.alternate, allowNestedFunctions, false, undefined, suppressDeclarations);
      } else {
        visitConditionalExpression(current, allowNestedFunctions, suppressDeclarations, visit);
      }

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
      visitVariableDeclarator(current, allowNestedFunctions, suppressDeclarations, declarationKind);

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
