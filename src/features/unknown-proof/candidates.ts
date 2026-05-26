import type {
  ArrayPattern,
  ArrowFunctionExpression,
  BindingIdentifier,
  BindingPattern,
  CallExpression,
  CatchClause,
  Expression,
  ForInStatement,
  ForOfStatement,
  Function as OxcFunction,
  Node,
  ObjectPattern,
  VariableDeclarator,
} from 'oxc-parser';

import { buildLineOffsets, getLineColumn } from '@zipbul/gildash';
import { Visitor } from 'oxc-parser';

import type { ParsedFile } from '../../engine/types';
import type { SourceSpan } from '../../types';

import { walkOxcTree } from '../../engine/ast/oxc-ast-utils';

interface BindingCandidate {
  readonly name: string;
  readonly offset: number;
  readonly span: SourceSpan;
  readonly isCatchParam: boolean;
  readonly initCalleeEndOffset?: number;
  readonly initObjectEndOffset?: number;
  readonly iterableEndOffset?: number;
  readonly hasExplicitAnyTypeArg?: boolean;
  readonly catchBodyRange?: { readonly start: number; readonly end: number };
  readonly hasExplicitAnnotation?: boolean;
  readonly scopeRange: { readonly start: number; readonly end: number };
}

interface ExpressionCandidate {
  readonly kind: 'any-cast' | 'double-cast' | 'non-null-assertion';
  readonly span: SourceSpan;
  readonly sourceSnippet: string;
}

interface CollectBindingCandidatesInput {
  readonly program: ReadonlyArray<ParsedFile>;
}

const toSpanFromOffsets = (sourceText: string, startOffset: number, endOffset: number): SourceSpan => {
  const offsets = buildLineOffsets(sourceText);

  return {
    start: getLineColumn(offsets, Math.max(0, startOffset)),
    end: getLineColumn(offsets, Math.max(0, endOffset)),
  };
};

// ── Binding pattern walk (returns Identifier leaves only) ──────────────────

const extractBindingIdentifiers = (pattern: BindingPattern): ReadonlyArray<BindingIdentifier> => {
  if (pattern.type === 'Identifier') {
    return [pattern];
  }

  if (pattern.type === 'AssignmentPattern') {
    return extractBindingIdentifiers(pattern.left);
  }

  if (pattern.type === 'ObjectPattern') {
    return collectObjectPatternIdentifiers(pattern);
  }

  if (pattern.type === 'ArrayPattern') {
    return collectArrayPatternIdentifiers(pattern);
  }

  return [];
};

const collectObjectPatternIdentifiers = (pattern: ObjectPattern): ReadonlyArray<BindingIdentifier> => {
  const results: BindingIdentifier[] = [];

  for (const prop of pattern.properties) {
    if (prop.type === 'RestElement') {
      results.push(...extractBindingIdentifiers(prop.argument));

      continue;
    }

    results.push(...extractBindingIdentifiers(prop.value));
  }

  return results;
};

const collectArrayPatternIdentifiers = (pattern: ArrayPattern): ReadonlyArray<BindingIdentifier> => {
  const results: BindingIdentifier[] = [];

  for (const element of pattern.elements) {
    if (element === null) {
      continue;
    }

    if (element.type === 'RestElement') {
      results.push(...extractBindingIdentifiers(element.argument));

      continue;
    }

    results.push(...extractBindingIdentifiers(element));
  }

  return results;
};

// ── Expression unwrap helpers — return precise types or undefined ──────────

const unwrapAwait = (expr: Expression | null | undefined): Expression | null => {
  if (expr === null || expr === undefined) {
    return null;
  }

  if (expr.type === 'AwaitExpression') {
    // AwaitExpression.argument is Expression
    return expr.argument;
  }

  return expr;
};

const extractMemberObjectEnd = (expr: Expression): number | undefined => {
  if (expr.type === 'MemberExpression') {
    return expr.object.end;
  }

  if (expr.type === 'CallExpression' && expr.callee.type === 'MemberExpression') {
    return expr.callee.object.end;
  }

  return undefined;
};

