export function f(): Promise<void> {
  let later: () => void = () => {};
  const p = new Promise<void>((resolve) => {
    later = resolve;
  });
  later();
  return p;
}
