export function f(): void {
  try {
    doWork();
  } catch (e) {
    handle(e);
  }
}
declare function doWork(): void;
declare function handle(e: unknown): void;
