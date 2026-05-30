export function f(): Promise<never> {
  return Promise.reject('boom');
}
