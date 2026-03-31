import type { Gildash } from '@zipbul/gildash';
import type { Node, Program } from 'oxc-parser';

import { Visitor } from 'oxc-parser';

import type { ResolvedType, SemanticReference } from '../../engine/semantic-types';
import type { ParsedFile } from '../../engine/types';
import type { UnknownProofFinding } from '../../types';
import type { BindingCandidate } from './candidates';

// TypeScript TypeFlags bit values
const TYPE_FLAG_ANY = 1;
const TYPE_FLAG_UNKNOWN = 2;

interface ContainsResult {
  readonly unknown: boolean;
  readonly any: boolean;
  readonly isDirect: boolean;
}

const EMPTY_RESULT: ContainsResult = { unknown: false, any: false, isDirect: false };

// NOTE: No visited Set — gildash 0.9.4+ guarantees ResolvedType is an acyclic tree (bounded, finite, no cycles).
const containsUnknownOrAny = (rt: ResolvedType): ContainsResult => {
  // Handle direct flags — both bits can coexist (e.g. flags = ANY | UNKNOWN = 3)
  const hasDirectUnknown = (rt.flags & TYPE_FLAG_UNKNOWN) !== 0;
  const hasDirectAny = (rt.flags & TYPE_FLAG_ANY) !== 0;

  if (hasDirectUnknown || hasDirectAny) {
    return { unknown: hasDirectUnknown, any: hasDirectAny, isDirect: true };
  }

  // Accumulate flags across members and type arguments — both any and unknown can coexist
  let hasUnknown = false;
  let hasAny = false;
  let isDirect = false;

  // Union/intersection members: preserve child's isDirect
  // e.g. `string | unknown` → member `unknown` has isDirect=true → parent keeps isDirect=true
  if (rt.members) {
    for (const m of rt.members) {
      const r = containsUnknownOrAny(m);

      if (r.unknown) {
        hasUnknown = true;
        isDirect = isDirect || r.isDirect;
      }

      if (r.any) {
        hasAny = true;
        isDirect = isDirect || r.isDirect;
      }
    }
  }

  // Type arguments: always isDirect=false (unknown/any is nested in a container type)
  // e.g. `Array<unknown>` → unknown is structural, not a direct inference issue
  if (rt.typeArguments) {
    for (const ta of rt.typeArguments) {
      const r = containsUnknownOrAny(ta);

      if (r.unknown) {
        hasUnknown = true;
      }

      if (r.any) {
        hasAny = true;
      }
      // typeArguments never contribute to isDirect
    }
  }

  if (hasUnknown || hasAny) {
    return { unknown: hasUnknown, any: hasAny, isDirect };
  }

  return EMPTY_RESULT;
};

interface CallArgRange {
  readonly start: number;
  readonly end: number;
  readonly calleeEnd: number;
}

interface SafeContextData {
  readonly ranges: ReadonlyArray<{ readonly start: number; readonly end: number }>;
  readonly callArgRanges: ReadonlyArray<CallArgRange>;
}

/**
 * Collect ranges in the AST where an identifier usage is inherently safe.
 * Computed once per file for efficiency.
 *
 * Unconditional safe contexts (ranges):
 * - ThrowStatement argument: `throw e` — rethrowing is always safe
 * - TSAsExpression (non-any/unknown): `e as Error` — explicit cast shows intent
 * - BinaryExpression comparisons: `e === null`, `e instanceof Error`
 * - UnaryExpression typeof/!: `typeof e`, `!e`
 * - TemplateLiteral expressions: `${e}` — string coercion is safe
 * - SpreadElement argument: `[...e]`, `fn(...e)` — delegating to spread target
 * - LogicalExpression operands: `e ?? default`, `a || e` — short-circuit evaluation
 * - ConditionalExpression test: `e ? a : b` — truthiness check
 * - ReturnStatement argument (only in functions with explicit return type)
 *
 * Conditional safe contexts (callArgRanges):
 * - CallExpression/NewExpression arguments: safe only if callee is a typed function
 *   (not if callee itself is any/unknown — that's just propagation)
 */
