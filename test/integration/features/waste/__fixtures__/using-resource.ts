// KEEP boundary (case 5의 반례): using declaration의 자원 lifetime
// 'resource'는 read되지 않지만 scope exit 시 자동 [Symbol.dispose]() 호출 — binding 자체가 lifetime.
// detector는 using/await using declaration을 면제해야 한다.

declare function acquireResource(): Disposable;
declare function doWork(): void;

export function withResource(): void {
  using resource = acquireResource();

  doWork();
}
