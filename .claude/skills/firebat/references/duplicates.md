# duplicates

Detects code duplication at three granularity levels: exact clones (identical), shape clones (same structure, different names), and normalized clones (minor variations). Near-miss (Type-3) clones are out of scope by concept definition.

**Finding fields:** `findingKind, cloneType, similarity, items[]`

<catalog>

## DUP_EXACT

**Cause:** Two or more code blocks are character-for-character identical, indicating copy-paste duplication.

<think>

1. Read both duplicate blocks and their surrounding context. Identify what varies between the call sites (different arguments, different modules, different data types).
2. Extract the duplicated code into a shared function in the nearest common ancestor module. Parameterize any differences between call sites as function arguments.
3. Check git log for both blocks. If they always change together (same commits), the single source of truth is overdue. If they diverge independently, they may serve different purposes — verify before unifying.

</think>

## DUP_SHAPE

**Cause:** Two or more code blocks share identical structure but differ only in identifier names, suggesting the codebase repeatedly handles a concept without a unifying abstraction.

<think>

1. Read the clones and list the differing identifiers. These names usually represent a domain concept (entity type, resource kind, operation variant) that the code handles repeatedly without an explicit model.
2. Grep for the same structural pattern elsewhere in the codebase. If the shape recurs beyond the reported clones, the missing abstraction is systemic — a generic function parameterized by the varying concept is warranted.
3. If the repetition is intentional (explicit per-entity handling for clarity), and the blocks are short (< 10 lines each), the duplication cost may be acceptable — **stop, no action needed**.

</think>

## DUP_NORMALIZED

**Cause:** Two or more code blocks share the same normalized structure after removing cosmetic differences, indicating similar logic with minor variations.

<think>

1. Read the clones side by side and identify the specific variations (different data types, error strategies, business rules). These variations encode decisions the codebase makes repeatedly without a shared policy.
2. Check git log for both blocks to determine if the variations are accidental divergence from a common origin or intentional specialization. If divergence happened gradually without clear intent, unification is likely correct.
3. Create a shared function that accepts the varying parts as parameters or callbacks. If the variations are too complex to parameterize cleanly, the duplication may be preferable to a forced abstraction — **stop, no action needed**.

</think>

</catalog>