const collectSafeContextRanges = (program: Node): SafeContextData => {
  const ranges: Array<{ start: number; end: number }> = [];
  const callArgRanges: Array<CallArgRange> = [];

  // Track function bodies with their return type status for ReturnStatement check
  const functionBodies: Array<{ bodyStart: number; bodyEnd: number; hasReturnType: boolean }> = [];

  const trackFunctionBody = (body: { start: number; end: number } | null | undefined, returnType: unknown): void => {
    if (body != null) {
      functionBodies.push({ bodyStart: body.start, bodyEnd: body.end, hasReturnType: returnType != null });
    }
  };

  new Visitor({
    FunctionDeclaration(node) {
      trackFunctionBody(node.body, node.returnType);
    },
    FunctionExpression(node) {
      trackFunctionBody(node.body, node.returnType);
    },
    ArrowFunctionExpression(node) {
      trackFunctionBody(node.body, node.returnType);
    },

    ThrowStatement(node) {
      const arg = node.argument;

      ranges.push({ start: arg.start, end: arg.end });
    },

    // CallExpression/NewExpression args → conditional (need callee type check)
    CallExpression(node) {
      const calleeEnd = node.callee.end;

      for (const arg of node.arguments) {
        callArgRanges.push({ start: arg.start, end: arg.end, calleeEnd });
      }
    },
    NewExpression(node) {
      const calleeEnd = node.callee.end;

      for (const arg of node.arguments) {
        callArgRanges.push({ start: arg.start, end: arg.end, calleeEnd });
      }
    },

    TSAsExpression(node) {
      const typeAnnotation = node.typeAnnotation;
      const targetType = typeAnnotation.type;

      if (targetType !== 'TSAnyKeyword' && targetType !== 'TSUnknownKeyword') {
        const expr = node.expression;

        ranges.push({ start: expr.start, end: expr.end });
      }
    },

    BinaryExpression(node) {
      const operator = node.operator;

      if (
        operator === '===' ||
        operator === '!==' ||
        operator === '==' ||
        operator === '!=' ||
        operator === 'instanceof' ||
        operator === 'in'
      ) {
        ranges.push({ start: node.left.start, end: node.left.end });
        ranges.push({ start: node.right.start, end: node.right.end });
      }
    },

    UnaryExpression(node) {
      const operator = node.operator;

      if (operator === 'typeof' || operator === '!') {
        const arg = node.argument;

        ranges.push({ start: arg.start, end: arg.end });
      }
    },

    TemplateLiteral(node) {
      for (const expr of node.expressions) {
        ranges.push({ start: expr.start, end: expr.end });
      }
    },

    // ReturnStatement: only safe if enclosing function has explicit return type
    ReturnStatement(node) {
      const nodeStart = node.start;
      let enclosing: (typeof functionBodies)[number] | undefined;

      for (const fb of functionBodies) {
        if (fb.bodyStart <= nodeStart && nodeStart < fb.bodyEnd) {
          if (!enclosing || fb.bodyEnd - fb.bodyStart < enclosing.bodyEnd - enclosing.bodyStart) {
            enclosing = fb;
          }
        }
      }

      if (enclosing?.hasReturnType) {
        const arg = node.argument;

        if (arg !== null) {
          ranges.push({ start: arg.start, end: arg.end });
        }
      }
    },

    SpreadElement(node) {
      const arg = node.argument;

      ranges.push({ start: arg.start, end: arg.end });
    },

    LogicalExpression(node) {
      ranges.push({ start: node.left.start, end: node.left.end });
      ranges.push({ start: node.right.start, end: node.right.end });
    },

    ConditionalExpression(node) {
      const test = node.test;

      ranges.push({ start: test.start, end: test.end });
    },
  }).visit(program as Program);

  return { ranges, callArgRanges };
};

/**
 * Check if a binding is safely used, combining two strategies:
 *
 * 1. Semantic narrowing: gildash's flow-sensitive type resolution detects if
 *    TypeScript has narrowed the type at the usage position.
 * 2. AST context: usage is in an inherently safe context (throw, function arg,
 *    explicit cast, comparison, template literal, return, spread, logical, conditional)
 *    where the type doesn't need narrowing to be safe.
 *
 * ALL semantics: every usage must be either narrowed or in a safe context.
 * No regex — relies on TypeScript's control flow analysis + AST structure.
 */
