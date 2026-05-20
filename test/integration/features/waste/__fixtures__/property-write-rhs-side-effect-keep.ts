// case 7 KEEP boundary: property-write RHS has a side-effect (call).
// `state.count = sideEffect()` cannot be dropped — the assignment removal also
// erases the sideEffect() invocation. Same purity rule as case 6.

declare function sideEffect(): number;

export function f(): void {
  const state = { count: 0 };

  state.count = sideEffect();
}
