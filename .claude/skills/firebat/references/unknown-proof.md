# unknown-proof

Detects unsafe any/unknown usage. Finds unnarrowed unknown, inferred unknown/any, explicit as-any casts, and double assertions (as unknown as T). Uses gildash type analysis.

**Finding fields:** `kind, code, file, span, symbol`

<catalog>

## UNKNOWN_UNNARROWED

**Cause:** A value of type 'unknown' is used without narrowing, meaning no runtime type check guards the access.

<think>

1. Read the code where the unknown value is used. Trace its origin — catch clause (`catch (e)`), external API response, generic parameter, or JSON.parse result.
2. Add a type guard before the usage site: `typeof` for primitives, `instanceof` for class instances, or a schema validator (e.g., zod) for complex objects. If the value comes from a catch clause, narrow with `if (e instanceof Error)`.
3. If multiple usage sites exist for the same unknown value, add a single validation function at the entry point and reuse the narrowed result downstream.

</think>

## UNKNOWN_INFERRED

**Cause:** TypeScript infers 'unknown' for a value where a more specific type was likely intended.

<think>

1. Read the declaration site. Identify why TypeScript infers unknown: missing return type annotation on a function, untyped third-party import, or insufficient generic constraints.
2. Add an explicit type annotation at the declaration site (e.g., `const result: ExpectedType = ...`). Run the type checker — if it reports a mismatch, the annotation reveals a real bug.

</think>

## UNKNOWN_ANY_INFERRED

**Cause:** TypeScript infers 'any' for a value, disabling type checking for all downstream usage.

<think>

1. Read the declaration and identify the `any` source: untyped import (add `@types/` package or declare module), `JSON.parse` result (add `as Type` or validate with schema), catch clause (use `unknown` instead), or missing generic parameter.
2. Add a type annotation at the root source. Grep for downstream usages of this variable — each one is currently unchecked and may hide bugs.
3. After adding the annotation, run the type checker. Any new errors indicate places where the code relied on the implicit `any` bypass.

</think>

## UNKNOWN_ANY_CAST

**Cause:** An explicit 'as any' cast removes type safety, allowing any operation on the value without type checking.

<think>

1. Read the `as any` cast site. If it works around a missing type definition for a third-party library, add proper types (`@types/` package or local declaration file) and remove the cast.
2. If it works around a type error in your own code, fix the underlying type mismatch instead. Replace `as any` with a specific type assertion (`as SpecificType`) if a cast is truly needed.
3. If the cast is unavoidable at a system boundary, minimize its scope — cast in a single wrapper function and return a typed result so `any` does not propagate.

</think>

## UNKNOWN_DOUBLE_CAST

**Cause:** A double assertion (e.g. `x as unknown as T`) bypasses TypeScript's type safety by casting through an intermediate type.

<think>

1. Read the double assertion and the types involved. If `x` and `T` are structurally incompatible, this masks a genuine type mismatch — investigate why the code needs this value as type `T`.
2. Try replacing the double assertion with a type guard (`if (isT(x))`) or a generic constraint. If neither works, add an interface that both types satisfy and use a single assertion.
3. If the cast is at a system boundary (FFI, serialization), isolate it in a typed wrapper function and document why the assertion is safe.

</think>

</catalog>
