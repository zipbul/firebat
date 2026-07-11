// KEEP (mutation-snapshot bug repro): `RealDate` captures the global `Date` BEFORE
// the file deletes it. Inlining `RealDate` → `Date` at the restore site evaluates a
// bare `Date` reference AFTER `delete globalThis.Date` ran → ReferenceError / wrong
// value. The binding is a snapshot-before-mutation, not a redundant alias.
// Spec waste K: "mutation 시점 snapshot".
export function f(): void {
  const RealDate = Date;

  delete (globalThis as { Date?: unknown }).Date;

  (globalThis as { Date: unknown }).Date = RealDate;
}
