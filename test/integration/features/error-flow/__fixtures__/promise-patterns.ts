// promise-patterns: floating-promises, misused-promises (forEach), catch-or-return.
//   prefer-await-to-then / prefer-catch are style (out of scope, not reported).

declare function fetchData(): Promise<string>;

export function floatingPromise(): void {
  Promise.resolve('ignored');
}

export function misusedPromises(): void {
  ['a', 'b'].forEach(async (item) => {
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
  Promise.resolve('data')
    .then((data) => {
      return data.toUpperCase();
    })
    .then((upper) => {
      console.log(upper);
      return upper;
    });
}

export function catchOrReturn(): void {
  Promise.resolve('data').then((data) => console.log(data));
}
