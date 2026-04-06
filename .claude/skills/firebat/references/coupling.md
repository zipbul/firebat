# coupling

Analyzes module coupling. Identifies god modules (excessive fan-in + fan-out), bidirectional dependencies, main-sequence deviation, unstable modules (high fan-out, low fan-in), and rigid modules (high fan-in, low fan-out).

**Finding fields:** `module, score, signals, metrics, why`

<catalog>

## COUPLING_GOD_MODULE

**Cause:** A module has both high fan-in and high fan-out, meaning many modules depend on it and it depends on many modules.

<think>

1. Read the module and list all its exports. Group exports by domain responsibility (e.g., types, utilities, business logic, constants). Each group that has its own set of consumers is a candidate for extraction.
2. Grep for each export to identify consumer clusters. If group A is consumed only by modules X and Y, and group B only by modules Z and W, the module serves two unrelated audiences and should be split.
3. Extract each responsibility group into its own module. Update all consumer imports. After splitting, verify that the original module is either deleted or reduced to a thin re-export barrel.

</think>

## COUPLING_BIDIRECTIONAL

**Cause:** Two modules import from each other, creating a circular dependency that prevents independent reasoning about either.

<think>

1. Read the import statements in both directions. Identify which direction is primary (core logic depends on it) and which is incidental (convenience, type reference, or utility access).
2. For the incidental direction: extract the shared symbol into a third module that both can import, or invert the dependency using dependency injection (pass the dependency as a parameter instead of importing).
3. If both directions are truly essential (each module needs the other to function), the two modules are a single cohesive unit — merge them into one module.

</think>

## COUPLING_OFF_MAIN_SEQ

**Cause:** A module's instability-abstractness balance places it far from the main sequence, indicating it is either too abstract for its stability or too concrete for how many depend on it.

<think>

1. Read the module. If it is too concrete (many dependents but no interfaces), add interfaces/contracts for the capabilities it provides so dependents can depend on abstractions instead of implementations.
2. If it is too abstract (mostly interfaces but few dependents), the abstractions may be premature — inline them into the modules that use them.
3. If the module is a mixed bag, split it: concrete implementations in one module, abstract contracts in another.

</think>

## COUPLING_UNSTABLE

**Cause:** A module has high instability (many outgoing dependencies, few incoming) and high fan-out, making it sensitive to changes in its dependencies.

<think>

1. Read the module and list all its imports. If it is an orchestrator (composition root, adapter, controller), high fan-out is by design — **stop, no action needed**.
2. If it is not an orchestrator, identify which imports can be replaced with port interfaces. Create interfaces for the volatile dependencies and inject implementations via the composition root.
3. After adding interfaces, verify that the module only depends on stable abstractions (ports, types) rather than concrete implementations.

</think>

## COUPLING_RIGID

**Cause:** A module has very low instability (many dependents, few dependencies) and high fan-in, making it extremely costly to change.

<think>

1. Read the module and its exports. If the module is intentionally stable (core types, shared constants, fundamental utilities), rigidity is by design — **stop, no action needed**.
2. If the module needs to evolve, identify the stable subset that dependents rely on. Extract this subset into a separate module that remains frozen, allowing the rest to change freely.
3. If dependents use different subsets of the module, split it by consumer group so that changes affect only the relevant consumers.

</think>

</catalog>
