// promise-patterns: floating-promises, misused-promises, prefer-catch,
//   prefer-await-to-then, catch-or-return

declare function fetchData(): Promise<string>;

export function floatingPromise(): void {
  Promise.resolve('ignored');
}

export function misusedPromises(items: string[]): void {
  items.forEach(async (item) => {
    await Promise.resolve(item);
  });
}

export function preferCatch(): void {
  fetchData().then(
    (data) => console.log(data),
    (err) => console.error(err),
  );
}

export function preferAwaitToThen(): void {
  fetchData()
    .then((data) => {
      return data.toUpperCase();
    })
    .then((upper) => {
      console.log(upper);
      return upper;
    });
}

export function catchOrReturn(): void {
  fetchData().then((data) => console.log(data));
}
