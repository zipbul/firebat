export function checkState(active: boolean): void {
  console.assert(active, 'state must be active');

  if (!active) {
    return;
  }
}
