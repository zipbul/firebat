// KEEP (FP-A): jotai memoryleak pattern — `unsub` is called, then cleared to
// drop the closure it retains. Dead `= undefined` reassignment = reference release.
function subscribe(): () => void {
  return () => {};
}
export function f(): number {
  let unsub: (() => void) | undefined = subscribe();
  unsub();
  unsub = undefined;
  return 0;
}
