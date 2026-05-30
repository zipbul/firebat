export function f(state: { error: Error }): never {
  throw state.error;
}
