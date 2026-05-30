export function f(): never {
  throw 'boom' as unknown as Error;
}
