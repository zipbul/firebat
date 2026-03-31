import type { Function as OxcFunction, Node } from 'oxc-parser';

import { buildLineOffsets, getLineColumn } from '@zipbul/gildash';
import { Visitor } from 'oxc-parser';

import type { ParsedFile } from '../../engine/types';
import type { SourceSpan } from '../../types';

import { walkOxcTree } from '../../engine/ast/oxc-ast-utils';

type NodeLike = Record<string, unknown>;

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
  readonly kind: 'any-cast' | 'double-cast';
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

const asNodeLike = (value: unknown): NodeLike | null => {
  if (value === null || typeof value !== 'object') {
    return null;
  }

  return value as NodeLike;
};

const extractBindingIdentifiers = (pattern: unknown): ReadonlyArray<NodeLike> => {
  const patternNode = asNodeLike(pattern);

  if (!patternNode) {
    return [];
  }

  if (patternNode.type === 'Identifier') {
    return [patternNode];
  }

  if (patternNode.type === 'AssignmentPattern') {
    return extractBindingIdentifiers(patternNode.left);
  }

  if (patternNode.type === 'RestElement') {
    return extractBindingIdentifiers(patternNode.argument);
  }

  if (patternNode.type === 'ObjectPattern') {
    const properties = patternNode.properties;

    if (Array.isArray(properties)) {
      const results: NodeLike[] = [];

      for (const prop of properties) {
        const propNode = asNodeLike(prop);

        if (!propNode) {
          continue;
        }

        if (propNode.type === 'RestElement') {
          results.push(...extractBindingIdentifiers(propNode.argument));
        } else {
          // Property node — value holds the binding pattern
          results.push(...extractBindingIdentifiers(propNode.value));
        }
      }

      return results;
    }
  }

  if (patternNode.type === 'ArrayPattern') {
    const elements = patternNode.elements;

    if (Array.isArray(elements)) {
      const results: NodeLike[] = [];

      for (const el of elements) {
        if (el === null) {
          continue;
        } // sparse slot

        results.push(...extractBindingIdentifiers(el));
      }

      return results;
    }
  }

  return [];
};

const extractMemberObjectEnd = (node: NodeLike): number | undefined => {
  // MemberExpression: obj.prop or obj[key]
  if (node.type === 'MemberExpression') {
    const obj = asNodeLike(node.object);

    return obj && typeof obj.end === 'number' ? obj.end : undefined;
  }

  // CallExpression where callee is MemberExpression: obj.method(...)
  if (node.type === 'CallExpression') {
    const callee = asNodeLike(node.callee);

    if (callee?.type === 'MemberExpression') {
      const obj = asNodeLike(callee.object);

      return obj && typeof obj.end === 'number' ? obj.end : undefined;
    }
  }

  return undefined;
};

const getInitObjectEndOffset = (init: unknown): number | undefined => {
  const initNode = asNodeLike(init);

  if (!initNode) {
    return undefined;
  }

  // Unwrap AwaitExpression
  const target = initNode.type === 'AwaitExpression' ? asNodeLike(initNode.argument) : initNode;

  if (!target) {
    return undefined;
  }

  const direct = extractMemberObjectEnd(target);

  if (direct !== undefined) {
    return direct;
  }

  // ConditionalExpression: cond ? a : b → check both branches
  if (target.type === 'ConditionalExpression') {
    const consequent = asNodeLike(target.consequent);
    const alternate = asNodeLike(target.alternate);
    const fromConsequent = consequent ? extractMemberObjectEnd(consequent) : undefined;

    if (fromConsequent !== undefined) {
      return fromConsequent;
    }

    return alternate ? extractMemberObjectEnd(alternate) : undefined;
  }

  // LogicalExpression: a ?? b, a || b → check left side
  if (target.type === 'LogicalExpression') {
    const left = asNodeLike(target.left);

    return left ? extractMemberObjectEnd(left) : undefined;
  }

  return undefined;
};

