export function f(): Promise<number> {
  return new Promise<number>((resolve) => {
    throw new Error('boom');
  });
}
