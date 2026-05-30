export function f(): Promise<never> {
  return Promise.reject(new Error('boom'));
}