const hasExplicitAnyTypeArgument = (init: unknown): boolean => {
  const initNode = asNodeLike(init);

  if (!initNode) {
    return false;
  }

  // Unwrap AwaitExpression
  const target = initNode.type === 'AwaitExpression' ? asNodeLike(initNode.argument) : initNode;

  if (!target || target.type !== 'CallExpression') {
    return false;
  }

  const typeArgs = target.typeArguments ?? target.typeParameters;
  const params = asNodeLike(typeArgs);

  if (!params) {
    return false;
  }

  const paramsList = params.params ?? params.arguments;

  if (!Array.isArray(paramsList)) {
    return false;
  }

  for (const arg of paramsList) {
    const argNode = asNodeLike(arg);

    if (argNode?.type === 'TSAnyKeyword' || argNode?.type === 'TSUnknownKeyword') {
      return true;
    }
  }

  return false;
};

const containsAnyUnknownCast = (node: NodeLike): boolean => {
  // Direct: expr as any, expr as unknown
  if (node.type === 'TSAsExpression' || node.type === 'TSTypeAssertion') {
    const typeAnno = asNodeLike(node.typeAnnotation);

    if (typeAnno?.type === 'TSAnyKeyword' || typeAnno?.type === 'TSUnknownKeyword') {
      return true;
    }

    // Check inner expression too (double-cast: x as unknown as T)
    const inner = asNodeLike(node.expression);

    if (inner) {
      return containsAnyUnknownCast(inner);
    }
  }

  // ParenthesizedExpression: (expr) → unwrap
  if (node.type === 'ParenthesizedExpression') {
    const inner = asNodeLike(node.expression);

    if (inner) {
      return containsAnyUnknownCast(inner);
    }
  }

  // MemberExpression: (x as unknown as T).prop → check object
  if (node.type === 'MemberExpression') {
    const obj = asNodeLike(node.object);

    if (obj) {
      return containsAnyUnknownCast(obj);
    }
  }

  // CallExpression: (x as unknown as T).method() → check callee
  if (node.type === 'CallExpression') {
    const callee = asNodeLike(node.callee);

    if (callee) {
      return containsAnyUnknownCast(callee);
    }
  }

  return false;
};

const hasExplicitCastToAnyUnknown = (init: unknown): boolean => {
  const initNode = asNodeLike(init);

  if (!initNode) {
    return false;
  }

  // Unwrap AwaitExpression
  const target = initNode.type === 'AwaitExpression' ? asNodeLike(initNode.argument) : initNode;

  if (!target) {
    return false;
  }

  if (containsAnyUnknownCast(target)) {
    return true;
  }

  // ConditionalExpression: cond ? (x as unknown) : y
  if (target.type === 'ConditionalExpression') {
    const consequent = asNodeLike(target.consequent);
    const alternate = asNodeLike(target.alternate);

    if (consequent && containsAnyUnknownCast(consequent)) {
      return true;
    }

    if (alternate && containsAnyUnknownCast(alternate)) {
      return true;
    }
  }

  return false;
};

const getCalleeEndOffset = (init: unknown): number | undefined => {
  const initNode = asNodeLike(init);

  if (!initNode || initNode.type !== 'CallExpression') {
    return undefined;
  }

  const callee = asNodeLike(initNode.callee);

  if (!callee) {
    return undefined;
  }

  const end = typeof callee.end === 'number' ? callee.end : undefined;

  return end;
};

const getAwaitedCalleeEndOffset = (init: unknown): number | undefined => {
  const initNode = asNodeLike(init);

  if (!initNode) {
    return undefined;
  }

  if (initNode.type === 'CallExpression') {
    return getCalleeEndOffset(init);
  }

  if (initNode.type === 'AwaitExpression') {
    return getCalleeEndOffset(initNode.argument);
  }

  return undefined;
};

