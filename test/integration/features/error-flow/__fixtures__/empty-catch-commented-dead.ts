export function f(): void {
  try {
    doWork();
  } catch {
    // best-effort: ignore
  }
}
declare function doWork(): void;