const getInitObjectEndOffset = (init: Expression | null | undefined): number | undefined => {
  const target = unwrapAwait(init);

  if (target === null) {
    return undefined;
  }

  const direct = extractMemberObjectEnd(target);

  if (direct !== undefined) {
    return direct;
  }

  if (target.type === 'ConditionalExpression') {
    const fromConsequent = extractMemberObjectEnd(target.consequent);

    if (fromConsequent !== undefined) {
      return fromConsequent;
    }

    return extractMemberObjectEnd(target.alternate);
  }

  if (target.type === 'LogicalExpression') {
    return extractMemberObjectEnd(target.left);
  }

  return undefined;
};

const hasExplicitAnyTypeArgument = (init: Expression | null | undefined): boolean => {
  const target = unwrapAwait(init);

  if (target === null || target.type !== 'CallExpression') {
    return false;
  }

  const typeArgs = target.typeArguments;

  if (typeArgs === null || typeArgs === undefined) {
    return false;
  }

  for (const param of typeArgs.params) {
    if (param.type === 'TSAnyKeyword' || param.type === 'TSUnknownKeyword') {
      return true;
    }
  }

  return false;
};

const containsAnyUnknownCast = (expr: Expression): boolean => {
  if (expr.type === 'TSAsExpression' || expr.type === 'TSTypeAssertion') {
    const typeAnno = expr.typeAnnotation;

    if (typeAnno.type === 'TSAnyKeyword' || typeAnno.type === 'TSUnknownKeyword') {
      return true;
    }

    return containsAnyUnknownCast(expr.expression);
  }

  if (expr.type === 'ParenthesizedExpression') {
    return containsAnyUnknownCast(expr.expression);
  }

  if (expr.type === 'MemberExpression') {
    return containsAnyUnknownCast(expr.object);
  }

  if (expr.type === 'CallExpression') {
    return containsAnyUnknownCast(expr.callee);
  }

  return false;
};

const hasExplicitCastToAnyUnknown = (init: Expression | null | undefined): boolean => {
  const target = unwrapAwait(init);

  if (target === null) {
    return false;
  }

  if (containsAnyUnknownCast(target)) {
    return true;
  }

  if (target.type === 'ConditionalExpression') {
    return containsAnyUnknownCast(target.consequent) || containsAnyUnknownCast(target.alternate);
  }

  return false;
};

const getCalleeEndOffset = (call: CallExpression): number => call.callee.end;

const getAwaitedCalleeEndOffset = (init: Expression | null | undefined): number | undefined => {
  if (init === null || init === undefined) {
    return undefined;
  }

  if (init.type === 'CallExpression') {
    return getCalleeEndOffset(init);
  }

  if (init.type === 'AwaitExpression' && init.argument.type === 'CallExpression') {
    return getCalleeEndOffset(init.argument);
  }

  return undefined;
};

// ── Collection ────────────────────────────────────────────────────────────