const collectBindingCandidates = (input: CollectBindingCandidatesInput): ReadonlyMap<string, ReadonlyArray<BindingCandidate>> => {
  const perFile = new Map<string, ReadonlyArray<BindingCandidate>>();

  for (const file of input.program) {
    const filePath = file.filePath;
    const candidates: BindingCandidate[] = [];
    const seenOffsets = new Set<number>();
    const scopes: Array<{ start: number; end: number }> = [];

    const findEnclosingScope = (offset: number): { start: number; end: number } | undefined => {
      let best: { start: number; end: number } | undefined;

      for (const s of scopes) {
        if (s.start <= offset && offset <= s.end) {
          if (!best || s.end - s.start < best.end - best.start) {
            best = s;
          }
        }
      }

      return best;
    };

    const moduleScope = { start: 0, end: file.sourceText.length };

    const pushCandidate = (
      id: NodeLike,
      isCatchParam: boolean,
      initCalleeEndOffset: number | undefined,
      fallbackStart: number,
      extra?: {
        readonly catchBodyRange?: { readonly start: number; readonly end: number };
        readonly hasExplicitAnnotation?: boolean;
        readonly explicitScopeRange?: { readonly start: number; readonly end: number };
        readonly initObjectEndOffset?: number;
        readonly iterableEndOffset?: number;
        readonly hasExplicitAnyTypeArg?: boolean;
      },
    ): void => {
      const name = typeof id.name === 'string' ? id.name : '';

      if (name.length === 0) {
        return;
      }

      const startOffset = typeof id.start === 'number' ? id.start : fallbackStart;
      const endOffset = typeof id.end === 'number' ? id.end : startOffset;

      if (seenOffsets.has(startOffset)) {
        return;
      }

      seenOffsets.add(startOffset);

      const resolvedScope = extra?.explicitScopeRange ?? findEnclosingScope(startOffset) ?? moduleScope;

      candidates.push({
        name,
        offset: startOffset,
        span: toSpanFromOffsets(file.sourceText, startOffset, endOffset),
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

    const handleFunctionNode = (node: Node): void => {
      // Collect function/arrow body ranges as scopes
      const fn = node as OxcFunction;
      const body = fn.body;

      if (body !== null && body !== undefined) {
        scopes.push({ start: body.start, end: body.end });
      }

      // Process function params
      const funcNode = asNodeLike(node);
      const params = funcNode?.params;
      const funcBody = asNodeLike(funcNode?.body);
      const funcBodyRange =
        funcBody && typeof funcBody.start === 'number' && typeof funcBody.end === 'number'
          ? { start: funcBody.start, end: funcBody.end }
          : undefined;

      if (Array.isArray(params)) {
        const fallbackStart = typeof node.start === 'number' ? node.start : 0;

        for (const p of params) {
          const paramNode = asNodeLike(p);
          const ids = extractBindingIdentifiers(p);
          // Check annotation on the parameter node itself (covers AssignmentPattern, RestElement, etc.)
          const paramHasAnnotation = paramNode?.typeAnnotation !== undefined && paramNode?.typeAnnotation !== null;

          for (const id of ids) {
            const idHasAnnotation = id.typeAnnotation !== undefined && id.typeAnnotation !== null;

            pushCandidate(id, false, undefined, fallbackStart, {
              ...(paramHasAnnotation || idHasAnnotation ? { hasExplicitAnnotation: true } : {}),
              ...(funcBodyRange !== undefined ? { explicitScopeRange: funcBodyRange } : {}),
            });
          }
        }
      }
    };

    const handleForLoop = (node: Node): void => {
      const forNode = asNodeLike(node);
      const right = asNodeLike(forNode?.right);
      const rightEnd = right && typeof right.end === 'number' ? right.end : undefined;
      const left = asNodeLike(forNode?.left);

      if (left?.type === 'VariableDeclaration' && rightEnd !== undefined) {
        const declarations = left.declarations;

        if (Array.isArray(declarations)) {
          for (const decl of declarations) {
            const declNode = asNodeLike(decl);
            const ids = extractBindingIdentifiers(declNode?.id);
            const fallbackStart = typeof node.start === 'number' ? node.start : 0;

            for (const id of ids) {
              pushCandidate(id, false, undefined, fallbackStart, { iterableEndOffset: rightEnd });
            }
          }
        }
      }
    };

    new Visitor({
      FunctionDeclaration: handleFunctionNode,
      FunctionExpression: handleFunctionNode,
      ArrowFunctionExpression: handleFunctionNode,

      VariableDeclarator(node) {
        const nodeRecord = asNodeLike(node);
        const ids = extractBindingIdentifiers(nodeRecord?.id);
        const initCalleeEndOffset = getAwaitedCalleeEndOffset(nodeRecord?.init);
        const initObjectEnd = getInitObjectEndOffset(nodeRecord?.init);
        const explicitAnyTypeArg = hasExplicitAnyTypeArgument(nodeRecord?.init);
        const explicitCast = hasExplicitCastToAnyUnknown(nodeRecord?.init);
        const fallbackStart = typeof node.start === 'number' ? node.start : 0;
        const declId = asNodeLike(nodeRecord?.id);
        const hasAnnotation = declId?.typeAnnotation !== undefined && declId?.typeAnnotation !== null;

        for (const id of ids) {
          pushCandidate(id, false, initCalleeEndOffset, fallbackStart, {
            ...(hasAnnotation ? { hasExplicitAnnotation: true } : {}),
            ...(initObjectEnd !== undefined ? { initObjectEndOffset: initObjectEnd } : {}),
            ...(explicitAnyTypeArg || explicitCast ? { hasExplicitAnyTypeArg: true } : {}),
          });
        }
      },

      CatchClause(node) {
        const catchNode = asNodeLike(node);
        const param = catchNode?.param;
        const ids = extractBindingIdentifiers(param);
        const fallbackStart = typeof node.start === 'number' ? node.start : 0;
        const body = asNodeLike(catchNode?.body);
        const bodyStart = typeof body?.start === 'number' ? body.start : undefined;
        const bodyEnd = typeof body?.end === 'number' ? body.end : undefined;
        const catchBodyRange = bodyStart !== undefined && bodyEnd !== undefined ? { start: bodyStart, end: bodyEnd } : undefined;

        for (const id of ids) {
          pushCandidate(id, true, undefined, fallbackStart, catchBodyRange !== undefined ? { catchBodyRange } : undefined);
        }
      },

      ForOfStatement: handleForLoop,
      ForInStatement: handleForLoop,
    }).visit(file.program);

    if (candidates.length > 0) {
      perFile.set(filePath, candidates);
    }
  }

  return perFile;
};

const collectExpressionCandidates = (
  input: CollectBindingCandidatesInput,
): ReadonlyMap<string, ReadonlyArray<ExpressionCandidate>> => {
  const perFile = new Map<string, ReadonlyArray<ExpressionCandidate>>();

  for (const file of input.program) {
    const candidates: ExpressionCandidate[] = [];

    walkOxcTree(file.program, (node: Node) => {
      if (node.type !== 'TSAsExpression' && node.type !== 'TSTypeAssertion') {
        return true;
      }

      const nodeRecord = asNodeLike(node);
      const typeAnnotation = asNodeLike(nodeRecord?.typeAnnotation);
      const innerExpr = asNodeLike(nodeRecord?.expression);

      // double-cast: outer(as T) -> inner(as unknown|any)
      if (innerExpr && (innerExpr.type === 'TSAsExpression' || innerExpr.type === 'TSTypeAssertion')) {
        const innerType = asNodeLike(innerExpr.typeAnnotation);

        if (innerType?.type === 'TSUnknownKeyword' || innerType?.type === 'TSAnyKeyword') {
          const startOffset = node.start;
          const endOffset = node.end;

          candidates.push({
            kind: 'double-cast',
            span: toSpanFromOffsets(file.sourceText, startOffset, endOffset),
            sourceSnippet: file.sourceText.slice(startOffset, Math.min(endOffset, startOffset + 80)),
          });

          return false; // prevent re-visiting inner assertion
        }
      }

      // any-cast: as any
      if (typeAnnotation?.type === 'TSAnyKeyword') {
        const startOffset = node.start;
        const endOffset = node.end;

        candidates.push({
          kind: 'any-cast',
          span: toSpanFromOffsets(file.sourceText, startOffset, endOffset),
          sourceSnippet: file.sourceText.slice(startOffset, Math.min(endOffset, startOffset + 80)),
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
export type { BindingCandidate, ExpressionCandidate };
