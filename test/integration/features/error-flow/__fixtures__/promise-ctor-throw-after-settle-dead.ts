export function f(): Promise<number> {
  return new Promise<number>((resolve) => {
    resolve(1);
    throw new Error('boom');
  });
}
