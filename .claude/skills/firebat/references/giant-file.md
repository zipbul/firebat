# giant-file

Detects oversized source files exceeding the configured maxLines threshold. Signals that the file concentrates too many responsibilities and should be split.

**Finding fields:** `kind, code, file, span, metrics: { lineCount, maxLines }`

<catalog>

## GIANT_FILE

**Cause:** A source file exceeds the line threshold, concentrating too many responsibilities in a single file.

<think>

1. Read the file and group its exports (functions, types, constants) by domain responsibility. Each group that has a distinct purpose and its own set of consumers is a candidate for extraction into a separate module.
2. Extract the largest cohesive group first into a new file in the same directory. Update all imports across the project. Repeat until the original file is under the threshold.
3. If the file resists decomposition (every function depends on every other), the tight interdependency is the root cause. Address that first (break circular dependencies, extract shared types) before splitting the file.

</think>

</catalog>
