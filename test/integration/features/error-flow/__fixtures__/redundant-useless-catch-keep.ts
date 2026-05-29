export function f(): void {
  try {
    doWork();
  } catch (e) {
    throw e;
  }
}
declare function doWork(): void;
