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
import { tryGildashDeclScopeMap } from './gildash-binding-source';

/**
 * Return a map from each identifier's start offset to a synthetic binding key
 * (one per distinct binding) for the given file. The map covers every
 * reference to every binding declared inside the file, including parameters
 * and outer references that resolve to in-file bindings.
 *
 * Source: gildash 0.32 `getStandaloneFileBindings(filePath, sourceText)` —
 * tsc-authoritative binding identity resolved in an isolated single-file
 * program (~1ms, repo-size independent). Handles var hoisting, shadowing
 * across blocks, destructuring, and writeKind correctly by construction. The
 * legacy oxc-walker `ScopeTracker` path was removed because its lexical-only
 * model misclassifies `var` declarations (round-9 defect).
 *
 * The semantic context must be registered via `setGildashSemanticContext`
 * before the first dataflow call. Production scan (`scan.usecase.ts`) and the
 * test preload (`global-setup.ts`) open the context once for the process.
 * `sourceText` is the full file source backing `root`; callers thread it from
 * the ParsedFile.
 */
export const buildDeclScopeMap = (root: Node, filePath?: string, sourceText?: string): ReadonlyMap<number, string> => {
  void root;

  const fromGildash = tryGildashDeclScopeMap(filePath, sourceText);

  if (fromGildash !== null) {
    return fromGildash;
  }

  throw new Error(
    `buildDeclScopeMap: gildash binding source did not resolve for filePath=${filePath ?? 'undefined'}. ` +
      `No Gildash semantic context is registered, or sourceText was not provided. ` +
      `Production scan must open Gildash with { semantic: true }; tests must load ` +
      `test/integration/shared/global-setup.ts via bunfig preload, and callers must ` +
      `thread the file's sourceText.`,
  );
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

/**
 * Visit the unconditionally-evaluated discriminating operand, then return its static
 * truthiness — the shared "evaluate-then-decide-short-circuit" step of && / || and ?: .
 */
const visitAndGetTruthiness = (
  node: Node,
  allowNestedFunctions: boolean,
  suppressDeclarations: boolean,
  visit: VisitFn,
): boolean | null => {
  visit(node, allowNestedFunctions, false, undefined, suppressDeclarations);

  return evalStaticTruthiness(node);
};

const visitLogicalExpression = (
  current: LogicalExpression,
  allowNestedFunctions: boolean,
  suppressDeclarations: boolean,
  visit: VisitFn,
): void => {
  const { operator, left, right } = current;
  // Left is always evaluated (inside visitAndGetTruthiness).
  const leftTruthiness = visitAndGetTruthiness(left, allowNestedFunctions, suppressDeclarations, visit);

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
  const truthiness = visitAndGetTruthiness(test, allowNestedFunctions, suppressDeclarations, visit);

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
  // `declScopeByIdLocation` maps each identifier offset to its binding scope
  // key, letting `declScope` distinguish same-name bindings across scopes
  // (outer `let x` vs inner `let x`). Callers that need full scope resolution
  // thread the gildash-derived map (covering the enclosing function +
  // parameters). When omitted, sub-walks (parameter defaults, decorator
  // expressions) fall back to an empty map — they only need local identifier
  // kinds, not cross-reference resolution against an outer scope.
  const declScopeByIdLocation: ReadonlyMap<number, string> = options.declScopeByIdLocation ?? new Map<number, string>();
  const evaluateAllBranches = options.evaluateAllBranches === true;

  // Resolve a usage's binding scope from its identifier offset, attach it when
  // known, then record the usage. The single "finalize and record a usage"
  // decision shared by the value-write and binding-only declaration paths.
  const recordUsage = (usage: VariableUsage, idStart: number): void => {
    const declScope = declScopeByIdLocation.get(idStart);

    if (declScope !== undefined) {
      usage.declScope = declScope;
    }

    usages.push(usage);
  };

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

    recordUsage(usage, current.start);
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
    // suppressDeclarations marks "inside an IIFE body" (see visitCallExpression).
    // Suppress ALL writes there — declarations AND assignments/compound/update —
    // because any write inside the IIFE belongs to the IIFE's own scope/CFG and
    // is analyzed in its own pass. Recording it as an enclosing-scope def would
    // pollute reaching-defs (no enclosing CFG node for it → never reaches its
    // own read → false dead-store). Reads are still recorded: the IIFE runs
    // immediately, so a read of an enclosing variable is a real use.
    if (suppressDeclarations && isWriteContext) {
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

        recordUsage(usage, id.start);
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
      // IIFE: descend with allowNestedFunctions=true so reads of enclosing
      // variables are counted (the IIFE runs immediately, in the enclosing
      // scope's execution). suppressDeclarations=true marks "inside an IIFE
      // body" — which suppresses ALL writes (declarations AND assignments/
      // compound/update), not just declarations: a write inside the IIFE
      // belongs to the IIFE's own scope/CFG and is analyzed in its own pass.
      // Recording it as an enclosing-scope def pollutes reaching-defs (the
      // write has no node in the enclosing CFG, so it never reaches its
      // also-inside-IIFE read → misreported as a dead store).
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
