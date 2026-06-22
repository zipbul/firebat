/**
 * Shared AST-walking helpers for oxc-parser-backed test harnesses.
 *
 * Both the oxlint golden runner and the parser-backed autofix fuzz harness
 * parse real source with oxc-parser and then walk the resulting tree to
 * normalise ranges, dispatch a visitor, and collect identifier usages. This
 * module is the single source of truth for those walks so the two harnesses
 * cannot drift apart.
 */
import type { AstNode, AstNodeValue, RuleContext } from '../../../../src/test-api';

interface AstNodeShape {
  type?: string;
}

export interface Visitor {
  [key: string]: ((node: AstNode) => void) | undefined;
}

/** An oxlint rule module: a `create` factory returning a node Visitor. */
export interface RuleModule {
  create(context: RuleContext): Visitor;
}

/**
 * Structural guard: a non-array object carrying a string `type` field is an
 * {@link AstNode}. Accepts `unknown` so callers can feed raw parser output.
 */
export const isAstNode = (value: unknown): value is AstNode => {
  if (value === null || value === undefined || Array.isArray(value)) {
    return false;
  }

  if (typeof value !== 'object') {
    return false;
  }

  return typeof (value as AstNodeShape).type === 'string';
};

/**
 * The oxc-parser may produce `start`/`end` numeric fields alongside (or instead
 * of) `range`. Normalise them to the `range: [start, end]` form that rule
 * implementations expect, recursing through the whole tree once.
 */
export const ensureRangesDeep = (root: AstNodeValue | null | undefined): void => {
  const seen = new WeakSet<AstNode>();

  const walk = (value: AstNodeValue | null | undefined): void => {
    if (value === null || value === undefined) {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }

      return;
    }

    if (!isAstNode(value)) {
      return;
    }

    if (seen.has(value)) {
      return;
    }

    seen.add(value);

    const start = (value as Record<string, unknown>)['start'];
    const end = (value as Record<string, unknown>)['end'];
    const range = value.range;

    if (!Array.isArray(range) && typeof start === 'number' && typeof end === 'number') {
      value.range = [start, end];
    }

    for (const key of Object.keys(value)) {
      if (key === 'parent') {
        continue;
      }

      const child = value[key];

      if (Array.isArray(child)) {
        for (const item of child) {
          walk(item);
        }

        continue;
      }

      walk(child);
    }
  };

  walk(root);
};

/**
 * Depth-first walk that invokes `visitor[node.type]` for every node, guarding
 * against cycles via a `WeakSet` and skipping `parent` back-references.
 */
export const traverseAndVisit = (root: AstNodeValue | null | undefined, visitor: Visitor): void => {
  const seen = new WeakSet<AstNode>();

  const walk = (value: AstNodeValue | null | undefined): void => {
    if (value === null || value === undefined) {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }

      return;
    }

    if (!isAstNode(value)) {
      return;
    }

    if (seen.has(value)) {
      return;
    }

    seen.add(value);

    const handler = visitor[value.type];

    if (typeof handler === 'function') {
      handler(value);
    }

    for (const key of Object.keys(value)) {
      if (key === 'parent') {
        continue;
      }

      const child = value[key];

      if (Array.isArray(child)) {
        for (const item of child) {
          walk(item);
        }

        continue;
      }

      walk(child);
    }
  };

  walk(root);
};

/**
 * Collect every `Identifier` node named `name`, excluding any whose range falls
 * entirely inside `excludeRange` (used to drop the declaration site itself).
 */
export const collectIdentifierUsages = (
  root: AstNodeValue | null | undefined,
  name: string,
  excludeRange: [number, number] | null,
  getRange: (node: AstNode | null | undefined) => [number, number] | null,
): AstNode[] => {
  const out: AstNode[] = [];

  traverseAndVisit(root, {
    Identifier(node) {
      if (typeof node.name !== 'string' || node.name !== name) {
        return;
      }

      const range = getRange(node);

      if (!range) {
        return;
      }

      const excludeStart = excludeRange?.[0];
      const excludeEnd = excludeRange?.[1];

      if (excludeStart !== undefined && excludeEnd !== undefined && range[0] >= excludeStart && range[1] <= excludeEnd) {
        return;
      }

      out.push(node);
    },
  });

  return out;
};
