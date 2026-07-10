import type { Gildash, ResolvedType } from '@zipbul/gildash';
import type { Node } from 'oxc-parser';

// `ts.TypeFlags` bits (TypeScript does not export the enum at this layer). Only the bits the
// error-flow rules reason about are named here. Values are written as bare literals so the
// documenting names survive (the waste detector inlines single-use *computed* initializers).
// Any (1) and Unknown (2) — either could be an Error.
const FLAG_ANY_OR_UNKNOWN = 0x3;
// Contiguous primitive bits, String (1<<2) through UniqueESSymbol (1<<13): (1<<2)|…|(1<<13).
const FLAG_PRIMITIVE = 0x3ffc;
// Void (1<<14) and Undefined (1<<15): 0x4000 | 0x8000.
const FLAG_VOID_OR_UNDEFINED = 0xc000;
// Never (1<<17) — assignable to everything, so it proves no identity either.
const FLAG_NEVER = 0x20000;

// A type proves the value is a bare primitive (so, definitely not an Error) only when no part of
// it could be `any`/`unknown` and every constituent is a primitive. `string | Error` (mixed) and
// `any` both stay false — the value could be an Error.
export const isWhollyPrimitive = (type: ResolvedType): boolean => {
  if ((type.flags & FLAG_ANY_OR_UNKNOWN) !== 0) {
    return false;
  }

  if (type.isUnion || type.isIntersection) {
    const members = type.members ?? [];

    return members.length > 0 && members.every(isWhollyPrimitive);
  }

  return (type.flags & FLAG_PRIMITIVE) !== 0;
};

// A contextual call-signature return type proves the slot discards the value (a `void` context).
// `any`/`unknown` returns are rejected — they could accept a thenable.
export const isVoidReturn = (type: ResolvedType): boolean =>
  // Not any/unknown, and at least one of Void / Undefined.
  (type.flags & FLAG_ANY_OR_UNKNOWN) === 0 && (type.flags & FLAG_VOID_OR_UNDEFINED) !== 0;

/**
 * The single owner of every gildash type query for the error-flow detector. Rules ask domain
 * questions about oxc nodes; the oracle resolves them against the semantic layer and answers
 * conservatively (`false`) whenever gildash is absent or a query fails — so degraded scans never
 * over-report.
 */
export interface TypeOracle {
  /**
   * The expression's (result) type is a thenable / Promise. `false` is conservative — returned both
   * when gildash *proved* the type is not thenable AND when it could not decide (gildash absent, the
   * query threw, or `any`/`unknown`). Callers must read `false` as "not provably thenable", never as
   * "proven non-thenable".
   */
  isThenable(node: Node): boolean;
  /** The value's static type is provably a bare primitive (never an Error). Conservative `false` (see isThenable). */
  isPrimitiveValue(node: Node): boolean;
  /** The argument slot's contextual type is a callback whose every signature returns void. Conservative `false` (see isThenable). */
  expectsVoidReturningCallback(argNode: Node): boolean;
  /** The expression's static type is a subtype of `Error` (a thrown one would carry a stack). Conservative `false` (see isThenable). */
  isErrorSubtype(node: Node): boolean;
  /**
   * The receiver's static type is provably an Array: assignable to `ReadonlyArray<unknown>` AND
   * the resolved type is not `any`/`unknown`/`never` (those are assignable to everything, so bare
   * assignability proves no identity — the guard mirrors the thenable probe's built-in any-guard).
   * Conservative `false` (see isThenable).
   */
  isProvenArray(node: Node): boolean;
}

export const createTypeOracle = (gildash: Gildash | null, filePath: string): TypeOracle => {
  const spanOf = (node: Node) => ({ start: node.start, end: node.end });

  // The thenable probe behind isThenable. Returns gildash's tri-state verdict (`true` thenable,
  // `false` proven non-thenable) or `null` when gildash is absent / undecided / threw.
  const queryThenable = (node: Node): boolean | null => {
    if (gildash === null) {
      return null;
    }

    try {
      return gildash.isThenableAtSpan(filePath, spanOf(node), { anyConstituent: true });
    } catch {
      return null;
    }
  };

  return {
    isThenable(node) {
      return queryThenable(node) === true;
    },

    isPrimitiveValue(node) {
      if (gildash === null) {
        return false;
      }

      try {
        const type = gildash.getExpressionTypeAtSpan(filePath, spanOf(node));

        return type !== null && isWhollyPrimitive(type);
      } catch {
        return false;
      }
    },

    expectsVoidReturningCallback(argNode) {
      if (gildash === null) {
        return false;
      }

      try {
        const returns = gildash.getContextualCallReturnsAtSpan(filePath, spanOf(argNode));

        return returns !== null && returns.length > 0 && returns.every(isVoidReturn);
      } catch {
        return false;
      }
    },

    isErrorSubtype(node) {
      if (gildash === null) {
        return false;
      }

      try {
        return gildash.isTypeAssignableToTypeAtSpan(filePath, spanOf(node), 'Error', { anyConstituent: true }) === true;
      } catch {
        return false;
      }
    },

    isProvenArray(node) {
      if (gildash === null) {
        return false;
      }

      try {
        // `any`/`unknown`/`never` are assignable to (or from) everything — bare assignability
        // proves no array identity for them, so resolve the receiver's type first and hold.
        const type = gildash.getExpressionTypeAtSpan(filePath, spanOf(node));

        if (type === null || (type.flags & (FLAG_ANY_OR_UNKNOWN | FLAG_NEVER)) !== 0) {
          return false;
        }

        return gildash.isTypeAssignableToTypeAtSpan(filePath, spanOf(node), 'ReadonlyArray<unknown>') === true;
      } catch {
        return false;
      }
    },
  };
};
