# external-tools

Results from external tool integration. lint = oxlint rule violations, format = oxfmt formatting violations, typecheck = TypeScript type errors. These run with auto-fix enabled (oxlint --fix, oxfmt --write).

**Finding fields:** `file, msg, code, severity, span`

<catalog>

## LINT

**Cause:** A lint rule violation was detected by the configured linter.

<think>

1. Read the lint error message and the violated rule name. Look up the rule in the linter documentation to understand its rationale.
2. Fix the violation according to the rule's guidance. If the fix is an autofix-capable rule, run the linter with `--fix` flag.
3. If the rule does not apply to this specific context (e.g., a lint rule about browser APIs in a Node.js file), add a targeted inline suppression comment with an explanation of why the rule is inapplicable.

</think>

## FORMAT

**Cause:** A source file does not conform to the project formatting standard.

<think>

1. Run the project formatter on the file (e.g., `oxfmt --write <file>`). If the file is generated code or vendored, formatting divergence may be intentional — **stop, no action needed**.
2. If formatting conflicts recur after running the formatter, check whether the formatter configuration (`.oxfmtrc`, `printWidth`, etc.) matches the project standard.

</think>

## TYPECHECK

**Cause:** A TypeScript type error was detected during type checking.

<think>

1. Read the type error message. Identify the expected type and the actual type. If the mismatch is in your own code, fix the source: add a missing property, correct a return type, or update the function signature.
2. If the error repeats across multiple call sites with the same root type, the type definition itself is wrong — fix the interface/type declaration rather than patching each call site.
3. If the error comes from a third-party library type mismatch, check if a newer version of `@types/` exists. If not, add a targeted type assertion at the boundary with a comment explaining the mismatch.

</think>

</catalog>