const isSafelyUsed = (
  gildash: Gildash,
  filePath: string,
  refs: ReadonlyArray<SemanticReference>,
  varName: string,
  declaredFlag: ContainsResult,
  safeCtx: SafeContextData,
  resolvedTypes: ReadonlyMap<number, ResolvedType>,
): boolean => {
  if (varName === '_' || varName.startsWith('_')) {
    return true;
  }

  // Only check usages in the same file — cross-file usages cannot be verified
  // against this file's resolvedTypes/safeRanges and are inherently consuming the binding
  const usages = refs.filter(r => !r.isDefinition && r.filePath === filePath);

  if (usages.length === 0) {
    return true;
  }

  // Batch-resolve usage types + callee types in one call
  const usagePositions = new Set<number>();

  for (const u of usages) {
    usagePositions.add(u.position);
    const callArg = safeCtx.callArgRanges.find(r => r.start <= u.position && u.position < r.end);

    if (callArg && callArg.calleeEnd > 0) {
      usagePositions.add(callArg.calleeEnd - 1);
    }
  }

  // Merge with already-resolved types from the candidate batch
  const usageTypes = gildash.getResolvedTypesAtPositions(filePath, [...usagePositions]);

  for (const [pos, rt] of resolvedTypes) {
    if (!usageTypes.has(pos)) {
      usageTypes.set(pos, rt);
    }
  }

  // ALL semantics: every usage must be safe (narrowed or in safe context)
  return usages.every(u => {
    // Strategy 1: Semantic narrowing — type changed at usage → developer handles the type
    const usageType = usageTypes.get(u.position);

    if (usageType) {
      const usageFlag = containsUnknownOrAny(usageType);
      // Both declared flags must be resolved — partial narrowing is not safe
      // e.g. declared { unknown: true, any: true }, usage { unknown: false, any: true } → NOT safe
      const unknownSafe = !declaredFlag.unknown || !usageFlag.unknown;
      const anySafe = !declaredFlag.any || !usageFlag.any;

      if (unknownSafe && anySafe) {
        return true;
      }
    }

    // Strategy 2: Unconditional safe AST context
    if (safeCtx.ranges.some(r => r.start <= u.position && u.position < r.end)) {
      return true;
    }

    // Strategy 3: Call argument — safe only if callee is a typed function (not any/unknown itself)
    const callArg = safeCtx.callArgRanges.find(r => r.start <= u.position && u.position < r.end);

    if (callArg && callArg.calleeEnd > 0) {
      const calleeType = usageTypes.get(callArg.calleeEnd - 1);

      if (calleeType) {
        const calleeFlag = containsUnknownOrAny(calleeType);

        // Callee itself is directly any/unknown → propagation, not safe
        if (calleeFlag.isDirect && (calleeFlag.any || calleeFlag.unknown)) {
          return false;
        }
      }

      // Callee is a typed function → consumption, safe
      return true;
    }

    return false;
  });
};

interface RunSemanticChecksInput {
  readonly program: ReadonlyArray<ParsedFile>;
  readonly candidatesByFile: ReadonlyMap<string, ReadonlyArray<BindingCandidate>>;
  readonly gildash: Gildash;
}

interface RunSemanticChecksOk {
  readonly ok: true;
  readonly findings: ReadonlyArray<UnknownProofFinding>;
}