const collectBindingCandidates = (input: CollectBindingCandidatesInput): ReadonlyMap<string, ReadonlyArray<BindingCandidate>> => {
  const perFile = new Map<string, ReadonlyArray<BindingCandidate>>();

  for (const file of input.program) {
    const candidates: BindingCandidate[] = [];
    const seenOffsets = new Set<number>();
    const scopes: Array<{ start: number; end: number }> = [];
    const moduleScope = { start: 0, end: file.sourceText.length };

    const findEnclosingScope = (offset: number): { start: number; end: number } | undefined => {
      let best: { start: number; end: number } | undefined;

      for (const s of scopes) {
        if (s.start <= offset && offset <= s.end && (!best || s.end - s.start < best.end - best.start)) {
          best = s;
        }
      }

      return best;
    };

    interface PushExtras {
      readonly catchBodyRange?: { readonly start: number; readonly end: number };
      readonly hasExplicitAnnotation?: boolean;
      readonly explicitScopeRange?: { readonly start: number; readonly end: number };
      readonly initObjectEndOffset?: number;
      readonly iterableEndOffset?: number;
      readonly hasExplicitAnyTypeArg?: boolean;
    }

    const pushCandidate = (
      id: BindingIdentifier,
      isCatchParam: boolean,
      initCalleeEndOffset: number | undefined,
      extra?: PushExtras,
    ): void => {
      if (id.name.length === 0) {
        return;
      }

      if (seenOffsets.has(id.start)) {
        return;
      }

      seenOffsets.add(id.start);

      const resolvedScope = extra?.explicitScopeRange ?? findEnclosingScope(id.start) ?? moduleScope;

      candidates.push({
        name: id.name,
        offset: id.start,
        span: toSpanFromOffsets(file.sourceText, id.start, id.end),
        isCatchParam,
        ...(initCalleeEndOffset !== undefined ? { initCalleeEndOffset } : {}),
        ...(extra?.initObjectEndOffset !== undefined ? { initObjectEndOffset: extra.initObjectEndOffset } : {}),
        ...(extra?.iterableEndOffset !== undefined ? { iterableEndOffset: extra.iterableEndOffset } : {}),
        ...(extra?.hasExplicitAnyTypeArg === true ? { hasExplicitAnyTypeArg: true } : {}),
        ...(extra?.catchBodyRange !== undefined ? { catchBodyRange: extra.catchBodyRange } : {}),
        ...(extra?.hasExplicitAnnotation === true ? { hasExplicitAnnotation: true } : {}),
        scopeRange: resolvedScope,
      });
    };

    const handleFunctionNode = (node: OxcFunction | ArrowFunctionExpression): void => {
      const body = node.body;

      if (body !== null && body !== undefined) {
        scopes.push({ start: body.start, end: body.end });
      }

      const funcBodyRange = body !== null && body !== undefined ? { start: body.start, end: body.end } : undefined;

      for (const param of node.params) {
        if (param.type === 'TSParameterProperty') {
          // TS-only — defer to its inner BindingPattern.
          const inner = param.parameter;
          const innerHasAnnotation = inner.type !== 'Identifier' || inner.typeAnnotation != null;
          const ids = extractBindingIdentifiers(inner);

          for (const id of ids) {
            pushCandidate(id, false, undefined, {
              ...(innerHasAnnotation ? { hasExplicitAnnotation: true } : {}),
              ...(funcBodyRange !== undefined ? { explicitScopeRange: funcBodyRange } : {}),
            });
          }

          continue;
        }

        // FormalParameter (BindingPattern) or FormalParameterRest (RestElement).
        // Every parameter variant in oxc-parser exposes `typeAnnotation`; check it
        // directly rather than aliasing the `!== 'Identifier'` discriminator to
        // "annotated" (which falsely flagged every destructured/rest param).
        const paramHasAnnotation = param.typeAnnotation != null;
        const targetPattern: BindingPattern = param.type === 'RestElement' ? param.argument : param;
        const ids = extractBindingIdentifiers(targetPattern);

        for (const id of ids) {
          const idHasAnnotation = id.typeAnnotation != null;

          pushCandidate(id, false, undefined, {
            ...(paramHasAnnotation || idHasAnnotation ? { hasExplicitAnnotation: true } : {}),
            ...(funcBodyRange !== undefined ? { explicitScopeRange: funcBodyRange } : {}),
          });
        }
      }
    };

    const handleForLoop = (node: ForOfStatement | ForInStatement): void => {
      const rightEnd = node.right.end;
      const left = node.left;

      if (left.type !== 'VariableDeclaration') {
        return;
      }

      for (const decl of left.declarations) {
        const ids = extractBindingIdentifiers(decl.id);

        for (const id of ids) {
          pushCandidate(id, false, undefined, { iterableEndOffset: rightEnd });
        }
      }
    };

    const handleVariableDeclarator = (node: VariableDeclarator): void => {
      const ids = extractBindingIdentifiers(node.id);
      const initCalleeEndOffset = getAwaitedCalleeEndOffset(node.init);
      const initObjectEnd = getInitObjectEndOffset(node.init);
      const explicitAnyTypeArg = hasExplicitAnyTypeArgument(node.init);
      const explicitCast = hasExplicitCastToAnyUnknown(node.init);
      // BindingPattern variants (Identifier / Object / Array / Assignment) all
      // expose `typeAnnotation`; check it directly. The earlier `type !== 'Identifier'`
      // shortcut wrongly flagged every destructured/array-pattern declarator as annotated.
      const hasAnnotation = node.id.typeAnnotation != null;

      for (const id of ids) {
        pushCandidate(id, false, initCalleeEndOffset, {
          ...(hasAnnotation ? { hasExplicitAnnotation: true } : {}),
          ...(initObjectEnd !== undefined ? { initObjectEndOffset: initObjectEnd } : {}),
          ...(explicitAnyTypeArg || explicitCast ? { hasExplicitAnyTypeArg: true } : {}),
        });
      }
    };

    const handleCatchClause = (node: CatchClause): void => {
      const param = node.param;

      if (param === null) {
        return;
      }

      const body = node.body;
      const catchBodyRange = { start: body.start, end: body.end };
      const ids = extractBindingIdentifiers(param);

      for (const id of ids) {
        pushCandidate(id, true, undefined, { catchBodyRange });
      }
    };

    new Visitor({
      FunctionDeclaration: handleFunctionNode,
      FunctionExpression: handleFunctionNode,
      ArrowFunctionExpression: handleFunctionNode,
      VariableDeclarator: handleVariableDeclarator,
      CatchClause: handleCatchClause,
      ForOfStatement: handleForLoop,
      ForInStatement: handleForLoop,
    }).visit(file.program);

    if (candidates.length > 0) {
      perFile.set(file.filePath, candidates);
    }
  }

  return perFile;
};

