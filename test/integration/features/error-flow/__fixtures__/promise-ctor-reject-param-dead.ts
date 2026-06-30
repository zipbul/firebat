// W — the first executor parameter is named `reject`, so a `reject(...)` call
// silently resolves the promise (rejection observability lost).
export function make(): Promise<number> {
  return new Promise((reject) => {
    reject();
  });
}