export const runSemanticUnknownProofChecks = (input: RunSemanticChecksInput): RunSemanticChecksOk => {
  const fileByPath = new Map<string, ParsedFile>();

  for (const file of input.program) {
    fileByPath.set(file.filePath, file);
  }

  const findings: UnknownProofFinding[] = [];

  for (const [filePath, candidates] of input.candidatesByFile) {
    // Test files: unknown-proof semantic checks are not meaningful for test code
    if (filePath.endsWith('.spec.ts') || filePath.endsWith('.test.ts')) {
      continue;
    }

    const file = fileByPath.get(filePath);

    if (!file) {
      continue;
    }

    // Pre-filter: explicitly annotated non-catch bindings are intentional declarations — skip before expensive gildash calls.
    // Catch params need checking even with annotation (catch (e: unknown) is the finding case).
    const relevantCandidates = candidates.filter(c => c.isCatchParam || !c.hasExplicitAnnotation);

    if (relevantCandidates.length === 0) {
      continue;
    }

    // Collect ALL positions that need type resolution into a single batch.
    // This replaces per-candidate getResolvedTypeAtPosition calls with one getResolvedTypesAtPositions call.
    const positions = new Set<number>();

    for (const c of relevantCandidates) {
      positions.add(c.offset);

      if (c.initCalleeEndOffset !== undefined) {
        positions.add(c.initCalleeEndOffset - 1);
      }

      if (c.initObjectEndOffset !== undefined) {
        positions.add(c.initObjectEndOffset - 1);
      }

      if (c.iterableEndOffset !== undefined) {
        positions.add(c.iterableEndOffset - 1);
      }
    }

    const resolvedTypes = input.gildash.getResolvedTypesAtPositions(filePath, [...positions]);

    // Early bailout: if no resolved type contains unknown/any, skip entirely.
    let fileHasUnknownOrAny = false;

    for (const [, rt] of resolvedTypes) {
      const f = containsUnknownOrAny(rt);

      if (f.unknown || f.any) {
        fileHasUnknownOrAny = true;
        break;
      }
    }

    const hasCatchCandidates = !fileHasUnknownOrAny && relevantCandidates.some(c => c.isCatchParam);

    if (!fileHasUnknownOrAny && !hasCatchCandidates) {
      continue;
    }

    // Pre-compute safe AST context ranges for this file (once per file)
    const safeCtx = collectSafeContextRanges(file.program);

    for (const candidate of relevantCandidates) {
      const resolvedType = resolvedTypes.get(candidate.offset);

      if (!resolvedType) {
        continue;
      }

      const flag = containsUnknownOrAny(resolvedType);

      if (!flag.unknown && !flag.any) {
        continue;
      }

      // catch param → finding only if not safely used
      if (candidate.isCatchParam) {
        const refs = input.gildash.getSemanticReferencesAtPosition(filePath, candidate.offset);
        const isSafe = isSafelyUsed(input.gildash, filePath, refs, candidate.name, flag, safeCtx, resolvedTypes);

        if (!isSafe) {
          if (flag.unknown) {
            findings.push({
              kind: 'unknown-type',
              message: 'Catch parameter is `unknown` — narrow before use',
              filePath,
              span: candidate.span,
              symbol: candidate.name,
              ...(resolvedType.text.length > 0 ? { typeText: resolvedType.text } : {}),
            });
          }

          if (flag.any) {
            findings.push({
              kind: 'any-inferred',
              message: 'Catch parameter is `any` — enable useUnknownInCatchVariables or narrow before use',
              filePath,
              span: candidate.span,
              symbol: candidate.name,
              ...(resolvedType.text.length > 0 ? { typeText: resolvedType.text } : {}),
            });
          }
        }

        continue;
      }

      // Nested unknown/any (in container type like [string, unknown][], Record<K, any>) → skip
      // The unknown/any is structural, from the container's type parameter, not a direct inference issue
      if (!flag.isDirect) {
        continue;
      }

      // CallExpression init → check callee's declared return type for boundary detection
      if (candidate.initCalleeEndOffset !== undefined) {
        const calleeType = resolvedTypes.get(candidate.initCalleeEndOffset - 1);

        if (calleeType) {
          const calleeFlag = containsUnknownOrAny(calleeType);

          if (calleeFlag.unknown || calleeFlag.any) {
            // Boundary: callee declares unknown/any return type → PASS
            continue;
          }
        }
      }

      // Explicit <any>/<unknown> type argument → intentional type erasure, skip
      if (candidate.hasExplicitAnyTypeArg) {
        continue;
      }

      // MemberExpression on any/unknown parent → derived type, not binding's fault
      if (candidate.initObjectEndOffset !== undefined) {
        const objectType = resolvedTypes.get(candidate.initObjectEndOffset - 1);

        if (objectType) {
          const objectFlag = containsUnknownOrAny(objectType);

          if (objectFlag.unknown || objectFlag.any) {
            // Parent object is any/unknown → binding's type is inherited, skip
            continue;
          }
        }
      }

      // ForOf/ForIn loop variable → check iterable's element type
      if (candidate.iterableEndOffset !== undefined) {
        const iterableType = resolvedTypes.get(candidate.iterableEndOffset - 1);

        if (iterableType) {
          const iterableFlag = containsUnknownOrAny(iterableType);

          if (iterableFlag.unknown || iterableFlag.any) {
            // Iterable is any/unknown → loop variable's type is inherited, skip
            continue;
          }
        }
      }

      // Check safe usage via semantic narrowing + AST context
      const refs = input.gildash.getSemanticReferencesAtPosition(filePath, candidate.offset);
      const isSafe = isSafelyUsed(input.gildash, filePath, refs, candidate.name, flag, safeCtx, resolvedTypes);

      if (isSafe) {
        continue;
      }

      if (flag.unknown) {
        findings.push({
          kind: 'unknown-inferred',
          message: 'Type is (or contains) `unknown`',
          filePath,
          span: candidate.span,
          symbol: candidate.name,
          ...(resolvedType.text.length > 0 ? { typeText: resolvedType.text } : {}),
        });
      }

      if (flag.any) {
        findings.push({
          kind: 'any-inferred',
          message: 'Type is (or contains) `any`',
          filePath,
          span: candidate.span,
          symbol: candidate.name,
          ...(resolvedType.text.length > 0 ? { typeText: resolvedType.text } : {}),
        });
      }
    }
  }

  return { ok: true, findings };
};

export const __testing__ = { containsUnknownOrAny, collectSafeContextRanges, isSafelyUsed };