// ── Expression candidates (as any / double-cast / non-null assertion) ─────

const isAnyOrUnknownTypeKeyword = (typeAnno: Node): boolean =>
  typeAnno.type === 'TSAnyKeyword' || typeAnno.type === 'TSUnknownKeyword';

const collectExpressionCandidates = (
  input: CollectBindingCandidatesInput,
): ReadonlyMap<string, ReadonlyArray<ExpressionCandidate>> => {
  const perFile = new Map<string, ReadonlyArray<ExpressionCandidate>>();

  for (const file of input.program) {
    const candidates: ExpressionCandidate[] = [];

    walkOxcTree(file.program, (node: Node) => {
      if (node.type === 'TSNonNullExpression') {
        candidates.push({
          kind: 'non-null-assertion',
          span: toSpanFromOffsets(file.sourceText, node.start, node.end),
          sourceSnippet: file.sourceText.slice(node.start, Math.min(node.end, node.start + 80)),
        });

        return true;
      }

      if (node.type !== 'TSAsExpression' && node.type !== 'TSTypeAssertion') {
        return true;
      }

      const innerExpr = node.expression;

      // double-cast: outer(as T) -> inner(as unknown|any)
      if (innerExpr.type === 'TSAsExpression' || innerExpr.type === 'TSTypeAssertion') {
        if (isAnyOrUnknownTypeKeyword(innerExpr.typeAnnotation)) {
          candidates.push({
            kind: 'double-cast',
            span: toSpanFromOffsets(file.sourceText, node.start, node.end),
            sourceSnippet: file.sourceText.slice(node.start, Math.min(node.end, node.start + 80)),
          });

          return false; // prevent re-visiting inner assertion
        }
      }

      // any-cast: as any
      if (node.typeAnnotation.type === 'TSAnyKeyword') {
        candidates.push({
          kind: 'any-cast',
          span: toSpanFromOffsets(file.sourceText, node.start, node.end),
          sourceSnippet: file.sourceText.slice(node.start, Math.min(node.end, node.start + 80)),
        });

        return false;
      }

      return true;
    });

    if (candidates.length > 0) {
      perFile.set(file.filePath, candidates);
    }
  }

  return perFile;
};

export { collectBindingCandidates, collectExpressionCandidates };
export type { BindingCandidate };
