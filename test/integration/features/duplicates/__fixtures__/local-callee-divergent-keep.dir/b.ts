function driveB(items: number[]): void {
  const stepB = (m: number): void => { recordB(m); };
  for (const item of items) {
    stepB(item);
  }
}
